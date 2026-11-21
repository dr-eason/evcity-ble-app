/* 已连热点的信号强度（dBm）。
 *
 * 固件 2.6.5 起，状态里的 LIVE 行多一个字段：
 *     LIVE <接地电压> <CP 电压> <RSSI>
 * RSSI 是负整数，例如 -62；热点没连上或桩还没问到模组时是 "-"。2.6.4 及更早的固件
 * 没有这个字段。两种情况都返回 null，界面上不显示数值。 */
export function liveRssi(line) {
  if (typeof line !== "string" || line.indexOf("LIVE ") !== 0) return null;
  const part = line.trim().split(/\s+/);
  if (part.length < 4) return null;
  if (!/^-\d{1,3}$/.test(part[3])) return null;
  const dbm = parseInt(part[3], 10);
  if (dbm < -120 || dbm > -1) return null;
  return dbm;
}

/* LIVE 行里有没有信号强度这个字段、但桩手里还没有数值（固件发的是 "-"）。
 * 2.6.5 起的固件热点连上了、还没问到模组时就是这样；2.6.4 及更早没有这个字段，返回 false。 */
export function liveRssiPending(line) {
  if (typeof line !== "string" || line.indexOf("LIVE ") !== 0) return false;
  const part = line.trim().split(/\s+/);
  return part.length >= 4 && liveRssi(line) === null;
}

/* 首页「WiFi 已连接」那一行。label 是连接状态的中文（翻译按这个行首匹配）。
 * 和桩的屏幕（2.6.11）同一条规则，只在已连接（link === "UP"）时带括号：
 *   有数值            " (-62 dBm)"
 *   没数值、pending   " (--)"      桩有这个字段，只是还没问到
 *   没数值、旧固件    不带括号，和 2.6.4 的 App 一样 */
export function wifiStatusText(label, link, ssid, rssi, pending) {
  let text = label;
  if (link === "UP" && Number.isInteger(rssi) && rssi <= -1 && rssi >= -120) {
    text += " (" + rssi + " dBm)";
  } else if (link === "UP" && pending === true) {
    text += " (--)";
  }
  return text + (ssid ? "  " + ssid : "");
}
