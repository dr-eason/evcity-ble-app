/* 扫描页的卡片顺序：信号差不多的两台桩不能来回换位置（Android 和 iOS 共用这一份）。
 *
 * 手机那一层每收到一次广播就报一整份 {t:"devs", list:[{name, addr, rssi}]}，自己不排序。
 * 以前这里每次都按最新的 rssi 直接排，两台桩信号接近时每报一次就可能换一次行。现在：
 *
 *   1. 每台桩（按 addr）的 rssi 先做平滑：ema = ALPHA * 最新值 + (1 - ALPHA) * ema，第一次直接用最新值。
 *   2. 排序带回差：下面的一行要连续 SUSTAIN 次都比上面的一行强 THRESHOLD_DB 以上，才挪到它上面。
 *      差得不够就保持现在的先后。
 *   3. 新出现的桩没有“现在的先后”：放到它明显强过（≥ THRESHOLD_DB）的最上面那一行之前，
 *      没有这样的行就排在最后（也就是按第一次出现的先后）。
 *   4. 手指按在列表上时（hold）行不动：数字照常更新，新桩只加在最后，消失的桩照常去掉。
 *      松开（release）后再等 RELEASE_MS 才允许换行，免得刚松手、点击还没处理行就动了。
 *      按住超过 HOLD_MAX_MS 当作松开的事件丢了（比如手指下的那一行被去掉），不再冻住。
 *   5. 手机那一层报空列表（重新扫描）时全部清零；某台桩不在列表里了就去掉它的记录。
 *
 * 卡片上显示的数字是最新的原始 rssi；先后只看平滑后的值。时间一律由调用方传进来（毫秒），
 * 这里不读时钟、不用计时器，方便在 node 里测。 */

export const RSSI_ALPHA = 0.3;        /* 平滑系数：越小越稳、跟得越慢 */
export const THRESHOLD_DB = 6;        /* 回差：强这么多 dB 才换行 */
export const SUSTAIN = 2;             /* 要连续这么多次更新都强过回差 */
export const RELEASE_MS = 300;        /* 松手后过这么久才允许换行 */
export const HOLD_MAX_MS = 10000;     /* 按住最多冻这么久 */

export function smoothRssi(prev, raw, alpha = RSSI_ALPHA) {
  if (typeof raw !== "number" || !isFinite(raw)) return typeof prev === "number" ? prev : null;
  if (typeof prev !== "number") return raw;
  return alpha * raw + (1 - alpha) * prev;
}

export function createScanList(opts = {}) {
  const alpha = opts.alpha == null ? RSSI_ALPHA : opts.alpha;
  const threshold = opts.threshold == null ? THRESHOLD_DB : opts.threshold;
  const sustain = opts.sustain == null ? SUSTAIN : opts.sustain;
  const releaseMs = opts.releaseMs == null ? RELEASE_MS : opts.releaseMs;
  const holdMaxMs = opts.holdMaxMs == null ? HOLD_MAX_MS : opts.holdMaxMs;

  let items = new Map();      /* addr -> 手机那一层最新报的那一条 */
  let ema = new Map();        /* addr -> 平滑后的 rssi */
  let seen = new Map();       /* addr -> 第几个出现的 */
  let lead = new Map();       /* "x\ny" -> x 已经连续几次比 y 强过回差 */
  let order = [];             /* 现在的先后（addr） */
  let unplaced = new Set();   /* 冻住时加在最后、还没按信号放过位置的新桩 */
  let seq = 0;
  let held = false;
  let heldAt = 0;
  let freeUntil = 0;

  const strength = (addr) => {
    const v = ema.get(addr);
    return typeof v === "number" ? v : -Infinity;
  };
  const leads = (x, y) => strength(x) - strength(y) >= threshold;
  const pairKey = (x, y) => x + "\n" + y;
  const sustained = (x, y) => (lead.get(pairKey(x, y)) || 0) >= sustain;

  function reset() {
    items = new Map();
    ema = new Map();
    seen = new Map();
    lead = new Map();
    order = [];
    unplaced = new Set();
    seq = 0;
  }
  function frozen(now = 0) {
    if (held) return now - heldAt < holdMaxMs;
    return now < freeUntil;
  }
  function hold(now = 0) {
    heldAt = now;
    held = true;
  }
  function release(now = 0) {
    if (!held) return;
    held = false;
    freeUntil = now + releaseMs;
  }

  /* 新桩：放到它明显强过的最上面那一行之前，没有就留在最后。 */
  function place(addr) {
    const rest = order.filter((a) => a !== addr);
    const at = rest.findIndex((other) => leads(addr, other));
    if (at < 0) rest.push(addr);
    else rest.splice(at, 0, addr);
    order = rest;
  }
  /* 回差排序：从上往下找第一行被下面某行持续强过的，把其中最强的那一行挪到它上面，直到没有。
   * 每次都挑最强的，挪动不会造出新的“该换没换”，所以一定停得下来；上限只是保险。 */
  function settle() {
    let guard = order.length * order.length + 1;
    let moved = true;
    while (moved && guard-- > 0) {
      moved = false;
      for (let i = 0; i < order.length && !moved; i++) {
        let best = -1;
        for (let j = i + 1; j < order.length; j++) {
          if (!sustained(order[j], order[i])) continue;
          if (best < 0 || strength(order[j]) > strength(order[best])) best = j;
        }
        if (best < 0) continue;
        const [addr] = order.splice(best, 1);
        order.splice(i, 0, addr);
        moved = true;
      }
    }
  }
  function arrange(now) {
    if (frozen(now)) return;
    if (unplaced.size) {
      const late = order.filter((a) => unplaced.has(a));
      unplaced = new Set();
      late.forEach(place);
    }
    settle();
  }
  function rows(now = 0) {
    arrange(now);
    return order.map((addr) => items.get(addr));
  }

  function update(list, now = 0) {
    const next = new Map();
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item || item.addr == null || next.has(item.addr)) return;
      next.set(item.addr, item);
    });
    if (!next.size) {
      reset();
      return [];
    }
    /* 消失的桩：记录全部去掉，再出现算新的。 */
    order = order.filter((addr) => next.has(addr));
    [ema, seen].forEach((map) => {
      Array.from(map.keys()).forEach((addr) => { if (!next.has(addr)) map.delete(addr); });
    });
    unplaced.forEach((addr) => { if (!next.has(addr)) unplaced.delete(addr); });
    items = next;

    const fresh = [];
    next.forEach((item, addr) => {
      ema.set(addr, smoothRssi(ema.get(addr), Number(item.rssi), alpha));
      if (!seen.has(addr)) {
        seen.set(addr, seq++);
        fresh.push(addr);
      }
    });
    /* 每一对：强过回差就加一次，没强过就清掉。冻住时也照样数，松手后该换的马上换。 */
    const counts = new Map();
    order.forEach((x) => {
      order.forEach((y) => {
        if (x === y || !leads(x, y)) return;
        const key = pairKey(x, y);
        counts.set(key, (lead.get(key) || 0) + 1);
      });
    });
    lead = counts;

    const still = frozen(now);
    fresh.forEach((addr) => {
      if (still) {
        order.push(addr);
        unplaced.add(addr);
      } else {
        place(addr);
      }
    });
    return rows(now);
  }

  return {
    update, rows, hold, release, frozen, reset,
    order: () => order.slice(),
    smoothed: (addr) => (ema.has(addr) ? ema.get(addr) : null),
    firstSeen: (addr) => (seen.has(addr) ? seen.get(addr) : null),
  };
}
