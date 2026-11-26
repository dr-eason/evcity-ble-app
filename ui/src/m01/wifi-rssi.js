/* 首页「WiFi 已连接」那一行。
 *
 * 已连热点的信号强度（dBm）在每秒推送的 ACK SYS 行第 6 个字段里（ports.js 的 parseSys）：
 * 负整数，例如 -62；热点没连上或桩还没问到模组时是 "-"（解析出来是 null）。
 *
 * label 是连接状态的中文（翻译按这个行首匹配）。只在已连接（link === "UP"）时带括号：
 *   有数值   " (-62 dBm)"
 *   没数值   " (--)"      桩还没问到模组 */
export function wifiStatusText(label, link, ssid, rssi) {
  let text = label;
  if (link === "UP") {
    text += Number.isInteger(rssi) && rssi <= -1 && rssi >= -120 ? " (" + rssi + " dBm)" : " (--)";
  }
  return text + (ssid ? "  " + ssid : "");
}
