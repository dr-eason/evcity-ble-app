/* 相位：单相 / 三相（屏幕设置第 3 页的 Power Model，同一条用户页记录 PHM1 的第一个字节）。
 *
 * 命令（固件 wb2.c，最早的固件就有；2.7.2 起要先 AUTH 通过）：
 *   PHASEGET                 应答 PHASE 0 / PHASE 1（注意：前面没有 ACK）
 *   PHASESET\t<0|1>          应答 ACK PHASESET OK
 *                                 ACK PHASESET FAIL   参数不对，或者没存进用户页
 *                                 ACK PHASESET BUSY   正在充电，并且要改成另一个值（2.7.2 起，BUG-015）；
 *                                                     值没变照常回 OK
 * 0 单相，1 三相。相位决定 L2、L3 参不参与过压、欠压、过流、短路的判断，存在充电桩的用户页里，
 * 断电保留。手机蓝牙层（MainActivity.knownLine、iOS FrameParser）早就放行 "PHASE " 行首。
 *
 * 这个文件不碰界面和蓝牙，主机测试 ui/test/phase.test.mjs 直接用。 */

export const PHASES = [
  { id: 0, name: "单相" },
  { id: 1, name: "三相" },
];

export function phaseName(id) {
  const item = PHASES.find((phase) => phase.id === id);
  return item ? item.name : "";
}

/* "PHASE 1" → { kind: "get", phase: 1 }；"ACK PHASESET OK" → { kind: "set", ok: true, busy: false }；
 * "ACK PHASESET BUSY" → { kind: "set", ok: false, busy: true }；别的行返回 null。
 * "ACK PHASESET AUTH" 这类鉴权应答不在这里认（auth.js）。 */
export function parsePhaseLine(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] === "PHASE" && part.length === 2 && (part[1] === "0" || part[1] === "1")) {
    return { kind: "get", phase: Number(part[1]) };
  }
  if (part[0] === "ACK" && part[1] === "PHASESET" && part.length === 3 &&
      (part[2] === "OK" || part[2] === "FAIL" || part[2] === "BUSY")) {
    return { kind: "set", ok: part[2] === "OK", busy: part[2] === "BUSY" };
  }
  return null;
}

/* 一键配置下发相位时，桩不收的原因（大白话，界面上用 t() 翻译）。 */
export const PHASE_BUSY_REASON = "充电桩正在充电，请先停止充电后再下发相位";

async function askTwice(io, command, accept, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return null;
    const line = await io.ask(command, accept, ms);
    if (line != null && accept(line)) return line;
  }
  return null;
}

const isGet = (line) => { const got = parsePhaseLine(line); return got !== null && got.kind === "get"; };
const isSet = (line) => { const got = parsePhaseLine(line); return got !== null && got.kind === "set"; };

/* 读桩里的相位。
 *   ask(command, accept, ms) / alive() 同 scrlang.js 的 readScreenLang
 * 结果：{ state: "ok", phase } / { state: "silent" }（桩不回）/ { state: "gone" } */
export async function readPhase(io) {
  const ms = io.waitMs || 2000;
  const got = parsePhaseLine(await askTwice(io, "PHASEGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!got) return { state: "silent" };
  return { state: "ok", phase: got.phase };
}

/* 存相位，再读回来确认。io.phase 是要存的值（0 或 1）。
 *   { state: "ok", phase }        存了，读回来的就是它
 *   { state: "busy", phase? }     正在充电，桩不让改（带着桩里现在的值）
 *   { state: "fail", phase? }     桩没收，或者读回来的不是它
 *   { state: "silent" }           桩不回
 *   { state: "bad" }              不是 0 或 1，没发
 *   { state: "gone" }             连接没了 */
export async function savePhase(io) {
  const want = Number(io.phase);
  const ms = io.waitMs || 2000;
  if (want !== 0 && want !== 1) return { state: "bad" };
  const ack = parsePhaseLine(await askTwice(io, "PHASESET\t" + want, isSet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!ack) return { state: "silent" };
  const back = parsePhaseLine(await askTwice(io, "PHASEGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (ack.busy) return back ? { state: "busy", phase: back.phase } : { state: "busy" };
  if (!back) return ack.ok ? { state: "silent" } : { state: "fail" };
  if (ack.ok && back.phase === want) return { state: "ok", phase: back.phase };
  return { state: "fail", phase: back.phase };
}
