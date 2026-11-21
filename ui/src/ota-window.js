/* 蓝牙 OTA 的滑动窗口发送（回退 N）。不直接碰蓝牙和定时器，收发和计时都由调用方传进来，
 * 所以能在电脑上用 node 测：node --test AC06/tools/ble-finder/ui/test/*.test.mjs
 *
 * 固件（AC06/app/src/ota.c，2.6.1 及更早都一样）的行为，这里全靠它：
 *   - 一片必须紧接上一片（offset == 已写长度）才写入，回 "ACK OTADATA 序号 OK"；
 *   - 重发刚写完的那一片，内容相同也回 OK，不会再写一遍；
 *   - 其它偏移、CRC16 不对、十六进制不完整，回 "ACK OTADATA 序号 FAIL" 且不写入；
 *   - 没在升级或行首解析不了，回不带序号的 "ACK OTADATA FAIL"。
 * 因此 "序号 n OK" 说明 n 和它之前的片都已写入，可以当累计确认用；App 多发、错发都不会写坏。
 *
 * 多片在途时固件有一处不友好（AC06/app/src/wb2.c 的 ble_on_line）：AT 模式下一片被模组拆成
 * 几行 +DATA，固件边收边拼。上一片的应答走 AT+BLESEND，模组回的 "OK" 如果正好落在下一片的
 * 两行之间，会被拼进这一片，这一片就拼不成、不写入、也不应答。再下一片因为偏移不连续回 FAIL，
 * 这里收到后回退重发，数据不会错，只是白发一片。这种情况多不多取决于模组，代码里看不出来，
 * 所以回退累计到 OTA_WINDOW_DROP_AFTER 次，这次升级后面就一直发一片等一片。 */

/* 每片固件字节数。固件 OTA_CHUNK 写死 256，不能改。 */
export const OTA_CHUNK = 256;
/* 同时在途的片数。固件接收环 2048 字节放得下 3 行，应答队列 4 条；实测稳定后可调到 3，不要超过 3。 */
export const OTA_WINDOW = 2;
/* MTU 小于这个值时一片要拆成十几、二十几次写入，退回发一片等一片。 */
export const OTA_WINDOW_MIN_MTU = 100;
/* 多片在途时等应答的时间。从上一次有进展或重发算起。 */
export const OTA_ACK_MS = 1200;
/* 发一片等一片时等应答的时间，和原来一样。 */
export const OTA_ACK_MS_SINGLE = 2500;
/* 同一片连续失败这么多次就放弃，和原来一样。 */
export const OTA_MAX_TRIES = 5;
/* 一次升级里回退重发累计到这么多次，后面一直发一片等一片。 */
export const OTA_WINDOW_DROP_AFTER = 3;

export function otaWindowFor(mtu) {
  return Number(mtu) >= OTA_WINDOW_MIN_MTU ? OTA_WINDOW : 1;
}

/* "ACK OTADATA 12 OK" -> { seq: 12, ok: true }；"ACK OTADATA FAIL" -> { seq: -1, ok: false }；别的行 -> null。 */
export function parseDataAck(line) {
  const part = String(line || "").trim().split(/\s+/);
  if (part[0] !== "ACK" || part[1] !== "OTADATA") return null;
  if (part.length === 3 && part[2] === "FAIL") return { seq: -1, ok: false };
  if (part.length !== 4 || !/^\d+$/.test(part[2])) return null;
  if (part[3] !== "OK" && part[3] !== "FAIL") return null;
  return { seq: Number(part[2]), ok: part[3] === "OK" };
}

/* total：总片数。window：最多同时在途几片。
 *
 * 用法：反复调 next() 取要发的片号并发出去，直到返回 -1；然后等应答或超时，
 * 调 onAck(parseDataAck(行)) 或 onTimeout()。返回值：
 *   "progress" 有新的片被确认      "retry" 已回退，再调 next() 会从第一片未确认的重发
 *   "done" 全部确认                "fail" 同一片失败次数用完      "ignore" 这条应答不用管 */
export function createOtaSender(options) {
  const total = options.total;
  const fullWindow = Math.max(1, options.window || 1);
  const maxTries = options.maxTries || OTA_MAX_TRIES;
  const dropAfter = options.dropAfter || OTA_WINDOW_DROP_AFTER;
  const state = {
    total,
    base: 0,        /* 第一片未确认的 */
    nextSeq: 0,     /* 下一片要发的 */
    highSent: 0,    /* 发出过的最大片号 + 1 */
    window: fullWindow,
    low: 0,         /* 最近一次回退后从哪一片发起 */
    retries: 0,     /* base 这一片已经失败几次 */
    goBacks: 0,     /* 整次升级回退了几次 */
    failed: false,
    next,
    onAck,
    onTimeout,
    get done() { return state.base >= total; },
  };
  /* 每发一次记一条，按发出的先后排。固件按到达顺序逐片应答，所以应答也是这个顺序；
   * gen 是这一条发出时的回退轮次，用来认出回退之前发的片迟到的 FAIL。 */
  let flight = [];
  let gen = 0;

  function next() {
    if (state.failed || state.nextSeq >= total) return -1;
    if (state.nextSeq - Math.max(state.base, state.low) >= state.window) return -1;
    const seq = state.nextSeq++;
    if (state.nextSeq > state.highSent) state.highSent = state.nextSeq;
    flight.push({ seq, gen, solo: state.window === 1 && fullWindow > 1 });
    return seq;
  }

  /* probe >= 0：单独重发的第 probe 片被桩拒收，而它后面的片以前发出过。
   * 可能是那几片其实都写进去了，只是应答没到手机；桩只认“下一片”和“刚写完的那一片”，
   * 再发 base 永远是 FAIL。这时改发后一片试探：桩回 OK 就连同前面的一起确认；回 FAIL 再回到 base。
   * 试探发的片桩一样按偏移检查，不会写错位置。试探失败不算 base 的失败次数。 */
  function goBack(probe) {
    const probing = probe >= state.base && probe + 1 < state.highSent;
    if (!(probe > state.base)) {
      state.retries++;
      state.goBacks++;
      if (state.retries >= maxTries) {
        state.failed = true;
        return "fail";
      }
    }
    gen++;
    state.nextSeq = probing ? probe + 1 : state.base;
    state.low = state.nextSeq;
    /* 重发的这一片单独发，等它确认了再恢复窗口。 */
    state.window = 1;
    return "retry";
  }

  function onTimeout() {
    if (state.failed) return "fail";
    if (state.done) return "done";
    /* 在途的应答都不等了。之后迟到的 OK 仍按累计确认收，迟到的 FAIL 找不到记录会被忽略。 */
    flight = [];
    return goBack(-1);
  }

  function onAck(ack) {
    if (state.failed) return "fail";
    if (!ack) return "ignore";
    let entry = null;
    if (ack.seq < 0) {
      entry = flight.length ? flight.shift() : null;
    } else {
      const at = flight.findIndex((item) => item.seq === ack.seq);
      if (at >= 0) {
        entry = flight[at];
        /* 排在它前面的那几次发送，应答丢了。 */
        flight.splice(0, at + 1);
      }
    }
    if (ack.ok) {
      if (ack.seq < state.base || ack.seq >= state.highSent) return "ignore";
      state.base = ack.seq + 1;
      if (state.nextSeq < state.base) state.nextSeq = state.base;
      state.retries = 0;
      state.window = state.goBacks >= dropAfter ? 1 : fullWindow;
      flight = flight.filter((item) => item.seq >= state.base);
      return state.done ? "done" : "progress";
    }
    if (state.done) return "ignore";
    if (!entry || entry.gen !== gen) return "ignore";
    if (ack.seq >= 0 && ack.seq < state.base) return "ignore";
    return goBack(entry.solo ? entry.seq : -1);
  }

  return state;
}

/* 把所有片发完。io：
 *   total            总片数
 *   window           最多同时在途几片（otaWindowFor(mtu)）
 *   send(seq)        把第 seq 片发出去
 *   waitAck(ms)      返回 Promise：等到一条 OTADATA 应答就给 parseDataAck 的结果，ms 毫秒没等到给 null
 *   now()            毫秒时钟
 *   alive()          返回 false 表示用户取消了，尽快停
 *   progress(n)      已确认 n 片（可不传）
 * 结果："done" 全部确认，"fail" 同一片失败次数用完，"cancel" 被取消。 */
export async function sendOtaChunks(io) {
  const sender = createOtaSender({
    total: io.total, window: io.window, maxTries: io.maxTries, dropAfter: io.dropAfter,
  });
  const report = () => { if (io.progress) io.progress(sender.base); };
  report();
  let deadline = 0;
  let pump = true;
  while (!sender.done) {
    if (!io.alive()) return "cancel";
    if (pump) {
      for (let seq = sender.next(); seq >= 0; seq = sender.next()) io.send(seq);
      /* 有进展或回退重发才重新计时；收到一条不用管的应答，不延长等待。 */
      deadline = io.now() + (sender.window > 1 ? OTA_ACK_MS : OTA_ACK_MS_SINGLE);
      pump = false;
    }
    const left = deadline - io.now();
    const ack = left > 0 ? await io.waitAck(left) : null;
    if (!io.alive()) return "cancel";
    const result = ack ? sender.onAck(ack) : sender.onTimeout();
    if (result === "fail") return "fail";
    if (result === "ignore") continue;
    report();
    pump = true;
  }
  return "done";
}
