import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

/* 单文件 index.html 写到哪里：AC-V2 里是 Android 壳的 ../android/assets/（APP/ui 旁边有 ../android/），
 * 公开仓 evcity-ble-app 里没有 Android 壳，写到 ../assets/。iOS 的 build_ui.sh 按同样的规则找。 */
function assetsDir() {
  return existsSync(resolve("../android/AndroidManifest.xml")) ? resolve("../android/assets") : resolve("../assets");
}

/* 界面热更新（src/h5-update.js；方案在 AC-V2 的 APP/文档/H5热更新方案.md）：这一份界面是哪个基座的第几版。
 *   基座   = App 版本（appVersion()，和 __APP_VERSION__ 同一个值）
 *   修订号 = APP/ui/H5_REV 里的整数（不补零，0–999999）；安装包内置的那一份是 0
 * 编界面时写三处，说的必须是同一个「基座.r修订号」：
 *   define 的 __H5_REV__ / __H5_BASE__      页面自己显示、判断有没有新的
 *   index.html <head> 里的 <meta name="evc-h5" content="3.04.r3">
 *   index.html 旁边的 manifest.json          {"kind":"evcity-ac-h5","base":"3.04","rev":3}
 * H5_REV 读不到或不是整数就让编译失败，不悄悄当 0。 */
const H5_KIND = "evcity-ac-h5";
const H5_REV_MAX = 999999;

function h5Rev() {
  let text;
  try {
    text = readFileSync(resolve("H5_REV"), "utf8");
  } catch (e) {
    throw new Error("读不到 APP/ui/H5_REV（界面热更新的修订号，一个整数加换行）");
  }
  const m = /^(0|[1-9]\d{0,5})\r?\n?$/.exec(text);
  if (!m || Number(m[1]) > H5_REV_MAX) {
    throw new Error("APP/ui/H5_REV 要是一个不补零的整数（0–" + H5_REV_MAX + "）加换行，现在是 " + JSON.stringify(text));
  }
  return Number(m[1]);
}

function oneHtml() {
  return {
    name: "one-html",
    apply: "build",
    closeBundle() {
      const dist = resolve("dist");
      let html = readFileSync(resolve(dist, "index.html"), "utf8");
      const script = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
      const style = html.match(/<link[^>]+href="([^"]+)"[^>]*>/);
      if (!script) throw new Error("bundle script missing");
      const js = readFileSync(resolve(dist, script[1]), "utf8");
      const css = style ? readFileSync(resolve(dist, style[1]), "utf8") : "";
      html = html.replace(script[0], "");
      if (style) html = html.replace(style[0], () => `<style>${css}</style>`);
      html = html.replace("</body>", () => `<script>${js}</script></body>`);
      /* 热更新的标记：紧跟在 <head> 后面，壳只看文件开头的 4 KB。 */
      const base = appVersion();
      const rev = h5Rev();
      if (!/<head>/.test(html) || /<meta name="evc-h5"/.test(html)) throw new Error("index.html 的 <head> 不对，写不了 evc-h5 标记");
      html = html.replace("<head>", () => `<head><meta name="evc-h5" content="${base}.r${rev}">`);
      const out = assetsDir();
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out);
      writeFileSync(resolve(out, "index.html"), html);
      writeFileSync(resolve(out, "manifest.json"), JSON.stringify({ kind: H5_KIND, base, rev }) + "\n");
    },
  };
}

/* 编译时的 App 版本（__APP_VERSION__）。界面优先用原生壳运行时给的版本（src/app-version.js），
 * 这个只在原生壳没给时兜底。先取 AndroidManifest.xml 的 versionName；没有（公开仓 evcity-ble-app
 * 里只有 ui/ 和 ios/）再取 iOS 的 Config/Base.xcconfig 的 EVC_VERSION：
 *   AC-V2：  APP/ui 旁边是 ../android/（AndroidManifest.xml）和 ../ios/
 *   公开仓： ui 的上一级是仓库根，iOS 在 ../ios/ */
function readText(path) {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch (e) {
    return "";
  }
}

function appVersion() {
  const manifest = readText("../android/AndroidManifest.xml").match(/android:versionName="([^"]+)"/);
  if (manifest) return manifest[1];
  for (const path of ["../ios/Config/Base.xcconfig"]) {
    const m = readText(path).match(/^\s*EVC_VERSION\s*=\s*([^\s/]+)/m);
    if (m) return m[1];
  }
  return "";
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __H5_REV__: JSON.stringify(h5Rev()),
    __H5_BASE__: JSON.stringify(appVersion()),
  },
  plugins: [vue(), oneHtml()],
  build: {
    target: "chrome61",
    cssCodeSplit: false,
    sourcemap: false,
    minify: "esbuild",
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
