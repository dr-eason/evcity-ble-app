/* 固件分区布局（3.0.0，B 方案）：App 要认得出应用固件和桩各是哪一种分区，不能发错。
 *
 *   布局 1（L1，老分区）  现场的老桩。应用从 0x0800C000 起，200 KB，复位入口在
 *                         0x0800C000～0x0803E000，镜像里没有布局标记。
 *   布局 2（L2，新板）    16 KB bootloader 的新板。应用从 0x08004000 起，240 KB；向量表后面
 *                         （偏移 0x130）是布局标记 'F','L','A','Y' + 2，复位入口紧跟着，
 *                         在 0x08004000～0x0800C000。
 *
 * 老分区（L1）已经退役：产品只编、只发布 L2 的固件，不再有新的 L1 包。但现场还有 L1 的桩，
 * 手机里、网盘上也还会有以前的 L1 文件，所以这里的识别和拒发都要留着（防变砖，不是继续支持
 * L1）：不把 L2 的包发给老桩，不把残留的 L1 文件发给新板。firmwareLayout() 对 L1 文件必须
 * 返回 1，不能把它当成合法的 L2，也不能只认 L2 而放过它。
 *
 * 桩是哪一种：L2 的固件在 OTAPREP / OTACHECK 的应答后面多一段 "L2"
 * （"ACK OTAPREP 1 1 1 L2"）。L1 的固件（所有旧版本）没有这一段，按老分区算。
 * 文件和桩不是同一种就不发：L2 的包发到老桩上，老桩收完也会拒收（2.1.1 起查入口），
 * 但更早的版本只能靠这里挡；L1 的包发到新板上，新板收完查标记拒收。
 * 固件那一侧见 AC06/config/flash_layout.h（只有 L2），主机测试在 test/fw-layout.test.mjs。 */

export const LAYOUT_MARK_OFFSET = 0x130;
export const LAYOUT_MARK_MAGIC = 0x59414c46;   /* 'F','L','A','Y' */

/* 1 是退役的老分区，数字固定（现场老桩的 bootloader 换不了），只用来认文件和桩。 */
export const LAYOUTS = {
  1: { base: 0x0800c000, size: 200 * 1024, entryEnd: 0x0800c000 + 200 * 1024 },
  2: { base: 0x08004000, size: 240 * 1024, entryEnd: 0x0800c000 },
};

/* 文件能有多大：两种布局里大的那个。具体的桩按 layoutMaxSize(布局) 再卡。 */
export const FIRMWARE_MAX = LAYOUTS[2].size;

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

/* 应用镜像的布局：1、2，不是应用固件返回 0。bytes 是 Uint8Array（长度已经补到 4 的倍数）。 */
export function firmwareLayout(bytes) {
  if (!bytes || bytes.length < 8) return 0;
  const sp = u32(bytes, 0);
  const reset = u32(bytes, 4);
  const entry = (reset & ~1) >>> 0;
  if (sp < 0x20000000 || sp > 0x20018000) return 0;
  if ((reset & 1) === 0) return 0;
  const marked = bytes.length >= LAYOUT_MARK_OFFSET + 8 &&
    u32(bytes, LAYOUT_MARK_OFFSET) === LAYOUT_MARK_MAGIC;
  if (marked) {
    const layout = u32(bytes, LAYOUT_MARK_OFFSET + 4);
    const spec = LAYOUTS[layout];
    if (layout !== 2 || !spec) return 0;
    if (entry < spec.base || entry >= spec.entryEnd) return 0;
    if (bytes.length > spec.size) return 0;
    return 2;
  }
  const old = LAYOUTS[1];
  if (entry < old.base || entry >= old.entryEnd) return 0;
  if (bytes.length > old.size) return 0;
  return 1;
}

export function layoutMaxSize(layout) {
  return (LAYOUTS[layout] || LAYOUTS[1]).size;
}

/* OTAPREP / OTACHECK 的应答里桩的布局。不是这两种应答返回 0；没有布局那一段返回 1。 */
export function pileLayoutFrom(line) {
  const part = String(line || "").trim().split(/\s+/);
  const base = part[0] === "ACK" ? 1 : 0;
  if (part[base] !== "OTAPREP" && part[base] !== "OTACHECK") return 0;
  const tag = part[base + 4];
  const m = /^L(\d+)$/.exec(tag || "");
  return m ? Number(m[1]) : 1;
}

/* 界面上的叫法。 */
export function layoutLabel(layout) {
  if (layout === 2) return "L2";
  if (layout === 1) return "L1";
  return "";
}

/* 文件和桩对不上时的提示（中文是 i18n 的键）。对得上返回 ""。 */
export function layoutMismatchNote(fileLayout, pileLayout) {
  if (!fileLayout || !pileLayout || fileLayout === pileLayout) return "";
  if (fileLayout === 2) return "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级";
  return "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级";
}
