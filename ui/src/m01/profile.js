/* 机型一键配置。存在手机上，不绑定某一台桩的地址。
 *
 * 一份配置按下面的顺序一项一项读、一项一项写，命令见 文档/04-协议/M01蓝牙协议.md。
 * 只有 M01 有的配置项。 */

import { PARALLEL_MODES, PORT_COUNT, parallelPorts, parsePar, parseParSet, parsePay, parsePlim, parsePortAck, payCommand, plimCommand } from "./ports.js";

/* 固件有没有某项能力（fw-compat.js 的 supports 绑上这台桩）。不传就当什么都有。
 * 哪一项整项要哪种能力见 fw-compat.js 的 SECTION_NEEDS，由 App.vue 在跑之前判断、跳过；
 * 这里只管一项之内的差别：老固件的 PAYSET 不带持续秒数、不认 wss:// 地址。 */
function allCaps() {
  return true;
}

export const SECTIONS = [
  { key: "safety", name: "过压欠压保护" },
  { key: "plim", name: "功率上限" },
  /* 离线收费模型（1 不退费 / 2 可退费）和充满自停的门槛。 */
  { key: "pay", name: "充电规则" },
  { key: "ocfw", name: "OCPP上报版本号" },
  { key: "tel", name: "遥测" },
  { key: "netstop", name: "断网停充" },
  { key: "net", name: "网络设置" },
  { key: "ocpp", name: "OCPP设置" },
  /* 4G 的 APN。只带 Protocol、APN、账号、密码，不带 4G 开关：开关和 WiFi、遥测互斥，照着
   * 备份去拨会把这台桩正在用的那条链路关掉。 */
  { key: "apn", name: "4G APN" },
  /* 时区放最后：前面几项把联网开关写好以后再写。三个联网开关都关着时，手机的授时会把它
   * 改回手机的时区（下发期间 App 的心跳不带时间，读回核对不受影响）。 */
  { key: "tz", name: "时区设置" },
  /* 并充放在最最后：改了要重启才生效。下发时用 PARSET\t<模式>\t0 只保存、不重启，读回核对
   * 完，整份配置都写完以后 App 再发 REBOOT（见 App.vue 的 runProfileJob）。 */
  { key: "par", name: "并充" },
];

/* 这一项这次要不要跳过。要跳过返回原因（界面上写“已跳过”，不算失败），不跳过返回 ""。
 * 下发时这份备份里没有这一项（旧 App 存的备份）就跳过。 */
export function sectionSkip(section, mode, body, ports) {
  if (mode !== "write") return "";
  if (section.key === "apn" && !(body && body.apn)) return "这份配置里没有这一项";
  if (section.key === "plim" && !(body && Array.isArray(body.plim))) return "这份配置里没有这一项";
  /* 功率上限是按端口存的。备份时的端口数（并充模式）和这台桩现在的不一样时不下发：
   * 并充模式写下去、桩重启以后再下发一次，这一项就对上了。ports 不知道（旧固件）时不拦。 */
  if (section.key === "plim" && Number.isInteger(ports) && body.plim.length !== ports) {
    return "这份配置的端口数和充电桩现在的不一样";
  }
  if (section.key === "pay" && !(body && body.pay)) return "这份配置里没有这一项";
  if (section.key === "par" && !(body && Number.isInteger(body.par))) return "这份配置里没有这一项";
  if (section.key === "tz" && !(body && Number.isInteger(body.tz))) return "这份配置里没有这一项";
  return "";
}

export function blankBody() {
  return {
    safety: { over: 0, under: 0 },
    plim: null,             /* 读到才有：每个端口一个整数，单位 W（并充时是 5 / 3 / 2 个） */
    pay: null,              /* 读到才有：{ model: 1 | 2, fullW } 收费模型和充满自停门槛 */
    par: null,              /* 读到才有：并充模式 1 | 2 | 3 | 5（桩里保存的那个） */
    plimRange: null,        /* 读的时候桩报的 { min, max }，只是记下来，不下发 */
    ocfw: { on: false, text: "" },
    tel: false,
    netstop: { on: false, sec: 60 },
    wifi: { on: false, ssid: "", pass: "" },
    ocpp: { on: false, url: "" },
    apn: null,              /* 读到才有：{ proto, apn, user, pass } */
    tz: null,               /* 读到才有：相对 UTC 的分钟数 */
  };
}

export function cleanProfileName(text) {
  const name = String(text || "").replace(/[\r\n\t]/g, " ").trim();
  if (!name || [...name].length > 32) return "";
  return name;
}

function utf8len(text) {
  return new TextEncoder().encode(String(text || "")).length;
}

/* 过压、欠压的出厂默认值：额定 230 V 的 1.1 倍和 0.9 倍。桩没存过时回的也是这两个数。 */
export const DEFAULT_OVER_V = 253;
export const DEFAULT_UNDER_V = 207;

/* 过压、欠压能不能保存。规则和固件一样（协议文档 5.4）：
 * 欠压不低于 100 V，过压不超过 320 V，过压至少比欠压高 10 V。按整数伏发给桩，
 * 所以先四舍五入再比。可以保存返回空串，否则返回要显示的原因。 */
export function voltageLimitError(over, under) {
  const text = [over, under].map((v) => String(v === null || v === undefined ? "" : v).trim());
  if (text.some((v) => v === "")) return "请把过压和欠压填成数字";
  const o = Math.round(Number(text[0]));
  const u = Math.round(Number(text[1]));
  if (!Number.isFinite(o) || !Number.isFinite(u)) return "请把过压和欠压填成数字";
  if (o <= u) return "没有保存。过压必须大于欠压";
  if (u < 100) return "没有保存。欠压不能低于 100 V";
  if (o > 320) return "没有保存。过压不能超过 320 V";
  if (u + 10 > o) return "没有保存。过压至少要比欠压高 10 V";
  return "";
}

function validSafety(s) {
  return !!s && voltageLimitError(s.over, s.under) === "";
}

/* 平台地址：ws:// 或 wss://（2.7.1 的固件起，TLS 在模组里做，不校验服务器证书），
 * 大小写都行；不能有空白；8 到 127 个字节。固件里是 wb2.c 的 ocpp_url_apply()。 */
export function ocppUrlOk(url) {
  const size = utf8len(url);
  return /^wss?:\/\//i.test(url) && !/[\s]/.test(url) && size >= 8 && size <= 127;
}

function validOcpp(url) {
  if (!url) return true;
  return ocppUrlOk(url);
}

function validOcfw(text) {
  const value = String(text || "");
  return value.length <= 20 && (value.length === 0 || !/[^\x21-\x7E]/.test(value));
}

function validWifi(wifi) {
  if (!wifi) return false;
  const ssid = String(wifi.ssid || "");
  const pass = String(wifi.pass || "");
  if (/[\t\r\n]/.test(ssid + pass)) return false;
  if (utf8len(ssid) > 32 || utf8len(pass) > 32) return false;
  if (!ssid && pass) return false;
  return true;
}

/* APN、账号、密码：最长 32 个可见 ASCII（不含空格），不能有双引号。和 lte.js、固件一样。 */
function validApnText(text) {
  const value = String(text == null ? "" : text);
  return value.length <= 32 && !/[^\x21-\x7E]/.test(value) && value.indexOf("\"") < 0;
}

function validApn(apn) {
  return !!apn && [0, 1, 2].indexOf(Number(apn.proto)) >= 0 && /^[012]$/.test(String(apn.proto)) &&
    validApnText(apn.apn) && validApnText(apn.user) && validApnText(apn.pass);
}

function parseApnLine(line, body) {
  if (line.indexOf("ACK APN ") !== 0) return false;
  const part = line.replace(/[\r\n]+$/, "").slice(8).split("\t");
  const apn = {
    proto: Number(part[0].trim()),
    apn: part.length > 1 ? part[1] : "",
    user: part.length > 2 ? part[2] : "",
    pass: part.length > 3 ? part[3] : "",
  };
  if (!/^[012]$/.test(part[0].trim()) || !validApn(apn)) return false;
  body.apn = apn;
  return true;
}

export function ackReason(line) {
  if (!line) return "回复超时";
  return "充电桩没有接受";
}

function readStep(command, accept, take) {
  return {
    command,
    accept,
    ok: (line, body) => take(line, body),
    reason: (line) => (line ? "回复内容不能用" : "回复超时"),
  };
}

function ackStep(command, token) {
  const head = "ACK " + token;
  return {
    command,
    accept: (line) => line.indexOf(head) === 0,
    ok: (line) => /^ACK [A-Z]+ OK\s*$/.test(line),
    reason: ackReason,
  };
}

/* "CFG <过压 V> <欠压 V>"，整数伏。后面多出来的字段不看。 */
function parseSafety(line, body) {
  const part = line.trim().split(/\s+/);
  if (part[0] !== "CFG" || part.length < 3) return false;
  if (!/^\d{2,3}$/.test(part[1]) || !/^\d{2,3}$/.test(part[2])) return false;
  body.safety = { over: Number(part[1]), under: Number(part[2]) };
  return validSafety(body.safety);
}

/* 端口数：不并充是 10，并充时是 5 / 3 / 2。 */
function validPortCount(n) {
  return PARALLEL_MODES.some((mode) => parallelPorts(mode) === n);
}

function parsePlimLine(line, body) {
  const got = parsePlim(line);
  if (!got || !validPortCount(got.count)) return false;
  body.plim = got.limits.slice();
  body.plimRange = { min: got.min, max: got.max };
  return true;
}

function validPlim(list) {
  return Array.isArray(list) && validPortCount(list.length) &&
    list.every((w) => Number.isInteger(w) && w > 0 && w <= 99999);
}

/* 充电规则：收费模型 1 / 2，充满门槛（W），低载秒数。范围由桩检查，这里只挡明显不对的。
 * 旧备份没有 hold：下发时不带秒数，桩保持现在的值。 */
function validPay(pay) {
  if (!pay || (pay.model !== 1 && pay.model !== 2)) return false;
  if (!Number.isInteger(pay.fullW) || pay.fullW < 1 || pay.fullW > 9999) return false;
  if (pay.hold === undefined) return true;
  return Number.isInteger(pay.hold) && pay.hold >= 1 && pay.hold <= 99999;
}

function parsePayLine(line, body) {
  const got = parsePay(line);
  if (!got || got.model > 2) return false;
  body.pay = { model: got.model, fullW: got.fullW, hold: got.hold };
  return validPay(body.pay);
}

/* 并充：备份的是桩里保存的模式（重启后生效的那个），不是这次运行的。 */
function parseParLine(line, body) {
  const got = parsePar(line);
  if (!got) return false;
  body.par = got.saved;
  return true;
}

function validPar(mode) {
  return PARALLEL_MODES.indexOf(mode) >= 0;
}

/* 整份配置下发完以后要不要让桩重启：PARGET 的应答里保存的模式和这次运行的不一样。 */
export function profileWantsReboot(line) {
  const got = parsePar(line);
  return !!got && got.saved !== got.mode;
}

/* PARGET 的应答 → 这台桩现在有几路；不认识的行返回 null。 */
export function profilePorts(line) {
  const got = parsePar(line);
  return got ? got.ports : null;
}

function parseTzLine(line, body) {
  const m = /^ACK TZ ([+-]?\d{1,4})\s*$/.exec(line);
  const tz = m ? parseInt(m[1], 10) : NaN;
  if (!Number.isInteger(tz) || tz < -720 || tz > 840) return false;
  body.tz = tz;
  return true;
}

function parseFlagText(line, head, limit, check) {
  if (line.indexOf(head) !== 0) return null;
  const rest = line.slice(head.length);
  const tab = rest.indexOf("\t");
  const flag = (tab < 0 ? rest : rest.slice(0, tab)).trim();
  const text = tab < 0 ? "" : rest.slice(tab + 1);
  if (flag !== "0" && flag !== "1") return null;
  if (text.length > limit || !check(text)) return null;
  return { on: flag === "1", text };
}

function parseOcfw(line, body) {
  const parsed = parseFlagText(line, "OCFW ", 20, validOcfw);
  if (!parsed) return false;
  body.ocfw = parsed;
  return true;
}

function parseTel(line, body) {
  const matched = /^TEL ([01])$/.exec(line.trim());
  if (!matched) return false;
  body.tel = matched[1] === "1";
  return true;
}

function parseNetStop(line, body) {
  const matched = /^NETSTOP ([01]) (\d+)$/.exec(line.trim());
  if (!matched) return false;
  const sec = Number(matched[2]);
  if (sec < 10 || sec > 600) return false;
  body.netstop = { on: matched[1] === "1", sec };
  return true;
}

function parseWifiSwitch(line, body) {
  const matched = /^WIFISW ([01])$/.exec(line.trim());
  if (!matched) return false;
  body.wifi.on = matched[1] === "1";
  return true;
}

function parseWcfg(line, body) {
  if (line.indexOf("WCFG ") !== 0) return false;
  const rest = line.slice(5);
  const space = rest.indexOf(" ");
  const link = (space < 0 ? rest : rest.slice(0, space)).trim();
  let ssid = space < 0 ? "" : rest.slice(space + 1).trim();
  if (["UP", "JOINING", "FAIL", "DOWN"].indexOf(link) < 0) return false;
  if (ssid === "-") ssid = "";
  body.wifi.ssid = ssid;
  return validWifi(body.wifi);
}

/* "ACK WPASSGET " 加密码的十六进制，没有密码时是 "-"。按十六进制发是因为密码里可以有空格：
 * 原样发时，里面一段 "AP " 或 "ACK " 会被蓝牙层当成下一行的开头。 */
function acceptWpass(line) {
  return line.indexOf("ACK WPASSGET") === 0;
}

export function hexToText(hex) {
  const text = String(hex || "");
  if (text.length % 2 !== 0 || /[^0-9a-fA-F]/.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    return null;
  }
}

function parseWpass(line, body) {
  if (line.indexOf("ACK WPASSGET") !== 0) return false;
  const rest = line.slice(12).trim();
  if (rest === "-" || rest === "") body.wifi.pass = "";
  else {
    const pass = hexToText(rest);
    if (pass === null) return false;
    body.wifi.pass = pass;
  }
  return validWifi(body.wifi);
}

function parseOcppSwitch(line, body) {
  const matched = /^OCPPSW ([01])$/.exec(line.trim());
  if (!matched) return false;
  body.ocpp.on = matched[1] === "1";
  return true;
}

function parseOcppUrl(line, body) {
  if (line.indexOf("OCPP ") !== 0) return false;
  let url = line.slice(5).trim();
  if (url === "-") url = "";
  if (!validOcpp(url)) return false;
  body.ocpp.url = url;
  return true;
}

export function readPlan(key) {
  switch (key) {
    case "safety":
      return { list: [readStep("CFGGET", (line) => line.indexOf("CFG ") === 0, parseSafety)] };
    case "plim":
      return { list: [readStep("PLIMGET", (line) => parsePlim(line) !== null, parsePlimLine)] };
    case "pay":
      return { list: [readStep("PAYGET", (line) => /^ACK PAY\t/.test(line), parsePayLine)] };
    case "par":
      return { list: [readStep("PARGET", (line) => /^ACK PAR\t/.test(line), parseParLine)] };
    case "ocfw":
      return { list: [readStep("OCFWGET", (line) => line.indexOf("OCFW ") === 0, parseOcfw)] };
    case "tel":
      return { list: [readStep("TELGET", (line) => line.indexOf("TEL ") === 0, parseTel)] };
    case "netstop":
      return { list: [readStep("NETSTOPGET", (line) => line.indexOf("NETSTOP ") === 0, parseNetStop)] };
    case "net":
      return {
        list: [
          readStep("WIFISWGET", (line) => line.indexOf("WIFISW ") === 0, parseWifiSwitch),
          readStep("WCFGGET", (line) => line.indexOf("WCFG ") === 0, parseWcfg),
          readStep("WPASSGET", acceptWpass, parseWpass),
        ],
      };
    case "ocpp":
      return {
        list: [
          readStep("OCPPSWGET", (line) => line.indexOf("OCPPSW ") === 0, parseOcppSwitch),
          readStep("OCPPGET", (line) => line.indexOf("OCPP ") === 0, parseOcppUrl),
        ],
      };
    case "apn":
      return { list: [readStep("APNGET", (line) => line.indexOf("ACK APN ") === 0, parseApnLine)] };
    case "tz":
      return { list: [readStep("TZGET", (line) => /^ACK TZ(\s|$)/.test(line), parseTzLine)] };
    default:
      return { error: "这份配置里没有这一项" };
  }
}

function safetyCommand(body) {
  if (!validSafety(body.safety)) return { error: "保护参数不能用" };
  const s = body.safety;
  const command = "CFGSET\t" + Math.round(Number(s.over)) + "\t" + Math.round(Number(s.under));
  return { list: [ackStep(command, "CFGSET")] };
}

/* PLIMSET 的应答是 "ACK PLIMSET\t<端口>\t<结果>"，成功后桩再补一行 ACK PLIM。10 路的值都一样
 * 时用端口 0 一条命令设完，否则一路一条。 */
function plimStep(port, watts) {
  const mine = (line) => {
    const ack = parsePortAck(line);
    return ack !== null && ack.cmd === "PLIMSET" && ack.port === port;
  };
  return {
    command: plimCommand(port, watts),
    accept: mine,
    ok: (line) => parsePortAck(line).result === "OK",
    reason: (line) => {
      if (!line) return "回复超时";
      const result = parsePortAck(line).result;
      if (result === "RANGE") return "数值不在这台桩允许的范围内";
      if (result === "FLASH") return "充电桩没有写进存储";
      return "充电桩没有接受";
    },
  };
}

function plimPlan(body) {
  if (!validPlim(body.plim)) return { error: "这份配置里没有这一项" };
  const same = body.plim.every((w) => w === body.plim[0]);
  if (same) return { list: [plimStep(0, body.plim[0])] };
  return { list: body.plim.map((w, index) => plimStep(index + 1, w)) };
}

function netCommand(body) {
  if (!body.wifi || !validWifi(body.wifi)) return { error: "名称或密码不能用，最长 32 字节" };
  const list = [];
  const ssid = String(body.wifi.ssid || "");
  const pass = String(body.wifi.pass || "");
  if (ssid) list.push(ackStep("WSAVE\t" + ssid + "\t" + pass, "WSAVE"));
  /* 打开并且刚保存过热点时，桩会等大约 5 秒再连接，这段时间把 OCPP 开关写完。 */
  list.push(ackStep("WIFISWSET\t" + (body.wifi.on ? "1" : "0"), "WIFISWSET"));
  return { list };
}

function ocppCommand(body, can) {
  if (!body.ocpp || typeof body.ocpp.on !== "boolean") return { error: "这份配置里没有这一项" };
  const url = String(body.ocpp.url || "");
  if (!validOcpp(url)) return { error: "地址需要是 ws(s)://主机/路径，最长 127 字节" };
  /* 1.3.0 以前的固件不认 wss://：发下去也是 FAIL。不发，说清楚原因。 */
  if (/^wss:/i.test(url) && !can("ocppWss")) return { error: "wss", lack: "ocppWss" };
  const list = [];
  if (url) list.push(ackStep("OCPPSET\t" + url, "OCPPSET"));
  list.push(ackStep("OCPPSWSET\t" + (body.ocpp.on ? "1" : "0"), "OCPPSWSET"));
  return { list };
}

function payPlan(body, can) {
  if (!body.pay) return { error: "这份配置里没有这一项" };
  if (!validPay(body.pay)) return { error: "数值不在这台桩允许的范围内" };
  /* 1.3.2 以前的固件 PAYSET 只认两个参数，带了持续秒数回 FAIL：不带，桩保持它自己的值。 */
  const hold = can("payHold") ? body.pay.hold : undefined;
  return {
    list: [{
      command: payCommand(body.pay.model, body.pay.fullW, hold),
      accept: (line) => /^ACK PAYSET /.test(line),
      ok: (line) => /^ACK PAYSET OK\s*$/.test(line),
      reason: (line) => (line ? "数值不在这台桩允许的范围内" : "回复超时"),
    }],
  };
}

/* 只保存、不重启（第二个参数 0）。有端口在充时桩回 BUSY。 */
function parPlan(body) {
  if (!validPar(body.par)) return { error: "这份配置里没有这一项" };
  return {
    list: [{
      command: "PARSET\t" + body.par + "\t0",
      accept: (line) => parseParSet(line) !== null,
      ok: (line) => parseParSet(line) === "OK",
      reason: (line) => {
        if (!line) return "回复超时";
        return parseParSet(line) === "BUSY" ? "有端口正在充电，不能切换" : "充电桩没有接受";
      },
    }],
  };
}

/* can：这台桩有没有某项能力（见文件开头）。返回 { list } 或 { error }；error 是 "wss" 时
 * 带 lack（缺的能力名），界面用 fw-compat.js 的 lackNote 出字。 */
export function writePlan(key, body, can) {
  const has = typeof can === "function" ? can : allCaps;
  if (!body) return { error: "这份配置里没有这一项" };
  switch (key) {
    case "safety":
      return safetyCommand(body);
    case "plim":
      return plimPlan(body);
    case "pay":
      return payPlan(body, has);
    case "par":
      return parPlan(body);
    case "ocfw":
      if (!body.ocfw || !validOcfw(body.ocfw.text)) return { error: "没有保存。版本号最长 20 位，只能是可见英文字符" };
      return { list: [ackStep("OCFWSET\t" + (body.ocfw.on ? "1" : "0") + "\t" + body.ocfw.text, "OCFWSET")] };
    case "tel":
      if (typeof body.tel !== "boolean") return { error: "这份配置里没有这一项" };
      return { list: [ackStep("TELSET\t" + (body.tel ? "1" : "0"), "TELSET")] };
    case "netstop": {
      const sec = Number(body.netstop && body.netstop.sec);
      if (!body.netstop || !Number.isInteger(sec) || sec < 10 || sec > 600) {
        return { error: "没有保存。时长只能是 10 到 600 秒" };
      }
      return { list: [ackStep("NETSTOPSET\t" + (body.netstop.on ? "1" : "0") + "\t" + sec, "NETSTOPSET")] };
    }
    case "net":
      return netCommand(body);
    case "ocpp":
      return ocppCommand(body, has);
    case "apn":
      if (!body.apn) return { error: "这份配置里没有这一项" };
      if (!validApn(body.apn)) {
        return { error: "没有保存。APN 名称、账号、密码最长 32 个可见英文字符，不能有空格和双引号" };
      }
      return {
        list: [ackStep("APNSET\t" + Number(body.apn.proto) + "\t" + String(body.apn.apn || "") + "\t" +
          String(body.apn.user || "") + "\t" + String(body.apn.pass || ""), "APNSET")],
      };
    case "tz": {
      const tz = body.tz;
      if (!Number.isInteger(tz) || tz < -720 || tz > 840) return { error: "这份配置里没有这一项" };
      return { list: [ackStep("TZSET\t" + tz, "TZSET")] };
    }
    default:
      return { error: "这份配置里没有这一项" };
  }
}

/* 下发后读回来核对。want 是手机上存的那份，got 是刚从桩里读回来的。
 * 只比这一项真正写下去的内容：热点名或平台地址是空的时候没有发保存命令，桩里原来
 * 的值不动，这时不比；老固件没有下发持续秒数（can("payHold") 为假），也不比。 */
export function sameSection(key, want, got, can) {
  const has = typeof can === "function" ? can : allCaps;
  if (!want || !got) return false;
  switch (key) {
    case "safety": {
      const a = want.safety;
      const b = got.safety;
      if (!a || !b) return false;
      /* 电压按整数伏存。 */
      return Math.round(Number(a.over)) === Number(b.over) && Math.round(Number(a.under)) === Number(b.under);
    }
    case "plim":
      return validPlim(want.plim) && validPlim(got.plim) &&
        want.plim.every((w, index) => w === got.plim[index]);
    case "pay":
      return validPay(want.pay) && validPay(got.pay) &&
        want.pay.model === got.pay.model && want.pay.fullW === got.pay.fullW &&
        (!Number.isInteger(want.pay.hold) || !has("payHold") || want.pay.hold === got.pay.hold);
    case "par":
      return validPar(want.par) && want.par === got.par;
    case "ocfw":
      return !!want.ocfw && !!got.ocfw && !!want.ocfw.on === !!got.ocfw.on &&
        String(want.ocfw.text || "") === String(got.ocfw.text || "");
    case "tel":
      return want.tel === got.tel;
    case "netstop":
      return !!want.netstop && !!got.netstop && !!want.netstop.on === !!got.netstop.on &&
        Number(want.netstop.sec) === Number(got.netstop.sec);
    case "net": {
      if (!want.wifi || !got.wifi) return false;
      if (!!want.wifi.on !== !!got.wifi.on) return false;
      if (!String(want.wifi.ssid || "")) return true;
      return String(want.wifi.ssid) === String(got.wifi.ssid || "") &&
        String(want.wifi.pass || "") === String(got.wifi.pass || "");
    }
    case "ocpp": {
      if (!want.ocpp || !got.ocpp) return false;
      if (!!want.ocpp.on !== !!got.ocpp.on) return false;
      if (!String(want.ocpp.url || "")) return true;
      return String(want.ocpp.url) === String(got.ocpp.url || "");
    }
    case "apn":
      return !!want.apn && !!got.apn && Number(want.apn.proto) === Number(got.apn.proto) &&
        String(want.apn.apn || "") === String(got.apn.apn || "") &&
        String(want.apn.user || "") === String(got.apn.user || "") &&
        String(want.apn.pass || "") === String(got.apn.pass || "");
    case "tz":
      return Number.isInteger(want.tz) && want.tz === got.tz;
    default:
      return false;
  }
}
