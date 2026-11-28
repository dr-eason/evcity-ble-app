#!/usr/bin/env node
/* 在电脑上用无界面的 Chrome 把 App 界面按 iPhone 的尺寸（390×844）截图，不需要 Mac。
 *
 * 做的事和 iOS 模拟器里的 Mock BLE 模式一样：页面加载前注入
 *   window.__evcInit + App/Resources/Bridge/evc-shim.js + mock-evc.js
 * 也就是 App 里真正用的那两个脚本，所以这里也顺便验证了它们。只是没有原生那一头
 * （没有 window.webkit），saveGate / restart 发给原生的消息在这里没人收。
 *
 * 用法（不需要 npm install，只用 Node 22+ 自带的 WebSocket）：
 *   node tools/mock-web/shots.mjs [输出目录] [index.html]
 * 默认输出到 tools/mock-web/out/，index.html 依次找：
 *   App/Resources/Web/index.html、../android/assets/index.html、../assets/index.html
 * Chrome 的位置用环境变量 CHROME 指定，默认 google-chrome。 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ios = resolve(here, "../..");
const outDir = resolve(process.argv[2] || join(here, "out"));
const page = [
  process.argv[3],
  join(ios, "App/Resources/Web/index.html"),
  join(ios, "../android/assets/index.html"),
  join(ios, "../assets/index.html"),
].filter(Boolean).map((p) => resolve(p)).find((p) => existsSync(p));
if (!page) {
  console.error("找不到编好的 index.html。先跑 build_ui.sh，或者把路径作为第二个参数。");
  process.exit(1);
}

const FIRST = "5A1C0001-7E57-4AC6-9F00-000000000001";
const boot =
  "window.__evcInit = " + JSON.stringify({
    locale: process.env.EVC_LOCALE || "zh-CN",
    /* 第一台假桩的密码已经「记住」了，点它就直接进充电页，不用过输密码那一页。 */
    gate: { [FIRST]: "123456" },
    mock: true,
    nativeFilePicker: false,
  }) + ";\n" +
  readFileSync(join(ios, "App/Resources/Bridge/evc-shim.js"), "utf8") + "\n" +
  readFileSync(join(ios, "App/Resources/Bridge/mock-evc.js"), "utf8");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "evc-shots-"));
  const chrome = spawn(process.env.CHROME || "google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--allow-file-access-from-files", "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Chrome 没有启动：" + text.slice(-400))), 20000);
    chrome.stderr.on("data", (chunk) => {
      text += chunk;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (m) {
        clearTimeout(timer);
        done(m[1]);
      }
    });
    chrome.on("error", fail);
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = () => fail(new Error("连不上 Chrome 的调试口"));
  });
  let nextId = 0;
  const waiting = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !waiting.has(msg.id)) return;
    const { done, fail } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) fail(new Error(msg.error.message));
    else done(msg.result);
  };
  function cdp(method, params, sessionId) {
    const id = ++nextId;
    return new Promise((done, fail) => {
      waiting.set(id, { done, fail });
      ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
    });
  }

  try {
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
    const tab = (method, params) => cdp(method, params, sessionId);

    await tab("Page.enable");
    await tab("Runtime.enable");
    await tab("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await tab("Emulation.setTouchEmulationEnabled", { enabled: true });
    await tab("Page.addScriptToEvaluateOnNewDocument", { source: boot });
    await tab("Page.navigate", { url: pathToFileURL(page).href });

    async function js(expression) {
      const { result, exceptionDetails } = await tab("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text + " " + (exceptionDetails.exception?.description || ""));
      return result.value;
    }
    /* 等到页面里出现某个元素。 */
    async function waitFor(selector, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await js(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
        await sleep(100);
      }
      throw new Error("等不到 " + selector);
    }
    async function click(selector, index = 0) {
      const ok = await js(`(function(){var el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];` +
        `if(!el)return false;el.click();return true;})()`);
      if (!ok) throw new Error("点不到 " + selector + " [" + index + "]");
    }
    /* 点文字里含有 text 的那个按钮。 */
    async function clickText(text) {
      const ok = await js(`(function(){var list=document.querySelectorAll("button");` +
        `for(var i=0;i<list.length;i++){if(list[i].textContent.indexOf(${JSON.stringify(text)})>=0){list[i].click();return true;}}` +
        `return false;})()`);
      if (!ok) throw new Error("找不到按钮：" + text);
    }
    async function shot(name) {
      const { data } = await tab("Page.captureScreenshot", { format: "png" });
      const file = join(outDir, name);
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log("截图：" + file);
    }
    /* 后面几张不是必须的，哪一步走不通就跳过，不影响前面的。 */
    async function optional(name, steps) {
      try {
        await steps();
        await shot(name);
      } catch (error) {
        console.log("跳过 " + name + "：" + error.message);
      }
    }

    /* 1. 扫描页：三台假桩都出来之后。 */
    await waitFor("button.device.pile");
    await sleep(1600);
    await shot("ios_mock_scan.png");

    /* 2. 充电页：点第一台，等密码自动核对完、状态行到了。 */
    await click("button.device.pile", 0);
    await waitFor("button.gear");
    await sleep(2500);
    await shot("ios_mock_charge.png");

    /* 3. 充电中：直接让假桩开始充电，过几秒再截。 */
    await optional("ios_mock_charging.png", async () => {
      await js(`window.EVC.send("START")`);
      await sleep(4200);
    });

    /* 4. 设置菜单。 */
    await optional("ios_mock_menu.png", async () => {
      await click("button.gear");
      await sleep(1500);
    });

    /* 5. 固件升级页（选文件的按钮在这一页）。 */
    await optional("ios_mock_ota.png", async () => {
      await clickText("固件升级");
      await sleep(800);
    });

    /* 6. 语言页：回到充电页再点语言按钮。 */
    await optional("ios_mock_lang.png", async () => {
      await js(`window.evcTryBack()`);
      await sleep(300);
      await js(`window.evcTryBack()`);
      await sleep(500);
      await click("button.lang");
      await sleep(600);
    });
  } finally {
    try { ws.close(); } catch (e) {}
    chrome.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
