/* WiFi 配网页（App.vue 的 wifi、pass 两页）的规则：主板联网开关关着时说清楚原因，
 * 搜索热点等不到结果时不一直转圈。命令和应答见 文档/04-协议/M01蓝牙协议.md 5.7。
 *
 * 主板上的联网开关（拨码第 1 位）关着时，WIFISWSET⇥1、WJOIN、OCPPSWSET⇥1、LTESET⇥1 都回
 * FAIL，WSCAN 也马上回 ACK WSCAN FAIL（老固件回 ACK WSCAN OK，之后什么都不来）。
 * 开关状态在 PAYGET 的应答里（ports.js 的 parsePay，net 字段），桩上电时采样一次。 */

export const NET_OFF_NOTE = "主板上的联网开关是关的，WiFi、OCPP、4G 都打不开。把它打开后要重新上电";
export const SCAN_LOST_NOTE = "没有收到搜索结果，请再试一次";
/* 桩上一次扫描最多 15 秒，32 个热点一行一行发完再加几秒。 */
export const SCAN_LIMIT_MS = 25000;

/* PAYGET 读到联网开关关着。还没读到时不算：照常发命令，由桩的应答说话。 */
export function netSwitchOff(payKnown, pay) {
  return !!payKnown && !!pay && pay.net === false;
}

/* 设置被桩拒绝（FAIL）时的提示：联网开关关着就说开关，否则用原来那句。 */
export function refusedNote(netOff, fallback) {
  return netOff ? NET_OFF_NOTE : fallback;
}

/* 一次"搜索热点"。返回的字符串是要显示的提示，null 表示提示不变。
 * 1.3.2 以前的固件（fw-compat.js 的 wscanAnytime 为假）：WiFi 开关关着时回 ACK WSCAN OK 却不扫，
 * 之后什么都不来（App.vue 这时不发 WSCAN，请用户先开 WiFi）；开关开着时 ACK WSCAN OK 要等扫完、
 * AP 行之后才到。新老固件走同一套等法：
 *   - 等不到 APDONE 时，到 SCAN_LIMIT_MS 说没有收到结果（expired）；
 *   - 3 秒没等到 ACK 不说"没有应答"，结果可能还在路上（silent）；
 *   - 扫完以后才到的 ACK WSCAN OK 不把"点一个热点"改回"正在搜索"。 */
export function createWifiScan() {
  let waiting = false;
  let since = 0;
  return {
    get waiting() {
      return waiting;
    },
    start(now) {
      waiting = true;
      since = now;
      return "正在搜索热点";
    },
    /* "ACK WSCAN <word>" */
    ack(word, netOff) {
      if (word === "FAIL") {
        waiting = false;
        return refusedNote(netOff, "搜索热点失败");
      }
      if (word === "BUSY") return waiting ? "正在搜索或连接，请稍等" : null;
      return waiting ? "正在搜索热点" : null;
    },
    done(count) {
      waiting = false;
      return count ? "点一个热点，再填密码" : "没有搜到热点";
    },
    expired(now) {
      if (!waiting || now - since < SCAN_LIMIT_MS) return null;
      waiting = false;
      return SCAN_LOST_NOTE;
    },
    reset() {
      waiting = false;
    },
  };
}

/* 搜索结果的一行。两种写法（文档/04-协议/M01蓝牙协议.md 5.7）：
 *   "AP -52 shop 5G"        热点名原样，空格后面到行尾都是名字
 *   "AP -60\t484f54454c"    热点名的小写十六进制（UTF-8 字节）。名字里有手机那一层认的行首
 *                           （"HOTEL 5G" 里的 "TEL "）、控制字符、首尾空格时桩发这种，
 *                           原样发会被从中间切开。
 * 返回 { rssi, ssid }；不是 AP 行、名字不能用（空、超过 32 字节、控制字符、不是 UTF-8）返回 null。 */
export function parseApLine(line) {
  if (typeof line !== "string" || line.indexOf("AP ") !== 0) return null;
  const body = line.slice(3);
  const m = /^(-?\d{1,3})(?:\t([0-9a-f]*)| (.*))$/.exec(body);
  if (!m) return null;
  let ssid;
  if (m[2] !== undefined) {
    if (!m[2] || m[2].length % 2 || m[2].length > 64) return null;
    const bytes = new Uint8Array(m[2].length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(m[2].slice(i * 2, i * 2 + 2), 16);
    ssid = new TextDecoder("utf-8").decode(bytes);
  } else {
    ssid = m[3].trim();
  }
  if (!ssid || new TextEncoder().encode(ssid).length > 32 || /[\u0000-\u001F\u007F�]/.test(ssid)) return null;
  return { rssi: m[1], ssid };
}
