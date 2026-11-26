/* 蓝牙 OTA 滑动窗口的主机测试。不需要手机和桩：
 *
 *     node --test M01/tools/ble-finder/ui/test/*.test.mjs
 *
 * 这里有一台假桩，按固件 ota.c 的规则收片和应答：紧接上一片才写入；重发刚写完的那片回 OK
 * 不再写；别的偏移回 FAIL。时间是假的（毫秒计数），不用真等。发送走的是 App 真正用的
 * sendOtaChunks。每个用例最后都核对：写入的片号正好是 0..total-1，按顺序、各一次。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  OTA_ACK_MS, OTA_MAX_TRIES, OTA_WINDOW, OTA_WINDOW_DROP_AFTER, OTA_WINDOW_MIN_MTU,
  createOtaSender, otaWindowFor, parseDataAck, sendOtaChunks,
} from "../src/m01/ota-window.js";

/* fault(seq, nth)：第 seq 片第 nth 次到达桩时出什么事。
 *   "lost"    这一片没拼成：不写、不应答（串口丢字节，或模组的 OK 插进了拼接）
 *   "crc"     CRC16 不对：不写，回 FAIL
 *   "noack"   写了，但应答没到手机
 *   "dead"    升级会话没了：回不带序号的 FAIL
 * ackDelay(seq, nth)：这条应答额外晚多少毫秒到手机。 */
function makeRig(total, window, options) {
  const opt = options || {};
  const rig = {
    now: 0,
    writes: [],       /* 桩真正写入 Flash 的片号，按先后 */
    sends: [],        /* 手机发出的片号，按先后 */
    maxAhead: 0,      /* 发出时比桩已写入的超前了几片，最大值 */
    progress: [],
    cancelAt: -1,
  };
  let filled = 0;
  let uartFree = 0;
  const arrivals = {};
  const events = [];  /* { at, ack } 应答到达手机的时刻 */

  function pile(seq) {
    arrivals[seq] = (arrivals[seq] || 0) + 1;
    const nth = arrivals[seq];
    const fault = opt.fault ? opt.fault(seq, nth) : "";
    if (fault === "lost") return null;
    if (fault === "dead") return { seq: -1, ok: false };
    if (fault === "crc") return { seq, ok: false };
    let ok = false;
    if (seq === filled) {
      rig.writes.push(seq);
      filled++;
      ok = true;
    } else if (seq === filled - 1) {
      ok = true;
    }
    if (fault === "noack") return null;
    return { seq, ok };
  }

  rig.io = {
    total,
    window,
    now: () => rig.now,
    alive: () => rig.cancelAt < 0 || rig.sends.length < rig.cancelAt,
    progress: (n) => rig.progress.push(n),
    send(seq) {
      rig.sends.push(seq);
      rig.maxAhead = Math.max(rig.maxAhead, seq - filled);
      /* 串口一片约 50 ms，前一片没走完就排在后面。 */
      uartFree = Math.max(rig.now, uartFree) + 50;
      const arrive = uartFree;
      const nth = (arrivals[seq] || 0) + 1;
      const extra = opt.ackDelay ? opt.ackDelay(seq, nth) : 0;
      events.push({ arrive, seq, extra });
      events.sort((a, b) => a.arrive - b.arrive);
    },
    waitAck(ms) {
      const limit = rig.now + ms;
      for (;;) {
        /* 先让已到桩的片按到达顺序处理，再看有没有应答到手机。 */
        const acks = events.filter((e) => e.ack !== undefined);
        const raw = events.find((e) => e.ack === undefined);
        const nextAck = acks.reduce((best, e) => (!best || e.at < best.at ? e : best), null);
        if (raw && raw.arrive <= limit && (!nextAck || raw.arrive <= nextAck.at)) {
          rig.now = Math.max(rig.now, raw.arrive);
          const ack = pile(raw.seq);
          if (ack) {
            raw.ack = ack;
            raw.at = raw.arrive + 20 + raw.extra;
          } else {
            events.splice(events.indexOf(raw), 1);
          }
          continue;
        }
        if (nextAck && nextAck.at <= limit) {
          rig.now = Math.max(rig.now, nextAck.at);
          events.splice(events.indexOf(nextAck), 1);
          return Promise.resolve(nextAck.ack);
        }
        rig.now = limit;
        return Promise.resolve(null);
      }
    },
  };
  rig.filled = () => filled;
  return rig;
}

function inOrderOnce(rig, total) {
  assert.deepEqual(rig.writes, Array.from({ length: total }, (_, i) => i));
}

test("parseDataAck：只认 OTADATA 的应答", () => {
  assert.deepEqual(parseDataAck("ACK OTADATA 12 OK"), { seq: 12, ok: true });
  assert.deepEqual(parseDataAck("ACK OTADATA 0 FAIL\r"), { seq: 0, ok: false });
  assert.deepEqual(parseDataAck("ACK OTADATA FAIL"), { seq: -1, ok: false });
  assert.equal(parseDataAck("ACK OTASTART OK"), null);
  assert.equal(parseDataAck("ACK OTADATA 3"), null);
  assert.equal(parseDataAck("ACK OTADATA x OK"), null);
  assert.equal(parseDataAck("ACK OTADATA 3 BUSY"), null);
  assert.equal(parseDataAck(""), null);
  assert.equal(parseDataAck(null), null);
});

test("otaWindowFor：MTU 小就发一片等一片", () => {
  assert.equal(otaWindowFor(247), OTA_WINDOW);
  assert.equal(otaWindowFor(OTA_WINDOW_MIN_MTU), OTA_WINDOW);
  assert.equal(otaWindowFor(OTA_WINDOW_MIN_MTU - 1), 1);
  assert.equal(otaWindowFor(23), 1);
  assert.equal(otaWindowFor(undefined), 1);
  assert.ok(OTA_WINDOW >= 1 && OTA_WINDOW <= 3);
});

test("没有差错：每片只发一次，在途不超过窗口", async () => {
  for (const window of [1, 2, 3]) {
    const rig = makeRig(629, window);
    assert.equal(await sendOtaChunks(rig.io), "done");
    inOrderOnce(rig, 629);
    assert.equal(rig.sends.length, 629);
    assert.equal(rig.maxAhead, window - 1);
    assert.equal(rig.progress[rig.progress.length - 1], 629);
  }
});

test("窗口 2 比窗口 1 快", async () => {
  const one = makeRig(200, 1);
  const two = makeRig(200, 2);
  await sendOtaChunks(one.io);
  await sendOtaChunks(two.io);
  assert.ok(two.now < one.now, two.now + " < " + one.now);
});

test("只有一片、总片数比窗口小", async () => {
  for (const total of [1, 2]) {
    const rig = makeRig(total, 3);
    assert.equal(await sendOtaChunks(rig.io), "done");
    inOrderOnce(rig, total);
  }
});

test("一片 CRC 不对：回退重发，后一片迟到的 FAIL 不算数", async () => {
  const rig = makeRig(40, 2, { fault: (seq, nth) => (seq === 7 && nth === 1 ? "crc" : "") });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 40);
  /* 7 发两次；8 在 7 失败时已经发出过一次，之后再发一次。 */
  assert.equal(rig.sends.filter((s) => s === 7).length, 2);
  assert.equal(rig.sends.filter((s) => s === 8).length, 2);
  assert.equal(rig.sends.length, 42);
});

test("一片没拼成且不应答：靠后一片的 FAIL 立刻回退，不用等超时", async () => {
  const rig = makeRig(40, 2, { fault: (seq, nth) => (seq === 7 && nth === 1 ? "lost" : "") });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 40);
  assert.ok(rig.now < 40 * 50 + OTA_ACK_MS, "耗时 " + rig.now);
});

test("最后一片丢了：后面没有片可以带出 FAIL，靠超时重发", async () => {
  const rig = makeRig(10, 2, { fault: (seq, nth) => (seq === 9 && nth === 1 ? "lost" : "") });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 10);
  assert.equal(rig.sends.filter((s) => s === 9).length, 2);
});

test("应答丢了：后一片的 OK 当累计确认，不重发", async () => {
  const rig = makeRig(40, 2, { fault: (seq, nth) => (seq === 7 && nth === 1 ? "noack" : "") });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 40);
  assert.equal(rig.sends.length, 40);
});

test("最后一片的应答丢了：超时重发，桩认出是刚写完的那片，不再写", async () => {
  const rig = makeRig(10, 2, { fault: (seq, nth) => (seq === 9 && nth === 1 ? "noack" : "") });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 10);
});

test("在途两片都写了但应答都丢了：重发前一片被拒，改发后一片试探，一次确认两片", async () => {
  for (const at of [10, 28]) {   /* 中间、最后两片 */
    const rig = makeRig(30, 2, { fault: (seq, nth) => ((seq === at || seq === at + 1) && nth === 1 ? "noack" : "") });
    assert.equal(await sendOtaChunks(rig.io), "done");
    inOrderOnce(rig, 30);
    assert.equal(rig.sends.length, 32);
  }
});

test("窗口 3 三片都写了但应答都丢了", async () => {
  const rig = makeRig(30, 3, { fault: (seq, nth) => (seq >= 10 && seq <= 12 && nth === 1 ? "noack" : "") });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 30);
});

test("模组的 OK 总是插进第二片：回退几次后改成发一片等一片，照样发完", async () => {
  /* 窗口里靠后的那一片（发出时桩还没写完前一片）每次都拼不成。 */
  const ahead = {};
  const rig = makeRig(120, 2, {
    fault: (seq, nth) => (ahead[seq + ":" + nth] ? "lost" : ""),
  });
  const plainSend = rig.io.send;
  const count = {};
  rig.io.send = (seq) => {
    count[seq] = (count[seq] || 0) + 1;
    if (seq > rig.filled()) ahead[seq + ":" + count[seq]] = true;
    plainSend(seq);
  };
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 120);
  /* 白发的片有限：降级前每次回退最多白发 2 片。 */
  assert.ok(rig.sends.length <= 120 + 2 * OTA_WINDOW_DROP_AFTER, "发了 " + rig.sends.length);
  /* 降级之后再没有超前发送。 */
  const tail = rig.sends.slice(-60);
  assert.deepEqual(tail, Array.from({ length: 60 }, (_, i) => 60 + i));
});

test("应答整体来晚（超过等待时间）：不误判失败，不重复写", async () => {
  const rig = makeRig(30, 2, {
    ackDelay: (seq, nth) => ((seq === 10 || seq === 11) && nth === 1 ? OTA_ACK_MS + 300 : 0),
  });
  assert.equal(await sendOtaChunks(rig.io), "done");
  inOrderOnce(rig, 30);
});

test("同一片一直失败：试满次数后放弃", async () => {
  for (const kind of ["lost", "crc"]) {
    const rig = makeRig(30, 2, { fault: (seq) => (seq === 5 ? kind : "") });
    assert.equal(await sendOtaChunks(rig.io), "fail");
    assert.deepEqual(rig.writes, [0, 1, 2, 3, 4]);
    assert.equal(rig.sends.filter((s) => s === 5).length, OTA_MAX_TRIES);
  }
});

test("升级会话没了（不带序号的 FAIL）：放弃", async () => {
  const rig = makeRig(30, 2, { fault: (seq) => (seq >= 5 ? "dead" : "") });
  assert.equal(await sendOtaChunks(rig.io), "fail");
  assert.deepEqual(rig.writes, [0, 1, 2, 3, 4]);
});

test("用户取消：马上停，不再发", async () => {
  const rig = makeRig(100, 2);
  rig.cancelAt = 20;
  assert.equal(await sendOtaChunks(rig.io), "cancel");
  assert.ok(rig.sends.length <= 21, "发了 " + rig.sends.length);
});

test("乱序、重复、过期的应答直接喂给状态机：不越界、不回头", () => {
  const sender = createOtaSender({ total: 10, window: 2 });
  assert.equal(sender.next(), 0);
  assert.equal(sender.next(), 1);
  assert.equal(sender.next(), -1);
  assert.equal(sender.onAck({ seq: 5, ok: true }), "ignore");    /* 没发过的片 */
  assert.equal(sender.onAck({ seq: 1, ok: true }), "progress");  /* 0 的应答丢了 */
  assert.equal(sender.base, 2);
  assert.equal(sender.onAck({ seq: 0, ok: true }), "ignore");    /* 迟到 */
  assert.equal(sender.onAck({ seq: 0, ok: false }), "ignore");
  assert.equal(sender.onAck(null), "ignore");
  assert.equal(sender.next(), 2);
  assert.equal(sender.next(), 3);
  assert.equal(sender.onTimeout(), "retry");
  assert.equal(sender.onAck({ seq: 3, ok: false }), "ignore");   /* 回退前发的 */
  assert.equal(sender.next(), 2);
  assert.equal(sender.next(), -1);                               /* 重发的这片单独发 */
  assert.equal(sender.onAck({ seq: 2, ok: true }), "progress");
  assert.equal(sender.next(), 3);
  assert.equal(sender.next(), 4);
});

test("随机差错 300 轮：要么发完且片序正确，要么明确放弃，绝不重复写或跳写", async () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let done = 0;
  for (let round = 0; round < 300; round++) {
    const total = 1 + Math.floor(rand() * 80);
    const window = 1 + Math.floor(rand() * 3);
    const rate = rand() * 0.3;
    const rig = makeRig(total, window, {
      fault: () => {
        if (rand() >= rate) return "";
        return ["lost", "crc", "noack"][Math.floor(rand() * 3)];
      },
      ackDelay: () => (rand() < rate / 4 ? Math.floor(rand() * 3000) : 0),
    });
    const result = await sendOtaChunks(rig.io);
    assert.ok(result === "done" || result === "fail", result);
    assert.deepEqual(rig.writes, Array.from({ length: rig.writes.length }, (_, i) => i));
    assert.ok(rig.maxAhead < window, "超前 " + rig.maxAhead);
    if (result === "done") {
      inOrderOnce(rig, total);
      done++;
    }
  }
  assert.ok(done > 150, "发完 " + done + " 轮");
});
