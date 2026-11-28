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
 * 这个文件里的规则都是纯函数（updStep 是状态机），test/app-update.test.mjs 不用手机就能测。 */

export const APK_NAME_RE = /^EVCITY-AC_V(\d+(?:\.\d+)*)\.apk$/;
export const AUTO_DELAY_MS = 2000;
/* 原生的查询超时是 8 秒；过了这么久还没有 onCheck 就按失败算，免得一直停在「正在检查」。 */
export const CHECK_WATCHDOG_MS = 15000;

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
    phase: "idle",      /* idle / checking / prompt / downloading / ready / error / ios */
    manual: false,      /* 这一次查询是不是用户点出来的 */
    autoDone: false,    /* 这次运行已经自动查过 */
    dismissed: [],      /* 弹过并取消的版本：自动检查不再弹 */
    latest: "", current: "", file: "",
    pct: 0, done: 0, total: 0,
    error: "",          /* phase === "error" 时的原因；"install" 是装的时候出的错 */
    hint: "",           /* phase === "ready"："perm" 去设置页了 / "denied" 回来了但没允许 */
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

/* 状态机。ev：
 *   {t:"auto", platform} {t:"manual", platform}     开始查（platform 是 updPlatform 的结果）
 *   {t:"check", res} {t:"timeout"}                    原生的 onCheck / 等太久
 *   {t:"accept"} {t:"cancel"} {t:"retry"} {t:"install-tap"}   弹窗上的按钮
 *   {t:"progress", pct, done, total} {t:"done"} {t:"error", reason} {t:"install", s}   原生的回调
 * 返回 { state, effects, toast }。effects：{t:"check"} {t:"download", file} {t:"cancel"} {t:"install"}，
 * 由 createUpdater 去调 window.EVC；toast 是要轻提示的句子（中文键），没有是 ""。 */
export function updStep(state, ev) {
  const type = ev && ev.t;
  if (type === "auto" || type === "manual") {
    const platform = ev.platform === "android" || ev.platform === "ios" ? ev.platform : "none";
    const manual = type === "manual";
    if (platform === "none") return none(manual ? state : Object.assign({}, state, { autoDone: true }));
    if (!manual) {
      if (state.autoDone || state.phase !== "idle") return none(Object.assign({}, state, { autoDone: true }));
      return { state: Object.assign({}, state, { platform, phase: "checking", manual: false, autoDone: true }), effects: [{ t: "check" }], toast: "" };
    }
    if (state.phase === "idle") {
      return { state: Object.assign({}, state, { platform, phase: "checking", manual: true }), effects: [{ t: "check" }], toast: "正在检查更新" };
    }
    /* 自动检查还在路上：不重发，只把这一次改成「用户在等结果」。 */
    if (state.phase === "checking") return { state: Object.assign({}, state, { manual: true }), effects: [], toast: "正在检查更新" };
    return none(state);     /* 弹窗开着：不理 */
  }
  if (type === "check" || type === "timeout") {
    if (state.phase !== "checking") return none(state);
    const res = type === "timeout" ? normalizeCheck({ ok: false, reason: "timeout" }) : normalizeCheck(ev.res);
    const idle = Object.assign({}, state, { phase: "idle", manual: false });
    if (!res.ok) return { state: idle, effects: [], toast: state.manual ? "检查更新失败，请检查网络" : "" };
    if (!res.hasNew) return { state: idle, effects: [], toast: state.manual ? "已是最新版本" : "" };
    if (!state.manual && state.dismissed.indexOf(res.latest) >= 0) return none(idle);
    return none(Object.assign({}, state, {
      phase: state.platform === "android" ? "prompt" : "ios", manual: false,
      latest: res.latest, current: res.current, file: res.file, pct: 0, done: 0, total: 0, error: "", hint: "",
    }));
  }
  if (type === "cancel") {
    if (state.phase === "downloading") return { state: dismiss(state), effects: [{ t: "cancel" }], toast: "" };
    if (state.phase === "prompt" || state.phase === "ios" || state.phase === "ready" || state.phase === "error") return none(dismiss(state));
    return none(state);
  }
  const download = () => ({
    state: Object.assign({}, state, { phase: "downloading", pct: 0, done: 0, total: 0, error: "", hint: "" }),
    effects: [{ t: "download", file: state.file }], toast: "",
  });
  if (type === "accept") {
    /* iOS 没有下载这条路：就算有人发了 accept 也不动。 */
    if (state.phase !== "prompt" || state.platform !== "android" || !apkVersion(state.file)) return none(state);
    return download();
  }
  if (type === "retry") {
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

/* 弹窗上显示什么。buttons 的 id 就是发给 updStep 的事件名。 */
export function updView(state) {
  const closed = { open: false, text: "", vars: null, hint: "", progress: false, buttons: [] };
  switch (state.phase) {
    case "prompt":
      return {
        open: true, text: "发现新版本 {v}（当前 {c}），是否下载并安装？", vars: { v: vLabel(state.latest), c: vLabel(state.current) },
        hint: "", progress: false,
        buttons: [{ id: "cancel", label: "取消" }, { id: "accept", label: "下载安装", primary: true }],
      };
    case "downloading":
      return {
        open: true, text: "正在下载 {v}", vars: { v: vLabel(state.latest) }, hint: "", progress: true,
        buttons: [{ id: "cancel", label: "取消下载" }],
      };
    case "ready":
      return {
        open: true, text: "下载完成，正在打开安装程序", vars: null, progress: false,
        hint: state.hint === "perm" ? "请在设置里允许本应用安装未知应用，返回后会自动继续安装。"
          : state.hint === "denied" ? "还没有允许安装未知应用，请允许后再点「安装」。" : "",
        buttons: [{ id: "cancel", label: "取消" }, { id: "install-tap", label: "安装", primary: true }],
      };
    case "error":
      return {
        open: true, text: updErrorText(state.error), vars: null, hint: "", progress: false,
        buttons: [{ id: "cancel", label: "取消" }, { id: "retry", label: "重试", primary: true }],
      };
    case "ios":
      return {
        open: true, text: "有软件更新，请前往 App Store 更新", vars: null, hint: "", progress: false,
        buttons: [{ id: "cancel", label: "知道了", primary: true }],
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
 * 返回 { auto(), manual(), act(id), state() }。 */
export function createUpdater(opts) {
  const later = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const unlater = opts.clearTimeout || ((id) => clearTimeout(id));
  let state = updNew();
  let watchdog = null;
  const api = () => {
    try { return opts.api ? opts.api() : null; } catch (e) { return null; }
  };
  function stopWatchdog() {
    if (watchdog !== null) { unlater(watchdog); watchdog = null; }
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
    } catch (e) {
      if (fx.t === "check") { stopWatchdog(); apply({ t: "check", res: { ok: false, reason: "bridge" } }); }
      else if (fx.t === "download") apply({ t: "error", reason: "offline" });
      else if (fx.t === "install") apply({ t: "install", s: "fail" });
    }
  }
  function apply(ev) {
    const out = updStep(state, ev);
    const changed = out.state !== state;
    state = out.state;
    if (changed && opts.onState) opts.onState(state);
    if (out.toast && opts.onToast) opts.onToast(out.toast);
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
  }
  return {
    auto() { apply({ t: "auto", platform: updPlatform(api()) }); },
    manual() { apply({ t: "manual", platform: updPlatform(api()) }); },
    act(id) { apply({ t: id }); },
    state: () => state,
    stop() { stopWatchdog(); },
  };
}
