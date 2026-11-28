/* App 自己的更新检查（AC-34）：版本比较、文件名和目录列表、状态机（自动检查不出声、手动检查给提示、
 * 取消不下载、iOS 不下载）、12 种语言、扫描页底部的版本号和出品方、原生两头的约定。
 *
 *     node --test AC06/tools/ble-finder/ui/test/app-update.test.mjs
 *
 * 没有手机：规则用 app-update.js 直接测；页面用 helpers/mount-shell.mjs 挂起来，window.EVC 是假的；
 * Android / iOS 原生只核对源码里的约定。公开仓（没有 Android）里找不到的文件那几条跳过。 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APK_NAME_RE, AUTO_DELAY_MS, CHECK_WATCHDOG_MS, UPDATE_TEXTS, apkVersion, compareVersions, createUpdater, fmtMB,
  latestApk, normalizeCheck, parseListing, updErrorText, updNew, updPlatform, updStep, updView, versionCore,
} from "../src/app-update.js";
import { updatePacks } from "../src/packs-update.js";
import { mountShell } from "./helpers/mount-shell.mjs";

mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });

const here = dirname(fileURLToPath(import.meta.url));
const ui = resolve(here, "..");
const read = (path) => readFileSync(path, "utf8");
const pick = (...paths) => paths.map((p) => resolve(ui, p)).find((p) => existsSync(p)) || "";
const IOS = pick("../../ble-ios", "../ios");
const ANDROID = pick("../src/com/evcity/acv2/AppUpdater.java") ? resolve(ui, "..") : "";
const UPLOAD = pick("../../release/upload_release.sh");

const row = (name, size = "438 KB", dir = false) =>
  `<tr><td><a href="/files/Android%20APP/${encodeURIComponent(name)}${dir ? "/" : ""}">${name}</a></td>` +
  `<td class="size">${size}</td><td class="time">2026-11-28 08:19</td></tr>`;
const page = (...rows) => `<html><body><h1>文件列表</h1><p><a href="/files/">返回上一级</a></p><table>\n${rows.join("\n")}\n</table></body></html>`;

/* ---- 版本比较 ---- */

test("版本比较：按数字逐段比，不是按字符串", () => {
  assert.equal(compareVersions("3.0.10", "3.0.9"), 1);
  assert.equal(compareVersions("3.0.9", "3.0.10"), -1);
  assert.equal(compareVersions("3.0.8", "3.0.8"), 0);
  assert.equal(compareVersions("3.1", "3.0.9"), 1);
  assert.equal(compareVersions("3.0.9", "3.1"), -1);
  assert.equal(compareVersions("3.1", "3.1.0"), 0);
  assert.equal(compareVersions("3.1.0.1", "3.1"), 1);
  assert.equal(compareVersions("10.0.0", "9.9.9"), 1);
  assert.equal(compareVersions("3.00.08", "3.0.8"), 0);
  assert.equal(compareVersions("V3.0.9", "3.0.8"), 1);
  assert.equal(compareVersions("3.0.8-beta", "3.0.8"), 0);
  /* 位数很多也不丢精度 */
  assert.equal(compareVersions("1.90071992547409931", "1.90071992547409930"), 1);
  /* 认不出的当 0 */
  assert.equal(compareVersions("", "0"), 0);
  assert.equal(compareVersions("abc", "0.0.1"), -1);
  assert.equal(versionCore(" v3.0.8 (3008)"), "3.0.8");
  assert.equal(versionCore("—"), "");
});

/* ---- 文件名和目录列表 ---- */

test("文件名：只认 EVCITY-AC_V<数字段>.apk", () => {
  assert.equal(apkVersion("EVCITY-AC_V3.0.9.apk"), "3.0.9");
  assert.equal(apkVersion("EVCITY-AC_V3.apk"), "3");
  assert.equal(apkVersion("EVCITY-AC_V3.0.10.1.apk"), "3.0.10.1");
  for (const bad of [
    "EVCITY-AC_V0.0.0-test.apk", "EVCITY-AC_V3.0.9.apk.part", "evcity-ac_v3.0.9.apk", "EVCITY-AC_3.0.9.apk",
    "EVCITY-AC_V3..9.apk", "EVCITY-AC_V3.0.9.APK", "EVCITY-AC_V.apk", "EVCITY-AC_V3.0.9.apk/", "../EVCITY-AC_V3.0.9.apk",
    "x/EVCITY-AC_V3.0.9.apk", " EVCITY-AC_V3.0.9.apk", "evc-ble.apk", "", null, undefined, 3,
  ]) {
    assert.equal(apkVersion(bad), "", String(bad));
  }
  assert.equal(String(APK_NAME_RE), String(/^EVCITY-AC_V(\d+(?:\.\d+)*)\.apk$/));
});

test("目录列表：杂文件、子目录、表格外的链接都不要；取版本最大的", () => {
  const html = page(
    row("EVCITY-AC_V3.0.9.apk"),
    row("EVCITY-AC_V3.0.10.apk"),
    row("EVCITY-AC_V3.0.8.apk"),
    row("EVCITY-AC_V0.0.0-test.apk", "6 B"),
    row("readme.txt", "1 KB"),
    row("EVCITY-AC_V9.9.9.apk", "目录", true),      /* 起了个像 APK 的名字的子目录 */
    row("old", "目录", true),
    row("EVCITY-AC_V3.0.10.apk"),                    /* 重复的只算一次 */
  );
  const names = parseListing(html);
  assert.deepEqual(names, ["EVCITY-AC_V3.0.9.apk", "EVCITY-AC_V3.0.10.apk", "EVCITY-AC_V3.0.8.apk"]);
  assert.deepEqual(latestApk(names), { file: "EVCITY-AC_V3.0.10.apk", version: "3.0.10" });
  assert.deepEqual(parseListing(page()), []);
  assert.equal(latestApk([]), null);
  assert.equal(latestApk(["a.apk", "EVCITY-AC_V0.0.0-test.apk"]), null);
  assert.deepEqual(parseListing("<html>404</html>"), []);
  assert.deepEqual(parseListing(null), []);
});

test("原生的结果过一遍：文件名不合规矩不认，hasNew 自己再比", () => {
  const ok = normalizeCheck({ ok: true, latest: "3.0.9", current: "3.0.8", hasNew: true, file: "EVCITY-AC_V3.0.9.apk" });
  assert.deepEqual(ok, { ok: true, reason: "", latest: "3.0.9", current: "3.0.8", hasNew: true, file: "EVCITY-AC_V3.0.9.apk" });
  /* JSON 字符串也行 */
  assert.equal(normalizeCheck(JSON.stringify({ ok: true, current: "3.0.8", file: "EVCITY-AC_V3.0.9.apk" })).hasNew, true);
  /* 原生说有新的，但其实不新：不信 */
  assert.equal(normalizeCheck({ ok: true, hasNew: true, latest: "3.0.8", current: "3.0.8", file: "EVCITY-AC_V3.0.8.apk" }).hasNew, false);
  assert.equal(normalizeCheck({ ok: true, hasNew: true, latest: "9.9", current: "3.0.8", file: "EVCITY-AC_V3.0.7.apk" }).hasNew, false);
  /* 文件夹里一个合规矩的都没有 */
  assert.deepEqual(normalizeCheck({ ok: true, latest: "", current: "3.0.8", hasNew: false, file: "" }),
    { ok: true, reason: "", latest: "", current: "3.0.8", hasNew: false, file: "" });
  /* 文件名带路径：当成看不懂 */
  assert.equal(normalizeCheck({ ok: true, current: "3.0.8", hasNew: true, file: "../EVCITY-AC_V3.0.9.apk" }).ok, false);
  for (const bad of [null, undefined, "", "{", 3, {}, { ok: "true" }]) assert.equal(normalizeCheck(bad).ok, false);
  assert.equal(normalizeCheck({ ok: false, reason: "offline" }).reason, "offline");
  /* 文件夹还不存在（404 / 410）：就算原生按失败回，也当成「没有更新」；别的状态码还是失败 */
  for (const status of [404, 410, "404"]) {
    assert.deepEqual(normalizeCheck({ ok: false, reason: "http", status }),
      { ok: true, reason: "", latest: "", current: "", hasNew: false, file: "" });
  }
  assert.deepEqual(normalizeCheck(JSON.stringify({ ok: false, reason: "http", status: 404, current: "V3.0.8" })),
    { ok: true, reason: "", latest: "", current: "3.0.8", hasNew: false, file: "" });
  for (const status of [500, 503, 403, 401, 0, 4040, "abc", null, undefined]) {
    const res = normalizeCheck({ ok: false, reason: "http", status });
    assert.equal(res.ok, false, String(status));
    assert.equal(res.reason, "http");
  }
  /* 404 只在 reason 是 http 时才算数 */
  assert.equal(normalizeCheck({ ok: false, reason: "offline", status: 404 }).ok, false);
  assert.equal(normalizeCheck({ ok: false, reason: "parse", status: 404 }).ok, false);
});

test("平台：有 updDownload 是 Android，只有 updCheck 是 iOS，都没有就什么都不做", () => {
  const fn = () => {};
  assert.equal(updPlatform({ updCheck: fn, updDownload: fn, updCancel: fn, updInstall: fn }), "android");
  assert.equal(updPlatform({ updCheck: fn }), "ios");
  assert.equal(updPlatform({ appVersion: fn }), "none");
  assert.equal(updPlatform(null), "none");
});

/* ---- 状态机 ---- */

const NEW = { ok: true, latest: "3.0.9", current: "3.0.8", hasNew: true, file: "EVCITY-AC_V3.0.9.apk" };
const SAME = { ok: true, latest: "3.0.8", current: "3.0.8", hasNew: false, file: "EVCITY-AC_V3.0.8.apk" };
/* 服务器上没有更新的版本：空文件夹 / 文件夹还不存在（原生回 ok:true），和原生按老办法回的 404 */
const EMPTY = { ok: true, latest: "", current: "3.0.8", hasNew: false, file: "" };
const GONE = { ok: false, reason: "http", status: 404 };
const NOTHING_NEWER = [SAME, EMPTY, GONE, { ok: false, reason: "http", status: 410 },
  { ok: true, latest: "3.0.7", current: "3.0.8", hasNew: false, file: "EVCITY-AC_V3.0.7.apk" }];
/* 真的没查成 */
const FAILURES = [{ ok: false, reason: "offline" }, { ok: false, reason: "http" }, { ok: false, reason: "http", status: 500 },
  { ok: false, reason: "http", status: 503 }, { ok: false, reason: "http", status: 403 }, { ok: false, reason: "parse" },
  { ok: false, reason: "timeout" }, null, "{"];
function drive(events, start) {
  let state = start || updNew();
  const effects = [];
  const toasts = [];
  for (const ev of events) {
    const out = updStep(state, ev);
    state = out.state;
    effects.push(...out.effects.map((e) => e.t + (e.file ? ":" + e.file : "")));
    if (out.toast) toasts.push(out.toast);
  }
  return { state, effects, toasts };
}
const AUTO = { t: "auto", platform: "android" };
const MANUAL = { t: "manual", platform: "android" };

test("自动检查：没网、404、空文件夹、看不懂、超时、已是最新都不出声，也不弹窗", () => {
  for (const res of [...FAILURES, ...NOTHING_NEWER]) {
    const out = drive([AUTO, { t: "check", res }]);
    assert.deepEqual(out.effects, ["check"]);
    assert.deepEqual(out.toasts, [], JSON.stringify(res));
    assert.equal(out.state.phase, "idle");
    assert.equal(updView(out.state).open, false);
  }
  const late = drive([AUTO, { t: "timeout" }]);
  assert.deepEqual(late.toasts, []);
  assert.equal(late.state.phase, "idle");
});

test("自动检查：一次运行只查一次", () => {
  const out = drive([AUTO, { t: "check", res: SAME }, AUTO, AUTO]);
  assert.deepEqual(out.effects, ["check"]);
  /* 老壳子 / 浏览器：不查 */
  assert.deepEqual(drive([{ t: "auto", platform: "none" }, { t: "manual", platform: "none" }]).effects, []);
  assert.deepEqual(drive([{ t: "manual", platform: "none" }]).toasts, []);
});

test("手动检查：先提示正在检查，再给结果", () => {
  let out = drive([MANUAL]);
  assert.deepEqual(out.toasts, ["正在检查更新"]);
  assert.deepEqual(out.effects, ["check"]);
  out = drive([MANUAL, { t: "check", res: SAME }]);
  assert.deepEqual(out.toasts, ["正在检查更新", "已是最新版本"]);
  /* 服务器上没有更新的版本（没有更高的 APK、空文件夹、文件夹还不存在 404）：已是最新版本 */
  for (const platform of ["android", "ios"]) {
    for (const res of NOTHING_NEWER) {
      out = drive([{ t: "manual", platform }, { t: "check", res }]);
      assert.deepEqual(out.toasts, ["正在检查更新", "已是最新版本"], platform + " " + JSON.stringify(res));
      assert.equal(out.state.phase, "idle");
      assert.equal(updView(out.state).open, false);
    }
    /* 真的没查成（连不上、超时、非 404 的状态码、列表看不懂）：检查更新失败 */
    for (const res of FAILURES) {
      out = drive([{ t: "manual", platform }, { t: "check", res }]);
      assert.deepEqual(out.toasts, ["正在检查更新", "检查更新失败，请检查网络"], platform + " " + JSON.stringify(res));
      assert.equal(out.state.phase, "idle");
    }
  }
  out = drive([MANUAL, { t: "timeout" }]);
  assert.deepEqual(out.toasts, ["正在检查更新", "检查更新失败，请检查网络"]);
  /* 自动检查还没回来时点了版本号：不重发，结果按手动的给 */
  out = drive([AUTO, MANUAL, { t: "check", res: SAME }]);
  assert.deepEqual(out.effects, ["check"]);
  assert.deepEqual(out.toasts, ["正在检查更新", "已是最新版本"]);
  /* 迟到的、多出来的 onCheck 不理 */
  out = drive([MANUAL, { t: "check", res: SAME }, { t: "check", res: NEW }]);
  assert.equal(out.state.phase, "idle");
});

test("有新版本：弹窗写着新旧版本，两个按钮", () => {
  const out = drive([AUTO, { t: "check", res: NEW }]);
  assert.equal(out.state.phase, "prompt");
  assert.deepEqual(out.toasts, []);
  const view = updView(out.state);
  assert.equal(view.open, true);
  assert.equal(view.text, "发现新版本 {v}（当前 {c}），是否下载并安装？");
  assert.deepEqual(view.vars, { v: "V3.0.9", c: "V3.0.8" });
  assert.deepEqual(view.buttons.map((b) => b.label), ["取消", "下载安装"]);
  assert.deepEqual(view.buttons.map((b) => b.id), ["cancel", "accept"]);
});

test("取消：关掉，什么都不做（不下载）；这个版本这次运行里自动检查不再弹，手动检查还弹", () => {
  let out = drive([AUTO, { t: "check", res: NEW }, { t: "cancel" }]);
  assert.deepEqual(out.effects, ["check"]);
  assert.equal(out.state.phase, "idle");
  assert.equal(updView(out.state).open, false);
  assert.deepEqual(out.state.dismissed, ["3.0.9"]);
  /* 手动查出来的弹窗取消后，自动检查到同一版也不弹 */
  out = drive([MANUAL, { t: "check", res: NEW }, { t: "cancel" }, AUTO, { t: "check", res: NEW }]);
  assert.equal(out.state.phase, "idle");
  assert.deepEqual(out.effects, ["check", "check"]);
  /* 再手动查：照样弹 */
  out = drive([MANUAL, { t: "check", res: NEW }], out.state);
  assert.equal(out.state.phase, "prompt");
  /* 更新的版本：自动检查也弹 */
  const st = Object.assign(updNew(), { platform: "android", phase: "checking", dismissed: ["3.0.9"] });
  out = drive([{ t: "check", res: { ok: true, current: "3.0.8", file: "EVCITY-AC_V3.0.10.apk" } }], st);
  assert.equal(out.state.phase, "prompt");
});

test("同意：下载 → 进度 → 下完自动调安装", () => {
  let out = drive([AUTO, { t: "check", res: NEW }, { t: "accept" }]);
  assert.deepEqual(out.effects, ["check", "download:EVCITY-AC_V3.0.9.apk"]);
  assert.equal(out.state.phase, "downloading");
  let view = updView(out.state);
  assert.equal(view.progress, true);
  assert.deepEqual(view.buttons.map((b) => b.label), ["取消下载"]);
  out = drive([{ t: "progress", pct: 42.9, done: 1887436, total: 4404019 }], out.state);
  assert.equal(out.state.pct, 42);
  assert.equal(fmtMB(out.state.done), "1.8");
  assert.equal(fmtMB(out.state.total), "4.2");
  out = drive([{ t: "progress", pct: 250, done: -1, total: "x" }], out.state);
  assert.deepEqual([out.state.pct, out.state.done, out.state.total], [100, 0, 0]);
  out = drive([{ t: "done" }], out.state);
  assert.deepEqual(out.effects, ["install"]);
  assert.equal(out.state.phase, "ready");
  view = updView(out.state);
  assert.deepEqual(view.buttons.map((b) => b.label), ["取消", "安装"]);
  assert.equal(view.hint, "");
  /* 要先允许「安装未知应用」：原生去了设置页，这里给一句提示 */
  out = drive([{ t: "install", s: "perm" }], out.state);
  assert.match(updView(out.state).hint, /允许本应用安装未知应用/);
  out = drive([{ t: "install", s: "denied" }], out.state);
  assert.match(updView(out.state).hint, /还没有允许/);
  /* 点「安装」再试一次 */
  out = drive([{ t: "install-tap" }], out.state);
  assert.deepEqual(out.effects, ["install"]);
  out = drive([{ t: "install", s: "started" }], out.state);
  assert.equal(out.state.phase, "ready");
  assert.equal(updView(out.state).hint, "");
});

test("取消下载：告诉原生停，关窗；迟到的进度和结果不理", () => {
  const out = drive([AUTO, { t: "check", res: NEW }, { t: "accept" }, { t: "progress", pct: 10, done: 1, total: 10 },
    { t: "cancel" }, { t: "progress", pct: 20, done: 2, total: 10 }, { t: "done" }, { t: "error", reason: "offline" }]);
  assert.deepEqual(out.effects, ["check", "download:EVCITY-AC_V3.0.9.apk", "cancel"]);
  assert.equal(out.state.phase, "idle");
  assert.equal(updView(out.state).open, false);
});

test("下载失败 / 装不了：给原因和「重试」", () => {
  let out = drive([AUTO, { t: "check", res: NEW }, { t: "accept" }, { t: "error", reason: "offline" }]);
  assert.equal(out.state.phase, "error");
  let view = updView(out.state);
  assert.equal(view.text, "下载失败，请检查网络后重试");
  assert.deepEqual(view.buttons.map((b) => b.label), ["取消", "重试"]);
  out = drive([{ t: "retry" }], out.state);
  assert.deepEqual(out.effects, ["download:EVCITY-AC_V3.0.9.apk"]);
  assert.equal(out.state.phase, "downloading");
  out = drive([{ t: "error", reason: "badapk" }], out.state);
  assert.equal(updView(out.state).text, "安装包校验失败，请重试");
  assert.equal(updErrorText("size"), "安装包校验失败，请重试");
  /* 原生自己报的 cancel 不算错 */
  out = drive([AUTO, { t: "check", res: NEW }, { t: "accept" }, { t: "error", reason: "cancel" }]);
  assert.equal(out.state.phase, "downloading");
  /* 安装器打不开：重试只重新装，不重新下 */
  out = drive([AUTO, { t: "check", res: NEW }, { t: "accept" }, { t: "done" }, { t: "install", s: "fail" }]);
  assert.equal(updView(out.state).text, "无法打开安装程序，请重试");
  out = drive([{ t: "retry" }], out.state);
  assert.deepEqual(out.effects, ["install"]);
  /* 出错后取消：关掉 */
  out = drive([AUTO, { t: "check", res: NEW }, { t: "accept" }, { t: "error", reason: "http" }, { t: "cancel" }]);
  assert.equal(out.state.phase, "idle");
});

test("iOS：有新版本只提示去 App Store，一个「知道了」，怎么点都不下载", () => {
  const IOS_AUTO = { t: "auto", platform: "ios" };
  let out = drive([IOS_AUTO, { t: "check", res: NEW }]);
  assert.equal(out.state.phase, "ios");
  const view = updView(out.state);
  assert.equal(view.text, "有软件更新，请前往 App Store 更新");
  assert.deepEqual(view.buttons.map((b) => b.label), ["知道了"]);
  assert.equal(view.progress, false);
  out = drive([{ t: "accept" }, { t: "retry" }, { t: "install-tap" }, { t: "done" }, { t: "progress", pct: 5 }], out.state);
  assert.deepEqual(out.effects, []);
  assert.equal(out.state.phase, "ios");
  out = drive([{ t: "cancel" }], out.state);
  assert.deepEqual(out.effects, []);
  assert.equal(out.state.phase, "idle");
  /* 知道了以后，自动检查这次运行里不再提；没网、最新同样不出声；手动有提示 */
  assert.equal(drive([IOS_AUTO, { t: "check", res: { ok: false, reason: "offline" } }]).toasts.length, 0);
  assert.deepEqual(drive([{ t: "manual", platform: "ios" }, { t: "check", res: SAME }]).toasts, ["正在检查更新", "已是最新版本"]);
  /* 就算状态被弄成 prompt，iOS 也不发下载 */
  const forced = Object.assign(updNew(), { platform: "ios", phase: "prompt", file: NEW.file, latest: "3.0.9" });
  assert.deepEqual(drive([{ t: "accept" }], forced).effects, []);
});

/* ---- 接到 window.EVC 上 ---- */

function fakeTimers() {
  const list = [];
  return {
    set: (fn, ms) => { const id = { fn, ms, live: true }; list.push(id); return id; },
    clear: (id) => { if (id) id.live = false; },
    fire: (ms) => list.filter((t) => t.live && t.ms === ms).forEach((t) => { t.live = false; t.fn(); }),
    live: () => list.filter((t) => t.live).length,
  };
}
function rig(methods) {
  const calls = [];
  const api = {};
  for (const name of methods) api[name] = (...args) => { calls.push([name, ...args]); };
  const win = {};
  const toasts = [];
  const timers = fakeTimers();
  const upd = createUpdater({ api: () => api, win, onToast: (k) => toasts.push(k), setTimeout: timers.set, clearTimeout: timers.clear });
  return { upd, win, calls, toasts, timers, api };
}

test("Android 整条路：查 → 弹窗 → 下载 → 进度 → 安装，都走 window.EVC / window.__evcUpd", () => {
  const r = rig(["updCheck", "updDownload", "updCancel", "updInstall"]);
  r.upd.auto();
  assert.deepEqual(r.calls, [["updCheck"]]);
  r.win.__evcUpd.onCheck(NEW);
  assert.equal(r.timers.live(), 0, "结果回来了，等结果的计时器收掉");
  assert.equal(r.upd.state().phase, "prompt");
  r.upd.act("accept");
  assert.deepEqual(r.calls[1], ["updDownload", "EVCITY-AC_V3.0.9.apk"]);
  r.win.__evcUpd.onProgress(50, 5, 10);
  assert.equal(r.upd.state().pct, 50);
  r.win.__evcUpd.onDone();
  assert.deepEqual(r.calls[2], ["updInstall"]);
  r.win.__evcUpd.onInstall("perm");
  assert.equal(r.upd.state().hint, "perm");
  r.win.__evcUpd.onInstall("started");
  assert.equal(r.upd.state().hint, "");
  assert.deepEqual(r.toasts, []);
});

test("取消：一次 window.EVC 都不多调", () => {
  const r = rig(["updCheck", "updDownload", "updCancel", "updInstall"]);
  r.upd.manual();
  r.win.__evcUpd.onCheck(NEW);
  r.upd.act("cancel");
  assert.deepEqual(r.calls, [["updCheck"]]);
  assert.equal(r.upd.state().phase, "idle");
  /* 下载中取消：调 updCancel */
  r.upd.manual();
  r.win.__evcUpd.onCheck(NEW);
  r.upd.act("accept");
  r.upd.act("cancel");
  assert.deepEqual(r.calls.map((c) => c[0]), ["updCheck", "updCheck", "updDownload", "updCancel"]);
});

test("iOS 整条路：只调 updCheck；原生一直不回就按失败算（手动才提示）", () => {
  const r = rig(["updCheck"]);
  r.upd.auto();
  r.win.__evcUpd.onCheck(JSON.stringify(NEW));
  assert.equal(r.upd.state().phase, "ios");
  r.upd.act("accept");
  r.upd.act("cancel");
  assert.deepEqual(r.calls, [["updCheck"]]);
  r.upd.manual();
  r.timers.fire(CHECK_WATCHDOG_MS);
  assert.deepEqual(r.toasts, ["正在检查更新", "检查更新失败，请检查网络"]);
  assert.equal(r.upd.state().phase, "idle");
  /* 自动检查超时：不出声 */
  const q = rig(["updCheck"]);
  q.upd.auto();
  q.timers.fire(CHECK_WATCHDOG_MS);
  assert.deepEqual(q.toasts, []);
});

test("老壳子（没有 updCheck）：自动、手动都不做事；桥抛异常按失败算", () => {
  const r = rig(["appVersion"]);
  r.upd.auto();
  r.upd.manual();
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.toasts, []);
  const bad = rig([]);
  bad.api.updCheck = () => { throw new Error("bridge gone"); };
  bad.upd.manual();
  assert.deepEqual(bad.toasts, ["正在检查更新", "检查更新失败，请检查网络"]);
  assert.equal(bad.timers.live(), 0);
});

/* ---- 语言 ---- */

test("i18n：更新用到的句子 12 种语言都有，变量没丢", async () => {
  const { languages, translate } = await import("../src/i18n.js");
  const others = languages.filter((item) => !/^zh/.test(item.id));
  assert.ok(others.length >= 12);
  for (const item of others) {
    assert.ok(updatePacks[item.id], item.id + " 没有包");
    assert.deepEqual(Object.keys(updatePacks[item.id]).sort(), UPDATE_TEXTS.slice().sort(), item.id);
    for (const key of UPDATE_TEXTS) {
      const text = translate(item.id, key);
      assert.ok(text && text !== key, item.id + " 没有翻译：" + key);
      for (const v of key.match(/\{[a-z]\}/g) || []) assert.ok(text.includes(v), item.id + " 丢了变量 " + v + "：" + key);
    }
    assert.match(translate(item.id, "有软件更新，请前往 App Store 更新"), /App Store/);
  }
  assert.equal(translate("zh", "发现新版本 {v}（当前 {c}），是否下载并安装？", { v: "V3.0.9", c: "V3.0.8" }),
    "发现新版本 V3.0.9（当前 V3.0.8），是否下载并安装？");
  /* 状态机和弹窗用到的每一句都登记了 */
  const src = read(resolve(ui, "src/app-update.js"));
  const body = src.slice(0, src.indexOf("export const UPDATE_TEXTS"));
  for (const m of body.matchAll(/(?:label|text|toast): "([^"]+)"|\? "([^"]+)"|return "([^"]*[一-鿿][^"]*)"/g)) {
    const key = m[1] || m[2] || m[3];
    if (/[一-鿿]/.test(key)) assert.ok(UPDATE_TEXTS.includes(key), "没登记：" + key);
  }
});

/* ---- 页面 ---- */

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}

test("扫描页：scan-dock 里隐私协议下面是 App 版本（能点）和不显眼的 Power by 一行", async () => {
  const vue = read(resolve(ui, "src/App.vue"));
  const scan = vue.slice(vue.indexOf(`<section v-if="page === 'scan'"`), vue.indexOf(`<section v-else-if="page === 'charge'"`));
  assert.match(scan, /<button class="privacy-link"[^>]*>[^<]*<\/button>\s*(?:<!--[^]*?-->\s*)?<p class="appver scan-ver" role="button" tabindex="0"[^>]*@click="checkAppUpdate"[^>]*>\{\{ t\('App 版本'\) \}\} <bdi dir="ltr">\{\{ appVersionShort \}\}<\/bdi><\/p>\s*<p class="powerby"[^>]*>Power by EVCITY &amp;&amp; GCSS<\/p>\s*<\/div>\s*<\/section>/);
  /* 设备列表在 dock 外面：dock 不滚、不 fixed，列表自己滚 */
  assert.ok(scan.indexOf('class="scan-list"') < scan.indexOf('class="scan-dock"'));
  assert.match(vue, /\.scan-dock \{ flex: none;[^}]*\}/);
  assert.match(vue, /\.scan-list \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
  const css = /\.powerby \{([^}]*)\}/.exec(vue);
  assert.ok(css, ".powerby 样式");
  assert.match(css[1], /color: #5f6368/);
  assert.match(css[1], /font-size: 10px/);
  assert.doesNotMatch(css[1], /position\s*:\s*(fixed|absolute|sticky)/);
  /* 出品方不翻译：不过 t() */
  assert.doesNotMatch(vue, /t\('Power by/);
  /* 弹窗在最外层，M01 的页面上也在；M01 自己不用另加 */
  assert.match(vue, /<\/main>\s*(?:<!--[^]*?-->\s*)?<UpdateDialog ref="updRef" :t="t" \/>\s*<\/template>/);

  const app = await mountShell({});
  await flush();
  const ver = app.byClass("scan-ver");
  assert.equal(ver.length, 1);
  assert.match(app.text(), /App 版本 V\d|App 版本 —/);
  const by = app.byClass("powerby");
  assert.equal(by.length, 1);
  assert.match(app.text(), /Power by EVCITY && GCSS/);
  const dock = app.byClass("scan-dock")[0];
  assert.deepEqual(dock.children.filter((n) => n.tag === "button" || n.tag === "p").map((n) => n.tag), ["button", "button", "button", "p", "p"]);
  assert.equal(typeof ver[0].props.onClick, "function");
  /* 假的手机那一层没有 updCheck：点了、等了都没事 */
  ver[0].props.onClick({});
  mock.timers.tick(AUTO_DELAY_MS + 100);
  await flush();
  assert.equal(app.byClass("upd-mask").length, 0);
  assert.equal(app.byClass("upd-toast").length, 0);
  app.close();
});

test("页面（Android）：打开约 2 秒后自动查；有新版本弹窗；取消就关，不下载；点版本号再查", async () => {
  const app = await mountShell({});
  const calls = [];
  for (const name of ["updCheck", "updDownload", "updCancel", "updInstall"]) app.evc[name] = (...a) => { calls.push([name, ...a]); };
  await flush();
  mock.timers.tick(AUTO_DELAY_MS - 100);
  assert.deepEqual(calls, [], "还没到 2 秒");
  mock.timers.tick(200);
  assert.deepEqual(calls, [["updCheck"]]);
  window.__evcUpd.onCheck(NEW);
  await flush();
  assert.equal(app.byClass("upd-mask").length, 1);
  assert.match(app.text(), /发现新版本 V3\.0\.9（当前 V3\.0\.8），是否下载并安装？/);
  app.click("取消");
  await flush();
  assert.equal(app.byClass("upd-mask").length, 0);
  assert.deepEqual(calls, [["updCheck"]], "取消后什么都没调");
  /* 点扫描页的版本号：手动查 */
  app.byClass("scan-ver")[0].props.onClick({});
  await flush();
  assert.equal(calls.length, 2);
  assert.match(app.text(), /正在检查更新/);
  window.__evcUpd.onCheck(NEW);
  await flush();
  assert.equal(app.byClass("upd-mask").length, 1);
  app.click("下载安装");
  await flush();
  assert.deepEqual(calls[2], ["updDownload", "EVCITY-AC_V3.0.9.apk"]);
  window.__evcUpd.onProgress(42, 1887436, 4404019);
  await flush();
  assert.match(app.text(), /42%/);
  assert.match(app.text(), /1\.8 \/ 4\.2 MB/);
  assert.equal(app.byClass("upd-bar")[0].props["aria-valuenow"], 42);
  window.__evcUpd.onDone();
  await flush();
  assert.deepEqual(calls[3], ["updInstall"]);
  window.__evcUpd.onInstall("perm");
  await flush();
  assert.match(app.text(), /请在设置里允许本应用安装未知应用/);
  app.close();
});

test("页面（iOS）：只有 updCheck；弹「请前往 App Store 更新」和一个「知道了」；已是最新给轻提示", async () => {
  const app = await mountShell({});
  const calls = [];
  app.evc.updCheck = () => { calls.push("updCheck"); };
  await flush();
  mock.timers.tick(AUTO_DELAY_MS + 50);
  assert.deepEqual(calls, ["updCheck"]);
  window.__evcUpd.onCheck(NEW);
  await flush();
  assert.match(app.text(), /有软件更新，请前往 App Store 更新/);
  assert.doesNotMatch(app.text(), /下载安装/);
  const btns = app.byClass("upd-btn");
  assert.equal(btns.length, 1);
  app.click("知道了");
  await flush();
  assert.equal(app.byClass("upd-mask").length, 0);
  assert.deepEqual(calls, ["updCheck"]);
  app.byClass("scan-ver")[0].props.onClick({});
  window.__evcUpd.onCheck(SAME);
  await flush();
  assert.match(app.text(), /已是最新版本/);
  mock.timers.tick(3000);
  await flush();
  assert.doesNotMatch(app.text(), /已是最新版本/);
  app.close();
});

test("页面（Android / iOS）：点版本号手动查，空文件夹和 404 提示「已是最新版本」，真的没查成才提示失败；自动检查不出声", async () => {
  for (const names of [["updCheck", "updDownload", "updCancel", "updInstall"], ["updCheck"]]) {
    const label = names.length > 1 ? "android" : "ios";
    const app = await mountShell({});
    let checks = 0;
    for (const name of names) app.evc[name] = () => { if (name === "updCheck") checks++; };
    await flush();
    /* 自动检查碰上 404：不出声，也不弹窗 */
    mock.timers.tick(AUTO_DELAY_MS + 50);
    assert.equal(checks, 1, label);
    window.__evcUpd.onCheck(GONE);
    await flush();
    assert.doesNotMatch(app.text(), /已是最新版本|检查更新失败/, label);
    assert.equal(app.byClass("upd-mask").length, 0, label);
    const tap = async (res) => {
      app.byClass("scan-ver")[0].props.onClick({});
      await flush();
      window.__evcUpd.onCheck(res);
      await flush();
      const text = app.text();
      mock.timers.tick(3000);       /* 轻提示自己消失 */
      await flush();
      return text;
    };
    /* 空文件夹 / 文件夹还不存在（原生回 ok:true，或按老办法回 404） */
    for (const res of [EMPTY, GONE, JSON.stringify(GONE)]) {
      const text = await tap(res);
      assert.match(text, /已是最新版本/, label + " " + JSON.stringify(res));
      assert.doesNotMatch(text, /检查更新失败/, label);
      assert.equal(app.byClass("upd-mask").length, 0, label);
    }
    /* 连不上、500、列表看不懂 */
    for (const res of [{ ok: false, reason: "offline" }, { ok: false, reason: "http", status: 500 }, { ok: false, reason: "parse" }]) {
      const text = await tap(res);
      assert.match(text, /检查更新失败，请检查网络/, label + " " + JSON.stringify(res));
      assert.doesNotMatch(text, /已是最新版本/, label);
    }
    assert.equal(checks, 7, label);
    app.close();
  }
});

/* ---- 原生和发布脚本的约定 ---- */

test("Android：桥、清单、下载目录、只读 provider", { skip: !ANDROID && "没有 Android 源码" }, () => {
  const main = read(resolve(ANDROID, "src/com/evcity/acv2/MainActivity.java"));
  for (const name of ["updCheck()", "updDownload(String file)", "updCancel()", "updInstall()"]) {
    assert.ok(main.includes("@JavascriptInterface\n        public void " + name), name);
  }
  const upd = read(resolve(ANDROID, "src/com/evcity/acv2/AppUpdater.java"));
  assert.ok(upd.includes('"http://8.210.219.113:8088/files/Android%20APP/"'));
  assert.ok(upd.includes('Pattern.compile("^EVCITY-AC_V(\\\\d+(?:\\\\.\\\\d+)*)\\\\.apk$")'), "文件名规则和 JS 一样");
  assert.match(upd, /CHECK_TIMEOUT_MS = 8000/);
  assert.match(upd, /getExternalCacheDir\(\)/);
  assert.match(upd, /file \+ "\.part"/);
  assert.match(upd, /canRequestPackageInstalls\(\)/);
  assert.match(upd, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(upd, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(upd, /!known\.contains\(file\)/, "只下载查到过的文件名");
  for (const cb of ["onCheck", "onProgress", "onDone", "onError", "onInstall"]) assert.ok(upd.includes('"' + cb + '"'), cb);
  /* 文件夹还不存在（404 / 410）：和空文件夹一样回 ok:true、没有更新，排在「非 200 就是 http」前面 */
  assert.match(upd, /if \(status == 404 \|\| status == 410\) \{[^}]*put\("ok", true\)[^}]*put\("hasNew", false\)[^}]*\}\s*if \(status != 200\) \{\s*return out\.put\("ok", false\)\.put\("reason", "http"\)/);
  const provider = read(resolve(ANDROID, "src/com/evcity/acv2/UpdateFileProvider.java"));
  assert.match(provider, /extends ContentProvider/);
  assert.match(provider, /getCanonicalFile\(\)/);
  assert.match(provider, /AppUpdater\.APK_NAME\.matcher\(name\)\.matches\(\)/);
  assert.doesNotMatch(provider + upd + main, /import androidx|androidx\.core/);
  const manifest = read(resolve(ANDROID, "AndroidManifest.xml"));
  assert.equal((manifest.match(/android\.permission\.INTERNET"/g) || []).length, 1);
  assert.equal((manifest.match(/android\.permission\.REQUEST_INSTALL_PACKAGES"/g) || []).length, 1);
  assert.match(manifest, /<provider\s+android:name="\.UpdateFileProvider"\s+android:authorities="com\.evcity\.acv2\.updatefiles"\s+android:exported="false"\s+android:grantUriPermissions="true" \/>/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  const net = read(resolve(ANDROID, "res/xml/network_security_config.xml"));
  assert.match(net, /<domain-config cleartextTrafficPermitted="true">\s*<domain includeSubdomains="false">8\.210\.219\.113<\/domain>/);
  assert.doesNotMatch(net, /<base-config[^>]*cleartextTrafficPermitted="true"/);
  for (const script of ["build.sh", "build.ps1"]) {
    const text = read(resolve(ANDROID, script));
    assert.match(text, /AppUpdater\.java/, script);
    assert.match(text, /UpdateFileProvider\.java/, script);
  }
});

test("iOS：shim 有 updCheck、没有 updDownload；原生查同一个文件夹；ATS 只放开这一个地址", { skip: !IOS && "没有 iOS 工程" }, () => {
  const source = read(resolve(IOS, "App/Resources/Bridge/evc-shim.js"));
  const posted = [];
  const win = {
    __evcInit: { appVersion: "3.0.8" },
    webkit: { messageHandlers: { evc: { postMessage: (m) => posted.push(m) } } },
  };
  const doc = { readyState: "complete", querySelector: () => null, addEventListener() {} };
  new Function("window", "document", source)(win, doc);
  assert.equal(typeof win.EVC.updCheck, "function");
  assert.equal(win.EVC.updDownload, undefined);
  assert.equal(win.EVC.updInstall, undefined);
  assert.equal(updPlatform(win.EVC), "ios");
  win.EVC.updCheck();
  assert.deepEqual(posted, [{ m: "updCheck", a: [] }]);
  const rules = read(resolve(IOS, "Core/Sources/EVCCore/AppUpdate.swift"));
  assert.ok(rules.includes('"http://8.210.219.113:8088/files/Android%20APP/"'));
  assert.ok(rules.includes("`^EVCITY-AC_V(\\d+(?:\\.\\d+)*)\\.apk$`"), "文件名规则和 JS 一样");
  assert.match(rules, /apkPrefix = "EVCITY-AC_V"/);
  assert.match(rules, /apkSuffix = "\.apk"/);
  assert.match(rules, /timeout: TimeInterval = 8/);
  /* 文件夹还不存在（404 / 410）：成功、没有更新，排在「非 200 就是 http」前面 */
  assert.match(rules, /if status == 404 \|\| status == 410 \{[^}]*"ok": true[^}]*"hasNew": false[^}]*\}\s*if status != 200 \{\s*return failure\("http"\)/);
  const native = read(resolve(IOS, "App/Sources/AppUpdateCheck.swift"));
  assert.match(rules, /window\.__evcUpd&&window\.__evcUpd\.onCheck/);
  assert.match(native, /AppUpdateRules\.script\(result\)/);
  assert.match(native, /timeoutIntervalForRequest = AppUpdateRules\.timeout/);
  assert.doesNotMatch(native, /downloadTask|UIApplication/, "iOS 不下载、不跳转");
  const vc = read(resolve(IOS, "App/Sources/MainViewController.swift"));
  assert.match(vc, /AppUpdateRules\.isCheckCall\(message\.body\)/);
  const plist = read(resolve(IOS, "App/Resources/Info.plist"));
  assert.match(plist, /<key>NSAppTransportSecurity<\/key>\s*<dict>\s*<key>NSExceptionDomains<\/key>\s*<dict>[^]*?<key>8\.210\.219\.113<\/key>\s*<dict>[^]*?<key>NSExceptionAllowsInsecureHTTPLoads<\/key>\s*<true\/>/);
  assert.doesNotMatch(plist, /NSAllowsArbitraryLoads<\/key>\s*<true\/>/);
});

test("发布脚本：APK 传到「Android APP/」，名字是 EVCITY-AC_V<版本>.apk，测试签名的不传", { skip: !UPLOAD && "没有发布脚本" }, () => {
  const sh = read(UPLOAD);
  assert.match(sh, /^APK_DIR="Android APP"$/m);
  assert.match(sh, /^APK_NAME="EVCITY-AC_V\$\{VERSION\}\.apk"$/m);
  assert.match(sh, /测试签名/);
  assert.match(sh, /-F "dir=\$\{APK_DIR\}" -F "file=@\$\{APK_PATH\};filename=\$\{APK_NAME\}"/);
  assert.equal(apkVersion("EVCITY-AC_V3.0.9.apk"), "3.0.9");
});
