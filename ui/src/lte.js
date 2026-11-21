/* 4G 模块（SIMCom A7670G，固件 2.6.16 起）。
 *
 * 命令（参数之间是 TAB）和应答。应答都以 "ACK " 开头、字段之间是 TAB：手机蓝牙层
 * （MainActivity.knownLine / FRAME_HEADS）只放行它认识的行首，并且按这些行首在字节流里找
 * 下一行的开头，"ACK " 是其中之一，所以旧的安装包也收得到这些行。带空格的文字（运营商
 * 名字、SIM 状态）桩把空格换成下划线发，这里换回来；不然 "AIRTEL IN" 里的 "TEL " 会被
 * 当成下一行的开头。
 *   LTEGET                                  ACK LTE <0|1>
 *   LTESET\t<0|1>                           ACK LTESET OK / FAIL；被连带关掉的开关各补一行
 *                                           WIFISW 0、TEL 0、OCPPSW 0
 *   APNGET                                  ACK APN <proto>\t<apn>\t<账号>\t<密码>
 *                                           proto 0 IPv4、1 IPv6、2 IPv4v6；三段文字可以是空的
 *   APNSET\t<proto>\t<apn>\t<账号>\t<密码>  ACK APNSET OK / FAIL
 *   LTESTAT                                 ACK LTEST <开关>\t<状态>\t<dBm>\t<运营商>\t<制式>\t<注册 stat>
 *                                           \t<SIM>\t<IP>\t<ICCID>\t<IMEI>\t<型号>\t<版本>\t<RSRP>
 *   LTECELL                                 ACK LTECL <频段>\t<EARFCN>\t<RSRQ>\t<SINR>\t<TAC>\t<小区号>
 *                                           \t<PCI>\t<IMSI>
 *                                           没有值的那一段是 "-"
 * 状态：OFF BOOT NOMOD NOSIM SIMPIN SEARCH DENIED DIAL UP。
 *
 * 4G 开着时，桩每秒那一行 "WCFG <link> <ssid>" 换成
 *   ACK LTEB <状态>\t<dBm 或 ->\t<运营商，没有是 ->
 * 4G 关着时还是 WCFG。WIFISWSET 1、TELSET 1 把 4G 关掉时桩补一行 "ACK LTE 0"。
 *
 * 互斥（桩强制执行，App 只是跟着显示）：开 4G 关 WiFi 和遥测；开 WiFi 关 4G；开遥测关 4G；
 * 三个可以都关。WiFi 和 4G 都关了，OCPP 开关跟着关。
 *
 * 2.6.15 及更早的固件不认识这些命令，什么都不回：版本读得出就一条都不发，读不出就问两次
 * LTEGET，等不到按“固件不支持”显示。 */

export const LTE_MIN_VERSION = [2, 6, 16];
export const LTE_TEXT_MAX = 32;
export const LTE_POLL_MS = 3000;
/* 桩一次只发一行，前面排着状态行时一条应答最慢要两秒多。 */
export const LTE_ASK_MS = 1500;
export const LTE_SET_MS = 3000;

export const LTE_PROTOS = [
  { id: 0, name: "IPv4" },
  { id: 1, name: "IPv6" },
  { id: 2, name: "IPv4/IPv6" },
];
export const LTE_STATES = ["OFF", "BOOT", "NOMOD", "NOSIM", "SEARCH", "DENIED", "DIAL", "UP", "SIMPIN"];

function clean(line) {
  return typeof line === "string" ? line.replace(/[\r\n]+$/, "") : null;
}
/* 一段文字：去掉两头空白，"-" 和空的都算没有。 */
function field(text) {
  const out = String(text == null ? "" : text).trim();
  return out === "-" ? "" : out;
}
/* 桩把空格换成下划线发的那几段文字：换回来。 */
function words(text) {
  return field(text).replace(/_/g, " ");
}
/* "-10"、"12"、"0" 这种带符号的整数；不是数字、"-"、空的返回 null。 */
function intOf(text, low, high) {
  const raw = String(text == null ? "" : text).trim();
  if (!/^-?\d{1,6}$/.test(raw)) return null;
  const value = parseInt(raw, 10);
  return value >= low && value <= high ? value : null;
}
function dbmOf(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!/^-\d{1,3}$/.test(raw)) return null;
  const dbm = parseInt(raw, 10);
  return dbm >= -150 && dbm <= -1 ? dbm : null;
}

/* 桩的固件认不认识 4G 命令。true / false；版本没读到返回 null。 */
export function lteSupported(fwVersion) {
  const m = String(fwVersion == null ? "" : fwVersion).trim().replace(/^[Vv]/, "")
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])/);
  if (!m) return null;
  const have = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== LTE_MIN_VERSION[i]) return have[i] > LTE_MIN_VERSION[i];
  }
  return true;
}

/* "ACK LTE 1" → true，"ACK LTE 0" → false；不是这一行返回 null。 */
export function parseLteSwitch(line) {
  const text = clean(line);
  if (text === null) return null;
  const m = /^ACK LTE ([01])\s*$/.exec(text);
  return m ? m[1] === "1" : null;
}

/* "ACK LTESET OK" → { cmd: "LTESET", ok: true }。只认 LTESET、APNSET。 */
export function parseLteAck(line) {
  const text = clean(line);
  if (text === null) return null;
  const m = /^ACK\s+(LTESET|APNSET)(?:\s+(\S+))?\s*$/.exec(text);
  return m ? { cmd: m[1], ok: m[2] === "OK" } : null;
}

/* "ACK APN 0\tcmnet\tuser\tpass" → { proto, apn, user, pass }。后面几段没有（行尾的 TAB 被
 * 去掉了）当作空的；proto 不是 0 / 1 / 2 返回 null。 */
export function parseApn(line) {
  const text = clean(line);
  if (text === null || text.indexOf("ACK APN ") !== 0) return null;
  const part = text.slice(8).split("\t");
  const proto = part[0].trim();
  if (!/^[012]$/.test(proto)) return null;
  return {
    proto: Number(proto),
    apn: part.length > 1 ? part[1] : "",
    user: part.length > 2 ? part[2] : "",
    pass: part.length > 3 ? part[3] : "",
  };
}

/* "ACK LTEST 1\tUP\t-85\tCHINA_MOBILE\t…" → 各字段；没有值的是 ""，dBm / RSRP / 注册 stat
 * 没有值是 null。段数不够的（以后固件少发几段）后面按没有值算。 */
export function parseLteStat(line) {
  const text = clean(line);
  if (text === null || text.indexOf("ACK LTEST ") !== 0) return null;
  const part = text.slice(10).split("\t");
  const on = part[0].trim();
  if (on !== "0" && on !== "1") return null;
  const at = (i) => (part.length > i ? part[i] : "");
  const reg = at(5).trim();
  return {
    on: on === "1",
    state: field(at(1)).toUpperCase() || "OFF",
    dbm: dbmOf(at(2)),
    oper: words(at(3)),
    rat: field(at(4)),
    reg: /^\d{1,2}$/.test(reg) ? parseInt(reg, 10) : null,
    sim: words(at(6)),
    ip: field(at(7)),
    iccid: field(at(8)),
    imei: field(at(9)),
    model: field(at(10)),
    fw: field(at(11)),
    rsrp: dbmOf(at(12)),
  };
}

/* "ACK LTECL B3\t1350\t-10\t19\t0x333C\t39589680\t308\t460001234567890" → 各字段；没有值的
 * 文字是 ""，数字是 null。只有 LTE 下有这些。 */
export function parseLteCell(line) {
  const text = clean(line);
  if (text === null || text.indexOf("ACK LTECL ") !== 0) return null;
  const part = text.slice(10).split("\t");
  const at = (i) => (part.length > i ? part[i] : "");
  return {
    band: field(at(0)),
    earfcn: intOf(at(1), 0, 999999),
    rsrq: intOf(at(2), -40, 0),
    sinr: intOf(at(3), -30, 50),
    tac: field(at(4)),
    cell: field(at(5)),
    pci: intOf(at(6), 0, 503),
    imsi: field(at(7)),
  };
}

/* "ACK LTEB UP\t-85\tCHINA_MOBILE" → { state, dbm, oper }。没有运营商是 ""。 */
export function parseLteBrief(line) {
  const text = clean(line);
  if (text === null || text.indexOf("ACK LTEB ") !== 0) return null;
  const part = text.slice(9).split("\t");
  const state = field(part[0]).toUpperCase();
  if (!state) return null;
  return {
    state,
    dbm: dbmOf(part[1]),
    oper: words(part.length > 2 ? part[2] : ""),
  };
}

/* 界面上的名字（中文是翻译的键）。不认识的状态原样显示。 */
const STATE_LABELS = {
  OFF: "已关闭",
  BOOT: "正在启动",
  NOMOD: "未检测到模块",
  NOSIM: "未插 SIM 卡",
  SEARCH: "正在搜索网络",
  DENIED: "注册被拒绝",
  DIAL: "正在拨号",
  UP: "已连接",
  SIMPIN: "需要 PIN 码",
};
export function lteStateLabel(state) {
  return STATE_LABELS[state] || state || "未知";
}

/* 注册状态（+CEREG / +CGREG / +CREG 的 stat）的说明；不认识的数字返回 ""。 */
const REG_LABELS = {
  0: "未注册",
  1: "已注册（本地）",
  2: "正在搜索网络",
  3: "注册被拒绝",
  4: "未知",
  5: "已注册（漫游）",
};
export function lteRegLabel(reg) {
  return Number.isInteger(reg) && REG_LABELS[reg] ? REG_LABELS[reg] : "";
}

/* SIM 卡状态（AT+CPIN? 的原文）的说明；不认识的返回 ""，界面上显示原文。 */
export function lteSimLabel(sim) {
  const key = String(sim || "").toUpperCase().replace(/[\s_]+/g, " ").trim();
  if (key === "READY") return "正常";
  if (key === "NO SIM" || key === "NOSIM" || key === "SIM NOT INSERTED") return "未插 SIM 卡";
  if (key === "SIM PIN") return "需要 PIN 码";
  if (key === "SIM PUK") return "需要 PUK 码";
  return "";
}

/* 4G 页的信号强度："-85 dBm"，LTE 下后面接着 "RSRP -95 dBm · RSRQ -10 dB · SINR 12 dB"
 * （有哪个写哪个），都没有是 "--"。 */
export function lteSignalText(dbm, rsrp, rsrq, sinr) {
  const list = [];
  if (Number.isInteger(dbm)) list.push(dbm + " dBm");
  if (Number.isInteger(rsrp)) list.push("RSRP " + rsrp + " dBm");
  if (Number.isInteger(rsrq)) list.push("RSRQ " + rsrq + " dB");
  if (Number.isInteger(sinr)) list.push("SINR " + sinr + " dB");
  return list.length ? list.join(" · ") : "--";
}

/* 4G 页的小区信息："TAC 0x333C · Cell 39589680 · PCI 308 · EARFCN 1350"，有哪个写哪个，
 * 都没有是 "--"。 */
export function lteCellText(cell) {
  const list = [];
  if (!cell) return "--";
  if (cell.tac) list.push("TAC " + cell.tac);
  if (cell.cell) list.push("Cell " + cell.cell);
  if (Number.isInteger(cell.pci)) list.push("PCI " + cell.pci);
  if (cell.band && Number.isInteger(cell.earfcn)) list.push("EARFCN " + cell.earfcn);
  return list.length ? list.join(" · ") : "--";
}

/* 首页那一行，和 WiFi 同一个写法。label 是状态翻译好的字。只有已连接（UP）带括号：
 *   有数值  "已连接 (-85 dBm)"      没数值  "已连接 (--)"      别的状态  "正在搜索网络" */
export function lteHomeText(label, state, dbm) {
  if (state !== "UP") return label;
  return label + (Number.isInteger(dbm) && dbm <= -1 && dbm >= -150 ? " (" + dbm + " dBm)" : " (--)");
}

/* APN、账号、密码各一段：最长 32 个可见 ASCII（0x21–0x7E，不含空格），不能有双引号。
 * 空的可以。 */
export function lteTextOk(text) {
  const value = String(text == null ? "" : text);
  return value.length <= LTE_TEXT_MAX && !/[^\x21-\x7E]/.test(value) && value.indexOf("\"") < 0;
}
/* 整组设置能不能发。能发返回 ""，不能发返回哪一项不对："proto" / "apn" / "user" / "pass"。 */
export function apnError(cfg) {
  if (!cfg || !/^[012]$/.test(String(cfg.proto))) return "proto";
  if (!lteTextOk(cfg.apn)) return "apn";
  if (!lteTextOk(cfg.user)) return "user";
  if (!lteTextOk(cfg.pass)) return "pass";
  return "";
}
export function apnCommand(cfg) {
  return "APNSET\t" + Number(cfg.proto) + "\t" + String(cfg.apn || "") + "\t" +
    String(cfg.user || "") + "\t" + String(cfg.pass || "");
}
export function lteSetCommand(on) {
  return "LTESET\t" + (on ? "1" : "0");
}

/* 互斥。now = { wifi, lte, tel, ocpp }，把 which（"wifi" / "lte" / "tel" / "ocpp"）改成 on，
 * 返回改完之后四个开关该是什么。和固件 lte_cfg_exclusive() 同一套规则：
 *   开 4G   → 关 WiFi、关遥测
 *   开 WiFi → 关 4G
 *   开遥测  → 关 4G
 *   WiFi 或 4G 被关掉之后两个都是关的 → OCPP 一起关
 *   WiFi 和遥测互不影响 */
export function lteExclusive(now, which, on) {
  const next = { wifi: !!now.wifi, lte: !!now.lte, tel: !!now.tel, ocpp: !!now.ocpp };
  if (!(which in next)) return next;
  next[which] = !!on;
  if (on && which === "lte") {
    next.wifi = false;
    next.tel = false;
  }
  if (on && (which === "wifi" || which === "tel")) next.lte = false;
  const closed = (now.wifi && !next.wifi) || (now.lte && !next.lte) ||
    (!on && (which === "wifi" || which === "lte"));
  if (closed && !next.wifi && !next.lte) next.ocpp = false;
  return next;
}

/* 下面几个函数的 io：
 *   ask(command, accept, ms)  发一条命令，等 accept(line) 为真的那一行；超时返回 null
 *   wait(ms)                  等一会儿
 *   alive()                   连接还在、这一轮没被顶掉
 *   fw                        桩的固件版本（STAT 行里的），没读到传 ""
 * 都是问一条、等它回来（或超时）再问下一条：桩的蓝牙回复队列只有 4 格。 */

async function askTwice(io, command, accept, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return null;
    const line = await io.ask(command, accept, ms || LTE_ASK_MS);
    if (!io.alive()) return null;
    if (line && accept(line)) return line;
  }
  return null;
}

/* 读 4G 开关。
 *   { state: "ok", on }        读到了
 *   { state: "unsupported" }   固件太旧，或者版本读不出、问了两次都不回
 *   { state: "silent" }        固件是 2.6.16 或更高，但问了两次都没回（蓝牙太差）
 *   { state: "gone" }          连接没了 */
export async function readLte(io) {
  const known = lteSupported(io.fw);
  if (known === false) return { state: "unsupported" };
  const line = await askTwice(io, "LTEGET", (text) => parseLteSwitch(text) !== null);
  if (!io.alive()) return { state: "gone" };
  if (line === null) return { state: known ? "silent" : "unsupported" };
  return { state: "ok", on: parseLteSwitch(line) };
}

/* 读 APN 设置：{ proto, apn, user, pass }，没读到返回 null。 */
export async function readApn(io) {
  const line = await askTwice(io, "APNGET", (text) => parseApn(text) !== null);
  return line === null ? null : parseApn(line);
}

/* 四个开关各读一次，一条一条来：WIFISWGET、TELGET、OCPPSWGET、LTEGET。
 * 返回 { wifi, tel, ocpp, lte }，没读到的那一个是 null。 */
export async function rereadSwitches(io) {
  const flag = (prefix) => (text) => typeof text === "string" && new RegExp("^" + prefix + " [01]\\s*$").test(text);
  const steps = [
    ["wifi", "WIFISWGET", flag("WIFISW")],
    ["tel", "TELGET", flag("TEL")],
    ["ocpp", "OCPPSWGET", flag("OCPPSW")],
    ["lte", "LTEGET", flag("ACK LTE")],
  ];
  const out = { wifi: null, tel: null, ocpp: null, lte: null };
  for (let i = 0; i < steps.length; i++) {
    if (!io.alive()) return out;
    const line = await askTwice(io, steps[i][1], steps[i][2]);
    if (line !== null) out[steps[i][0]] = /1\s*$/.test(line);
  }
  return out;
}

/* 发一条设置命令（LTESET / APNSET），等它的 ACK。
 *   "ok" / "fail"（桩回了 FAIL）/ "silent"（没等到）/ "gone" */
export async function sendLteSet(io, command) {
  const want = command.split("\t")[0];
  const accept = (text) => {
    const ack = parseLteAck(text);
    return ack !== null && ack.cmd === want;
  };
  if (!io.alive()) return "gone";
  const line = await io.ask(command, accept, LTE_SET_MS);
  if (!io.alive()) return "gone";
  if (line === null || !accept(line)) return "silent";
  return parseLteAck(line).ok ? "ok" : "fail";
}

/* 4G 页开着的时候每 3 秒读一次状态：问一次 LTESTAT，等它回来（或超时），歇 3 秒再问。
 * 读到的交给 onStat。给了 onCell 的话，4G 开着时接着再问一次 LTECELL（频段、RSRQ、SINR、
 * 小区、IMSI），一条一条来。连接没了、离开页面（alive 为假）就停。 */
export async function pollLteStat(io, onStat, onCell) {
  const accept = (text) => parseLteStat(text) !== null;
  const acceptCell = (text) => parseLteCell(text) !== null;
  while (io.alive()) {
    const line = await io.ask("LTESTAT", accept, LTE_ASK_MS);
    if (!io.alive()) return;
    const stat = line === null ? null : parseLteStat(line);
    if (stat) onStat(stat);
    if (onCell && stat && stat.on) {
      const more = await io.ask("LTECELL", acceptCell, LTE_ASK_MS);
      if (!io.alive()) return;
      if (more !== null && parseLteCell(more)) onCell(parseLteCell(more));
    }
    await io.wait(LTE_POLL_MS);
  }
}
