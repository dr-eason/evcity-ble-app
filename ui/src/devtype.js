/* 合并后的 App 认两种桩：AC06 汽车充电桩、M01 摩托车充电桩。这里只放规则，不碰界面和蓝牙，
 * 主机测试在 test/devtype.test.mjs。
 *
 * 认的顺序：
 *   1. 连接前看广播名：EVC 开头，第 4 个字符是 M 就是 M01，是 _ 就按 AC06 算（EVC_ 加 6 位）。
 *      M01 现在的广播名是 EVCM_ 加 6 位（11 个字符，例 EVCM_A1B2C3）；EVCM 加 6 位（没有下划线，
 *      60fcf5d 那版测试固件）也是 M01。还没重刷的老 M01 是 EVC_ 加 6 位，和 AC06 一样，所以 _
 *      只是“多半是 AC06”。
 *   2. 连上以后看第一行状态（手机那一层连上就发 STATUS，鉴权之前也回）：STAT 开头是 AC06，
 *      ACK SYS 加制表符是 M01。这一条说了算，和名字对不上时按它转到对的模块。
 *   3. 按地址记住连上后认出来的类型（dev-type:<地址>）。名字说不清（EVC_ 或者认不出）时，
 *      下次扫描用记住的。
 */

export const TYPE_AC06 = "ac06";
export const TYPE_M01 = "m01";
export const TYPE_UNKNOWN = "unknown";

/* 本地存储里记类型的键。AC06、M01 两个模块都不用这个前缀，不会串。 */
export const TYPE_KEY_PREFIX = "dev-type:";

/* 扫描页卡片上的标签（中文是翻译的键，packs-merge.js 里 13 种语言都有）。 */
export const TYPE_LABELS = {
  ac06: "汽车充电桩 AC06",
  m01: "摩托车充电桩 M01",
  unknown: "连接后识别",
};

/* 连接前：只看广播名。 */
export function typeFromName(name) {
  const up = String(name == null ? "" : name).toUpperCase();
  if (up.length < 4 || up.indexOf("EVC") !== 0) return TYPE_UNKNOWN;
  const fourth = up.charAt(3);
  if (fourth === "M") return TYPE_M01;
  if (fourth === "_") return TYPE_AC06;
  return TYPE_UNKNOWN;
}

/* 连上后：看一行状态。认不出返回 ""（不是状态行，接着等）。
 * ACK PORTS 也只有 M01 发，一起认。 */
export function typeFromStatus(line) {
  const text = String(line == null ? "" : line);
  if (text.indexOf("STAT ") === 0) return TYPE_AC06;
  if (text.indexOf("ACK SYS\t") === 0 || text.indexOf("ACK PORTS\t") === 0) return TYPE_M01;
  return "";
}

export function isKnownType(type) {
  return type === TYPE_AC06 || type === TYPE_M01;
}

function storeOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null;
  }
}

export function typeKey(addr) {
  return TYPE_KEY_PREFIX + String(addr || "");
}

/* 记住的类型。没记过、地址为空、存储不能用都返回 ""。 */
export function rememberedType(addr, storage) {
  if (!addr) return "";
  const store = storeOf(storage);
  if (!store) return "";
  try {
    const saved = store.getItem(typeKey(addr));
    return isKnownType(saved) ? saved : "";
  } catch (e) {
    return "";
  }
}

export function rememberType(addr, type, storage) {
  if (!addr || !isKnownType(type)) return false;
  const store = storeOf(storage);
  if (!store) return false;
  try {
    store.setItem(typeKey(addr), type);
    return true;
  } catch (e) {
    return false;
  }
}

/* 扫描页上这一台按哪种显示、点了交给哪个模块。
 * EVCM 开头（EVCM_ 加 6 位，或者测试固件的 EVCM 加 6 位）只有 M01 会发，直接认；
 * EVC_ 和认不出的名字先看记住的。 */
export function deviceType(item, storage) {
  const byName = typeFromName(item && item.name);
  if (byName === TYPE_M01) return TYPE_M01;
  const saved = rememberedType(item && item.addr, storage);
  if (saved) return saved;
  return byName;
}

/* 连上后认出来的类型和点的时候用的不一样，要不要换模块。 */
export function needsSwitch(routed, detected) {
  return isKnownType(detected) && routed !== detected;
}

/* 手机那一层（MainActivity.setProfile / BleLink.setProfile）用的行首表名字。
 * 认不出的先按 AC06 的表连（它的 knownLine 也放行 ACK 开头的行），连上后按状态行换。 */
export function profileFor(type) {
  return type === TYPE_M01 ? TYPE_M01 : TYPE_AC06;
}
