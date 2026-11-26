/* 设置页「保存」按钮的状态机：保存的结果只写在按钮上，不再写到页面上面的提示里。
 *
 *   idle     平时，按钮上是「保存」（或那一页自己的字，比如时区那一格的 UTC+08:00）
 *   busy     点了保存，等充电桩应答：「保存中…」
 *   ok       「保存成功」（绿）
 *   restart  「保存成功，重启生效」（绿）
 *   fail     「保存失败」或「保存失败：<短原因>」（红）
 *
 * ok / restart / fail 显示 SAVE_SHOW_MS（2.5 秒）后自己回到 idle。busy 和显示结果期间按钮
 * 不可点（begin() 返回 false）。busy 有看门狗：SAVE_BUSY_MS 内没有人报结果就按「充电桩没有
 * 应答」算失败，不会一直停在「保存中…」。
 *
 * 短原因（why）写在按钮上，长了截断；完整的说明（detail，翻译的键或 { text, vars }）写在按钮
 * 下面紧挨着的一行小字里。那一行留到下一次点保存或离开这一页（reset），所以按钮变回「保存」
 * 以后长原因还看得到。成功时也可以带一行说明（比如「4G 模块会重新启动」）。
 *
 * 这个文件不依赖 Vue，也不直接用全局定时器（可以注入 setTimer / clearTimer），node 里能单测。
 * m01/save-btn.js 是同一份（test/save-btn.test.mjs 核对两份一样）。
 *
 *   const btns = createSaveBtns({ onChange(id, state), onDone(id, kind) });
 *   if (!btns.begin("cfg")) return;          // 正在保存或正在显示结果：这一下不算
 *   btns.fail("cfg", "电压范围不对", "没有保存。过压不超过 320 V…");
 *   btns.ok("cfg");  btns.restart("cfg", detail);  btns.silent("cfg");
 *   btns.reset("cfg");  btns.resetAll();  btns.dispose();     // 切页 / 组件卸载 */

export const SAVE_SHOW_MS = 2500;     /* 结果在按钮上停多久 */
export const SAVE_BUSY_MS = 6000;     /* 「保存中…」最多等多久 */
export const SAVE_REASON_MAX = 24;    /* 按钮上的短原因最多几个字（翻译以后的） */
export const SAVE_SILENT = "充电桩没有应答";
export const SAVE_TEXT = {
  idle: "保存",
  busy: "保存中…",
  ok: "保存成功",
  restart: "保存成功，重启生效",
  fail: "保存失败",
  failWhy: "保存失败：{why}",
};
export const SAVE_KINDS = ["idle", "busy", "ok", "restart", "fail"];

function freeze(kind, why, detail, tone) {
  return Object.freeze({ kind, why: why || "", detail: detail || null, tone: tone || "" });
}
export const SAVE_IDLE = freeze("idle", "", null, "");

/* 说明可以是一句（翻译的键）或 { text, vars }；空的算没有。 */
export function saveDetail(detail) {
  if (!detail) return null;
  if (typeof detail === "string") return { text: detail, vars: null };
  if (typeof detail === "object" && detail.text) return { text: String(detail.text), vars: detail.vars || null };
  return null;
}

/* 按钮上的短原因：去掉首尾空白和句末标点，超过 max 个字截断加 …。 */
export function shortReason(text, max) {
  const limit = max > 0 ? max : SAVE_REASON_MAX;
  const chars = Array.from(String(text == null ? "" : text).trim().replace(/[。.．！!\s]+$/u, ""));
  if (chars.length <= limit) return chars.join("");
  return chars.slice(0, limit - 1).join("").replace(/\s+$/u, "") + "…";
}

/* 按钮不可点：正在保存，或者正在显示结果。 */
export function saveLocked(state) {
  return !!state && state.kind !== "idle";
}

/* 按钮的样式名：idle 没有，其余 save-busy / save-ok / save-restart / save-fail。 */
export function saveClass(state) {
  return saveLocked(state) ? "save-" + state.kind : "";
}

/* 按钮上的字。idleText 是平时的字（已经翻译好的）；t 是翻译函数；brief 为真时失败不带原因
 *（时区那种一格很窄的按钮）。 */
export function saveLabel(state, idleText, t, brief) {
  const tr = typeof t === "function" ? t : (text) => text;
  const kind = state ? state.kind : "idle";
  if (kind === "busy") return tr(SAVE_TEXT.busy);
  if (kind === "ok") return tr(SAVE_TEXT.ok);
  if (kind === "restart") return tr(SAVE_TEXT.restart);
  if (kind === "fail") {
    const why = brief || !state.why ? "" : shortReason(tr(state.why));
    return why ? tr(SAVE_TEXT.failWhy, { why }) : tr(SAVE_TEXT.fail);
  }
  return idleText == null ? "" : idleText;
}

/* 一个按钮。opts：setTimer(fn, ms) → 句柄、clearTimer(句柄)、showMs、busyMs、
 * onChange(state)、onDone(kind)（结果显示完、回到 idle 时调一次；reset / dispose 不调）。 */
export function createSaveBtn(opts) {
  const o = opts || {};
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((handle) => clearTimeout(handle));
  const showMs = o.showMs > 0 ? o.showMs : SAVE_SHOW_MS;
  const busyMs = o.busyMs === 0 || o.busyMs > 0 ? o.busyMs : SAVE_BUSY_MS;
  let state = SAVE_IDLE;
  let timer = null;
  let armed = false;
  let dead = false;

  function emit() {
    if (!dead && o.onChange) o.onChange(state);
  }
  function disarm() {
    if (armed) clearTimer(timer);
    armed = false;
    timer = null;
  }
  function arm(ms, fn) {
    disarm();
    armed = true;
    timer = setTimer(() => {
      armed = false;
      timer = null;
      if (!dead) fn();
    }, ms);
  }
  function finish(kind, why, detail) {
    if (dead || state.kind !== "busy") return false;
    state = freeze(kind, why, saveDetail(detail), kind === "fail" ? "bad" : "info");
    arm(showMs, () => {
      const done = state.kind;
      state = freeze("idle", "", state.detail, state.tone);
      emit();
      if (o.onDone) o.onDone(done);
    });
    emit();
    return true;
  }
  return {
    get state() { return state; },
    get locked() { return saveLocked(state); },
    /* 点了保存。ms：这一次的看门狗（0 = 不要）；不给就用 busyMs。 */
    begin(ms) {
      if (dead || state.kind !== "idle") return false;
      state = freeze("busy", "", null, "");
      const wait = ms === 0 || ms > 0 ? ms : busyMs;
      if (wait > 0) arm(wait, () => finish("fail", SAVE_SILENT, null));
      else disarm();
      emit();
      return true;
    },
    ok(detail) { return finish("ok", "", detail); },
    restart(detail) { return finish("restart", "", detail); },
    fail(why, detail) { return finish("fail", why, detail); },
    silent(detail) { return finish("fail", SAVE_SILENT, detail); },
    /* 离开这一页、换了一台桩：回到「保存」，下面那行说明也清掉。 */
    reset() {
      disarm();
      if (dead || state === SAVE_IDLE) return;
      state = SAVE_IDLE;
      emit();
    },
    dispose() {
      disarm();
      dead = true;
      state = SAVE_IDLE;
    },
  };
}

/* 一页上的全部按钮，按名字取。onChange(id, state)、onDone(id, kind)；其余同 createSaveBtn。 */
export function createSaveBtns(opts) {
  const o = opts || {};
  const all = {};
  let dead = false;
  function get(id) {
    if (!all[id]) {
      all[id] = createSaveBtn({
        setTimer: o.setTimer,
        clearTimer: o.clearTimer,
        showMs: o.showMs,
        busyMs: o.busyMs,
        onChange: (state) => { if (o.onChange) o.onChange(id, state); },
        onDone: (kind) => { if (o.onDone) o.onDone(id, kind); },
      });
      if (dead) all[id].dispose();
    }
    return all[id];
  }
  return {
    get,
    state: (id) => (all[id] ? all[id].state : SAVE_IDLE),
    locked: (id) => !!all[id] && all[id].locked,
    begin: (id, ms) => get(id).begin(ms),
    ok: (id, detail) => get(id).ok(detail),
    restart: (id, detail) => get(id).restart(detail),
    fail: (id, why, detail) => get(id).fail(why, detail),
    silent: (id, detail) => get(id).silent(detail),
    reset: (id) => { if (all[id]) all[id].reset(); },
    resetAll: () => { Object.keys(all).forEach((id) => all[id].reset()); },
    dispose: () => {
      dead = true;
      Object.keys(all).forEach((id) => all[id].dispose());
    },
    ids: () => Object.keys(all),
  };
}
