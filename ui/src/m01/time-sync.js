/* 手机给充电桩授时。
 *
 * 命令：TIMESET\t<UTC Unix 秒>\t<手机时区，相对 UTC 的分钟数，东为正>
 * 应答：ACK TIMESET OK    桩已按手机时间走，时区也跟着手机
 *       ACK TIMESET NET   桩的联网开关（WiFi、OCPP、4G）有一个开着，没有改
 *       ACK TIMESET FAIL  桩没收（格式、范围或 RTC 写入失败）
 *
 * 规则：App 先读 WiFi 开关和 OCPP 开关，有一个开着就不发。4G 开关 App 不读，交给桩把关：
 * 三个联网开关里有一个开着，桩就回 NET、不改时间。
 *
 * 桩里的时间是 UTC；App、订单显示时再加桩里存的时区。授时把手机时区一起带过去。 */

export const TIME_MIN_UNIX = 1577836800;   /* 2020-01-01T00:00:00Z */
export const TIME_MAX_UNIX = 2145916800;   /* 2038-01-01T00:00:00Z */

/* 读到任意一个开关是“开”就不授时。读不到（null）的那个不算开，照发，桩自己会把关。 */
export function shouldSync(wifiOn, ocppOn) {
  return !(wifiOn === true || ocppOn === true);
}

/* "WIFISW 1" / "OCPPSW 0" → true / false；别的行返回 null。 */
export function switchFrom(line, head) {
  if (typeof line !== "string" || line.indexOf(head + " ") !== 0) return null;
  const value = line.slice(head.length + 1).trim();
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

/* 手机时区，相对 UTC 的分钟数。JS 的 getTimezoneOffset 是反号的。 */
export function phoneTzMinutes(date) {
  const off = -(date || new Date()).getTimezoneOffset();
  return Number.isFinite(off) ? Math.round(off) || 0 : 0;
}

/* 拼命令。手机的钟明显不对（2020 年以前、2038 年以后）时返回 ""，不发。
 * 时区超出桩能存的范围（-720 到 840 分钟）时只发时间，不带时区。 */
export function timeSetCommand(nowMs, tzMin) {
  const unix = Math.floor(Number(nowMs) / 1000);
  if (!Number.isFinite(unix) || unix < TIME_MIN_UNIX || unix >= TIME_MAX_UNIX) return "";
  if (!Number.isInteger(tzMin) || tzMin < -720 || tzMin > 840) return "TIMESET\t" + unix;
  return "TIMESET\t" + unix + "\t" + tzMin;
}

/* "ACK TIMESET OK" → "OK"；不是这条命令的应答返回 null。 */
export function parseTimeAck(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK" || part[1] !== "TIMESET") return null;
  if (part[2] === "OK" || part[2] === "NET") return part[2];
  return "FAIL";
}

/* 连上并通过密码之后跑一次。
 *   ask(command, accept, ms)  发一条命令，等 accept(line) 为真的那一行；超时返回 null
 *   now()                     手机当前时间，毫秒
 *   tz()                      手机时区，分钟
 *   alive()                   连接还在、这一轮没被新的连接顶掉
 * 返回 "ok"、"net"（桩说有开关开着，没改）、"skip"（App 读到有开关开着，没发）、
 * "fail"、"silent"（桩不回）、"clock"（手机时间不可信，没发）、"gone"（连接没了）。 */
export async function runTimeSync(io) {
  const waitMs = io.waitMs || 3000;
  const alive = io.alive || (() => true);
  let wifiOn = null;
  let ocppOn = null;

  for (let attempt = 0; attempt < 2 && wifiOn === null; attempt++) {
    if (!alive()) return "gone";
    wifiOn = switchFrom(await io.ask("WIFISWGET", (line) => switchFrom(line, "WIFISW") !== null, waitMs), "WIFISW");
  }
  for (let attempt = 0; attempt < 2 && ocppOn === null; attempt++) {
    if (!alive()) return "gone";
    ocppOn = switchFrom(await io.ask("OCPPSWGET", (line) => switchFrom(line, "OCPPSW") !== null, waitMs), "OCPPSW");
  }
  if (!alive()) return "gone";
  if (!shouldSync(wifiOn, ocppOn)) return "skip";
  for (let attempt = 0; attempt < 2; attempt++) {
    /* 每次发之前重新取时间，重发时不带着几秒前的旧值。 */
    const command = timeSetCommand(io.now(), io.tz());
    if (!command) return "clock";
    const line = await io.ask(command, (text) => parseTimeAck(text) !== null, waitMs);
    if (!alive()) return "gone";
    const ack = parseTimeAck(line);
    if (ack === "OK") return "ok";
    if (ack === "NET") return "net";
    if (ack === "FAIL") return "fail";
  }
  return "silent";
}

/* ---------------------------------------------------------------- 心跳校时
 *
 * 连上时的 TIMESET 只对一次。之后 App 每秒一条的心跳把手机时间一起带过去，桩一直跟着手机走：
 *   HB\t<UTC Unix 秒>\t<手机时区，相对 UTC 的分钟数>
 * 桩不回应答。桩那边仍是同一条规则：三个联网开关都关着才用其中的时间，任意一个开着就只当
 * 心跳；和桩的时间相差不超过 2 秒、时区也一样时桩不写；两次写入至少隔 10 秒。
 *
 * 心跳由 MainActivity 的定时器发，这里的 heartbeatCommand 是同一个格式的参照实现。密码通过
 * 之前、固件升级期间发纯 "HB"。 */

/* 这一秒该发的心跳。
 *   carriesTime  连着、密码已经通过、不在固件升级里（App.vue 的 heartbeatTimed）
 *   busy         发送队列里还排着别的数据：时间到桩就旧了，发纯 "HB"
 * 手机的钟明显不对发纯 "HB"；时区超出桩能存的范围时只带时间。 */
export function heartbeatCommand(carriesTime, busy, nowMs, tzMin) {
  if (!carriesTime || busy) return "HB";
  const unix = Math.floor(Number(nowMs) / 1000);
  if (!Number.isFinite(unix) || unix < TIME_MIN_UNIX || unix >= TIME_MAX_UNIX) return "HB";
  if (!Number.isInteger(tzMin) || tzMin < -720 || tzMin > 840) return "HB\t" + unix;
  return "HB\t" + unix + "\t" + tzMin;
}

/* 心跳把桩的时区改了以后，App 手里的桩时区（TZGET 读来的，首页钟点和充电记录按它算）还是
 * 旧的。手机时区和它不一样时重新读一次 TZGET：发现不一样 3 秒后第一次，之后每 12 秒一次，
 * 最多 3 次。桩的联网开关开着时桩不跟手机的时区，问 3 次就不再问。
 *   state  调用方留着的 { tz, tries, at }，每次连接换一个新的 {}
 * 返回 true 表示现在该发一条 TZGET。 */
export const ZONE_REREAD_FIRST_MS = 3000;
export const ZONE_REREAD_GAP_MS = 12000;
export const ZONE_REREAD_TRIES = 3;
export function zoneRereadDue(state, carriesTime, pileTz, phoneTz, nowMs) {
  if (!carriesTime || !Number.isInteger(phoneTz) || phoneTz < -720 || phoneTz > 840) return false;
  if (pileTz === phoneTz) {
    state.tz = undefined;
    return false;
  }
  if (state.tz !== phoneTz) {
    state.tz = phoneTz;
    state.tries = 0;
    state.at = nowMs - (ZONE_REREAD_GAP_MS - ZONE_REREAD_FIRST_MS);
  }
  if (state.tries >= ZONE_REREAD_TRIES || nowMs - state.at < ZONE_REREAD_GAP_MS) return false;
  state.tries += 1;
  state.at = nowMs;
  return true;
}
