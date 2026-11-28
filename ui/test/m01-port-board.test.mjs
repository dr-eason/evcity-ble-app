/* 首页 10 路格子（port-board.js）的主机测试：
 *
 *     node --test APP/ui/test/
 *
 * 先把原来"数卡住、不准"的几个原因在这里复现出来（老办法：每秒推送的 ACK PORTS / PORTX），
 * 再测新的办法：SNAPGET 一问一答、请求号、校验、每格的更新时刻。快照的样例行取自
 * 文档/04-协议/M01蓝牙协议.md，校验值和固件主机测试 tests/host/test_port_snap.c 一样。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createQueue } from "../src/m01/ble-queue.js";
import { parsePort, parsePorts } from "../src/m01/ports.js";
import {
  AGE_OLD_MS, AGE_STALE_MS, SNAP_ASK_MS, SNAP_GAP_MS, SNAP_LAG_MISSES, SNAP_PER_LINE,
  applyPushPorts, applyPushPortsX, applySnapPages, crc16, createSnapPoller, emptyBoard, freshness, newestAge,
  parseSnap, snapCollector, snapCommand,
} from "../src/m01/port-board.js";
import { atModeStream, javaSource, phoneKeeps, splitFrames } from "./helpers/m01-phone-layer.mjs";
/* M01 仓库里的固件头文件和协议文档，拷了一份在 test/fixtures/m01/（见那里的 README.md）。 */
const fixture = (name) => readFileSync(new URL("./fixtures/m01/" + name, import.meta.url), "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(repo, path), "utf8");
const T = (text) => text.replace(/⇥/g, "\t");
const doc = fixture("M01蓝牙协议.md");
const appVue = read("APP/ui/src/m01/M01App.vue");

const SNAP_1 = T("ACK SNAP⇥41⇥10⇥1⇥2300⇥P,0,0,0,0,-;P,0,0,0,0,-;C,460,24,12,200,-;C,4,96,752,2,4904;X,0,0,0,0,-⇥5540");
const SNAP_2 = T("ACK SNAP⇥41⇥10⇥6⇥2300⇥U,0,0,0,0,-;R,0,0,0,0,-;P,0,0,0,0,-;P,0,0,0,0,-;P,0,0,0,0,-⇥933A");

/* 和固件 port_snap_format() 一样拼一行（测试里的假桩用）。 */
function fmtSnap(id, count, first, busDv, items) {
  const groups = items.map((it) => [it.s, it.w || 0, it.wh || 0, it.sec || 0, it.ca || 0,
    it.bal === undefined || it.bal === null ? "-" : it.bal].join(","));
  const body = ["ACK SNAP", id, count, first, busDv === null ? "-" : busDv, groups.join(";")].join("\t");
  return body + "\t" + crc16(body).toString(16).toUpperCase().padStart(4, "0");
}
/* 假桩的 10 路：第 n 路的数和 tick 有关，好分辨是哪一次取的。 */
function pileLines(id, tick, count = 10) {
  const lines = [];
  for (let first = 1; first <= count; first += SNAP_PER_LINE) {
    const items = [];
    for (let p = first; p < first + SNAP_PER_LINE && p <= count; p++) {
      items.push(p % 2 ? { s: "C", w: 100 * p + tick, wh: tick, sec: tick, ca: 50 * p } : { s: "P" });
    }
    lines.push(fmtSnap(id, count, first, 2304, items));
  }
  return lines;
}

/* ------------------------------------------------------------------ 原来的毛病 */

test("复现：AT 模式下一行拆在两次通知里、中间隔过 120 ms，半行会被当成整行，老的解析认下了错数", () => {
  /* 手机那一层（MainActivity.takeFrames）等 120 ms 凑不齐就把手里的当一行交上去。
   * splitFrames 的最后一段就是这样处理的。 */
  const portO = T("ACK PORT⇥4⇥C⇥230.0⇥0.02⇥4⇥96⇥752⇥40096⇥800⇥NONE⇥0⇥OFFCARD⇥A0000001⇥0⇥2⇥5000⇥96⇥4904⇥1000⇥180");
  const half = portO.slice(0, portO.indexOf("4904") + 2);
  const [line] = splitFrames(half);
  assert.equal(line, half);
  const got = parsePort(line);
  assert.ok(got, "半行也能通过 ACK PORT 的解析");
  assert.equal(got.balance, 49);            /* 实际是 4904：余额显示成了 0.049 元 */
  assert.equal(got.rate, 0);
  /* ACK PORTS：第 10 路的时长 125 秒被截成 12 秒，照样认。 */
  const ports = "ACK PORTS\t10\t" + Array(9).fill("P,0,0,0").join(";") + ";C,460,24,125";
  const cut = parsePorts(splitFrames(ports.slice(0, -1))[0]);
  assert.ok(cut && cut.ports[9].sec === 12);
  /* 新的快照行：任何一种截短都认不出来。 */
  for (let n = 0; n < SNAP_1.length; n++) assert.equal(parseSnap(splitFrames(SNAP_1.slice(0, n))[0] || ""), null, n);
});

test("复现：老办法的格子没有更新时刻，推送停了界面也看不出来", () => {
  /* 老的 App 只有一个 portsAt；格子本身不知道自己多旧。新的每一格都有自己的时刻。 */
  let board = emptyBoard(10);
  board = applyPushPorts(board, parsePorts("ACK PORTS\t10\t" + Array(10).fill("C,100,1,1").join(";")), 1000, 230.4);
  assert.equal(freshness(board.at[0], 1000 + 3000).level, "ok");
  assert.equal(freshness(board.at[0], 1000 + AGE_OLD_MS + 1).level, "old");
  assert.equal(freshness(board.at[0], 1000 + AGE_STALE_MS + 1).level, "stale");
  /* PORTX 没到之前电流是"不知道"，不是 0 A。 */
  assert.equal(board.x[0], null);
  /* 端口数对不上的 PORTX（并充模式刚改，推送里还是老的端口数）不往格子里写。 */
  assert.equal(applyPushPortsX(board, { count: 5, ports: [] }), board);
});

/* ------------------------------------------------------------------ 协议 */

test("ACK SNAP：解析、校验、各种坏行", () => {
  assert.equal(crc16("123456789"), 0x4B37);
  const a = parseSnap(SNAP_1);
  assert.deepEqual(a, {
    id: 41, count: 10, first: 1, busV: 230,
    ports: [
      { port: 1, s: "P", w: 0, wh: 0, sec: 0, a: 0, bal: null },
      { port: 2, s: "P", w: 0, wh: 0, sec: 0, a: 0, bal: null },
      { port: 3, s: "C", w: 460, wh: 24, sec: 12, a: 2, bal: null },
      { port: 4, s: "C", w: 4, wh: 96, sec: 752, a: 0.02, bal: 4904 },
      { port: 5, s: "X", w: 0, wh: 0, sec: 0, a: 0, bal: null },
    ],
  });
  const b = parseSnap(SNAP_2);
  assert.deepEqual(b.ports.map((p) => p.port + p.s), ["6U", "7R", "8P", "9P", "10P"]);
  /* 没有母线电压；并充两路一行；带 \r\n。 */
  const two = fmtSnap(9, 2, 1, null, [{ s: "C", w: 900, ca: 400 }, { s: "P" }]);
  assert.deepEqual(parseSnap(two + "\r\n").ports.map((p) => p.port), [1, 2]);
  assert.equal(parseSnap(two).busV, null);
  const bad = [
    SNAP_1.replace("460", "560"),                       /* 改了一个数，校验对不上 */
    SNAP_1.replace("5540", "5541"),
    SNAP_1.replace("\t5540", ""),                       /* 没有校验 */
    SNAP_1.replace("5540", "5540\tX"),
    fmtSnap(0, 10, 1, 2300, Array(5).fill({ s: "P" })),  /* 请求号 0 */
    fmtSnap(1, 10, 2, 2300, Array(5).fill({ s: "P" })),  /* 起始端口不是 1、6、11… */
    fmtSnap(1, 10, 11, 2300, Array(5).fill({ s: "P" })), /* 起始端口超过端口数 */
    fmtSnap(1, 10, 1, 2300, Array(4).fill({ s: "P" })),  /* 组数不对 */
    fmtSnap(1, 10, 6, 2300, Array(6).fill({ s: "P" })),
    fmtSnap(1, 10, 1, 2300, Array(5).fill({ s: "p" })),
    fmtSnap(1, 10, 1, 2300, Array(5).fill({ s: "P", w: 100000 })),
    fmtSnap(1, 10, 1, "2x", Array(5).fill({ s: "P" })),
    fmtSnap(1, 10, 1, 2300, Array(5).fill({ s: "C", bal: "x" })),
    "ACK SNAP\t0\tARG", T("ACK PORTS⇥10⇥P,0,0,0"), null, "",
  ];
  for (const line of bad) assert.equal(parseSnap(line), null, String(line));
});

test("一次快照的收集：只认这个请求号，同一页只收一次，收齐了才算完", () => {
  const box = snapCollector(41);
  assert.equal(box.done(), false);
  assert.equal(box.feed(SNAP_2.replace("41", "40")), false);   /* 别的号（校验也不对） */
  assert.equal(box.feed(pileLines(40, 1)[0]), false);          /* 上一次的晚到的行 */
  assert.equal(box.feed(SNAP_2), true);
  assert.equal(box.done(), false);
  assert.equal(box.feed(SNAP_2), false);                       /* 重复 */
  assert.equal(box.feed(fmtSnap(41, 5, 1, 2300, Array(5).fill({ s: "P" }))), false); /* 端口数变了 */
  assert.equal(box.feed(SNAP_1), true);
  assert.equal(box.done(), true);
  assert.deepEqual(box.pages().map((p) => p.first), [1, 6]);
});

/* ------------------------------------------------------------------ 格子 */

test("格子：快照只更新它带的那几路，时刻各记各的；端口数变了从头来", () => {
  let board = emptyBoard(10);
  board = applySnapPages(board, [parseSnap(SNAP_1)], 5000);
  assert.deepEqual(board.at, [5000, 5000, 5000, 5000, 5000, 0, 0, 0, 0, 0]);
  assert.equal(board.ports[2].w, 460);
  assert.equal(board.x[3].bal, 4904);
  assert.equal(board.v[0], 230);
  assert.equal(board.x[6], null);
  board = applySnapPages(board, [parseSnap(SNAP_2)], 7000);
  assert.deepEqual(board.at, [5000, 5000, 5000, 5000, 5000, 7000, 7000, 7000, 7000, 7000]);
  assert.equal(newestAge(board, 7000 + AGE_OLD_MS + 1).level, "old");
  assert.equal(newestAge(emptyBoard(10), 1).level, "none");
  /* 并充改成 2 路。 */
  const two = parseSnap(fmtSnap(9, 2, 1, null, [{ s: "C", w: 900, ca: 400 }, { s: "P" }]));
  board = applySnapPages(board, [two], 9000);
  assert.equal(board.ports.length, 2);
  assert.deepEqual(board.at, [9000, 9000]);
  assert.equal(board.v[0], null);
  /* 没有页：原样返回。 */
  assert.equal(applySnapPages(board, [], 1), board);
  assert.deepEqual(freshness(0, 1), { level: "none", sec: 0 });
  assert.deepEqual(freshness(1000, 1000 + AGE_STALE_MS + 1500), { level: "stale", sec: 16 });
});

/* ------------------------------------------------------------------ 和蓝牙队列一起跑 */

/* 假时钟 + 真的 ble-queue + 一个假桩。桩收到 SNAPGET 以后 delay 毫秒回两行（drop 里的
 * 页不回）；不认 SNAPGET 的老桩什么都不回。 */
function rig(opts = {}) {
  let clock = 0;
  let timers = [];
  let tick = 0;
  const sent = [];
  /* at：AT 模式，两行经手机那一层（模组把逗号换成 0x00、没有换行）再交给队列。
   * mute：这一次一行都不回（丢包、串口被占着）。
   * snap：兼容框架说这台桩认不认 SNAPGET（fw-compat.js 的 snapshot），默认认。 */
  const pile = { delay: 80, drop: [], old: false, late: 0, at: false, mute: false, snap: true };
  Object.assign(pile, opts);
  const queue = createQueue({
    send(command) {
      sent.push(command);
      const m = /^SNAPGET\t(\d+)$/.exec(command);
      if (!m || pile.old) return;
      tick += 1;
      if (pile.mute) return;
      let lines = pileLines(Number(m[1]), tick).filter((line, i) => pile.drop.indexOf(i) < 0);
      const wait = pile.late ? pile.late : pile.delay;
      pile.late = 0;
      if (pile.at) lines = splitFrames(atModeStream(lines));
      lines.forEach((line, i) => {
        at(wait + 30 * i, () => queue.feed(line));
      });
    },
    setTimer: (fn, ms) => at(ms, fn),
    clearTimer: (id) => { timers = timers.filter((item) => item.id !== id); },
  });
  let nextId = 1;
  function at(ms, fn) {
    const id = nextId++;
    timers.push({ id, when: clock + ms, fn });
    return id;
  }
  async function run(ms) {
    const end = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.when - b.when);
      const due = timers[0];
      if (!due || due.when > end) break;
      timers.shift();
      clock = due.when;
      due.fn();
      await new Promise((r) => setImmediate(r));
    }
    clock = end;
    await new Promise((r) => setImmediate(r));
  }
  const poller = createSnapPoller({
    ask: (c, a, ms, o) => queue.ask(c, a, ms, o), now: () => clock, supported: () => pile.snap,
  });
  return { queue, poller, pile, sent, run, now: () => clock, at };
}

test("快照：一问一答拿齐 10 路；两次之间至少隔 1.5 秒", async () => {
  const r = rig();
  assert.equal(r.poller.mode, "on");
  assert.equal(r.poller.due(), true);
  const p = r.poller.poll();
  assert.equal(r.poller.busy, true);
  assert.equal(r.poller.due(), false);
  await r.run(500);
  const got = await p;
  assert.equal(r.poller.mode, "on");
  assert.deepEqual(got.pages.map((page) => page.first), [1, 6]);
  assert.equal(got.pages[1].ports[4].port, 10);
  assert.ok(r.queue.idle());
  assert.equal(r.poller.due(r.now() + SNAP_GAP_MS - 600), false);
  assert.equal(r.poller.due(r.now() + SNAP_GAP_MS), true);
  assert.deepEqual(r.sent, ["SNAPGET\t1"]);
});

test("快照：一行没到，只更新到了的那 5 路，另外 5 路的时刻不动", async () => {
  const r = rig({ drop: [1] });
  const p = r.poller.poll();
  await r.run(SNAP_ASK_MS + 100);
  const got = await p;
  assert.deepEqual(got.pages.map((page) => page.first), [1]);
  let board = applySnapPages(emptyBoard(10), got.pages, r.now());
  assert.deepEqual(board.at.map(Boolean), [true, true, true, true, true, false, false, false, false, false]);
  assert.equal(r.poller.mode, "on");
});

test("快照：上一次的应答晚到，落在下一次的等待里，也不会被当成这一次的", async () => {
  const r = rig({ late: SNAP_ASK_MS + 400 });
  const p1 = r.poller.poll();
  await r.run(SNAP_ASK_MS + 10);
  assert.deepEqual((await p1).pages, []);
  /* 第二次马上发；第一次的两行在它等待的时候到。 */
  const p2 = r.poller.poll();
  await r.run(1000);
  const got = await p2;
  assert.equal(got.id, 2);
  assert.ok(got.pages.length === 2 && got.pages.every((page) => page.id === 2));
  /* 第二次的数是桩第二次取的（tick 2），不是第一次的。 */
  assert.equal(got.pages[0].ports[0].wh, 2);
  assert.deepEqual(r.sent, ["SNAPGET\t1", "SNAPGET\t2"]);
});

test("快照：和别的命令排队，一次只有一条在路上，单路详情的应答不会被快照吃掉", async () => {
  const r = rig();
  const p = r.poller.poll();
  const detail = r.queue.ask("PORTGET\t3", (line) => line.indexOf("ACK PORT\t3\t") === 0, 1500);
  assert.deepEqual(r.sent, ["SNAPGET\t1"]);
  await r.run(300);
  assert.equal((await p).pages.length, 2);
  assert.deepEqual(r.sent, ["SNAPGET\t1", "PORTGET\t3"]);
  r.at(50, () => r.queue.feed(T("ACK PORT⇥3⇥C⇥230.0⇥2.00⇥460⇥24⇥12⇥30024⇥800⇥NONE⇥0⇥BLE⇥-⇥0⇥0⇥0⇥0⇥0⇥0⇥0")));
  await r.run(100);
  assert.ok((await detail).indexOf("ACK PORT\t3\t") === 0);
});

test("老固件（兼容框架说没有 snapshot）：一次 SNAPGET 都不发，首页用推送", async () => {
  const r = rig({ old: true, snap: false });
  assert.equal(r.poller.mode, "off");
  assert.equal(r.poller.lagging, false);
  for (let sec = 0; sec < 120; sec++) {
    assert.equal(r.poller.due(), false);
    await r.run(1000);
  }
  assert.deepEqual(r.sent, []);
  /* 换一条连接也一样，不看回不回。 */
  r.poller.reset();
  assert.equal(r.poller.mode, "off");
  assert.equal(r.poller.due(), false);
});

test("刚连上还没拿到固件版本（按最老的算）：先用推送；拿到 1.3.2 起的版本，下一拍就问快照", async () => {
  const r = rig({ snap: false });
  assert.equal(r.poller.mode, "off");
  assert.equal(r.poller.due(), false);
  await r.run(800);
  r.pile.snap = true;             /* ACK SYS 到了：fwInfo 换成 1.3.2，supports(…, "snapshot") 为真 */
  assert.equal(r.poller.mode, "on");
  assert.equal(r.poller.due(), true);
  const p = r.poller.poll();
  await r.run(500);
  assert.equal((await p).pages.length, 2);
  assert.equal(r.poller.due(r.now() + SNAP_GAP_MS), true);
  /* 换成老固件的桩（断开后连了另一台）：不再问。 */
  r.poller.reset();
  r.pile.snap = false;
  assert.equal(r.poller.due(), false);
});

test("认 SNAPGET 的桩一时没回（串口被 OCPP 占着）：不退回老办法，没回的那几次推送照写格子，快照一回来又只认快照", async () => {
  const r = rig();
  const p = r.poller.poll();
  await r.run(500);
  assert.equal((await p).pages.length, 2);
  assert.equal(r.poller.lagging, false);
  /* 连着 5 次不回：还是 on（不看回不回），推送照写格子。 */
  r.pile.old = true;
  for (let i = 0; i < 5; i++) {
    const q = r.poller.poll();
    await r.run(SNAP_ASK_MS + 10);
    await q;
  }
  assert.equal(r.poller.mode, "on");
  /* 没回的这几次推送照写格子（lagging）；快照一回来就又只认快照。 */
  assert.equal(r.poller.lagging, true);
  r.pile.old = false;
  const back = r.poller.poll();
  await r.run(500);
  assert.equal((await back).pages.length, 2);
  assert.equal(r.poller.lagging, false);
});

test("断开（reset）时正在等的那一次：不留 busy，不记成没回", async () => {
  const r = rig({ mute: true });
  const p = r.poller.poll();
  assert.equal(r.poller.busy, true);
  r.queue.reset();
  r.poller.reset();
  assert.equal(r.poller.busy, false);
  assert.deepEqual((await p).pages, []);
  assert.equal(r.poller.busy, false);
  assert.equal(r.poller.mode, "on");
  assert.equal(r.poller.due(), true);
  r.pile.mute = false;
  const q = r.poller.poll();
  await r.run(500);
  assert.equal((await q).pages.length, 2);
});

test("请求号 1..65535 轮着用，不出 0", async () => {
  const r = rig({ old: true });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const p = r.poller.poll();
    await r.run(SNAP_ASK_MS + 10);
    ids.push((await p).id);
  }
  assert.deepEqual(ids, [1, 2, 3]);
});

/* ------------------------------------------------------------------ 2026-11-23 首页卡在"已过期" */

test("复现：AT 模式下模组把逗号换成 0x00，手机那一层原来整行丢掉，首页再也收不到快照", () => {
  /* 手机上抓到的原样字节：AT+BLESEND 发出去的 ACK SNAP，逗号全成了 0x00，长度不变。 */
  const stream = atModeStream([SNAP_1, SNAP_2]);
  assert.equal(stream.length, SNAP_1.length + SNAP_2.length);
  assert.ok(stream.indexOf(",") < 0 && stream.indexOf("\0") > 0);
  /* 原来的 acceptFrame：有控制字符就整行不要。 */
  const oldLayer = (raw) => (/[\x00-\x08\x0A-\x1F\x7F]/.test(raw) ? null : raw);
  assert.equal(oldLayer(stream.slice(0, SNAP_1.length)), null);
  /* 现在：换回逗号，两行原样交上去，校验对得上。 */
  assert.deepEqual(splitFrames(stream), [SNAP_1, SNAP_2]);
  assert.ok(parseSnap(splitFrames(stream)[0]) && parseSnap(splitFrames(stream)[1]));
  /* 推送的 ACK PORTS 和 ACK PLIM 也带逗号，一样换回来。 */
  const ports = "ACK PORTS\t10\t" + Array(10).fill("C,100,1,1").join(";");
  const plim = T("ACK PLIM⇥10⇥50⇥2000⇥800,800,800,800,800,800,800,800,800,800");
  assert.deepEqual(splitFrames(atModeStream([ports, plim])), [ports, plim]);
  /* MainActivity.acceptFrame 里确实有这一步（helpers/phone-layer.mjs 照它写）。 */
  const accept = javaSource.slice(javaSource.indexOf("private void acceptFrame("), javaSource.indexOf("private static boolean printableLine("));
  assert.match(accept, /if \(raw\[i\] == 0\) \{\s*raw\[i\] = ',';/);
  assert.ok(accept.indexOf("raw[i] = ','") < accept.indexOf("printableLine(line)"));
});

test("AT 模式：快照经手机那一层照样一问一答拿齐 10 路", async () => {
  const r = rig({ at: true });
  for (let i = 0; i < 3; i++) {
    const p = r.poller.poll();
    await r.run(SNAP_ASK_MS + 10);
    const got = await p;
    assert.deepEqual(got.pages.map((page) => page.first), [1, 6]);
  }
  assert.equal(r.poller.mode, "on");
});

test("App.vue：认不认 SNAPGET 问兼容框架；快照连着没回时推送照写格子；首页每一拍都看 due()", () => {
  assert.match(appVue, /createSnapPoller\(\{ ask, supported: \(\) => can\("snapshot"\) \}\)/);
  assert.match(appVue, /function applyPorts\(got\) \{\s*if \(snapPoller\.mode === "on" && !snapPoller\.lagging\) return;/);
  assert.match(appVue, /if \(snapPoller\.mode !== "on" \|\| snapPoller\.lagging\) setBoard\(applyPushPortsX\(/);
  assert.match(appVue, /else if \(page\.value === "charge"\) \{\s*if \(snapPoller\.due\(\)\) pollSnap\(\);/);
});

/* 照 App.vue 的做法跑一个首页：每秒一拍，队列空着、due() 就问一次快照；桩每秒推一组
 * ACK PORTS（经手机那一层）；格子按 applyLine / applyPorts / applySnap 的规矩更新。 */
function homePage(r) {
  let board = emptyBoard(10);
  let pushTick = 0;
  const pushOn = { value: true };
  const feedLine = (line) => {
    if (r.queue.feed(line)) return;
    const got = parsePorts(line);
    if (!got) return;
    if (r.poller.mode === "on" && !r.poller.lagging) return;
    board = applyPushPorts(board, got, r.now(), 230.4);
  };
  function tick() {
    if (r.queue.idle() && r.poller.due()) {
      r.poller.poll().then((got) => { board = applySnapPages(board, got.pages, r.now()); });
    }
    r.at(1000, tick);
  }
  function push() {
    if (pushOn.value) {
      pushTick += 1;
      const line = "ACK PORTS\t10\t" + Array(10).fill("C," + pushTick + ",1,1").join(";");
      splitFrames(atModeStream([line])).forEach(feedLine);
    }
    r.at(1000, push);
  }
  r.at(1000, tick);
  r.at(1300, push);
  return { board: () => board, pushOn };
}

test("长跑 15 分钟：随机丢行、丢整次、晚到，中间两段断流；从不永久卡住，断流一停几秒内恢复", async () => {
  const r = rig({ at: true });
  const home = homePage(r);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  /* 每次问之前随机定这一次怎么丢：10% 整次不回，10% 丢一行，5% 晚到（超过 2.5 秒）。 */
  const send = r.queue;
  const plan = () => {
    const x = rnd();
    r.pile.mute = x < 0.10;
    r.pile.drop = x >= 0.10 && x < 0.20 ? [x < 0.15 ? 0 : 1] : [];
    if (x >= 0.20 && x < 0.25) r.pile.late = SNAP_ASK_MS + 300;
  };
  let worst = 0;
  let staleSeen = 0;
  let oldSeen = 0;
  let settledSecs = 0;
  const outage1 = [300, 360];      /* 第 5 分钟起 60 秒：快照一行不回，推送照常 */
  const outage2 = [600, 640];      /* 第 10 分钟起 40 秒：什么都不回（人走远了） */
  for (let sec = 1; sec <= 900; sec++) {
    const inOut1 = sec >= outage1[0] && sec < outage1[1];
    const inOut2 = sec >= outage2[0] && sec < outage2[1];
    plan();
    if (inOut1 || inOut2) r.pile.mute = true;
    home.pushOn.value = !inOut2;
    await r.run(1000);
    const age = newestAge(home.board(), r.now());
    if (age.level === "stale") staleSeen += 1;
    /* 断流 2 那一段以外，最新的格子不能旧过 AGE_OLD_MS；断流 2 停了以后 5 秒内要回来。 */
    const settled = !inOut2 && !(sec >= outage2[1] && sec < outage2[1] + 5) && sec > 5;
    if (settled) {
      const ms = r.now() - Math.max(...home.board().at);
      worst = Math.max(worst, ms);
      settledSecs += 1;
      if (ms > AGE_OLD_MS) oldSeen += 1;
    }
  }
  /* 连着几次随机丢包时会有几秒写"几秒前"，但从不过期；绝大多数时候是新的。 */
  assert.ok(worst < AGE_STALE_MS, "最新的格子最多旧了 " + worst + " ms");
  assert.ok(oldSeen * 50 < settledSecs, "写几秒前的有 " + oldSeen + " / " + settledSecs + " 秒");
  assert.ok(staleSeen > 0 && staleSeen < 40, "只有断流 2 那一段会过期：" + staleSeen);
  assert.equal(r.poller.mode, "on");
  /* 一直在问：15 分钟里快照问了几百次，没有停下来。 */
  assert.ok(r.sent.filter((c) => c.indexOf("SNAPGET\t") === 0).length > 300);
  /* 最后一刻 10 格全是新的。 */
  assert.ok(home.board().at.every((t) => r.now() - t <= AGE_OLD_MS));
  assert.ok(send.pending() <= 1);
});
