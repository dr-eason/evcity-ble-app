/* 时区设置页上“充电桩当前时间”（固件 2.6.15 起有读时间的命令）。
 *
 * 命令：TIMEGET            应答 ACK TIME <UTC Unix 秒> <时区，相对 UTC 的分钟数，东为正>
 * 只读，桩不看 WiFi、OCPP 开关。桩还没有时间时秒数是 0。时区和 TZGET、SCHEDGET 第二个数
 * 是同一个值。桩里的时间一直是 UTC，这里加上桩的时区再显示，和屏幕时区页右上角的钟一样，
 * 不显示秒。显示的是桩的时间，不是手机的时间。
 *
 * 读到一次以后 App 自己按手机的计时往前走（只用手机走过了多少毫秒，不用手机的钟点），
 * 停在页面上时隔一阵再读一次校准。
 *
 * 2.6.14 及更早的固件不认识 TIMEGET，什么都不回。那时的退路：这次连接里桩收下过手机的授时
 * （ACK TIMESET OK，或者离线模式下心跳带着时间），桩的 UTC 就是手机的 UTC，用手机的 UTC 加
 * 桩的时区；否则（桩用的是网络时间）拿不到，显示 "--"。 */

export const TIMEGET_MIN_VERSION = [2, 6, 15];
export const CLOCK_NONE = "--";
export const CLOCK_MIN_UNIX = 1577836800;   /* 2020-01-01T00:00:00Z，桩认为“有时间”的门槛 */
export const CLOCK_MAX_UNIX = 2145916800;   /* 2038-01-01T00:00:00Z */
export const CLOCK_RESYNC_MS = 60000;       /* 停在页面上时多久再读一次 */
export const CLOCK_RETRY_MS = 10000;        /* 桩还没有时间、或者没读到时多久再读一次 */

/* 桩的固件认不认识 TIMEGET。true / false；版本没读到返回 null。 */
export function timeGetSupported(fwVersion) {
  const m = String(fwVersion == null ? "" : fwVersion).trim().replace(/^[Vv]/, "")
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])/);
  if (!m) return null;
  const have = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== TIMEGET_MIN_VERSION[i]) return have[i] > TIMEGET_MIN_VERSION[i];
  }
  return true;
}

/* "ACK TIME 1795138200 480" → { unix: 1795138200, tz: 480 }；别的行返回 null。
 * 桩没有时间（0）或者秒数不在 2020–2037 年之间时 unix 是 0；时区不是 -720 到 840 的整数时
 * tz 是 null。"ACK TIMESET OK" 不是这一行。 */
export function parseTimeGet(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK" || part[1] !== "TIME" || part.length < 4) return null;
  if (!/^\d{1,10}$/.test(part[2])) return null;
  const unix = parseInt(part[2], 10);
  const tz = /^[+-]?\d{1,4}$/.test(part[3]) ? parseInt(part[3], 10) : NaN;
  return {
    unix: unix >= CLOCK_MIN_UNIX && unix < CLOCK_MAX_UNIX ? unix : 0,
    tz: Number.isInteger(tz) && tz >= -720 && tz <= 840 ? tz : null,
  };
}

/* UTC 秒 + 时区分钟 → "YYYY-MM-DD HH:MM"（桩的本地时间）。算不出来返回 ""。
 * 不经过手机的时区：先把秒数挪过去，再按 UTC 取年月日时分。 */
export function clockText(unix, tzMin) {
  const sec = Number(unix);
  const tz = Number(tzMin);
  if (!Number.isInteger(sec) || sec < CLOCK_MIN_UNIX || sec >= CLOCK_MAX_UNIX) return "";
  if (!Number.isInteger(tz) || tz < -720 || tz > 840) return "";
  const local = new Date((sec + tz * 60) * 1000);
  const two = (n) => (n < 10 ? "0" : "") + n;
  return local.getUTCFullYear() + "-" + two(local.getUTCMonth() + 1) + "-" + two(local.getUTCDate()) +
    " " + two(local.getUTCHours()) + ":" + two(local.getUTCMinutes());
}

/* 读到的那一刻是 base = { unix, at }（at 是手机收到应答时的毫秒数），现在桩上是几秒。
 * 手机的钟被往回拨了（走过的时间是负的）就当没走。 */
export function chargerUnix(base, nowMs) {
  if (!base || !Number.isInteger(base.unix)) return 0;
  const gone = Math.floor((Number(nowMs) - Number(base.at)) / 1000);
  return base.unix + (Number.isFinite(gone) && gone > 0 ? gone : 0);
}

/* 页面上那一行字。
 *   base      最近一次 TIMEGET 读到的 { unix, at }，没读到是 null
 *   noTime    最近一次 TIMEGET 说桩还没有时间
 *   phoneFed  这次连接里桩的时间是手机给的（旧固件的退路）
 *   tz        桩的时区（分钟），tzKnown 为 false 表示还没读到
 *   nowMs     手机现在的毫秒数
 * 返回 { kind, text }：
 *   "charger"  桩读回来的时间
 *   "notime"   桩说还没有时间，text 是 ""（页面写“时间未同步”）
 *   "phone"    退路：手机的 UTC + 桩的时区
 *   "none"     拿不到，text 是 "--" */
export function chargerClock(state) {
  const none = { kind: "none", text: CLOCK_NONE };
  if (!state || !state.tzKnown) return none;
  if (state.base) {
    const text = clockText(chargerUnix(state.base, state.nowMs), state.tz);
    return text ? { kind: "charger", text } : none;
  }
  if (state.noTime) return { kind: "notime", text: "" };
  if (state.phoneFed) {
    const text = clockText(Math.floor(Number(state.nowMs) / 1000), state.tz);
    return text ? { kind: "phone", text } : none;
  }
  return none;
}

/* 从桩读一次时间。
 *   ask(command, accept, ms)  发一条命令，等 accept(line) 为真的那一行；超时返回 null
 *   alive()                   连接还在、这一轮没被顶掉
 *   fw                        桩的固件版本（STAT 行里的），没读到传 ""
 *   now()                     手机现在的毫秒数
 * 结果：
 *   { state: "ok", base: { unix, at }, tz }   读到了；tz 读不出来时是 null
 *   { state: "notime", tz }                   桩还没有时间
 *   { state: "old" }                          固件低于 2.6.15，没发
 *   { state: "silent" }                       桩不回（版本没读到的旧固件也是这样）
 *   { state: "gone" }                         连接没了 */
export async function readChargerTime(io) {
  const ms = io.waitMs || 2000;
  const now = io.now || (() => Date.now());
  if (timeGetSupported(io.fw) === false) return { state: "old" };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return { state: "gone" };
    const got = parseTimeGet(await io.ask("TIMEGET", (line) => parseTimeGet(line) !== null, ms));
    if (!io.alive()) return { state: "gone" };
    if (got) {
      if (got.unix === 0) return { state: "notime", tz: got.tz };
      return { state: "ok", base: { unix: got.unix, at: now() }, tz: got.tz };
    }
  }
  return { state: "silent" };
}
