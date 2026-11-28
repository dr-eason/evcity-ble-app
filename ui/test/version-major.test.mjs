/* 3.0.0：主版本从 2 跳到 3。App 里所有按版本号开关的地方都要把 3.x 当作“比 2.x 新”：
 *
 *     node --test APP/ui/test/version-major.test.mjs
 *
 * App 里按固件版本判断的只有这些：各功能的最低版本（心跳带时间、模组版本、时区、桩时间、
 * 4G、一键配置的分组、IC 卡格数），OTA 选文件时从镜像里读版本（AC06VER=）和降级提示。
 * 都是按 [主, 次, 修订] 三段从左往右比，没有只看主版本或写死 "2." 的地方。
 * 选文件不看文件名（V3.0.0_xxx.bin、V3.0.0_L2_xxx.bin 一样），只看镜像内容。
 * OTA 的几个函数在 App.vue 里没有单独导出，这里从源码里原样取出来跑。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { heartbeatCarriesTime, versionTriple } from "../src/time-sync.js";
import { modverSupported } from "../src/modver.js";
import { tzSupported } from "../src/tz.js";
import { timeGetSupported } from "../src/charger-clock.js";
import { lteSupported } from "../src/lte.js";
import { CARD_SLOTS, CARD_SLOTS_OLD, SECTIONS, blankBody, cardSlotsFor, sectionSkip } from "../src/profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const NEW = ["3.0.0", "V3.0.0", "3.0.1", "3.1.0", "3.01.00", "V3.01.02", "3.10.0", "4.0.0", "4.00.00", "10.0.0"];

test("各功能的最低版本：3.x 都算够新", () => {
  for (const fw of NEW) {
    assert.equal(heartbeatCarriesTime(fw), true, fw);
    assert.equal(modverSupported(fw), true, fw);
    assert.equal(tzSupported(fw), true, fw);
    assert.equal(timeGetSupported(fw), true, fw);
    assert.equal(lteSupported(fw), true, fw);
    assert.equal(cardSlotsFor(fw), CARD_SLOTS, fw);
  }
  assert.deepEqual(versionTriple("3.0.0"), [3, 0, 0]);
  /* 2.x 的老结论不变。 */
  assert.equal(lteSupported("2.6.15"), false);
  assert.equal(tzSupported("2.6.13"), false);
  assert.equal(cardSlotsFor("2.6.3"), CARD_SLOTS_OLD);
  /* 次版本比门槛大、主版本比门槛小的不能算新（防止只比次版本）。 */
  assert.equal(lteSupported("1.9.99"), false);
  assert.equal(heartbeatCarriesTime("1.7.0"), false);
});

test("一键配置：3.0.0 的桩每一组都不因为版本跳过（读和写）", () => {
  for (const section of SECTIONS) {
    assert.equal(sectionSkip(section, "read", "3.0.0", blankBody()), "", section.key);
    assert.equal(sectionSkip(section, "read", "V3.0.0", blankBody()), "", section.key);
    const why = sectionSkip(section, "write", "3.0.0", blankBody(), { withLte: true });
    assert.notEqual(why, "固件不支持", section.key);
  }
});

/* 从 App.vue 取出一个顶层函数的源码（到行首的 "}" 为止）。 */
function grab(vue, name) {
  const start = vue.indexOf("\nfunction " + name + "(");
  assert.ok(start >= 0, "App.vue 里没有 " + name);
  const end = vue.indexOf("\n}\n", start);
  return vue.slice(start + 1, end + 2);
}

const vue = read("APP/ui/src/App.vue");
const ota = new Function(
  ["verLabel", "versionParts", "isDowngrade", "cStringAt", "firmwareVersion"].map((n) => grab(vue, n)).join("\n") +
  "\nreturn { verLabel, versionParts, isDowngrade, firmwareVersion };",
)();

test("OTA 降级提示：2.x → 3.0.0 是升级，3.0.0 → 2.x 才提示降级", () => {
  for (const pile of ["2.8.0", "V2.8.0", "2.7.2", "2.6.16", "2.5.4", "2.10.9"]) {
    assert.equal(ota.isDowngrade("3.0.0", pile), false, pile);
    assert.equal(ota.isDowngrade(pile.replace(/^V/, ""), "3.0.0"), true, pile);
  }
  assert.equal(ota.isDowngrade("3.0.0", "3.0.0"), false);
  assert.equal(ota.isDowngrade("3.0.1", "3.0.0"), false);
  assert.equal(ota.isDowngrade("3.0.0", "3.0.1"), true);
  assert.equal(ota.isDowngrade("3.0.0", "—"), false);       /* 桩的版本没读到：不拦 */
  assert.equal(ota.isDowngrade("", "2.8.0"), false);         /* 文件里没认出版本：不拦 */
  assert.equal(ota.verLabel("3.0.0"), "V3.0.0");
});

function imageWith(text) {
  const bytes = new Uint8Array(4096).fill(0xff);
  bytes.fill(0, 64, 1024);
  for (let i = 0; i < text.length; i++) bytes[512 + i] = text.charCodeAt(i);
  bytes[512 + text.length] = 0;
  return bytes;
}

test("OTA 选文件：镜像里的 AC06VER=3.0.0 认得出来", () => {
  assert.equal(ota.firmwareVersion(imageWith("AC06VER=3.0.0")), "3.0.0");
  assert.equal(ota.firmwareVersion(imageWith("AC06VER=3.10.12")), "3.10.12");
  assert.equal(ota.firmwareVersion(imageWith("AC06VER=2.8.0")), "2.8.0");
  assert.equal(ota.firmwareVersion(imageWith("AC06VER=3.0.0-rc")), "");
});

test("版本号：安卓、iOS 是 大版本.APP版本（两段），AC06 固件的前两段和它相同，而且是 3.x", () => {
  const fw = read("AC06/user/inc/app_config.h").match(/#define AC06_FW_VERSION\s+"([^"]+)"/)[1];
  const manifest = read("APP/android/AndroidManifest.xml");
  const name = manifest.match(/android:versionName="([^"]+)"/)[1];
  const code = Number(manifest.match(/android:versionCode="(\d+)"/)[1]);
  const ios = read("APP/ios/Config/Base.xcconfig");
  /* 书写补零：App 是 3.01，固件是 3.01.00（第 3 段是 AC06 自己的固件版本，不进 App 的版本和 build 号）。 */
  assert.match(name, /^[1-9]\d?\.\d{2}$/);
  assert.match(fw, /^[1-9]\d?\.\d{2}\.\d{2}$/);
  assert.equal(fw.slice(0, name.length + 1), name + ".");
  assert.equal(ios.match(/^EVC_VERSION = (.+)$/m)[1], name);
  assert.equal(Number(ios.match(/^EVC_BUILD = (\d+)$/m)[1]), code);
  /* versionCode 的规则：大版本×10000 + APP版本×100（3.01 → 30100）。比老规则
   * （主×1000 + 次×100 + 修订，3.1.0 → 3100）下已经上架的号都大。 */
  const [a, b] = versionTriple(fw);
  assert.equal(code, a * 10000 + b * 100);
  assert.ok(code > 3100);
  assert.ok(a >= 3);
});
