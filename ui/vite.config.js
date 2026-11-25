import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

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
      const out = resolve("../assets");
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out);
      writeFileSync(resolve(out, "index.html"), html);
    },
  };
}

/* 编译时的 App 版本（__APP_VERSION__）。界面优先用原生壳运行时给的版本（src/app-version.js），
 * 这个只在原生壳没给时兜底。先取 AndroidManifest.xml 的 versionName；没有（公开仓 evcity-ble-app
 * 里只有 ui/ 和 ios/）再取 iOS 的 Config/Base.xcconfig 的 EVC_VERSION：
 *   AC-V2：  ui 的上一级是 ble-finder/，iOS 在 ../../ble-ios/
 *   公开仓： ui 的上一级是仓库根，iOS 在 ../ios/ */
function readText(path) {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch (e) {
    return "";
  }
}

function appVersion() {
  const manifest = readText("../AndroidManifest.xml").match(/android:versionName="([^"]+)"/);
  if (manifest) return manifest[1];
  for (const path of ["../ios/Config/Base.xcconfig", "../../ble-ios/Config/Base.xcconfig"]) {
    const m = readText(path).match(/^\s*EVC_VERSION\s*=\s*([^\s/]+)/m);
    if (m) return m[1];
  }
  return "";
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
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
