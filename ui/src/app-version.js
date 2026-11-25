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
