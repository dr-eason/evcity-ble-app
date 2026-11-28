/* WiFi 配网页的主机测试（src/wifi-setup.js）：
 *
 *     node --test APP/ui/test/
 *
 * 用户报的"开启 WiFi 保存失败、搜索热点也不行"：桩上主板联网开关关着，WIFISWSET⇥1 回 FAIL，
 * App 只写"WiFi 开关没有保存"；老固件在 WiFi 开关关着时回 ACK WSCAN OK 却不扫，App 一直写
 * "正在搜索热点"。另外热点名里有 "TEL "、"AP " 这种行首时，搜索结果被手机那一层切开。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NET_OFF_NOTE, SCAN_LIMIT_MS, SCAN_LOST_NOTE, createWifiScan, netSwitchOff, parseApLine, refusedNote,
} from "../src/m01/wifi-setup.js";
import { parsePay } from "../src/m01/ports.js";
import { translate, languages } from "../src/m01/i18n.js";
import { FRAME_HEADS, atModeStream, splitFrames } from "./helpers/m01-phone-layer.mjs";
/* M01 仓库里的固件头文件和协议文档，拷了一份在 test/fixtures/m01/（见那里的 README.md）。 */
const fixture = (name) => readFileSync(new URL("./fixtures/m01/" + name, import.meta.url), "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const vue = readFileSync(resolve(here, "../src/m01/M01App.vue"), "utf8");
const doc = fixture("M01蓝牙协议.md");

/* 固件 wb2.c 的 s_phone_heads（M01 仓库 m01-evcm-adv，1.3.6；这里没有拷 wb2.c，抄了这一张表）。 */
const fwHeads = ["WCFG ", "FLT ", "ACK ", "AP ", "APDONE", "OCPP ", "CFG ", "ORDDONE",
  "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "OCFW "];

/* 照 wb2.c 的 wifi_ssid_cut_by_phone / wifi_format_ap 写的：桩发出去的那一行。 */
function fwApLine(rssi, ssid) {
  const bytes = new TextEncoder().encode(ssid);
  const cut = bytes.length > 0 && (ssid[0] === " " || ssid[ssid.length - 1] === " " ||
    bytes.some((b) => b < 0x20 || b === 0x7f) || fwHeads.some((head) => ssid.includes(head)));
  if (!cut) return "AP " + rssi + " " + ssid;
  return "AP " + rssi + "\t" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("主板联网开关：PAYGET 读到关着才算，没读到不挡", () => {
  const off = parsePay("ACK PAY\t2\t1\t10\t1\t100\t300\t-\t10\t3600");
  const on = parsePay("ACK PAY\t3\t1\t10\t1\t100\t300\t-\t10\t3600");
  assert.equal(off.net, false);
  assert.equal(netSwitchOff(true, off), true);
  assert.equal(netSwitchOff(true, on), false);
  assert.equal(netSwitchOff(false, off), false);
  assert.equal(netSwitchOff(true, null), false);
  assert.equal(refusedNote(true, "WiFi 开关没有保存"), NET_OFF_NOTE);
  assert.equal(refusedNote(false, "WiFi 开关没有保存"), "WiFi 开关没有保存");
  /* 提示里不用"拨码"（App 里叫"主板上的两个开关"），12 种语言都有。 */
  assert.ok(!/拨码/.test(NET_OFF_NOTE));
  for (const { id } of languages) {
    if (id === "zh") continue;
    assert.notEqual(translate(id, NET_OFF_NOTE), NET_OFF_NOTE, id);
    assert.notEqual(translate(id, SCAN_LOST_NOTE), SCAN_LOST_NOTE, id);
  }
});

test("App：联网开关关着时开 WiFi、开 OCPP、搜索、连接都不发命令，直接说原因；FAIL 也说原因", () => {
  const fn = (name) => {
    const at = vue.indexOf("function " + name + "(");
    return vue.slice(at, vue.indexOf("\n}\n", at));
  };
  for (const name of ["setWifiOn", "setOcppOn", "scanWifi", "joinWifi"]) {
    const body = fn(name);
    assert.match(body, /netOff\.value/, name);
    assert.ok(body.indexOf("NET_OFF_NOTE") < body.search(/sendSet\(|ask\(/), name + " 先看开关再发命令");
  }
  assert.match(vue, /refusedNote\(netOff\.value, "WiFi 开关没有保存"\)/);
  assert.match(vue, /refusedNote\(netOff\.value, "没有保存成功"\)/);
  assert.match(vue, /refusedNote\(netOff\.value && on, "4G 开关没有保存"\)/);
  /* 换一台桩要重读开关。 */
  const reset = fn("resetCharge");
  assert.match(reset, /payKnown\.value = false/);
  /* 开关框被挡回去时把勾去掉。 */
  assert.match(vue, /@change="setWifiOn\(\$event\.target\.checked, \$event\.target\)"/);
  assert.match(vue, /@change="setOcppOn\(\$event\.target\.checked, \$event\.target\)"/);
});

test("搜索热点（修好的固件）：ACK 先到，AP 行，APDONE", () => {
  const scan = createWifiScan();
  assert.equal(scan.start(0), "正在搜索热点");
  assert.equal(scan.ack("OK", false), "正在搜索热点");
  assert.equal(scan.waiting, true);
  assert.equal(scan.done(3), "点一个热点，再填密码");
  assert.equal(scan.waiting, false);
  assert.equal(scan.expired(SCAN_LIMIT_MS * 2), null);
  scan.start(0);
  assert.equal(scan.done(0), "没有搜到热点");
});

test("搜索热点（老固件，WiFi 开关关着）：ACK WSCAN OK 之后什么都不来，到时说没收到结果", () => {
  const scan = createWifiScan();
  scan.start(1000);
  assert.equal(scan.ack("OK", false), "正在搜索热点");
  assert.equal(scan.expired(1000 + SCAN_LIMIT_MS - 1), null);
  assert.equal(scan.expired(1000 + SCAN_LIMIT_MS), SCAN_LOST_NOTE);
  assert.equal(scan.waiting, false);
  assert.equal(scan.expired(1000 + SCAN_LIMIT_MS * 2), null);
});

test("搜索热点（老固件，WiFi 开关开着）：ACK 扫完才到，不把结果的提示改回正在搜索", () => {
  const scan = createWifiScan();
  scan.start(0);
  assert.equal(scan.done(2), "点一个热点，再填密码");
  assert.equal(scan.ack("OK", false), null);
  assert.equal(scan.ack("BUSY", false), null);
});

test("搜索热点：桩回 FAIL。联网开关关着时说开关", () => {
  const scan = createWifiScan();
  scan.start(0);
  assert.equal(scan.ack("FAIL", true), NET_OFF_NOTE);
  assert.equal(scan.waiting, false);
  scan.start(0);
  assert.equal(scan.ack("FAIL", false), "搜索热点失败");
  scan.start(0);
  assert.equal(scan.ack("BUSY", false), "正在搜索或连接，请稍等");
  assert.equal(scan.waiting, true);
});

test("固件的行首表和手机那一层（MainActivity.FRAME_HEADS）一样", () => {
  assert.deepEqual(fwHeads.slice().sort(), FRAME_HEADS.slice().sort());
});

test("AP 行：原样的和十六进制的两种写法", () => {
  assert.deepEqual(parseApLine("AP -52 shop 5G"), { rssi: "-52", ssid: "shop 5G" });
  assert.deepEqual(parseApLine("AP -60\t484f54454c203547"), { rssi: "-60", ssid: "HOTEL 5G" });
  assert.deepEqual(parseApLine("AP -42\t7461696c20"), { rssi: "-42", ssid: "tail " });
  assert.deepEqual(parseApLine("AP -48 充电站"), { rssi: "-48", ssid: "充电站" });
  for (const bad of ["AP ", "AP -52", "AP x shop", "AP -60\t", "AP -60\t484", "AP -60\tzz", "AP -60\t0a41",
    "AP -60\tff", "AP -52 " + "a".repeat(33), "APDONE", "WCFG UP shop", null]) {
    assert.equal(parseApLine(bad), null, String(bad));
  }
});

test("搜索结果过一遍 AT 模式的手机那一层：名字一个字不差，没有多出来的行", () => {
  const names = ["shop 5G", "HOTEL 5G", "Office AP 2", "MY ACK net", "CFG lab", "OCPP test", "a,b c",
    "TEL", "tail ", " lead", "APDONE-x", "x ORDDONE", "充电站 2F", "WIFISW 1", "_net,,", "x".repeat(32)];
  const lines = ["ACK WSCAN OK", ...names.map((ssid, i) => fwApLine(-40 - i, ssid)), "APDONE"];
  for (const stream of [atModeStream(lines), lines.join("\r\n") + "\r\n"]) {
    const got = splitFrames(stream);
    assert.equal(got[0], "ACK WSCAN OK");
    assert.equal(got[got.length - 1], "APDONE");
    const aps = got.slice(1, -1).map(parseApLine);
    assert.deepEqual(aps.map((ap) => ap && ap.ssid), names);
    assert.deepEqual(aps.map((ap) => ap.rssi), names.map((_, i) => String(-40 - i)));
  }
  /* 原来的写法：HOTEL 5G 被切成 "AP -60 HO" 和一行假的 "TEL 5G"（App 当成遥测开关关了）。 */
  assert.deepEqual(splitFrames(atModeStream(["AP -60 HOTEL 5G"])), ["AP -60 HO", "TEL 5G"]);
});

test("协议文档：搜索结果两种写法、联网开关关着时 WSCAN 回 FAIL", () => {
  assert.match(doc, /`AP -60⇥484f54454c203547`/);
  assert.match(doc, /`WIFISWSET⇥1`、`OCPPSWSET⇥1`、`LTESET⇥1`、`WJOIN`、`WSCAN` 都回 `FAIL`/);
});
