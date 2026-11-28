/* App 自己的更新检查（AC-34）。界面在 UpdateDialog.vue，原生在 Android 的 AppUpdater.java 和 iOS 的
 * AppUpdateCheck.swift / EVCCore 的 AppUpdateRules。
 *
 * 服务器：OTA 文件站上和 AC06/、M01/ 同级的文件夹「Android APP/」，每个 App 版本一个文件，名字固定
 * EVCITY-AC_V<大版本.APP版本>.apk，例如 EVCITY-AC_V3.02.apk（upload_release.sh 传的），没有清单文件。
 * 版本号是 大版本.APP版本.固件版本（文档/版本规则.md）：App 只有前两段，文件名里不带固件段——只改固件
 * 时不传新 APK。以前的文件名是三段的老写法（EVCITY-AC_V3.0.9.apk、EVCITY-AC_V3.1.0.apk），照样认：
 * 前两段就是当时的 App 版本（3.1.0 = 3.01），第 3 段是老方案的修订号，只在两个都是老写法时才拿来比。
 * 原生读目录列表那张 HTML 表，按文件名里的版本号逐段比数字，取最大的，和装着的版本比；是不是有新版本
 * 这里再按上面的规则比一次（normalizeCheck），以这里的为准。页面是 file:// 的，文件站没有 CORS 头，
 * 所以页面自己不联网，只调 window.EVC：
 *   updCheck()           两个平台都有。结果回 window.__evcUpd.onCheck(obj)：
 *                        {ok:true, latest:"3.02", current:"3.01", hasNew:true, file:"EVCITY-AC_V3.02.apk"}
 *                        或 {ok:false, reason:"offline"|"http"|"parse"}
 *                        文件夹还不存在（HTTP 404 / 410）原生和空文件夹一样回 ok:true、latest ""、
 *                        hasNew false；万一回的是 {ok:false, reason:"http", status:404}，normalizeCheck
 *                        也按「没有更新」算。"http" 只指别的状态码（403、5xx……）。
 *   updDownload(file)    只有 Android。onProgress(percent, done, total) / onDone() / onError(reason)
 *   updCancel()          只有 Android。取消下载
 *   updInstall()         只有 Android。onInstall("started"|"perm"|"denied"|"fail")
 *
 * 什么时候查：
 *   - 打开 App 约 2 秒后自动查一次（一次运行只自动查一次）。没网、文件夹不存在（404）、空文件夹、
 *     已是最新、列表看不懂都不出声；有新版本才弹窗。弹过并且点了取消的版本，这次运行里自动检查不再弹。
 *   - 点版本号（扫描页底部、首页底部、设置 → 关于）手动查：先轻提示「正在检查更新」，结果是
 *     「已是最新版本」「检查更新失败，请检查网络」或弹窗。手动查不管之前取消过没有。
 *     服务器上没有更新的版本就是「已是最新版本」：没有比装着的更高的 APK、文件夹是空的、文件夹还
 *     不存在（404）都算。只有真的没查成（连不上、超时、非 404 的状态码、列表看不懂）才是「检查更新失败」。
 *
 * 弹窗：
 *   Android：「发现新版本 V3.02（当前 V3.01），是否下载并安装？」取消 = 关掉，什么都不做；
 *            下载安装 = 同一个窗口变成进度条（可取消），下完自动调起系统安装器；要先允许「安装未知
 *            应用」时原生打开设置页，回来后自动接着装；失败给原因和「重试」。
 *   iOS：    没有 updDownload。只弹「有软件更新，请前往 App Store 更新」+「知道了」，不下载。
 *            iOS 装着的版本（CFBundleShortVersionString）也是和「Android APP/」里最高的版本比：
 *            两个平台的版本号同步发布，这是约定。APK 一出就传，不等 iOS 上架：iOS 新版还在审核的
 *            那段时间 iOS 也会提示，按设计如此。
 *   老的原生壳（没有 updCheck）和浏览器里：什么都不做。
 *
 * 界面热更新（第 2 步，规则在 h5-update.js）接在同一个状态机上。顺序写死，不走近路：
 *   第 1 步  查安装包（上面那一套，updCheck）
 *     - 没查成（没网、超时、非 404 的状态码、列表看不懂）：自动不出声，手动提示失败。到此结束，
 *       不查热更新——不能因为列表没读到就改去查热更新充数。
 *     - 有新安装包：弹安装包提示。
 *         接受（Android「下载安装」，iOS「知道了」）：走现有的路，这一轮不再查热更新，哪怕之后下载
 *         失败、取消了下载、没允许安装。下一次检查从第 1 步重新来。
 *         取消：进第 2 步。
 *     - 没有新安装包（已是最新、空文件夹、文件夹不存在）：进第 2 步；手动检查这时先不说「已是最新
 *       版本」，等第 2 步的结果。
 *     - 自动检查遇到这次运行里已经取消过的安装包版本：不弹，直接进第 2 步。
 *   第 2 步  查热更新（h5Check）。进来只有上面三个入口。
 *     - 没查成 / 没有更新的：自动不出声；手动且第 1 步是「没有新安装包」才提示失败 / 已是最新；刚在
 *       安装包提示上点了取消的不出声（服务器上明明有新安装包，不能说已是最新）。
 *     - 有新的 rN：弹「发现界面热更新 rN（当前 rM），是否下载并更新？」〔取消〕〔下载更新〕。这个 rN
 *       这次运行里取消过的，自动检查不再弹，手动照弹。
 *     - 同意：同一个窗口变进度条 → 原生下载、核对 SHA-256、解压、把磁盘上的界面切换成新的（onDone）。
 *       之后只差重新加载页面（会断开蓝牙、回到设备列表）：
 *         没连着桩（free）：马上 h5Apply()。
 *         连着桩（linked）：窗口变成「已准备好」〔下次生效〕〔立即切换〕。
 *         正在发固件 / 下发一键配置（busy）：不给「立即切换」，只轻提示下次打开 App 生效。
 *     - 磁盘上已经切换好、只差重新加载（选过「下次生效」）：手动检查直接回到「已准备好」，不重新下载。
 *   iOS 的安装包提示：壳有热更新（h5Check）时按钮是〔取消〕〔知道了〕，句子不变；「知道了」发的是
 *   单独的 ack（= 接受，不查热更新），「取消」进第 2 步。壳没有热更新时还是今天的一个「知道了」。
 *   壳没有 h5Check / h5Download（老壳、浏览器、iOS 把热更新编掉的包）：没有第 2 步，一切和上面一样。
 *
 * 这个文件里的规则都是纯函数（updStep 是状态机），test/app-update.test.mjs 不用手机就能测。 */

import {
  H5_CHECK_WATCHDOG_MS, H5_TOAST_STAGED, cleanRev, h5Platform, h5View, normalizeH5Check, parseH5Name,
} from "./h5-update.js";

export const APK_NAME_RE = /^EVCITY-AC_V(\d+(?:\.\d+)*)\.apk$/;
export const AUTO_DELAY_MS = 2000;
/* 原生的查询超时是 8 秒；过了这么久还没有 onCheck 就按失败算，免得一直停在「正在检查」。 */
export const CHECK_WATCHDOG_MS = 15000;
/* 热更新进了「正在校验并解压」之后最多等这么久：原生一直不回（或者让它重新加载却没动）就收掉窗口。 */
export const H5_APPLY_WATCHDOG_MS = 20000;

/* "EVCITY-AC_V3.02.apk" → "3.02"，老写法 "EVCITY-AC_V3.0.9.apk" → "3.0.9"；不是这种名字 → ""。 */
export function apkVersion(name) {
  const m = typeof name === "string" ? APK_NAME_RE.exec(name) : null;
  return m ? m[1] : "";
}

/* 版本号开头的数字段："3.0.8" / "V3.0.8" / "3.0.8-beta" → "3.0.8"；没有 → ""。 */
export function versionCore(text) {
  if (typeof text !== "string" && typeof text !== "number") return "";
  const m = /^\s*[Vv]?(\d+(?:\.\d+)*)/.exec(String(text));
  return m ? m[1] : "";
}

function stripZeros(digits) {
  const out = digits.replace(/^0+/, "");
  return out || "0";
}

function cmpDigits(a, b) {
  const p = stripZeros(a);
  const q = stripZeros(b);
  if (p.length !== q.length) return p.length < q.length ? -1 : 1;
  if (p !== q) return p < q ? -1 : 1;
  return 0;
}

/* 比两个 App 版本，返回 -1 / 0 / 1。只比前两段（大版本、APP 版本），按数字比，补不补零一样：
 *   3.02 > 3.01，3.01 = 3.1，10.00 > 9.99；段数不够的当 0，认不出的当 0。
 * 老写法（三段，已发布的 3.0.9 / 3.1.0 和装着这些版本的手机）：前两段就是当时的 App 版本，所以
 *   3.1.0 = 3.01（已装 3.1.0 的手机看到 EVCITY-AC_V3.01.apk 不提示），3.0.9 < 3.01，3.02 比它们都新
 *   （新方案的第一个 App 版本就是 3.02：EVCITY-AC_V3.02.apk 传上去以后，装着 3.1.0 的手机会提示，这是预期的）。
 * 第 3 段是老方案的修订号，只在两边都是三段写法时才接着比（3.0.9 > 3.0.8，3.1.0 > 3.0.9）；
 * 一边是两段的新写法时不看它，所以 3.0.9 不会比 3.01 新，新写法的版本也不会被固件段影响。
 * 不转成 Number，位数再多也不丢精度。 */
export function compareVersions(a, b) {
  const x = (versionCore(a) || "0").split(".");
  const y = (versionCore(b) || "0").split(".");
  for (let i = 0; i < 2; i++) {
    const c = cmpDigits(i < x.length ? x[i] : "0", i < y.length ? y[i] : "0");
    if (c) return c;
  }
  if (x.length < 3 || y.length < 3) return 0;
  const n = Math.max(x.length, y.length);
  for (let i = 2; i < n; i++) {
    const c = cmpDigits(i < x.length ? x[i] : "0", i < y.length ? y[i] : "0");
    if (c) return c;
  }
  return 0;
}

/* 文件名里的版本是不是两段的新写法（大版本.APP版本）。 */
function isAppName(version) {
  return version.split(".").length === 2;
}

/* 目录列表 HTML → 名字合规矩的 APK 文件名。子目录（大小一栏是「目录」）和别的文件不要。
 * 和原生用的是同一条规则；页面自己不联网，这里主要给测试和文档对照。 */
export function parseListing(html) {
  const out = [];
  if (typeof html !== "string") return out;
  const row = /<tr>\s*<td>\s*<a\s+href="[^"]*"\s*>([^<]*)<\/a>\s*<\/td>\s*<td\s+class="size"\s*>([^<]*)<\/td>/g;
  let m;
  while ((m = row.exec(html))) {
    const name = m[1].trim();
    if (m[2].trim() === "目录" || !apkVersion(name) || out.indexOf(name) >= 0) continue;
    out.push(name);
  }
  return out;
}

/* 版本最大的那个：{ file, version }；一个合规矩的都没有 → null。
 * 一样大时（老写法 EVCITY-AC_V3.1.0.apk 和新写法 EVCITY-AC_V3.01.apk 是同一个 App 版本）要新写法的。 */
export function latestApk(names) {
  let best = null;
  (Array.isArray(names) ? names : []).forEach((name) => {
    const version = apkVersion(name);
    if (!version) return;
    const c = best ? compareVersions(version, best.version) : 1;
    if (c > 0 || (c === 0 && isAppName(version) && !isAppName(best.version))) best = { file: name, version };
  });
  return best;
}

/* 这个原生壳能做什么："android"（能下载安装）/ "ios"（只能查）/ "none"（老壳子、浏览器）。 */
export function updPlatform(api) {
  if (!api || typeof api.updCheck !== "function") return "none";
  return typeof api.updDownload === "function" ? "android" : "ios";
}

/* 文件夹还不存在：404（410 同样算）。 */
function isGoneStatus(status) {
  const n = typeof status === "string" && /^\d+$/.test(status) ? Number(status) : status;
  return n === 404 || n === 410;
}

/* 原生给的 onCheck 结果过一遍：可以是对象或 JSON 字符串。文件名必须合规矩并且和 latest 对得上，
 * hasNew 这里自己再比一次，不直接信。
 * 文件夹还不存在（原生回 {ok:false, reason:"http", status:404}）不算失败，和空文件夹一样是「没有更新」。 */
export function normalizeCheck(res) {
  let obj = res;
  if (typeof obj === "string") {
    try { obj = JSON.parse(obj); } catch (e) { obj = null; }
  }
  if (obj && typeof obj === "object" && obj.ok === false && obj.reason === "http" && isGoneStatus(obj.status)) {
    return { ok: true, reason: "", latest: "", current: versionCore(obj.current), hasNew: false, file: "" };
  }
  if (!obj || typeof obj !== "object" || obj.ok !== true) {
    const reason = obj && typeof obj.reason === "string" && obj.reason ? obj.reason : "parse";
    return { ok: false, reason, latest: "", current: "", hasNew: false, file: "" };
  }
  const file = typeof obj.file === "string" ? obj.file : "";
  const latest = apkVersion(file);
  const current = versionCore(obj.current);
  if (file && !latest) return { ok: false, reason: "parse", latest: "", current, hasNew: false, file: "" };
  return { ok: true, reason: "", latest, current, hasNew: !!latest && compareVersions(latest, current || "0") > 0, file };
}

export function updNew() {
  return {
    platform: "none",
    phase: "idle",      /* 安装包：idle / checking / prompt / downloading / ready / error / ios
                           热更新：h5-checking / h5-prompt / h5-downloading / h5-applying / h5-staged / h5-error */
    manual: false,      /* 这一次查询是不是用户点出来的 */
    autoDone: false,    /* 这次运行已经自动查过 */
    dismissed: [],      /* 弹过并取消的版本：自动检查不再弹 */
    latest: "", current: "", file: "",
    pct: 0, done: 0, total: 0,
    error: "",          /* phase === "error" 时的原因；"install" 是装的时候出的错 */
    hint: "",           /* phase === "ready"："perm" 去设置页了 / "denied" 回来了但没允许 */
    /* ---- 热更新（第 2 步） ---- */
    h5: false,          /* 这一轮开始时壳有没有热更新（h5Check / h5Download） */
    h5Base: "",         /* 这一页编译时的基座（__H5_BASE__） */
    h5Rev: 0,           /* 这一页编译时的修订号（__H5_REV__） */
    origin: "",         /* 这一轮是 "auto" 还是 "manual"；整轮不变（manual 进了弹窗就清掉，不够用） */
    apkDeclined: false, /* 这一轮刚在安装包提示上点过取消：第 2 步没查成、没有新的都不出声 */
    h5Latest: -1, h5Current: 0, h5File: "", h5Size: 0,
    h5Staged: -1,       /* 磁盘上已经切换好、页面还没重新加载的修订号；没有是 -1 */
    h5Dismissed: [],    /* 弹过并取消的修订号：自动检查不再弹 */
  };
}

const none = (state) => ({ state, effects: [], toast: "" });
function dismiss(state) {
  const dismissed = state.latest && state.dismissed.indexOf(state.latest) < 0
    ? state.dismissed.concat([state.latest]) : state.dismissed;
  return Object.assign({}, state, { phase: "idle", manual: false, dismissed, error: "", hint: "", pct: 0, done: 0, total: 0 });
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/* 进第 2 步：查热更新。declined：是不是从「取消了安装包提示」进来的。 */
function h5Start(state, declined) {
  return {
    state: Object.assign({}, state, { phase: "h5-checking", manual: false, apkDeclined: declined, error: "", hint: "", pct: 0, done: 0, total: 0 }),
    effects: [{ t: "h5check" }], toast: "",
  };
}
function h5Idle(state, extra) {
  return Object.assign({}, state, { phase: "idle", manual: false, error: "", hint: "", pct: 0, done: 0, total: 0 }, extra || null);
}
function h5Dismiss(state) {
  const h5Dismissed = state.h5Latest >= 0 && state.h5Dismissed.indexOf(state.h5Latest) < 0
    ? state.h5Dismissed.concat([state.h5Latest]) : state.h5Dismissed;
  return h5Idle(state, { h5Dismissed });
}
/* 磁盘上已经是新界面，只差重新加载：按当时连没连着桩决定怎么收尾（方案 7.5）。 */
function h5Finish(state, link, auto) {
  if (link === "busy") return { state: h5Idle(state), effects: [], toast: H5_TOAST_STAGED };
  if (link === "linked" || !auto) return none(Object.assign({}, state, { phase: "h5-staged", manual: false, error: "", hint: "" }));
  return { state: Object.assign({}, state, { phase: "h5-applying", manual: false, error: "", hint: "" }), effects: [{ t: "h5apply" }], toast: "" };
}

/* 状态机。ev：
 *   {t:"auto", platform} {t:"manual", platform}     开始查（platform 是 updPlatform 的结果）
 *   {t:"check", res} {t:"timeout"}                    原生的 onCheck / 等太久
 *   {t:"accept"} {t:"cancel"} {t:"retry"} {t:"install-tap"}   弹窗上的按钮
 *   {t:"progress", pct, done, total} {t:"done"} {t:"error", reason} {t:"install", s}   原生的回调
 * 热更新多出来的（auto / manual 另带 h5、h5Base、h5Rev：壳有没有热更新、这一页的基座和修订号）：
 *   {t:"ack"}                                         iOS 安装包提示上的「知道了」（壳有热更新时）
 *   {t:"h5check", res, link} {t:"h5timeout"}          window.__evcH5.onCheck / 等太久
 *   {t:"h5progress", pct, done, total} {t:"h5done", rev, link} {t:"h5error", reason}   原生的回调
 *   {t:"apply", link} {t:"later"}                     「已准备好」窗口上的「立即切换」「下次生效」
 *   link 是当时的 "free" / "linked" / "busy"（createUpdater 从 opts.linkState() 取了带上）。
 * 返回 { state, effects, toast }。effects：{t:"check"} {t:"download", file} {t:"cancel"} {t:"install"}
 * {t:"h5check"} {t:"h5download", file} {t:"h5cancel"} {t:"h5apply"}，
 * 由 createUpdater 去调 window.EVC；toast 是要轻提示的句子（中文键），没有是 ""。 */
export function updStep(state, ev) {
  const type = ev && ev.t;
  if (type === "auto" || type === "manual") {
    const platform = ev.platform === "android" || ev.platform === "ios" ? ev.platform : "none";
    const manual = type === "manual";
    if (platform === "none") return none(manual ? state : Object.assign({}, state, { autoDone: true }));
    /* 这一轮的底子：壳有没有热更新、这一页是哪个基座的第几版。一轮开始时定下来，中途不变。 */
    const round = {
      platform, h5: ev.h5 === true, h5Base: typeof ev.h5Base === "string" ? ev.h5Base : "",
      h5Rev: cleanRev(ev.h5Rev) < 0 ? 0 : ev.h5Rev, apkDeclined: false,
    };
    if (!manual) {
      if (state.autoDone || state.phase !== "idle") return none(Object.assign({}, state, { autoDone: true }));
      return { state: Object.assign({}, state, round, { phase: "checking", manual: false, origin: "auto", autoDone: true }), effects: [{ t: "check" }], toast: "" };
    }
    if (state.phase === "idle") {
      return { state: Object.assign({}, state, round, { phase: "checking", manual: true, origin: "manual" }), effects: [{ t: "check" }], toast: "正在检查更新" };
    }
    /* 自动检查还在路上：不重发，只把这一次改成「用户在等结果」。 */
    if (state.phase === "checking") return { state: Object.assign({}, state, { manual: true, origin: "manual" }), effects: [], toast: "正在检查更新" };
    if (state.phase === "h5-checking") {
      return { state: Object.assign({}, state, { origin: "manual" }), effects: [], toast: state.apkDeclined ? "" : "正在检查更新" };
    }
    return none(state);     /* 弹窗开着：不理 */
  }
  if (type === "check" || type === "timeout") {
    if (state.phase !== "checking") return none(state);
    const res = type === "timeout" ? normalizeCheck({ ok: false, reason: "timeout" }) : normalizeCheck(ev.res);
    const idle = Object.assign({}, state, { phase: "idle", manual: false });
    /* 没查成：到此结束，不查热更新。 */
    if (!res.ok) return { state: idle, effects: [], toast: state.manual ? "检查更新失败，请检查网络" : "" };
    if (!res.hasNew) {
      /* 没有新安装包：壳有热更新就进第 2 步，手动检查的「已是最新版本」等第 2 步的结果。 */
      if (state.h5) return h5Start(state, false);
      return { state: idle, effects: [], toast: state.manual ? "已是最新版本" : "" };
    }
    if (!state.manual && state.dismissed.indexOf(res.latest) >= 0) {
      /* 这个安装包版本这次运行里已经取消过：不再弹，直接进第 2 步。 */
      return state.h5 ? h5Start(state, true) : none(idle);
    }
    return none(Object.assign({}, state, {
      phase: state.platform === "android" ? "prompt" : "ios", manual: false,
      latest: res.latest, current: res.current, file: res.file, pct: 0, done: 0, total: 0, error: "", hint: "",
    }));
  }
  if (type === "cancel") {
    if (state.phase === "downloading") return { state: dismiss(state), effects: [{ t: "cancel" }], toast: "" };
    /* 在安装包提示上取消：壳有热更新就进第 2 步。已经接受过（下载中、下完、出错）再取消的不进。 */
    if (state.phase === "prompt" || state.phase === "ios") return state.h5 ? h5Start(dismiss(state), true) : none(dismiss(state));
    if (state.phase === "ready" || state.phase === "error") return none(dismiss(state));
    if (state.phase === "h5-downloading") return { state: h5Dismiss(state), effects: [{ t: "h5cancel" }], toast: "" };
    if (state.phase === "h5-prompt" || state.phase === "h5-error") return none(h5Dismiss(state));
    if (state.phase === "h5-staged") return none(h5Idle(state));
    return none(state);
  }
  /* iOS 安装包提示上的「知道了」（壳有热更新时和「取消」分开）：接受，这一轮不查热更新。 */
  if (type === "ack") {
    if (state.phase !== "ios") return none(state);
    return none(dismiss(state));
  }
  const h5Download = () => {
    if (!state.h5 || !parseH5Name(state.h5File)) return none(state);
    return {
      state: Object.assign({}, state, { phase: "h5-downloading", pct: 0, done: 0, total: 0, error: "", hint: "" }),
      effects: [{ t: "h5download", file: state.h5File }], toast: "",
    };
  };
  if (type === "h5check" || type === "h5timeout") {
    if (state.phase === "h5-applying" && type === "h5timeout") {
      /* 「正在校验并解压」等太久：磁盘上已经切换好就收掉窗口、下次打开生效；还没有就按失败算。 */
      if (state.h5Staged >= 0 && state.h5Staged === state.h5Latest) return { state: h5Idle(state), effects: [], toast: H5_TOAST_STAGED };
      return none(Object.assign({}, state, { phase: "h5-error", error: "offline" }));
    }
    if (state.phase !== "h5-checking") return none(state);
    const res = type === "h5timeout" ? normalizeH5Check({ ok: false, reason: "timeout" }, state.h5Base, state.h5Rev)
      : normalizeH5Check(ev.res, state.h5Base, state.h5Rev);
    const manual = state.origin === "manual";
    /* 出不出声：只有手动检查、并且第 1 步是「没有新安装包」。 */
    const loud = manual && !state.apkDeclined;
    if (!res.ok) return { state: h5Idle(state), effects: [], toast: loud ? "检查更新失败，请检查网络" : "" };
    if (!res.hasNew) {
      /* 磁盘上已经切换好、只差重新加载：手动检查直接回到「已准备好」，不重新下载。 */
      if (res.staged >= 0 && manual) return h5Finish(Object.assign({}, state, { h5Staged: res.staged, h5Latest: res.staged }), ev.link, false);
      return { state: h5Idle(state, { h5Staged: res.staged }), effects: [], toast: loud ? "已是最新版本" : "" };
    }
    if (!manual && state.h5Dismissed.indexOf(res.latest) >= 0) return none(h5Idle(state, { h5Staged: res.staged }));
    return none(Object.assign({}, state, {
      phase: "h5-prompt", manual: false, h5Latest: res.latest, h5Current: res.current, h5File: res.file, h5Size: res.size,
      h5Staged: res.staged, pct: 0, done: 0, total: 0, error: "", hint: "",
    }));
  }
  if (type === "h5progress") {
    if (state.phase !== "h5-downloading") return none(state);
    const pct = Math.max(0, Math.min(100, Math.floor(num(ev.pct))));
    /* 下完了：原生接着核对 SHA-256、解压、切换，这一段没有按钮。 */
    return none(Object.assign({}, state, { phase: pct >= 100 ? "h5-applying" : "h5-downloading", pct, done: num(ev.done), total: num(ev.total) }));
  }
  if (type === "h5done") {
    if (state.phase !== "h5-downloading" && state.phase !== "h5-applying") return none(state);
    const rev = cleanRev(ev.rev) >= 0 ? ev.rev : state.h5Latest;
    return h5Finish(Object.assign({}, state, { pct: 100, h5Staged: rev, h5Latest: rev }), ev.link, true);
  }
  if (type === "h5error") {
    if ((state.phase !== "h5-downloading" && state.phase !== "h5-applying") || ev.reason === "cancel") return none(state);
    return none(Object.assign({}, state, { phase: "h5-error", error: typeof ev.reason === "string" && ev.reason ? ev.reason : "offline" }));
  }
  if (type === "apply") {
    if (state.phase !== "h5-staged") return none(state);
    /* 正在发固件：不允许立即切换。 */
    if (ev.link === "busy") return { state: h5Idle(state), effects: [], toast: H5_TOAST_STAGED };
    return { state: Object.assign({}, state, { phase: "h5-applying" }), effects: [{ t: "h5apply" }], toast: "" };
  }
  if (type === "later") {
    if (state.phase !== "h5-staged") return none(state);
    return none(h5Idle(state));
  }
  const download = () => ({
    state: Object.assign({}, state, { phase: "downloading", pct: 0, done: 0, total: 0, error: "", hint: "" }),
    effects: [{ t: "download", file: state.file }], toast: "",
  });
  if (type === "accept") {
    if (state.phase === "h5-prompt") return h5Download();
    /* iOS 没有下载这条路：就算有人发了 accept 也不动。 */
    if (state.phase !== "prompt" || state.platform !== "android" || !apkVersion(state.file)) return none(state);
    return download();
  }
  if (type === "retry") {
    if (state.phase === "h5-error") return h5Download();
    if (state.phase !== "error" || state.platform !== "android") return none(state);
    if (state.error === "install") return { state: Object.assign({}, state, { phase: "ready", error: "", hint: "" }), effects: [{ t: "install" }], toast: "" };
    return download();
  }
  if (type === "progress") {
    if (state.phase !== "downloading") return none(state);
    const pct = Math.max(0, Math.min(100, Math.floor(num(ev.pct))));
    return none(Object.assign({}, state, { pct, done: num(ev.done), total: num(ev.total) }));
  }
  if (type === "done") {
    if (state.phase !== "downloading") return none(state);
    return { state: Object.assign({}, state, { phase: "ready", pct: 100, hint: "" }), effects: [{ t: "install" }], toast: "" };
  }
  if (type === "error") {
    if (state.phase !== "downloading" || ev.reason === "cancel") return none(state);
    return none(Object.assign({}, state, { phase: "error", error: typeof ev.reason === "string" && ev.reason ? ev.reason : "offline" }));
  }
  if (type === "install-tap") {
    if (state.phase !== "ready") return none(state);
    return { state: Object.assign({}, state, { hint: "" }), effects: [{ t: "install" }], toast: "" };
  }
  if (type === "install") {
    if (state.phase !== "ready") return none(state);
    if (ev.s === "perm" || ev.s === "denied") return none(Object.assign({}, state, { hint: ev.s }));
    if (ev.s === "started") return none(Object.assign({}, state, { hint: "" }));
    return none(Object.assign({}, state, { phase: "error", error: "install", hint: "" }));
  }
  return none(state);
}

/* 出错原因 → 给人看的句子（中文键）。 */
export function updErrorText(reason) {
  if (reason === "install") return "无法打开安装程序，请重试";
  if (reason === "size" || reason === "badapk" || reason === "badfile") return "安装包校验失败，请重试";
  return "下载失败，请检查网络后重试";
}

const vLabel = (version) => (version ? "V" + version : "—");

/* 字节 → "4.2"（MB，一位小数）。 */
export function fmtMB(bytes) {
  return (num(bytes) / 1048576).toFixed(1);
}

/* 弹窗上显示什么。buttons 的 id 就是发给 updStep 的事件名；title 是窗口的标题（中文键）。
 * link：现在的 "free" / "linked" / "busy"，只有热更新「已准备好」的窗口看它。 */
export function updView(state, link) {
  const title = "软件更新";
  const closed = { open: false, title: "", text: "", vars: null, hint: "", progress: false, buttons: [] };
  const h5 = h5View(state, link);
  if (h5) return h5;
  switch (state.phase) {
    case "prompt":
      return {
        open: true, title, text: "发现新版本 {v}（当前 {c}），是否下载并安装？", vars: { v: vLabel(state.latest), c: vLabel(state.current) },
        hint: "", progress: false,
        buttons: [{ id: "cancel", label: "取消" }, { id: "accept", label: "下载安装", primary: true }],
      };
    case "downloading":
      return {
        open: true, title, text: "正在下载 {v}", vars: { v: vLabel(state.latest) }, hint: "", progress: true,
        buttons: [{ id: "cancel", label: "取消下载" }],
      };
    case "ready":
      return {
        open: true, title, text: "下载完成，正在打开安装程序", vars: null, progress: false,
        hint: state.hint === "perm" ? "请在设置里允许本应用安装未知应用，返回后会自动继续安装。"
          : state.hint === "denied" ? "还没有允许安装未知应用，请允许后再点「安装」。" : "",
        buttons: [{ id: "cancel", label: "取消" }, { id: "install-tap", label: "安装", primary: true }],
      };
    case "error":
      return {
        open: true, title, text: updErrorText(state.error), vars: null, hint: "", progress: false,
        buttons: [{ id: "cancel", label: "取消" }, { id: "retry", label: "重试", primary: true }],
      };
    case "ios":
      return {
        open: true, title, text: "有软件更新，请前往 App Store 更新", vars: null, hint: "", progress: false,
        /* 壳有热更新：「取消」进热更新检查，「知道了」是接受（不查热更新）。没有热更新：还是一个「知道了」。 */
        buttons: state.h5 ? [{ id: "cancel", label: "取消" }, { id: "ack", label: "知道了", primary: true }]
          : [{ id: "cancel", label: "知道了", primary: true }],
      };
    default:
      return closed;
  }
}

/* 界面上用到的全部句子（中文键）。packs-update.js 给每种语言都配齐，测试核对。 */
export const UPDATE_TEXTS = [
  "软件更新",
  "发现新版本 {v}（当前 {c}），是否下载并安装？",
  "取消",
  "下载安装",
  "正在下载 {v}",
  "取消下载",
  "下载完成，正在打开安装程序",
  "请在设置里允许本应用安装未知应用，返回后会自动继续安装。",
  "还没有允许安装未知应用，请允许后再点「安装」。",
  "安装",
  "下载失败，请检查网络后重试",
  "安装包校验失败，请重试",
  "无法打开安装程序，请重试",
  "重试",
  "有软件更新，请前往 App Store 更新",
  "知道了",
  "正在检查更新",
  "已是最新版本",
  "检查更新失败，请检查网络",
  "检查更新",
];

/* 把状态机接到 window.EVC 和 window.__evcUpd 上。
 *   opts.api()       现在的 window.EVC（每次现取：老壳子没有 updCheck）
 *   opts.win         挂 __evcUpd 的对象（window）
 *   opts.onState(s)  状态变了
 *   opts.onToast(k)  要轻提示一句
 *   opts.setTimeout / clearTimeout   可以换成假的
 *   opts.linkState() 现在是 "free"（没连着桩）/ "linked"（连着）/ "busy"（正在发固件、下发一键配置）；没给当 "free"
 *   opts.h5Base / opts.h5Rev   这一页编译时的基座和修订号（__H5_BASE__ / __H5_REV__）
 * 热更新的回调挂在 opts.win.__evcH5 上（onCheck / onProgress / onDone / onError）。
 * 返回 { auto(), manual(), act(id), state() }。 */
export function createUpdater(opts) {
  const later = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const unlater = opts.clearTimeout || ((id) => clearTimeout(id));
  let state = updNew();
  let watchdog = null;
  let applyTimer = null;
  const api = () => {
    try { return opts.api ? opts.api() : null; } catch (e) { return null; }
  };
  const link = () => {
    let now = "free";
    try { if (opts.linkState) now = opts.linkState(); } catch (e) { now = "free"; }
    return now === "linked" || now === "busy" ? now : "free";
  };
  function stopWatchdog() {
    if (watchdog !== null) { unlater(watchdog); watchdog = null; }
  }
  function stopApplyTimer() {
    if (applyTimer !== null) { unlater(applyTimer); applyTimer = null; }
  }
  function run(fx) {
    const evc = api();
    try {
      if (fx.t === "check") {
        stopWatchdog();
        watchdog = later(() => { watchdog = null; apply({ t: "timeout" }); }, CHECK_WATCHDOG_MS);
        evc.updCheck();
      } else if (fx.t === "download") evc.updDownload(fx.file);
      else if (fx.t === "cancel") evc.updCancel();
      else if (fx.t === "install") evc.updInstall();
      else if (fx.t === "h5check") {
        stopWatchdog();
        watchdog = later(() => { watchdog = null; apply({ t: "h5timeout" }); }, H5_CHECK_WATCHDOG_MS);
        evc.h5Check();
      } else if (fx.t === "h5download") evc.h5Download(fx.file);
      else if (fx.t === "h5cancel") evc.h5Cancel();
      else if (fx.t === "h5apply") evc.h5Apply();
    } catch (e) {
      if (fx.t === "check") { stopWatchdog(); apply({ t: "check", res: { ok: false, reason: "bridge" } }); }
      else if (fx.t === "download") apply({ t: "error", reason: "offline" });
      else if (fx.t === "install") apply({ t: "install", s: "fail" });
      else if (fx.t === "h5check") { stopWatchdog(); apply({ t: "h5check", res: { ok: false, reason: "bridge" }, link: link() }); }
      else if (fx.t === "h5download") apply({ t: "h5error", reason: "bridge" });
      else if (fx.t === "h5apply") apply({ t: "h5timeout" });
    }
  }
  function apply(ev) {
    const out = updStep(state, ev);
    const changed = out.state !== state;
    state = out.state;
    if (changed && opts.onState) opts.onState(state);
    if (out.toast && opts.onToast) opts.onToast(out.toast);
    /* 「正在校验并解压」没有按钮：原生一直不回就自己收掉。 */
    if (state.phase !== "h5-applying") stopApplyTimer();
    else if (applyTimer === null) applyTimer = later(() => { applyTimer = null; apply({ t: "h5timeout" }); }, H5_APPLY_WATCHDOG_MS);
    out.effects.forEach(run);
  }
  if (opts.win) {
    opts.win.__evcUpd = {
      onCheck(res) { stopWatchdog(); apply({ t: "check", res }); },
      onProgress(pct, done, total) { apply({ t: "progress", pct, done, total }); },
      onDone() { apply({ t: "done" }); },
      onError(reason) { apply({ t: "error", reason }); },
      onInstall(s) { apply({ t: "install", s }); },
    };
    opts.win.__evcH5 = {
      onCheck(res) { stopWatchdog(); apply({ t: "h5check", res, link: link() }); },
      onProgress(pct, done, total) { apply({ t: "h5progress", pct, done, total }); },
      onDone(rev) { apply({ t: "h5done", rev, link: link() }); },
      onError(reason) { apply({ t: "h5error", reason }); },
    };
  }
  const start = (t) => {
    const evc = api();
    apply({ t, platform: updPlatform(evc), h5: h5Platform(evc), h5Base: opts.h5Base, h5Rev: opts.h5Rev });
  };
  return {
    auto() { start("auto"); },
    manual() { start("manual"); },
    act(id) { apply({ t: id, link: link() }); },
    state: () => state,
    link,
    stop() { stopWatchdog(); stopApplyTimer(); },
  };
}
