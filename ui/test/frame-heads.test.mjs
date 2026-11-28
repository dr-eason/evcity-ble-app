/* 手机那一层（Android MainActivity.java、iOS FrameParser.swift / BleLink.swift / evc-shim.js）：
 * 两种桩的行首表分开、按类型选，不合成一张；STATUS 两种应答都认；连上后认类型发 {t:"kind"}；
 * M01 App 带过来的两处修复（0x00 换回逗号、通知缓冲先拷一份）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FRAME_HEADS as M01_HEADS, FRAME_HEADS_AC06, AC06_KNOWN, KNOWN_PREFIXES as M01_KNOWN, javaSource as java, splitFrames, atModeStream } from "./helpers/m01-phone-layer.mjs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const swiftParser = read("ios/Core/Sources/EVCCore/FrameParser.swift");
const swiftLink = read("ios/App/Sources/BleLink.swift");
const swiftBridge = read("ios/Core/Sources/EVCCore/Bridge.swift");
const shim = read("ios/App/Resources/Bridge/evc-shim.js");

/* AC06 2.8.1 的那张表（1aa5371），一项不能少、顺序不变。 */
const AC06_2_8_1 = ["STAT ", "WCFG ", "FLT ", "LIVE ", "ACK ", "AP ", "APDONE", "OCPP ", "CFG ", "IMAX ", "SCHED ",
  "ORD ", "ORDDONE", "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "OCFW "];
const M01_1_3_6 = ["WCFG ", "FLT ", "ACK ", "AP ", "APDONE", "OCPP ", "CFG ", "ORDDONE", "TEL ", "WIFISW ",
  "OCPPSW ", "NETSTOP ", "OCFW "];

test("Java：两张行首表分开，AC06 的和 2.8.1 一样，M01 的和 M01 App 一样", () => {
  assert.deepEqual(FRAME_HEADS_AC06, AC06_2_8_1);
  assert.deepEqual(M01_HEADS, M01_1_3_6);
  /* AC06 才有的行首不在 M01 的表里：放进去会把 M01 的行从中间切开。 */
  for (const head of ["STAT ", "ORD ", "PLUG ", "LIVE ", "IMAX ", "SCHED ", "QR ", "PHASE "]) {
    assert.ok(!M01_HEADS.includes(head), head);
    assert.ok(!M01_KNOWN.includes(head), head);
  }
  assert.ok(AC06_KNOWN.prefixes.includes("STAT ") && AC06_KNOWN.prefixes.includes("PHASE "));
  /* 按 profile 选表，没有一张合起来的。 */
  assert.match(java, /return PROFILE_M01\.equals\(profile\) \? FRAME_HEADS_M01 : FRAME_HEADS_AC06;/);
  assert.ok(!/\bFRAME_HEADS\b(?!_)/.test(java.replace(/\/\*[\s\S]*?\*\//g, "")), "不再有不分类型的 FRAME_HEADS");
  assert.equal((java.match(/for \(byte\[\] head : frameHeads\(\)\)/g) || []).length, 2);
  assert.match(java, /!knownLine\(line, profile\)/);
});

test("用 M01 的表切 M01 的行：订单行里的 ORD、PLUG 字样不被切开；用 AC06 的表就会切错", () => {
  /* 用户号是平台给的任意文字，可以带 "ORD "、"PLUG "、"STAT " 这样的字样。 */
  const line = "ACK ORD\t3\t2\t1795000000\t1795003600\t1200\t800\tNONE\t3600\tCARD\tSTAT ORD PLUG 7\t-";
  assert.deepEqual(splitFrames(line + "\r\n"), [line]);
  assert.deepEqual(splitFrames(atModeStream([line, "ACK SYS\t1.3.6\t10"])), [line, "ACK SYS\t1.3.6\t10"]);
  /* 反过来证明为什么不能合表：带 "ORD " 的行首，这一行会在中间断开。 */
  for (const head of ["ORD ", "STAT "]) {
    assert.ok(line.indexOf(head, 1) > 0 && AC06_2_8_1.includes(head), head);
  }
});

test("Java：先认类型再过滤；STATUS 两种应答都算收到；setProfile、{t:\"kind\"}", () => {
  const accept = java.slice(java.indexOf("private void acceptFrame("), java.indexOf("private static boolean printableLine("));
  assert.ok(accept.indexOf("kindOfStatus(line)") > 0);
  assert.ok(accept.indexOf("kindOfStatus(line)") < accept.indexOf("knownLine(line, profile)"), "过滤之前认类型");
  assert.match(accept, /statSeen = true;/);
  assert.match(accept, /profile = kind;/);
  assert.match(accept, /emitKind\(kind\);/);
  const kind = java.slice(java.indexOf("static String kindOfStatus("), java.indexOf("private final byte[] rxBuf"));
  assert.match(kind, /line\.startsWith\("STAT "\)/);
  assert.match(kind, /line\.startsWith\("ACK SYS\\t"\)/);
  assert.match(java, /public void setProfile\(final String which\)/);
  assert.match(java, /obj\.put\("t", "kind"\);/);
  /* 扫描还是只看 EVC 开头：EVC_、EVCM_（M01 现在的名字）、EVCM（测试固件）都列出来。 */
  assert.match(java, /private static final String PREFIX = "EVC";/);
});

test("Java：M01 App 带过来的两处修复", () => {
  assert.match(java, /final byte\[\] copy = Arrays\.copyOf\(value, value\.length\);/);
  assert.match(java, /appendPending\(copy\);/);
  const accept = java.slice(java.indexOf("private void acceptFrame("), java.indexOf("private static boolean printableLine("));
  assert.match(accept, /if \(raw\[i\] == 0\) \{\s*raw\[i\] = ',';/);
  assert.ok(accept.indexOf("raw[i] = ','") < accept.indexOf("new String(raw"));
});

test("iOS：FrameParser 的两张表和 Java 一样；按 profile 选；认类型、0x00 换回逗号；BleLink 发 kind；shim 有 setProfile", () => {
  const list = (name) => {
    const at = swiftParser.indexOf("public static let " + name + ": [[UInt8]] = [");
    const body = swiftParser.slice(at, swiftParser.indexOf("].map", at));
    return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(list("frameHeadsAC06"), AC06_2_8_1);
  assert.deepEqual(list("frameHeadsM01"), M01_1_3_6);
  assert.match(swiftParser, /return profile == \.m01 \? Self\.frameHeadsM01 : Self\.frameHeadsAC06/);
  assert.equal((swiftParser.match(/for head in heads \{/g) || []).length, 2);
  assert.match(swiftParser, /line\.hasPrefix\("ACK SYS\\t"\)/);
  assert.match(swiftParser, /raw\[i\] = 0x2C/);
  const m01Known = swiftParser.slice(swiftParser.indexOf("func knownLineM01("), swiftParser.indexOf("func knownLineAC06("));
  assert.ok(!m01Known.includes('"STAT "') && !m01Known.includes('"ORD "'));
  assert.match(swiftLink, /if let found = parser\.takeKind\(\) \{\s*statSeen = true\s*emit\(\.kind\(found\.rawValue\)\)/);
  assert.match(swiftLink, /func setProfile\(_ which: ChargerKind\)/);
  assert.match(swiftBridge, /case "setProfile":/);
  assert.match(swiftBridge, /return \["t": "kind", "s": which\]/);
  assert.match(shim, /setProfile: function \(which\) \{ ble\("setProfile"/);
});
