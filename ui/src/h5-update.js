/* 界面热更新（H5 热更新）自己的规则。检查顺序和状态机在 app-update.js（updStep），弹窗在
 * UpdateDialog.vue；原生在 Android 的 H5Updater.java 和 iOS 的 H5Updater.swift / EVCCore 的 H5UpdateRules。
 *
 * 更新的是 APP/ui 编出来的那份单文件 index.html，原生壳不变。每个 App 版本（基座）下面有自己的修订号
 * rN，从 r0（安装包内置的那一份）起；只更新界面时 App 版本和仓库根的 VERSION 都不变。
 *
 * 服务器：OTA 文件站上每个 App 版本一个文件夹「Android APP/V<大版本.APP版本>/」，里面是
 *   EVCITY-AC_H5_V<基座>.r<N>.zip          热更新包：根目录正好 index.html + manifest.json 两个文件
 *   EVCITY-AC_H5_V<基座>.r<N>.zip.sha256   一行「<64 位小写十六进制>  <包名>\n」
 *   latest.json                             指向这个基座最新的包，六个字段（见 parseLatest）
 * 包只给和它同一个基座的壳用（字符串完全相同，不做 3.4 = 3.04 的换算），修订号只往上走。
 * 完整性只核 SHA-256 和大小，不验签名。除了上面这几样，不读服务器上别的文件：热更新的开和关就看
 * latest.json 指向哪个修订号。
 *
 * 页面是 file:// 的，联网、下载、解压、切换都在原生里做，页面只调 window.EVC：
 *   h5Check()          结果回 window.__evcH5.onCheck(obj)：
 *                      {ok:true, base:"3.04", latest:3, current:0, staged:-1, hasNew:true,
 *                       file:"EVCITY-AC_H5_V3.04.r3.zip", size:512345}
 *                      没有包：{ok:true, base, latest:-1, current, staged:-1, hasNew:false, file:"", size:0}
 *                      没查成：{ok:false, reason:"offline"|"http"|"parse"}
 *                      current 是屏幕上这一页的修订号；staged 是磁盘上已经切换好、页面还没重新加载的。
 *   h5Download(file)   只收刚查到的那个名字。onProgress(percent, done, total) / onDone(rev) /
 *                      onError("badfile"|"busy"|"storage"|"offline"|"http"|"size"|"sha"|"zip"|"base"|"rev")
 *                      onDone 的时候磁盘上已经是新界面，只差重新加载。
 *   h5Cancel()         取消下载
 *   h5Apply()          重新加载页面（会断开蓝牙、回到设备列表）
 *   h5Ready()          页面挂载好了报到一次（main.js）；10 秒没报到壳会退回上一份界面
 *   h5Info()           同步返回 JSON：{"rev":3,"src":"hot"|"builtin","reloaded":true,"rolledBack":false}
 * 壳没有 h5Check / h5Download（老壳、浏览器、iOS 把热更新编掉的包）：没有热更新这一步。
 *
 * 这里都是纯函数，test/h5-update.test.mjs 不用手机就能测。文件名正则、地址、上限在 H5Updater.java、
 * iOS 的规则、tools/release/make_h5.py 里是同一个值，要改一起改。 */

export const H5_NAME_RE = /^EVCITY-AC_H5_V(\d+\.\d+)\.r(\d+)\.zip$/;
export const H5_KIND = "evcity-ac-h5";
export const H5_REV_MAX = 999999;
export const H5_ZIP_MAX_BYTES = 8 * 1024 * 1024;
export const H5_LATEST_NAME = "latest.json";
/* 版本文件夹的上一级。空格写成 %20。 */
export const H5_ROOT_URL = "http://ftp.evcity.cc:8088/files/Android%20APP/";
/* 原生最多三个请求（latest.json、目录列表、.zip.sha256），每个 8 秒；页面最多等这么久。 */
export const H5_CHECK_WATCHDOG_MS = 30000;

const BASE_RE = /^\d+\.\d+$/;
const SHA_RE = /^[0-9a-f]{64}$/;

/* 修订号：0–999999 的整数（数字，不是字符串）。别的 → -1。 */
export function cleanRev(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= H5_REV_MAX ? value : -1;
}

/* 这个基座的版本文件夹："3.04" → "http://ftp.evcity.cc:8088/files/Android%20APP/V3.04/"；基座不像样 → ""。 */
export function h5FolderUrl(base) {
  return typeof base === "string" && BASE_RE.test(base) ? H5_ROOT_URL + "V" + base + "/" : "";
}

/* ("3.04", 3) → "EVCITY-AC_H5_V3.04.r3.zip"；不像样 → ""。 */
export function h5Name(base, rev) {
  if (typeof base !== "string" || !BASE_RE.test(base) || cleanRev(rev) < 0) return "";
  return "EVCITY-AC_H5_V" + base + ".r" + rev + ".zip";
}

/* "EVCITY-AC_H5_V3.04.r3.zip" → { base: "3.04", rev: 3 }；不是这种名字 → null。
 * 修订号不补零（r03 不认），最大 999999。基座原样返回，不换算。 */
export function parseH5Name(name) {
  const m = typeof name === "string" ? H5_NAME_RE.exec(name) : null;
  if (!m) return null;
  if (m[2].length > 6 || (m[2].length > 1 && m[2].charAt(0) === "0")) return null;
  return { base: m[1], rev: Number(m[2]) };
}

/* 3 → "r3"；不像样 → "r0"。 */
export function h5RevLabel(rev) {
  return "r" + (cleanRev(rev) < 0 ? 0 : rev);
}

/* index.html 里的标记和 manifest.json 说的「基座.r修订号」：("3.04", 3) → "3.04.r3"。 */
export function h5Tag(base, rev) {
  return base + ".r" + rev;
}

function asObject(input) {
  let obj = input;
  if (typeof obj === "string") {
    try { obj = JSON.parse(obj); } catch (e) { obj = null; }
  }
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
}

/* manifest.json：{"kind":"evcity-ac-h5","base":"3.04","rev":3} → { base, rev }；不对 → null。 */
export function parseManifest(input) {
  const obj = asObject(input);
  if (!obj || obj.kind !== H5_KIND || typeof obj.base !== "string" || !BASE_RE.test(obj.base) || cleanRev(obj.rev) < 0) return null;
  return { base: obj.base, rev: obj.rev };
}

/* index.html 开头 4 KB 里的 <meta name="evc-h5" content="3.04.r3"> → "3.04.r3"；没有 → ""。 */
export function h5MetaOf(html) {
  const m = typeof html === "string" ? /<meta name="evc-h5" content="([^"]*)">/.exec(html.slice(0, 4096)) : null;
  return m ? m[1] : "";
}

/* latest.json：六个字段都必须有、类型要对，多出来的不看。
 *   kind    "evcity-ac-h5"
 *   base    基座，等于所在文件夹名去掉 V，也等于壳的 App 版本（给了 base 参数就核对）
 *   rev     整数 0–999999
 *   file    正好是 EVCITY-AC_H5_V<base>.r<rev>.zip
 *   sha256  zip 的 SHA-256，64 位小写十六进制
 *   size    zip 的字节数，1 到 8 MB
 * 返回 { ok:true, base, rev, file, sha256, size } 或 { ok:false, reason }。原生用的是同一套规则，
 * 页面自己不联网，这里给测试、文档和打包工具对照。 */
export function parseLatest(input, base) {
  const bad = (reason) => ({ ok: false, reason });
  const obj = asObject(input);
  if (!obj) return bad("json");
  if (obj.kind !== H5_KIND) return bad("kind");
  if (typeof obj.base !== "string" || !BASE_RE.test(obj.base)) return bad("base");
  if (typeof base === "string" && obj.base !== base) return bad("base");
  if (cleanRev(obj.rev) < 0) return bad("rev");
  if (typeof obj.file !== "string" || obj.file !== h5Name(obj.base, obj.rev)) return bad("file");
  if (typeof obj.sha256 !== "string" || !SHA_RE.test(obj.sha256)) return bad("sha256");
  if (typeof obj.size !== "number" || !Number.isInteger(obj.size) || obj.size < 1 || obj.size > H5_ZIP_MAX_BYTES) return bad("size");
  return { ok: true, base: obj.base, rev: obj.rev, file: obj.file, sha256: obj.sha256, size: obj.size };
}

/* .zip.sha256 那一行：「<64 位小写十六进制>  <包名>\n」（两个空格）→ 十六进制；不对 → ""。 */
export function parseShaLine(text, file) {
  if (typeof text !== "string" || typeof file !== "string" || !file) return "";
  const m = /^([0-9a-f]{64}) {2}([^\r\n]+)\r?\n?$/.exec(text);
  return m && m[2] === file ? m[1] : "";
}

/* 这个原生壳有没有热更新（h5Check 和 h5Download 都要有）。 */
export function h5Platform(api) {
  return !!api && typeof api.h5Check === "function" && typeof api.h5Download === "function";
}

function intOr(value, fallback) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

/* 原生给的 onCheck 结果过一遍（对象或 JSON 字符串）。pageBase / pageRev 是这一页编译时写死的基座和
 * 修订号（__H5_BASE__ / __H5_REV__）：
 *   - 基座要和本页的一致（本页不知道自己的基座时不比）；
 *   - 文件名必须合规矩，并且和 base、latest 对得上；
 *   - current 用本页的修订号，不用原生说的；
 *   - 有没有新的这里再比一次：latest 要比本页的、也比磁盘上已经切换好的（staged）都大。原生给的
 *     hasNew 不直接信。
 * 返回 { ok, reason, base, latest, current, staged, hasNew, file, size }；staged 没有是 -1。 */
export function normalizeH5Check(res, pageBase, pageRev) {
  const current = cleanRev(pageRev) < 0 ? 0 : pageRev;
  const fail = (reason) => ({ ok: false, reason, base: "", latest: -1, current, staged: -1, hasNew: false, file: "", size: 0 });
  const obj = asObject(res);
  if (!obj || obj.ok !== true) return fail(obj && typeof obj.reason === "string" && obj.reason ? obj.reason : "parse");
  const base = typeof obj.base === "string" ? obj.base : "";
  if (!BASE_RE.test(base)) return fail("parse");
  if (typeof pageBase === "string" && pageBase && base !== pageBase) return fail("base");
  const staged = cleanRev(obj.staged) > current ? obj.staged : -1;
  const file = typeof obj.file === "string" ? obj.file : "";
  const size = intOr(obj.size, 0) > 0 ? obj.size : 0;
  if (!file) {
    /* 没有包。原生要是说有新的却不给文件名，按看不懂算。 */
    if (cleanRev(obj.latest) >= 0) return fail("parse");
    return { ok: true, reason: "", base, latest: -1, current, staged, hasNew: false, file: "", size: 0 };
  }
  const name = parseH5Name(file);
  if (!name || name.base !== base || name.rev !== obj.latest || size > H5_ZIP_MAX_BYTES) return fail("parse");
  const hasNew = name.rev > current && name.rev > staged;
  return { ok: true, reason: "", base, latest: name.rev, current, staged, hasNew, file, size };
}

/* EVC.h5Info() 的结果（JSON 字符串或对象）→ { rev, src, reloaded, rolledBack }；没有这个方法、看不懂 → null。 */
export function readH5Info(api) {
  if (!api || typeof api.h5Info !== "function") return null;
  let obj = null;
  try { obj = asObject(api.h5Info()); } catch (e) { obj = null; }
  if (!obj) return null;
  return {
    rev: cleanRev(obj.rev) < 0 ? 0 : obj.rev,
    src: obj.src === "hot" ? "hot" : "builtin",
    reloaded: obj.reloaded === true,
    rolledBack: obj.rolledBack === true,
  };
}

/* 轻提示（中文键）。放在这里而不写在 app-update.js 里：那边的句子清单（UPDATE_TEXTS）只管安装包。 */
export const H5_TOAST_STAGED = "界面热更新已下载，下次打开 App 生效";
export const H5_TOAST_UPDATED = "界面已更新到 {v}";
export const H5_TOAST_ROLLED_BACK = "界面热更新没有成功，已恢复原来的界面";

/* 出错原因 → 给人看的句子（中文键）。连不上、状态码不对是下载失败；别的都是包不对。 */
export function h5ErrorText(reason) {
  if (reason === "offline" || reason === "http" || reason === "busy" || reason === "storage" || reason === "bridge") {
    return "下载失败，请检查网络后重试";
  }
  return "热更新包校验失败，请重试";
}

/* 热更新的几个窗口上显示什么（app-update.js 的 updView 转过来）。state 是 updStep 的状态，
 * link 是 "free"（没连着桩）/ "linked"（连着）/ "busy"（正在发固件或下发一键配置）。
 * buttons 的 id 就是发给 updStep 的事件名。不是热更新的阶段 → null。 */
export function h5View(state, link) {
  const title = "界面热更新";
  const v = h5RevLabel(state.h5Latest);
  switch (state.phase) {
    case "h5-prompt":
      return {
        open: true, title, text: "发现界面热更新 {v}（当前 {c}），是否下载并更新？", vars: { v, c: h5RevLabel(state.h5Current) },
        hint: "", progress: false,
        buttons: [{ id: "cancel", label: "取消" }, { id: "accept", label: "下载更新", primary: true }],
      };
    case "h5-downloading":
      return {
        open: true, title, text: "正在下载界面热更新 {v}", vars: { v }, hint: "", progress: true,
        buttons: [{ id: "cancel", label: "取消下载" }],
      };
    case "h5-applying":
      return { open: true, title, text: "正在校验并解压", vars: null, hint: "", progress: false, buttons: [] };
    case "h5-staged":
      /* 正在发固件：不给「立即切换」。 */
      if (link === "busy") {
        return {
          open: true, title, text: H5_TOAST_STAGED, vars: null, hint: "", progress: false,
          buttons: [{ id: "later", label: "知道了", primary: true }],
        };
      }
      return {
        open: true, title, text: "界面热更新 {v} 已准备好。现在切换会断开蓝牙并回到设备列表；也可以下次打开 App 时自动生效。",
        vars: { v: h5RevLabel(state.h5Staged) }, hint: "", progress: false,
        buttons: [{ id: "later", label: "下次生效" }, { id: "apply", label: "立即切换", primary: true }],
      };
    case "h5-error":
      return {
        open: true, title, text: h5ErrorText(state.error), vars: null, hint: "", progress: false,
        buttons: [{ id: "cancel", label: "取消" }, { id: "retry", label: "重试", primary: true }],
      };
    default:
      return null;
  }
}

/* 界面上用到的全部句子（中文键）。packs-h5.js 给每种语言都配齐，测试核对。「取消」「取消下载」「重试」
 * 「知道了」「下载失败，请检查网络后重试」在 packs-update.js 里已经有，这里一起带上，不依赖别的包。 */
export const H5_TEXTS = [
  "热更新",
  "界面热更新",
  "发现界面热更新 {v}（当前 {c}），是否下载并更新？",
  "取消",
  "下载更新",
  "正在下载界面热更新 {v}",
  "取消下载",
  "正在校验并解压",
  "下载失败，请检查网络后重试",
  "热更新包校验失败，请重试",
  "重试",
  "界面热更新 {v} 已准备好。现在切换会断开蓝牙并回到设备列表；也可以下次打开 App 时自动生效。",
  "下次生效",
  "立即切换",
  "知道了",
  "界面已更新到 {v}",
  "界面热更新已下载，下次打开 App 生效",
  "界面热更新没有成功，已恢复原来的界面",
];
