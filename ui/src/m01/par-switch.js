/* 设置里改并充：先无条件停掉全部充电，等每一路都停下，再切换并充，最后读回核对。
 *
 * 固件的 PARSET 只在所有端口空闲时才接受（有一路在充、结束中、刚授权还没合闸、继电器还
 * 吸着都回 ACK PARSET BUSY），App 这边按下面的顺序做（文档/04-协议/M01蓝牙协议.md 5.14 节）：
 *
 *   1. STOP⇥0                全部停止（只停在充的；空闲的不动）。桩逐路停：端口号从小到大
 *                            每 0.3 秒停一路，10 路约 2.7 秒停完，再过 1 秒结束中回空闲
 *   2. 每秒读一次各路状态     直到没有一路是 C 充电中、S 暂停输出、F 结束中
 *   3. PARSET⇥<模式>          桩回 ACK PARSET OK 再跟一行 ACK PAR，随后自己重启
 *   4. 核对 ACK PAR 的第 3 个字段（保存的模式）就是这次选的模式
 *
 * 等的这段时间里如果又有人起了充（刷卡、平台、触摸板），第 2 步看得到就再发一次 STOP⇥0；
 * 看不到的（刚授权、还没合闸）PARSET 会回 BUSY，也是再停、再等。还在充的每 5 秒补发一次
 * STOP⇥0，防着第一次的应答丢了；5 秒比 10 路逐路停完还长，正常情况下只发一次。重发的
 * STOP⇥0 桩不重新排队，排着的照原来的顺序和间隔停。整个过程最多 30 秒；中途蓝牙断开、桩不回、桩不接受都
 * 停下来，返回结果，界面按 parSwitchText() 出字。不需要改固件，老固件也是这样走。
 *
 *   const out = await runParSwitch(io, mode, { timeoutMs })
 *   io.ask(command, accept, ms)   ble-queue 的 ask：一次一条，超时返回 null
 *   io.readPorts()                读一次各路状态 → ["P", "C", …]（按端口 1..N），没读全返回 null
 *   io.alive()                    蓝牙还连着、还在这个页面上
 *   io.sleep(ms)、io.now()        测试里换成假的时钟
 *   io.progress(step, vars)       界面上的进度：stop 正在停止、wait 还有几路没停（vars.n、
 *                                 vars.ports）、switch 正在切换
 *
 * 返回 { code, … }：
 *   done      切换成功。restart：桩会重启（模式和这次运行的不一样）；checked：读回核对过
 *   timeout   30 秒内没有全部停下，没有切换。ports：最后一次看到还没停的端口
 *   link      蓝牙断开或离开了页面。sent：PARSET 已经发出去了（可能已经切换、桩在重启）
 *   noreply   桩一直不回
 *   rejected  桩不接受这个模式（ACK PARSET FAIL）
 *   mismatch  读回来保存的模式不是这次选的。saved：读回来的 */
import { parCommand, parsePar, parseParSet } from "./ports.js";

export const PAR_SWITCH_TIMEOUT_MS = 30000;   /* 从点确认到切换完，最多等这么久 */
export const STOP_ALL_GAP_MS = 300;           /* 桩逐路停的间隔（固件 M01_STOP_ALL_GAP_MS） */
export const PAR_RESTOP_MS = 5000;            /* 还有在充的：隔这么久再发一次 STOP⇥0 */
export const PAR_POLL_MS = 1000;              /* 读各路状态的间隔 */

/* 还没停下的状态：充电中、暂停输出（这一单还在）、结束中（继电器正在断开）。 */
export function parNotStopped(letter) {
  return letter === "C" || letter === "S" || letter === "F";
}
/* 各路状态 → 还没停下的端口号（1 起）。 */
export function parBusyPorts(letters) {
  const out = [];
  (letters || []).forEach((letter, index) => {
    if (parNotStopped(letter)) out.push(index + 1);
  });
  return out;
}

function isStopAllAck(line) {
  return typeof line === "string" && /^ACK STOP\t0\t[A-Z]+[\r\n]*$/.test(line);
}

export async function runParSwitch(io, mode, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || PAR_SWITCH_TIMEOUT_MS;
  const now = io.now || (() => Date.now());
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const progress = io.progress || (() => {});
  const deadline = now() + timeoutMs;
  let lastStop = -Infinity;
  let busy = [];
  let heard = false;          /* 桩回过任何一条：区分"一直不回"和"等不到全部停下" */
  let sent = false;           /* PARSET 发出去过 */

  for (;;) {
    if (!io.alive()) return { code: "link", sent };
    if (now() >= deadline) {
      return heard ? { code: "timeout", ports: busy.slice() } : { code: "noreply" };
    }
    if (now() - lastStop >= PAR_RESTOP_MS) {
      progress("stop", null);
      const ack = await io.ask("STOP\t0", isStopAllAck, 3000);
      if (!io.alive()) return { code: "link", sent };
      lastStop = now();
      if (ack !== null) heard = true;
    }
    const letters = await io.readPorts();
    if (!io.alive()) return { code: "link", sent };
    if (!letters) {
      await sleep(PAR_POLL_MS);
      continue;
    }
    heard = true;
    busy = parBusyPorts(letters);
    if (busy.length) {
      progress("wait", { n: busy.length, ports: busy.slice() });
      /* 有在充的（不只是结束中）：刚停过就等它收口，没停过或停了 5 秒还在充就再停。 */
      if (busy.some((port) => letters[port - 1] !== "F") && now() - lastStop >= PAR_RESTOP_MS) continue;
      await sleep(PAR_POLL_MS);
      continue;
    }

    progress("switch", null);
    sent = true;
    let sawOk = false;
    const reply = await io.ask(parCommand(mode), (line) => {
      const result = parseParSet(line);
      if (result === "OK") {
        sawOk = true;
        return false;                 /* 再等紧跟着的 ACK PAR */
      }
      if (result !== null) return true;
      return sawOk && parsePar(line) !== null;
    }, 3000);
    const result = reply === null ? null : parseParSet(reply);
    if (result === "FAIL") return { code: "rejected" };
    if (result === "BUSY") {
      /* 读状态和切换之间又有人起了充（或刚授权还没合闸）：再停一次，接着等。 */
      heard = true;
      sent = false;
      lastStop = -Infinity;
      continue;
    }
    if (reply !== null) {
      const par = parsePar(reply);
      if (par.saved !== mode) return { code: "mismatch", saved: par.saved };
      return { code: "done", restart: par.mode !== mode, checked: true };
    }
    /* ACK PARSET OK 到了、ACK PAR 没到（桩马上就重启了）：算切换成功，没能读回。 */
    if (sawOk) return { code: "done", restart: true, checked: false };
    if (!io.alive()) return { code: "link", sent };
    /* 一行都没回：可能 PARSET 丢了，也可能桩已经切换、应答丢了。还在 30 秒里就从头再来一遍；
     * sent 留着，这之后蓝牙断开不能说"没有切换"。 */
  }
}

/* 结果 → { text, vars, ok }：text 是翻译的键。 */
export function parSwitchText(out) {
  const code = out && out.code;
  if (code === "done") {
    if (!out.restart) return { ok: true, text: "已切换，不用重启", vars: null };
    if (!out.checked) return { ok: true, text: "已切换，充电桩正在重启，请稍后重新连接", vars: null };
    return { ok: true, text: "已切换并核对，充电桩正在重启，请稍后重新连接", vars: null };
  }
  if (code === "timeout") {
    if (out.ports && out.ports.length) {
      return { ok: false, text: "等了 30 秒，第 {list} 路还没停下，没有切换。请到首页看一下再试", vars: { list: out.ports.join(", ") } };
    }
    return { ok: false, text: "等了 30 秒还是不能切换。请稍后再试", vars: null };
  }
  if (code === "link") {
    if (out.sent) return { ok: false, text: "蓝牙断开了。可能已经切换、充电桩正在重启，重新连接后在这里看现在的模式", vars: null };
    return { ok: false, text: "蓝牙断开了，没有切换。充电可能已经停了，重新连接后请先看首页", vars: null };
  }
  if (code === "rejected") return { ok: false, text: "充电桩没有接受", vars: null };
  if (code === "mismatch") return { ok: false, text: "读回来的模式不对，没有切换成功，请再试一次", vars: null };
  return { ok: false, text: "充电桩没有应答", vars: null };
}

/* 进度 → { text, vars }。 */
export function parSwitchStep(step, vars) {
  if (step === "wait") return { text: "等待各路停下：还有 {n} 路（第 {list} 路）", vars: { n: vars.n, list: vars.ports.join(", ") } };
  if (step === "switch") return { text: "全部已停，正在切换", vars: null };
  return { text: "正在停止全部充电", vars: null };
}
