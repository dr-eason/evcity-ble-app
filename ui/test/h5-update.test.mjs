/* 界面热更新（H5 热更新）自己的规则：文件名、latest.json、.zip.sha256、manifest.json、原生结果过一遍、
 * 弹窗上的句子、12 种语言、编出来的界面里的标记，以及界面 / Android / iOS / 打包工具几处写的是同一个值。
 * 检查顺序（先安装包、后热更新）在 app-update.test.mjs。
 *
 *     node --test APP/ui/test/h5-update.test.mjs
 *
 * 没有手机：规则用 h5-update.js 直接测；原生和工具只核对源码里的约定。公开仓（只有 ui/ 和 ios/）里
 * 找不到的文件那几条跳过。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  H5_CHECK_WATCHDOG_MS, H5_KIND, H5_LATEST_NAME, H5_NAME_RE, H5_REV_MAX, H5_ROOT_URL, H5_TEXTS, H5_TOAST_ROLLED_BACK,
  H5_TOAST_STAGED, H5_TOAST_UPDATED, H5_ZIP_MAX_BYTES, cleanRev, h5ErrorText, h5FolderUrl, h5MetaOf, h5Name, h5Platform,
  h5RevLabel, h5Tag, h5View, normalizeH5Check, parseH5Name, parseLatest, parseManifest, parseShaLine, readH5Info,
} from "../src/h5-update.js";
import { UPDATE_TEXTS, updNew } from "../src/app-update.js";
import { h5Packs } from "../src/packs-h5.js";
import { repoVersion } from "./helpers/repo-version.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ui = resolve(here, "..");
const read = (path) => readFileSync(path, "utf8");
const pick = (...paths) => paths.map((p) => resolve(ui, p)).find((p) => existsSync(p)) || "";
const IOS = pick("../ios");
const JAVA = pick("../android/src/com/evcity/acv2/H5Updater.java");
const MAIN = pick("../android/src/com/evcity/acv2/MainActivity.java");
const MAKE_H5 = pick("../../tools/release/make_h5.py");
const ASSETS = pick("../android/assets", "../assets");
const SHA = "9f2c".repeat(16);

/* ---- 文件名 ---- */

test("文件名：只认 EVCITY-AC_H5_V<大版本.APP版本>.r<N>.zip，修订号不补零", () => {
  assert.equal(String(H5_NAME_RE), String(/^EVCITY-AC_H5_V(\d+\.\d+)\.r(\d+)\.zip$/));
  assert.deepEqual(parseH5Name("EVCITY-AC_H5_V3.04.r3.zip"), { base: "3.04", rev: 3 });
  assert.deepEqual(parseH5Name("EVCITY-AC_H5_V3.03.r0.zip"), { base: "3.03", rev: 0 });
  assert.deepEqual(parseH5Name("EVCITY-AC_H5_V10.00.r999999.zip"), { base: "10.00", rev: 999999 });
  /* 基座原样，不换算：3.4 和 3.04 是两个名字。 */
  assert.deepEqual(parseH5Name("EVCITY-AC_H5_V3.4.r1.zip"), { base: "3.4", rev: 1 });
  for (const bad of [
    "EVCITY-AC_H5_V3.04.r03.zip", "EVCITY-AC_H5_V3.04.r00.zip", "EVCITY-AC_H5_V3.04.r-1.zip", "EVCITY-AC_H5_V3.04.r1000000.zip",
    "EVCITY-AC_H5_V3.4.0.r1.zip", "EVCITY-AC_H5_V3.r1.zip", "EVCITY-AC_H5_V3.04.r3.apk", "EVCITY-AC_H5_V3.04.r3.zip.sha256",
    "EVCITY-AC_H5_V3.04.r3.1.zip", "EVCITY-AC_H5_V3.04.3.zip", "EVCITY-AC_H5_V3.04.R3.zip", "evcity-ac_h5_v3.04.r3.zip",
    "EVCITY-AC_H5_V3.04.r3.ZIP", "EVCITY-AC_V3.04.apk", "EVCITY-AC_H5_V3.04.r.zip", " EVCITY-AC_H5_V3.04.r3.zip",
    "../EVCITY-AC_H5_V3.04.r3.zip", "x/EVCITY-AC_H5_V3.04.r3.zip", "EVCITY-AC_H5_V3.04.r3.zip/", "", null, undefined, 3,
  ]) {
    assert.equal(parseH5Name(bad), null, String(bad));
  }
  assert.equal(h5Name("3.04", 3), "EVCITY-AC_H5_V3.04.r3.zip");
  assert.equal(h5Name("3.04", 0), "EVCITY-AC_H5_V3.04.r0.zip");
  for (const [base, rev] of [["3.04", -1], ["3.04", 1.5], ["3.04", "3"], ["3.04", H5_REV_MAX + 1], ["3", 1], ["3.4.0", 1], ["", 1], [null, 1]]) {
    assert.equal(h5Name(base, rev), "", base + " " + rev);
  }
  assert.deepEqual(parseH5Name(h5Name("3.04", 12)), { base: "3.04", rev: 12 });
  assert.equal(h5RevLabel(3), "r3");
  assert.equal(h5RevLabel(0), "r0");
  for (const bad of [-1, "3", null, undefined, 1.5, NaN]) assert.equal(h5RevLabel(bad), "r0", String(bad));
  assert.equal(h5Tag("3.04", 3), "3.04.r3");
  assert.equal(cleanRev(0), 0);
  assert.equal(cleanRev(H5_REV_MAX), H5_REV_MAX);
  for (const bad of [-1, H5_REV_MAX + 1, "0", 0.5, null, undefined, true]) assert.equal(cleanRev(bad), -1, String(bad));
});

test("地址：每个基座一个版本文件夹，空格写成 %20", () => {
  assert.equal(H5_ROOT_URL, "http://ftp.evcity.cc:8088/files/Android%20APP/");
  assert.equal(h5FolderUrl("3.04"), "http://ftp.evcity.cc:8088/files/Android%20APP/V3.04/");
  assert.equal(h5FolderUrl("3.04") + H5_LATEST_NAME, "http://ftp.evcity.cc:8088/files/Android%20APP/V3.04/latest.json");
  for (const bad of ["", "3", "3.04.1", "../x", "3.04/", null]) assert.equal(h5FolderUrl(bad), "", String(bad));
  assert.equal(H5_ZIP_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(H5_KIND, "evcity-ac-h5");
  assert.equal(H5_CHECK_WATCHDOG_MS, 30000);
});

/* ---- latest.json / .zip.sha256 / manifest.json ---- */

const LATEST = { kind: "evcity-ac-h5", base: "3.04", rev: 3, file: "EVCITY-AC_H5_V3.04.r3.zip", sha256: SHA, size: 512345 };

test("latest.json：六个字段都要有、类型要对；多出来的字段不看", () => {
  assert.deepEqual(parseLatest(LATEST), { ok: true, base: "3.04", rev: 3, file: LATEST.file, sha256: SHA, size: 512345 });
  assert.equal(parseLatest(JSON.stringify(LATEST)).ok, true);
  assert.equal(parseLatest(Object.assign({ note: "x", enabled: false, min: 9 }, LATEST)).ok, true);
  assert.equal(parseLatest(LATEST, "3.04").ok, true);
  /* 壳的基座不同：不收。不做 3.4 = 3.04 的换算。 */
  assert.deepEqual(parseLatest(LATEST, "3.05"), { ok: false, reason: "base" });
  assert.deepEqual(parseLatest(LATEST, "3.4"), { ok: false, reason: "base" });
  /* 缺一个字段 */
  for (const key of Object.keys(LATEST)) {
    const cut = Object.assign({}, LATEST);
    delete cut[key];
    const out = parseLatest(cut);
    assert.equal(out.ok, false, key);
    assert.equal(out.reason, key, key);
  }
  /* 类型不对 / 值不对 */
  const bad = [
    [{ kind: "evcity-ac-apk" }, "kind"], [{ kind: 1 }, "kind"],
    [{ base: 3.04 }, "base"], [{ base: "3.4.0" }, "base"], [{ base: "V3.04" }, "base"],
    [{ rev: "3" }, "rev"], [{ rev: 3.5 }, "rev"], [{ rev: -1 }, "rev"], [{ rev: 1000000 }, "rev"], [{ rev: null }, "rev"],
    [{ file: "EVCITY-AC_H5_V3.04.r4.zip" }, "file"], [{ file: "EVCITY-AC_H5_V3.05.r3.zip" }, "file"],
    [{ file: "../EVCITY-AC_H5_V3.04.r3.zip" }, "file"], [{ file: "x.zip" }, "file"], [{ file: 3 }, "file"],
    [{ rev: 4 }, "file"], [{ base: "3.05" }, "file"],
    [{ sha256: SHA.toUpperCase() }, "sha256"], [{ sha256: SHA.slice(1) }, "sha256"], [{ sha256: SHA + "0" }, "sha256"],
    [{ sha256: "g" + SHA.slice(1) }, "sha256"], [{ sha256: 1 }, "sha256"],
    [{ size: 0 }, "size"], [{ size: -5 }, "size"], [{ size: "512345" }, "size"], [{ size: 1.5 }, "size"],
    [{ size: H5_ZIP_MAX_BYTES + 1 }, "size"],
  ];
  for (const [patch, reason] of bad) {
    assert.deepEqual(parseLatest(Object.assign({}, LATEST, patch)), { ok: false, reason }, JSON.stringify(patch));
  }
  assert.equal(parseLatest(Object.assign({}, LATEST, { size: H5_ZIP_MAX_BYTES })).ok, true);
  assert.equal(parseLatest(Object.assign({}, LATEST, { size: 1 })).ok, true);
  for (const junk of [null, undefined, "", "{", "[]", [], 3, "<html>404</html>"]) assert.equal(parseLatest(junk).reason, "json", String(junk));
});

test(".zip.sha256：一行「<64 位小写十六进制>  <包名>」，两个空格，名字要对得上", () => {
  const file = "EVCITY-AC_H5_V3.04.r3.zip";
  assert.equal(parseShaLine(SHA + "  " + file + "\n", file), SHA);
  assert.equal(parseShaLine(SHA + "  " + file, file), SHA);
  assert.equal(parseShaLine(SHA + "  " + file + "\r\n", file), SHA);
  for (const bad of [
    SHA + " " + file + "\n", SHA + "   " + file + "\n", SHA + " *" + file + "\n", SHA.toUpperCase() + "  " + file + "\n",
    SHA.slice(2) + "  " + file + "\n", SHA + "  EVCITY-AC_H5_V3.04.r4.zip\n", SHA + "  " + file + "\n" + SHA + "  " + file + "\n",
    "", "<html>404</html>", null,
  ]) {
    assert.equal(parseShaLine(bad, file), "", String(bad));
  }
  assert.equal(parseShaLine(SHA + "  " + file + "\n", ""), "");
});

test("manifest.json 和 index.html 里的标记：kind、基座、修订号", () => {
  assert.deepEqual(parseManifest({ kind: "evcity-ac-h5", base: "3.04", rev: 3 }), { base: "3.04", rev: 3 });
  assert.deepEqual(parseManifest('{"kind":"evcity-ac-h5","base":"3.03","rev":0}\n'), { base: "3.03", rev: 0 });
  for (const bad of [
    { kind: "x", base: "3.04", rev: 3 }, { base: "3.04", rev: 3 }, { kind: "evcity-ac-h5", base: "3.04", rev: "3" },
    { kind: "evcity-ac-h5", base: 3.04, rev: 3 }, { kind: "evcity-ac-h5", base: "3.04" }, { kind: "evcity-ac-h5", base: "3.4.0", rev: 1 },
    null, "", "{", [],
  ]) {
    assert.equal(parseManifest(bad), null, JSON.stringify(bad));
  }
  assert.equal(h5MetaOf('<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta name="evc-h5" content="3.04.r3">\n<meta charset="utf-8">'), "3.04.r3");
  assert.equal(h5MetaOf("<html><head></head></html>"), "");
  /* 只看开头 4 KB */
  assert.equal(h5MetaOf("x".repeat(5000) + '<meta name="evc-h5" content="3.04.r3">'), "");
  assert.equal(h5MetaOf(null), "");
});

/* ---- 原生的查询结果 ---- */

const RES = { ok: true, base: "3.04", latest: 3, current: 0, staged: -1, hasNew: true, file: "EVCITY-AC_H5_V3.04.r3.zip", size: 512345 };

test("原生的结果过一遍：基座要和本页一致，文件名和 latest 要对得上，有没有新的按本页的修订号再比", () => {
  assert.deepEqual(normalizeH5Check(RES, "3.04", 0),
    { ok: true, reason: "", base: "3.04", latest: 3, current: 0, staged: -1, hasNew: true, file: RES.file, size: 512345 });
  assert.equal(normalizeH5Check(JSON.stringify(RES), "3.04", 0).hasNew, true);
  /* 本页已经是 r3 / 比它新：不提示。原生说的 hasNew、current 不信。 */
  assert.equal(normalizeH5Check(RES, "3.04", 3).hasNew, false);
  assert.equal(normalizeH5Check(RES, "3.04", 4).hasNew, false);
  assert.equal(normalizeH5Check(RES, "3.04", 2).hasNew, true);
  assert.equal(normalizeH5Check(Object.assign({}, RES, { current: 9 }), "3.04", 2).current, 2);
  assert.equal(normalizeH5Check(Object.assign({}, RES, { hasNew: false }), "3.04", 0).hasNew, true);
  /* 基座不同：不收（3.04 的页面不要 3.05 的包，也不要 3.03 的）。 */
  for (const base of ["3.05", "3.03", "3.4"]) {
    const res = normalizeH5Check(Object.assign({}, RES, { base, file: h5Name(base, 3) }), "3.04", 0);
    assert.equal(res.ok, false, base);
    assert.equal(res.reason, "base");
    assert.equal(res.hasNew, false);
  }
  /* 本页不知道自己的基座（老的编译产物）：不比基座。 */
  assert.equal(normalizeH5Check(RES, "", 0).hasNew, true);
  /* 文件名和 base / latest 对不上：看不懂。 */
  for (const patch of [
    { file: "EVCITY-AC_H5_V3.04.r4.zip" }, { file: "EVCITY-AC_H5_V3.05.r3.zip" }, { file: "../EVCITY-AC_H5_V3.04.r3.zip" },
    { file: "EVCITY-AC_V3.04.apk" }, { latest: 4 }, { latest: "3" }, { base: 3.04 }, { base: "" }, { size: H5_ZIP_MAX_BYTES + 1 },
    { file: "", latest: 3 },
  ]) {
    const res = normalizeH5Check(Object.assign({}, RES, patch), "3.04", 0);
    assert.equal(res.ok, false, JSON.stringify(patch));
    assert.equal(res.reason, "parse", JSON.stringify(patch));
  }
  /* 没有包 */
  assert.deepEqual(normalizeH5Check({ ok: true, base: "3.04", latest: -1, current: 0, staged: -1, hasNew: false, file: "", size: 0 }, "3.04", 0),
    { ok: true, reason: "", base: "3.04", latest: -1, current: 0, staged: -1, hasNew: false, file: "", size: 0 });
  /* 没查成 */
  for (const reason of ["offline", "http", "parse"]) assert.equal(normalizeH5Check({ ok: false, reason }, "3.04", 0).reason, reason);
  for (const junk of [null, undefined, "", "{", 3, {}, { ok: "true" }, []]) {
    const res = normalizeH5Check(junk, "3.04", 0);
    assert.equal(res.ok, false, String(junk));
    assert.equal(res.reason, "parse");
  }
  /* 磁盘上已经切换好 r3、页面还是 r0：不算有新的（不重新下载），staged 带回去。 */
  let res = normalizeH5Check(Object.assign({}, RES, { staged: 3 }), "3.04", 0);
  assert.deepEqual([res.hasNew, res.staged, res.latest], [false, 3, 3]);
  /* 服务器上又有了更大的 r4：有新的。 */
  res = normalizeH5Check(Object.assign({}, RES, { staged: 3, latest: 4, file: h5Name("3.04", 4) }), "3.04", 0);
  assert.deepEqual([res.hasNew, res.staged, res.latest], [true, 3, 4]);
  /* staged 不比本页大的不算。 */
  assert.equal(normalizeH5Check(Object.assign({}, RES, { staged: 2 }), "3.04", 2).staged, -1);
  /* 本页的修订号不像样：当 0。 */
  assert.equal(normalizeH5Check(RES, "3.04", undefined).current, 0);
});

test("壳有没有热更新：h5Check 和 h5Download 都要有；h5Info 读不出来是 null", () => {
  const fn = () => {};
  assert.equal(h5Platform({ h5Check: fn, h5Download: fn, h5Cancel: fn, h5Apply: fn }), true);
  assert.equal(h5Platform({ h5Check: fn }), false);
  assert.equal(h5Platform({ updCheck: fn, updDownload: fn }), false);
  assert.equal(h5Platform(null), false);
  assert.deepEqual(readH5Info({ h5Info: () => '{"rev":3,"src":"hot","reloaded":true,"rolledBack":false}' }),
    { rev: 3, src: "hot", reloaded: true, rolledBack: false });
  assert.deepEqual(readH5Info({ h5Info: () => ({ rev: 0, src: "builtin", reloaded: false, rolledBack: true }) }),
    { rev: 0, src: "builtin", reloaded: false, rolledBack: true });
  assert.deepEqual(readH5Info({ h5Info: () => "{}" }), { rev: 0, src: "builtin", reloaded: false, rolledBack: false });
  assert.equal(readH5Info({ h5Info: () => "" }), null);
  assert.equal(readH5Info({ h5Info() { throw new Error("bridge gone"); } }), null);
  assert.equal(readH5Info({}), null);
  assert.equal(readH5Info(null), null);
});

/* ---- 弹窗和句子 ---- */

test("出错原因 → 句子：连不上是下载失败，别的都是包校验失败", () => {
  for (const reason of ["offline", "http", "busy", "storage", "bridge"]) assert.equal(h5ErrorText(reason), "下载失败，请检查网络后重试", reason);
  for (const reason of ["sha", "size", "zip", "base", "rev", "badfile", "", undefined]) assert.equal(h5ErrorText(reason), "热更新包校验失败，请重试", String(reason));
});

test("热更新的窗口：提示、进度条、校验解压（没有按钮）、已准备好（busy 不给「立即切换」）、出错", () => {
  const st = (phase, extra) => Object.assign(updNew(), { phase, h5: true, h5Latest: 3, h5Current: 0, h5Staged: 3, h5File: RES.file }, extra);
  let view = h5View(st("h5-prompt"), "free");
  assert.equal(view.title, "界面热更新");
  assert.equal(view.text, "发现界面热更新 {v}（当前 {c}），是否下载并更新？");
  assert.deepEqual(view.vars, { v: "r3", c: "r0" });
  assert.deepEqual(view.buttons.map((b) => [b.id, b.label]), [["cancel", "取消"], ["accept", "下载更新"]]);
  view = h5View(st("h5-downloading"), "free");
  assert.equal(view.text, "正在下载界面热更新 {v}");
  assert.equal(view.progress, true);
  assert.deepEqual(view.buttons.map((b) => [b.id, b.label]), [["cancel", "取消下载"]]);
  view = h5View(st("h5-applying"), "free");
  assert.equal(view.text, "正在校验并解压");
  assert.deepEqual(view.buttons, []);
  for (const link of ["linked", "free", undefined]) {
    view = h5View(st("h5-staged"), link);
    assert.match(view.text, /^界面热更新 \{v\} 已准备好。现在切换会断开蓝牙并回到设备列表；也可以下次打开 App 时自动生效。$/);
    assert.deepEqual(view.vars, { v: "r3" });
    assert.deepEqual(view.buttons.map((b) => [b.id, b.label]), [["later", "下次生效"], ["apply", "立即切换"]]);
  }
  view = h5View(st("h5-staged"), "busy");
  assert.equal(view.text, "界面热更新已下载，下次打开 App 生效");
  assert.ok(!view.buttons.some((b) => b.id === "apply" || b.label === "立即切换"), "正在发固件：没有「立即切换」");
  view = h5View(st("h5-error", { error: "sha" }), "free");
  assert.equal(view.text, "热更新包校验失败，请重试");
  assert.deepEqual(view.buttons.map((b) => [b.id, b.label]), [["cancel", "取消"], ["retry", "重试"]]);
  assert.equal(h5View(st("h5-error", { error: "offline" }), "free").text, "下载失败，请检查网络后重试");
  for (const phase of ["idle", "checking", "prompt", "downloading", "ready", "error", "ios", "h5-checking"]) assert.equal(h5View(st(phase), "free"), null, phase);
});

test("i18n：热更新用到的句子 12 种语言都有，{v} {c} 没丢；源码里的每一句都登记了", async () => {
  const { languages, translate } = await import("../src/i18n.js");
  const { m01Translate } = await import("../src/m01/t.js");
  const others = languages.filter((item) => !/^zh/.test(item.id));
  assert.ok(others.length >= 12);
  assert.equal(new Set(H5_TEXTS).size, H5_TEXTS.length);
  /* 新加的句子都在 packs-h5.js；别的包里已经有的（取消、重试……）不重复。 */
  const fresh = H5_TEXTS.filter((key) => !UPDATE_TEXTS.includes(key));
  assert.ok(fresh.includes("热更新") && fresh.includes("界面热更新") && fresh.includes("下次生效") && fresh.includes("立即切换"));
  for (const item of others) {
    assert.ok(h5Packs[item.id], item.id + " 没有包");
    assert.deepEqual(Object.keys(h5Packs[item.id]).sort(), fresh.slice().sort(), item.id);
    for (const key of H5_TEXTS) {
      const text = translate(item.id, key);
      assert.ok(text && text !== key, item.id + " 没有翻译：" + key);
      for (const v of key.match(/\{[a-z]\}/g) || []) assert.ok(text.includes(v), item.id + " 丢了变量 " + v + "：" + key);
    }
    /* M01 的页面（关于页的「热更新」）走 m01/t.js，也查得到。 */
    assert.notEqual(m01Translate(item.id, "热更新"), "热更新", item.id);
  }
  assert.equal(translate("zh", "发现界面热更新 {v}（当前 {c}），是否下载并更新？", { v: "r3", c: "r0" }), "发现界面热更新 r3（当前 r0），是否下载并更新？");
  assert.equal(translate("en", "界面已更新到 {v}", { v: "r3" }), "Interface updated to r3");
  for (const key of [H5_TOAST_STAGED, H5_TOAST_UPDATED, H5_TOAST_ROLLED_BACK]) assert.ok(H5_TEXTS.includes(key), key);
  /* h5-update.js 里出现的每一句中文界面文字都登记了。 */
  const src = read(resolve(ui, "src/h5-update.js"));
  const body = src.slice(src.indexOf("export const H5_TOAST_STAGED"), src.indexOf("export const H5_TEXTS"));
  let seen = 0;
  for (const m of body.matchAll(/(?:label|text|title): "([^"]+)"|return "([^"]*[一-鿿][^"]*)"|= "([^"]*[一-鿿][^"]*)"/g)) {
    const key = m[1] || m[2] || m[3];
    if (!/[一-鿿]/.test(key)) continue;
    seen++;
    assert.ok(H5_TEXTS.includes(key), "没登记：" + key);
  }
  assert.ok(seen >= 15, "句子数 " + seen);
});

/* ---- 编出来的界面 ---- */

test("编界面：H5_REV 是不补零的整数；vite.config.js 写 __H5_REV__、<meta>、manifest.json，读不到就失败", () => {
  const revText = read(resolve(ui, "H5_REV"));
  assert.match(revText, /^(0|[1-9]\d{0,5})\n$/, "H5_REV 是一个整数加换行");
  const vite = read(resolve(ui, "vite.config.js"));
  assert.match(vite, /__H5_REV__: JSON\.stringify\(h5Rev\(\)\)/);
  assert.match(vite, /__H5_BASE__: JSON\.stringify\(appVersion\(\)\)/);
  assert.ok(vite.includes('<head><meta name="evc-h5" content="${base}.r${rev}">'));
  assert.match(vite, /writeFileSync\(resolve\(out, "manifest\.json"\), JSON\.stringify\(\{ kind: H5_KIND, base, rev \}\) \+ "\\n"\)/);
  assert.match(vite, /const H5_KIND = "evcity-ac-h5";/);
  /* 两种目录布局都写在 index.html 旁边（assetsDir()）。 */
  assert.match(vite, /resolve\("\.\.\/android\/assets"\) : resolve\("\.\.\/assets"\)/);
  /* 读不到、不是整数：抛错，不悄悄当 0。 */
  assert.match(vite, /throw new Error\("读不到 APP\/ui\/H5_REV/);
  assert.match(vite, /throw new Error\("APP\/ui\/H5_REV 要是一个不补零的整数/);
  assert.doesNotMatch(vite, /catch \(e\) \{\s*return 0;/);
  /* 页面挂载好以后报到一次（有这个方法才调）。 */
  const main = read(resolve(ui, "src/main.js"));
  assert.match(main, /if \(window\.EVC && typeof window\.EVC\.h5Ready === "function"\) window\.EVC\.h5Ready\(\);/);
  assert.match(main, /try \{[^]*h5Ready\(\)[^]*\} catch \(e\)/);
});

test("编好的界面：index.html 的标记、manifest.json、H5_REV、App 版本四处一致", { skip: !ASSETS || !existsSync(resolve(ASSETS, "manifest.json")) ? "没有编好的界面（npm run build）" : false }, () => {
  const rev = Number(read(resolve(ui, "H5_REV")).trim());
  const manifest = parseManifest(read(resolve(ASSETS, "manifest.json")));
  assert.ok(manifest, "manifest.json 看得懂");
  assert.equal(manifest.rev, rev, "manifest.json 的 rev = H5_REV（改了 H5_REV 要重新 npm run build）");
  const html = read(resolve(ASSETS, "index.html"));
  assert.equal(h5MetaOf(html), h5Tag(manifest.base, manifest.rev));
  assert.equal(html.split('<meta name="evc-h5"').length, 2, "标记只有一处");
  assert.equal(read(resolve(ASSETS, "manifest.json")), JSON.stringify({ kind: H5_KIND, base: manifest.base, rev }) + "\n");
  const repo = repoVersion();
  if (repo) assert.equal(manifest.base, repo.app, "基座 = VERSION 的 APP 段");
  /* 编进去的句子和接口名都在。 */
  for (const piece of ["h5Ready", "h5Check", "h5Download", "__evcH5", "界面热更新", "EVCITY-AC_H5_V"]) assert.ok(html.includes(piece), piece);
});

/* ---- 原生两头和打包工具的约定 ---- */

const H5_BRIDGE = ["h5Info", "h5Check", "h5Download", "h5Cancel", "h5Apply", "h5Ready"];

test("Android：桥的六个方法、加载哪一份、页面跳转只放行 android_asset 和 h5/current、文件访问不放宽", { skip: !JAVA && "没有 Android 源码" }, () => {
  const main = read(MAIN);
  const upd = read(JAVA);
  for (const sig of ["public String h5Info()", "public void h5Check()", "public void h5Download(String file)",
    "public void h5Cancel()", "public void h5Apply()", "public void h5Ready()"]) {
    assert.ok(main.includes("@JavascriptInterface\n        " + sig + " {"), sig);
  }
  /* 启动时加载 H5Updater 选出来的那一份：有合格的热更新是 file://…/h5/current/index.html，否则是内置的。 */
  assert.match(main, /h5Updater = new H5Updater\(this, new H5Updater\.Js\(\) \{/);
  assert.match(main, /loadH5Page\(true\);\n    \}/);
  assert.match(main, /String url = h5Updater\.pickUrl\(coldStart\);/);
  assert.doesNotMatch(main, /web\.loadUrl\("file:\/\/\/android_asset\/index\.html"\)/, "不再写死只加载内置的");
  assert.match(upd, /static final String BUILTIN_URL = "file:\/\/\/android_asset\/index\.html";/);
  assert.match(upd, /return pick\.hot\(\) \? "file:\/\/" \+ pick\.index\.getAbsolutePath\(\) : BUILTIN_URL;/);
  assert.match(upd, /new File\(base, "h5"\)/);
  assert.match(upd, /context\.getFilesDir\(\)/);
  assert.doesNotMatch(upd, /getCacheDir|getExternalCacheDir|getExternalFilesDir/, "不放缓存目录、不放外部存储");
  /* 页面跳转：只有这两条放行。 */
  const open = main.slice(main.indexOf("private boolean openExternal(String url) {"), main.indexOf("private void page(String name)"));
  assert.ok(open.length > 0);
  assert.deepEqual(open.match(/return false;/g).length, 2, "只有两处放行");
  assert.match(open, /if \(url != null && url\.startsWith\("file:\/\/\/android_asset\/"\)\) return false;/);
  assert.match(open, /if \(url != null && h5Updater != null && h5Updater\.isCurrentFile\(url\)\) return false;/);
  assert.match(upd, /boolean isCurrentFile\(String url\) \{\s*return h5Dir != null && insideDir\(url, new File\(h5Dir, "current"\)\);/);
  assert.match(upd, /String root = dir\.getCanonicalPath\(\);\s*String target = new File\(path\)\.getCanonicalPath\(\);\s*return target\.startsWith\(root \+ File\.separator\);/);
  /* 文件访问：这两项明确是 false。 */
  assert.match(main, /setAllowFileAccessFromFileURLs\(false\);/);
  assert.match(main, /setAllowUniversalAccessFromFileURLs\(false\);/);
  assert.doesNotMatch(main, /setAllow(File|Universal)AccessFromFileURLs\(true\)/);
  /* 10 秒报到、退回、重新加载不杀进程。 */
  assert.match(upd, /READY_TIMEOUT_MS = 10000;/);
  assert.match(main, /handler\.postDelayed\(h5ReadyTimeout, H5Updater\.READY_TIMEOUT_MS\);/);
  assert.match(main, /String url = h5Updater\.rollbackLoaded\(\);/);
  const apply = main.slice(main.indexOf("public void h5Apply() {"), main.indexOf("public void h5Ready() {"));
  assert.match(apply, /MainActivity\.this\.stopScan\(\);\s*closeGatt\(\);/);
  assert.match(apply, /pending\.clear\(\);/);
  assert.match(apply, /loadH5Page\(false\);/);
  assert.doesNotMatch(apply, /killProcess|RestartService/);
  assert.match(main, /h5Updater\.cancel\(\);     \/\* 在途的热更新下载停掉 \*\//);
  for (const script of ["build.sh", "build.ps1"]) assert.match(read(resolve(ui, "../android", script)), /H5Updater\.java/, script);
  /* 清单里不加权限；备份关着。 */
  const manifest = read(resolve(ui, "../android/AndroidManifest.xml"));
  assert.match(manifest, /android:allowBackup="false"/);
});

test("Android：查询和下载只连白名单里的这一台，先 latest.json 后目录列表，核 SHA-256，不验签名", { skip: !JAVA && "没有 Android 源码" }, () => {
  const upd = read(JAVA);
  /* 和界面、打包工具是同一个值。 */
  assert.ok(upd.includes('static final String ROOT_URL = "' + H5_ROOT_URL + '";'));
  assert.ok(upd.includes('Pattern.compile("^EVCITY-AC_H5_V(\\\\d+\\\\.\\\\d+)\\\\.r(\\\\d+)\\\\.zip$")'), "文件名规则和 JS 一样");
  assert.ok(upd.includes('static final String KIND = "' + H5_KIND + '";'));
  assert.ok(upd.includes('static final String LATEST_NAME = "' + H5_LATEST_NAME + '";'));
  assert.match(upd, /REV_MAX = 999999;/);
  assert.equal(H5_REV_MAX, 999999);
  assert.match(upd, /ZIP_MAX_BYTES = 8 \* 1024 \* 1024;/);
  assert.match(upd, /INDEX_MAX_BYTES = 16 \* 1024 \* 1024;/);
  assert.match(upd, /MANIFEST_MAX_BYTES = 4096;/);
  assert.match(upd, /LATEST_MAX_BYTES = 4096;/);
  assert.match(upd, /LIST_MAX_BYTES = 512 \* 1024;/);
  assert.match(upd, /SHA_MAX_BYTES = 1024;/);
  assert.match(upd, /CHECK_TIMEOUT_MS = 8000;/);
  /* 每个地址先过 cloudUrl；不跟随重定向；不要压缩。 */
  assert.equal((upd.match(/MainActivity\.cloudUrl\(/g) || []).length, 2, "小文件一处、下载一处");
  assert.equal((upd.match(/\.openConnection\(\)/g) || []).length, 2);
  assert.equal((upd.match(/setInstanceFollowRedirects\(false\)/g) || []).length, 2);
  assert.equal((upd.match(/setRequestProperty\("Accept-Encoding", "identity"\)/g) || []).length, 2);
  assert.doesNotMatch(upd, /new URL\(/, "不自己拼 URL 对象，都从 cloudUrl 来");
  /* 顺序：latest.json → 404 / 不合格 → 目录列表 → .zip.sha256；别的状态码是没查成。 */
  const check = upd.slice(upd.indexOf("private String runCheck() {"), upd.indexOf("/* ---- 下载、核对、解压、切换 ---- */"));
  const order = ["get(folder + LATEST_NAME, LATEST_MAX_BYTES)", "parseLatest(latest.text, shellBase)", "get(folder, LIST_MAX_BYTES)",
    "parseListing(list.text)", 'get(folder + best + ".sha256", SHA_MAX_BYTES)', "parseShaLine(side.text, best)"];
  let at = -1;
  for (const piece of order) {
    const next = check.indexOf(piece);
    assert.ok(next > at, "顺序：" + piece);
    at = next;
  }
  assert.match(check, /else if \(latest\.status != 404 && latest\.status != 410\) \{\s*return failure\("http"\);/);
  assert.match(check, /else if \(list\.status != 404 && list\.status != 410\) \{\s*return failure\("http"\);/);
  assert.match(check, /catch \(IOException e\) \{\s*return failure\("offline"\);/);
  /* 只收自己基座的、比已应用的更大的修订号；只下载查到过的那个名字。 */
  assert.match(upd, /!base\.equals\(shellBase\)/);
  assert.match(check, /boolean hasNew = found != null && found\.rev > applied && found\.sha256\.length\(\) == 64;/);
  assert.match(upd, /target == null \|\| !target\.file\.equals\(file\)/);
  assert.match(upd, /if \(target\.rev <= Math\.max\(loadedRev, diskRev\)\) \{\s*return "rev";/);
  /* 下载：边下边算 SHA-256，核对大小和 SHA-256 之后才解压，再切换。 */
  const dl = upd.slice(upd.indexOf("private String runDownload(Latest target, int seq) {"));
  const steps = ['MessageDigest.getInstance("SHA-256")', "digest.update(chunk, 0, n)", 'return "sha";', "extract(part, fresh, shellBase, target.rev)", "commit(h5Dir, fresh, target.rev)"];
  at = -1;
  for (const piece of steps) {
    const next = dl.indexOf(piece);
    assert.ok(next > at, "顺序：" + piece);
    at = next;
  }
  assert.match(dl, /if \(done > ZIP_MAX_BYTES \|\| \(total > 0 && done > total\)\) \{\s*return "size";/);
  assert.match(dl, /if \(!hex\(digest\.digest\(\)\)\.equals\(target\.sha256\)\) \{\s*return "sha";/);
  /* 解压：只认两个名字，条目数正好 2，写到固定的文件名。 */
  assert.match(upd, /if \(zf\.size\(\) != 2\) \{\s*return "zip";/);
  assert.match(upd, /File target = new File\(outDir, INDEX_NAME\.equals\(name\) \? INDEX_NAME : MANIFEST_NAME\);/);
  assert.doesNotMatch(upd, /new File\(outDir, (name|entry\.getName\(\))\)/, "不拿包里的名字拼路径");
  /* 回调。 */
  for (const cb of ["onCheck", "onProgress", "onDone", "onError"]) assert.ok(upd.includes('"' + cb + '"'), cb);
  assert.match(upd, /js\.run\("window\.__evcH5&&window\.__evcH5\." \+ name/);
  /* 不验签名、没有公钥；不读 latest.json 以外的开关或配置文件。 */
  assert.doesNotMatch(upd, /java\.security\.Signature|PublicKey|KeyFactory|X509|verifySignature/);
  const jsonNames = upd.match(/"[A-Za-z0-9_.-]+\.json"/g) || [];
  assert.deepEqual([...new Set(jsonNames)].sort(), ['"latest.json"', '"manifest.json"', '"state.json"']);
  assert.doesNotMatch(upd, /switch\.json|config\.json|enabled|killSwitch/i);
  assert.doesNotMatch(upd, /import androidx|androidx\.core/);
});

test("iOS：编译期开关、沙盒里的界面只放行 h5/current/index.html、ATS 不变、规则和别处一样", { skip: !IOS && "没有 iOS 工程" }, () => {
  const rules = read(resolve(IOS, "Core/Sources/EVCCore/H5Update.swift"));
  assert.ok(rules.includes('public static let rootURL = "' + H5_ROOT_URL + '"'));
  assert.ok(rules.includes("`^EVCITY-AC_H5_V(\\d+\\.\\d+)\\.r(\\d+)\\.zip$`"), "文件名规则和 JS 一样");
  assert.match(rules, /namePrefix = "EVCITY-AC_H5_V"/);
  assert.match(rules, /nameSuffix = "\.zip"/);
  assert.ok(rules.includes('public static let kind = "' + H5_KIND + '"'));
  assert.ok(rules.includes('public static let latestName = "' + H5_LATEST_NAME + '"'));
  assert.match(rules, /revMax = 999999/);
  assert.match(rules, /zipMaxBytes = 8 \* 1024 \* 1024/);
  assert.match(rules, /indexMaxBytes = 16 \* 1024 \* 1024/);
  assert.match(rules, /manifestMaxBytes = 4096/);
  assert.match(rules, /latestMaxBytes = 4096/);
  assert.match(rules, /timeout: TimeInterval = 8/);
  assert.match(rules, /readyTimeout: TimeInterval = 10/);
  assert.match(rules, /window\.__evcH5&&window\.__evcH5\./);
  /* 编译期开关：xcconfig（默认 YES）→ Info.plist → AppMode。 */
  const xc = read(resolve(IOS, "Config/Base.xcconfig"));
  assert.match(xc, /^EVC_H5_HOT_UPDATE = YES$/m);
  const plist = read(resolve(IOS, "App/Resources/Info.plist"));
  assert.match(plist, /<key>EVCH5HotUpdate<\/key>\s*<string>\$\(EVC_H5_HOT_UPDATE\)<\/string>/);
  const delegate = read(resolve(IOS, "App/Sources/AppDelegate.swift"));
  assert.match(delegate, /static var h5HotUpdate: Bool \{\s*let value = Bundle\.main\.object\(forInfoDictionaryKey: "EVCH5HotUpdate"\)/);
  /* ATS：放开的仍然只有 ftp.evcity.cc 这一个。 */
  const ats = plist.slice(plist.indexOf("<key>NSAppTransportSecurity</key>"), plist.indexOf("<key>NSBluetoothAlwaysUsageDescription</key>"));
  assert.equal(ats.replace(/\s+/g, ""),
    "<key>NSAppTransportSecurity</key><dict><key>NSExceptionDomains</key><dict><key>ftp.evcity.cc</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict></dict></dict>");
  /* 控制器：开关关着（或 Mock）时没有 H5Updater；不看 h5/、不写 __evcInit.h5、h5* 调用不理。 */
  const vc = read(resolve(IOS, "App/Sources/MainViewController.swift"));
  assert.match(vc, /private func makeH5\(\) -> H5Updater\? \{\s*if !AppMode\.h5HotUpdate \|\| mock \{\s*return nil\s*\}/);
  assert.match(vc, /if let h5 = h5 \{\s*source \+= H5ShimInit\(rev: h5\.loadedRev, hot: h5\.loadedHot, reloaded: h5Reloaded,\s*rolledBack: h5RolledBack\)\.script\s*\}/);
  assert.match(vc, /var page = resource\("index", "html", in: "Web"\)\s*if let h5 = h5 \{\s*let pick = h5\.pick\(coldStart: h5Cold\)/);
  assert.match(vc, /web\.loadFileURL\(index, allowingReadAccessTo: index\.deletingLastPathComponent\(\)\)/);
  for (const piece of ["case .h5Check:\n            h5?.check()", "case .h5Download(let file):\n            h5?.download(file)",
    "case .h5Cancel:\n            h5?.cancel()", "case .h5Ready:", "case .h5Apply:"]) {
    assert.ok(vc.includes(piece), piece);
  }
  /* 页面跳转：沙盒里只放行解析掉符号链接后正好是 h5/current/index.html 的那一个文件。 */
  const policy = vc.slice(vc.indexOf("decidePolicyFor navigationAction"), vc.indexOf("// MARK: 原生 → 页面"));
  assert.match(policy, /\|\| \(h5\?\.isCurrentIndex\(url\) \?\? false\)/);
  assert.doesNotMatch(policy, /applicationSupportDirectory|documentDirectory|Application Support\/|Documents/, "没有放开整个 Application Support / Documents");
  const native = read(resolve(IOS, "App/Sources/H5Updater.swift"));
  assert.match(native, /func isCurrentIndex\(_ url: URL\) -> Bool \{\s*guard url\.isFileURL, let root = root else \{\s*return false\s*\}\s*let index = root\.appendingPathComponent\("current", isDirectory: true\)\s*\.appendingPathComponent\(H5UpdateRules\.indexName\)\s*return url\.resolvingSymlinksInPath\(\)\.path == index\.resolvingSymlinksInPath\(\)\.path/);
  assert.match(native, /for: \.applicationSupportDirectory, in: \.userDomainMask/);
  assert.match(native, /values\.isExcludedFromBackup = true/);
  assert.doesNotMatch(native, /cachesDirectory|documentDirectory/);
  /* 联网：每个地址先过 CloudRules.url，不跟随重定向，不要压缩；SHA-256 用 CryptoKit，deflate 用 Compression。 */
  assert.equal((native.match(/CloudRules\.url\(/g) || []).length, 2, "小文件一处、下载一处");
  assert.doesNotMatch(native, /URL\(string:/, "不自己拼 URL，都从 CloudRules.url 来");
  assert.match(native, /willPerformHTTPRedirection response: HTTPURLResponse,[^}]*completionHandler\(nil\)/);
  assert.equal((native.match(/setValue\("identity", forHTTPHeaderField: "Accept-Encoding"\)/g) || []).length, 2);
  assert.match(native, /import CryptoKit/);
  assert.match(native, /import Compression/);
  assert.match(native, /compression_decode_buffer\(to, capacity, from, source\.count, nil, COMPRESSION_ZLIB\)/);
  assert.match(native, /if H5UpdateRules\.hex\(Array\(hasher\.finalize\(\)\)\) != wanted\.sha256 \{\s*fail\("sha"\)/);
  assert.match(native, /timeoutIntervalForRequest = H5UpdateRules\.timeout/);
  /* 不验签名、没有公钥；不引第三方库；不读 latest.json 以外的开关或配置文件。 */
  assert.doesNotMatch(native + rules, /SecKey|P256|Curve25519|publicKey|isValidSignature/);
  const jsonNames = (native + rules).match(/"[A-Za-z0-9_.-]+\.json"/g) || [];
  assert.deepEqual([...new Set(jsonNames)].sort(), ['"latest.json"', '"manifest.json"', '"state.json"']);
  assert.doesNotMatch(read(resolve(IOS, "Core/Package.swift")), /\.package\(/, "EVCCore 没有第三方依赖");
  /* build_ui.sh：manifest.json 和 index.html 一起拷进 Web/，没有就报错。 */
  const sh = read(resolve(IOS, "build_ui.sh"));
  assert.match(sh, /MANIFEST="\$\(dirname "\$SINGLE"\)\/manifest\.json"\nif \[ ! -s "\$MANIFEST" \]; then\n[^]*?exit 1\nfi/);
  assert.match(sh, /cp "\$MANIFEST" "\$WEB_DIR\/manifest\.json"/);
  assert.match(sh, /grep -q "evcTryBack" "\$SINGLE"/, "原来的检查保留");
});

function runShim(init) {
  const source = read(resolve(IOS, "App/Resources/Bridge/evc-shim.js"));
  const posted = [];
  const win = { __evcInit: init, webkit: { messageHandlers: { evc: { postMessage: (m) => posted.push(m) } } } };
  const doc = { readyState: "complete", querySelector: () => null, addEventListener() {} };
  new Function("window", "document", source)(win, doc);
  return { evc: win.EVC, posted };
}

test("iOS shim 真跑一遍：原生写了 __evcInit.h5 才挂六个 h5* 方法；开关关着时一个都没有", { skip: !IOS && "没有 iOS 工程" }, () => {
  /* 开着 */
  let { evc, posted } = runShim({ appVersion: "3.04", h5: { rev: 3, src: "hot", reloaded: true, rolledBack: false } });
  for (const name of H5_BRIDGE) assert.equal(typeof evc[name], "function", name);
  assert.equal(h5Platform(evc), true);
  assert.equal(typeof evc.h5Info(), "string", "和 Android 一样返回 JSON 字符串");
  assert.deepEqual(readH5Info(evc), { rev: 3, src: "hot", reloaded: true, rolledBack: false });
  evc.h5Check();
  evc.h5Download("EVCITY-AC_H5_V3.04.r4.zip");
  evc.h5Cancel();
  evc.h5Apply();
  evc.h5Ready();
  assert.deepEqual(posted, [{ m: "h5Check", a: [] }, { m: "h5Download", a: ["EVCITY-AC_H5_V3.04.r4.zip"] },
    { m: "h5Cancel", a: [] }, { m: "h5Apply", a: [] }, { m: "h5Ready", a: [] }]);
  ({ evc } = runShim({ h5: { rev: 0, src: "builtin", reloaded: false, rolledBack: true } }));
  assert.deepEqual(readH5Info(evc), { rev: 0, src: "builtin", reloaded: false, rolledBack: true });
  ({ evc } = runShim({ h5: {} }));
  assert.deepEqual(readH5Info(evc), { rev: 0, src: "builtin", reloaded: false, rolledBack: false });
  /* 关着（原生没写 h5）：六个方法都不挂，页面没有热更新这一步；安装包检查照旧。 */
  for (const init of [{ appVersion: "3.04" }, { appVersion: "3.04", h5: null }, { appVersion: "3.04", h5: false }, { h5: "yes" }]) {
    ({ evc, posted } = runShim(init));
    for (const name of H5_BRIDGE) assert.equal(evc[name], undefined, name + " " + JSON.stringify(init));
    assert.equal(h5Platform(evc), false);
    assert.equal(readH5Info(evc), null);
    assert.equal(typeof evc.updCheck, "function");
  }
  /* Mock BLE 的假充电桩不提供、也不盖掉这几个方法。 */
  const mock = read(resolve(IOS, "App/Resources/Bridge/mock-evc.js"));
  assert.doesNotMatch(mock, /h5Check|h5Download|h5Apply|h5Ready|h5Info|window\.EVC\s*=/);
});

test("桥的六个 h5* 方法：Android 的 Bridge、iOS 的 BridgeCall / evc-shim.js 和界面用的名字一致", { skip: (!MAIN || !IOS) && "没有两个原生工程" }, () => {
  const main = read(MAIN);
  const swift = read(resolve(IOS, "Core/Sources/EVCCore/Bridge.swift"));
  const shim = read(resolve(IOS, "App/Resources/Bridge/evc-shim.js"));
  /* 参数个数：h5Download 一个，其余没有。 */
  for (const name of H5_BRIDGE) {
    const args = name === "h5Download" ? "String file" : "";
    assert.match(main, new RegExp("public (?:void|String) " + name + "\\(" + args + "\\) \\{"), "Android " + name);
    assert.match(shim, new RegExp("window\\.EVC\\." + name + " = function \\(" + (name === "h5Download" ? "file" : "") + "\\) \\{"), "shim " + name);
  }
  /* h5Info 同步返回，在 shim 里直接答，不进 BridgeCall；另外五个进。 */
  assert.match(swift, /case h5Check\n/);
  assert.match(swift, /case h5Download\(file: String\)\n/);
  assert.match(swift, /case h5Cancel\n/);
  assert.match(swift, /case h5Apply\n/);
  assert.match(swift, /case h5Ready\n/);
  for (const name of H5_BRIDGE.filter((n) => n !== "h5Info")) assert.ok(swift.includes('case "' + name + '":'), "Swift 解析 " + name);
  assert.doesNotMatch(swift, /case "h5Info":/);
  assert.match(swift, /guard let file = text\(0\), H5UpdateRules\.parseName\(file\) != nil else \{\s*return nil\s*\}\s*return \.h5Download\(file: file\)/);
  assert.match(swift, /return "window\.__evcInit\.h5 = " \+ JSONText\.encode\(object\) \+ ";\\n"/);
  /* 六个方法都挂在开关后面（原生写了 __evcInit.h5 才有）。 */
  const gate = shim.indexOf('if (init.h5 && typeof init.h5 === "object") {');
  assert.ok(gate > 0);
  const block = shim.slice(gate, shim.indexOf("/* 原生调页面用的入口。 */"));
  for (const name of H5_BRIDGE) {
    assert.ok(block.includes("window.EVC." + name + " = function"), name + " 在开关里面");
    assert.equal(shim.split("EVC." + name + " = ").length, 2, name + " 只挂一处");
  }
  /* 界面只通过这几个名字调。 */
  const upd = read(resolve(ui, "src/app-update.js"));
  for (const name of ["h5Check", "h5Download", "h5Cancel", "h5Apply"]) assert.ok(upd.includes("evc." + name + "("), name);
});

test("界面和打包工具：没有验签名、没有公钥，也不读 latest.json 以外的开关或配置文件；打包工具的值和界面一样", () => {
  const page = read(resolve(ui, "src/h5-update.js")) + read(resolve(ui, "src/app-update.js")) + read(resolve(ui, "src/UpdateDialog.vue"));
  assert.doesNotMatch(page, /publicKey|verifySignature|subtle\.verify|importKey/);
  assert.doesNotMatch(page, /fetch\(|XMLHttpRequest/, "页面自己不联网");
  assert.doesNotMatch(page, /switch\.json|config\.json|killSwitch/i);
  if (MAKE_H5) {
    const py = read(MAKE_H5);
    assert.ok(py.includes("H5_NAME_RE = re.compile(r'^EVCITY-AC_H5_V(\\d+\\.\\d+)\\.r(\\d+)\\.zip$')"), "文件名规则和 JS 一样");
    assert.ok(py.includes("H5_KIND = '" + H5_KIND + "'"));
    assert.match(py, /ZIP_MAX_BYTES = 8 \* 1024 \* 1024/);
    assert.match(py, /INDEX_MAX_BYTES = 16 \* 1024 \* 1024/);
    assert.match(py, /MANIFEST_MAX_BYTES = 4096/);
    assert.match(py, /return '%s  %s\\n' % \(digest, name\)/, "旁文件：两个空格");
    assert.doesNotMatch(py, /sign|private_key|public_key/i);
  }
});
