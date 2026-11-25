/* 相位设置（PHASEGET / PHASESET）的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/phase.test.mjs
 *
 * 假桩按固件 wb2.c 的规则应答：PHASEGET 回 "PHASE 0/1"（没有 ACK），充电中改成另一个值回 BUSY。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES, PHASE_BUSY_REASON, parsePhaseLine, phaseName, readPhase, savePhase } from "../src/phase.js";
import { languages, translate } from "../src/i18n.js";
import { phasePacks } from "../src/packs-phase.js";
import { parseAuthLine, resendable } from "../src/auth.js";
import { SETTINGS_GROUPS } from "../src/tabs.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
/* 日语的“三相”和中文同形，翻出来和键一样是对的。 */
const sameAsKey = (lang, key) => lang === "ja" && key === "三相";

/* 假桩。silent：旧到不回的桩（实际固件一直都有这两条，这里只为测“桩不回”的处理）。 */
function makePile(opts) {
  const pile = { phase: 0, charging: false, silent: false, dropSet: false, sent: [], gone: false };
  Object.assign(pile, opts || {});
  pile.answer = (command) => {
    pile.sent.push(command);
    if (pile.silent) return null;
    if (command === "PHASEGET") return "PHASE " + pile.phase;
    if (command.indexOf("PHASESET\t") === 0) {
      const arg = command.slice(9);
      if (arg !== "0" && arg !== "1") return "ACK PHASESET FAIL";
      if (Number(arg) !== pile.phase && pile.charging) return "ACK PHASESET BUSY";
      if (!pile.dropSet) pile.phase = Number(arg);
      return "ACK PHASESET OK";
    }
    return null;
  };
  pile.io = {
    ask: async (command, accept) => {
      const line = pile.answer(command);
      return line !== null && accept(line) ? line : null;
    },
    alive: () => !pile.gone,
    waitMs: 1,
  };
  return pile;
}

test("两种相位：0 单相、1 三相，和固件 screen.c 的 PHM1 一样", () => {
  assert.deepEqual(PHASES.map((item) => item.id), [0, 1]);
  assert.equal(phaseName(0), "单相");
  assert.equal(phaseName(1), "三相");
  assert.equal(phaseName(2), "");
  const screen = read("AC06/app/src/screen.c");
  assert.match(screen, /0 单相，主页用图标 16。1 三相/);
  assert.match(screen, /PHASE_FLASH_MAGIC\s+0x50484D31u/);
});

test("固件认这两条命令，应答格式和这里解析的一样", () => {
  const wb2 = read("AC06/app/src/wb2.c");
  assert.match(wb2, /strcmp\(text, "PHASEGET"\) == 0 \|\| strncmp\(text, "PHASESET\\t", 9\) == 0/);
  assert.match(wb2, /ble_queue\(screen_phase_three\(\) \? "PHASE 1" : "PHASE 0"\);/);
  for (const reply of ["ACK PHASESET OK", "ACK PHASESET FAIL", "ACK PHASESET BUSY"]) {
    assert.ok(wb2.includes('"' + reply + '"'), reply);
  }
  /* 手机蓝牙层放行 "PHASE " 行首（没有 ACK 前缀）。 */
  assert.ok(read("AC06/tools/ble-finder/src/com/evcity/acv2/MainActivity.java").includes('line.startsWith("PHASE ")'));
  assert.ok(read("AC06/tools/ble-ios/Core/Sources/EVCCore/FrameParser.swift").includes('"PHASE "'));
});

test("解析：PHASE 0/1、ACK PHASESET OK/FAIL/BUSY；别的行和鉴权应答不认", () => {
  assert.deepEqual(parsePhaseLine("PHASE 0"), { kind: "get", phase: 0 });
  assert.deepEqual(parsePhaseLine("PHASE 1 "), { kind: "get", phase: 1 });
  assert.deepEqual(parsePhaseLine("ACK PHASESET OK"), { kind: "set", ok: true, busy: false });
  assert.deepEqual(parsePhaseLine("ACK PHASESET FAIL"), { kind: "set", ok: false, busy: false });
  assert.deepEqual(parsePhaseLine("ACK PHASESET BUSY"), { kind: "set", ok: false, busy: true });
  for (const line of ["PHASE 2", "PHASE", "PHASE 1 1", "ACK PHASE 1", "ACK PHASESET AUTH", "ACK PHASEGET AUTH",
    "ACK PHASESET", "STAT 1", "", null, undefined, 5]) {
    assert.equal(parsePhaseLine(line), null, String(line));
  }
  /* 鉴权应答交给 auth.js；PHASESET 被拒时可以补发。 */
  assert.deepEqual(parseAuthLine("ACK PHASESET AUTH"), { kind: "need", cmd: "PHASESET" });
  assert.equal(resendable("PHASESET\t1"), true);
});

test("读：桩回 PHASE 1；桩不回是 silent；连接没了是 gone", async () => {
  const pile = makePile({ phase: 1 });
  assert.deepEqual(await readPhase(pile.io), { state: "ok", phase: 1 });
  assert.deepEqual(pile.sent, ["PHASEGET"]);
  const quiet = makePile({ silent: true });
  assert.deepEqual(await readPhase(quiet.io), { state: "silent" });
  assert.deepEqual(quiet.sent, ["PHASEGET", "PHASEGET"]);
  const gone = makePile({ gone: true });
  assert.deepEqual(await readPhase(gone.io), { state: "gone" });
});

test("存：OK 后读回确认；充电中改成另一个值是 busy；值没变充电中也 OK", async () => {
  const pile = makePile();
  assert.deepEqual(await savePhase({ ...pile.io, phase: 1 }), { state: "ok", phase: 1 });
  assert.deepEqual(pile.sent, ["PHASESET\t1", "PHASEGET"]);
  const busy = makePile({ charging: true });
  assert.deepEqual(await savePhase({ ...busy.io, phase: 1 }), { state: "busy", phase: 0 });
  assert.equal(busy.phase, 0);
  const same = makePile({ charging: true, phase: 1 });
  assert.deepEqual(await savePhase({ ...same.io, phase: 1 }), { state: "ok", phase: 1 });
  /* 回 OK 但没存上：读回不一样，算失败。 */
  const liar = makePile({ dropSet: true });
  assert.deepEqual(await savePhase({ ...liar.io, phase: 1 }), { state: "fail", phase: 0 });
  assert.deepEqual(await savePhase({ ...makePile({ silent: true }).io, phase: 1 }), { state: "silent" });
  assert.deepEqual(await savePhase({ ...pile.io, phase: 2 }), { state: "bad" });
  assert.deepEqual(await savePhase({ ...pile.io, phase: "x" }), { state: "bad" });
  assert.deepEqual(await savePhase({ ...makePile({ gone: true }).io, phase: 1 }), { state: "gone" });
});

test("12 种语言的文案都齐，不是中文键、也不是英文原样", () => {
  const keys = Object.keys(phasePacks.en);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    assert.ok(phasePacks[lang], lang + " 没有表");
    assert.deepEqual(Object.keys(phasePacks[lang]).sort(), keys.slice().sort(), lang + " 的键不齐");
    for (const key of keys) {
      const out = translate(lang, key, { n: 7, same: 3, name: "QQ" });
      assert.ok(out && (out !== key || sameAsKey(lang, key)), lang + " 没翻: " + key);
      if (lang !== "en") assert.notEqual(phasePacks[lang][key], phasePacks.en[key], lang + " 用了英文: " + key);
      for (const holder of ["{n}", "{same}", "{name}"]) {
        if (key.includes(holder)) assert.ok(phasePacks[lang][key].includes(holder), lang + " 丢了 " + holder + ": " + key);
      }
    }
    assert.notEqual(translate(lang, "单相"), translate(lang, "三相"), lang);
  }
  assert.equal(translate("zh", "相位"), "相位");
  assert.equal(translate("en", "相位"), "Phase");
  assert.equal(translate("en", PHASE_BUSY_REASON), "The charger is charging. Stop charging first, then send the phase again");
});

test("App.vue：相位页、菜单、提示用到的字符串在每种语言里都有；入口挨着保护设置", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/App.vue");
  const block = vue.match(/<section v-else-if="page === 'phase'"[\s\S]*?<\/section>/);
  assert.ok(block, "App.vue 里没有相位页");
  const used = new Set(["相位", "单相或三相，决定 L2、L3 是否参与保护判断"]);
  for (const m of block[0].matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  for (const item of PHASES) used.add(item.name);
  const script = vue.slice(vue.indexOf("<script"));
  for (const m of script.matchAll(/phaseNote\.value = "([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.has("充电桩正在充电，不能改相位。请先停止充电再改"));
  assert.ok(used.has("充电桩没有应答。充电桩固件可能太旧，需要升级后再设置"));
  assert.ok(used.size >= 12);
  assert.match(vue, /@click="openPhase"/);
  assert.match(vue, /if \(page\.value === "phase"\) return "相位";/);
  /* 命令不在 App.vue 里拼：读写走 phase.js，等应答用屏幕语言那一个 askScr。 */
  assert.match(script, /readPhase\(\{ ask: askScr, alive \}\)/);
  assert.match(script, /savePhase\(\{ ask: askScr, alive, phase: id \}\)/);
  assert.ok(!/send\("PHASE/.test(script));
  /* applyLine 把 PHASE 行交给等着的人，或者更新界面。 */
  assert.match(script, /if \(parsePhaseLine\(line\) !== null\) \{/);
  const group = SETTINGS_GROUPS.find((item) => item.title === "保护与屏幕");
  assert.equal(group.items.indexOf("openPhase"), group.items.indexOf("openCfg") + 1);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  for (const lang of langs) {
    for (const key of used) {
      const out = translate(lang, key);
      assert.ok(out && (out !== key || sameAsKey(lang, key)), lang + " 没翻: " + key);
    }
  }
});
