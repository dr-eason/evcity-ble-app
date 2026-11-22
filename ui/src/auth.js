/* 蓝牙鉴权应答（固件 2.7.2 起，规则见 AC06/app/src/wb2.c 的 ble_handle_command() 前面）。
 *
 * 固件 2.7.2 每条蓝牙连接要先 AUTH 通过才收命令。和鉴权有关的应答一共四种：
 *
 *   ACK AUTH OK              密码对，这条连接从此放行
 *   ACK AUTH FAIL            密码不对，还没到锁定
 *   ACK AUTH LOCKED <秒>     连续输错 5 次，锁 60 秒；<秒> 是还要等多久。锁着的时候
 *                            输对了也是这一行。早期的 2.7.2 固件不带秒数
 *   ACK <命令名> AUTH        这条连接还没通过 AUTH，这条命令没有执行
 *
 * 最后一种在两种时候出现：手机没断开、桩这边走了一次蓝牙恢复流程（心跳丢了几秒），
 * 或者模组悄悄换了一条连接。桩把鉴权作废了，App 还以为通过着，发的下一条命令就收到
 * "ACK SCHEDGET AUTH" 这样的行。
 *
 * 2.7.1 的 App 是按“行里有 AUTH 三个字母、又没有 OK”来认密码不对的，所以把后两种都
 * 当成了密码不对：回到输密码那一页，还把记住的密码删掉。现在按整行的格式分开认：
 *   - ACK <命令名> AUTH：用这次连接里通过的（或者记住的）密码悄悄重发一次 AUTH，
 *     通过后把被拒的命令补发，界面不动；
 *   - ACK AUTH LOCKED：显示已锁定和剩余时间，记住的密码不删。
 *
 * 这个文件不碰界面和蓝牙，主机测试 ui/test/auth.test.mjs 直接用。 */

/* 固件锁定的时长（BLE_AUTH_LOCK_MS）。应答里没带秒数时界面上不倒计时，只说“稍后再试”。 */
export const AUTH_LOCK_SECONDS = 60;
/* 一条连接上最多悄悄重发几次 AUTH。再被拒就回到输密码那一页，不来回刷。 */
export const AUTH_REAUTH_MAX = 2;
/* 重新通过后最多补发几条被拒的命令。 */
export const AUTH_RESEND_MAX = 8;

export function pinOk(pin) {
  return /^\d{6}$/.test(String(pin == null ? "" : pin));
}

/* 命令名：到第一个制表符为止。 */
export function commandName(text) {
  const body = String(text == null ? "" : text);
  const tab = body.indexOf("\t");
  return tab < 0 ? body : body.slice(0, tab);
}

/* 一行是不是鉴权应答。不是返回 null。
 *   { kind: "ok" } / { kind: "fail" } / { kind: "locked", seconds: 数字或 null }
 *   { kind: "need", cmd: 命令名 }
 * 按整行认，不找子串：命令名里带 AUTH、OK 字样的别的应答不会被误认。 */
export function parseAuthLine(line) {
  const text = String(line == null ? "" : line).trim();
  let found = text.match(/^ACK\s+AUTH\s+OK$/);
  if (found) return { kind: "ok" };
  found = text.match(/^ACK\s+AUTH\s+FAIL(?:\s+\d+)?$/);
  if (found) return { kind: "fail" };
  found = text.match(/^ACK\s+AUTH\s+LOCKED(?:\s+(\d{1,5}))?$/);
  if (found) {
    if (found[1] === undefined) return { kind: "locked", seconds: null };
    const seconds = parseInt(found[1], 10);
    /* 固件给的是 1 … 60。超出这个范围的数不信，按“不知道还要多久”处理。 */
    if (!(seconds >= 1 && seconds <= 3600)) return { kind: "locked", seconds: null };
    return { kind: "locked", seconds };
  }
  found = text.match(/^ACK\s+([A-Z][A-Z0-9]{1,15})\s+AUTH$/);
  if (found && found[1] !== "AUTH") return { kind: "need", cmd: found[1] };
  return null;
}

/* 被拒的命令重新通过后要不要补发。
 *   AUTH、HB           不是这回事
 *   OTA…               固件数据有先后，补发一条没有意义，交给升级流程自己处理
 *   TIMESET            带着发出时刻的手机时间，晚发就不准了；授时流程会重新跑 */
export function resendable(text) {
  const name = commandName(text);
  if (!name || name === "AUTH" || name === "HB" || name === "TIMESET") return false;
  if (name.indexOf("OTA") === 0) return false;
  return true;
}

export function isOtaCommand(name) {
  return String(name == null ? "" : name).indexOf("OTA") === 0;
}

/* 把一条被拒的命令记进补发清单：同名的只留最后一条，最多 AUTH_RESEND_MAX 条。 */
export function queueRefused(list, text) {
  const out = (list || []).filter((item) => commandName(item) !== commandName(text));
  if (resendable(text)) out.push(text);
  return out.slice(-AUTH_RESEND_MAX);
}

/* 收到一行鉴权应答后该怎么办。ctx：
 *   state     "need" / "checking" / "ok" / "unknown"：界面现在认为的鉴权状态
 *   reauth    正在悄悄重发 AUTH（不是用户在密码页点的）
 *   pass      这次连接里用过的密码
 *   saved     这台手机记住的密码
 *   tries     这条连接上已经悄悄重发过几次
 * 返回 { action, … }：
 *   enter     第一次通过：进充电页
 *   resume    悄悄重发的那一次通过了：界面不动，补发被拒的命令
 *   reauth    用 pass 悄悄重发 AUTH
 *   wait      AUTH 已经在路上，等它的结果
 *   ask       没有可用的密码（或者重发过太多次）：回到输密码那一页，记住的密码不动
 *   wrong     密码不对：回到输密码那一页，记住的密码删掉
 *   locked    已锁定：seconds 是还要等多久（null = 固件没说），retry 为真时锁定结束后
 *             可以用同一个密码自动再试一次，记住的密码不动 */
export function authDecide(reply, ctx) {
  const c = ctx || {};
  if (!reply) return { action: "none" };
  if (reply.kind === "ok") return { action: c.reauth ? "resume" : "enter" };
  if (reply.kind === "fail") return { action: "wrong" };
  if (reply.kind === "locked") {
    return { action: "locked", seconds: reply.seconds, retry: pinOk(c.pass) };
  }
  if (reply.kind === "need") {
    if (c.state === "checking") return { action: "wait", cmd: reply.cmd };
    const pass = pinOk(c.pass) ? String(c.pass) : (pinOk(c.saved) ? String(c.saved) : "");
    if (pass && (c.tries || 0) < AUTH_REAUTH_MAX) return { action: "reauth", pass, cmd: reply.cmd };
    return { action: "ask", cmd: reply.cmd };
  }
  return { action: "none" };
}

/* 锁定还剩几秒（向上取整）。到点或者没有锁定是 0。 */
export function lockLeft(untilMs, nowMs) {
  const until = Number(untilMs) || 0;
  const now = Number(nowMs) || 0;
  if (until <= now) return 0;
  return Math.ceil((until - now) / 1000);
}

/* 密码页上那一行提示。left > 0 是倒计时；known 为假是固件没给秒数。返回中文键和变量，
 * 界面再交给 t() 翻译。 */
export function lockNote(left, known) {
  if (known && left > 0) return { text: "输错次数太多，已锁定。{s} 秒后可以再试", vars: { s: left } };
  return { text: "输错次数太多，已锁定。请稍后再试", vars: null };
}

/* 这个文件用到的界面文字（中文键），测试拿它核对各语言都翻了。 */
export const AUTH_TEXTS = [
  "输错次数太多，已锁定。{s} 秒后可以再试",
  "输错次数太多，已锁定。请稍后再试",
  "已锁定（{s} 秒）",
  "锁定已解除，请重新输入密码",
  "锁定已解除，正在核对密码",
  "连接已恢复，正在重新核对密码",
];
