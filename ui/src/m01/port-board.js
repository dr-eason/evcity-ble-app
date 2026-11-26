/* 首页的 10 路格子：数从哪来、什么时候问、多旧了。
 *
 * 1.3.2 起桩认 SNAPGET⇥<请求号>，一次回全部端口的快照（文档/04-协议/M01蓝牙协议.md 5.1 节）：
 *   ACK SNAP⇥<请求号>⇥<端口数>⇥<起始端口>⇥<母线 0.1 V 或 ->⇥<组>;<组>…⇥<校验>
 *   组 = <s>,<W>,<Wh>,<秒>,<电流 0.01 A>,<离线刷卡余额 毫元 或 ->
 * 每行最多 5 路，10 路是两行。校验是最后一个制表符前面全部字符的 CRC-16/MODBUS（4 位大写
 * 十六进制），和固件 service/src/port_snap.c 一样。
 *
 * 为什么不再用每秒推送的 ACK PORTS / ACK PORTX：
 *   - 推送只在桩的蓝牙队列空、串口没被 OCPP 或 WiFi 占着的时候才发，经常一停好几秒，
 *     界面上的数停着不动，看不出是旧的；
 *   - 队列满时桩先丢状态行，ACK PORTS 和 ACK PORTX 可能一个到了一个没到，功率和电流
 *     不是同一时刻的；
 *   - AT 模式下的行没有换行，手机那一层靠行首切行、等 120 ms 收尾。一行拆在两次通知里、
 *     中间隔得久，前半行会被当成一整行交上来，最后一个数被截短了也能通过解析。
 * SNAPGET 是一问一答：带请求号，只收这个号的行；行带校验，截短的、拼错的都扔掉；
 * 每一格记下自己是什么时候更新的，旧了就在格子上标出来，不冒充最新值。
 *
 * 桩认不认 SNAPGET 由兼容框架定（fw-compat.js 的 snapshot 能力：1.3.2 起有）。不认的老固件
 * 用老办法（ACK PORTS / ACK PORTX 推送 + STATUS），格子照样标新旧；连上时还没拿到固件版本，
 * 也先按老办法，拿到以后下一拍就换成快照。
 *
 * 快照偶尔没回（丢包、超时）不能让格子一直停在旧数上：认 SNAPGET 的桩有一次没回，
 * 推送的 ACK PORTS / ACK PORTX 就照老办法写进格子（lagging），快照照常每 2 秒左右问，
 * 回了以后又只认快照。 */

export const SNAP_PER_LINE = 5;
export const SNAP_ID_MAX = 65535;
export const SNAP_ASK_MS = 2500;        /* 等一次快照（两行）最多这么久 */
export const SNAP_GAP_MS = 1500;        /* 两次快照之间至少隔这么久：首页每 2 秒左右一次 */
export const SNAP_LAG_MISSES = 1;       /* 认 SNAPGET 的桩连着这么多次没回：推送也往格子里写 */
export const AGE_OLD_MS = 5000;         /* 超过这么久没更新：格子上写几秒前 */
export const AGE_STALE_MS = 15000;      /* 超过这么久：算过期，数不再显示 */
const PORT_MAX = 16;

function clean(line) {
  return typeof line === "string" ? line.replace(/[\r\n]+$/, "") : null;
}
function uintOf(text, max) {
  const raw = String(text == null ? "" : text);
  if (!/^\d{1,10}$/.test(raw)) return null;
  const value = parseInt(raw, 10);
  return value <= max ? value : null;
}

/* CRC-16/MODBUS（初值 0xFFFF，多项式 0xA001 反射）。行里只有 ASCII。 */
export function crc16(text) {
  let crc = 0xFFFF;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) & 0xFF;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
  }
  return crc & 0xFFFF;
}
function hex4(n) {
  return ("000" + n.toString(16).toUpperCase()).slice(-4);
}

export function snapCommand(id) {
  return "SNAPGET\t" + id;
}

/* 一行 ACK SNAP → { id, count, first, busV, ports: [{ port, s, w, wh, sec, a, bal }] }。
 * 字段个数、校验、组数、每个数都要对，不对返回 null。busV 是伏（没有是 null），
 * a 是安培，bal 是毫元（不是离线刷卡订单是 null）。 */
export function parseSnap(line) {
  const text = clean(line);
  if (text === null || text.indexOf("ACK SNAP\t") !== 0) return null;
  const part = text.split("\t");
  if (part.length !== 7) return null;
  const tail = text.lastIndexOf("\t");
  if (!/^[0-9A-F]{4}$/.test(part[6]) || hex4(crc16(text.slice(0, tail))) !== part[6]) return null;
  const id = uintOf(part[1], SNAP_ID_MAX);
  const count = uintOf(part[2], PORT_MAX);
  const first = uintOf(part[3], PORT_MAX);
  if (!id || !count || !first || first > count || (first - 1) % SNAP_PER_LINE !== 0) return null;
  let busV = null;
  if (part[4] !== "-") {
    const dv = uintOf(part[4], 99999);
    if (dv === null) return null;
    busV = dv / 10;
  }
  const groups = part[5].split(";");
  if (groups.length !== Math.min(SNAP_PER_LINE, count - first + 1)) return null;
  const ports = [];
  for (let i = 0; i < groups.length; i++) {
    const item = groups[i].split(",");
    if (item.length !== 6 || !/^[A-Z?]$/.test(item[0])) return null;
    const w = uintOf(item[1], 99999);
    const wh = uintOf(item[2], 999999);
    const sec = uintOf(item[3], 999999);
    const ca = uintOf(item[4], 9999);
    const bal = item[5] === "-" ? null : uintOf(item[5], 99999999);
    if ([w, wh, sec, ca].some((n) => n === null) || (item[5] !== "-" && bal === null)) return null;
    ports.push({ port: first + i, s: item[0], w, wh, sec, a: ca / 100, bal });
  }
  return { id, count, first, busV, ports };
}

/* 收一次快照的几行：只认这个请求号；同一个起始端口只收第一行；端口数前后不一样的不收。 */
export function snapCollector(id) {
  const pages = [];
  let count = 0;
  return {
    /* 这一行是这次快照的，收下返回 true。 */
    feed(line) {
      const got = parseSnap(line);
      if (!got || got.id !== id) return false;
      if (count && got.count !== count) return false;
      if (pages.some((page) => page.first === got.first)) return false;
      count = got.count;
      pages.push(got);
      pages.sort((a, b) => a.first - b.first);
      return true;
    },
    done() {
      return count > 0 && pages.length === Math.ceil(count / SNAP_PER_LINE);
    },
    pages: () => pages.slice(),
  };
}

/* 首页的快照轮询。io.ask 就是 ble-queue 的 ask：一次只有一条命令在路上。
 *   io.supported()  这台桩认不认 SNAPGET（App.vue 里是 supports(固件, "snapshot")）
 *   mode        on（认，用快照）、off（不认，用推送）。跟着 supported() 走，不看回不回
 *   lagging     on 时连着 SNAP_LAG_MISSES 次没回：推送也写格子，不让格子停住
 *   due(now)    这一拍该不该问。off 时不问
 *   poll()      问一次，返回收到的几页（可能只有一页：另一行超时没到）
 * 哪一次没回都不会让它停下：下一拍照样问，回了就恢复。 */
export function createSnapPoller(io) {
  const now = io.now || (() => Date.now());
  const supported = typeof io.supported === "function" ? io.supported : () => true;
  let nextId = 1;
  let lastAsk = -Infinity;
  let misses = 0;
  let busy = false;
  let epoch = 0;              /* reset() 一次加 1：断开前发出、断开后才回来的那一次不算数 */

  function takeId() {
    const id = nextId;
    nextId = nextId >= SNAP_ID_MAX ? 1 : nextId + 1;
    return id;
  }

  return {
    get mode() { return supported() ? "on" : "off"; },
    get busy() { return busy; },
    get lagging() { return supported() && misses >= SNAP_LAG_MISSES; },
    reset() {
      epoch += 1;
      busy = false;
      lastAsk = -Infinity;
      misses = 0;
    },
    due(at) {
      const t = at === undefined ? now() : at;
      if (busy || !supported()) return false;
      return t - lastAsk >= SNAP_GAP_MS;
    },
    async poll() {
      if (busy) return { id: 0, pages: [] };
      busy = true;
      lastAsk = now();
      const mine = epoch;
      const id = takeId();
      const box = snapCollector(id);
      /* 每一行都喂给收集器；收齐了这条命令才算答完。中间那一行 accept 返回 false，
       * 界面那一边（applyLine）认得 ACK SNAP，不拿它做别的。 */
      try {
        await io.ask(snapCommand(id), (line) => box.feed(line) && box.done(), SNAP_ASK_MS, { consume: true });
      } catch (e) {
        /* 当没回处理，下一拍照样问。 */
      } finally {
        if (mine === epoch) busy = false;
      }
      if (mine !== epoch) return { id, pages: [] };
      const pages = box.pages();
      if (pages.length) misses = 0;
      else misses += 1;
      return { id, pages };
    },
  };
}

/* ------------------------------------------------------------------ 格子的数 */

/* 首页格子的数据：ports（状态、功率、电量、时长）、x（电流、余额，没有是 null）、v（这一格
 * 取数时的母线电压）、at（这一格最后一次更新的时刻，0 是还没有）。都是按端口 1..N 的数组。 */
export function emptyBoard(count) {
  const n = Math.max(0, Math.min(PORT_MAX, count | 0));
  return {
    ports: Array.from({ length: n }, (_, i) => ({ port: i + 1, s: "", w: 0, wh: 0, sec: 0 })),
    x: Array(n).fill(null),             /* 还不知道电流时是 null，界面上写 "— A" */
    v: Array(n).fill(null),
    at: Array(n).fill(0),
  };
}

/* 端口数变了（并充模式不同）从头来。 */
function sized(board, count) {
  return board && board.ports.length === count ? board : emptyBoard(count);
}

/* 快照的几页 → 新的 board。只动页里有的那几路，别的保持原样（时刻也不变）。 */
export function applySnapPages(board, pages, at) {
  if (!pages || !pages.length) return board;
  const out = sized(board, pages[0].count);
  const next = { ports: out.ports.slice(), x: out.x.slice(), v: out.v.slice(), at: out.at.slice() };
  pages.forEach((page) => {
    if (page.count !== next.ports.length) return;
    page.ports.forEach((item) => {
      const i = item.port - 1;
      next.ports[i] = { port: item.port, s: item.s, w: item.w, wh: item.wh, sec: item.sec };
      next.x[i] = { port: item.port, a: item.a, bal: item.bal };
      next.v[i] = page.busV;
      next.at[i] = at;
    });
  });
  return next;
}

/* 老固件：推送的 ACK PORTS（parsePorts 的结果）。电流、余额在另一行，到了再填。 */
export function applyPushPorts(board, got, at, busV) {
  const out = sized(board, got.count);
  const next = { ports: got.ports.slice(), x: out.x.slice(), v: out.v.slice(), at: out.at.slice() };
  got.ports.forEach((item) => {
    next.v[item.port - 1] = busV === undefined ? null : busV;
    next.at[item.port - 1] = at;
  });
  return next;
}

/* 老固件：推送的 ACK PORTX（parsePortsX 的结果）。端口数对不上的不要。 */
export function applyPushPortsX(board, got) {
  if (!board || got.count !== board.ports.length) return board;
  return { ...board, x: got.ports.slice() };
}

/* 这一格多旧了：level 是 none（还没有数）、ok、old（写几秒前）、stale（过期）。 */
export function freshness(at, now) {
  if (!at) return { level: "none", sec: 0 };
  const ms = Math.max(0, now - at);
  const sec = Math.floor(ms / 1000);
  if (ms > AGE_STALE_MS) return { level: "stale", sec };
  if (ms > AGE_OLD_MS) return { level: "old", sec };
  return { level: "ok", sec };
}

/* 全部格子里最新的那一格多旧了（首页提示用）。没有数返回 none。 */
export function newestAge(board, now) {
  const newest = board && board.at.length ? Math.max(...board.at) : 0;
  return freshness(newest, now);
}
