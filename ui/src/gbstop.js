/* 严格模式（设置「开启严格模式」，默认关；原来叫「新国标6秒停充」，命令、LIVE 字段、
 * 一键配置的 gbStop 都没有改名）。按 GB/T 18487.1-2023 的停止和故障时序。
 *
 * 关：桩一收到停止就断开继电器。
 * 开：桩先停方波通知车辆，CP 还在 6 V 就保持继电器吸合，等 CP 离开 6 V（车回到 9 V）再断开
 *     继电器，最多等 6.5 秒（只看 CP，不看电流；标准要求超过 6 秒才强制断开，3.0.5 及更早的固件是 6 秒）；这段时间里再发停止不算，新的启动被拒绝。安全故障、拔枪照旧立即断开。
 *
 * 命令（固件 wb2.c，要先 AUTH 通过）：
 *   GBSTOPGET              应答 ACK GBSTOPGET 0 / ACK GBSTOPGET 1
 *   GBSTOPSET\t<0|1>       应答 ACK GBSTOPSET OK / ACK GBSTOPSET FAIL（参数不对，或者没存进用户页）
 * 状态：桩每秒发的 LIVE 行在信号强度后面多三个字段（开始等车、继电器断开、设置被改时马上补发一次）：
 *   LIVE <接地电压> <CP 电压> <RSSI> <设置 0/1> <正在等车 0/1> <离强制断开还剩多少毫秒>
 * 等车期间状态行仍是 CHARGING；继电器一断开，后两个字段回到 0 0。更早的固件没有这三个字段，
 * 对这两条命令也一声不吭。手机蓝牙层（MainActivity.knownLine、iOS FrameParser）本来就放行
 * "ACK " 和 "LIVE " 行首。
 *
 * 这个文件不碰界面和蓝牙，主机测试 ui/test/gbstop.test.mjs 直接用。 */

/* 桩最多等这么久（固件 charge_control.c 的 GB_STOP_OPEN_TICKS，3.0.6 起 6.5 秒）。老固件报的
 * 剩余时间最多 6000，倒计时跟着桩报的走，不受影响。 */
export const GB_WAIT_MS = 6500;
/* 点了停止以后，桩过了这么久还说“没有在等”，就不再等它（停止没有进等车这一步，
 * 比如车已经自己停了）。桩开始等车时 20 ms 左右就会补发状态，最迟 1 秒。 */
export const GB_SETTLE_MS = 1500;

/* "ACK GBSTOPGET 1" → { kind: "get", on: true }；"ACK GBSTOPSET OK" → { kind: "set", ok: true }；
 * "ACK GBSTOPSET FAIL" / "BUSY" → { kind: "set", ok: false }；别的行返回 null。
 * "ACK GBSTOPSET AUTH" 这类鉴权应答不在这里认（auth.js）。 */
export function parseGbStopLine(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK" || part.length !== 3) return null;
  if (part[1] === "GBSTOPGET" && (part[2] === "0" || part[2] === "1")) {
    return { kind: "get", on: part[2] === "1" };
  }
  if (part[1] === "GBSTOPSET" && (part[2] === "OK" || part[2] === "FAIL" || part[2] === "BUSY")) {
    return { kind: "set", ok: part[2] === "OK" };
  }
  return null;
}

/* LIVE 行里的三个字段。旧固件没有（或者字段不对）返回 null。 */
export function liveGbStop(line) {
  if (typeof line !== "string" || line.indexOf("LIVE ") !== 0) return null;
  const part = line.trim().split(/\s+/);
  if (part.length < 7) return null;
  const bit = (s) => s === "0" || s === "1";
  if (!bit(part[4]) || !bit(part[5]) || !/^\d{1,5}$/.test(part[6])) return null;
  const waiting = part[5] === "1";
  return { on: part[4] === "1", waiting, remainMs: waiting ? Math.min(Number(part[6]), GB_WAIT_MS) : 0 };
}

/* 状态行里的状态是不是“停止会进等车这一步”的那两种（继电器吸着）。 */
export function gbChargingState(token) {
  return token === "CHARGING" || token === "RELAY_PULL_IN";
}

/* ---- 首页停止按钮：倒计时、置灰 ----
 * guard 是一个普通对象，App.vue 里放一个，每条连接用一份。
 *   until      这个时刻之前按钮置灰（0 = 没有在等）
 *   pressedAt  这一轮是什么时候开始的
 *   seen       这一轮里桩报过“正在等车” */
export function newStopGuard() {
  return { until: 0, pressedAt: 0, seen: false };
}

export function resetStopGuard(guard) {
  guard.until = 0;
  guard.pressedAt = 0;
  guard.seen = false;
}

/* 现在按钮什么样：{ disabled, seconds }。seconds 是按钮上的倒计时（7、6……1；7 只在头半秒），没在等是 0。 */
export function stopView(guard, now) {
  const left = guard.until - now;
  if (!(left > 0)) return { disabled: false, seconds: 0 };
  return { disabled: true, seconds: Math.min(Math.ceil(left / 1000), Math.ceil(GB_WAIT_MS / 1000)) };
}

/* 用户点了停止。返回这一下要不要把 STOP 发出去：按钮置灰的时候再点不发。
 * opts.gbOn      桩报的设置是开着的（LIVE 行或者 GBSTOPGET）
 * opts.charging  状态行说正在充电（gbChargingState）
 * 设置关着、或者没有在充电：照发，按钮不变（和以前一样）。 */
export function stopTap(guard, now, opts) {
  if (stopView(guard, now).disabled) return false;
  if (opts && opts.gbOn && opts.charging) {
    guard.until = now + GB_WAIT_MS;
    guard.pressedAt = now;
    guard.seen = false;
  }
  return true;
}

/* 桩来了一条 LIVE（live 是 liveGbStop 的结果，旧固件是 null）。
 *   正在等车：倒计时跟桩报的剩余时间走（别处发起的停止，比如屏上点的，也一样置灰）。
 *   没有在等：这一轮里桩报过正在等（= 继电器已经断开），或者点了已经超过 GB_SETTLE_MS，
 *             就提前放开；刚点完那一下收到的可能是点之前排着的旧状态，不算。 */
export function stopLive(guard, live, now) {
  if (!live) return;
  if (live.waiting) {
    if (!(guard.until > now)) guard.pressedAt = now;
    guard.seen = true;
    guard.until = now + Math.max(0, Math.min(live.remainMs, GB_WAIT_MS));
    return;
  }
  if (guard.until > now && (guard.seen || now - guard.pressedAt >= GB_SETTLE_MS)) resetStopGuard(guard);
}

/* 状态行说已经不在充电了（已停止、待机、故障……）。同样的规矩：刚点完的那一条不算。 */
export function stopState(guard, charging, now) {
  if (charging) return;
  if (guard.until > now && (guard.seen || now - guard.pressedAt >= GB_SETTLE_MS)) resetStopGuard(guard);
}

/* ---- 设置页：读、存 ---- */
async function askTwice(io, command, accept, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return null;
    const line = await io.ask(command, accept, ms);
    if (line != null && accept(line)) return line;
  }
  return null;
}

const isGet = (line) => { const got = parseGbStopLine(line); return got !== null && got.kind === "get"; };
const isSet = (line) => { const got = parseGbStopLine(line); return got !== null && got.kind === "set"; };

/* 读桩里的设置。ask(command, accept, ms) / alive() 同 phase.js。
 * 结果：{ state: "ok", on } / { state: "silent" }（桩不回，固件还不支持）/ { state: "gone" } */
export async function readGbStop(io) {
  const ms = io.waitMs || 2000;
  const got = parseGbStopLine(await askTwice(io, "GBSTOPGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!got) return { state: "silent" };
  return { state: "ok", on: got.on };
}

/* 存设置，再读回来确认。io.on 是要存的值。
 *   { state: "ok", on }       存了，读回来的就是它
 *   { state: "fail", on? }    桩没收，或者读回来的不是它（带着桩里现在的值）
 *   { state: "silent" }       桩不回
 *   { state: "gone" }         连接没了 */
export async function saveGbStop(io) {
  const want = !!io.on;
  const ms = io.waitMs || 2000;
  const ack = parseGbStopLine(await askTwice(io, "GBSTOPSET\t" + (want ? "1" : "0"), isSet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!ack) return { state: "silent" };
  const back = parseGbStopLine(await askTwice(io, "GBSTOPGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!back) return ack.ok ? { state: "silent" } : { state: "fail" };
  if (ack.ok && back.on === want) return { state: "ok", on: back.on };
  return { state: "fail", on: back.on };
}
