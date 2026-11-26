/* M01 的 10 路输出：整桩状态、10 路概况、单路详情、功率上限、订单。
 *
 * 格式见 文档/04-协议/M01蓝牙协议.md，和固件 app/src/wb2.c 的 fill_sys()、fill_ports()、
 * ble_handle_command() 一致。这几行都以 "ACK " 开头，字段之间是制表符：
 *   ACK SYS\t<固件版本>\t<端口数>\t<母线 V 或 ->\t<板温 ℃ 或 ->\t<市电 0|1>\t<WiFi dBm 或 ->
 *          \t<WiFi 状态>\t<OCPP 状态>\t<桩时间或 ->\t<热点名或 ->
 *   ACK PORTS\t<端口数>\t<s>,<W>,<Wh>,<秒>;…（按端口 1..N）
 *   ACK PORTX\t<端口数>\t<电流 0.01 A>,<离线刷卡余额 分 或 ->;…（按端口 1..N）
 *   ACK PORT\t<端口>\t<s>\t<V>\t<A>\t<W>\t<本单 Wh>\t<本单秒>\t<累计 Wh>\t<上限 W>
 *           \t<最近停止原因>\t<最近故障码>\t<启动渠道>\t<User 或 ->\t<现在的故障码>
 *           \t<收费模型 0|1|2>\t<刷进去的 毫元>\t<已用电费 毫元>\t<余额 毫元>\t<单价 毫元/kWh>
 *           \t<距充满自停还有几秒，0 = 没在计>
 *   ACK PAY\t<硬件开关 bit0 联网 bit1 离线刷卡>\t<收费模型 1|2>\t<充满门槛 W>\t<下限>\t<上限>
 *          \t<持续秒数>\t<绑定的运营商 32 位十六进制 或 ->\t<秒数下限>\t<秒数上限>
 *   ACK PAYSET OK|FAIL
 *   ACK PAR\t<这次运行的并充模式 1|2|3|5>\t<现在的端口数>\t<保存的模式>
 *   ACK PARSET OK|BUSY|FAIL
 *   ACK PORT\t<端口>\tPORT                     端口号不对
 *   ACK START|STOP|PORTSEL|PLIMSET\t<端口>\t<结果>
 *   ACK PLIM\t<端口数>\t<最小 W>\t<最大 W>\t<w1>,<w2>,…
 *   ACK ORD\t<序号>\t<端口>\t<开始>\t<结束>\t<Wh>\t<最大功率 W>\t<停止原因或故障名>\t<时长秒>
 *          \t<启动渠道>\t<User 或 ->\t<订单号或 ->
 *          \t<收费模型 0|1|2>\t<刷进去的 毫元>\t<电费 毫元>\t<待退费 0|1>
 *   ACK ORDN\t<订单总数>\t<这一批的起始序号>\t<这一批的条数>      在 ORDDONE 前面
 *   FLT <NONE 或 名字+名字…>
 * 以后固件可能在行尾加字段：按序号取，多出来的不看。
 * 这里的中文都是翻译的键（i18n.js / packs-m01.js）。 */

export const PORT_COUNT = 10;
export const PORT_MAX = 16;             /* 一行里最多认这么多路，防着坏数据 */
export const ORDER_MAX = 32;             /* 一次 ORDGET 最多回这么多条 */
export const ORDER_KEEP = 1500;          /* 手机上最多留这么多条（桩里的订单历史约 1400 条） */
export const ORDER_INDEX_MAX = 65534;
export const ORDER_RUNNING = 0xFFFFFFFF; /* 还在充的订单，时长是这个数 */
export const PORTSEL_SECONDS = 30;       /* 选枪的有效期，固件 M01_PORT_SELECT_S */

function clean(line) {
  return typeof line === "string" ? line.replace(/[\r\n]+$/, "") : null;
}
function fields(line, head) {
  const text = clean(line);
  if (text === null) return null;
  const part = text.split("\t");
  return part[0] === head ? part : null;
}
function uintOf(text, max) {
  const raw = String(text == null ? "" : text).trim();
  if (!/^\d{1,10}$/.test(raw)) return null;
  const value = parseInt(raw, 10);
  return value <= (max === undefined ? 0xFFFFFFFF : max) ? value : null;
}
function numOf(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!/^-?\d{1,7}(?:\.\d{1,3})?$/.test(raw)) return null;
  return Number(raw);
}
function word(text) {
  const out = String(text == null ? "" : text).trim();
  return out === "-" ? "" : out;
}

/* ------------------------------------------------------------------ 状态字母 */

/* kind 决定颜色：idle 空闲、on 在充、hold 暂停或被占、busy 正在收口、off 停用、bad 故障。 */
const STATUS = {
  P: { name: "Preparing", label: "空闲", kind: "idle" },
  C: { name: "Charging", label: "充电中", kind: "on" },
  S: { name: "SuspendedEVSE", label: "暂停输出", kind: "hold" },
  F: { name: "Finishing", label: "结束中", kind: "busy" },
  R: { name: "Reserved", label: "已预约", kind: "hold" },
  U: { name: "Unavailable", label: "停用", kind: "off" },
  X: { name: "Faulted", label: "故障", kind: "bad" },
};
export const STATUS_LETTERS = Object.keys(STATUS);

/* "C" → { letter, name: "Charging", label: "充电中", kind: "on" }。不认识的字母按“未知”。 */
export function portStatus(letter) {
  const found = STATUS[letter];
  if (found) return { letter, name: found.name, label: found.label, kind: found.kind };
  return { letter: String(letter || ""), name: "Unknown", label: "未知", kind: "off" };
}

/* 这一路这一单还在（在充，或被平台限到 0）。 */
export function portBusy(letter) {
  return letter === "C" || letter === "S";
}

/* ------------------------------------------------------------------ 取值表 */

/* 故障码 → 名字。和固件 charge_control_fault_name() 同一张表，下标就是故障码，
 * null 是不用的编号（1–5、14、15），和超出表的码一样当没有故障。 */
export const FAULT_NAMES = [
  "NONE", null, null, null, null, null,
  "OVERTEMP", "NTC", "METER", "RELAY", "WELDED",
  "OV", "UV", "OC", null, null, "OVERPOWER", "NOHW",
];
export function faultName(code) {
  const n = Number(code);
  return (Number.isInteger(n) && n >= 0 && n < FAULT_NAMES.length && FAULT_NAMES[n]) || "NONE";
}

/* 每个故障名的说明。不认识的名字照名字显示。 */
const FAULT_LABELS = {
  OVERTEMP: "板温过高",
  NTC: "温度传感器故障",
  METER: "计量故障",
  RELAY: "继电器没有吸合",
  WELDED: "继电器粘连",
  OV: "过压",
  UV: "欠压",
  OC: "过流",
  OVERPOWER: "超过功率上限",
  NOHW: "硬件未配置",
};
/* 故障名或故障码 → 界面上的字。没有故障返回 ""；不认识的名字原样返回。 */
export function faultLabel(token) {
  let name = String(token == null ? "" : token).trim();
  if (/^\d+$/.test(name)) name = faultName(parseInt(name, 10));
  if (!name || name === "NONE") return "";
  return FAULT_LABELS[name] || name;
}

const STOP_LABELS = {
  USER: "用户停止",
  SAFETY: "故障停止",
  OVERPOWER: "超过功率上限",
  PORT_FAULT: "端口故障",
  FULL: "充满自停",
  NOMONEY: "余额用完",
  CARD: "刷卡停止",
  BLE: "蓝牙停止",
  REMOTE: "远程停止",
  PANEL: "触摸板停止",
  DEBUG: "调试口停止",
  POWER_LOSS: "掉电停止",
  OFFLINE: "断网停止",
  UNKNOWN: "未知",
};
/* 停止原因名 → 界面上的字。NONE（还没停过，或这一单还在充）返回 ""。 */
export function stopLabel(name) {
  const key = String(name == null ? "" : name).trim();
  if (!key || key === "NONE") return "";
  return STOP_LABELS[key] || key;
}

const START_LABELS = {
  PRIV: "特权卡",
  WHITE: "白名单卡",
  CARD: "平台刷卡",
  APP: "APP远程",
  BLE: "蓝牙",
  DEBUG: "调试口",
  PANEL: "触摸板",
  OFFCARD: "离线刷卡",
};
/* 启动渠道名 → 界面上的字。UNKNOWN（上电后还没有过订单）返回 ""。 */
export function startLabel(name) {
  const key = String(name == null ? "" : name).trim();
  if (!key || key === "UNKNOWN") return "";
  return START_LABELS[key] || key;
}

/* 订单第 7 个字段：有故障码的单是故障名，否则是停止原因名；还在充是 NONE（返回 ""）。 */
export function orderReasonLabel(token) {
  const key = String(token == null ? "" : token).trim();
  if (!key || key === "NONE") return "";
  if (STOP_LABELS[key]) return STOP_LABELS[key];
  return faultLabel(key);
}

/* ------------------------------------------------------------------ 每秒推送的行 */

/* "FLT NONE" → []；"FLT NTC+UV" → ["NTC", "UV"]；不是这一行返回 null。 */
export function parseFlt(line) {
  const text = clean(line);
  if (text === null || text.indexOf("FLT ") !== 0) return null;
  const body = text.slice(4).trim();
  if (!body || body === "NONE") return [];
  return body.split("+").map((name) => name.trim()).filter((name) => /^[A-Z0-9_]{1,16}$/.test(name));
}

export function parseSys(line) {
  const part = fields(line, "ACK SYS");
  if (!part || part.length < 10) return null;
  const count = uintOf(part[2], PORT_MAX);
  if (!/^\d+\.\d+/.test(part[1]) || !count) return null;
  const rssi = /^-\d{1,3}$/.test(part[6].trim()) ? parseInt(part[6], 10) : null;
  const clock = word(part[9]);
  const temp = numOf(part[4]);
  return {
    fw: part[1].trim(),
    ports: count,
    busV: numOf(part[3]),
    tempC: temp === null ? null : Math.round(temp),
    mains: part[5].trim() === "1",
    rssi: rssi !== null && rssi >= -120 && rssi <= -1 ? rssi : null,
    wifi: word(part[7]).toUpperCase(),
    ocpp: word(part[8]).toUpperCase(),
    clock: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(clock) ? clock : "",
    /* 保存的热点名。桩把里面的空格换成了下划线，这里原样留着（见 pickSsid）。 */
    ssid: part.length > 10 ? word(part[10]) : "",
    /* 1.3.4 起：固件自己报的能力位（十六进制），老固件没有这个字段。怎么用见 fw-compat.js。 */
    caps: part.length > 11 ? part[11].trim() : "",
  };
}

/* 两个热点名是不是同一个：空格和下划线不分（ACK SYS 里空格被换成了下划线）。 */
export function sameSsid(a, b) {
  const norm = (text) => String(text == null ? "" : text).replace(/ /g, "_");
  return norm(a) === norm(b);
}

/* 界面上显示哪个热点名。ACK SYS 里的名字是完整的，但空格成了下划线，分不出原来是哪一个；
 * WCFG 行里的是原样，但名字里有 "AP "、"ACK " 这样的片段时会被蓝牙层从中间切开。
 * 两个对得上（只差空格和下划线）就用 WCFG 的，对不上用 ACK SYS 的。 */
export function pickSsid(sysSsid, wcfgSsid) {
  const full = String(sysSsid == null ? "" : sysSsid);
  const raw = String(wcfgSsid == null ? "" : wcfgSsid);
  if (raw && sameSsid(raw, full)) return raw;
  return full;
}

export function parsePorts(line) {
  const part = fields(line, "ACK PORTS");
  if (!part || part.length < 3) return null;
  const count = uintOf(part[1], PORT_MAX);
  if (!count) return null;
  const groups = part[2].split(";");
  if (groups.length < count) return null;
  const ports = [];
  for (let i = 0; i < count; i++) {
    const item = groups[i].split(",");
    const w = uintOf(item[1]);
    const wh = uintOf(item[2]);
    const sec = uintOf(item[3]);
    if (!/^[A-Z?]$/.test(item[0]) || w === null || wh === null || sec === null) return null;
    ports.push({ port: i + 1, s: item[0], w, wh, sec });
  }
  return { count, ports };
}

/* 每路的电流和离线刷卡订单的余额。a 是安培；bal 是余额（毫元），不是离线刷卡订单时是 null。 */
export function parsePortsX(line) {
  const part = fields(line, "ACK PORTX");
  if (!part || part.length < 3) return null;
  const count = uintOf(part[1], PORT_MAX);
  if (!count) return null;
  const groups = part[2].split(";");
  if (groups.length < count) return null;
  const ports = [];
  for (let i = 0; i < count; i++) {
    const item = groups[i].split(",");
    const ca = uintOf(item[0], 99999);
    const fen = item[1] === "-" ? null : uintOf(item[1]);
    if (ca === null || (item[1] !== "-" && fen === null)) return null;
    ports.push({ port: i + 1, a: ca / 100, bal: fen === null ? null : fen * 10 });
  }
  return { count, ports };
}

/* ------------------------------------------------------------------ 单路 */

export function parsePort(line) {
  const part = fields(line, "ACK PORT");
  if (!part || part.length < 3) return null;
  const port = uintOf(part[1], 9999);
  if (port === null) return null;
  if (part[2] === "PORT") return { port, error: "PORT" };
  if (part.length < 15 || !/^[A-Z?]$/.test(part[2])) return null;
  const v = numOf(part[3]);
  const a = numOf(part[4]);
  const w = numOf(part[5]);
  const wh = uintOf(part[6]);
  const sec = uintOf(part[7]);
  const meterWh = uintOf(part[8]);
  const limitW = uintOf(part[9]);
  const lastFault = uintOf(part[11], 255);
  const fault = uintOf(part[14], 255);
  if ([v, a, w, wh, sec, meterWh, limitW, lastFault, fault].some((n) => n === null)) return null;
  /* 1.1.0 起行尾多 6 个字段：离线刷卡订单的金额和充满自停的倒计时。老固件没有，按 0。 */
  const more = [15, 16, 17, 18, 19, 20].map((i) => (part.length > i ? uintOf(part[i]) : 0));
  if (more.some((n) => n === null)) return null;
  return {
    port, s: part[2], v, a, w, wh, sec, meterWh, limitW,
    lastStop: word(part[10]) || "NONE",
    lastFault,
    source: word(part[12]) || "UNKNOWN",
    user: word(part[13]),
    fault,
    payModel: more[0] === 1 || more[0] === 2 ? more[0] : 0,
    loaded: more[1], cost: more[2], balance: more[3], rate: more[4],
    fullLeft: more[5],
  };
}

/* "ACK START\t3\tOK" → { cmd: "START", port: 3, result: "OK" }。认 START、STOP、PORTSEL、
 * PLIMSET；端口号不是数字时固件回的端口是 0。 */
export function parsePortAck(line) {
  const text = clean(line);
  if (text === null) return null;
  const part = text.split("\t");
  const m = /^ACK (START|STOP|PORTSEL|PLIMSET)$/.exec(part[0]);
  if (!m || part.length < 3) return null;
  const port = uintOf(part[1], 9999);
  const result = part[2].trim();
  if (port === null || !/^[A-Z]{1,12}$/.test(result)) return null;
  return { cmd: m[1], port, result };
}

/* 结果码 → { ok, text, vars }。text 是翻译的键，vars 里的 n 是端口号。
 * 没有应答（ack 为 null）也在这里出字。 */
export function portAckText(cmd, ack, range) {
  if (!ack) return { ok: false, text: "充电桩没有应答", vars: null };
  const vars = { n: ack.port };
  const r = ack.result;
  if (r === "PORT") return { ok: false, text: "端口号不对", vars: null };
  if (cmd === "START") {
    if (r === "OK") return { ok: true, text: "第 {n} 路已启动", vars };
    if (r === "BUSY") return { ok: false, text: "第 {n} 路正在充电或正在结束，不能启动", vars };
    if (r === "FAULT") return { ok: false, text: "第 {n} 路有故障，不能启动", vars };
    if (r === "UNAVAIL") return { ok: false, text: "第 {n} 路已停用或自检还没完成，不能启动", vars };
    if (r === "RESERVED") return { ok: false, text: "第 {n} 路已被平台预约，蓝牙不能启动", vars };
    if (r === "LOCK") return { ok: false, text: "正在升级，不能启动", vars: null };
  }
  if (cmd === "STOP") {
    if (r === "OK") return ack.port === 0
      ? { ok: true, text: "正在逐路停止全部端口，几秒内停完", vars: null }
      : { ok: true, text: "第 {n} 路已停止", vars };
    if (r === "IDLE") return ack.port === 0
      ? { ok: false, text: "没有正在充电的端口", vars: null }
      : { ok: false, text: "第 {n} 路没有在充电", vars };
  }
  if (cmd === "PORTSEL") {
    if (r === "OK") return ack.port === 0
      ? { ok: true, text: "已取消选择", vars: null }
      : { ok: true, text: "已选中第 {n} 路，请在 30 秒内刷卡", vars };
  }
  if (cmd === "PLIMSET") {
    if (r === "OK") return { ok: true, text: "已保存，断电后仍然有效", vars: null };
    if (r === "RANGE") {
      return range
        ? { ok: false, text: "没有保存。功率上限只能是 {min} 到 {max} W", vars: { min: range.min, max: range.max } }
        : { ok: false, text: "数值不在这台桩允许的范围内", vars: null };
    }
    if (r === "FLASH") return { ok: false, text: "充电桩没有写进存储", vars: null };
  }
  return { ok: false, text: "充电桩没有接受", vars: null };
}

/* ------------------------------------------------------------------ 充电规则、并充 */

/* 收费模型 → 界面上的字。 */
export function payModelLabel(model) {
  return model === 2 ? "可退费" : (model === 1 ? "不退费" : "");
}

export function parsePay(line) {
  const part = fields(line, "ACK PAY");
  if (!part || part.length < 8) return null;
  const sw = uintOf(part[1], 3);
  const model = uintOf(part[2], 2);
  const fullW = uintOf(part[3], 9999);
  const min = uintOf(part[4], 9999);
  const max = uintOf(part[5], 9999);
  const hold = uintOf(part[6], 99999);
  const oper = word(part[7]).toUpperCase();
  /* 行尾两个数是低载秒数的下限和上限。老固件没有，按 10 和 3600。 */
  const holdMin = part.length > 9 ? uintOf(part[8], 99999) : 10;
  const holdMax = part.length > 9 ? uintOf(part[9], 99999) : 3600;
  if ([sw, model, fullW, min, max, hold, holdMin, holdMax].some((n) => n === null) ||
      model < 1 || min > max || holdMin > holdMax) return null;
  if (oper && !/^[0-9A-F]{32}$/.test(oper)) return null;
  return {
    offline: (sw & 2) !== 0, net: (sw & 1) !== 0, model, fullW, min, max, hold, oper,
    holdMin, holdMax,
  };
}

/* hold 不传时只发模型和门槛，桩保持原来的低载秒数。 */
export function payCommand(model, fullW, hold) {
  const head = "PAYSET\t" + model + "\t" + fullW;
  return Number.isInteger(hold) ? head + "\t" + hold : head;
}

/* "ACK PAYSET OK" → true，"ACK PAYSET FAIL" → false，别的行 → null。 */
export function parsePaySet(line) {
  const text = clean(line);
  if (text === "ACK PAYSET OK") return true;
  if (text === "ACK PAYSET FAIL") return false;
  return null;
}

export const PARALLEL_MODES = [1, 2, 3, 5];
/* 并充模式 → 整机有几路。 */
export function parallelPorts(mode) {
  return PARALLEL_MODES.indexOf(mode) >= 0 ? Math.floor(10 / mode) : 10;
}
export function parallelLabel(mode) {
  if (mode === 2) return "两路并充：5 路";
  if (mode === 3) return "三路并充：3 路，第 10 路不用";
  if (mode === 5) return "五路并充：2 路";
  return "关闭：10 路独立";
}

export function parsePar(line) {
  const part = fields(line, "ACK PAR");
  if (!part || part.length < 4) return null;
  const mode = uintOf(part[1], 5);
  const ports = uintOf(part[2], PORT_MAX);
  const saved = uintOf(part[3], 5);
  if (PARALLEL_MODES.indexOf(mode) < 0 || PARALLEL_MODES.indexOf(saved) < 0 || !ports) return null;
  return { mode, ports, saved };
}

export function parCommand(mode) {
  return "PARSET\t" + mode;
}

/* "ACK PARSET OK|BUSY|FAIL" → "OK" / "BUSY" / "FAIL"，别的行 → null。 */
export function parseParSet(line) {
  const m = /^ACK PARSET (OK|BUSY|FAIL)$/.exec(clean(line) || "");
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ 功率上限 */

export function parsePlim(line) {
  const part = fields(line, "ACK PLIM");
  if (!part || part.length < 5) return null;
  const count = uintOf(part[1], PORT_MAX);
  const min = uintOf(part[2], 99999);
  const max = uintOf(part[3], 99999);
  if (!count || min === null || max === null || min > max) return null;
  const list = part[4].split(",");
  if (list.length < count) return null;
  const limits = [];
  for (let i = 0; i < count; i++) {
    const w = uintOf(list[i], 99999);
    if (w === null) return null;
    limits.push(w);
  }
  return { count, min, max, limits };
}

/* 输入框里的字能不能当功率上限发。能发返回整数，不能返回 null。 */
export function plimValue(text, min, max) {
  const raw = String(text == null ? "" : text).trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  const w = parseInt(raw, 10);
  return w >= min && w <= max ? w : null;
}

export function plimCommand(port, watts) {
  return "PLIMSET\t" + port + "\t" + watts;
}

/* ------------------------------------------------------------------ 订单 */

export function parseOrder(line) {
  const part = fields(line, "ACK ORD");
  if (!part || part.length < 12) return null;
  const index = uintOf(part[1], ORDER_INDEX_MAX);
  const port = uintOf(part[2], PORT_MAX);
  const start = uintOf(part[3]);
  const end = uintOf(part[4]);
  const wh = uintOf(part[5]);
  const maxW = uintOf(part[6]);
  const dur = uintOf(part[8]);
  if ([index, port, start, end, wh, maxW, dur].some((n) => n === null)) return null;
  const pay = [12, 13, 14, 15].map((i) => (part.length > i ? uintOf(part[i]) : 0));
  if (pay.some((n) => n === null)) return null;
  const reason = word(part[7]) || "NONE";
  return {
    index, port, start, end, wh, maxW,
    reason,
    running: dur === ORDER_RUNNING,
    dur: dur === ORDER_RUNNING ? null : dur,
    source: word(part[9]) || "UNKNOWN",
    user: word(part[10]),
    id: word(part[11]),
    payModel: pay[0] === 1 || pay[0] === 2 ? pay[0] : 0,
    loaded: pay[1], cost: pay[2], refundDue: pay[3] === 1,
  };
}

/* "ACK ORDN\t<总数>\t<起始>\t<条数>" → { total, first, count }。 */
export function parseOrderSum(line) {
  const part = fields(line, "ACK ORDN");
  if (!part || part.length < 4) return null;
  const total = uintOf(part[1], ORDER_INDEX_MAX);
  const first = uintOf(part[2], ORDER_INDEX_MAX);
  const count = uintOf(part[3], ORDER_MAX);
  if (total === null || first === null || count === null) return null;
  return { total, first, count };
}

/* 取订单的命令。first 是 0 时发不带参数的 ORDGET（最新的 32 条，旧固件也认）；
 * 往后翻页发 ORDGET\t<起始>\t<条数>。 */
export function ordersCommand(first) {
  const from = Math.max(0, Math.floor(Number(first) || 0));
  return from === 0 ? "ORDGET" : "ORDGET\t" + from + "\t" + ORDER_MAX;
}

/* 收订单：一行一行喂进来，ORDDONE 结束一批。序号 0 再来（重新读取，或者发到一半又发了一次
 * ORDGET，桩从头重发）就清掉重收；别的序号接在后面（翻页），同一个序号后来的替掉先来的。
 * 按序号排好。total 是桩报的订单总数（ACK ORDN），旧固件没有这一行，是 null。 */
export function orderCollector() {
  let list = [];
  let done = false;
  let total = null;
  return {
    feed(line) {
      if (clean(line) === "ORDDONE") {
        done = true;
        return true;
      }
      const sum = parseOrderSum(line);
      if (sum) {
        total = sum.total;
        return true;
      }
      const order = parseOrder(line);
      if (!order) return false;
      if (order.index === 0) {
        list = [];
        total = null;
      }
      done = false;
      list = list.filter((item) => item.index !== order.index);
      if (list.length < ORDER_KEEP) list.push(order);
      list.sort((a, b) => a.index - b.index);
      return true;
    },
    list: () => list.slice(),
    done: () => done,
    total: () => total,
    /* 下一页从哪个序号开始：已经收到的最大序号加 1。 */
    next: () => (list.length ? list[list.length - 1].index + 1 : 0),
    /* 桩里还有没读的。 */
    more: () => done && total !== null && list.length > 0 &&
      list[list.length - 1].index + 1 < total && list.length < ORDER_KEEP,
  };
}

/* 离线刷卡订单的金额，充电记录页一条订单下面的几行：[{ label, milli }]。label 是翻译的键，
 * milli 是毫元（没有金额的行是 null）。不是离线刷卡的订单返回空表。
 *   可退费的订单结束后：余额还没退回卡里 → "待退费" 和金额；已经退了、蓝牙停掉不再退、
 *   或者正好用完 → "已结清"。不退费的订单结束后剩下的钱 → "剩余不退"。
 * 还在充的订单只有刷进去的钱：电费要等结束才定。 */
export function orderPayRows(order) {
  if (!order || !order.payModel) return [];
  const rows = [
    { label: "收费模型", text: payModelLabel(order.payModel), milli: null },
    { label: "刷卡金额", text: "", milli: order.loaded },
  ];
  if (order.running) return rows;
  const left = Math.max(0, order.loaded - order.cost);
  rows.push({ label: "电费", text: "", milli: order.cost });
  if (order.payModel === 2) {
    if (order.refundDue) rows.push({ label: "待退费", text: "", milli: left });
    else rows.push({ label: "已结清", text: "", milli: null });
  } else if (left > 0) {
    rows.push({ label: "剩余不退", text: "", milli: left });
  }
  return rows;
}

/* ------------------------------------------------------------------ 显示 */

function two(n) {
  return (n < 10 ? "0" : "") + n;
}

/* 秒 → "HH:MM:SS"（超过 99 小时照样往上写）。 */
export function fmtDuration(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  return two(Math.floor(total / 3600)) + ":" + two(Math.floor(total / 60) % 60) + ":" + two(total % 60);
}

/* Wh → "0.024 kWh"。 */
export function fmtKwh(wh) {
  const value = Math.max(0, Number(wh) || 0);
  return (value / 1000).toFixed(3) + " kWh";
}

/* 毫元 → "12.34"。卡里的金额没有币种，界面上只写数字。 */
export function fmtMoney(milli) {
  const value = Number(milli);
  return Number.isFinite(value) && value >= 0 ? (value / 1000).toFixed(2) : "—";
}

/* W → "460 W"。 */
export function fmtWatts(w) {
  const value = Number(w);
  return Number.isFinite(value) ? Math.round(value) + " W" : "—";
}

/* UTC Unix 秒 + 时区分钟 → "YYYY-MM-DD HH:MM"。秒数是 0（当时桩上没有时间）返回 ""。 */
export function fmtUnix(unix, tzMin) {
  const sec = Number(unix);
  const tz = Number.isInteger(Number(tzMin)) ? Number(tzMin) : 0;
  if (!Number.isInteger(sec) || sec <= 0) return "";
  const local = new Date((sec + tz * 60) * 1000);
  return local.getUTCFullYear() + "-" + two(local.getUTCMonth() + 1) + "-" + two(local.getUTCDate()) +
    " " + two(local.getUTCHours()) + ":" + two(local.getUTCMinutes());
}

/* ACK SYS 里的桩时间（UTC 的 ISO 文本）+ 时区分钟 → "YYYY-MM-DD HH:MM:SS"；没有时间返回 ""。 */
export function fmtIsoClock(iso, tzMin) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso || "");
  if (!m) return "";
  const tz = Number.isInteger(Number(tzMin)) ? Number(tzMin) : 0;
  const local = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + tz * 60000);
  return local.getUTCFullYear() + "-" + two(local.getUTCMonth() + 1) + "-" + two(local.getUTCDate()) +
    " " + two(local.getUTCHours()) + ":" + two(local.getUTCMinutes()) + ":" + two(local.getUTCSeconds());
}

/* 选枪还剩几秒（向上取整）。过期或没选是 0。 */
export function selectLeft(untilMs, nowMs) {
  const left = Math.ceil((Number(untilMs) - Number(nowMs)) / 1000);
  return Number.isFinite(left) && left > 0 ? Math.min(left, PORTSEL_SECONDS) : 0;
}

/* 10 路汇总：在充几路、总功率。 */
export function portsSummary(ports) {
  let charging = 0;
  let watts = 0;
  let faulted = 0;
  (ports || []).forEach((item) => {
    if (item.s === "C") charging += 1;
    if (item.s === "X") faulted += 1;
    watts += item.w || 0;
  });
  return { charging, watts, faulted };
}
