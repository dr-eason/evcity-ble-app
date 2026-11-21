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

export default defineConfig({
  base: "./",
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
