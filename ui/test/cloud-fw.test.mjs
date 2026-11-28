/* 固件升级页的「云端固件」：src/cloud-fw.js（目录页解析、版本和 .bin 的筛选、CRC、原生桥的封装、
 * 出错提示）、src/CloudFw.vue（选版本 → 选文件 → 确认 → 下载 → 校验 → loaded）、12 种语言的
 * 字符串（src/packs-cloud.js），以及 App.vue / m01/M01App.vue 怎么接它。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, compileScript } from "@vue/compiler-sfc";
import { createRenderer, h, nextTick } from "vue";
import {
  CLOUD_BASE, CLOUD_TEXTS, CLOUD_TIMEOUT_MS, b64ToBytes, binFiles, bytesToText, cloudDir, cloudDirPath, cloudGet,
  cloudProblem, cloudSupported, cloudUrl, compareVersions, crc32, crcHex, crcOk, downloadError, filesFrom,
  firmwareFrom, hrefOk, parseBinName, parseListing, percent, versionFolders, versionParts, versionsFrom,
} from "../src/cloud-fw.js";
import { CLOUD_LANGS, CLOUD_ROWS, cloudPacks } from "../src/packs-cloud.js";
import { languages, translate } from "../src/i18n.js";
import { translate as m01Raw, hasKey as m01HasKey } from "../src/m01/i18n.js";
import { m01Translate } from "../src/m01/t.js";

const src = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const SAMPLE = readFileSync(new URL("./fixtures/cloud/listing-sample.html", import.meta.url), "utf8");
const CJK = /[一-鿿]/;
const others = languages.map((item) => item.id).filter((id) => id !== "zh");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const utf8 = (text) => new Uint8Array(Buffer.from(text, "utf8"));
const row = (href, text, size) => `<tr>\n<td><a href="${href}">${text}</a></td>\n<td class="size">${size}</td>\n<td class="time">2026-11-28 00:01</td>\n</tr>\n`;
const page = (rows) => "<html><body><table><thead><tr><th>文件名</th><th>大小</th><th>修改时间</th></tr></thead><tbody>" + rows.join("") + "</tbody></table></body></html>";
const ok = (bytes, total) => ({ status: 200, bytes, error: "", total: total || 0, cancelled: false });

/* ---------- 目录页 ---------- */

test("目录页：真实样例解析成 4 个条目，名字取 href 最后一段并解码", () => {
  const got = parseListing(SAMPLE);
  assert.deepEqual(got, [
    { name: "AC06_V3.0.8_20261127_c3a5eef.zip", isDir: false, size: "4.7 MB", href: "/files/AC06_V3.0.8/AC06_V3.0.8_20261127_c3a5eef.zip" },
    { name: "V3.0.8_0093E971.bin", isDir: false, size: "188.4 KB", href: "/files/AC06_V3.0.8/V3.0.8_0093E971.bin" },
    { name: "版本升级说明.html", isDir: false, size: "399.2 KB", href: "/files/AC06_V3.0.8/%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E8%AF%B4%E6%98%8E.html" },
    { name: "V3.0.9", isDir: true, size: "", href: "/files/AC06/V3.0.9/" },
  ]);
  /* 表头那一行没有链接，不算条目；空的、不是 HTML 的正文（404 的“文件不存在”）解析出来是空。 */
  assert.deepEqual(parseListing(""), []);
  assert.deepEqual(parseListing(null), []);
  assert.deepEqual(parseListing("文件不存在"), []);
  /* 契约里一行写完的样子也认。 */
  assert.deepEqual(parseListing('<tr><td><a href="/files/AC06/V3.0.9/">V3.0.9</a></td><td class="size">目录</td><td class="time">2026-11-28 00:01</td></tr>'),
    [{ name: "V3.0.9", isDir: true, size: "", href: "/files/AC06/V3.0.9/" }]);
});

test("版本文件夹：只收 V3.0.9 / V3.0.9.1 这样的目录，按版本号从新到旧", () => {
  const entries = parseListing(page([
    row("/files/AC06/V3.0.9/", "V3.0.9", "目录"),
    row("/files/AC06/V3.0.10/", "V3.0.10", "目录"),
    row("/files/AC06/V3.0.9.1/", "V3.0.9.1", "目录"),
    row("/files/AC06/V2.8.0/", "V2.8.0", "目录"),
    row("/files/AC06/V3.1/", "V3.1", "目录"),
    row("/files/AC06/v3.0.9/", "v3.0.9", "目录"),
    row("/files/AC06/V3.0.9-rc1/", "V3.0.9-rc1", "目录"),
    row("/files/AC06/old/", "old", "目录"),
    row("/files/AC06/V3.0.7", "V3.0.7", "1.0 KB"),
    row("/files/AC06/V3.0.9/", "V3.0.9", "目录"),
    row("/files/M01/V9.9.9/", "V9.9.9", "目录"),
    row("/files/AC06/../V8.0.0/", "V8.0.0", "目录"),
    row("http://example.com/files/AC06/V7.0.0/", "V7.0.0", "目录"),
  ]));
  const got = versionFolders(entries, cloudDirPath("ac06"));
  assert.deepEqual(got.map((v) => v.label), ["V3.0.10", "V3.0.9.1", "V3.0.9", "V2.8.0"]);
  assert.equal(got[0].href, "/files/AC06/V3.0.10/");
  /* 样例（旧目录）里只有一行是版本文件夹。 */
  assert.deepEqual(versionFolders(parseListing(SAMPLE)).map((v) => v.name), ["V3.0.9"]);
  assert.deepEqual(versionFolders([]), []);
  assert.deepEqual(versionParts("V3.0.9.1"), [3, 0, 9, 1]);
  assert.equal(versionParts("V3.0"), null);
  assert.equal(versionParts("AC06_V3.0.8"), null);
  assert.ok(compareVersions("V3.0.10", "V3.0.9") > 0);
  assert.ok(compareVersions("V3.0.9.1", "V3.0.9") > 0);
  assert.ok(compareVersions("V2.9.9", "V3.0.0") < 0);
  assert.equal(compareVersions("V3.0.9", "V3.0.9"), 0);
});

test("固件文件：只留 .bin，带出文件名里的版本和 CRC；文件名不合规则的 .bin 也留着（M01）", () => {
  const sample = binFiles(parseListing(SAMPLE));
  assert.deepEqual(sample, [{ name: "V3.0.8_0093E971.bin", size: "188.4 KB", href: "/files/AC06_V3.0.8/V3.0.8_0093E971.bin", version: "3.0.8", crc: "0093E971" }]);
  const entries = parseListing(page([
    row("/files/M01/V1.3.4/m01_app.bin", "m01_app.bin", "150.0 KB"),
    row("/files/M01/V1.3.4/M01_V1.3.4.zip", "M01_V1.3.4.zip", "2.0 MB"),
    row("/files/M01/V1.3.4/bin/", "bin", "目录"),
    row("/files/M01/V1.3.4/x.bin.sha256", "x.bin.sha256", "1 KB"),
    row("/files/M01/V1.3.5/other.bin", "other.bin", "1 KB"),
  ]));
  const got = binFiles(entries, "/files/M01/V1.3.4/");
  assert.deepEqual(got, [{ name: "m01_app.bin", size: "150.0 KB", href: "/files/M01/V1.3.4/m01_app.bin", version: "", crc: "" }]);
  assert.deepEqual(binFiles([]), []);
});

test("文件名：V<版本>_<8 位 CRC>.bin 解析出版本和 CRC", () => {
  assert.deepEqual(parseBinName("V3.0.8_0093E971.bin"), { version: "3.0.8", crc: "0093E971" });
  assert.deepEqual(parseBinName("V3.0.9.1_abcdef01.bin"), { version: "3.0.9.1", crc: "ABCDEF01" });
  assert.deepEqual(parseBinName("V3.0.0_L2_12345678.bin"), { version: "3.0.0", crc: "12345678" });
  for (const bad of ["V3.0.8_0093E97.bin", "V3.0.8_0093E9711.bin", "V3.0.8_0093E97G.bin", "V3.0.8.bin", "AC06.bin", "V3.0.8_0093E971.zip", "V3.0_0093E971.bin", ""]) {
    assert.equal(parseBinName(bad), null, bad);
  }
});

test("href：只认 /files/ 下的绝对路径，不带 ..，要在指定目录下面", () => {
  assert.ok(hrefOk("/files/AC06/V3.0.9/"));
  assert.ok(hrefOk("/files/AC06/V3.0.9/V3.0.9_0093E971.bin", "/files/AC06/V3.0.9/"));
  assert.ok(!hrefOk("/files/AC06/V3.0.8/x.bin", "/files/AC06/V3.0.9/"));
  assert.ok(!hrefOk("/files/AC06/../secret"));
  assert.ok(!hrefOk("http://evil.example/files/AC06/"));
  assert.ok(!hrefOk("//evil.example/files/AC06/"));
  assert.ok(!hrefOk("/other/AC06/"));
  assert.ok(!hrefOk("/files/AC06/a.bin?x=1"));
  assert.ok(!hrefOk(""));
  assert.equal(cloudDir("ac06"), "AC06");
  assert.equal(cloudDir("m01"), "M01");
  assert.equal(cloudUrl(cloudDirPath("ac06")), "http://8.210.219.113:8088/files/AC06/");
  assert.equal(cloudUrl(cloudDirPath("m01")), CLOUD_BASE + "/files/M01/");
});

/* ---------- CRC 和下载后的检查 ---------- */

test("crc32：和 App.vue / M01App.vue 里的是同一个算法（zlib CRC-32）", () => {
  assert.equal(crc32(utf8("123456789")), 0xCBF43926);
  assert.equal(crcHex(utf8("123456789")), "CBF43926");
  assert.equal(crcHex(new Uint8Array(0)), "00000000");
  /* 两个页面里的 crc32 函数体和这里一字不差。 */
  const body = (text) => {
    const from = text.indexOf("function crc32(bytes) {");
    assert.ok(from >= 0);
    return text.slice(from, text.indexOf("\n}\n", from)).replace(/^export /, "");
  };
  const mine = body(src("cloud-fw.js").replace("export function crc32", "function crc32"));
  assert.equal(body(src("App.vue")), mine);
  assert.equal(body(src("m01/M01App.vue")), mine);
});

test("crcOk：文件名带 CRC 就必须对上；不带就不查", () => {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xFF;
  const good = "V3.0.9_" + crcHex(bytes) + ".bin";
  assert.ok(crcOk(bytes, good));
  assert.ok(crcOk(bytes, good.toLowerCase().replace("v3", "V3")));
  const flipped = bytes.slice();
  flipped[100] ^= 1;
  assert.ok(!crcOk(flipped, good));
  assert.ok(!crcOk(bytes.subarray(0, 1023), good));
  assert.ok(!crcOk(bytes, "V3.0.9_00000000.bin"));
  assert.ok(crcOk(bytes, "m01_app.bin"));

  assert.equal(downloadError(bytes, good, 0), "");
  assert.equal(downloadError(bytes, good, 1024), "");
  assert.equal(downloadError(bytes, good, 1025), "云端文件校验失败，请重试");
  assert.equal(downloadError(bytes.subarray(0, 1000), "m01_app.bin", 1024), "云端文件校验失败，请重试");
  assert.equal(downloadError(flipped, good, 1024), "云端文件校验失败，请重试");
  assert.equal(downloadError(new Uint8Array(0), "m01_app.bin", 0), "云端文件校验失败，请重试");
  assert.equal(downloadError(null, good, 0), "云端文件校验失败，请重试");
});

test("base64 和文字：原始字节原样回来，中文按 UTF-8 解", () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  assert.deepEqual(Array.from(b64ToBytes(b64(bytes))), Array.from(bytes));
  assert.equal(b64ToBytes("").length, 0);
  assert.equal(b64ToBytes(null).length, 0);
  /* 原生给的 base64 里夹了换行也行。 */
  assert.deepEqual(Array.from(b64ToBytes("AAEC\nAwQ=\n")), [0, 1, 2, 3, 4]);
  assert.equal(bytesToText(b64ToBytes(b64(utf8("版本升级说明 V3.0.9")))), "版本升级说明 V3.0.9");
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(50, 0), 0);
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(3, 3), 100);
  assert.equal(percent(9, 3), 100);
});

/* ---------- 出错时给用户看的话 ---------- */

test("提示：404 / 空目录 / 网络失败 / 别的状态码 / 老壳子，各有各的话", () => {
  /* 项目目录 404、或者里面没有版本文件夹：还没有固件（带型号）。 */
  assert.deepEqual(versionsFrom({ status: 404, bytes: utf8("文件不存在"), error: "" }, "ac06"),
    { items: [], problem: { text: "云端还没有 {m} 固件", vars: { m: "AC06" }, retry: false } });
  assert.deepEqual(versionsFrom({ status: 404, bytes: new Uint8Array(0), error: "" }, "m01").problem,
    { text: "云端还没有 {m} 固件", vars: { m: "M01" }, retry: false });
  assert.deepEqual(versionsFrom(ok(utf8(page([]))), "ac06").problem, { text: "云端还没有 {m} 固件", vars: { m: "AC06" }, retry: false });
  assert.deepEqual(versionsFrom(ok(utf8(page([row("/files/AC06/readme.txt", "readme.txt", "1 KB"), row("/files/AC06/tmp/", "tmp", "目录")]))), "ac06").problem.text, "云端还没有 {m} 固件");
  assert.equal(translate("zh", "云端还没有 {m} 固件", { m: "AC06" }), "云端还没有 AC06 固件");
  assert.equal(translate("zh", "云端还没有 {m} 固件", { m: "M01" }), "云端还没有 M01 固件");
  /* 旧布局的目录页（样例）不在 AC06/ 下面：M01 那边一个也不收。 */
  assert.equal(versionsFrom(ok(utf8(SAMPLE)), "m01").problem.text, "云端还没有 {m} 固件");
  const fine = versionsFrom(ok(utf8(SAMPLE)), "ac06");
  assert.equal(fine.problem, null);
  assert.deepEqual(fine.items, [{ name: "V3.0.9", label: "V3.0.9", href: "/files/AC06/V3.0.9/" }]);

  /* 版本文件夹里没有 .bin（或文件夹 404）。 */
  const folder = { name: "V3.0.9", label: "V3.0.9", href: "/files/AC06/V3.0.9/" };
  assert.deepEqual(filesFrom(ok(utf8(page([row("/files/AC06/V3.0.9/a.zip", "a.zip", "4.7 MB")]))), "ac06", folder).problem,
    { text: "这个版本里没有可用的固件文件", vars: null, retry: false });
  assert.equal(filesFrom({ status: 404, bytes: new Uint8Array(0), error: "" }, "ac06", folder).problem.text, "这个版本里没有可用的固件文件");
  const files = filesFrom(ok(utf8(page([row("/files/AC06/V3.0.9/V3.0.9_0093E971.bin", "V3.0.9_0093E971.bin", "188.4 KB")]))), "ac06", folder);
  assert.equal(files.problem, null);
  assert.equal(files.items.length, 1);

  /* 网络失败：三处都是同一句，带重试。 */
  for (const what of ["versions", "files", "bin"]) {
    assert.deepEqual(cloudProblem({ status: 0, bytes: new Uint8Array(0), error: "timeout" }, "ac06", what),
      { text: "无法连接服务器，请检查手机网络后重试", vars: null, retry: true });
  }
  /* 别的状态码。 */
  assert.deepEqual(cloudProblem({ status: 500, error: "" }, "ac06", "versions"), { text: "服务器返回 {code}", vars: { code: 500 }, retry: true });
  assert.deepEqual(cloudProblem({ status: 403, error: "" }, "m01", "files"), { text: "服务器返回 {code}", vars: { code: 403 }, retry: true });
  assert.deepEqual(cloudProblem({ status: 404, error: "" }, "ac06", "bin"), { text: "服务器返回 {code}", vars: { code: 404 }, retry: true });
  assert.equal(translate("zh", "服务器返回 {code}", { code: 500 }), "服务器返回 500");
  /* 老壳子。 */
  assert.deepEqual(cloudProblem({ status: 0, error: "unsupported" }, "ac06", "versions"), { text: "当前 APP 壳不支持云端固件，请升级 APP", vars: null, retry: false });
  /* 固件超过原生的 1 MB 上限：用页面原有的“文件不能超过”那句。 */
  assert.equal(cloudProblem({ status: 0, error: "too large" }, "ac06", "bin").text, "文件不能超过 240 KB");
  assert.equal(cloudProblem({ status: 0, error: "too large" }, "m01", "bin").text, "文件不能超过 200 KB");
  assert.equal(cloudProblem(ok(new Uint8Array(1)), "ac06", "bin"), null);

  /* 下载的结果：字节数、CRC 不对就拒绝。 */
  const bytes = utf8("AC06VER=3.0.9 firmware bytes");
  const file = { name: "V3.0.9_" + crcHex(bytes) + ".bin", href: "/files/AC06/V3.0.9/x.bin" };
  assert.deepEqual(firmwareFrom(ok(bytes, bytes.length), "ac06", file), { bytes, problem: null });
  assert.deepEqual(firmwareFrom(ok(bytes, bytes.length + 4), "ac06", file).problem, { text: "云端文件校验失败，请重试", vars: null, retry: true });
  assert.equal(firmwareFrom(ok(bytes.subarray(1), 0), "ac06", file).problem.text, "云端文件校验失败，请重试");
  assert.equal(firmwareFrom(ok(bytes.subarray(1), 0), "ac06", file).bytes, null);
  assert.equal(firmwareFrom({ status: 0, bytes: new Uint8Array(0), error: "timeout", total: 0 }, "ac06", file).problem.text, "无法连接服务器，请检查手机网络后重试");
});

/* ---------- 原生桥的封装 ---------- */

function fakeWin() {
  const calls = [];
  const win = { EVC: { cloudGet(id, url, kind) { calls.push({ id, url, kind }); } } };
  return { win, calls };
}

test("cloudGet：按 id 对回调，进度、完成、状态码和字节都带回来", async () => {
  const { win, calls } = fakeWin();
  assert.ok(cloudSupported(win));
  const seen = [];
  const job = cloudGet("http://8.210.219.113:8088/files/AC06/V3.0.9/a.bin", "bin", { win, onProgress: (d, t) => seen.push([d, t]) });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].id, calls[0].url, calls[0].kind], [job.id, "http://8.210.219.113:8088/files/AC06/V3.0.9/a.bin", "bin"]);
  assert.equal(typeof win.__evcCloud.done, "function");
  assert.equal(typeof win.__evcCloud.prog, "function");
  /* 别的 id 的回调不理。 */
  win.__evcCloud.prog("nobody", 1, 2);
  win.__evcCloud.done("nobody", 200, b64([9]), "");
  win.__evcCloud.prog(job.id, 100, 300);
  win.__evcCloud.prog(job.id, 300, 300);
  win.__evcCloud.done(job.id, 200, b64([1, 2, 3]), "");
  const got = await job.promise;
  assert.deepEqual(seen, [[100, 300], [300, 300]]);
  assert.equal(got.status, 200);
  assert.equal(got.total, 300);
  assert.equal(got.cancelled, false);
  assert.deepEqual(Array.from(got.bytes), [1, 2, 3]);
  /* 完成之后再来的回调没有效果。 */
  win.__evcCloud.prog(job.id, 999, 999);
  win.__evcCloud.done(job.id, 500, "", "");
  assert.deepEqual(seen, [[100, 300], [300, 300]]);

  /* 目录页用 "text"；两个请求各走各的 id，回调顺序反着来也对得上。 */
  const a = cloudGet(cloudUrl("/files/AC06/"), "text", { win });
  const b = cloudGet(cloudUrl("/files/M01/"), "text", { win });
  assert.notEqual(a.id, b.id);
  assert.equal(calls[1].kind, "text");
  win.__evcCloud.done(b.id, 404, b64(utf8("文件不存在")), "");
  win.__evcCloud.done(a.id, 200, b64(utf8(SAMPLE)), "");
  assert.equal((await b.promise).status, 404);
  assert.equal(versionsFrom(await a.promise, "ac06").items[0].name, "V3.0.9");

  /* 网络错误：status 0，error 原样。 */
  const c = cloudGet(cloudUrl("/files/AC06/"), "text", { win });
  win.__evcCloud.done(c.id, 0, "", "timeout");
  const failed = await c.promise;
  assert.deepEqual([failed.status, failed.error, failed.bytes.length], [0, "timeout", 0]);
  assert.equal(cloudProblem(failed, "ac06", "versions").text, "无法连接服务器，请检查手机网络后重试");
});

test("cloudGet：取消之后迟到的回调被忽略", async () => {
  const { win } = fakeWin();
  const seen = [];
  const job = cloudGet(cloudUrl("/files/AC06/V3.0.9/a.bin"), "bin", { win, onProgress: (d) => seen.push(d) });
  win.__evcCloud.prog(job.id, 10, 100);
  job.cancel();
  win.__evcCloud.prog(job.id, 50, 100);
  win.__evcCloud.done(job.id, 200, b64([1, 2, 3]), "");
  const got = await job.promise;
  assert.equal(got.cancelled, true);
  assert.equal(got.status, 0);
  assert.equal(got.bytes.length, 0);
  assert.deepEqual(seen, [10]);
  job.cancel();
});

test("cloudGet：老壳子没有 EVC.cloudGet → unsupported；原生一直不回 → 超时按网络失败", async (t) => {
  for (const win of [{}, { EVC: {} }, { EVC: { cloudGet: "no" } }]) {
    assert.ok(!cloudSupported(win));
    const got = await cloudGet(cloudUrl("/files/AC06/"), "text", { win }).promise;
    assert.deepEqual([got.status, got.error], [0, "unsupported"]);
    assert.equal(cloudProblem(got, "ac06", "versions").text, "当前 APP 壳不支持云端固件，请升级 APP");
  }
  /* 桥自己抛异常。 */
  const broken = await cloudGet(cloudUrl("/files/AC06/"), "text", { win: { EVC: { cloudGet() { throw new Error("x"); } } } }).promise;
  assert.equal(broken.status, 0);
  assert.equal(cloudProblem(broken, "ac06", "versions").retry, true);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { win } = fakeWin();
  const job = cloudGet(cloudUrl("/files/AC06/V3.0.9/a.bin"), "bin", { win });
  t.mock.timers.tick(CLOUD_TIMEOUT_MS - 1000);
  /* 有进度就重新计时。 */
  win.__evcCloud.prog(job.id, 1, 100);
  t.mock.timers.tick(CLOUD_TIMEOUT_MS - 1);
  let settled = false;
  job.promise.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const got = await job.promise;
  assert.deepEqual([got.status, got.error, got.cancelled], [0, "timeout", false]);
  win.__evcCloud.done(job.id, 200, b64([1]), "");
  t.mock.timers.reset();
});

/* ---------- 字符串 ---------- */

test("i18n：新字符串 12 种语言都有，占位符原样，除日语外没有中文；两边的表都翻得出来", () => {
  assert.deepEqual(CLOUD_LANGS.slice().sort(), others.slice().sort());
  const keys = CLOUD_ROWS.map((r) => r[0]);
  assert.equal(new Set(keys).size, keys.length);
  /* cloud-fw.js 用到的每一句都在表里。 */
  for (const text of Object.values(CLOUD_TEXTS)) assert.ok(keys.includes(text), text);
  for (const r of CLOUD_ROWS) {
    const key = r[0];
    assert.equal(r.length, 13, key);
    const holders = (key.match(/\{[a-z]+\}/g) || []).sort();
    r.slice(1).forEach((text, i) => {
      const lang = CLOUD_LANGS[i];
      assert.ok(typeof text === "string" && text.trim() === text && text.length > 0, lang + ": " + key);
      assert.deepEqual((text.match(/\{[a-z]+\}/g) || []).sort(), holders, lang + ": " + key);
      if (lang !== "ja") assert.ok(!CJK.test(text), lang + " 里还有中文: " + text);
      if (key.includes("APP")) assert.ok(text.length > 0);
      assert.equal(cloudPacks[lang][key], text);
      /* AC06 的表、M01 的表（M01App.vue 用 m01Translate）都有译文，不是原样的中文。 */
      assert.notEqual(translate(lang, key), key, lang + ": " + key);
      assert.ok(!CJK.test(translate(lang, key)) || lang === "ja", lang + ": " + key);
      assert.ok(m01HasKey(lang, key), "M01 " + lang + ": " + key);
      assert.notEqual(m01Raw(lang, key), key);
      assert.notEqual(m01Translate(lang, key), key);
    });
  }
  /* 新句子用的就是这里的译文；占位符能填。 */
  assert.equal(translate("en", "云端固件"), "Cloud firmware");
  assert.equal(translate("en", "云端还没有 {m} 固件", { m: "AC06" }), "No AC06 firmware in the cloud yet");
  assert.equal(m01Translate("en", "云端还没有 {m} 固件", { m: "M01" }), "No M01 firmware in the cloud yet");
  assert.equal(translate("de", "服务器返回 {code}", { code: 503 }), "Server antwortete mit 503");
  assert.equal(translate("en", "正在下载 {p}%", { p: 42 }), "Downloading 42%");
  /* 组件里另外用到的旧句子（大小、文件版本、文件不能超过）原来就有。 */
  for (const key of ["大小", "文件版本"]) for (const lang of others) {
    assert.notEqual(translate(lang, key), key, lang + ": " + key);
    assert.notEqual(m01Translate(lang, key), key, "M01 " + lang + ": " + key);
  }
  for (const lang of others) {
    assert.notEqual(translate(lang, "文件不能超过 240 KB"), "文件不能超过 240 KB", lang);
    assert.notEqual(m01Translate(lang, "文件不能超过 200 KB"), "文件不能超过 200 KB", lang);
  }
  /* CloudFw.vue 模板里直接写的中文只有这两句旧的。 */
  const vue = src("CloudFw.vue");
  const template = vue.slice(0, vue.indexOf("<script setup>")).replace(/<!--[\s\S]*?-->/g, "");
  const literal = [...template.matchAll(/t\('([^']*)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(literal, ["大小", "文件版本"]);
  assert.ok(!CJK.test(template.replace(/t\('[^']*'/g, "")));
});

/* ---------- 两个页面怎么接 ---------- */

test("App.vue / M01App.vue：固件升级页都挂了 CloudFw，kind 各是各的，升级中禁用，下载好的字节走原来那条路", () => {
  for (const [file, kind, imp, check] of [
    ["App.vue", "ac06", 'import CloudFw from "./CloudFw.vue";', "firmwareLayout(image)"],
    ["m01/M01App.vue", "m01", 'import CloudFw from "../CloudFw.vue";', "firmwareLooksValid(image)"],
  ]) {
    const vue = src(file);
    assert.ok(vue.includes(imp), file);
    const template = vue.slice(0, vue.indexOf("<script setup>"));
    const from = template.indexOf(`v-else-if="page === 'ota'"`);
    assert.ok(from >= 0, file);
    const ota = template.slice(from, template.indexOf("</section>", from));
    /* 只挂一处，在固件升级页里；「选择固件文件」在它的插槽里，两个按钮并排。 */
    assert.equal(template.split("<CloudFw").length, 2, file);
    const m = ota.match(/<CloudFw kind="(\w+)" :disabled="otaBusy" :t="t" @loaded="onCloudFirmware">\s*<button class="ghost" @click="pickFirmware">\{\{ t\('选择固件文件'\) \}\}<\/button>\s*<\/CloudFw>/);
    assert.ok(m, file);
    assert.equal(m[1], kind, file);

    const script = vue.slice(vue.indexOf("<script setup>"));
    /* 本机文件：读完交给 loadFirmwareBytes。 */
    const pick = script.slice(script.indexOf("function onFirmwareFile("), script.indexOf("function onCloudFirmware("));
    assert.match(pick, /reader\.onload = \(\) => loadFirmwareBytes\(file\.name, new Uint8Array\(reader\.result\)\);/);
    assert.match(pick, /reader\.readAsArrayBuffer\(file\);/);
    /* 云端：升级进行中不换文件；同一个 loadFirmwareBytes。 */
    const cloud = script.slice(script.indexOf("function onCloudFirmware("), script.indexOf("function loadFirmwareBytes("));
    assert.match(cloud, /if \(otaBusy\.value \|\| !got \|\| !got\.bytes\) return;\s*loadFirmwareBytes\(got\.name, got\.bytes\);/);
    /* 检查一项没少：大小、类型、分区 / 向量表；通过后停在 "file"，等「开始升级」。 */
    const load = script.slice(script.indexOf("function loadFirmwareBytes("), script.indexOf("function acceptDowngrade("));
    assert.ok(load.includes(`firmwareTypeError("${kind}", image)`), file);
    assert.ok(load.includes(check), file);
    assert.match(load, /size < 8 \|\| size > /);
    assert.match(load, /otaPhase\.value = "file";/);
    assert.ok(!/OTAPREP|OTABEGIN|sendOtaChunks/.test(load.replace(/\/\*[\s\S]*?\*\//g, "")), file);
    /* 云端这条路没有另写一份发送：cloud-fw.js、CloudFw.vue 里不碰 OTA 命令，也不直接联网。 */
    for (const mine of [src("cloud-fw.js"), src("CloudFw.vue")]) {
      assert.ok(!/OTAPREP|OTABEGIN|OTADATA|sendOtaChunks|bridge\(\)\.send|\bfetch\(|XMLHttpRequest/.test(mine));
    }
  }
});

/* ---------- 组件：在 node 里挂起来走一遍 ---------- */

function el(tag) {
  return { tag, children: [], props: {}, parent: null, text: "" };
}
const nodeOps = {
  createElement: (tag) => el(tag),
  createText: (text) => ({ tag: "#text", text, parent: null }),
  createComment: (text) => ({ tag: "#comment", text, parent: null }),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.children = text ? [{ tag: "#text", text, parent: node }] : []; },
  insert: (child, parent, anchor) => {
    if (child.parent) nodeOps.remove(child);
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i >= 0) parent.children.splice(i, 0, child);
    else parent.children.push(child);
    child.parent = parent;
  },
  remove: (child) => {
    const p = child.parent;
    if (!p) return;
    const i = p.children.indexOf(child);
    if (i >= 0) p.children.splice(i, 1);
    child.parent = null;
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => (node.parent ? node.parent.children[node.parent.children.indexOf(node) + 1] || null : null),
  patchProp: (node, key, prev, next) => { node.props[key] = next; },
  setScopeId() {},
};
const textOf = (node) => (node.tag === "#text" ? node.text : node.tag === "#comment" ? "" : node.children.map(textOf).join(""));
function findAll(node, pred, out = []) {
  if (!node || node.tag === "#text" || node.tag === "#comment") return out;
  if (pred(node)) out.push(node);
  node.children.forEach((c) => findAll(c, pred, out));
  return out;
}
const hasClass = (node, cls) => String(node.props.class || "").split(/\s+/).includes(cls);

let CloudFw = null;
async function loadComponent() {
  if (CloudFw) return CloudFw;
  const file = fileURLToPath(new URL("../src/CloudFw.vue", import.meta.url));
  const { descriptor } = parse(readFileSync(file, "utf8"), { filename: file });
  const out = compileScript(descriptor, { id: "cloud-fw-test", inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } });
  const dir = mkdtempSync(resolve(tmpdir(), "ac06-cloud-"));
  const target = resolve(dir, "CloudFw.mjs");
  writeFileSync(target, out.content
    .replace(/from "vue"/g, "from " + JSON.stringify(import.meta.resolve("vue")))
    .replace(/from "\.\/([^"]+)"/g, (m, f) => "from " + JSON.stringify(new URL("../src/" + f, import.meta.url).href)));
  CloudFw = (await import(pathToFileURL(target).href)).default;
  return CloudFw;
}

/* 假的手机壳：记下每次 cloudGet；测试用 answer() 按 url 回。 */
async function mount(kind, opts = {}) {
  const Comp = await loadComponent();
  const requests = [];
  const loaded = [];
  globalThis.window = globalThis;
  delete globalThis.__evcCloud;
  globalThis.EVC = opts.oldShell ? {} : { cloudGet(id, url, k) { requests.push({ id, url, kind: k }); } };
  const state = { disabled: !!opts.disabled, shown: true };
  const lang = opts.lang || "zh";
  let rerender = null;
  const Host = {
    data: () => state,
    created() { rerender = (patch) => Object.assign(this.$data, patch); },
    render() {
      if (!this.shown) return h("div");
      return h(Comp, { kind, disabled: this.disabled, t: (text, vars) => translate(lang, text, vars), onLoaded: (got) => loaded.push(got) },
        { default: () => h("button", { class: "ghost pick" }, "选择固件文件") });
    },
  };
  const root = el("div");
  const app = createRenderer(nodeOps).createApp(Host);
  app.mount(root);
  const settle = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick(); } };
  const api = {
    root, requests, loaded,
    text: () => textOf(root),
    buttons: (cls) => findAll(root, (n) => n.tag === "button" && (!cls || hasClass(n, cls))),
    byClass: (cls) => findAll(root, (n) => hasClass(n, cls)),
    async click(cls, index = 0) {
      const hit = api.buttons(cls)[index];
      assert.ok(hit, "没有这个按钮: " + cls);
      assert.ok(!hit.props.disabled, "按钮是灰的: " + cls);
      hit.props.onClick({});
      await settle();
    },
    last: () => requests[requests.length - 1],
    async done(req, status, body, error) {
      globalThis.__evcCloud.done(req.id, status, body == null ? "" : b64(typeof body === "string" ? utf8(body) : body), error || "");
      await settle();
    },
    async prog(req, done, total) {
      globalThis.__evcCloud.prog(req.id, done, total);
      await settle();
    },
    async set(patch) { rerender(patch); await settle(); },
    unmount: () => app.unmount(),
  };
  return api;
}

const FW = (() => {
  const bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xFF;
  return bytes;
})();
const FW_NAME = "V3.0.9_" + crcHex(FW) + ".bin";
const versionsPage = page([row("/files/AC06/V3.0.8/", "V3.0.8", "目录"), row("/files/AC06/V3.0.9/", "V3.0.9", "目录"), row("/files/AC06/copy.html", "copy.html", "1 KB")]);
const filesPage = page([
  row("/files/AC06/V3.0.9/AC06_V3.0.9.zip", "AC06_V3.0.9.zip", "4.7 MB"),
  row("/files/AC06/V3.0.9/" + FW_NAME, FW_NAME, "4.0 KB"),
  row("/files/AC06/V3.0.9/%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E8%AF%B4%E6%98%8E.html", "版本升级说明.html", "399.2 KB"),
]);

test("组件：选版本 → 选文件 → 确认 → 下载（进度）→ 校验通过 → loaded，然后收起", async () => {
  const ui = await mount("ac06");
  /* 两个按钮并排：插槽里的「选择固件文件」和「云端固件」。 */
  const rowEl = ui.byClass("cloud-row")[0];
  assert.deepEqual(rowEl.children.filter((c) => c.tag === "button").map(textOf), ["选择固件文件", "云端固件"]);
  assert.equal(ui.requests.length, 0);

  await ui.click("cloud-open");
  assert.deepEqual([ui.last().url, ui.last().kind], ["http://8.210.219.113:8088/files/AC06/", "text"]);
  assert.match(ui.text(), /正在读取云端固件列表/);
  await ui.done(ui.last(), 200, versionsPage);
  assert.match(ui.text(), /选择版本/);
  assert.deepEqual(ui.buttons("cloud-version").map(textOf), ["V3.0.9", "V3.0.8"]);

  await ui.click("cloud-version", 0);
  assert.deepEqual([ui.last().url, ui.last().kind], ["http://8.210.219.113:8088/files/AC06/V3.0.9/", "text"]);
  await ui.done(ui.last(), 200, filesPage);
  /* 只有 .bin；显示文件名、大小、版本、CRC。 */
  assert.equal(ui.buttons("cloud-file").length, 1);
  const line = textOf(ui.buttons("cloud-file")[0]);
  assert.ok(line.includes(FW_NAME) && line.includes("4.0 KB") && line.includes("V3.0.9") && line.includes("CRC " + crcHex(FW)), line);

  /* 点文件 → 弹确认；取消回到列表，不下载。 */
  await ui.click("cloud-file", 0);
  const ask = textOf(ui.byClass("cloud-ask")[0]);
  assert.ok(ask.includes(FW_NAME) && ask.includes("大小 4.0 KB") && ask.includes("文件版本 V3.0.9") && ask.includes("确定使用云端固件？"), ask);
  assert.deepEqual(ui.byClass("cloud-ask-btns")[0].children.filter((c) => c.tag === "button").map(textOf), ["取消", "确定"]);
  const before = ui.requests.length;
  await ui.click("cloud-no");
  assert.equal(ui.byClass("cloud-ask").length, 0);
  assert.equal(ui.requests.length, before);
  assert.equal(ui.buttons("cloud-file").length, 1);

  /* 确定 → 下载。 */
  await ui.click("cloud-file", 0);
  await ui.click("cloud-yes");
  assert.deepEqual([ui.last().url, ui.last().kind], ["http://8.210.219.113:8088/files/AC06/V3.0.9/" + FW_NAME, "bin"]);
  assert.match(ui.text(), /正在下载 0%/);
  assert.ok(ui.buttons("cloud-open")[0].props.disabled);
  await ui.prog(ui.last(), 1024, 4096);
  assert.match(ui.text(), /正在下载 25%/);
  assert.equal(ui.byClass("ota-fill")[0].props.style.width, "25%");
  assert.equal(ui.buttons("cloud-cancel").length, 1);
  assert.equal(ui.loaded.length, 0);
  await ui.done(ui.last(), 200, FW);
  assert.equal(ui.loaded.length, 1);
  assert.equal(ui.loaded[0].name, FW_NAME);
  assert.ok(ui.loaded[0].bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(ui.loaded[0].bytes), Array.from(FW));
  /* 收起：只剩那一排按钮。 */
  assert.equal(ui.byClass("cloud-panel").length, 0);
  assert.equal(ui.text(), "选择固件文件云端固件");
  ui.unmount();
});

test("组件：CRC 或字节数不对 → “云端文件校验失败，请重试”，不 loaded；重试再下一次", async () => {
  const ui = await mount("ac06");
  await ui.click("cloud-open");
  await ui.done(ui.last(), 200, versionsPage);
  await ui.click("cloud-version", 0);
  await ui.done(ui.last(), 200, filesPage);
  await ui.click("cloud-file", 0);
  await ui.click("cloud-yes");
  const bad = FW.slice();
  bad[10] ^= 0x80;
  await ui.done(ui.last(), 200, bad);
  assert.equal(ui.loaded.length, 0);
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "云端文件校验失败，请重试");
  /* 重试：同一个文件再下；这回总长对不上（只收到一半）。 */
  const n = ui.requests.length;
  await ui.click("cloud-retry");
  assert.equal(ui.requests.length, n + 1);
  assert.equal(ui.last().kind, "bin");
  await ui.prog(ui.last(), 2048, 4096);
  await ui.done(ui.last(), 200, FW.subarray(0, 2048));
  assert.equal(ui.loaded.length, 0);
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "云端文件校验失败，请重试");
  /* 「返回」回到文件列表。 */
  await ui.click("cloud-back");
  assert.equal(ui.buttons("cloud-file").length, 1);
  /* 再来一次，这回是对的。 */
  await ui.click("cloud-file", 0);
  await ui.click("cloud-yes");
  await ui.done(ui.last(), 200, FW);
  assert.equal(ui.loaded.length, 1);
  ui.unmount();
});

test("组件：目录 404 / 没有版本 / 没有 .bin / 网络失败（带重试）/ 别的状态码 / 老壳子，都有看得懂的话", async () => {
  /* AC06：目录 404。 */
  let ui = await mount("ac06");
  await ui.click("cloud-open");
  await ui.done(ui.last(), 404, "文件不存在");
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "云端还没有 AC06 固件");
  assert.equal(ui.buttons("cloud-retry").length, 0);
  /* 取消收起；再点重新读。 */
  await ui.click("cloud-cancel");
  assert.equal(ui.byClass("cloud-panel").length, 0);
  await ui.click("cloud-open");
  assert.equal(ui.requests.length, 2);
  ui.unmount();

  /* M01：读 M01/；目录在但没有版本文件夹。 */
  ui = await mount("m01");
  await ui.click("cloud-open");
  assert.equal(ui.last().url, "http://8.210.219.113:8088/files/M01/");
  await ui.done(ui.last(), 200, page([row("/files/M01/readme.txt", "readme.txt", "1 KB")]));
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "云端还没有 M01 固件");
  ui.unmount();

  /* 网络失败：有重试，点了重发同一个请求；这回 500。 */
  ui = await mount("ac06");
  await ui.click("cloud-open");
  await ui.done(ui.last(), 0, null, "timeout");
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "无法连接服务器，请检查手机网络后重试");
  assert.equal(textOf(ui.buttons("cloud-retry")[0]), "重试");
  await ui.click("cloud-retry");
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.last().url, "http://8.210.219.113:8088/files/AC06/");
  await ui.done(ui.last(), 500, "oops");
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "服务器返回 500");
  await ui.click("cloud-retry");
  await ui.done(ui.last(), 200, versionsPage);
  /* 版本里没有 .bin：能返回去选别的版本。 */
  await ui.click("cloud-version", 1);
  assert.equal(ui.last().url, "http://8.210.219.113:8088/files/AC06/V3.0.8/");
  await ui.done(ui.last(), 200, page([row("/files/AC06/V3.0.8/a.zip", "a.zip", "4.7 MB")]));
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "这个版本里没有可用的固件文件");
  await ui.click("cloud-back");
  assert.deepEqual(ui.buttons("cloud-version").map(textOf), ["V3.0.9", "V3.0.8"]);
  /* 选版本时断网：重试重读那个版本。 */
  await ui.click("cloud-version", 0);
  await ui.done(ui.last(), 0, null, "connect");
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "无法连接服务器，请检查手机网络后重试");
  await ui.click("cloud-retry");
  assert.equal(ui.last().url, "http://8.210.219.113:8088/files/AC06/V3.0.9/");
  ui.unmount();

  /* 老壳子：不发请求，直接提示。 */
  ui = await mount("ac06", { oldShell: true });
  await ui.click("cloud-open");
  assert.equal(ui.requests.length, 0);
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "当前 APP 壳不支持云端固件，请升级 APP");
  assert.equal(ui.buttons("cloud-retry").length, 0);
  ui.unmount();

  /* 别的语言：提示是译文，不是中文。 */
  ui = await mount("m01", { lang: "en" });
  assert.equal(textOf(ui.buttons("cloud-open")[0]), "Cloud firmware");
  await ui.click("cloud-open");
  await ui.done(ui.last(), 404, "文件不存在");
  assert.equal(textOf(ui.byClass("cloud-note")[0]), "No M01 firmware in the cloud yet");
  ui.unmount();
});

test("组件：升级进行中打不开；下载能取消；离开页面后迟到的回调不理", async () => {
  /* otaBusy：按钮是灰的，点了也不发请求。 */
  let ui = await mount("ac06", { disabled: true });
  const open = ui.buttons("cloud-open")[0];
  assert.equal(open.props.disabled, true);
  open.props.onClick({});
  await nextTick();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.byClass("cloud-panel").length, 0);
  ui.unmount();

  /* 下载中取消：回到文件列表；之后原生再回完成，也不 loaded。 */
  ui = await mount("ac06");
  await ui.click("cloud-open");
  await ui.done(ui.last(), 200, versionsPage);
  await ui.click("cloud-version", 0);
  await ui.done(ui.last(), 200, filesPage);
  await ui.click("cloud-file", 0);
  await ui.click("cloud-yes");
  const dl = ui.last();
  await ui.prog(dl, 1024, 4096);
  await ui.click("cloud-cancel");
  assert.equal(ui.buttons("cloud-file").length, 1);
  await ui.prog(dl, 4096, 4096);
  await ui.done(dl, 200, FW);
  assert.equal(ui.loaded.length, 0);
  assert.equal(ui.buttons("cloud-file").length, 1);
  assert.equal(ui.byClass("ota-fill").length, 0);

  /* 开始下载后升级开始了（disabled 变真）：收起，迟到的完成不 loaded。 */
  await ui.click("cloud-file", 0);
  await ui.click("cloud-yes");
  const dl2 = ui.last();
  await ui.set({ disabled: true });
  assert.equal(ui.byClass("cloud-panel").length, 0);
  await ui.done(dl2, 200, FW);
  assert.equal(ui.loaded.length, 0);
  ui.unmount();

  /* 离开页面（组件卸掉）：读列表的请求取消，迟到的回调没有任何效果。 */
  ui = await mount("ac06");
  await ui.click("cloud-open");
  const req = ui.last();
  await ui.set({ shown: false });
  assert.equal(ui.text(), "");
  await ui.done(req, 200, versionsPage);
  assert.equal(ui.text(), "");
  assert.equal(ui.loaded.length, 0);
  /* 读列表时换了主意（取消）再点开：旧请求的应答不会顶掉新的。 */
  await ui.set({ shown: true });
  await ui.click("cloud-open");
  const first = ui.last();
  await ui.click("cloud-cancel");
  await ui.click("cloud-open");
  const second = ui.last();
  assert.notEqual(first.id, second.id);
  await ui.done(first, 404, "文件不存在");
  assert.match(ui.text(), /正在读取云端固件列表/);
  await ui.done(second, 200, versionsPage);
  assert.deepEqual(ui.buttons("cloud-version").map(textOf), ["V3.0.9", "V3.0.8"]);
  ui.unmount();
});
