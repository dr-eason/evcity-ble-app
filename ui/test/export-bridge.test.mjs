/* 一键配置导出（2.8.0）的原生桥：界面、Android、iOS 三边对得上。
 *
 *     node --test AC06/tools/ble-finder/ui/test/export-bridge.test.mjs
 *
 * 没有手机，只核对源码里的约定，再把 iOS 的 evc-shim.js 放进一个假的 window 里跑一遍。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("界面：有 exportFile 就交给原生；结果按 {t:\"export\"} 收；导入用 <input type=file>", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/App.vue");
  assert.match(vue, /typeof api\.exportFile === "function"/);
  assert.match(vue, /api\.exportFile\(name, text\);/);
  assert.match(vue, /if \(msg\.t === "export"\) \{\s*exportDone\(msg\);/);
  assert.match(vue, /<input ref="importInput" class="file" type="file" accept="\*\/\*" @change="onImportFile">/);
  /* 导出前先警告，确认了才导出。 */
  assert.match(vue, /<button :disabled="!profiles\.length" @click="askExport">/);
  assert.match(vue, /<button class="go" @click="confirmExport">/);
});

test("Android：Bridge.exportFile 用 ACTION_CREATE_DOCUMENT 存，结果发 {t:\"export\", ok, s}", () => {
  const java = read("AC06/tools/ble-finder/src/com/evcity/acv2/MainActivity.java");
  assert.match(java, /@JavascriptInterface\s+public void exportFile\(final String name, final String text\)/);
  assert.match(java, /new Intent\(Intent\.ACTION_CREATE_DOCUMENT\)/);
  assert.match(java, /intent\.setType\("application\/json"\);/);
  assert.match(java, /requestCode == REQUEST_EXPORT/);
  assert.match(java, /obj\.put\("t", "export"\);/);
  /* 选文件（导入、固件升级）那条路没动。 */
  assert.match(java, /Intent intent = new Intent\(Intent\.ACTION_OPEN_DOCUMENT\);/);
});

test("iOS：shim 把 exportFile 交给原生；Bridge.swift 认它；控制器用导出窗口", () => {
  const swift = read("AC06/tools/ble-ios/Core/Sources/EVCCore/Bridge.swift");
  assert.match(swift, /case exportFile\(name: String, text: String\)/);
  assert.match(swift, /case "exportFile":/);
  assert.match(swift, /case \.export\(let ok, let reason\):\s*return \["t": "export", "ok": ok, "s": reason\]/);
  const vc = read("AC06/tools/ble-ios/App/Sources/MainViewController.swift");
  assert.match(vc, /case \.exportFile\(let name, let text\):/);
  assert.match(vc, /UIDocumentPickerViewController\(forExporting: \[url\], asCopy: true\)/);
  assert.match(vc, /controller === exportPicker/);
});

test("iOS shim 真跑一遍：exportFile 发出 {m:\"exportFile\", a:[名字, 内容]}，Mock 模式也不走假桩", () => {
  const source = read("AC06/tools/ble-ios/App/Resources/Bridge/evc-shim.js");
  for (const mock of [false, true]) {
    const posted = [];
    const mockCalls = [];
    const window = {
      __evcInit: { locale: "zh-CN", gate: {}, mock, nativeFilePicker: false },
      webkit: { messageHandlers: { evc: { postMessage: (msg) => posted.push(msg) } } },
    };
    const document = {
      readyState: "complete",
      addEventListener() {},
      querySelector: () => null,
    };
    new Function("window", "document", source)(window, document);
    if (mock) window.__evcNative.useLink({ call: (name, args) => mockCalls.push([name, args]), mtu: () => 247 });
    assert.equal(typeof window.EVC.exportFile, "function");
    window.EVC.exportFile("evcity-ac06-oneclick.json", "{\"a\":1}");
    window.EVC.exportFile(null, undefined);
    assert.deepEqual(posted, [
      { m: "exportFile", a: ["evcity-ac06-oneclick.json", "{\"a\":1}"] },
      { m: "exportFile", a: ["", ""] },
    ]);
    assert.deepEqual(mockCalls, []);
  }
});
