/* 时区设置（固件 2.6.14 起有只设时区的命令）。
 *
 * 命令：TZSET\t<相对 UTC 的分钟数，东为正>     应答 ACK TZSET OK / ACK TZSET FAIL
 *       TZGET                                  应答 ACK TZ <分钟>
 * 桩不看 WiFi、OCPP 开关：只改时区，不动桩里的 UTC 时间，也不动预约的模式和钟点；写进用户页，
 * 掉电保留。屏幕的时区页、SCHEDGET 的第二个数是同一个值。
 *
 * 2.6.13 及更早的固件不认识这两条，什么都不回。那时退回旧办法：先读 SCHEDGET，把读到的预约
 * 原样连同新时区用 SCHEDSET 写回去（旧 App 预约页里改时区就是这么做的）。旧办法的两点不同：
 *   - 桩里存着预约（一次性或每天）而桩还没有时间时，SCHEDSET 回 TIME，时区存不进去；
 *   - “一次性、已经执行过”的预约原样写回会被重新排上，所以这种情况写成“关闭”。
 *
 * TZ_ZONES 和迪文屏 S2.9 时区页是同一张表：固件 app/src/screen.c 的 s_tz_list[]、
 * 文档/迪文屏/工具/tz_zones.py 的 ZONES。三份由 test/tz.test.mjs 逐项比对。 */

export const TZ_ZONES = [
  -720, -660, -600, -570, -540, -480,
  -420, -360, -300, -240, -210, -180,
  -120, -60, 0, 60, 120, 180,
  210, 240, 270, 300, 330, 345,
  360, 390, 420, 480, 525, 540,
  570, 600, 630, 660, 720, 765,
  780, 825, 840,
];

export const TZSET_MIN_VERSION = [2, 6, 14];

/* 480 → "UTC+08:00"，和屏幕上的写法一样（固定 9 个字符，ASCII 的加减号）。 */
export function tzLabel(min) {
  const value = Number(min);
  if (!Number.isInteger(value)) return "";
  const abs = Math.abs(value);
  const two = (n) => (n < 10 ? "0" : "") + n;
  return "UTC" + (value < 0 ? "-" : "+") + two(Math.floor(abs / 60)) + ":" + two(abs % 60);
}

/* 这个时区在列表里是第几个；不在返回 -1（手机授时可以带来任意的分钟数）。 */
export function tzIndex(min) {
  return TZ_ZONES.indexOf(Number(min));
}

/* 桩的固件认不认识 TZSET / TZGET。true / false；版本没读到返回 null。 */
export function tzSupported(fwVersion) {
  const m = String(fwVersion == null ? "" : fwVersion).trim().replace(/^[Vv]/, "")
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])/);
  if (!m) return null;
  const have = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== TZSET_MIN_VERSION[i]) return have[i] > TZSET_MIN_VERSION[i];
  }
  return true;
}

/* "ACK TZSET OK" → { kind: "set", ok: true }；"ACK TZ 480" → { kind: "get", tz: 480 }；
 * 别的行返回 null。TZGET 的数不是 -720 到 840 的整数时 tz 是 null。 */
export function parseTzAck(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK") return null;
  if (part[1] === "TZSET") return { kind: "set", ok: part[2] === "OK" };
  if (part[1] === "TZ") {
    const text = part[2] || "";
    const tz = /^[+-]?\d{1,4}$/.test(text) ? parseInt(text, 10) : NaN;
    return { kind: "get", tz: Number.isInteger(tz) && tz >= -720 && tz <= 840 ? tz : null };
  }
  return null;
}

/* "SCHED <有时间> <时区> <模式> <时> <分> <待执行>" → 对象；不是这一行返回 null。 */
export function parseSchedLine(line) {
  if (typeof line !== "string" || line.indexOf("SCHED ") !== 0) return null;
  const part = line.trim().split(/\s+/);
  if (part.length < 7) return null;
  const num = part.slice(1, 7).map((text) => (/^[+-]?\d+$/.test(text) ? parseInt(text, 10) : NaN));
  if (num.some((n) => !Number.isInteger(n))) return null;
  return { ready: num[0] === 1, tz: num[1], mode: num[2], hour: num[3], minute: num[4], armed: num[5] };
}

/* 旧固件：把读到的预约连同新时区写回去的那条命令。 */
export function legacyCommand(tz, sched) {
  const mode = sched.mode === 1 && !sched.armed ? 0 : sched.mode;
  return "SCHEDSET\t" + tz + "\t" + mode + "\t" + sched.hour + "\t" + sched.minute;
}

async function askTwice(io, command, accept, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return null;
    const line = await io.ask(command, accept, ms);
    if (line != null && accept(line)) return line;
  }
  return null;
}

async function saveLegacy(io, want, ms) {
  const isSched = (line) => parseSchedLine(line) !== null;
  const isAck = (line) => typeof line === "string" && /^ACK\s+SCHEDSET(\s|$)/.test(line.trim());
  const before = parseSchedLine(await askTwice(io, "SCHEDGET", isSched, ms));
  if (!io.alive()) return { state: "gone" };
  if (!before) return { state: "silent", legacy: true };
  const ack = await askTwice(io, legacyCommand(want, before), isAck, ms);
  if (!io.alive()) return { state: "gone" };
  if (!ack) return { state: "silent", legacy: true };
  const word = ack.trim().split(/\s+/)[2];
  const after = parseSchedLine(await askTwice(io, "SCHEDGET", isSched, ms));
  if (!io.alive()) return { state: "gone" };
  if (word === "TIME") return { state: "time", legacy: true, tz: after ? after.tz : before.tz };
  if (!after) return { state: "silent", legacy: true };
  if (word === "OK" && after.tz === want) return { state: "ok", legacy: true, tz: after.tz };
  return { state: "fail", legacy: true, tz: after.tz };
}

/* 把时区存到桩里，再读回来确认。
 *   ask(command, accept, ms)  发一条命令，等 accept(line) 为真的那一行；超时返回 null
 *   alive()                   连接还在、这一轮没被顶掉
 *   fw                        桩的固件版本（STAT 行里的），没读到传 ""
 *   tz                        要存的时区，分钟
 * 结果（legacy 为 true 表示走的是旧固件的 SCHEDSET）：
 *   { state: "ok", tz }      存了，读回来的就是它
 *   { state: "fail", tz }    桩没收，或者读回来的不是它；tz 是桩里现在的时区（读不到时没有）
 *   { state: "time", tz }    旧固件：桩里有预约但还没有时间，SCHEDSET 不收
 *   { state: "silent" }      桩不回
 *   { state: "bad" }         要存的值不是 -720 到 840 的整数，没发
 *   { state: "gone" }        连接没了 */
export async function saveZone(io) {
  const want = Number(io.tz);
  const ms = io.waitMs || 2000;
  if (!Number.isInteger(want) || want < -720 || want > 840) return { state: "bad" };
  const supported = tzSupported(io.fw);
  if (supported === false) return saveLegacy(io, want, ms);
  const isSet = (line) => { const got = parseTzAck(line); return got !== null && got.kind === "set"; };
  const isGet = (line) => { const got = parseTzAck(line); return got !== null && got.kind === "get"; };
  const ack = parseTzAck(await askTwice(io, "TZSET\t" + want, isSet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!ack) {
    /* 版本没读到又不回：当作旧固件再试一次旧办法。版本明明够新却不回：就是没回。 */
    return supported === null ? saveLegacy(io, want, ms) : { state: "silent" };
  }
  const back = parseTzAck(await askTwice(io, "TZGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!back || back.tz === null) return ack.ok ? { state: "silent" } : { state: "fail" };
  if (ack.ok && back.tz === want) return { state: "ok", tz: back.tz };
  return { state: "fail", tz: back.tz };
}
