/* App 和充电桩固件的兼容框架。说明、能力表、新增功能时怎么登记：文档/04-协议/App固件兼容框架.md。
 *
 * 规矩只有三条：
 *   1. 连上以后先拿固件版本：桩回 STATUS 的那组状态里，ACK SYS 第 1 个字段是固件版本
 *      （1.0.0 起每一版都有，通过 AUTH 之前也回），1.3.4 起第 11 个字段是固件自己报的能力位。
 *      App.vue 收到 ACK SYS 就调用 fwState()，换一台桩、断开时回到 FW_UNKNOWN。
 *   2. 别的代码只问 supports(state, "能力名")，不自己比版本号，不靠"问了没回"猜。
 *   3. 拿不到版本（没收到 ACK SYS、版本号认不出）按最老支持的固件 MIN_FW 处理。
 *
 * 判断顺序：桩报了能力位（1.3.4 起）就只看能力位；没报就看版本号是否在 [since, until)。
 * 能力位是固件按自己真有的功能报的，以后去掉了某项、或者某一版裁掉了某项，App 不用改。
 *
 * 这个文件不碰界面和蓝牙，主机测试 ui/test/fw-compat.test.mjs 直接用。 */

/* 这个 App 的版本。和 AndroidManifest.xml 的 versionName、固件 M01_FW_VERSION 相同
 * （文档/07-开发环境/版本号规则.md），测试会核对。 */
export const APP_VERSION = "1.3.6";

/* ACK SYS 第 11 个字段（能力位）从这一版固件起有。更早的（含 1.3.3）只能按版本号查能力表。 */
export const CAPS_FIELD_SINCE = "1.3.4";

/* 最低支持的固件版本：M01 的第一版。比它老的（不是 M01 的固件）App 只当它是 1.0.0 来用，
 * 并提示先升级。 */
export const MIN_FW = "1.0.0";

/* 能力表。每一项：
 *   key    代码里问的名字（supports(state, key)）
 *   bit    固件 ACK SYS 第 11 个字段里的位号，和 M01/app/inc/ble_caps.h 的 BLE_CAP_* 一一对应。
 *          分配了就不改、不复用；去掉的功能位号留空
 *   since  第一个带这项的固件版本
 *   until  （可选）去掉这项的固件版本：这一版起没有
 * 每一项上面的注释写这项是什么、固件没有时 App 怎么做，和文档的能力表一致。顺序按 bit。
 * 新功能加在最后，按 文档/04-协议/App固件兼容框架.md 第 5 节的步骤登记。 */
export const CAPS = [
  /* 每秒推送 ACK PORTX：每路电流、离线刷卡余额。
   * 没有时：首页格子电流写 — A，不显示余额。 */
  { key: "portsX", bit: 0, since: "1.1.0" },
  /* ACK PORT 第 15–20 个字段、ACK ORD 第 12–15 个字段：离线刷卡的金额、充满倒计时。
   * 没有时：这几项按 0 处理，详情页和充电记录不显示金额。 */
  { key: "payInfo", bit: 1, since: "1.1.0" },
  /* PAYGET / PAYSET：收费模型、充满门槛、拨码（联网开关）、运营商。
   * 没有时：菜单的充电规则写需升级固件，不发命令；一键配置跳过充电规则；不知道联网开关，WiFi 等照常发命令。 */
  { key: "payRules", bit: 2, since: "1.1.0" },
  /* PARGET / PARSET（含只保存不重启的第二个参数 0）：并充。
   * 没有时：菜单的并充写需升级固件，不发命令；一键配置跳过并充；重连后不核对上次的切换。 */
  { key: "parallel", bit: 3, since: "1.2.0" },
  /* ACK ORDN 和 ORDGET⇥<起始>⇥<条数>：订单历史存在 Flash，翻页。
   * 没有时：只读最近 32 条，不显示读取更多，提示固件只留最近 32 条。 */
  { key: "orderPaging", bit: 4, since: "1.2.0" },
  /* 通过 AUTH 才收命令；ACK AUTH LOCKED <秒>、ACK <命令名> AUTH。
   * 没有时：老固件不发这几行，App 照常先发 AUTH，不用分支。 */
  { key: "authGate", bit: 5, since: "1.3.0" },
  /* 写用户页的命令有额度，用完回 ACK <命令名> BUSY。
   * 没有时：老固件不回 BUSY，App 不用分支。 */
  { key: "writeQuota", bit: 6, since: "1.3.0" },
  /* OCPPSET 认 wss:// 地址。
   * 没有时：填 wss:// 不发命令，提示升级固件或改用 ws://；一键配置里的 wss:// 地址不下发、记失败。 */
  { key: "ocppWss", bit: 7, since: "1.3.0" },
  /* ADVGET：蓝牙广播看护的诊断计数。
   * 没有时：模组版本页不发 ADVGET，写需升级固件。 */
  { key: "advDiag", bit: 8, since: "1.3.0" },
  /* PAYSET 第 3 个参数（低载多久停止）、ACK PAY 行尾的秒数上下限。
   * 没有时：PAYSET 只发两个参数（带了第 3 个老固件回 FAIL），持续秒数不能改；一键配置不比这一项。 */
  { key: "payHold", bit: 9, since: "1.3.2" },
  /* SNAPGET⇥<请求号> → ACK SNAP：首页一问一答的快照。
   * 没有时：首页用每秒推送的 ACK PORTS / ACK PORTX，需要时发 STATUS。 */
  { key: "snapshot", bit: 10, since: "1.3.2" },
  /* WSCAN：WiFi 开关关着也扫；先回 ACK WSCAN OK 再扫；联网开关关着回 FAIL。
   * 没有时：WiFi 开关关着时不发 WSCAN（老固件回 OK 却不扫），提示先打开 WiFi 开关。 */
  { key: "wscanAnytime", bit: 11, since: "1.3.2" },
  /* AP <信号>⇥<热点名十六进制>：名字带行首、控制字符的热点。
   * 没有时：老固件只发原样的 AP 行，解析两种都认，不用分支。 */
  { key: "apHex", bit: 12, since: "1.3.2" },
];

const CAP_BY_KEY = Object.fromEntries(CAPS.map((cap) => [cap.key, cap]));

/* "1.3.2"、"V1.3.2"、"1.3.2-dev" → [1, 3, 2]；"1.3" → [1, 3, 0]；认不出返回 null。 */
export function parseVersion(text) {
  const m = /^[Vv]?(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?(?![\d.])/.exec(String(text == null ? "" : text).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])];
}

/* 比两个版本：a < b 返回负数，相等 0，a > b 正数。参数是字符串或 parseVersion 的结果。 */
export function compareVersion(a, b) {
  const pa = Array.isArray(a) ? a : parseVersion(a);
  const pb = Array.isArray(b) ? b : parseVersion(b);
  if (!pa || !pb) throw new Error("bad version: " + a + " / " + b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/* 固件升级页：选的文件比桩上的旧（降级）。哪一个认不出都不算降级。 */
export function isDowngrade(fileVer, pileVer) {
  const file = parseVersion(fileVer);
  const pile = parseVersion(pileVer);
  if (!file || !pile) return false;
  return compareVersion(file, pile) < 0;
}

/* ACK SYS 第 11 个字段：能力位，大写十六进制，最低位是 bit 0，1–16 位数（够 64 项）。
 * 返回小写十六进制串（去掉前导 0），不是能力位返回 null。 */
export function parseCapBits(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!/^[0-9A-Fa-f]{1,16}$/.test(raw)) return null;
  return raw.toLowerCase().replace(/^0+(?=.)/, "");
}

/* 十六进制能力位里的第 bit 位。 */
function bitOn(hex, bit) {
  const digit = hex.length - 1 - Math.floor(bit / 4);
  if (digit < 0) return false;
  return ((parseInt(hex[digit], 16) >> (bit % 4)) & 1) === 1;
}

/* 一台桩的固件情况。fwText：ACK SYS 的第 1 个字段；capsText：第 11 个字段（老固件没有）。
 *   { fw: "1.3.2" 或 "", parts: [1,3,2] 或 null, bits: "1fff" 或 null, known, settled }
 * known：认出了版本号。settled：已经有结论（认出来了，或者等不到、只好按最老的算）。 */
export function fwState(fwText, capsText) {
  const fw = String(fwText == null ? "" : fwText).trim();
  const parts = parseVersion(fw);
  return {
    fw: parts ? fw : "",
    parts,
    bits: parts ? parseCapBits(capsText) : null,
    known: !!parts,
    settled: !!parts,
  };
}

/* 刚连上、还没收到 ACK SYS。 */
export const FW_UNKNOWN = Object.freeze(fwState("", ""));

/* 问了几次 STATUS 都没收到能认的 ACK SYS：按最老的固件算，不再等。 */
export function fwGiveUp(state) {
  if (state && state.known) return state;
  return { ...FW_UNKNOWN, settled: true };
}

/* 这台桩有没有这项能力。key 不在能力表里是写错了，直接抛异常（测试会抓到）。 */
export function supports(state, key) {
  const cap = CAP_BY_KEY[key];
  if (!cap) throw new Error("unknown capability: " + key);
  if (state && state.known && state.bits !== null) return bitOn(state.bits, cap.bit);
  const parts = state && state.known ? state.parts : parseVersion(MIN_FW);
  if (compareVersion(parts, cap.since) < 0) return false;
  if (cap.until && compareVersion(parts, cap.until) >= 0) return false;
  return true;
}

/* 这一项从哪一版起有。界面上写"请升级到 {need}"。 */
export function capSince(key) {
  const cap = CAP_BY_KEY[key];
  if (!cap) throw new Error("unknown capability: " + key);
  return cap.since;
}

/* 固件和 App 的关系：
 *   pending  还没收到 ACK SYS        unknown  等不到、认不出，按 MIN_FW 算
 *   tooOld   比 MIN_FW 还老          older    比 App 旧（有些功能用不了）
 *   same     和 App 同一版            newer    比 App 新（新功能要更新 App） */
export function fwRelation(state, appVersion) {
  if (!state || !state.settled) return "pending";
  if (!state.known) return "unknown";
  if (compareVersion(state.parts, MIN_FW) < 0) return "tooOld";
  const cmp = compareVersion(state.parts, appVersion || APP_VERSION);
  if (cmp < 0) return "older";
  if (cmp > 0) return "newer";
  return "same";
}

/* 界面上的字（中文是翻译的键，12 种语言在 packs-compat.js）。 */
export const COMPAT_TEXTS = {
  unknown: "没有读到充电桩的固件版本，按最老的 {min} 处理，有些功能先不用",
  tooOld: "充电桩固件 {fw} 太老，这个 App 只支持 {min} 及以上。请先升级固件",
  older: "充电桩固件 {fw} 比 App {app} 旧，有些功能用不了。可以在“固件升级”里升级",
  newer: "充电桩固件 {fw} 比 App {app} 新。新加的功能要更新 App 才能用",
  lack: "充电桩固件 {fw} 没有这项功能。请升级到 {need} 或以上",
  lackUnknown: "没有读到充电桩的固件版本，这项功能先不用",
  brief: "需升级固件",
  wss: "充电桩固件 {fw} 不认 wss:// 地址。请升级到 {need} 或以上，或者改用 ws://",
  hold: "充电桩固件 {fw} 不能改持续时间，固定 {s} 秒。升级到 {need} 或以上才能改",
  scanOff: "充电桩固件 {fw} 要先打开 WiFi 开关才能搜索热点。升级到 {need} 或以上不用",
  orders32: "充电桩固件 {fw} 只留最近 32 条充电记录。升级到 {need} 或以上能翻看更早的",
  skip: "充电桩固件 {fw} 没有这一项，请升级到 {need} 或以上",
};

function fwLabel(state) {
  return state && state.known ? state.fw : "—";
}

/* 首页、菜单顶上的那一行：{ text, vars, warn }；和 App 同一版、还没收到版本时是 null。 */
export function compatNotice(state, appVersion) {
  const rel = fwRelation(state, appVersion);
  const app = appVersion || APP_VERSION;
  const vars = { fw: fwLabel(state), app, min: MIN_FW };
  if (rel === "unknown") return { text: COMPAT_TEXTS.unknown, vars, warn: true };
  if (rel === "tooOld") return { text: COMPAT_TEXTS.tooOld, vars, warn: true };
  if (rel === "older") return { text: COMPAT_TEXTS.older, vars, warn: false };
  if (rel === "newer") return { text: COMPAT_TEXTS.newer, vars, warn: false };
  return null;
}

/* 固件没有 key 这项时给用户的一句：{ text, vars }。有这项返回 null。
 * kind 是 COMPAT_TEXTS 里的哪一句（默认 lack），extra 是这一句另外的占位符。 */
export function lackNote(state, key, kind, extra) {
  if (supports(state, key)) return null;
  if (!state || !state.known) return { text: COMPAT_TEXTS.lackUnknown, vars: null };
  return {
    text: COMPAT_TEXTS[kind || "lack"],
    vars: { fw: fwLabel(state), need: capSince(key), ...(extra || {}) },
  };
}

/* 一键配置的各项要哪项能力。没有列的项老固件都有。 */
export const SECTION_NEEDS = {
  pay: "payRules",
  par: "parallel",
};

/* 一键配置的这一项在这台桩上能不能读写：能返回 null，不能返回 { text, vars }（界面写"已跳过"）。 */
export function sectionLack(state, sectionKey) {
  const key = SECTION_NEEDS[sectionKey];
  if (!key) return null;
  return lackNote(state, key, "skip");
}
