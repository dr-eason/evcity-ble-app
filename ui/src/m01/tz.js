/* 时区设置。
 *
 * 命令：TZSET\t<相对 UTC 的分钟数，东为正>     应答 ACK TZSET OK / ACK TZSET FAIL
 *       TZGET                                  应答 ACK TZ <分钟>
 * 桩不看联网开关：只改时区，不动桩里的 UTC 时间；写进用户页，掉电保留。桩里只有一个时区，
 * 充电记录的钟点、首页的桩时间都按它显示。
 * 注意：WiFi、OCPP、4G 三个开关都关着时，手机的授时和带时间的心跳会把时区改回手机的时区。 */

export const TZ_ZONES = [
  -720, -660, -600, -570, -540, -480,
  -420, -360, -300, -240, -210, -180,
  -120, -60, 0, 60, 120, 180,
  210, 240, 270, 300, 330, 345,
  360, 390, 420, 480, 525, 540,
  570, 600, 630, 660, 720, 765,
  780, 825, 840,
];

/* 480 → "UTC+08:00"（固定 9 个字符，ASCII 的加减号）。 */
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

async function askTwice(io, command, accept, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return null;
    const line = await io.ask(command, accept, ms);
    if (line != null && accept(line)) return line;
  }
  return null;
}

/* 把时区存到桩里，再读回来确认。
 *   ask(command, accept, ms)  发一条命令，等 accept(line) 为真的那一行；超时返回 null
 *   alive()                   连接还在、这一轮没被顶掉
 *   tz                        要存的时区，分钟
 * 结果：
 *   { state: "ok", tz }      存了，读回来的就是它
 *   { state: "fail", tz }    桩没收，或者读回来的不是它；tz 是桩里现在的时区（读不到时没有）
 *   { state: "silent" }      桩不回
 *   { state: "bad" }         要存的值不是 -720 到 840 的整数，没发
 *   { state: "gone" }        连接没了 */
export async function saveZone(io) {
  const want = Number(io.tz);
  const ms = io.waitMs || 2000;
  if (!Number.isInteger(want) || want < -720 || want > 840) return { state: "bad" };
  const isSet = (line) => { const got = parseTzAck(line); return got !== null && got.kind === "set"; };
  const isGet = (line) => { const got = parseTzAck(line); return got !== null && got.kind === "get"; };
  const ack = parseTzAck(await askTwice(io, "TZSET\t" + want, isSet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!ack) return { state: "silent" };
  const back = parseTzAck(await askTwice(io, "TZGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!back || back.tz === null) return ack.ok ? { state: "silent" } : { state: "fail" };
  if (ack.ok && back.tz === want) return { state: "ok", tz: back.tz };
  return { state: "fail", tz: back.tz };
}

/* 读一次桩的时区：整数分钟，没读到返回 null。 */
export async function readZone(io) {
  const isGet = (line) => { const got = parseTzAck(line); return got !== null && got.kind === "get"; };
  const back = parseTzAck(await askTwice(io, "TZGET", isGet, io.waitMs || 2000));
  return back && back.tz !== null ? back.tz : null;
}
