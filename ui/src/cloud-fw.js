/* 云端固件（固件升级页的「云端固件」按钮，CloudFw.vue 用）：从 OTA 服务器的 AC06/ 或 M01/ 目录
 * 里选一个版本文件夹、再选里面的 .bin，下载、校验后交给页面原有的“选完本地文件之后”的流程。
 * 这里只有纯逻辑，没有 DOM，node 里能测（test/cloud-fw.test.mjs）。
 *
 * 联网不走 fetch（页面是 file://，服务器是 http），走原生壳的桥：
 *   JS → 原生：window.EVC.cloudGet(id, url, kind)   kind = "text"（目录页）| "bin"（固件）
 *   原生 → JS：window.__evcCloud.prog(id, done, total)
 *              window.__evcCloud.done(id, status, bodyBase64, error)   status 0 = 网络错误
 * 原生只放行 http://ftp.evcity.cc:8088/files/...，响应体上限 1 MB。老壳子没有 EVC.cloudGet。 */

export const CLOUD_BASE = "http://ftp.evcity.cc:8088";
export const CLOUD_ROOT = "/files/";
/* 原生一直不回调时页面自己放弃（原生的连接超时 10 秒、读超时 20 秒；每次进度回调重新计）。 */
export const CLOUD_TIMEOUT_MS = 45000;

export const CLOUD_TEXTS = {
  button: "云端固件",
  loading: "正在读取云端固件列表",
  pickVersion: "选择版本",
  pickFile: "选择固件",
  none: "云端还没有 {m} 固件",
  noBin: "这个版本里没有可用的固件文件",
  offline: "无法连接服务器，请检查手机网络后重试",
  http: "服务器返回 {code}",
  oldShell: "当前 APP 壳不支持云端固件，请升级 APP",
  badFile: "云端文件校验失败，请重试",
  ask: "确定使用云端固件？",
  ok: "确定",
  cancel: "取消",
  retry: "重试",
  back: "返回",
  downloading: "正在下载 {p}%",
};

/* 桩的类型 → 服务器上的项目文件夹。 */
export function cloudDir(kind) {
  return kind === "m01" ? "M01" : "AC06";
}
export function cloudDirPath(kind) {
  return CLOUD_ROOT + cloudDir(kind) + "/";
}
export function cloudUrl(path) {
  return CLOUD_BASE + path;
}

function decodeName(part) {
  try {
    return decodeURIComponent(part);
  } catch (e) {
    return part;
  }
}
function plain(html) {
  return String(html).replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .trim();
}

/* 目录页（HTML 表格，一行一个条目）→ [{ name, isDir, size, href }]。
 * name 取 href 最后一段（百分号解码）；目录的 href 以 / 结尾，大小那一格写的是“目录”。 */
export function parseListing(html) {
  const out = [];
  const text = String(html == null ? "" : html);
  const rows = text.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const link = row.match(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/i) || row.match(/<a\b[^>]*\bhref\s*=\s*'([^']*)'/i);
    if (!link) continue;
    const href = link[1].replace(/&amp;/g, "&");
    const path = href.split(/[?#]/)[0];
    const isDir = /\/$/.test(path);
    const parts = path.split("/").filter((p) => p !== "");
    if (!parts.length) continue;
    const name = decodeName(parts[parts.length - 1]);
    if (name === "." || name === "..") continue;
    const cell = row.match(/<td\b[^>]*class\s*=\s*["']?size["']?[^>]*>([\s\S]*?)<\/td>/i);
    const size = cell ? plain(cell[1]) : "";
    out.push({ name, isDir, size: isDir ? "" : size, href });
  }
  return out;
}

/* 版本号是 大版本.APP版本.固件版本，书写补零（文档/版本规则.md）：新的版本文件夹叫 V3.01.00，里面的固件叫
 * V3.01.00_<CRC>.bin。服务器上已有的 V3.0.9、V3.1.0（当年不补零的写法）照样认：每段按数字读，3.1.0 = 3.01.00。
 * 排新旧按完整三段比：同一个 大版本.APP版本 下第 3 段大的是新固件。
 *
 * "V3.01.02" / "V3.0.9" / "V3.0.9.1" → [3, 1, 2] / [3, 0, 9] / [3, 0, 9, 1]；别的 → null。 */
export function versionParts(name) {
  const m = /^V(\d{1,4}(?:\.\d{1,4}){2,3})$/.exec(String(name));
  return m ? m[1].split(".").map(Number) : null;
}
/* a 比 b 新 → 正数。 */
export function compareVersions(a, b) {
  const x = Array.isArray(a) ? a : (versionParts(a) || []);
  const y = Array.isArray(b) ? b : (versionParts(b) || []);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return x.length - y.length;
}

/* href 只认本服务器 /files/ 下的绝对路径、不带 ..；给了 under 就还得在它下面。 */
export function hrefOk(href, under) {
  const h = String(href || "");
  if (h.indexOf(CLOUD_ROOT) !== 0) return false;
  if (h.indexOf("..") >= 0 || /[\s\\?#]/.test(h)) return false;
  if (under && h.indexOf(under) !== 0) return false;
  return true;
}

/* 版本文件夹：只收名字形如 V3.01.00（或老写法 V3.0.9 / V3.0.9.1）的目录，从新到旧；同名只留一个。 */
export function versionFolders(entries, under) {
  const seen = {};
  const out = [];
  for (const e of entries || []) {
    if (!e || !e.isDir || !versionParts(e.name) || seen[e.name]) continue;
    if (!hrefOk(e.href, under)) continue;
    seen[e.name] = true;
    out.push({ name: e.name, label: e.name, href: e.href });
  }
  return out.sort((a, b) => compareVersions(b.name, a.name));
}

/* "V3.01.00_0093E971.bin" → { version: "3.01.00", crc: "0093E971" }，老写法 "V3.0.9_0093E971.bin" →
 * { version: "3.0.9", crc: "0093E971" }；不是这个样子 → null。
 * 早先新板的包叫 V<版本>_L2_<CRC>.bin，也认。 */
export function parseBinName(name) {
  const m = /^V(\d{1,4}(?:\.\d{1,4}){2,3})_(?:L2_)?([0-9A-Fa-f]{8})\.bin$/.exec(String(name));
  return m ? { version: m[1], crc: m[2].toUpperCase() } : null;
}

/* 版本文件夹里的固件：只按 .bin 后缀列出来，带上从文件名解析出的版本和 CRC（AC06、M01 发布时都叫 V<版本>_<CRC>.bin）。 */
export function binFiles(entries, under) {
  const out = [];
  for (const e of entries || []) {
    if (!e || e.isDir || !/\.bin$/i.test(e.name)) continue;
    if (!hrefOk(e.href, under)) continue;
    const info = parseBinName(e.name);
    out.push({ name: e.name, size: e.size || "", href: e.href, version: info ? info.version : "", crc: info ? info.crc : "" });
  }
  return out;
}

/* 和 App.vue / M01App.vue 里的 crc32 同一个算法（zlib 的 CRC-32，发布工具 fwcrc.py 也是它）。 */
export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
  }
  return (~crc) >>> 0;
}
export function crcHex(bytes) {
  return crc32(bytes).toString(16).toUpperCase().padStart(8, "0");
}
/* 文件名里带 8 位 CRC 时，下载的原始字节算出来必须等于它；文件名里没有就不查这一项。 */
export function crcOk(bytes, name) {
  const info = parseBinName(name);
  if (!info) return true;
  return crcHex(bytes) === info.crc;
}

/* 下载完的检查：有字节；原生报过总长（Content-Length）的话字节数要等于它；文件名里的 CRC 要对。
 * 通过返回 ""，否则返回提示。之后页面还要走原有的大小 / 类型 / 分区检查。 */
export function downloadError(bytes, name, total) {
  if (!bytes || !bytes.length) return CLOUD_TEXTS.badFile;
  if (total > 0 && bytes.length !== total) return CLOUD_TEXTS.badFile;
  if (!crcOk(bytes, name)) return CLOUD_TEXTS.badFile;
  return "";
}

export function b64ToBytes(b64) {
  const clean = String(b64 == null ? "" : b64).replace(/[^A-Za-z0-9+/]/g, "");
  if (!clean) return new Uint8Array(0);
  let bin;
  try {
    bin = atob(clean);
  } catch (e) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToText(bytes) {
  if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch (e) {
    return s;
  }
}

function host(win) {
  if (win) return win;
  return typeof window !== "undefined" ? window : null;
}
export function cloudSupported(win) {
  const w = host(win);
  return !!(w && w.EVC && typeof w.EVC.cloudGet === "function");
}

let nextId = 1;
const pending = {};

/* 把 window.__evcCloud = { done, prog } 挂上（原生按 id 回调；没人等的 id 直接丢掉）。 */
export function installCloudBridge(win) {
  const w = host(win);
  if (!w) return;
  if (w.__evcCloud && w.__evcCloud.__evc === pending) return;
  w.__evcCloud = {
    __evc: pending,
    prog(id, done, total) {
      const job = pending[String(id)];
      if (job) job.prog(Number(done) || 0, Number(total) || 0);
    },
    done(id, status, body, error) {
      const job = pending[String(id)];
      if (job) job.done(Number(status) || 0, body, error);
    },
  };
}

/* 发一个 GET。返回 { id, promise, cancel }；promise 总会有结果、不 reject：
 *   { status, bytes, error, total, cancelled }
 * status 是 HTTP 状态码，0 = 网络错误 / 超时 / 被拒 / 壳不支持（error 是简短英文原因）。
 * cancel() 之后原生迟到的回调一律不理，promise 给 { cancelled: true }。
 * opts.onProgress(done, total)；opts.win 给测试换掉 window；opts.timeoutMs 改等待上限。 */
export function cloudGet(url, kind, opts) {
  const o = opts || {};
  const w = host(o.win);
  const id = "c" + (nextId++) + "-" + Date.now().toString(36);
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  let finished = false;
  let timer = null;
  let total = 0;
  const limit = o.timeoutMs > 0 ? o.timeoutMs : CLOUD_TIMEOUT_MS;
  function finish(result) {
    if (finished) return;
    finished = true;
    delete pending[id];
    if (timer) clearTimeout(timer);
    timer = null;
    settle(result);
  }
  function arm() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => finish({ status: 0, bytes: new Uint8Array(0), error: "timeout", total, cancelled: false }), limit);
  }
  const handle = {
    id,
    promise,
    cancel() { finish({ status: 0, bytes: new Uint8Array(0), error: "cancelled", total, cancelled: true }); },
  };
  if (!cloudSupported(w)) {
    finish({ status: 0, bytes: new Uint8Array(0), error: "unsupported", total: 0, cancelled: false });
    return handle;
  }
  installCloudBridge(w);
  pending[id] = {
    prog(done, all) {
      if (finished) return;
      if (all > 0) total = all;
      arm();
      if (typeof o.onProgress === "function") o.onProgress(done, all);
    },
    done(status, body, error) {
      finish({ status, bytes: status ? b64ToBytes(body) : new Uint8Array(0), error: String(error || ""), total, cancelled: false });
    },
  };
  arm();
  try {
    w.EVC.cloudGet(id, String(url), kind === "bin" ? "bin" : "text");
  } catch (e) {
    finish({ status: 0, bytes: new Uint8Array(0), error: "bridge", total: 0, cancelled: false });
  }
  return handle;
}

/* 一次请求的结果 → 给用户看的提示 { text, vars, retry }；成功（2xx）返回 null。
 * what："versions"（项目目录）| "files"（版本文件夹）| "bin"（下载固件）。 */
export function cloudProblem(result, kind, what) {
  const r = result || {};
  const status = Number(r.status) || 0;
  if (status >= 200 && status < 300) return null;
  if (r.error === "unsupported") return { text: CLOUD_TEXTS.oldShell, vars: null, retry: false };
  if (status === 0 && r.error === "too large" && what === "bin") {
    return { text: kind === "m01" ? "文件不能超过 200 KB" : "文件不能超过 240 KB", vars: null, retry: false };
  }
  if (status === 0) return { text: CLOUD_TEXTS.offline, vars: null, retry: true };
  if (status === 404 && what === "versions") return { text: CLOUD_TEXTS.none, vars: { m: cloudDir(kind) }, retry: false };
  if (status === 404 && what === "files") return { text: CLOUD_TEXTS.noBin, vars: null, retry: false };
  return { text: CLOUD_TEXTS.http, vars: { code: status }, retry: true };
}

/* 读版本列表的结果 → { items } 或 { problem }。目录 404、或者里面一个版本文件夹都没有，都是“还没有固件”。 */
export function versionsFrom(result, kind) {
  const problem = cloudProblem(result, kind, "versions");
  if (problem) return { items: [], problem };
  const items = versionFolders(parseListing(bytesToText(result.bytes)), cloudDirPath(kind));
  if (!items.length) return { items, problem: { text: CLOUD_TEXTS.none, vars: { m: cloudDir(kind) }, retry: false } };
  return { items, problem: null };
}
/* 读一个版本文件夹的结果 → { items } 或 { problem }。folder 是 versionFolders() 给的那一项。 */
export function filesFrom(result, kind, folder) {
  const problem = cloudProblem(result, kind, "files");
  if (problem) return { items: [], problem };
  const items = binFiles(parseListing(bytesToText(result.bytes)), folder && folder.href);
  if (!items.length) return { items, problem: { text: CLOUD_TEXTS.noBin, vars: null, retry: false } };
  return { items, problem: null };
}
/* 下载固件的结果 → { bytes } 或 { problem }。 */
export function firmwareFrom(result, kind, file) {
  const problem = cloudProblem(result, kind, "bin");
  if (problem) return { bytes: null, problem };
  const bad = downloadError(result.bytes, file.name, result.total);
  if (bad) return { bytes: null, problem: { text: bad, vars: null, retry: true } };
  return { bytes: result.bytes, problem: null };
}

export function percent(done, total) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((done * 100) / total)));
}
