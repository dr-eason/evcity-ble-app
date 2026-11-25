/* 机型一键配置。存在手机上，不绑定某一台桩的地址。 */
import { SCREEN_LANGS, parseScrLangAck } from "./scrlang.js";
import { SCREEN_THEMES, parseScrThemeAck } from "./scrtheme.js";
import { PHASE_BUSY_REASON, parsePhaseLine } from "./phase.js";
import { parseLteSwitch } from "./lte.js";
import { parseGbStopLine } from "./gbstop.js";

/* 每一组。下发按这个顺序：
 *   since     桩的固件从这个版本起才有这组命令；更旧（或者版本读不出）的桩上读取、下发都跳过。
 *   optional  这一组是后加的，旧 App 存的备份里没有：下发时备份里没有就跳过，不算失败。
 *   quiet     桩对读写命令一声不吭时按“固件还不支持”跳过，不算失败（2.8.0 开发期间的
 *             固件版本号已经是 2.8.0，但还没有这两条命令）。
 *   needs     要用户在下发确认里勾选了才下发（opts 里的这个开关）。 */
export const SECTIONS = [
  { key: "safety", name: "安全管理参数" },
  { key: "imax", name: "最大电流" },
  { key: "plug", name: "即插即充" },
  /* 新国标 6 秒停充（GBSTOPGET / GBSTOPSET，gbstop.js）。这一版固件加的，版本号没有变（还是
   * 3.0.0），所以不能只按版本判断：更早的 3.0.0 对这两条命令一声不吭，按“固件还不支持”跳过
   * （quiet）。旧 App 存的备份里没有这一项，下发时跳过（optional）。 */
  { key: "gbstop", name: "新国标6秒停充", since: [3, 0, 0], optional: true, quiet: true },
  { key: "cards", name: "本地IC卡" },
  { key: "sched", name: "预约充电" },
  { key: "qr", name: "屏幕二维码" },
  { key: "ocfw", name: "OCPP上报版本号" },
  { key: "tel", name: "遥测" },
  { key: "netstop", name: "断网停充" },
  { key: "net", name: "网络设置" },
  /* 4G 的 APN（固件 2.6.16 起）：Protocol、APN、账号、密码。放在 4G 开关前面：4G 还关着时
   * 写 APN 只是存下来，接着打开 4G，模组第一次拨号用的就是备份里的 APN（4G 本来就开着时
   * 固件在 APN 变了时自己让模组重拨，见 wb2.c 的 APNSET）。 */
  { key: "apn", name: "4G APN", since: [2, 6, 16], optional: true },
  /* 4G 开关（固件 2.6.16 起）。只有下发确认里勾选了「同时下发 4G 开关」才发；备份里 4G 是
   * 开着的（用 4G 联网的桩）时这个勾默认勾上（defaultWithLte），关着时默认不勾：开关和
   * WiFi、遥测互斥，照着备份去关 4G 会把目标桩正在用的那条链路断掉。
   * 放在 WiFi 后面、OCPP 前面：WiFi 和 4G 都关掉时桩会连带关 OCPP，先把链路定下来，再写
   * OCPP 开关，读回核对才对得上。 */
  { key: "lte", name: "4G 开关", since: [2, 6, 16], optional: true, needs: "withLte" },
  { key: "ocpp", name: "OCPP设置" },
  /* 屏幕语言、屏幕颜色（固件 2.8.0 起）。 */
  { key: "scrlang", name: "屏幕语言", since: [2, 8, 0], optional: true, quiet: true },
  { key: "scrtheme", name: "屏幕颜色", since: [2, 8, 0], optional: true, quiet: true },
  /* 相位（单相 / 三相）。最早的固件就有 PHASEGET / PHASESET，不设 since；桩不回就是真的没读到，
   * 算失败（相位关系到保护，宁可报出来也不悄悄漏掉）。充电中改成另一个值桩回 BUSY。 */
  { key: "phase", name: "相位", optional: true },
];

/* 备份记录的格式版本。
 *   1（记录里没有 format 字段）：2.8.0 之前的 App 存的，body 是前 11 组，可能还有 apn。
 *   2：多了 lte、scrLang、scrTheme、phase（桩不支持时是 null），记录里带 format: 2。
 * 后来又多了 gbStop（新国标 6 秒停充，true / false，桩不支持时是 null）。它是可有可无的一项，
 * 格式号没有加：没有这一项的旧备份照样能导入、下发（跳过这一项）；带这一项的备份拿到旧 App 上
 * 也能导入（旧 App 不认识这个字段，不下发它）。 */
export const PROFILE_FORMAT = 2;
export const PROFILE_MODEL = "AC06";
/* 导出文件的标记。 */
export const EXPORT_KIND = "evcity-ac06-oneclick";
/* 导入文件最大多大（字节）。一份配置不到 2 KB。 */
export const IMPORT_MAX_BYTES = 1024 * 1024;

function versionAtLeast(version, need) {
  const m = String(version || "").replace(/^[Vv]/, "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return false;
  const have = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

/* 这份备份里有没有这一组（后加的几组，旧备份里没有，或者备份时桩不支持是 null）。 */
export function hasSection(key, body) {
  if (!body) return false;
  switch (key) {
    case "apn": return !!body.apn;
    case "lte": return typeof body.lte === "boolean";
    case "scrlang": return validScrLang(body.scrLang);
    case "scrtheme": return validScrTheme(body.scrTheme);
    case "phase": return validPhase(body.phase);
    case "gbstop": return typeof body.gbStop === "boolean";
    default: return body[key] !== undefined && body[key] !== null;
  }
}

/* 下发确认里「同时下发 4G 开关」默认勾不勾：备份里 4G 是开着的才默认勾上，这样用 4G 联网
 * 的桩备份下发后和 WiFi 一样自己联网。4G 关着、或者备份里没有这一项（旧备份、旧固件）时不勾。 */
export function defaultWithLte(body) {
  return !!body && body.lte === true;
}

/* 这一项这次要不要跳过。要跳过返回原因（界面上写“已跳过”，不算失败），不跳过返回 ""。
 *   - 桩的固件太旧、不认识这一项的命令（读不出版本也按旧的算）
 *   - 下发时用户没勾选这一项（4G 开关）
 *   - 下发时这份备份里没有这一项（备份是从旧固件的桩上读的，或者是旧 App 存的）
 * opts.withLte：下发确认里勾了「同时下发 4G 开关」。 */
export function sectionSkip(section, mode, fwVersion, body, opts) {
  if (section.since && !versionAtLeast(fwVersion, section.since)) return "固件不支持";
  if (mode === "write" && section.needs && !(opts && opts[section.needs])) return "没有勾选，不下发";
  if (mode === "write" && section.optional && !hasSection(section.key, body)) return "这份配置里没有这一项";
  return "";
}

/* 桩对这一组的命令一声不吭（line 是 null）时，要不要当作“固件还不支持”跳过。
 * 要跳过返回原因，否则返回 ""（照常算失败）。 */
export function quietSkip(section, line) {
  if (section && section.quiet && !line) return "充电桩没有应答，固件可能还不支持这一项";
  return "";
}

/* 本地 IC 卡格数。固件 2.6.4 起 10 格，更早的固件只有前 5 格。 */
export const CARD_SLOTS = 10;
export const CARD_SLOTS_OLD = 5;

/* 桩的固件版本对应几格。版本读不出来按旧的算。 */
export function cardSlotsFor(version) {
  const m = String(version || "").replace(/^[Vv]/, "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return CARD_SLOTS_OLD;
  const have = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  const need = [2, 6, 4];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i] ? CARD_SLOTS : CARD_SLOTS_OLD;
  }
  return CARD_SLOTS;
}

/* "CARD\t卡1\t…" 拆成 10 格。旧固件只回 5 个字段；手机蓝牙层还会把行尾的空字段去掉，
 * 所以不够的都补空。返回 null 表示不是 CARD 行。fields 是这一行实际带了几个字段。 */
export function splitCardLine(line) {
  if (!(line.indexOf("CARD\t") === 0 || line === "CARD")) return null;
  const part = line.split("\t");
  const cards = [];
  for (let i = 0; i < CARD_SLOTS; i++) cards.push(part[i + 1] || "");
  return { cards, fields: part.length - 1 };
}

/* 备份里的卡表补齐到 10 格。2.6.3 及更早的 App 存的备份只有 5 格。不合法返回 null。 */
export function normalCards(list) {
  if (!Array.isArray(list) || (list.length !== CARD_SLOTS && list.length !== CARD_SLOTS_OLD)) return null;
  const cards = list.map((item) => String(item || ""));
  if (cards.some((item) => !validCard(item))) return null;
  while (cards.length < CARD_SLOTS) cards.push("");
  return cards;
}

export function blankBody() {
  return {
    safety: { over: 0, under: 0, ab: 0, bc: 0, cd: 0, ef: 0, earth: false, leak: false, earthMin: 0 },
    imax: 32,
    plug: false,
    cards: Array(CARD_SLOTS).fill(""),
    sched: { tz: 480, mode: 0, hour: 8, minute: 0 },
    qr: { on: false, text: "" },
    ocfw: { on: false, text: "" },
    tel: false,
    netstop: { on: false, sec: 60 },
    wifi: { on: false, ssid: "", pass: "" },
    ocpp: { on: false, url: "" },
    apn: null,              /* 从 2.6.16 起的桩上读到才有：{ proto, apn, user, pass } */
    lte: null,              /* 4G 开关，从 2.6.16 起的桩上读到才有：true / false */
    scrLang: null,          /* 屏幕语言 0–4（scrlang.js），从 2.8.0 起的桩上读到才有 */
    scrTheme: null,         /* 屏幕颜色 0–6（scrtheme.js），从 2.8.0 起的桩上读到才有 */
    phase: null,            /* 相位 0 单相、1 三相（phase.js） */
    gbStop: null,           /* 新国标 6 秒停充 true / false（gbstop.js），桩支持才有 */
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

/* 过压、欠压能不能保存。规则和固件 service/src/grid_limits.c 一样：
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
  if (!s) return false;
  const nums = [s.over, s.under, s.ab, s.bc, s.cd, s.ef].map(Number);
  const earthMin = Number(s.earthMin);
  if (nums.some((n) => !Number.isFinite(n)) || !Number.isFinite(earthMin)) return false;
  if (earthMin < 50 || earthMin > 250) return false;
  if (voltageLimitError(s.over, s.under) !== "") return false;
  return true;
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

function validQr(text) {
  return String(text || "").length <= 47 && !/[^\x20-\x7E]/.test(text);
}

function validOcfw(text) {
  const value = String(text || "");
  return value.length <= 20 && (value.length === 0 || !/[^\x21-\x7E]/.test(value));
}

function validCard(text) {
  const value = String(text || "");
  return value.length <= 10 && !/[^\x21-\x7E]/.test(value);
}

function validSched(s) {
  if (!s) return false;
  const tz = Number(s.tz);
  const mode = Number(s.mode);
  const hour = Number(s.hour);
  const minute = Number(s.minute);
  return Number.isInteger(tz) && tz >= -720 && tz <= 840 &&
    (mode === 0 || mode === 1 || mode === 2) &&
    Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
    Number.isInteger(minute) && minute >= 0 && minute <= 59;
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

function validScrLang(value) {
  return Number.isInteger(value) && value >= 0 && value < SCREEN_LANGS.length;
}

function validScrTheme(value) {
  return Number.isInteger(value) && value >= 0 && value < SCREEN_THEMES.length;
}

function validPhase(value) {
  return value === 0 || value === 1;
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
  if (line.indexOf("TIME") >= 0) return "这台桩还没有服务器时间";
  if (line.indexOf("CPRELAY") >= 0) return "接触器吸合时不能改 CP";
  if (line.indexOf("EARTH") >= 0) return "接地故障阈值不能用";
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
    ok: (line) => line.indexOf("OK") >= 0 || line.indexOf(" SW") >= 0,
    reason: ackReason,
  };
}

function parseSafety(line, body) {
  const part = line.trim().split(/\s+/);
  if (part[0] !== "CFG" || part.length < 11) return false;
  const nums = part.slice(1, 7).map(Number);
  const earthMin = Number(part[10]);
  if (part[7] !== "0" && part[7] !== "1") return false;
  if (part[8] !== "0" && part[8] !== "1") return false;
  body.safety = {
    over: nums[0], under: nums[1], ab: nums[2], bc: nums[3], cd: nums[4], ef: nums[5],
    earth: part[7] === "1", leak: part[8] === "1", earthMin,
  };
  return validSafety(body.safety);
}

function parseImax(line, body) {
  const matched = /^IMAX (\d+)$/.exec(line.trim());
  const amp = matched ? Number(matched[1]) : NaN;
  if (!Number.isInteger(amp) || amp < 6 || amp > 32) return false;
  body.imax = amp;
  return true;
}

/* 固件 2.6.0 起回 "ACK PLUGGET 1"。2.5.x 回的是 "PLUG 1"，手机的蓝牙层以前不认这个
 * 行首，整行被丢掉，这一项就一直是「回复超时」。两种都认。 */
function acceptPlug(line) {
  return line.indexOf("ACK PLUGGET ") === 0 || line.indexOf("PLUG ") === 0;
}

function parsePlug(line, body) {
  const matched = /^(?:ACK PLUGGET|PLUG) ([01])$/.exec(line.trim());
  if (!matched) return false;
  body.plug = matched[1] === "1";
  return true;
}

function acceptGbStop(line) {
  const got = parseGbStopLine(line);
  return got !== null && got.kind === "get";
}

function parseGbStop(line, body) {
  const got = parseGbStopLine(line);
  if (!got || got.kind !== "get") return false;
  body.gbStop = got.on;
  return true;
}

function parseCards(line, body) {
  const got = splitCardLine(line);
  if (!got || got.cards.some((item) => !validCard(item))) return false;
  body.cards = got.cards;
  return true;
}

function parseSched(line, body) {
  const part = line.trim().split(/\s+/);
  if (part[0] !== "SCHED" || part.length < 6) return false;
  body.sched = {
    tz: Number(part[2]),
    mode: Number(part[3]),
    hour: Number(part[4]),
    minute: Number(part[5]),
  };
  return validSched(body.sched);
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

function parseQr(line, body) {
  const parsed = parseFlagText(line, "QR ", 47, validQr);
  if (!parsed) return false;
  body.qr = parsed;
  return true;
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

/* 固件 2.6.0 起回 "ACK WPASSGET " 加密码的十六进制，没有密码时是 "-"。按十六进制发是
 * 因为密码里可以有空格：原样发时，里面一段 "AP " 或 "ACK " 会被蓝牙层当成下一行的开头。
 * 2.5.x 回的是 "WPASS" 加制表符加密码，以前同样被蓝牙层丢掉。两种都认。 */
function acceptWpass(line) {
  return line.indexOf("ACK WPASSGET") === 0 || line.indexOf("WPASS\t") === 0 || line.trim() === "WPASS";
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
  if (line.indexOf("ACK WPASSGET") === 0) {
    const rest = line.slice(12).trim();
    if (rest === "-" || rest === "") body.wifi.pass = "";
    else {
      const pass = hexToText(rest);
      if (pass === null) return false;
      body.wifi.pass = pass;
    }
  }
  else if (line.indexOf("WPASS\t") === 0) body.wifi.pass = line.slice(6);
  else if (line.trim() === "WPASS") body.wifi.pass = "";
  else return false;
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

function acceptLteSwitch(line) {
  return parseLteSwitch(line) !== null;
}

function parseLteLine(line, body) {
  const on = parseLteSwitch(line);
  if (on === null) return false;
  body.lte = on;
  return true;
}

function acceptScrLang(line) {
  const got = parseScrLangAck(line);
  return got !== null && got.kind === "get";
}

function parseScrLangLine(line, body) {
  const got = parseScrLangAck(line);
  if (!got || got.kind !== "get" || got.lang === null) return false;
  body.scrLang = got.lang;
  return true;
}

function acceptScrTheme(line) {
  const got = parseScrThemeAck(line);
  return got !== null && got.kind === "get";
}

function parseScrThemeLine(line, body) {
  const got = parseScrThemeAck(line);
  if (!got || got.kind !== "get" || got.theme === null) return false;
  body.scrTheme = got.theme;
  return true;
}

function acceptPhase(line) {
  const got = parsePhaseLine(line);
  return got !== null && got.kind === "get";
}

function parsePhase(line, body) {
  const got = parsePhaseLine(line);
  if (!got || got.kind !== "get") return false;
  body.phase = got.phase;
  return true;
}

/* PHASESET 的应答：BUSY 时说清楚要先停充电。 */
export function phaseReason(line) {
  if (line && /^ACK\s+PHASESET\s+BUSY\b/.test(line.trim())) return PHASE_BUSY_REASON;
  return ackReason(line);
}

export function readPlan(key) {
  switch (key) {
    case "safety":
      return { list: [readStep("CFGGET", (line) => line.indexOf("CFG ") === 0, parseSafety)] };
    case "imax":
      return { list: [readStep("IMAXGET", (line) => line.indexOf("IMAX ") === 0, parseImax)] };
    case "plug":
      return { list: [readStep("PLUGGET", acceptPlug, parsePlug)] };
    case "gbstop":
      return { list: [readStep("GBSTOPGET", acceptGbStop, parseGbStop)] };
    case "cards":
      return { list: [readStep("CARDGET", (line) => line.indexOf("CARD") === 0 && line.indexOf("CARDSET") < 0, parseCards)] };
    case "sched":
      return { list: [readStep("SCHEDGET", (line) => line.indexOf("SCHED ") === 0, parseSched)] };
    case "qr":
      return { list: [readStep("QRGET", (line) => line.indexOf("QR ") === 0, parseQr)] };
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
    case "lte":
      return { list: [readStep("LTEGET", acceptLteSwitch, parseLteLine)] };
    case "scrlang":
      return { list: [readStep("SCRLANGGET", acceptScrLang, parseScrLangLine)] };
    case "scrtheme":
      return { list: [readStep("SCRTHEMEGET", acceptScrTheme, parseScrThemeLine)] };
    case "phase":
      return { list: [readStep("PHASEGET", acceptPhase, parsePhase)] };
    default:
      return { error: "这份配置里没有这一项" };
  }
}

function safetyCommand(body) {
  if (!validSafety(body.safety)) return { error: "保护参数不能用" };
  const s = body.safety;
  const nums = [s.over, s.under, s.ab, s.bc, s.cd, s.ef].map(Number);
  const command = "CFGSET\t" + nums.map((n, i) => (i < 2 ? n.toFixed(0) : n.toFixed(2))).join("\t") +
    "\t" + (s.earth ? "1" : "0") + "\t" + (s.leak ? "1" : "0") + "\t" + Number(s.earthMin).toFixed(0);
  return { list: [ackStep(command, "CFGSET")] };
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

function ocppCommand(body) {
  if (!body.ocpp || typeof body.ocpp.on !== "boolean") return { error: "这份配置里没有这一项" };
  const url = String(body.ocpp.url || "");
  if (!validOcpp(url)) return { error: "地址需要是 ws(s)://主机/路径，最长 127 字节" };
  const list = [];
  if (url) list.push(ackStep("OCPPSET\t" + url, "OCPPSET"));
  list.push(ackStep("OCPPSWSET\t" + (body.ocpp.on ? "1" : "0"), "OCPPSWSET"));
  return { list };
}

/* opts.cardSlots：这台桩有几格卡（cardSlotsFor(固件版本)）。不给按 10 格。 */
export function writePlan(key, body, opts) {
  if (!body) return { error: "这份配置里没有这一项" };
  switch (key) {
    case "safety":
      return safetyCommand(body);
    case "imax": {
      const amp = Number(body.imax);
      if (!Number.isInteger(amp) || amp < 6 || amp > 32) return { error: "请填 6 到 32 的整数" };
      return { list: [ackStep("IMAXSET\t" + amp, "IMAXSET")] };
    }
    case "plug":
      if (typeof body.plug !== "boolean") return { error: "这份配置里没有这一项" };
      return { list: [ackStep("PLUGSET\t" + (body.plug ? "1" : "0"), "PLUGSET")] };
    case "gbstop":
      if (typeof body.gbStop !== "boolean") return { error: "这份配置里没有这一项" };
      return { list: [ackStep("GBSTOPSET\t" + (body.gbStop ? "1" : "0"), "GBSTOPSET")] };
    case "cards": {
      const cards = normalCards(body.cards);
      if (!cards) {
        return { error: "没有保存。卡号最长 10 位，只能是可见英文字符" };
      }
      /* 旧固件没有第 6–10 格，CARDSET 6 会回 FAIL。备份里这 5 格本来就是空的，就不发；
       * 有内容照发，让这一项如实报失败，不能悄悄少恢复几张卡。 */
      let count = CARD_SLOTS;
      if (opts && Number(opts.cardSlots) === CARD_SLOTS_OLD && cards.slice(CARD_SLOTS_OLD).every((item) => !item)) {
        count = CARD_SLOTS_OLD;
      }
      return {
        list: cards.slice(0, count).map((item, index) => ackStep("CARDSET\t" + (index + 1) + "\t" + item, "CARDSET")),
      };
    }
    case "sched":
      if (!validSched(body.sched)) return { error: "时区填 8、-5 或 5.5。时间用 0 到 23 时、0 到 59 分" };
      return {
        list: [ackStep("SCHEDSET\t" + body.sched.tz + "\t" + body.sched.mode + "\t" + body.sched.hour + "\t" + body.sched.minute, "SCHEDSET")],
      };
    case "qr":
      if (!body.qr || !validQr(body.qr.text)) return { error: "没有保存。内容最长 47 个英文字符" };
      return { list: [ackStep("QRSET\t" + (body.qr.on ? "1" : "0") + "\t" + body.qr.text, "QRSET")] };
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
      return ocppCommand(body);
    case "apn":
      if (!body.apn) return { error: "这份配置里没有这一项" };
      if (!validApn(body.apn)) {
        return { error: "没有保存。APN 名称、账号、密码最长 32 个可见英文字符，不能有空格和双引号" };
      }
      return {
        list: [ackStep("APNSET\t" + Number(body.apn.proto) + "\t" + String(body.apn.apn || "") + "\t" +
          String(body.apn.user || "") + "\t" + String(body.apn.pass || ""), "APNSET")],
      };
    case "lte":
      if (typeof body.lte !== "boolean") return { error: "这份配置里没有这一项" };
      return { list: [ackStep("LTESET\t" + (body.lte ? "1" : "0"), "LTESET")] };
    case "scrlang":
      if (!validScrLang(body.scrLang)) return { error: "这份配置里没有这一项" };
      return { list: [ackStep("SCRLANGSET\t" + body.scrLang, "SCRLANGSET")] };
    case "scrtheme":
      if (!validScrTheme(body.scrTheme)) return { error: "这份配置里没有这一项" };
      return { list: [ackStep("SCRTHEMESET\t" + body.scrTheme, "SCRTHEMESET")] };
    case "phase": {
      if (!validPhase(body.phase)) return { error: "这份配置里没有这一项" };
      const step = ackStep("PHASESET\t" + body.phase, "PHASESET");
      step.reason = phaseReason;
      return { list: [step] };
    }
    default:
      return { error: "这份配置里没有这一项" };
  }
}

/* 下发后读回来核对。want 是手机上存的那份，got 是刚从桩里读回来的。
 * 只比这一项真正写下去的内容：热点名或平台地址是空的时候没有发保存命令，桩里原来
 * 的值不动，这时不比。 */
function near(a, b, slack) {
  return Math.abs(Number(a) - Number(b)) <= slack;
}

export function sameSection(key, want, got) {
  if (!want || !got) return false;
  switch (key) {
    case "safety": {
      const a = want.safety;
      const b = got.safety;
      if (!a || !b) return false;
      /* 电压按整数存，CP 分界按两位小数回。 */
      return near(a.over, b.over, 0.5) && near(a.under, b.under, 0.5) &&
        near(a.ab, b.ab, 0.011) && near(a.bc, b.bc, 0.011) &&
        near(a.cd, b.cd, 0.011) && near(a.ef, b.ef, 0.011) &&
        !!a.earth === !!b.earth && !!a.leak === !!b.leak &&
        near(a.earthMin, b.earthMin, 0.5);
    }
    case "imax":
      return Number(want.imax) === Number(got.imax);
    case "plug":
      return want.plug === got.plug;
    case "gbstop":
      return typeof want.gbStop === "boolean" && want.gbStop === got.gbStop;
    case "cards": {
      const a = normalCards(want.cards);
      const b = normalCards(got.cards);
      return !!a && !!b && a.every((item, index) => item === b[index]);
    }
    case "sched":
      return !!want.sched && !!got.sched &&
        Number(want.sched.tz) === Number(got.sched.tz) &&
        Number(want.sched.mode) === Number(got.sched.mode) &&
        Number(want.sched.hour) === Number(got.sched.hour) &&
        Number(want.sched.minute) === Number(got.sched.minute);
    case "qr":
      return !!want.qr && !!got.qr && !!want.qr.on === !!got.qr.on &&
        String(want.qr.text || "") === String(got.qr.text || "");
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
    case "lte":
      return typeof want.lte === "boolean" && want.lte === got.lte;
    case "scrlang":
      return validScrLang(want.scrLang) && want.scrLang === got.scrLang;
    case "scrtheme":
      return validScrTheme(want.scrTheme) && want.scrTheme === got.scrTheme;
    case "phase":
      return validPhase(want.phase) && want.phase === got.phase;
    default:
      return false;
  }
}


/* ---- 备份记录、格式版本、导出 / 导入 ---- */

/* 记录是哪个格式。没有 format 字段的是 2.8.0 之前的 App 存的，算 1。不是正整数返回 0。 */
export function profileFormat(item) {
  if (!item || item.format === undefined) return 1;
  return Number.isInteger(item.format) && item.format >= 1 ? item.format : 0;
}

/* 手机上存着的一条记录能不能列出来。和以前一样宽：有 id、名称、body，机型是 AC06。
 * 没有 format 的旧记录照样算；里面缺哪一组，下发时按 sectionSkip 跳过或报失败。 */
export function storedProfileOk(item) {
  return !!(item && item.id && item.name && item.body && typeof item.body === "object" &&
    item.model === PROFILE_MODEL);
}

/* 新存的一条记录。 */
export function makeProfile(name, body, savedAt, id) {
  return { format: PROFILE_FORMAT, id, name, savedAt, model: PROFILE_MODEL, body };
}

function sectionName(key) {
  const found = SECTIONS.find((section) => section.key === key);
  return found ? found.name : key;
}

/* 导入时逐组检查 body。合格返回 ""，否则返回不合格的那一组的名字（界面上翻译后显示）。
 * 前 10 组加 OCPP（旧 App 一直都存）必须有；后加的几组可以没有，有就要合法。 */
export function bodyProblem(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "配置内容";
  const flag = (item) => !!item && typeof item === "object" && typeof item.on === "boolean";
  if (!validSafety(body.safety)) return sectionName("safety");
  if (!Number.isInteger(body.imax) || body.imax < 6 || body.imax > 32) return sectionName("imax");
  if (typeof body.plug !== "boolean") return sectionName("plug");
  if (!normalCards(body.cards)) return sectionName("cards");
  if (!validSched(body.sched)) return sectionName("sched");
  if (!flag(body.qr) || typeof body.qr.text !== "string" || !validQr(body.qr.text)) return sectionName("qr");
  if (!flag(body.ocfw) || typeof body.ocfw.text !== "string" || !validOcfw(body.ocfw.text)) return sectionName("ocfw");
  if (typeof body.tel !== "boolean") return sectionName("tel");
  if (!flag(body.netstop) || !Number.isInteger(body.netstop.sec) || body.netstop.sec < 10 || body.netstop.sec > 600) {
    return sectionName("netstop");
  }
  if (!flag(body.wifi) || typeof body.wifi.ssid !== "string" || typeof body.wifi.pass !== "string" ||
      !validWifi(body.wifi)) return sectionName("net");
  if (!flag(body.ocpp) || typeof body.ocpp.url !== "string" || !validOcpp(body.ocpp.url)) return sectionName("ocpp");
  const absent = (value) => value === undefined || value === null;
  if (!absent(body.apn) && !validApn(body.apn)) return sectionName("apn");
  if (!absent(body.lte) && typeof body.lte !== "boolean") return sectionName("lte");
  if (!absent(body.scrLang) && !validScrLang(body.scrLang)) return sectionName("scrlang");
  if (!absent(body.scrTheme) && !validScrTheme(body.scrTheme)) return sectionName("scrtheme");
  if (!absent(body.phase) && !validPhase(body.phase)) return sectionName("phase");
  if (!absent(body.gbStop) && typeof body.gbStop !== "boolean") return sectionName("gbstop");
  return "";
}

/* 导出文件的内容：整个列表，带格式版本和导出时间。 */
export function exportText(list, now) {
  const profiles = (Array.isArray(list) ? list : []).filter(storedProfileOk).map((item) => ({
    format: profileFormat(item) || PROFILE_FORMAT,
    id: String(item.id),
    name: String(item.name),
    savedAt: item.savedAt,
    model: PROFILE_MODEL,
    body: item.body,
  }));
  return JSON.stringify({ kind: EXPORT_KIND, format: PROFILE_FORMAT, exportedAt: now, profiles }, null, 2) + "\n";
}

/* 导出文件名：evcity-ac06-oneclick-20261125-1430.json（按手机本地时间）。 */
export function exportFileName(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return EXPORT_KIND + ".json";
  const p = (n) => (n < 10 ? "0" : "") + n;
  return EXPORT_KIND + "-" + date.getFullYear() + p(date.getMonth() + 1) + p(date.getDate()) + "-" +
    p(date.getHours()) + p(date.getMinutes()) + ".json";
}

function sameProfile(a, b) {
  return a.name === b.name && a.savedAt === b.savedAt && JSON.stringify(a.body) === JSON.stringify(b.body);
}

/* 读导入的文件。text 是文件内容，existing 是手机上已有的列表，newId() 给新记录取 id。
 * 认三种写法：导出文件（{ kind, format, profiles: [...] }）、记录数组、单独一条记录。
 * 有一条不合格就整份不导入，返回 { error, vars }（error 是界面上 t() 的键）。
 * 合格返回 { list: 要加进去的新记录, same: 已经在列表里的条数 }。 */
export function importText(text, existing, newId) {
  const raw = String(text == null ? "" : text);
  if (new TextEncoder().encode(raw).length > IMPORT_MAX_BYTES) return { error: "文件太大，不是一键配置文件" };
  let data;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { error: "这个文件不是一键配置文件" };
  }
  let items;
  if (Array.isArray(data)) items = data;
  else if (data && typeof data === "object" && Array.isArray(data.profiles)) {
    if (data.kind !== undefined && data.kind !== EXPORT_KIND) return { error: "这个文件不是一键配置文件" };
    const format = profileFormat(data);
    if (!format) return { error: "这个文件不是一键配置文件" };
    if (format > PROFILE_FORMAT) return { error: "这个文件是更新版本的 App 导出的，请先升级 App" };
    items = data.profiles;
  }
  else if (data && typeof data === "object" && data.body) items = [data];
  else return { error: "这个文件不是一键配置文件" };
  if (!items.length) return { error: "文件里没有配置" };
  const have = Array.isArray(existing) ? existing.slice() : [];
  const list = [];
  let same = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const n = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "第 {n} 份配置不能用", vars: { n } };
    const format = profileFormat(item);
    if (!format) return { error: "第 {n} 份配置不能用", vars: { n } };
    if (format > PROFILE_FORMAT) return { error: "这个文件是更新版本的 App 导出的，请先升级 App" };
    if (item.model !== PROFILE_MODEL) return { error: "第 {n} 份配置不是 AC06 充电桩的", vars: { n } };
    const name = cleanProfileName(item.name);
    if (!name || typeof item.name !== "string") return { error: "第 {n} 份配置的名称不能用", vars: { n } };
    const bad = bodyProblem(item.body);
    if (bad) return { error: "第 {n} 份配置里的「{name}」不能用，整个文件没有导入", vars: { n, name: bad } };
    const body = JSON.parse(JSON.stringify(item.body));
    body.cards = normalCards(body.cards);
    const savedAt = Number.isFinite(item.savedAt) ? item.savedAt : Date.now();
    const record = { format, id: "", name, savedAt, model: PROFILE_MODEL, body };
    if (have.some((old) => storedProfileOk(old) && sameProfile(old, record))) {
      same += 1;
      continue;
    }
    let id = String(newId());
    while (have.some((old) => old && old.id === id)) id = String(newId());
    record.id = id;
    have.push(record);
    list.push(record);
  }
  return { list, same };
}
