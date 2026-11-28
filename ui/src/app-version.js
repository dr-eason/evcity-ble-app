/* App 版本号从哪里来（首页底部和设置 → 关于用同一个结果）。
 *
 * 优先级：原生壳 > 编译时 > "—"。
 *   1. 原生壳：window.EVC.appVersion() / appBuild()。
 *      Android：MainActivity.Bridge 读 PackageInfo.versionName / versionCode；
 *      iOS：MainViewController 把 Bundle 的 CFBundleShortVersionString / CFBundleVersion 写进
 *      window.__evcInit，evc-shim.js 照样答。装的是哪一版就显示哪一版。
 *   2. 编译时：vite.config.js 的 __APP_VERSION__（AndroidManifest.xml 的 versionName，取不到时
 *      再找 iOS 的 Config/Base.xcconfig 的 EVC_VERSION）。老的原生壳没有 appVersion() 时用它。
 *   3. 都没有：界面显示 "—"。
 *
 * 原生给的东西先过一遍 cleanVersion：只认普通的版本写法（数字、字母、. _ + - 和空格，最长 32 个
 * 字符）。Xcode 没展开的 "$(MARKETING_VERSION)"、空串、怪字符都当没有。 */

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+\- ]{0,31}$/;

export function cleanVersion(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).trim();
  return VERSION_RE.test(text) ? text : "";
}

function callNative(api, name) {
  if (!api || typeof api[name] !== "function") return "";
  try {
    return cleanVersion(api[name]());
  } catch (e) {
    return "";
  }
}

/* api：window.EVC（可以没有）；built：编译时的 __APP_VERSION__。
 * 返回 { version, build, source }，source 是 "native" / "build" / "none"。
 * build（versionCode / CFBundleVersion）只跟着原生的版本号一起给。 */
export function resolveAppVersion(api, built) {
  const native = callNative(api, "appVersion");
  if (native) {
    const code = callNative(api, "appBuild");
    return { version: native, build: code && code !== native ? code : "", source: "native" };
  }
  const fallback = cleanVersion(built);
  if (fallback) return { version: fallback, build: "", source: "build" };
  return { version: "", build: "", source: "none" };
}

/* "3.0.0" → "V3.0.0"；已经带 V/v 的不重复加。没有版本号时是 "—"。 */
export function appVersionLabel(info) {
  const raw = info && typeof info.version === "string" ? info.version.trim() : "";
  if (!raw) return "—";
  return raw.charAt(0) === "V" || raw.charAt(0) === "v" ? "V" + raw.slice(1) : "V" + raw;
}

/* 关于页：版本号后面带上构建号，例如 "V3.0.0 (3000)"。 */
export function appVersionFull(info) {
  const label = appVersionLabel(info);
  if (label === "—" || !info.build) return label;
  return label + " (" + info.build + ")";
}

/* 界面热更新的修订号（h5-update.js）：这一页编译时写进去的 __H5_REV__（来自 APP/ui/H5_REV）。它说的就是
 * 「现在屏幕上这一页是第几版」，不靠原生转述。取不到、不是 0–999999 的整数时当 0（安装包内置的那一份）。 */
export function h5Rev(built) {
  return typeof built === "number" && Number.isInteger(built) && built >= 0 && built <= 999999 ? built : 0;
}

/* 版本号后面接修订号的各段文字，界面按段画：
 *   version  "V3.04"；关于页（full）带构建号 "V3.04 (30400)"；没有版本号是 "—"
 *   sep      "·"
 *   word     "热更新"（中文键，要过 t()）
 *   rev      "r3"
 * version、sep、rev 不翻译，各自包在 <bdi dir="ltr"> 里；没热更新过也显示 r0。 */
export function appVersionWithH5(info, rev, full) {
  return { version: full ? appVersionFull(info) : appVersionLabel(info), sep: "·", word: "热更新", rev: "r" + h5Rev(rev) };
}

/* 上面那几段连成一句中文（给测试和日志对照）："V3.04 · 热更新 r3"。 */
export function appVersionH5Text(info, rev, full) {
  const p = appVersionWithH5(info, rev, full);
  return p.version + " " + p.sep + " " + p.word + " " + p.rev;
}
