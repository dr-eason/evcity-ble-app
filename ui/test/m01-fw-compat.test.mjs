/* App 和固件兼容框架（ui/src/fw-compat.js）的主机测试：
 *
 *     node --test M01/tools/ble-finder/ui/test/fw-compat.test.mjs
 *
 * 一、版本号、能力位的解析；能力表和固件 ble_caps.h、版本号、协议文档、框架文档对得上。
 * 二、模拟各版老固件（1.0.0 … 1.3.3，没有能力位）和新固件（1.3.4 起带能力位，含以后的
 *     新版、去掉某项的版本），逐项看 App 走哪条路：发不发命令、发什么参数、给用户什么提示。
 *     老固件认哪些命令照各版 wb2.c 的 ble_is_command()（git 历史里取出来，在 helpers/fw-versions.mjs）。
 * 三、App.vue 只问 can()，不自己比版本号；提示 12 种语言都有。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION, CAPS, CAPS_FIELD_SINCE, COMPAT_TEXTS, FW_UNKNOWN, MIN_FW, SECTION_NEEDS, capSince, compareVersion, compatNotice,
  fwGiveUp, fwRelation, fwState, isDowngrade, lackNote, parseCapBits, parseVersion, sectionLack, supports,
} from "../src/m01/fw-compat.js";
import { COMPAT_LANGS, COMPAT_ROWS, compatPacks } from "../src/m01/packs-compat.js";
import { hasKey, languages, translate } from "../src/m01/i18n.js";
import { parseSys } from "../src/m01/ports.js";
import { SECTIONS, blankBody, sameSection, writePlan } from "../src/m01/profile.js";
import { createQueue } from "../src/m01/ble-queue.js";
import { createSnapPoller } from "../src/m01/port-board.js";
import { COMMANDS, GATED, OLD } from "./helpers/m01-fw-versions.mjs";
/* M01 仓库里的固件头文件和协议文档，拷了一份在 test/fixtures/m01/（见那里的 README.md）。 */
const fixture = (name) => readFileSync(new URL("./fixtures/m01/" + name, import.meta.url), "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const T = (text) => text.replace(/⇥/g, "\t");
const capsHeader = fixture("ble_caps.h");
const appConfig = fixture("app_config.h");
const appVue = read("AC06/tools/ble-finder/ui/src/m01/M01App.vue");
const frameworkDoc = fixture("App固件兼容框架.md");
const protocolDoc = fixture("M01蓝牙协议.md");
const FW_NOW = /#define M01_FW_VERSION\s+"([^"]+)"/.exec(appConfig)[1];

/* 一台模拟的桩：STATUS 的应答 ACK SYS 照这一版的写法（1.3.4 起带能力位）。 */
function sysLine(version, caps) {
  const tail = caps === undefined ? "" : "⇥" + caps;
  return T("ACK SYS⇥" + version + "⇥10⇥230.4⇥31⇥1⇥-62⇥UP⇥ON⇥2027-01-15T08:00:00Z⇥bench" + tail);
}
function stateOf(version, caps) {
  const got = parseSys(sysLine(version, caps));
  return fwState(got.fw, got.caps);
}
function camelToMacro(key) {
  return "BLE_CAP_" + key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
}
const ALL_BITS = CAPS.reduce((mask, cap) => mask | (1 << cap.bit), 0).toString(16).toUpperCase();

/* ------------------------------------------------------------------ 一、解析和登记 */

test("版本号：认 1.3.2、V1.3.2、1.3、1.3.2-dev；比大小按三段数字", () => {
  assert.deepEqual(parseVersion("1.3.2"), [1, 3, 2]);
  assert.deepEqual(parseVersion("V1.3.2"), [1, 3, 2]);
  assert.deepEqual(parseVersion(" 1.3 "), [1, 3, 0]);
  assert.deepEqual(parseVersion("1.3.2-dev"), [1, 3, 2]);
  for (const bad of ["", "-", "x", "1", "1.3.2.4", "1..2", null, undefined, "1.3.x"]) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
  assert.ok(compareVersion("1.3.2", "1.3.10") < 0);
  assert.ok(compareVersion("1.9.9", "2.0.0") < 0);
  assert.ok(compareVersion("1.4.0", "1.3.9") > 0);
  assert.equal(compareVersion("1.3", "1.3.0"), 0);
  assert.throws(() => compareVersion("x", "1.0.0"));
  /* 固件升级页的降级判断也用这一套。 */
  assert.equal(isDowngrade("1.3.3", "1.3.4"), true);
  assert.equal(isDowngrade("1.3.4", "1.3.3"), false);
  assert.equal(isDowngrade("1.3.4", "1.3.4"), false);
  assert.equal(isDowngrade("", "1.3.4"), false);
  assert.equal(isDowngrade("1.3.2", "—"), false);
});

test("能力位：大写十六进制，1–16 位；不像的不认", () => {
  assert.equal(parseCapBits("1FFF"), "1fff");
  assert.equal(parseCapBits("001fff"), "1fff");
  assert.equal(parseCapBits("0"), "0");
  for (const bad of ["", "-", "extra", "1FFFG", "0x1F", "1".repeat(17)]) assert.equal(parseCapBits(bad), null, bad);
});

test("能力表：key、位号不重复，位号从 0 连着排，since 是能认的版本、不晚于这一版", () => {
  const keys = new Set();
  CAPS.forEach((cap, index) => {
    assert.ok(/^[a-z][A-Za-z]+$/.test(cap.key), cap.key);
    assert.ok(!keys.has(cap.key), "重复: " + cap.key);
    keys.add(cap.key);
    assert.equal(cap.bit, index, cap.key + " 的位号要按顺序");
    assert.ok(parseVersion(cap.since), cap.key);
    assert.ok(compareVersion(cap.since, MIN_FW) >= 0, cap.key);
    assert.ok(compareVersion(cap.since, APP_VERSION) <= 0, cap.key + " 比 App 还新");
    if (cap.until) assert.ok(compareVersion(cap.until, cap.since) > 0, cap.key);
  });
  assert.ok(CAPS.length <= 64);
  assert.throws(() => supports(FW_UNKNOWN, "noSuchCap"));
  assert.throws(() => capSince("noSuchCap"));
});

test("固件 ble_caps.h：位号、名字、注释里的版本和能力表一一对应；BLE_CAPS 正好是这一版该有的", () => {
  const defs = [...capsHeader.matchAll(/#define (BLE_CAP_[A-Z_]+)\s+(\d+)u\s+\/\* (\d+\.\d+\.\d+) /g)];
  assert.equal(defs.length, CAPS.length, "ble_caps.h 和 fw-compat.js 的项数不一样");
  for (const cap of CAPS) {
    const def = defs.find((m) => m[1] === camelToMacro(cap.key));
    assert.ok(def, "ble_caps.h 里没有 " + camelToMacro(cap.key));
    assert.equal(Number(def[2]), cap.bit, cap.key);
    assert.equal(def[3], cap.since, cap.key);
  }
  /* BLE_CAPS 里列的就是 since 不晚于这一版、没有去掉的那些。 */
  const mask = capsHeader.slice(capsHeader.indexOf("#define BLE_CAPS "));
  const listed = new Set([...mask.matchAll(/1uL << (BLE_CAP_[A-Z_]+)/g)].map((m) => m[1]));
  for (const cap of CAPS) {
    const want = compareVersion(cap.since, FW_NOW) <= 0 && !(cap.until && compareVersion(cap.until, FW_NOW) <= 0);
    assert.equal(listed.has(camelToMacro(cap.key)), want, cap.key);
  }
  /* wb2.c 把它放在 ACK SYS 的最后一个字段。 */
});

test("协议文档 4.3 的 ACK SYS 样例：老的没有能力位，1.3.4 的带能力位，App 都认得出版本", () => {
  const samples = [...protocolDoc.matchAll(/^ACK SYS⇥.*$/gm)].map((m) => T(m[0]));
  assert.ok(samples.length >= 3);
  const withCaps = samples.map((line) => parseSys(line)).filter((got) => got && got.caps);
  assert.ok(withCaps.length >= 1, "协议文档里没有带能力位的 ACK SYS 样例");
  for (const got of withCaps) {
    const st = fwState(got.fw, got.caps);
    assert.ok(st.known && st.bits !== null);
    for (const cap of CAPS) assert.equal(supports(st, cap.key), true, cap.key);
  }
});


/* ------------------------------------------------------------------ 二、模拟各版固件 */

test("老固件（没有能力位）：每一项按版本号判断，和那一版真认的命令一致", () => {
  for (const version of OLD) {
    const st = stateOf(version);
    assert.equal(st.known, true);
    assert.equal(st.bits, null);
    for (const [cmd, key] of Object.entries(GATED)) {
      assert.equal(supports(st, key), COMMANDS[version].includes(cmd),
        version + " " + JSON.stringify(cmd) + " → " + key);
    }
  }
  /* 每一项在 since 之前那一版没有、since 那一版有。 */
  const versions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.3.2", "1.3.3", "1.3.4"];
  for (const cap of CAPS) {
    for (const v of versions) {
      assert.equal(supports(stateOf(v), cap.key), compareVersion(v, cap.since) >= 0, cap.key + " @ " + v);
    }
  }
});

test("新固件（带能力位）：只看能力位；以后的版本去掉了某项、多了 App 不认识的位，都照位走", () => {
  const now = stateOf("1.3.4", ALL_BITS);
  for (const cap of CAPS) assert.equal(supports(now, cap.key), true, cap.key);
  /* 将来的 1.5.0 去掉了翻页（bit 4），多了 bit 13、bit 40：App 只认自己知道的位。 */
  const removed = (parseInt(ALL_BITS, 16) & ~(1 << 4)) | (1 << 13);
  const future = stateOf("1.5.0", removed.toString(16).toUpperCase());
  assert.equal(supports(future, "orderPaging"), false);
  assert.equal(supports(future, "snapshot"), true);
  const wide = stateOf("2.0.0", "10000000" + ALL_BITS.padStart(8, "0"));
  for (const cap of CAPS) assert.equal(supports(wide, cap.key), true, cap.key);
  /* 能力位说没有，版本号再新也是没有。 */
  assert.equal(supports(stateOf("9.9.9", "0"), "payRules"), false);
  /* 能力位写坏了（不是十六进制）：当没有能力位，按版本号。 */
  const junk = stateOf("1.3.2", "zz");
  assert.equal(junk.bits, null);
  assert.equal(supports(junk, "snapshot"), true);
});

test("拿不到版本：还没收到时、等不到时、认不出时都按最老的 1.0.0 算", () => {
  for (const st of [FW_UNKNOWN, fwGiveUp(FW_UNKNOWN), fwState("x.y", "1FFF"), fwState("", "")]) {
    assert.equal(st.known, false);
    for (const cap of CAPS) assert.equal(supports(st, cap.key), compareVersion(MIN_FW, cap.since) >= 0, cap.key);
  }
  /* 能力位单独来了也不信：版本号认不出时整行都可疑。 */
  assert.equal(fwState("garbage", "1FFF").bits, null);
  /* 认出来以后 fwGiveUp 不改它。 */
  const known = stateOf("1.3.2");
  assert.equal(fwGiveUp(known), known);
});

test("固件和 App 的关系：还没收到、读不到、太老、旧、同版、新，各有一句提示", () => {
  assert.equal(fwRelation(FW_UNKNOWN), "pending");
  assert.equal(compatNotice(FW_UNKNOWN), null);
  assert.equal(fwRelation(fwGiveUp(FW_UNKNOWN)), "unknown");
  assert.deepEqual(compatNotice(fwGiveUp(FW_UNKNOWN)), { text: COMPAT_TEXTS.unknown, vars: { fw: "—", app: APP_VERSION, min: MIN_FW }, warn: true });
  assert.equal(fwRelation(stateOf("0.9.0")), "tooOld");
  assert.equal(compatNotice(stateOf("0.9.0")).text, COMPAT_TEXTS.tooOld);
  assert.equal(fwRelation(stateOf("1.2.0")), "older");
  assert.deepEqual(compatNotice(stateOf("1.2.0")), { text: COMPAT_TEXTS.older, vars: { fw: "1.2.0", app: APP_VERSION, min: MIN_FW }, warn: false });
  assert.equal(fwRelation(stateOf(APP_VERSION, ALL_BITS)), "same");
  assert.equal(compatNotice(stateOf(APP_VERSION, ALL_BITS)), null);
  assert.equal(fwRelation(stateOf("1.4.0", ALL_BITS)), "newer");
  assert.equal(compatNotice(stateOf("1.4.0", ALL_BITS)).text, COMPAT_TEXTS.newer);
  /* 传进来的 App 版本优先（测试用）。 */
  assert.equal(fwRelation(stateOf("1.3.4"), "1.3.3"), "newer");
});

test("缺某项时的提示：写明固件版本和要升级到哪一版；读不到版本时换一句", () => {
  assert.equal(lackNote(stateOf("1.3.2"), "payRules"), null);
  assert.deepEqual(lackNote(stateOf("1.0.0"), "payRules"), { text: COMPAT_TEXTS.lack, vars: { fw: "1.0.0", need: "1.1.0" } });
  assert.deepEqual(lackNote(stateOf("1.2.0"), "ocppWss", "wss"), { text: COMPAT_TEXTS.wss, vars: { fw: "1.2.0", need: "1.3.0" } });
  assert.deepEqual(lackNote(stateOf("1.3.0"), "payHold", "hold", { s: 300 }),
    { text: COMPAT_TEXTS.hold, vars: { fw: "1.3.0", need: "1.3.2", s: 300 } });
  assert.deepEqual(lackNote(fwGiveUp(FW_UNKNOWN), "advDiag"), { text: COMPAT_TEXTS.lackUnknown, vars: null });
  assert.equal(translate("en", COMPAT_TEXTS.lack, { fw: "1.0.0", need: "1.1.0" }),
    "Charger firmware 1.0.0 does not have this feature. Update to 1.1.0 or later");
});

/* 老固件的 PAYSET：ble_arg_u32(…, 0) 要求门槛后面就是行尾，多一个参数整条 FAIL
 * （87bbc44 的 wb2.c）；1.3.2 起认第 3 个参数。 */
function pilePayset(version, command) {
  const part = command.split("\t");
  if (part[0] !== "PAYSET") return null;
  const max = compareVersion(version, "1.3.2") >= 0 ? 4 : 3;
  return part.length >= 3 && part.length <= max && part.slice(1).every((p) => /^\d+$/.test(p))
    ? "ACK PAYSET OK" : "ACK PAYSET FAIL";
}

test("充电规则：老固件只发两个参数（带了持续秒数会 FAIL），读回核对不比持续秒数", () => {
  const body = { ...blankBody(), pay: { model: 2, fullW: 25, hold: 120 } };
  for (const version of ["1.1.0", "1.2.0", "1.3.0", "1.3.2", "1.3.3", "1.3.4"]) {
    const st = stateOf(version);
    const can = (key) => supports(st, key);
    const plan = writePlan("pay", body, can);
    const cmd = plan.list[0].command;
    assert.equal(cmd, can("payHold") ? "PAYSET\t2\t25\t120" : "PAYSET\t2\t25", version);
    assert.equal(pilePayset(version, cmd), "ACK PAYSET OK", version);
    /* 不看能力就发三个参数：1.3.2 以前的固件不接受，原来的 App 在这里一直失败。 */
    assert.equal(pilePayset(version, "PAYSET\t2\t25\t120"), can("payHold") ? "ACK PAYSET OK" : "ACK PAYSET FAIL", version);
    /* 老固件的持续秒数固定 300：读回来是 300，不算不一样。 */
    const got = { pay: { model: 2, fullW: 25, hold: can("payHold") ? 120 : 300 } };
    assert.equal(sameSection("pay", body, got, can), true, version);
  }
  /* 不传 can（老的调用法）：照旧当什么都有。 */
  assert.equal(writePlan("pay", body).list[0].command, "PAYSET\t2\t25\t120");
  assert.equal(sameSection("pay", body, { pay: { model: 2, fullW: 25, hold: 300 } }), false);
});

test("OCPP 地址：1.3.0 以前的固件不下发 wss://，说清楚原因；ws:// 照常", () => {
  const body = { ...blankBody(), ocpp: { on: true, url: "wss://csms.example/ocpp/EVC0001" } };
  for (const version of OLD) {
    const can = (key) => supports(stateOf(version), key);
    const plan = writePlan("ocpp", body, can);
    if (can("ocppWss")) {
      assert.equal(plan.list[0].command, "OCPPSET\t" + body.ocpp.url, version);
    } else {
      assert.deepEqual(plan, { error: "wss", lack: "ocppWss" }, version);
      assert.equal(lackNote(stateOf(version), plan.lack, plan.error).text, COMPAT_TEXTS.wss);
    }
    const ws = writePlan("ocpp", { ...body, ocpp: { on: true, url: "ws://csms.example/ocpp/EVC0001" } }, can);
    assert.ok(ws.list, version);
  }
});

test("一键配置：老固件没有的整项跳过（充电规则 1.1.0、并充 1.2.0），写明要升级到哪一版", () => {
  for (const section of SECTIONS) {
    for (const version of OLD) {
      const st = stateOf(version);
      const need = SECTION_NEEDS[section.key];
      const lack = sectionLack(st, section.key);
      if (!need || supports(st, need)) {
        assert.equal(lack, null, section.key + " @ " + version);
      } else {
        assert.deepEqual(lack, { text: COMPAT_TEXTS.skip, vars: { fw: version, need: capSince(need) } }, section.key + " @ " + version);
      }
    }
  }
  assert.ok(sectionLack(stateOf("1.0.0"), "pay"));
  assert.ok(sectionLack(stateOf("1.1.0"), "par"));
  assert.equal(sectionLack(stateOf("1.1.0"), "pay"), null);
  /* 跳过的项不发命令：PAYGET、PARGET 是要看能力的命令。 */
  assert.equal(SECTION_NEEDS.pay, GATED.PAYGET);
  assert.equal(SECTION_NEEDS.par, GATED.PARGET);
});

test("首页：老固件一条 SNAPGET 都不发；1.3.2 起照常快照；版本到之前先按老的", async () => {
  for (const version of [...OLD, "1.3.4"]) {
    let st = FW_UNKNOWN;
    const sent = [];
    const queue = createQueue({ send: (c) => sent.push(c), setTimer: (fn) => { fn(); return 1; }, clearTimer() {} });
    const poller = createSnapPoller({ ask: (c, a, ms, o) => queue.ask(c, a, ms, o), now: () => 0, supported: () => supports(st, "snapshot") });
    assert.equal(poller.mode, "off", version);
    assert.equal(poller.due(10000), false, version);
    st = stateOf(version, version === "1.3.4" ? ALL_BITS : undefined);
    assert.equal(poller.mode, COMMANDS[version] && !COMMANDS[version].includes("SNAPGET\t") ? "off" : "on", version);
    if (poller.due(10000)) await poller.poll();
    assert.equal(sent.some((c) => c.indexOf("SNAPGET\t") === 0), supports(st, "snapshot"), version);
  }
});

/* ------------------------------------------------------------------ 三、App.vue 的接法、字符串 */

test("App.vue：连上先拿固件版本，换桩、断开清掉；别处只问 can()，不自己比版本号", () => {
  const script = appVue.slice(appVue.indexOf("<script setup>"));
  assert.match(script, /fwInfo\.value = fwState\(got\.fw, got\.caps\);/);
  assert.match(script, /async function enterHome\(\) \{\s*await identifyFirmware\(\);/);
  assert.match(script, /await ask\("STATUS", \(line\) => parseSys\(line\) !== null, 1500\);/);
  assert.match(script, /fwInfo\.value = fwGiveUp\(fwInfo\.value\);/);
  assert.ok((script.match(/fwInfo\.value = FW_UNKNOWN;/g) || []).length >= 3, "断开、换桩时要清掉");
  /* 能力名都在表里；要看能力的命令都有人问。 */
  const asked = new Set([...script.matchAll(/can\("([a-zA-Z]+)"\)/g)].map((m) => m[1]));
  for (const key of asked) assert.ok(CAPS.some((cap) => cap.key === key), key);
  for (const key of new Set(Object.values(GATED))) assert.ok(asked.has(key), "App.vue 没有问 " + key);
  for (const key of ["ocppWss", "payHold", "wscanAnytime"]) {
    assert.ok(asked.has(key) || script.includes('"' + key + '"'), key);
  }
  /* 不在 fw-compat.js 以外比版本号、猜固件新旧。 */
  const src = resolve(root, "AC06/tools/ble-finder/ui/src/m01");
  for (const file of readdirSync(src)) {
    if (file === "fw-compat.js" || !/\.(js|vue)$/.test(file)) continue;
    const text = readFileSync(resolve(src, file), "utf8");
    assert.ok(!/\bversionParts\b|\bcompareVersion\b|\bparseVersion\b/.test(text), file + " 自己比版本号");
    assert.ok(!/SNAP_PROBE_TRIES|SNAP_REPROBE_MS|notePush/.test(text), file + " 还在靠没回猜老固件");
  }
  assert.match(script, /createSnapPoller\(\{ ask, supported: \(\) => can\("snapshot"\) \}\)/);
  /* 首页和菜单顶上都有那一行提示。 */
  assert.equal((appVue.match(/<p v-if="compatShown" class="note" :class="\{ warn: compatShown\.warn \}">\{\{ t\(compatShown\) \}\}<\/p>/g) || []).length, 2);
});

test("提示的 12 种语言：每一行 13 项，占位符原样，和 COMPAT_TEXTS 一一对应", () => {
  assert.deepEqual(COMPAT_LANGS.slice().sort(), languages.map((l) => l.id).filter((id) => id !== "zh").sort());
  const keys = new Set(COMPAT_ROWS.map((row) => row[0]));
  assert.deepEqual([...keys].sort(), Object.values(COMPAT_TEXTS).sort());
  for (const row of COMPAT_ROWS) {
    assert.equal(row.length, 13, row[0]);
    const holders = (row[0].match(/\{[a-z]+\}/g) || []).sort();
    row.slice(1).forEach((text, index) => {
      const lang = COMPAT_LANGS[index];
      assert.ok(text && text === text.trim(), lang + ": " + row[0]);
      assert.deepEqual((text.match(/\{[a-z]+\}/g) || []).sort(), holders, lang + " 的占位符: " + row[0]);
      if (lang !== "ja") assert.ok(!/[一-鿿]/.test(text), lang + " 里有中文: " + text);
      (row[0].match(/\d+/g) || []).forEach((n) => assert.ok(text.includes(n), lang + " 少了 " + n));
      assert.equal(compatPacks[lang][row[0]], text);
      assert.ok(hasKey(lang, row[0]), lang);
      assert.equal(translate(lang, row[0]), text);
    });
    assert.ok(row.slice(2).filter((text) => text === row[1]).length <= 1, "照抄英文: " + row[0]);
  }
  assert.equal(translate("zh", COMPAT_TEXTS.older, { fw: "1.2.0", app: "1.3.4" }),
    "充电桩固件 1.2.0 比 App 1.3.4 旧，有些功能用不了。可以在“固件升级”里升级");
});
