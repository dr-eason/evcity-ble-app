/* 4G 的主机测试：
 *
 *     node --test APP/ui/test/lte.test.mjs
 *
 * 假桩按蓝牙协议应答（LTEGET / LTESET / APNGET / APNSET / LTESTAT，互斥规则和固件
 * lte_cfg_exclusive() 一样）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LTE_POLL_MS, LTE_PROTOS, LTE_STATES, apnCommand, apnError, lteCellText, lteExclusive, lteHomeText, lteRegLabel,
  lteSetCommand, lteSignalText, lteSimLabel, lteStateLabel, lteTextOk, parseApn, parseLteAck,
  parseLteBrief, parseLteCell, parseLteStat, parseLteSwitch, pollLteStat, readApn, readLte, rereadSwitches, sendLteSet,
} from "../src/m01/lte.js";
import { SECTIONS, blankBody, readPlan, sameSection, sectionSkip, writePlan } from "../src/m01/profile.js";
import { languages, translate } from "../src/m01/i18n.js";
import { ltePacks } from "../src/m01/packs-lte.js";
import { wifiStatusText } from "../src/m01/wifi-rssi.js";
import * as lteModule from "../src/m01/lte.js";
import { FRAME_HEADS, phoneKeeps } from "./helpers/m01-phone-layer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ui = resolve(here, "..");
const read = (path) => readFileSync(resolve(ui, path), "utf8");

/* 手机蓝牙层（MainActivity.knownLine / FRAME_HEADS，见 helpers/phone-layer.mjs）只放行认识的
 * 行首，并且按行首在字节流里找下一行的开头。4G 的应答都是 "ACK " 开头，正文里不能再出现任何
 * 一个行首，否则这一行会被从中间切开。 */

const FULL = "ACK LTEST 1\tUP\t-85\tCHINA_MOBILE\tLTE\t1\tREADY\t10.83.214.110\t89860318760238610932" +
  "\t861234567890123\tA7670G-LABE\tA011B07A7670M7\t-95";

test("ACK LTE 行：开关", () => {
  assert.equal(parseLteSwitch("ACK LTE 1"), true);
  assert.equal(parseLteSwitch("ACK LTE 0"), false);
  assert.equal(parseLteSwitch("ACK LTE 0\r\n"), false);
  for (const line of ["ACK LTE", "ACK LTE 2", "ACK LTE 1 1", "ACK LTEB UP\t-85\tX", "ACK LTEST 1\tUP", "ACK LTESET OK",
    "WIFISW 1", "LTE 1", "LTE 0", "ACK LTE\t1", "", null, undefined, 7]) {
    assert.equal(parseLteSwitch(line), null, String(line));
  }
});

test("ACK：只认 LTESET、APNSET", () => {
  assert.deepEqual(parseLteAck("ACK LTESET OK"), { cmd: "LTESET", ok: true });
  assert.deepEqual(parseLteAck("ACK LTESET FAIL"), { cmd: "LTESET", ok: false });
  assert.deepEqual(parseLteAck("ACK APNSET OK\r\n"), { cmd: "APNSET", ok: true });
  assert.deepEqual(parseLteAck("ACK APNSET FAIL"), { cmd: "APNSET", ok: false });
  assert.deepEqual(parseLteAck("ACK APNSET"), { cmd: "APNSET", ok: false });
  /* 数据行也是 ACK 开头：不能被当成设置命令的应答。 */
  for (const line of ["ACK WIFISWSET OK", "ACK TELSET OK", "ACK LTESETX OK", "LTESET OK", "ACK", "ACK LTE 1",
    "ACK APN 0\tcmnet\t\t", "ACK LTEB UP\t-85\tCMCC", FULL, "ACK LTECL B3\t1350\t-10\t19\t-\t-\t-\t-", "", null]) {
    assert.equal(parseLteAck(line), null, String(line));
  }
});

test("ACK APN 行：四段都有、有空的、后面的 TAB 没了", () => {
  assert.deepEqual(parseApn("ACK APN 0\tcmnet\tuser\tpass"), { proto: 0, apn: "cmnet", user: "user", pass: "pass" });
  assert.deepEqual(parseApn("ACK APN 2\tinternet.v6\t\t"), { proto: 2, apn: "internet.v6", user: "", pass: "" });
  assert.deepEqual(parseApn("ACK APN 1\t\tonly-user\t"), { proto: 1, apn: "", user: "only-user", pass: "" });
  assert.deepEqual(parseApn("ACK APN 0\t\t\t"), { proto: 0, apn: "", user: "", pass: "" });
  /* 行尾的 TAB 在路上被去掉了也认。 */
  assert.deepEqual(parseApn("ACK APN 0"), { proto: 0, apn: "", user: "", pass: "" });
  assert.deepEqual(parseApn("ACK APN 0\tcmnet"), { proto: 0, apn: "cmnet", user: "", pass: "" });
  /* 密码里可以有 "-"、下划线，原样留着。 */
  assert.deepEqual(parseApn("ACK APN 0\ta\t-\t-"), { proto: 0, apn: "a", user: "-", pass: "-" });
  assert.deepEqual(parseApn("ACK APN 0\ta_b\tu_1\tp_w"), { proto: 0, apn: "a_b", user: "u_1", pass: "p_w" });
  for (const line of ["ACK APN 3\ta\tb\tc", "ACK APN \ta", "ACK APN", "APN 0\tcmnet", "AP -50 MyHotspot", "APDONE",
    "ACK APNSET OK", "", null]) {
    assert.equal(parseApn(line), null, String(line));
  }
});

test("LTEST 行：全部字段", () => {
  assert.deepEqual(parseLteStat(FULL), {
    on: true, state: "UP", dbm: -85, oper: "CHINA MOBILE", rat: "LTE", reg: 1, sim: "READY",
    ip: "10.83.214.110", iccid: "89860318760238610932", imei: "861234567890123",
    model: "A7670G-LABE", fw: "A011B07A7670M7", rsrp: -95,
  });
});

test("LTEST 行：没有值的是 \"-\"、空的、段数不够", () => {
  const off = parseLteStat("ACK LTEST 0\tOFF\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-");
  assert.deepEqual(off, {
    on: false, state: "OFF", dbm: null, oper: "", rat: "", reg: null, sim: "", ip: "", iccid: "",
    imei: "", model: "", fw: "", rsrp: null,
  });
  const search = parseLteStat("ACK LTEST 1\tSEARCH\t-97\t\t\t2\tREADY\t\t89860318760238610932\t861234567890123\tA7670G-LABE\tA011B07A7670M7\t-");
  assert.equal(search.state, "SEARCH");
  assert.equal(search.dbm, -97);
  assert.equal(search.oper, "");
  assert.equal(search.reg, 2);
  assert.equal(search.ip, "");
  assert.equal(search.rsrp, null);
  /* 少发了后面几段。 */
  const short = parseLteStat("ACK LTEST 1\tNOSIM\t-\t-\t-\t-\tNO_SIM");
  assert.equal(short.state, "NOSIM");
  assert.equal(short.sim, "NO SIM");
  assert.equal(short.imei, "");
  assert.equal(short.rsrp, null);
  assert.equal(parseLteStat("ACK LTEST 1").state, "OFF");
  /* 运营商名字里的下划线是桩替掉的空格。 */
  assert.equal(parseLteStat("ACK LTEST 1\tUP\t-71\tAIRTEL_IN\tLTE\t1\tREADY").oper, "AIRTEL IN");
  assert.equal(parseLteStat("ACK LTEST 1\tSIMPIN\t-\t-\t-\t-\tSIM_PIN").sim, "SIM PIN");
  /* IPv6 地址、运营商是数字。 */
  const v6 = parseLteStat("ACK LTEST 1\tUP\t-71\t46000\tLTE\t5\tREADY\t2409:8a00:1234:5678:9abc:def0:1234:5678\t-\t-\t-\t-\t-113");
  assert.equal(v6.oper, "46000");
  assert.equal(v6.reg, 5);
  assert.equal(v6.ip, "2409:8a00:1234:5678:9abc:def0:1234:5678");
  assert.equal(v6.rsrp, -113);
  for (const line of ["ACK LTEST", "ACK LTEST x\tUP", "LTEST 1\tUP", "ACK LTE 1", "ACK LTEB UP\t-85\tX", "STAT A B",
    "", null]) {
    assert.equal(parseLteStat(line), null, String(line));
  }
});

test("CSQ 无效时桩在 dBm 那一段给的是 RSRP：App 首页和状态页都有数，和屏一致", () => {
  /* 固件 lte_rssi()：AT+CSQ 有效用它，否则用 RSRP。App 不用自己换算，照 dBm 段显示就行。 */
  const stat = parseLteStat("ACK LTEST 1\tUP\t-85\tCHINA_MOBILE\tLTE\t1\tREADY\t10.1.2.3\t-\t-\t-\t-\t-85");
  assert.equal(stat.dbm, -85);
  assert.equal(stat.rsrp, -85);
  assert.equal(lteSignalText(stat.dbm, stat.rsrp, -10, 12), "-85 dBm · RSRP -85 dBm · RSRQ -10 dB · SINR 12 dB");
  const brief = parseLteBrief("ACK LTEB UP\t-85\tCHINA_MOBILE");
  assert.equal(lteHomeText("已连接", brief.state, brief.dbm), "已连接 (-85 dBm)");
  /* 搜网时也有信号值：首页那一行只有连上才带括号，状态页照样显示。 */
  const search = parseLteStat("ACK LTEST 1\tSEARCH\t-97\t-\t-\t2\tREADY");
  assert.equal(lteSignalText(search.dbm, search.rsrp), "-97 dBm");
  assert.equal(lteHomeText("正在搜索网络", "SEARCH", -97), "正在搜索网络");
  /* 卡还在初始化：桩报 BOOT，SIM 那一段是 BUSY，不显示成没插卡。 */
  const busy = parseLteStat("ACK LTEST 1\tBOOT\t-\t-\t-\t-\tBUSY");
  assert.equal(busy.state, "BOOT");
  assert.equal(lteSimLabel(busy.sim), "");
  assert.notEqual(lteStateLabel(busy.state), "未插 SIM 卡");
});

test("ACK LTECL 行：频段、RSRQ、SINR、小区、IMSI", () => {
  assert.deepEqual(parseLteCell("ACK LTECL B3\t1350\t-10\t19\t0x333C\t39589680\t308\t460001234567890"), {
    band: "B3", earfcn: 1350, rsrq: -10, sinr: 19, tac: "0x333C", cell: "39589680", pci: 308,
    imsi: "460001234567890",
  });
  /* 不在 LTE 下、4G 关着：都没有。 */
  assert.deepEqual(parseLteCell("ACK LTECL -\t-\t-\t-\t-\t-\t-\t-"), {
    band: "", earfcn: null, rsrq: null, sinr: null, tac: "", cell: "", pci: null, imsi: "",
  });
  /* SINR 可以是负的、是 0；段数不够按没有算。 */
  assert.equal(parseLteCell("ACK LTECL B40\t38950\t-19\t-3").sinr, -3);
  assert.equal(parseLteCell("ACK LTECL B40\t38950\t-19\t0").sinr, 0);
  assert.equal(parseLteCell("ACK LTECL B1").earfcn, null);
  assert.equal(parseLteCell("ACK LTECL B1\t100\t5\t99").rsrq, null);
  for (const line of ["ACK LTECL", "LTECL B3", FULL, "ACK LTE 1", "", null]) {
    assert.equal(parseLteCell(line), null, String(line));
  }
  assert.equal(lteCellText(parseLteCell("ACK LTECL B3\t1350\t-10\t19\t0x333C\t39589680\t308\t4600")),
    "TAC 0x333C · Cell 39589680 · PCI 308 · EARFCN 1350");
  assert.equal(lteCellText(parseLteCell("ACK LTECL -\t-\t-\t-\t-\t-\t-\t-")), "--");
  assert.equal(lteCellText(null), "--");
});

test("手机蓝牙层：4G 的每一种应答都放行，不会被从中间切开", () => {
  for (const line of ["ACK LTE 1", "ACK LTESET OK", "ACK APNSET FAIL", "ACK APN 2\tprivate.apn\tbob\ts3cret", FULL,
    "ACK LTECL B3\t1350\t-10\t19\t0x333C\t39589680\t308\t460001234567890", "ACK LTEB UP\t-85\tCHINA_MOBILE",
    "ACK LTEB UP\t-85\tAIRTEL_IN", "ACK LTEST 1\tUP\t-71\tAIRTEL_IN\tLTE\t1\tREADY", "ACK LTEB SIMPIN\t-\t-"]) {
    assert.ok(phoneKeeps(line), line);
  }
  assert.ok(FRAME_HEADS.includes("TEL ") && FRAME_HEADS.includes("ACK "));
  /* 反例：名字原样带空格发的话，"AIRTEL IN" 里的 "TEL " 就是一个行首。 */
  assert.equal(phoneKeeps("ACK LTEB UP\t-85\tAIRTEL IN"), false);
  /* 草稿里不带 ACK 的写法到不了界面。 */
  for (const line of ["LTE 1", "APN 0\tcmnet", "LTEST 1\tUP", "LTEB UP -85 CMCC"]) {
    assert.equal(phoneKeeps(line), false, line);
  }
});

test("ACK LTEB 行：运营商带空格、没有运营商、没有信号", () => {
  assert.deepEqual(parseLteBrief("ACK LTEB UP\t-85\tCHINA_MOBILE"), { state: "UP", dbm: -85, oper: "CHINA MOBILE" });
  assert.deepEqual(parseLteBrief("ACK LTEB UP\t-\tCHINA_MOBILE"), { state: "UP", dbm: null, oper: "CHINA MOBILE" });
  assert.deepEqual(parseLteBrief("ACK LTEB SEARCH\t-\t-"), { state: "SEARCH", dbm: null, oper: "" });
  assert.deepEqual(parseLteBrief("ACK LTEB NOSIM\t-"), { state: "NOSIM", dbm: null, oper: "" });
  assert.deepEqual(parseLteBrief("ACK LTEB BOOT"), { state: "BOOT", dbm: null, oper: "" });
  assert.deepEqual(parseLteBrief("ACK LTEB UP\t-63\tT-Mobile_NL\r\n"), { state: "UP", dbm: -63, oper: "T-Mobile NL" });
  assert.deepEqual(parseLteBrief("ACK LTEB UP\t-85\t46000"), { state: "UP", dbm: -85, oper: "46000" });
  for (const line of ["ACK LTEB", "ACK LTEB ", "LTEB UP -85 CMCC", "ACK LTE 1", "WCFG UP EVCITY-Office", "", null]) {
    assert.equal(parseLteBrief(line), null, String(line));
  }
});

test("状态、注册、SIM 的名字", () => {
  assert.deepEqual(LTE_STATES.map(lteStateLabel), ["已关闭", "正在启动", "未检测到模块", "未插 SIM 卡",
    "正在搜索网络", "注册被拒绝", "正在拨号", "已连接", "需要 PIN 码"]);
  assert.equal(lteStateLabel("WEIRD"), "WEIRD");
  assert.equal(lteStateLabel(""), "未知");
  assert.equal(lteRegLabel(1), "已注册（本地）");
  assert.equal(lteRegLabel(5), "已注册（漫游）");
  assert.equal(lteRegLabel(3), "注册被拒绝");
  assert.equal(lteRegLabel(0), "未注册");
  assert.equal(lteRegLabel(11), "");
  assert.equal(lteRegLabel(null), "");
  assert.equal(lteSimLabel("READY"), "正常");
  assert.equal(lteSimLabel("NO SIM"), "未插 SIM 卡");
  assert.equal(lteSimLabel("SIM PIN"), "需要 PIN 码");
  assert.equal(lteSimLabel("SIM PUK"), "需要 PUK 码");
  assert.equal(lteSimLabel("PH-NET PIN"), "");
  assert.equal(lteSimLabel(""), "");
  assert.deepEqual(LTE_PROTOS.map((item) => item.id + ":" + item.name), ["0:IPv4", "1:IPv6", "2:IPv4/IPv6"]);
});

test("4G 页的信号强度：dBm，LTE 下接着写 RSRP、RSRQ、SINR", () => {
  assert.equal(lteSignalText(-85, -95, -10, 12), "-85 dBm · RSRP -95 dBm · RSRQ -10 dB · SINR 12 dB");
  assert.equal(lteSignalText(-85, -95, null, 0), "-85 dBm · RSRP -95 dBm · SINR 0 dB");
  assert.equal(lteSignalText(-85, -95), "-85 dBm · RSRP -95 dBm");
  assert.equal(lteSignalText(-85, null), "-85 dBm");
  assert.equal(lteSignalText(null, -95), "RSRP -95 dBm");
  assert.equal(lteSignalText(null, null), "--");
});

test("首页那一行：和 WiFi 同一个写法", () => {
  assert.equal(lteHomeText("已连接", "UP", -85), "已连接 (-85 dBm)");
  assert.equal(lteHomeText("已连接", "UP", null), "已连接 (--)");
  assert.equal(lteHomeText("Connected", "UP", -51), "Connected (-51 dBm)");
  assert.equal(lteHomeText("正在搜索网络", "SEARCH", -97), "正在搜索网络");
  assert.equal(lteHomeText("未插 SIM 卡", "NOSIM", null), "未插 SIM 卡");
  assert.equal(lteHomeText("已关闭", "OFF", null), "已关闭");
  /* 括号的写法和 WiFi 那一行一样。 */
  assert.equal(wifiStatusText("已连接", "UP", "", -85, false), lteHomeText("已连接", "UP", -85));
  assert.equal(wifiStatusText("已连接", "UP", "", null, true), lteHomeText("已连接", "UP", null));
  /* 从 LTEB 行一路到字。 */
  const line = (text, lang) => {
    const got = parseLteBrief(text);
    return lteHomeText(translate(lang, lteStateLabel(got.state)), got.state, got.dbm);
  };
  assert.equal(line("ACK LTEB UP\t-85\tCHINA_MOBILE", "zh"), "已连接 (-85 dBm)");
  assert.equal(line("ACK LTEB UP\t-85\tCHINA_MOBILE", "en"), "Connected (-85 dBm)");
  assert.equal(line("ACK LTEB UP\t-\tCHINA_MOBILE", "en"), "Connected (--)");
  assert.equal(line("ACK LTEB SEARCH\t-\t-", "en"), "Searching");
  assert.equal(line("ACK LTEB NOSIM\t-\t-", "en"), "No SIM");
  assert.equal(line("ACK LTEB SIMPIN\t-\t-", "en"), "PIN required");
  assert.equal(line("ACK LTEB DIAL\t-90\tCHINA_MOBILE", "zh"), "正在拨号");
});

test("APN 的字符检查：最长 32 个可见 ASCII，不能有双引号", () => {
  assert.equal(lteTextOk(""), true);
  assert.equal(lteTextOk("cmnet"), true);
  assert.equal(lteTextOk("a".repeat(32)), true);
  assert.equal(lteTextOk("a".repeat(33)), false);
  assert.equal(lteTextOk("internet.t-mobile.nl"), true);
  assert.equal(lteTextOk("p@ss!#$%&'()*+,-./:;<=>?"), true);
  assert.equal(lteTextOk("[\\]^_`{|}~"), true);
  assert.equal(lteTextOk("a\"b"), false);
  assert.equal(lteTextOk("a b"), false);
  assert.equal(lteTextOk("a\tb"), false);
  assert.equal(lteTextOk("中文"), false);
  assert.equal(lteTextOk("café"), false);
  assert.equal(lteTextOk("a\n"), false);
  assert.equal(apnError({ proto: "0", apn: "cmnet", user: "", pass: "" }), "");
  assert.equal(apnError({ proto: 2, apn: "", user: "", pass: "" }), "");
  assert.equal(apnError({ proto: "3", apn: "cmnet", user: "", pass: "" }), "proto");
  assert.equal(apnError({ proto: "", apn: "cmnet", user: "", pass: "" }), "proto");
  assert.equal(apnError({ proto: "0", apn: "cm net", user: "", pass: "" }), "apn");
  assert.equal(apnError({ proto: "0", apn: "cmnet", user: "u\"", pass: "" }), "user");
  assert.equal(apnError({ proto: "0", apn: "cmnet", user: "u", pass: "x".repeat(33) }), "pass");
  assert.equal(apnError(null), "proto");
  assert.equal(apnCommand({ proto: "2", apn: "cmnet", user: "u", pass: "p" }), "APNSET\t2\tcmnet\tu\tp");
  assert.equal(apnCommand({ proto: 0, apn: "", user: "", pass: "" }), "APNSET\t0\t\t\t");
  assert.equal(lteSetCommand(true), "LTESET\t1");
  assert.equal(lteSetCommand(false), "LTESET\t0");
  /* 发出去的命令桩按 TAB 拆回来还是原来四段。 */
  assert.deepEqual(parseApn(apnCommand({ proto: 1, apn: "a.b", user: "", pass: "p-1" }).replace("APNSET\t", "ACK APN ")),
    { proto: 1, apn: "a.b", user: "", pass: "p-1" });
});

test("不看固件版本：M01 1.0.0 就有 4G 这一组命令", () => {
  for (const name of ["lteSupported", "LTE_MIN_VERSION"]) {
    assert.equal(name in lteModule, false, name + " 还在");
  }
});

test("互斥：界面上四个开关怎么跟着变", () => {
  const sw = (wifi, lte, tel, ocpp) => ({ wifi: !!wifi, lte: !!lte, tel: !!tel, ocpp: !!ocpp });
  /* 开 4G：关 WiFi、关遥测，OCPP 不动。 */
  assert.deepEqual(lteExclusive(sw(1, 0, 1, 1), "lte", true), sw(0, 1, 0, 1));
  assert.deepEqual(lteExclusive(sw(0, 0, 0, 0), "lte", true), sw(0, 1, 0, 0));
  /* 开 WiFi：关 4G，遥测、OCPP 不动。 */
  assert.deepEqual(lteExclusive(sw(0, 1, 0, 1), "wifi", true), sw(1, 0, 0, 1));
  assert.deepEqual(lteExclusive(sw(0, 0, 1, 0), "wifi", true), sw(1, 0, 1, 0));
  /* 开遥测：关 4G；WiFi 也关着，OCPP 一起关。WiFi 开着时什么都不连带。 */
  assert.deepEqual(lteExclusive(sw(0, 1, 0, 1), "tel", true), sw(0, 0, 1, 0));
  assert.deepEqual(lteExclusive(sw(1, 0, 0, 1), "tel", true), sw(1, 0, 1, 1));
  /* 关 4G，WiFi 也关着：OCPP 一起关。 */
  assert.deepEqual(lteExclusive(sw(0, 1, 0, 1), "lte", false), sw(0, 0, 0, 0));
  /* 关 WiFi，4G 也关着：OCPP 一起关（原来就有的规则）。 */
  assert.deepEqual(lteExclusive(sw(1, 0, 1, 1), "wifi", false), sw(0, 0, 1, 0));
  /* 关遥测：别的不动。三个可以都关。 */
  assert.deepEqual(lteExclusive(sw(1, 0, 1, 1), "tel", false), sw(1, 0, 0, 1));
  assert.deepEqual(lteExclusive(sw(0, 0, 1, 0), "tel", false), sw(0, 0, 0, 0));
  /* 4G 和 WiFi、4G 和遥测任何时候不同时开。 */
  for (let bits = 0; bits < 16; bits++) {
    for (const which of ["wifi", "lte", "tel"]) {
      for (const on of [true, false]) {
        const now = sw(bits & 1, bits & 2, bits & 4, bits & 8);
        if (now.lte && (now.wifi || now.tel)) continue;
        const next = lteExclusive(now, which, on);
        assert.equal(next[which], on);
        assert.ok(!(next.lte && (next.wifi || next.tel)), JSON.stringify([now, which, on, next]));
        if (!next.wifi && !next.lte && (which !== "tel" || now.lte)) assert.equal(next.ocpp, which === "tel" && !on ? now.ocpp : false);
      }
    }
  }
  assert.deepEqual(lteExclusive(sw(1, 0, 0, 0), "nope", true), sw(1, 0, 0, 0));
});

/* 假桩：认识 4G 命令并执行互斥。
 * drop：{ 命令名: 前几次不回 }，模拟蓝牙丢了应答。 */
function fakePile(start, drop) {
  const pile = {
    sent: [], waits: [], alive: true, pushed: [], inFlight: 0, maxInFlight: 0,
    sw: Object.assign({ wifi: false, lte: false, tel: false, ocpp: false }, start || {}),
    apn: { proto: 0, apn: "", user: "", pass: "" },
    stat: FULL,
  };
  const left = Object.assign({}, drop || {});
  function setSwitch(which, on) {
    const before = pile.sw;
    const next = lteExclusive(before, which, on);
    pile.sw = next;
    /* 被连带改掉的开关各补一行。 */
    if (which !== "wifi" && before.wifi !== next.wifi) pile.pushed.push("WIFISW " + (next.wifi ? 1 : 0));
    if (which !== "tel" && before.tel !== next.tel) pile.pushed.push("TEL " + (next.tel ? 1 : 0));
    if (which !== "ocpp" && before.ocpp !== next.ocpp) pile.pushed.push("OCPPSW " + (next.ocpp ? 1 : 0));
    if (which !== "lte" && before.lte !== next.lte) pile.pushed.push("ACK LTE " + (next.lte ? 1 : 0));
  }
  function reply(command) {
    const part = command.split("\t");
    const cmd = part[0];
    if (left[cmd] > 0) {
      left[cmd] -= 1;
      return null;
    }
    if (cmd === "WIFISWGET") return "WIFISW " + (pile.sw.wifi ? 1 : 0);
    if (cmd === "TELGET") return "TEL " + (pile.sw.tel ? 1 : 0);
    if (cmd === "OCPPSWGET") return "OCPPSW " + (pile.sw.ocpp ? 1 : 0);
    if (cmd === "WIFISWSET") { setSwitch("wifi", part[1] === "1"); return "ACK WIFISWSET OK"; }
    if (cmd === "TELSET") { setSwitch("tel", part[1] === "1"); return "ACK TELSET OK"; }
    if (cmd === "LTEGET") return "ACK LTE " + (pile.sw.lte ? 1 : 0);
    if (cmd === "LTESET") {
      if (part[1] !== "0" && part[1] !== "1") return "ACK LTESET FAIL";
      setSwitch("lte", part[1] === "1");
      return "ACK LTESET OK";
    }
    if (cmd === "APNGET") return "ACK APN " + pile.apn.proto + "\t" + pile.apn.apn + "\t" + pile.apn.user + "\t" + pile.apn.pass;
    if (cmd === "APNSET") {
      const cfg = { proto: part[1], apn: part[2] || "", user: part[3] || "", pass: part[4] || "" };
      if (part.length !== 5 || apnError(cfg)) return "ACK APNSET FAIL";
      pile.apn = { proto: Number(cfg.proto), apn: cfg.apn, user: cfg.user, pass: cfg.pass };
      return "ACK APNSET OK";
    }
    if (cmd === "LTESTAT") return pile.sw.lte ? pile.stat : "ACK LTEST 0\tOFF\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-";
    if (cmd === "LTECELL") {
      return pile.sw.lte ? "ACK LTECL B3\t1350\t-10\t19\t0x333C\t39589680\t308\t460001234567890"
        : "ACK LTECL -\t-\t-\t-\t-\t-\t-\t-";
    }
    return null;
  }
  pile.io = {
    alive: () => pile.alive,
    wait: async (ms) => { pile.waits.push(ms); },
    ask: async (command, accept, ms) => {
      pile.sent.push(command);
      pile.inFlight += 1;
      pile.maxInFlight = Math.max(pile.maxInFlight, pile.inFlight);
      await Promise.resolve();
      pile.inFlight -= 1;
      assert.ok(ms >= 1000, "等得太短: " + command);
      /* 桩同时在发的状态行不是这条命令的应答。 */
      for (const noise of ["ACK SYS\t1.0.0\t10\t230.4\t31\t1\t-62\tUP\tON\t-\tbench",
        "ACK PORTS\t10\tP,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0;P,0,0,0", "WCFG UP EVCITY-Office",
        "ACK LTEB UP\t-85\tCMCC", "ACK OCFWSET OK", "FLT NONE"]) {
        assert.equal(accept(noise), false, command + " 把 " + noise + " 当成了应答");
      }
      const line = reply(command);
      if (line == null) return null;
      return accept(line) ? line : null;
    },
  };
  return pile;
}

test("开关、APN 各一次读到", async () => {
  const pile = fakePile({ lte: true });
  pile.apn = { proto: 2, apn: "cmnet", user: "", pass: "" };
  assert.deepEqual(await readLte(pile.io), { state: "ok", on: true });
  assert.deepEqual(await readApn(pile.io), { proto: 2, apn: "cmnet", user: "", pass: "" });
  assert.deepEqual(pile.sent, ["LTEGET", "APNGET"]);
});

test("丢了一次应答：再问一次就有；两次都没回是 silent（界面写“没有应答，请重新读取”）", async () => {
  const once = fakePile({ lte: false }, { LTEGET: 1 });
  assert.deepEqual(await readLte(once.io), { state: "ok", on: false });
  assert.deepEqual(once.sent, ["LTEGET", "LTEGET"]);
  const twice = fakePile({}, { LTEGET: 2 });
  assert.deepEqual(await readLte(twice.io), { state: "silent" });
  assert.deepEqual(twice.sent, ["LTEGET", "LTEGET"]);
  const apn = fakePile({}, { APNGET: 2 });
  assert.equal(await readApn(apn.io), null);
  assert.deepEqual(apn.sent, ["APNGET", "APNGET"]);
});

test("打开 4G：桩关掉 WiFi 和遥测，重读四个开关，一条一条问", async () => {
  const pile = fakePile({ wifi: true, tel: true, ocpp: true });
  assert.equal(await sendLteSet(pile.io, lteSetCommand(true)), "ok");
  assert.deepEqual(pile.pushed, ["WIFISW 0", "TEL 0"]);
  assert.deepEqual(await rereadSwitches(pile.io), { wifi: false, tel: false, ocpp: true, lte: true });
  assert.deepEqual(pile.sent, ["LTESET\t1", "WIFISWGET", "TELGET", "OCPPSWGET", "LTEGET"]);
  /* 桩的蓝牙回复队列只有 4 格：任何时候只有一条命令在等应答。 */
  assert.equal(pile.maxInFlight, 1);
});

test("关掉 4G，WiFi 也关着：OCPP 开关跟着关", async () => {
  const pile = fakePile({ lte: true, ocpp: true });
  assert.equal(await sendLteSet(pile.io, lteSetCommand(false)), "ok");
  assert.deepEqual(pile.pushed, ["OCPPSW 0"]);
  assert.deepEqual(await rereadSwitches(pile.io), { wifi: false, tel: false, ocpp: false, lte: false });
});

test("打开 WiFi、打开遥测：桩关掉 4G，补一行 ACK LTE 0，重读后各页一致", async () => {
  const wifi = fakePile({ lte: true, ocpp: true });
  await wifi.io.ask("WIFISWSET\t1", (line) => line.indexOf("ACK WIFISWSET") === 0, 3000);
  assert.deepEqual(wifi.pushed, ["ACK LTE 0"]);
  assert.equal(parseLteSwitch(wifi.pushed[0]), false);
  assert.deepEqual(await rereadSwitches(wifi.io), { wifi: true, tel: false, ocpp: true, lte: false });
  const tel = fakePile({ lte: true, ocpp: true });
  await tel.io.ask("TELSET\t1", (line) => line.indexOf("ACK TELSET") === 0, 3000);
  assert.deepEqual(tel.pushed, ["OCPPSW 0", "ACK LTE 0"]);
  assert.deepEqual(await rereadSwitches(tel.io), { wifi: false, tel: true, ocpp: false, lte: false });
});

test("重读时丢了一条：那一个是 null，别的照读", async () => {
  const pile = fakePile({ wifi: true }, { TELGET: 2 });
  assert.deepEqual(await rereadSwitches(pile.io), { wifi: true, tel: null, ocpp: false, lte: false });
  assert.deepEqual(pile.sent, ["WIFISWGET", "TELGET", "TELGET", "OCPPSWGET", "LTEGET"]);
});

test("APNSET：保存、读回；桩不接受回 FAIL；没回是 silent", async () => {
  const pile = fakePile();
  const cfg = { proto: "2", apn: "internet", user: "web", pass: "p@ss-1" };
  assert.equal(apnError(cfg), "");
  assert.equal(await sendLteSet(pile.io, apnCommand(cfg)), "ok");
  assert.deepEqual(await readApn(pile.io), { proto: 2, apn: "internet", user: "web", pass: "p@ss-1" });
  assert.equal(await sendLteSet(pile.io, "APNSET\t7\ta\tb\tc"), "fail");
  assert.equal(await sendLteSet(pile.io, apnCommand({ proto: 0, apn: "", user: "", pass: "" })), "ok");
  assert.deepEqual(await readApn(pile.io), { proto: 0, apn: "", user: "", pass: "" });
  const mute = fakePile({}, { APNSET: 1, LTESET: 1 });
  assert.equal(await sendLteSet(mute.io, apnCommand(cfg)), "silent");
  assert.equal(await sendLteSet(mute.io, lteSetCommand(true)), "silent");
  assert.equal(mute.sw.lte, false);
});

test("状态每 3 秒读一次：问一次，等回来，歇 3 秒；离开页面就停", async () => {
  const pile = fakePile({ lte: true });
  const seen = [];
  pile.io.wait = async (ms) => {
    pile.waits.push(ms);
    if (pile.waits.length === 2) pile.stat = "ACK LTEST 1\tSEARCH\t-\t-\t-\t2\tREADY\t-\t-\t-\t-\t-\t-";
    if (pile.waits.length === 3) pile.alive = false;
  };
  await pollLteStat(pile.io, (stat) => seen.push(stat.state + ":" + stat.dbm));
  assert.deepEqual(pile.sent, ["LTESTAT", "LTESTAT", "LTESTAT"]);
  assert.deepEqual(pile.waits, [LTE_POLL_MS, LTE_POLL_MS, LTE_POLL_MS]);
  assert.equal(LTE_POLL_MS, 3000);
  assert.deepEqual(seen, ["UP:-85", "UP:-85", "SEARCH:null"]);
  assert.equal(pile.maxInFlight, 1);
  /* 一次没回：不报错，下一轮接着问。 */
  const lossy = fakePile({ lte: true }, { LTESTAT: 1 });
  const got = [];
  lossy.io.wait = async () => { if (lossy.sent.length >= 2) lossy.alive = false; };
  await pollLteStat(lossy.io, (stat) => got.push(stat.state));
  assert.deepEqual(got, ["UP"]);
});

test("状态页还要小区信息时：每一轮 LTESTAT 后面接着问一次 LTECELL，4G 关着不问", async () => {
  const pile = fakePile({ lte: true });
  const stats = [];
  const cells = [];
  pile.io.wait = async (ms) => {
    pile.waits.push(ms);
    if (pile.waits.length === 2) pile.alive = false;
  };
  await pollLteStat(pile.io, (stat) => stats.push(stat.state), (cell) => cells.push(cell.band + ":" + cell.sinr));
  assert.deepEqual(pile.sent, ["LTESTAT", "LTECELL", "LTESTAT", "LTECELL"]);
  assert.deepEqual(stats, ["UP", "UP"]);
  assert.deepEqual(cells, ["B3:19", "B3:19"]);
  assert.equal(pile.maxInFlight, 1);
  const off = fakePile({ lte: false });
  off.io.wait = async () => { off.alive = false; };
  await pollLteStat(off.io, () => {}, () => assert.fail("4G 关着不该问小区"));
  assert.deepEqual(off.sent, ["LTESTAT"]);
  /* 小区那一条没回：不报错，下一轮照常。 */
  const lossy = fakePile({ lte: true }, { LTECELL: 1 });
  const got = [];
  lossy.io.wait = async () => { if (lossy.sent.length >= 4) lossy.alive = false; };
  await pollLteStat(lossy.io, () => {}, (cell) => got.push(cell.band));
  assert.deepEqual(lossy.sent, ["LTESTAT", "LTECELL", "LTESTAT", "LTECELL"]);
  assert.deepEqual(got, ["B3"]);
});

test("连接断了就停", async () => {
  const pile = fakePile({ lte: true });
  pile.alive = false;
  assert.deepEqual(await readLte(pile.io), { state: "gone" });
  assert.equal(await sendLteSet(pile.io, lteSetCommand(false)), "gone");
  assert.deepEqual(await rereadSwitches(pile.io), { wifi: null, tel: null, ocpp: null, lte: null });
  await pollLteStat(pile.io, () => assert.fail("不该读到"));
  assert.deepEqual(pile.sent, []);
});

test("12 种语言：4G 的字符串都有，没有漏成英文或中文", () => {
  const keys = Object.keys(ltePacks.en);
  assert.ok(keys.length >= 35);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    assert.deepEqual(Object.keys(ltePacks[lang]).sort(), keys.slice().sort(), lang + " 的键不齐");
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没有翻译: " + key);
      assert.equal(out, ltePacks[lang][key]);
      assert.ok(!/[一-鿿]/.test(out) || lang === "ja", lang + " 里还有中文: " + out);
      if (lang !== "en") assert.notEqual(out, ltePacks.en[key], lang + " 用了英文: " + key);
    }
  }
  assert.equal(translate("zh", "4G 设置"), "4G 设置");
  assert.equal(translate("en", "4G 设置"), "4G settings");
  /* lte.js 里给界面用的名字都在表里。 */
  for (const name of LTE_STATES.map(lteStateLabel).concat([0, 1, 5].map(lteRegLabel),
    ["READY", "NO SIM", "SIM PIN", "SIM PUK"].map(lteSimLabel))) {
    assert.ok(keys.includes(name), name);
  }
});

test("App.vue：4G 入口在 WiFi 配网下面；4G 页、互斥提示、首页用到的字符串都在表里", () => {
  const vue = read("src/m01/M01App.vue");
  const menu = vue.match(/<section v-else-if="page === 'menu'"[\s\S]*?<\/section>/);
  const ltePage = vue.match(/<section v-else-if="page === 'lte'"[\s\S]*?<\/section>/);
  const wifiPage = vue.match(/<section v-else-if="page === 'wifi'"[\s\S]*?<\/section>/);
  const telPage = vue.match(/<section v-else-if="page === 'telemetry'"[\s\S]*?<\/section>/);
  const home = vue.match(/<section v-else-if="page === 'charge'"[\s\S]*?<\/section>/);
  assert.ok(menu && ltePage && wifiPage && telPage && home);
  /* 菜单：WiFi 配网的下一项就是 4G 设置。 */
  const entries = [...menu[0].matchAll(/<button class="card device" @click="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(entries[entries.indexOf("openWifi") + 1], "openLte");
  assert.match(menu[0], /t\('4G 设置'\)[\s\S]*?\{\{ lteBrief \}\}/);
  assert.match(wifiPage[0], /打开 WiFi 会关闭 4G/);
  assert.match(telPage[0], /打开遥测会关闭 4G/);
  assert.match(home[0], /lteHome \? t\('4G 网络'\) : t\('已配置热点'\)/);
  assert.ok(!/固件不支持|2\.6\.16/.test(vue), "还有旧固件的提示");
  assert.match(ltePage[0], /<select v-model="lteApn\.proto"/);
  /* 还没读到开关、正在保存时：开关、下拉、三个输入框、保存都不可用。 */
  assert.equal((ltePage[0].match(/:disabled="!lteReady \|\| lteBusy(?: \|\| saveOff\('apn'\))?"/g) || []).length, 6);
  /* APN 的保存结果写在保存按钮上，不再有单独的提示行。 */
  assert.match(ltePage[0], /:disabled="!lteReady \|\| lteBusy \|\| saveOff\('apn'\)" @click="saveApn">\{\{ saveLbl\('apn'\) \}\}/);
  assert.ok(!/lteApnNote/.test(vue), "lteApnNote 还在");
  /* 密码默认不显示，勾上“显示密码”才显示。 */
  assert.match(ltePage[0], /v-model="lteApn\.pass" class="field" :type="ltePassShow \? 'text' : 'password'"/);
  assert.match(ltePage[0], /v-model="ltePassShow" type="checkbox"/);
  const used = new Set();
  for (const block of [ltePage[0], wifiPage[0], telPage[0], home[0]]) {
    for (const m of block.matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  }
  const script = vue.slice(vue.indexOf("<script"));
  for (const name of ["lteNote"]) {
    for (const m of script.matchAll(new RegExp(name + "\\.value = (?:[^;]*?\\? )?\"([^\"]+)\"(?:\\s*:\\s*\"([^\"]+)\")?", "g"))) {
      used.add(m[1]);
      if (m[2]) used.add(m[2]);
    }
  }
  /* 保存的结果写在按钮上（save-btn.js）：按钮上的短原因和按钮下面那一行说明也要有译文。 */
  for (const id of ["apn"]) {
    for (const m of script.matchAll(new RegExp("saveBtns\\.(?:ok|restart|fail|silent)\\(\"" + id + "\"((?:, \"[^\"]*\")*)\\)", "g"))) {
      for (const one of m[1].matchAll(/"([^"]+)"/g)) used.add(one[1]);
    }
  }
  ["保存中…", "保存成功", "保存失败", "保存失败：{why}", "充电桩没有应答"].forEach((key) => used.add(key));
  for (const m of script.matchAll(/key: "([^"]+)", value:/g)) used.add(m[1]);
  ["4G 设置", "移动网络和 APN", "WiFi 已打开，4G 已关闭。断电后仍然有效",
    "遥测已打开，4G 已关闭。遥测串口每秒发送状态，断电后仍然有效"].forEach((key) => used.add(key));
  assert.ok(used.size >= 35, String(used.size));
  for (const key of ["WiFi 已打开，4G 已关闭。断电后仍然有效", "遥测已打开，4G 已关闭。遥测串口每秒发送状态，断电后仍然有效"]) {
    assert.ok(script.includes("\"" + key + "\""), key);
  }
  for (const key of used) {
    /* 这两个缩写各语言都不翻。 */
    if (key === "ICCID" || key === "IMEI" || key === "IMSI") continue;
    for (const item of languages) {
      if (item.id === "zh") continue;
      const out = translate(item.id, key);
      assert.ok(out && (out !== key || key.length <= 2), item.id + " 没有翻译: " + key);
    }
  }
  /* 状态页的 14 行。 */
  for (const key of ["联网状态", "信号强度", "运营商", "网络制式", "频段", "注册状态", "小区信息", "SIM 卡状态", "IP 地址",
    "ICCID", "IMSI", "IMEI", "模块型号", "模块固件版本"]) {
    assert.ok(used.has(key), key);
  }
  /* 应答有人接：ACK LTE / LTEB / LTEST / LTECL / APN / LTESET、APNSET，都排在通用的 ACK 处理前面。 */
  for (const name of ["parseLteSwitch", "parseLteBrief", "parseLteStat", "parseLteCell", "parseApn", "parseLteAck"]) {
    assert.ok(script.indexOf("if (" + name + "(line) !== null)") < script.indexOf("if (line.indexOf(\"ACK \") === 0) applyAck(line);"), name);
    assert.ok(script.indexOf("if (line.indexOf(\"ACK \") === 0) applyAck(line);") > 0);
    assert.ok(script.includes("if (" + name + "(line) !== null)"), name);
  }
  /* 又来 WCFG 行，首页换回 WiFi。 */
  assert.match(script, /if \(line\.indexOf\("WCFG "\) === 0\) \{[\s\S]*?lteHome\.value = null;[\s\S]*?applyWifiConfig/);
});


/* 一键配置：带 APN（Protocol、APN、账号、密码），不带 4G 开关。 */
function profilePile(apn) {
  const pile = { apn: Object.assign({ proto: 0, apn: "", user: "", pass: "" }, apn || {}), sent: [] };
  pile.answer = (command) => {
    const part = command.split("\t");
    pile.sent.push(part[0]);
    if (part[0] === "APNGET") return "ACK APN " + pile.apn.proto + "\t" + pile.apn.apn + "\t" + pile.apn.user + "\t" + pile.apn.pass;
    if (part[0] === "APNSET") {
      const cfg = { proto: part[1], apn: part[2] || "", user: part[3] || "", pass: part[4] || "" };
      if (part.length !== 5 || apnError(cfg)) return "ACK APNSET FAIL";
      pile.apn = { proto: Number(cfg.proto), apn: cfg.apn, user: cfg.user, pass: cfg.pass };
      return "ACK APNSET OK";
    }
    return null;
  };
  return pile;
}
function runSteps(pile, plan, body) {
  for (const step of plan.list) {
    /* 手机蓝牙层把每行两头的空格和 TAB 去掉：行尾的空字段到不了界面。 */
    const raw = pile.answer(step.command);
    const line = raw === null ? null : raw.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!line || !phoneKeeps(line) || !step.accept(line) || !step.ok(line, body)) return false;
  }
  return true;
}

test("一键配置：有 4G APN 这一项，没有 4G 开关", () => {
  const section = SECTIONS.find((item) => item.key === "apn");
  assert.ok(section && section.name === "4G APN");
  assert.ok(SECTIONS.findIndex((item) => item.key === "apn") > SECTIONS.findIndex((item) => item.key === "ocpp"));
  const profile = read("src/m01/profile.js");
  assert.ok(!/LTESET|LTEGET/.test(profile));
  assert.equal(blankBody().apn, null);
});

test("一键配置：从一台桩读 APN，下发到另一台，读回一致", () => {
  const from = profilePile({ proto: 2, apn: "private.apn", user: "bob", pass: "s3cret" });
  const body = blankBody();
  const section = SECTIONS.find((item) => item.key === "apn");
  assert.equal(sectionSkip(section, "read", body), "");
  assert.ok(runSteps(from, readPlan("apn"), body));
  assert.deepEqual(body.apn, { proto: 2, apn: "private.apn", user: "bob", pass: "s3cret" });
  const to = profilePile();
  assert.equal(sectionSkip(section, "write", body), "");
  assert.ok(runSteps(to, writePlan("apn", body), body));
  assert.deepEqual(to.apn, body.apn);
  const got = blankBody();
  assert.ok(runSteps(to, readPlan("apn"), got));
  assert.ok(sameSection("apn", body, got));
  assert.deepEqual(to.sent, ["APNSET", "APNGET"]);
  /* 出厂状态（三段都空）也能读、能写、能比。 */
  const blank = blankBody();
  assert.ok(runSteps(profilePile(), readPlan("apn"), blank));
  assert.deepEqual(blank.apn, { proto: 0, apn: "", user: "", pass: "" });
  assert.ok(runSteps(to, writePlan("apn", blank), blank));
  assert.deepEqual(to.apn, { proto: 0, apn: "", user: "", pass: "" });
  assert.equal(sameSection("apn", body, blank), false);
});

test("一键配置：备份里没有 APN 时下发跳过，不算失败；读取从不跳过", () => {
  const section = SECTIONS.find((item) => item.key === "apn");
  assert.equal(sectionSkip(section, "write", blankBody()), "这份配置里没有这一项");
  assert.equal(sectionSkip(section, "write", {}), "这份配置里没有这一项");
  for (const other of SECTIONS) {
    assert.equal(sectionSkip(other, "read", blankBody()), "", other.key);
  }
  /* 不该发生的情况也有交代：没有 APN 还去生成下发命令，是错误，不是空命令。 */
  assert.ok(writePlan("apn", blankBody()).error);
  assert.ok(writePlan("apn", { apn: { proto: 0, apn: "a b", user: "", pass: "" } }).error);
  assert.ok(writePlan("apn", { apn: { proto: 3, apn: "a", user: "", pass: "" } }).error);
  /* App.vue 的循环用的就是这个函数；跳过的那一行、跳过的原因 12 种语言都有。 */
  const vue = read("src/m01/M01App.vue");
  assert.match(vue, /const skip = lack \? lack\.text : sectionSkip\(section, mode, body, portsNow\);/);
  for (const item of languages) {
    if (item.id === "zh") continue;
    for (const key of ["{name}已跳过：{reason}", "这份配置里没有这一项"]) {
      const out = translate(item.id, key);
      assert.ok(out && out !== key, item.id + " 没有翻译: " + key);
    }
    assert.ok(translate(item.id, "{name}已跳过：{reason}", { name: "4G APN", reason: "x" }).includes("4G APN"), item.id);
  }
});
