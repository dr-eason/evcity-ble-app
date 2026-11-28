/* M01 10 路：ACK SYS / ACK PORTS / ACK PORT / ACK PLIM / ACK ORD 的解析和显示的主机测试：
 *
 *     node --test APP/ui/test/
 *
 * 样例行取自 文档/04-协议/M01蓝牙协议.md；字段顺序再和固件 app/src/wb2.c 里的格式串、
 * app/src/charge_control.c 里的名字表逐项核对。每一行还要能原样通过手机蓝牙层
 * （helpers/phone-layer.mjs，行首表取自 MainActivity.java）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARALLEL_MODES, fmtMoney, parCommand, parallelLabel, parallelPorts, parsePar, parseParSet, parsePay, parsePaySet,
  parsePortsX, payCommand, payModelLabel,
  FAULT_NAMES, ORDER_KEEP, ORDER_MAX, PORT_COUNT, PORTSEL_SECONDS, STATUS_LETTERS, faultLabel, faultName, fmtDuration,
  fmtIsoClock, fmtKwh, fmtUnix, fmtWatts, orderCollector, orderPayRows, orderReasonLabel, ordersCommand, parseFlt, parseOrder, parseOrderSum, parsePlim,
  parsePort, parsePortAck, parsePorts, parseSys, pickSsid, plimCommand, plimValue, portAckText, portBusy,
  portStatus, portsSummary, sameSsid, selectLeft, startLabel, stopLabel,
} from "../src/m01/ports.js";
import { hasKey, languages, translate } from "../src/m01/i18n.js";
import { FRAME_HEADS, KNOWN_EXACT, KNOWN_PREFIXES, phoneKeeps, splitFrames } from "./helpers/m01-phone-layer.mjs";
/* M01 仓库里的固件头文件和协议文档，拷了一份在 test/fixtures/m01/（见那里的 README.md）。 */
const fixture = (name) => readFileSync(new URL("./fixtures/m01/" + name, import.meta.url), "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(repo, path), "utf8");
const T = (text) => text.replace(/⇥/g, "\t");
const doc = fixture("M01蓝牙协议.md");

/* 协议文档里的样例行（⇥ 是制表符）。 */
const SYS_1 = T("ACK SYS⇥1.0.0⇥10⇥230.4⇥31⇥1⇥-62⇥UP⇥ON⇥2027-01-15T08:00:00Z⇥bench");
const SYS_2 = T("ACK SYS⇥1.0.0⇥10⇥-⇥-⇥0⇥-⇥DOWN⇥OFF⇥-⇥-");
const PORTS_1 = T("ACK PORTS⇥10⇥P,0,0,0;P,0,0,0;C,460,24,12;P,0,0,0;X,0,0,0;U,0,0,0;R,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0");
const PORT_C = T("ACK PORT⇥3⇥C⇥230.0⇥2.00⇥460⇥24⇥12⇥30024⇥800⇥NONE⇥0⇥BLE⇥-⇥0⇥0⇥0⇥0⇥0⇥0⇥0");
const PORT_P = T("ACK PORT⇥3⇥P⇥230.0⇥0.00⇥0⇥0⇥0⇥30040⇥400⇥OVERPOWER⇥16⇥BLE⇥-⇥0⇥0⇥0⇥0⇥0⇥0⇥0");
/* 离线刷卡（可退费）起的一路：刷进去 5 元，用掉 0.096 元，单价 1 元 / kWh；功率低，再过 180 秒充满自停。 */
const PORT_O = T("ACK PORT⇥4⇥C⇥230.0⇥0.02⇥4⇥96⇥752⇥40096⇥800⇥NONE⇥0⇥OFFCARD⇥A0000001⇥0⇥2⇥5000⇥96⇥4904⇥1000⇥180");
const PORTX_1 = T("ACK PORTX⇥10⇥0,-;0,-;200,-;2,490;0,-;0,-;0,-;0,-;0,-;0,-");
const PAY_1 = T("ACK PAY⇥3⇥2⇥25⇥1⇥100⇥120⇥A0A1A2A3A4A5A6A7A8A9AAABACADAEAF⇥10⇥3600");
const PAY_2 = T("ACK PAY⇥0⇥1⇥10⇥1⇥100⇥300⇥-⇥10⇥3600");
const PAR_1 = T("ACK PAR⇥2⇥5⇥2");
const PLIM_1 = T("ACK PLIM⇥10⇥50⇥2000⇥800,800,800,800,800,800,800,800,800,800");
const PLIM_2 = T("ACK PLIM⇥10⇥50⇥2000⇥800,1200,800,800,800,800,800,800,800,800");
const ORD_0 = T("ACK ORD⇥0⇥2⇥1795000061⇥0⇥8⇥460⇥NONE⇥4294967295⇥BLE⇥-⇥L3⇥0⇥0⇥0⇥0");
const ORD_1 = T("ACK ORD⇥1⇥9⇥1795000040⇥1795000048⇥14⇥950⇥OVERPOWER⇥8⇥APP⇥00A1B2C3⇥1001⇥0⇥0⇥0⇥0");
const ORD_2 = T("ACK ORD⇥2⇥4⇥1795000012⇥1795000032⇥40⇥460⇥BLE⇥20⇥BLE⇥-⇥L1⇥0⇥0⇥0⇥0");
/* 离线刷卡（可退费）的订单：刷进去 10 元，电费 3 元，充满自停，余额还没退。 */
const ORD_3 = T("ACK ORD⇥3⇥6⇥1795000000⇥1795011100⇥3000⇥1000⇥FULL⇥11100⇥OFFCARD⇥A0000003⇥L7⇥2⇥10000⇥3000⇥1");
/* 汇总行：一共 41 条订单，这一批从序号 0 起 4 条。翻页取到的两条：不退费的订单用完了；可退费的已经结清。 */
const ORDN_1 = T("ACK ORDN⇥41⇥0⇥4");
const ORDN_2 = T("ACK ORDN⇥41⇥32⇥9");
const ORD_32 = T("ACK ORD⇥32⇥5⇥1794990000⇥1794997200⇥2000⇥1010⇥NOMONEY⇥7200⇥OFFCARD⇥A0000001⇥L21⇥1⇥2000⇥2000⇥0");
const ORD_33 = T("ACK ORD⇥33⇥6⇥1794980000⇥1794983600⇥1000⇥1000⇥CARD⇥3600⇥OFFCARD⇥A0000003⇥L20⇥2⇥10000⇥1000⇥0");
const SAMPLES = [SYS_1, SYS_2, PORTS_1, PORTX_1, PORT_C, PORT_P, PORT_O, PLIM_1, PLIM_2, PAY_1, PAY_2, PAR_1,
  ORD_0, ORD_1, ORD_2, ORD_3, ORDN_1, ORDN_2, ORD_32, ORD_33];

test("样例行确实是协议文档里写的那几行", () => {
  for (const line of SAMPLES) {
    assert.ok(doc.includes(line.replace(/\t/g, "⇥")), line);
  }
});

/* C 的格式串 → 把每个 % 说明换成一个标记，用来数字段、对顺序。 */
function formatFields(fmt) {
  return fmt.replace(/\\t/g, "\t").split("\t");
}
function cString(source, start) {
  /* 从 start 起把相邻的 C 字符串字面量拼起来。 */
  let out = "";
  const re = /\s*"((?:[^"\\]|\\.)*)"/y;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(source)) !== null) out += m[1];
  return out;
}

test("手机蓝牙层：M01 的每一种行都原样到界面，不会被从中间切开", () => {
  const more = [T("ACK START⇥3⇥OK"), T("ACK START⇥0⇥PORT"), T("ACK STOP⇥0⇥IDLE"), T("ACK PORTSEL⇥3⇥OK"),
    T("ACK PLIMSET⇥2⇥RANGE"), T("ACK PORT⇥11⇥PORT"), "FLT NONE", "FLT NTC+UV", "ORDDONE", "CFG 253 207",
    T("ACK PORT⇥9⇥X⇥0.0⇥0.00⇥0⇥0⇥0⇥0⇥800⇥PORT_FAULT⇥8⇥CARD⇥00A1B2C3⇥8"),
    T("ACK ORD⇥5⇥10⇥0⇥0⇥0⇥0⇥POWER_LOSS⇥7⇥PANEL⇥-⇥L9"),
    T("ACK SYS⇥1.0.0⇥10⇥230.4⇥-5⇥1⇥-62⇥UP⇥BUSY⇥2027-01-15T08:00:00Z⇥shop_AP_5G")];
  for (const line of SAMPLES.concat(more)) assert.ok(phoneKeeps(line), line);
  /* AT 模式下行与行之间没有换行：一组状态连在一起收到，也切得开。 */
  const group = ["WCFG UP bench", "FLT NONE", SYS_1, PORTS_1];
  assert.deepEqual(splitFrames(group.join("")), group);
  assert.deepEqual(splitFrames(group.join("\r\n") + "\r\n"), group);
  assert.deepEqual(splitFrames(PORT_C + T("ACK START⇥3⇥OK") + PLIM_1), [PORT_C, T("ACK START⇥3⇥OK"), PLIM_1]);
  assert.deepEqual(splitFrames(ORD_0 + ORD_1 + ORD_2 + "ORDDONE"), [ORD_0, ORD_1, ORD_2, "ORDDONE"]);
  /* 最长的 ACK PORTS（232 个字符）也过得去。 */
  const longest = "ACK PORTS\t10\t" + Array(10).fill("C,99999,999999,999999").join(";");
  assert.equal(longest.length, 232);
  assert.ok(phoneKeeps(longest));
  assert.equal(parsePorts(longest).ports[9].wh, 999999);
});

test("手机蓝牙层的行首表：M01 没有的行首都去掉了，协议文档里的都在", () => {
  for (const gone of ["STAT ", "LIVE ", "IMAX ", "SCHED ", "ORD ", "QR ", "PHASE ", "PLUG ", "WPASS\t"]) {
    assert.ok(!FRAME_HEADS.includes(gone), "FRAME_HEADS 里还有 " + JSON.stringify(gone));
    assert.ok(!KNOWN_PREFIXES.includes(gone), "knownLine 里还有 " + JSON.stringify(gone));
  }
  assert.deepEqual(FRAME_HEADS.slice().sort(),
    ["ACK ", "AP ", "APDONE", "CFG ", "FLT ", "NETSTOP ", "OCFW ", "OCPP ", "OCPPSW ", "ORDDONE", "TEL ", "WCFG ", "WIFISW "]);
  assert.deepEqual(KNOWN_PREFIXES.slice().sort(),
    ["ACK ", "AP ", "CFG ", "FLT ", "NETSTOP ", "OCFW ", "OCPP ", "OCPPSW ", "TEL ", "WCFG ", "WIFISW "]);
  assert.deepEqual(KNOWN_EXACT.slice().sort(), ["APDONE", "ORDDONE"]);
  /* M01 不发的行到不了界面。 */
  for (const line of ["STAT CHARGING NONE 12 230 0 0", "LIVE 0.3 9.01 -55", "IMAX 32", "SCHED 1 480 0 8 0 0", "QR 1\thttp://x"]) {
    assert.deepEqual(splitFrames(line), [], line);
  }
});

test("ACK SYS：整桩", () => {
  assert.deepEqual(parseSys(SYS_1), {
    fw: "1.0.0", ports: 10, busV: 230.4, tempC: 31, mains: true, rssi: -62, wifi: "UP", ocpp: "ON",
    clock: "2027-01-15T08:00:00Z", ssid: "bench", caps: "",
  });
  assert.deepEqual(parseSys(SYS_2), {
    fw: "1.0.0", ports: 10, busV: null, tempC: null, mains: false, rssi: null, wifi: "DOWN", ocpp: "OFF",
    clock: "", ssid: "", caps: "",
  });
  /* 板温可以是负数。第 11 个字段（1.3.4 起）是能力位，原样交给 fw-compat.js 认；再往后的不看。 */
  const cold = parseSys(T("ACK SYS⇥1.2.3⇥10⇥229.9⇥-12⇥1⇥-80⇥JOINING⇥BUSY⇥-⇥my_wifi⇥extra⇥1"));
  assert.equal(cold.tempC, -12);
  assert.equal(cold.fw, "1.2.3");
  assert.equal(cold.ssid, "my_wifi");
  assert.equal(cold.wifi, "JOINING");
  assert.equal(cold.caps, "extra");
  assert.equal(parseSys(T("ACK SYS⇥1.3.4⇥10⇥229.9⇥-12⇥1⇥-80⇥JOINING⇥BUSY⇥-⇥my_wifi⇥1FFF")).caps, "1FFF");
  /* 不是这一行、字段不够、版本不像版本：不认。 */
  for (const bad of [PORTS_1, "ACK SYS", T("ACK SYS⇥1.0.0⇥10⇥230.4"), T("ACK SYS⇥x⇥10⇥230.4⇥31⇥1⇥-62⇥UP⇥ON⇥-⇥-"),
    T("ACK SYSX⇥1.0.0⇥10⇥230.4⇥31⇥1⇥-62⇥UP⇥ON⇥-⇥-"), "ACK SYS 1.0.0 10 230.4 31 1 -62 UP ON - -", null, 5]) {
    assert.equal(parseSys(bad), null, String(bad));
  }
});

test("热点名：ACK SYS 里空格是下划线；和 WCFG 的对得上就用 WCFG 的原样", () => {
  assert.equal(pickSsid("shop_5G", "shop 5G"), "shop 5G");
  assert.equal(pickSsid("TP-LINK_5G", "TP-LINK_5G"), "TP-LINK_5G");
  /* WCFG 被蓝牙层从中间切开了（名字里有 "AP "），或者 4G 开着没有 WCFG：用 ACK SYS 的。 */
  assert.equal(pickSsid("shop_AP_5G", "shop"), "shop_AP_5G");
  assert.equal(pickSsid("bench", ""), "bench");
  assert.equal(pickSsid("", ""), "");
  assert.equal(sameSsid("shop 5G", "shop_5G"), true);
  assert.equal(sameSsid("shop 5G", "shop 6G"), false);
  /* 反例：带空格的热点名在 WCFG 里确实会被切开。 */
  assert.deepEqual(splitFrames("WCFG UP shop AP 5G"), ["WCFG UP shop", "AP 5G"]);
});

test("ACK PORTS：10 路概况", () => {
  const got = parsePorts(PORTS_1);
  assert.equal(got.count, 10);
  assert.equal(got.ports.length, 10);
  assert.deepEqual(got.ports[2], { port: 3, s: "C", w: 460, wh: 24, sec: 12 });
  assert.deepEqual(got.ports.map((item) => item.s).join(""), "PPCPXURPPP");
  assert.deepEqual(got.ports.map((item) => item.port), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(portsSummary(got.ports), { charging: 1, watts: 460, faulted: 1 });
  /* SuspendedEVSE：这一单还在，功率是 0。 */
  const susp = parsePorts(PORTS_1.replace("C,460,24,12", "S,0,24,95"));
  assert.deepEqual(susp.ports[2], { port: 3, s: "S", w: 0, wh: 24, sec: 95 });
  /* 组数不够、数字坏了、不是这一行：整行不要，界面保持上一秒的。 */
  for (const bad of [T("ACK PORTS⇥10⇥P,0,0,0;P,0,0,0"), PORTS_1.replace("C,460,24,12", "C,460,24"),
    PORTS_1.replace("C,460", "C,4x0"), PORTS_1.replace("X,0,0,0", "x,0,0,0"), T("ACK PORTS⇥0⇥"), PORT_C, SYS_1, "ACK PORTS", null]) {
    assert.equal(parsePorts(bad), null, String(bad));
  }
  /* ACK PORT 和 ACK PORTS 互不串。 */
  assert.equal(parsePort(PORTS_1), null);
  assert.equal(parsePorts(PORT_C), null);
});

test("状态字母：7 种状态的名字、说明、颜色", () => {
  assert.equal(PORT_COUNT, 10);
  assert.deepEqual(STATUS_LETTERS, ["P", "C", "S", "F", "R", "U", "X"]);
  assert.deepEqual(portStatus("P"), { letter: "P", name: "Preparing", label: "空闲", kind: "idle" });
  assert.deepEqual(portStatus("C"), { letter: "C", name: "Charging", label: "充电中", kind: "on" });
  assert.deepEqual(portStatus("S"), { letter: "S", name: "SuspendedEVSE", label: "暂停输出", kind: "hold" });
  assert.deepEqual(portStatus("F"), { letter: "F", name: "Finishing", label: "结束中", kind: "busy" });
  assert.deepEqual(portStatus("R"), { letter: "R", name: "Reserved", label: "已预约", kind: "hold" });
  assert.deepEqual(portStatus("U"), { letter: "U", name: "Unavailable", label: "停用", kind: "off" });
  assert.deepEqual(portStatus("X"), { letter: "X", name: "Faulted", label: "故障", kind: "bad" });
  assert.deepEqual(portStatus("?"), { letter: "?", name: "Unknown", label: "未知", kind: "off" });
  assert.equal(portBusy("C"), true);
  assert.equal(portBusy("S"), true);
  for (const letter of ["P", "F", "R", "U", "X", "", undefined]) assert.equal(portBusy(letter), false);
  /* 没有“已插枪”“待机”这些状态（桩不知道有没有插车）。 */
  for (const letter of STATUS_LETTERS) assert.ok(!/插枪|待机|车辆/.test(portStatus(letter).label));
});

test("ACK PORT：单路详情", () => {
  assert.deepEqual(parsePort(PORT_C), {
    port: 3, s: "C", v: 230, a: 2, w: 460, wh: 24, sec: 12, meterWh: 30024, limitW: 800,
    lastStop: "NONE", lastFault: 0, source: "BLE", user: "", fault: 0,
    payModel: 0, loaded: 0, cost: 0, balance: 0, rate: 0, fullLeft: 0,
  });
  /* 离线刷卡起的一路：收费模型、刷进去的钱、已用、余额、单价（毫元），充满自停的倒计时。 */
  const paid = parsePort(PORT_O);
  assert.deepEqual([paid.payModel, paid.loaded, paid.cost, paid.balance, paid.rate, paid.fullLeft],
    [2, 5000, 96, 4904, 1000, 180]);
  assert.equal(startLabel(paid.source), "离线刷卡");
  assert.equal(paid.user, "A0000001");
  assert.equal(fmtMoney(paid.balance), "4.90");
  assert.equal(payModelLabel(paid.payModel), "可退费");
  assert.equal(payModelLabel(1), "不退费");
  assert.equal(payModelLabel(0), "");
  /* 1.0.0 的桩没有后 6 个字段：照认，按 0。 */
  const old = parsePort(T("ACK PORT⇥3⇥C⇥230.0⇥2.00⇥460⇥24⇥12⇥30024⇥800⇥NONE⇥0⇥BLE⇥-⇥0"));
  assert.equal(old.w, 460);
  assert.equal(old.payModel, 0);
  assert.equal(parsePort(PORT_O.replace("\t5000\t", "\tx\t")), null);
  const idle = parsePort(PORT_P);
  assert.equal(idle.s, "P");
  assert.equal(idle.limitW, 400);
  assert.equal(idle.lastStop, "OVERPOWER");
  assert.equal(idle.lastFault, 16);
  assert.equal(faultLabel(idle.lastFault), "超过功率上限");
  assert.equal(stopLabel(idle.lastStop), "超过功率上限");
  /* 有用户、现在有故障。 */
  const bad = parsePort(T("ACK PORT⇥9⇥X⇥0.0⇥0.00⇥0⇥0⇥0⇥123456789⇥800⇥PORT_FAULT⇥8⇥CARD⇥00A1B2C3⇥8"));
  assert.equal(bad.user, "00A1B2C3");
  assert.equal(bad.fault, 8);
  assert.equal(bad.meterWh, 123456789);
  assert.equal(faultLabel(bad.fault), "计量故障");
  assert.equal(startLabel(bad.source), "平台刷卡");
  /* 端口号不对：只有 3 个字段。 */
  assert.deepEqual(parsePort(T("ACK PORT⇥11⇥PORT")), { port: 11, error: "PORT" });
  assert.deepEqual(parsePort(T("ACK PORT⇥0⇥PORT")), { port: 0, error: "PORT" });
  /* 行尾多出来的字段不看；字段不够、数字坏了不认。 */
  assert.equal(parsePort(PORT_C + "\t7\tx").w, 460);
  for (const line of [T("ACK PORT⇥3⇥C⇥230.0⇥2.00⇥460"), PORT_C.replace("230.0", "abc"), PORT_C.replace("\t", " "),
    T("ACK PORT⇥x⇥PORT"), "ACK PORT", ORD_0, null]) {
    assert.equal(parsePort(line), null, String(line));
  }
});

test("ACK PORTX：每路的电流和离线刷卡的余额", () => {
  const got = parsePortsX(PORTX_1);
  assert.equal(got.count, 10);
  assert.deepEqual(got.ports[2], { port: 3, a: 2, bal: null });
  assert.deepEqual(got.ports[3], { port: 4, a: 0.02, bal: 4900 });     /* 490 分 = 4.90 */
  assert.equal(fmtMoney(got.ports[3].bal), "4.90");
  /* 并充时端口少于 10。 */
  assert.equal(parsePortsX(T("ACK PORTX⇥5⇥0,-;0,-;0,-;0,-;400,-")).ports.length, 5);
  for (const bad of [T("ACK PORTX⇥10⇥0,-;0,-"), T("ACK PORTX⇥3⇥0,-;x,-;0,-"), T("ACK PORTX⇥3⇥0,-;0,y;0,-"), PORTS_1, null]) {
    assert.equal(parsePortsX(bad), null, String(bad));
  }
  /* 不会被当成 ACK PORTS 或 ACK PORT。 */
  assert.equal(parsePorts(PORTX_1), null);
  assert.equal(parsePort(PORTX_1), null);
  assert.equal(fmtMoney(0), "0.00");
  assert.equal(fmtMoney(12345), "12.35");
  assert.equal(fmtMoney(null), "0.00");
  assert.equal(fmtMoney("x"), "—");
});

test("ACK PAY / PAYSET：硬件开关、收费模型、充满门槛、绑定的运营商", () => {
  assert.deepEqual(parsePay(PAY_1), {
    offline: true, net: true, model: 2, fullW: 25, min: 1, max: 100, hold: 120,
    oper: "A0A1A2A3A4A5A6A7A8A9AAABACADAEAF", holdMin: 10, holdMax: 3600,
  });
  const old = parsePay(T("ACK PAY⇥3⇥2⇥25⇥1⇥100⇥300⇥A0A1A2A3A4A5A6A7A8A9AAABACADAEAF"));
  assert.equal(old.hold, 300);
  assert.equal(old.holdMin, 10);
  assert.equal(old.holdMax, 3600);
  const fresh = parsePay(PAY_2);
  assert.deepEqual([fresh.offline, fresh.net, fresh.model, fresh.fullW, fresh.oper], [false, false, 1, 10, ""]);
  assert.equal(parsePay(T("ACK PAY⇥1⇥1⇥10⇥1⇥100⇥300⇥-")).net, true);
  assert.equal(parsePay(T("ACK PAY⇥1⇥1⇥10⇥1⇥100⇥300⇥-")).offline, false);
  assert.equal(parsePay(T("ACK PAY⇥2⇥1⇥10⇥1⇥100⇥300⇥-")).offline, true);
  assert.equal(parsePay(T("ACK PAY⇥2⇥1⇥10⇥1⇥100⇥300⇥-")).net, false);
  for (const bad of [T("ACK PAY⇥3⇥0⇥10⇥1⇥100⇥300⇥-"), T("ACK PAY⇥3⇥1⇥10⇥1⇥100⇥300⇥XYZ"), T("ACK PAY⇥3⇥1⇥10"),
    "ACK PAYSET OK", PAR_1, null]) {
    assert.equal(parsePay(bad), null, String(bad));
  }
  assert.equal(payCommand(2, 25), "PAYSET\t2\t25");
  assert.equal(payCommand(2, 25, 120), "PAYSET\t2\t25\t120");
  assert.equal(parsePaySet("ACK PAYSET OK"), true);
  assert.equal(parsePaySet("ACK PAYSET FAIL"), false);
  assert.equal(parsePaySet("ACK PARSET OK"), null);
  assert.equal(parsePaySet(PAY_1), null);
});

test("ACK PAR / PARSET：并充模式和端口数", () => {
  assert.deepEqual(parsePar(PAR_1), { mode: 2, ports: 5, saved: 2 });
  assert.deepEqual(parsePar(T("ACK PAR⇥1⇥10⇥3")), { mode: 1, ports: 10, saved: 3 });
  for (const bad of [T("ACK PAR⇥4⇥2⇥4"), T("ACK PAR⇥2⇥5"), T("ACK PAR⇥2⇥0⇥2"), "ACK PARSET OK", PAY_1, null]) {
    assert.equal(parsePar(bad), null, String(bad));
  }
  assert.deepEqual(PARALLEL_MODES, [1, 2, 3, 5]);
  assert.deepEqual(PARALLEL_MODES.map(parallelPorts), [10, 5, 3, 2]);
  assert.equal(parallelPorts(4), 10);
  assert.deepEqual(PARALLEL_MODES.map(parallelLabel),
    ["关闭：10 路独立", "两路并充：5 路", "三路并充：3 路，第 10 路不用", "五路并充：2 路"]);
  assert.equal(parCommand(3), "PARSET\t3");
  assert.equal(parseParSet("ACK PARSET OK"), "OK");
  assert.equal(parseParSet("ACK PARSET BUSY"), "BUSY");
  assert.equal(parseParSet("ACK PARSET FAIL"), "FAIL");
  assert.equal(parseParSet("ACK PAYSET OK"), null);
});

test("起停、选枪、功率上限的应答和结果码", () => {
  assert.deepEqual(parsePortAck(T("ACK START⇥3⇥OK")), { cmd: "START", port: 3, result: "OK" });
  assert.deepEqual(parsePortAck(T("ACK START⇥0⇥PORT")), { cmd: "START", port: 0, result: "PORT" });
  assert.deepEqual(parsePortAck(T("ACK STOP⇥0⇥IDLE")), { cmd: "STOP", port: 0, result: "IDLE" });
  assert.deepEqual(parsePortAck(T("ACK PORTSEL⇥7⇥OK")), { cmd: "PORTSEL", port: 7, result: "OK" });
  assert.deepEqual(parsePortAck(T("ACK PLIMSET⇥2⇥RANGE")), { cmd: "PLIMSET", port: 2, result: "RANGE" });
  for (const line of ["ACK START OK", "ACK STOP OK", PORT_C, PLIM_1, T("ACK PORT⇥11⇥PORT"), T("ACK STARTX⇥3⇥OK"),
    T("ACK START⇥3"), T("ACK START⇥x⇥OK"), "ACK CARDSET OK", "ACK OTASTART OK", null]) {
    assert.equal(parsePortAck(line), null, String(line));
  }
  const text = (cmd, line, range) => portAckText(cmd, line ? parsePortAck(T(line)) : null, range);
  /* START 的 7 种结果，每一种都有一句不一样的话。 */
  const start = ["OK", "BUSY", "FAULT", "UNAVAIL", "RESERVED", "LOCK", "PORT"].map((r) => text("START", "ACK START⇥3⇥" + r));
  assert.equal(new Set(start.map((item) => item.text)).size, 7);
  assert.deepEqual(start.map((item) => item.ok), [true, false, false, false, false, false, false]);
  assert.deepEqual(start[0], { ok: true, text: "第 {n} 路已启动", vars: { n: 3 } });
  assert.equal(start[1].text, "第 {n} 路正在充电或正在结束，不能启动");
  assert.equal(start[4].text, "第 {n} 路已被平台预约，蓝牙不能启动");
  assert.equal(start[6].text, "端口号不对");
  /* 没等到应答。 */
  assert.deepEqual(text("START", null), { ok: false, text: "充电桩没有应答", vars: null });
  /* STOP：一路和全部各是各的话。 */
  assert.deepEqual(text("STOP", "ACK STOP⇥3⇥OK"), { ok: true, text: "第 {n} 路已停止", vars: { n: 3 } });
  assert.deepEqual(text("STOP", "ACK STOP⇥0⇥OK"), { ok: true, text: "正在逐路停止全部端口，几秒内停完", vars: null });
  assert.equal(text("STOP", "ACK STOP⇥3⇥IDLE").text, "第 {n} 路没有在充电");
  assert.equal(text("STOP", "ACK STOP⇥0⇥IDLE").text, "没有正在充电的端口");
  assert.equal(text("STOP", "ACK STOP⇥11⇥PORT").text, "端口号不对");
  /* PORTSEL：选中和取消。 */
  assert.deepEqual(text("PORTSEL", "ACK PORTSEL⇥7⇥OK"), { ok: true, text: "已选中第 {n} 路，请在 30 秒内刷卡", vars: { n: 7 } });
  assert.equal(text("PORTSEL", "ACK PORTSEL⇥0⇥OK").text, "已取消选择");
  assert.equal(text("PORTSEL", "ACK PORTSEL⇥11⇥PORT").ok, false);
  /* PLIMSET：OK / RANGE / PORT / FLASH。 */
  assert.equal(text("PLIMSET", "ACK PLIMSET⇥2⇥OK").ok, true);
  assert.deepEqual(text("PLIMSET", "ACK PLIMSET⇥2⇥RANGE", { min: 50, max: 2000 }),
    { ok: false, text: "没有保存。功率上限只能是 {min} 到 {max} W", vars: { min: 50, max: 2000 } });
  assert.equal(text("PLIMSET", "ACK PLIMSET⇥2⇥RANGE").text, "数值不在这台桩允许的范围内");
  assert.equal(text("PLIMSET", "ACK PLIMSET⇥2⇥FLASH").text, "充电桩没有写进存储");
  assert.equal(text("PLIMSET", "ACK PLIMSET⇥11⇥PORT").text, "端口号不对");
  /* 以后固件加了新结果码：不当成功，也不抛异常。 */
  assert.deepEqual(text("START", "ACK START⇥3⇥LATER"), { ok: false, text: "充电桩没有接受", vars: null });
});

test("ACK PLIM：功率上限和可设范围", () => {
  assert.deepEqual(parsePlim(PLIM_1), { count: 10, min: 50, max: 2000, limits: Array(10).fill(800) });
  assert.equal(parsePlim(PLIM_2).limits[1], 1200);
  for (const bad of [T("ACK PLIM⇥10⇥50⇥2000⇥800,800"), T("ACK PLIM⇥10⇥2000⇥50⇥" + Array(10).fill(800).join(",")),
    T("ACK PLIM⇥10⇥50⇥2000⇥800,x,800,800,800,800,800,800,800,800"), T("ACK PLIMSET⇥2⇥OK"), "ACK PLIM", null]) {
    assert.equal(parsePlim(bad), null, String(bad));
  }
  /* 输入框里的字：范围以桩报的为准。 */
  assert.equal(plimValue("800", 50, 2000), 800);
  assert.equal(plimValue(" 50 ", 50, 2000), 50);
  assert.equal(plimValue("2000", 50, 2000), 2000);
  for (const bad of ["49", "2001", "", "8e2", "800.5", "-800", "abc", null, "123456"]) {
    assert.equal(plimValue(bad, 50, 2000), null, String(bad));
  }
  assert.equal(plimValue("2500", 50, 3000), 2500);
  assert.equal(plimCommand(2, 1200), "PLIMSET\t2\t1200");
  assert.equal(plimCommand(0, 600), "PLIMSET\t0\t600");
});

test("ACK ORD：订单", () => {
  assert.deepEqual(parseOrder(ORD_0), {
    index: 0, port: 2, start: 1795000061, end: 0, wh: 8, maxW: 460, reason: "NONE", running: true, dur: null,
    source: "BLE", user: "", id: "L3", payModel: 0, loaded: 0, cost: 0, refundDue: false,
  });
  assert.deepEqual(parseOrder(ORD_1), {
    index: 1, port: 9, start: 1795000040, end: 1795000048, wh: 14, maxW: 950, reason: "OVERPOWER", running: false,
    dur: 8, source: "APP", user: "00A1B2C3", id: "1001", payModel: 0, loaded: 0, cost: 0, refundDue: false,
  });
  /* 离线刷卡的订单：充满自停，余额待退。 */
  const paid = parseOrder(ORD_3);
  assert.deepEqual([paid.payModel, paid.loaded, paid.cost, paid.refundDue], [2, 10000, 3000, true]);
  assert.equal(orderReasonLabel(paid.reason), "充满自停");
  assert.equal(orderReasonLabel("NOMONEY"), "余额用完");
  assert.equal(startLabel(paid.source), "离线刷卡");
  /* 1.0.0 的桩没有后 4 个字段。 */
  assert.equal(parseOrder(T("ACK ORD⇥2⇥4⇥1795000012⇥1795000032⇥40⇥460⇥BLE⇥20⇥BLE⇥-⇥L1")).payModel, 0);
  assert.equal(parseOrder(ORD_2).reason, "BLE");
  assert.equal(parseOrder(ORD_2).dur, 20);
  /* 第 7 个字段：故障名或停止原因名。 */
  assert.equal(orderReasonLabel("OVERPOWER"), "超过功率上限");
  assert.equal(orderReasonLabel("BLE"), "蓝牙停止");
  assert.equal(orderReasonLabel("WELDED"), "继电器粘连");
  assert.equal(orderReasonLabel("POWER_LOSS"), "掉电停止");
  assert.equal(orderReasonLabel("NONE"), "");
  /* 不认识的故障名照名字显示。 */
  assert.equal(orderReasonLabel("XYZ"), "XYZ");
  for (const bad of [T("ACK ORD⇥0⇥2⇥1795000061"), ORD_1.replace("1795000040", "x"), "ORD 0 2 1795000061 0 8 460 NONE 1 BLE - L3",
    "ORDDONE", PORT_C, null]) {
    assert.equal(parseOrder(bad), null, String(bad));
  }
});

test("收订单：到 ORDDONE 为止；发到一半重发从头收；翻页接在后面", () => {
  const box = orderCollector();
  assert.equal(box.done(), false);
  for (const line of [ORD_0, ORD_1, ORD_2]) assert.equal(box.feed(line), true);
  assert.equal(box.done(), false);
  assert.equal(box.feed("ORDDONE"), true);
  assert.equal(box.done(), true);
  assert.deepEqual(box.list().map((item) => item.id), ["L3", "1001", "L1"]);
  /* 旧固件没有汇总行：不知道总数，没有"读取更多"。 */
  assert.equal(box.total(), null);
  assert.equal(box.more(), false);
  /* 别的行不收。 */
  assert.equal(box.feed(PORT_C), false);
  /* 没有订单：只有 ORDDONE。 */
  const empty = orderCollector();
  empty.feed(T("ACK ORDN⇥0⇥0⇥0"));
  empty.feed("ORDDONE");
  assert.deepEqual(empty.list(), []);
  assert.equal(empty.done(), true);
  assert.equal(empty.total(), 0);
  assert.equal(empty.more(), false);
  assert.equal(empty.next(), 0);
  /* 发到一半又发了一次 ORDGET：桩从序号 0 重发，不会出现重复的。 */
  const again = orderCollector();
  [ORD_0, ORD_1, ORD_0, ORD_1, ORD_2, "ORDDONE"].forEach((line) => again.feed(line));
  assert.deepEqual(again.list().map((item) => item.index), [0, 1, 2]);
  /* 读完再读一次：换成新的一批。 */
  again.feed(ORD_0.replace("L3", "L4"));
  assert.deepEqual(again.list().map((item) => item.id), ["L4"]);
  assert.equal(again.done(), false);
  /* 第一批 32 条，桩说一共 41 条：还有，下一页从 32 开始。 */
  const many = orderCollector();
  const ord = (i) => T("ACK ORD⇥" + i + "⇥1⇥1795000000⇥1795000010⇥1⇥100⇥BLE⇥10⇥BLE⇥-⇥L" + i);
  for (let i = 0; i < 32; i++) many.feed(ord(i));
  assert.equal(many.more(), false);                   /* 这一批还没发完 */
  many.feed(T("ACK ORDN⇥41⇥0⇥32"));
  many.feed("ORDDONE");
  assert.equal(ORDER_MAX, 32);
  assert.equal(many.list().length, 32);
  assert.equal(many.total(), 41);
  assert.equal(many.more(), true);
  assert.equal(many.next(), 32);
  assert.equal(ordersCommand(many.next()), "ORDGET\t32\t32");
  /* 翻页：接在后面，不清前面的。 */
  for (let i = 32; i < 41; i++) many.feed(ord(i));
  assert.equal(many.done(), false);
  many.feed(ORDN_2);
  many.feed("ORDDONE");
  assert.equal(many.list().length, 41);
  assert.deepEqual(many.list().map((item) => item.index), Array.from({ length: 41 }, (_, i) => i));
  assert.equal(many.more(), false);
  /* 订单历史里写坏的一格没有对应的行：序号跳过去，下一页从最后一个序号后面开始。 */
  const gap = orderCollector();
  [ord(0), ord(1), ord(3), T("ACK ORDN⇥9⇥0⇥4"), "ORDDONE"].forEach((line) => gap.feed(line));
  assert.deepEqual(gap.list().map((item) => item.index), [0, 1, 3]);
  assert.equal(gap.next(), 4);
  assert.equal(gap.more(), true);
  /* 手机上最多留 ORDER_KEEP 条。 */
  assert.ok(ORDER_KEEP >= 1408);
});

test("ACK ORDN 和 ORDGET 的翻页命令", () => {
  assert.deepEqual(parseOrderSum(ORDN_1), { total: 41, first: 0, count: 4 });
  assert.deepEqual(parseOrderSum(ORDN_2), { total: 41, first: 32, count: 9 });
  assert.deepEqual(parseOrderSum(T("ACK ORDN⇥1364⇥1344⇥20")), { total: 1364, first: 1344, count: 20 });
  for (const bad of [ORD_0, "ORDDONE", T("ACK ORDN⇥41⇥0"), T("ACK ORDN⇥x⇥0⇥4"), T("ACK ORDN⇥41⇥0⇥33"), null]) {
    assert.equal(parseOrderSum(bad), null, String(bad));
  }
  /* 汇总行不会被当成订单，订单不会被当成汇总行。 */
  assert.equal(parseOrder(ORDN_1), null);
  /* 第一页发不带参数的 ORDGET（旧固件也认），后面的带起始序号和条数。 */
  assert.equal(ordersCommand(0), "ORDGET");
  assert.equal(ordersCommand(32), "ORDGET\t32\t32");
  assert.equal(ordersCommand(1344), "ORDGET\t1344\t32");
  /* 序号现在可以到一千多。 */
  assert.equal(parseOrder(ORD_32).index, 32);
  assert.equal(parseOrder(ORD_0.replace("ORD\t0\t", "ORD\t1363\t")).index, 1363);
  /* 手机蓝牙层：汇总行以 "ACK " 开头，放行，不会被切开。 */
  assert.ok(phoneKeeps(ORDN_1));
  assert.deepEqual(splitFrames(ORD_0 + ORDN_1 + "ORDDONE"), [ORD_0, ORDN_1, "ORDDONE"]);
});

test("充电记录页：离线刷卡订单的电费、待退费", () => {
  const rows = (line) => orderPayRows(parseOrder(line)).map((row) => [row.label, row.milli === null ? row.text : row.milli]);
  /* 不是离线刷卡的订单：没有金额这几行。 */
  assert.deepEqual(rows(ORD_1), []);
  assert.deepEqual(rows(ORD_0), []);
  assert.deepEqual(orderPayRows(null), []);
  /* 可退费，刷进去 10 元，电费 3 元，余额 7 元还没退：待退费 7 元。 */
  assert.deepEqual(rows(ORD_3), [["收费模型", "可退费"], ["刷卡金额", 10000], ["电费", 3000], ["待退费", 7000]]);
  assert.equal(fmtMoney(7000), "7.00");
  /* 可退费，已经退回卡里（或者蓝牙停掉、不再退）：已结清，不再显示金额。 */
  assert.deepEqual(rows(ORD_33), [["收费模型", "可退费"], ["刷卡金额", 10000], ["电费", 1000], ["已结清", ""]]);
  /* 不退费，正好用完：只有刷卡金额和电费。 */
  assert.deepEqual(rows(ORD_32), [["收费模型", "不退费"], ["刷卡金额", 2000], ["电费", 2000]]);
  /* 不退费，没用完：剩下的不退。 */
  assert.deepEqual(rows(ORD_32.replace("\t2000\t2000\t0", "\t2000\t500\t0")),
    [["收费模型", "不退费"], ["刷卡金额", 2000], ["电费", 500], ["剩余不退", 1500]]);
  /* 还在充的离线刷卡订单：电费要等结束才定，只显示刷进去的钱。 */
  const running = T("ACK ORD⇥0⇥4⇥1795000061⇥0⇥8⇥460⇥NONE⇥4294967295⇥OFFCARD⇥A0000001⇥L9⇥2⇥5000⇥0⇥0");
  assert.deepEqual(rows(running), [["收费模型", "可退费"], ["刷卡金额", 5000]]);
  /* 这几行的字 12 种语言都有；页面上确实用了这个函数。 */
  for (const item of languages) {
    if (item.id === "zh") continue;
    for (const key of ["刷卡金额", "电费", "待退费", "已结清", "剩余不退", "读取更多", "共 {n} 条，已读取 {m} 条"]) {
      assert.ok(hasKey(item.id, key), item.id + ": " + key);
    }
    assert.ok(translate(item.id, "共 {n} 条，已读取 {m} 条", { n: 41, m: 32 }).includes("41"), item.id);
  }
  const vue = read("APP/ui/src/m01/M01App.vue");
  assert.match(vue, /v-for="row in orderPayRows\(item\)"/);
  assert.match(vue, /@click="loadMoreOrders"/);
  assert.match(vue, /ask\(ordersCommand\(first\), \(text\) => text === "ORDDONE", 12000\)/);
});

test("FLT：板级故障", () => {
  assert.deepEqual(parseFlt("FLT NONE"), []);
  assert.deepEqual(parseFlt("FLT OVERTEMP"), ["OVERTEMP"]);
  assert.deepEqual(parseFlt("FLT NTC+UV"), ["NTC", "UV"]);
  assert.equal(parseFlt("ACK START\t3\tFAULT"), null);
  assert.equal(parseFlt("FLTX"), null);
  assert.deepEqual(parseFlt("FLT NTC+UV").map(faultLabel), ["温度传感器故障", "欠压"]);
  assert.equal(faultLabel("OV"), "过压");
  assert.equal(faultLabel("OVERTEMP"), "板温过高");
  assert.equal(faultLabel(9), "继电器没有吸合");
  assert.equal(faultLabel("13"), "过流");
  assert.equal(faultLabel(17), "硬件未配置");
  assert.equal(faultLabel("NONE"), "");
  assert.equal(faultLabel(0), "");
  /* 不认识的故障名照名字显示，不编说明；不用的故障码（1–5、14、15）当没有故障。 */
  assert.equal(faultLabel("XYZ"), "XYZ");
  for (const code of [1, 2, 3, 4, 5, 14, 15, 18, 99]) {
    assert.equal(faultName(code), "NONE", String(code));
    assert.equal(faultLabel(code), "", String(code));
  }
});

test("显示：时长、电量、功率、时间", () => {
  assert.equal(fmtDuration(0), "00:00:00");
  assert.equal(fmtDuration(12), "00:00:12");
  assert.equal(fmtDuration(3723), "01:02:03");
  assert.equal(fmtDuration(999999), "277:46:39");
  assert.equal(fmtDuration(-5), "00:00:00");
  assert.equal(fmtKwh(24), "0.024 kWh");
  assert.equal(fmtKwh(30024), "30.024 kWh");
  assert.equal(fmtKwh(0), "0.000 kWh");
  assert.equal(fmtWatts(460), "460 W");
  assert.equal(fmtWatts(459.6), "460 W");
  assert.equal(fmtWatts("x"), "—");
  /* 桩里的时间是 UTC，加桩的时区显示，和手机的时区无关。 */
  assert.equal(new Date(1795000061000).toISOString(), "2026-11-18T11:07:41.000Z");
  assert.equal(fmtUnix(1795000061, 480), "2026-11-18 19:07");
  assert.equal(fmtUnix(1795000061, 0), "2026-11-18 11:07");
  assert.equal(fmtUnix(1795000061, -570), "2026-11-18 01:37");
  assert.equal(fmtUnix(1795000061, 840), "2026-11-19 01:07");
  assert.equal(fmtUnix(0, 480), "");
  assert.equal(fmtIsoClock("2027-01-15T08:00:00Z", 480), "2027-01-15 16:00:00");
  assert.equal(fmtIsoClock("2027-01-15T23:30:05Z", 345), "2027-01-16 05:15:05");
  assert.equal(fmtIsoClock("2027-01-01T00:00:00Z", -60), "2026-12-31 23:00:00");
  assert.equal(fmtIsoClock("", 480), "");
  assert.equal(fmtIsoClock("-", 480), "");
});

test("选枪倒计时：30 秒，向上取整，过期是 0", () => {
  assert.equal(PORTSEL_SECONDS, 30);
  const start = 1000000;
  const until = start + PORTSEL_SECONDS * 1000;
  assert.equal(selectLeft(until, start), 30);
  assert.equal(selectLeft(until, start + 1), 30);
  assert.equal(selectLeft(until, start + 1000), 29);
  assert.equal(selectLeft(until, start + 29001), 1);
  assert.equal(selectLeft(until, start + 30000), 0);
  assert.equal(selectLeft(until, start + 99000), 0);
  assert.equal(selectLeft(0, start), 0);
  /* 手机的钟被往回拨了：不显示超过 30 秒。 */
  assert.equal(selectLeft(until, start - 60000), 30);
  assert.match(fixture("app_config.h"), /M01_PORT_SELECT_S/);
});

test("ports.js 里给界面用的说明，12 种语言的表里都有", () => {
  const labels = new Set(["未知"]);
  STATUS_LETTERS.forEach((letter) => labels.add(portStatus(letter).label));
  ["OVERTEMP", "NTC", "METER", "RELAY", "WELDED", "OV", "UV", "OC", "OVERPOWER", "NOHW"].forEach((n) => labels.add(faultLabel(n)));
  ["USER", "SAFETY", "OVERPOWER", "PORT_FAULT", "CARD", "BLE", "REMOTE", "PANEL", "DEBUG", "POWER_LOSS", "OFFLINE", "UNKNOWN"]
    .forEach((n) => labels.add(stopLabel(n)));
  ["PRIV", "WHITE", "CARD", "APP", "BLE", "DEBUG", "PANEL"].forEach((n) => labels.add(startLabel(n)));
  const ack = (cmd, port, result) => portAckText(cmd, { cmd, port, result }, { min: 50, max: 2000 }).text;
  ["OK", "BUSY", "FAULT", "UNAVAIL", "RESERVED", "LOCK", "PORT", "XX"].forEach((r) => labels.add(ack("START", 3, r)));
  [[3, "OK"], [0, "OK"], [3, "IDLE"], [0, "IDLE"]].forEach(([p, r]) => labels.add(ack("STOP", p, r)));
  [[3, "OK"], [0, "OK"]].forEach(([p, r]) => labels.add(ack("PORTSEL", p, r)));
  ["OK", "RANGE", "FLASH"].forEach((r) => labels.add(ack("PLIMSET", 2, r)));
  labels.add(portAckText("START", null).text);
  labels.add(portAckText("PLIMSET", { cmd: "PLIMSET", port: 2, result: "RANGE" }).text);
  assert.ok(labels.size >= 45, String(labels.size));
  for (const key of labels) {
    assert.ok(/[一-鿿]/.test(key), key);
    for (const item of languages) {
      if (item.id === "zh") continue;
      const out = translate(item.id, key);
      assert.ok(out && out !== key && !/[\u4e00-\u9fff]/.test(out.replace(/[\u3040-\u30ff]/g, "")) || item.id === "ja",
        item.id + " 没有翻译: " + key);
    }
  }
  /* M01 新加的说明每种语言的表里都要有，不能靠回退到英文。 */
  for (const key of ["空闲", "暂停输出", "结束中", "已预约", "停用", "板温过高", "继电器没有吸合", "继电器粘连", "超过功率上限",
    "硬件未配置", "端口故障", "触摸板停止", "触摸板", "充电桩没有应答", "端口号不对", "第 {n} 路已启动", "已取消选择"]) {
    for (const item of languages) {
      if (item.id !== "zh") assert.ok(hasKey(item.id, key), item.id + " 的表里没有: " + key);
    }
  }
});
