/* App 版本号：原生壳 > 编译时 > "—"；首页底部和设置 → 关于用同一个来源。
 *
 *     node --test AC06/tools/ble-finder/ui/test/app-version.test.mjs
 *
 * 没有手机：版本来源用 app-version.js 直接测；Android / iOS 原生只核对源码里的约定，再把 iOS 的
 * evc-shim.js 放进一个假的 window 里跑一遍。公开仓 evcity-ble-app（ui/ + ios/，没有 Android）里
 * 也能跑：找不到的原生文件那几条跳过。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appVersionFull, appVersionLabel, cleanVersion, resolveAppVersion } from "../src/app-version.js";

const here = dirname(fileURLToPath(import.meta.url));
const ui = resolve(here, "..");
const read = (path) => readFileSync(path, "utf8");
/* 第一个存在的路径：AC-V2 的目录布局 / 公开仓的目录布局。 */
const pick = (...paths) => paths.map((p) => resolve(ui, p)).find((p) => existsSync(p)) || "";
const IOS = pick("../../ble-ios", "../ios");
const JAVA = pick("../src/com/evcity/acv2/MainActivity.java");

const native = (version, build) => ({ appVersion: () => version, appBuild: () => build });

test("来源优先级：原生有就用原生（连构建号），编译时的不看", () => {
  const info = resolveAppVersion(native("3.0.1", "3001"), "3.0.0");
  assert.deepEqual(info, { version: "3.0.1", build: "3001", source: "native" });
  assert.equal(appVersionLabel(info), "V3.0.1");
  assert.equal(appVersionFull(info), "V3.0.1 (3001)");
});

test("来源优先级：原生没有 / 空 / 抛异常 / 不像版本号 → 编译时", () => {
  const cases = [
    null,
    undefined,
    {},
    { appVersion: "3.0.1" },                        /* 不是函数 */
    native("", "3000"),
    native("   ", ""),
    native(null, null),
    native("$(MARKETING_VERSION)", "$(CURRENT_PROJECT_VERSION)"), /* Xcode 没展开 */
    native("<b>1</b>", ""),
    native("x".repeat(40), ""),
    { appVersion() { throw new Error("bridge gone"); } },
  ];
  for (const api of cases) {
    const info = resolveAppVersion(api, "3.0.0");
    assert.deepEqual(info, { version: "3.0.0", build: "", source: "build" }, JSON.stringify(api));
    assert.equal(appVersionLabel(info), "V3.0.0");
    assert.equal(appVersionFull(info), "V3.0.0");
  }
});

test("来源优先级：两边都没有 → \"—\"", () => {
  for (const built of ["", "  ", undefined, null, "$(X)"]) {
    const info = resolveAppVersion(native("", ""), built);
    assert.deepEqual(info, { version: "", build: "", source: "none" });
    assert.equal(appVersionLabel(info), "—");
    assert.equal(appVersionFull(info), "—");
  }
  assert.equal(appVersionLabel(null), "—");
});

test("构建号：坏的、和版本号一样的不显示；appBuild 抛异常不影响版本号", () => {
  assert.equal(resolveAppVersion(native("3.0.0", "$(CURRENT_PROJECT_VERSION)"), "").build, "");
  assert.equal(resolveAppVersion(native("3.0.0", "3.0.0"), "").build, "");
  const api = { appVersion: () => "3.0.0", appBuild() { throw new Error("x"); } };
  assert.deepEqual(resolveAppVersion(api, ""), { version: "3.0.0", build: "", source: "native" });
  assert.equal(appVersionFull({ version: "v3.0.0", build: "" }), "V3.0.0");
  assert.equal(cleanVersion(" 3.0.0-beta.1+42 "), "3.0.0-beta.1+42");
  assert.equal(cleanVersion(3000), "3000");
});

test("界面：首页底部和关于页都用 app-version.js 的结果，首页那行带「App 版本」标签", () => {
  const vue = read(resolve(ui, "src/App.vue"));
  assert.match(vue, /import \{ appVersionFull, appVersionLabel, resolveAppVersion \} from "\.\/app-version\.js";/);
  assert.match(vue, /const appVersionInfo = resolveAppVersion\(bridge\(\), typeof __APP_VERSION__ === "string" \? __APP_VERSION__ : ""\);/);
  /* 首页（立即充电）这一段里，「断开蓝牙」后面一行版本号。 */
  const charge = vue.slice(vue.indexOf(`<section v-else-if="page === 'charge'"`), vue.indexOf(`<section v-else-if="page === 'gate'"`));
  assert.ok(charge.length > 0);
  assert.match(charge, /<button class="text alone" @click="disconnect">\{\{ t\('断开蓝牙'\) \}\}<\/button>\s*<p class="appver" @click="checkAppUpdate">\{\{ t\('App 版本'\) \}\} <bdi dir="ltr">\{\{ appVersionShort \}\}<\/bdi><\/p>\s*<\/section>/);
  /* 关于页。 */
  assert.match(vue, /<strong>\{\{ t\('App 版本'\) \}\}<\/strong><\/span>\s*<em class="ver">\{\{ appVersionLong \}\}<\/em>/);
  /* 不再直接拿 __APP_VERSION__ 显示。 */
  assert.doesNotMatch(vue, /verLabel\(appVersion\)/);
  /* 版本行是普通排版，不是 fixed，靠 .app.tabbed 的底边距让开标签栏。 */
  const css = /\.appver \{([^}]*)\}/.exec(vue);
  assert.ok(css, ".appver 样式");
  assert.doesNotMatch(css[1], /position\s*:\s*(fixed|absolute|sticky)/);
  assert.match(css[1], /font-size: 12px/);
  assert.match(vue, /\.app\.tabbed \{ padding-bottom: 96px; padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\); \}/);
});

test("i18n：「App 版本」12 种语言都有（中文是键）", async () => {
  const { languages, translate } = await import("../src/i18n.js");
  const others = languages.filter((item) => !/^zh/.test(item.id));
  assert.ok(others.length >= 12, "语言数 " + others.length);
  for (const item of others) {
    const text = translate(item.id, "App 版本");
    assert.ok(text && text !== "App 版本", item.id + " 没有翻译");
  }
});

test("编译时兜底：先 AndroidManifest 的 versionName，再 iOS Base.xcconfig 的 EVC_VERSION", () => {
  const vite = read(resolve(ui, "vite.config.js"));
  assert.match(vite, /__APP_VERSION__: JSON\.stringify\(appVersion\(\)\)/);
  assert.match(vite, /"\.\.\/ios\/Config\/Base\.xcconfig", "\.\.\/\.\.\/ble-ios\/Config\/Base\.xcconfig"/);
  if (IOS) {
    const xc = read(resolve(IOS, "Config/Base.xcconfig"));
    const m = /^\s*EVC_VERSION\s*=\s*([^\s/]+)/m.exec(xc);
    assert.ok(m, "Base.xcconfig 里有 EVC_VERSION");
    const manifest = pick("../AndroidManifest.xml");
    if (manifest) {
      const name = /android:versionName="([^"]+)"/.exec(read(manifest));
      assert.equal(m[1], name[1], "iOS 和 Android 的版本号一致");
    }
  }
});

test("Android：Bridge 有 appVersion / appBuild，读 PackageInfo", { skip: !JAVA && "没有 Android 源码" }, () => {
  const java = read(JAVA);
  assert.match(java, /import android\.content\.pm\.PackageInfo;/);
  assert.match(java, /@JavascriptInterface\s+public String appVersion\(\) \{[^}]*info\.versionName/);
  assert.match(java, /@JavascriptInterface\s+@SuppressWarnings\("deprecation"\)\s+public String appBuild\(\) \{[^}]*getLongVersionCode\(\)/);
  assert.match(java, /getPackageManager\(\)\.getPackageInfo\(getPackageName\(\), 0\)/);
});

test("iOS：控制器把 Bundle 版本写进 ShimInit，Bridge.swift 写进 __evcInit", { skip: !IOS && "没有 iOS 工程" }, () => {
  const vc = read(resolve(IOS, "App/Sources/MainViewController.swift"));
  assert.match(vc, /let info = Bundle\.main\.infoDictionary/);
  assert.match(vc, /appVersion: info\?\["CFBundleShortVersionString"\] as\? String \?\? "",/);
  assert.match(vc, /appBuild: info\?\["CFBundleVersion"\] as\? String \?\? ""\)\.script/);
  const swift = read(resolve(IOS, "Core/Sources/EVCCore/Bridge.swift"));
  assert.match(swift, /appVersion: String = "", appBuild: String = ""\) \{/);
  assert.match(swift, /"appVersion": appVersion,\s*"appBuild": appBuild,/);
  const plist = read(resolve(IOS, "App/Resources/Info.plist"));
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
});

test("iOS shim 真跑一遍：appVersion() / appBuild() 原样返回 __evcInit 里的；没有时是空串", { skip: !IOS && "没有 iOS 工程" }, () => {
  const source = read(resolve(IOS, "App/Resources/Bridge/evc-shim.js"));
  const document = { readyState: "complete", addEventListener() {}, querySelector: () => null };
  const run = (init) => {
    const window = { __evcInit: init };
    new Function("window", "document", source)(window, document);
    return window.EVC;
  };
  let evc = run({ locale: "en", gate: {}, mock: true, nativeFilePicker: false, appVersion: "3.0.0", appBuild: "3000" });
  assert.equal(evc.appVersion(), "3.0.0");
  assert.equal(evc.appBuild(), "3000");
  assert.deepEqual(resolveAppVersion(evc, "2.9.9"), { version: "3.0.0", build: "3000", source: "native" });
  /* 老的原生壳（__evcInit 里没有版本号）：回到编译时的。 */
  evc = run({ locale: "en", gate: {}, mock: false, nativeFilePicker: false });
  assert.equal(evc.appVersion(), "");
  assert.equal(evc.appBuild(), "");
  assert.deepEqual(resolveAppVersion(evc, "3.0.0"), { version: "3.0.0", build: "", source: "build" });
  evc = run({ appVersion: 3, appBuild: {} });
  assert.equal(evc.appVersion(), "");
  assert.equal(evc.appBuild(), "");
});
