/* 手机自动授时的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/
 *
 * 假桩按固件 wb2.c 里 TIMESET 的规则应答；旧固件的假桩对 TIMESET 一声不吭。
 * 心跳校时（2.6.8）：假桩按 wb2.c 里 ble_heart_time 的规则处理带时间的心跳。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  heartbeatCarriesTime, heartbeatCommand, parseTimeAck, phoneTzMinutes, runTimeSync, shouldSync,
  switchFrom, timeSetCommand, versionTriple, zoneRereadDue,
} from "../src/time-sync.js";

const NOW_MS = 1800000000 * 1000 + 250;

/* 假桩。opts.old = 2.6.5 及更早的固件；opts.mute = 这些命令第一次不回（丢包）。 */
function fakePile(opts) {
  const pile = {
    wifi: !!opts.wifi, ocpp: !!opts.ocpp, old: !!opts.old,
    unix: null, tz: 480, sent: [], muted: Object.assign({}, opts.mute || {}),
  };
  pile.reply = (command) => {
    const name = command.split("\t")[0];
    if (pile.muted[name] > 0) { pile.muted[name] -= 1; return null; }
    if (command === "WIFISWGET") return "WIFISW " + (pile.wifi ? "1" : "0");
    if (command === "OCPPSWGET") return "OCPPSW " + (pile.ocpp ? "1" : "0");
    if (name === "TIMESET") {
      if (pile.old) return null;
      if (pile.wifi || pile.ocpp) return "ACK TIMESET NET";
      const m = /^TIMESET\t(\d{1,10})(?:\t([+-]?\d{1,4}))?$/.exec(command);
      if (!m) return "ACK TIMESET FAIL";
      const unix = parseInt(m[1], 10);
      if (unix < 1577836800 || unix >= 2145916800) return "ACK TIMESET FAIL";
      if (m[2] !== undefined) {
        const tz = parseInt(m[2], 10);
        if (tz < -720 || tz > 840) return "ACK TIMESET FAIL";
        pile.tz = tz;
      }
      pile.unix = unix;
      return "ACK TIMESET OK";
    }
    return null;
  };
  pile.io = {
    waitMs: 5,
    now: () => NOW_MS,
    tz: () => (opts.tz === undefined ? 480 : opts.tz),
    ask: (command, accept) => {
      pile.sent.push(command);
      const line = pile.reply(command);
      /* 桩还会夹着发别的行；accept 只认自己要的那一行。 */
      assert.equal(accept("STAT IDLE NONE 0"), false);
      assert.equal(accept("ACK SCHEDSET OK"), false);
      return Promise.resolve(line !== null && accept(line) ? line : null);
    },
  };
  return pile;
}
const timeSets = (pile) => pile.sent.filter((c) => c.indexOf("TIMESET") === 0);

test("规则：只有 WiFi 和 OCPP 都关才授时", () => {
  assert.equal(shouldSync(false, false), true);
  assert.equal(shouldSync(true, false), false);
  assert.equal(shouldSync(false, true), false);
  assert.equal(shouldSync(true, true), false);
  /* 读到一个是开：不发。读不到的不算开：照发，由桩把关。 */
  assert.equal(shouldSync(null, true), false);
  assert.equal(shouldSync(true, null), false);
  assert.equal(shouldSync(false, null), true);
  assert.equal(shouldSync(null, false), true);
  assert.equal(shouldSync(null, null), true);
});

test("开关行的解析", () => {
  assert.equal(switchFrom("WIFISW 1", "WIFISW"), true);
  assert.equal(switchFrom("WIFISW 0\r", "WIFISW"), false);
  assert.equal(switchFrom("OCPPSW 1", "OCPPSW"), true);
  assert.equal(switchFrom("OCPPSW 1", "WIFISW"), null);
  assert.equal(switchFrom("WIFISW x", "WIFISW"), null);
  assert.equal(switchFrom("ACK WIFISWSET OK", "WIFISW"), null);
  assert.equal(switchFrom(null, "WIFISW"), null);
});

test("命令格式：UTC 秒 + 时区分钟", () => {
  assert.equal(timeSetCommand(NOW_MS, 480), "TIMESET\t1800000000\t480");
  assert.equal(timeSetCommand(NOW_MS + 999, -300), "TIMESET\t1800000001\t-300");
  assert.equal(timeSetCommand(NOW_MS, 0), "TIMESET\t1800000000\t0");
  assert.equal(timeSetCommand(NOW_MS, 345), "TIMESET\t1800000000\t345");
  assert.equal(timeSetCommand(NOW_MS, 840), "TIMESET\t1800000000\t840");
  /* 时区超出桩的范围或不是整数：只发时间。 */
  assert.equal(timeSetCommand(NOW_MS, 841), "TIMESET\t1800000000");
  assert.equal(timeSetCommand(NOW_MS, -721), "TIMESET\t1800000000");
  assert.equal(timeSetCommand(NOW_MS, NaN), "TIMESET\t1800000000");
  /* 手机的钟不可信：不发。 */
  assert.equal(timeSetCommand(0, 480), "");
  assert.equal(timeSetCommand(1577836799 * 1000, 480), "");
  assert.equal(timeSetCommand(2145916800 * 1000, 480), "");
  assert.equal(timeSetCommand(NaN, 480), "");
  assert.equal(timeSetCommand(1577836800 * 1000, 480), "TIMESET\t1577836800\t480");
});

test("手机时区：getTimezoneOffset 反号", () => {
  assert.equal(phoneTzMinutes({ getTimezoneOffset: () => -480 }), 480);
  assert.equal(phoneTzMinutes({ getTimezoneOffset: () => 300 }), -300);
  assert.equal(phoneTzMinutes({ getTimezoneOffset: () => -345 }), 345);
  assert.equal(phoneTzMinutes({ getTimezoneOffset: () => 0 }), 0);
  assert.equal(phoneTzMinutes({ getTimezoneOffset: () => NaN }), 0);
});

test("应答的解析", () => {
  assert.equal(parseTimeAck("ACK TIMESET OK"), "OK");
  assert.equal(parseTimeAck("ACK TIMESET NET\r"), "NET");
  assert.equal(parseTimeAck("ACK TIMESET FAIL"), "FAIL");
  assert.equal(parseTimeAck("ACK TIMESET"), "FAIL");
  assert.equal(parseTimeAck("ACK TIMESET LATER"), "FAIL");
  assert.equal(parseTimeAck("ACK SCHEDSET TIME"), null);
  assert.equal(parseTimeAck("STAT x"), null);
  assert.equal(parseTimeAck(null), null);
});

test("两个开关都关：授时，桩拿到手机的时间和时区", async () => {
  const pile = fakePile({ wifi: false, ocpp: false, tz: -300 });
  assert.equal(await runTimeSync(pile.io), "ok");
  assert.equal(pile.unix, 1800000000);
  assert.equal(pile.tz, -300);
  assert.deepEqual(pile.sent, ["WIFISWGET", "OCPPSWGET", "TIMESET\t1800000000\t-300"]);
});

test("只开 WiFi、只开 OCPP：App 不发 TIMESET，桩的时间不动", async () => {
  for (const sw of [{ wifi: true, ocpp: false }, { wifi: false, ocpp: true }]) {
    const pile = fakePile(sw);
    assert.equal(await runTimeSync(pile.io), "skip");
    assert.equal(pile.unix, null);
    assert.equal(timeSets(pile).length, 0);
  }
});

test("两个开关都开：App 不发 TIMESET，桩的时间不动", async () => {
  const pile = fakePile({ wifi: true, ocpp: true });
  assert.equal(await runTimeSync(pile.io), "skip");
  assert.equal(pile.unix, null);
  assert.equal(timeSets(pile).length, 0);
});

test("开关读不到：照发，有开关开着时桩回 NET，App 不当作错误", async () => {
  for (const sw of [{ wifi: true, ocpp: true }, { wifi: true, ocpp: false }, { wifi: false, ocpp: true }]) {
    const pile = fakePile(Object.assign({ mute: { WIFISWGET: 2, OCPPSWGET: 2 } }, sw));
    assert.equal(await runTimeSync(pile.io), "net");
    assert.equal(pile.unix, null);
    assert.equal(timeSets(pile).length, 1);
  }
  /* 只读到关着的那个，开着的那个没读到：照发，桩回 NET。 */
  const half = fakePile({ wifi: false, ocpp: true, mute: { OCPPSWGET: 2 } });
  assert.equal(await runTimeSync(half.io), "net");
  assert.equal(half.unix, null);
  const off = fakePile({ wifi: false, ocpp: false, mute: { WIFISWGET: 2, OCPPSWGET: 2 } });
  assert.equal(await runTimeSync(off.io), "ok");
});

test("丢了一条应答：再问一遍", async () => {
  const pile = fakePile({ wifi: false, ocpp: false, mute: { WIFISWGET: 1, TIMESET: 1 } });
  assert.equal(await runTimeSync(pile.io), "ok");
  assert.equal(pile.sent.filter((c) => c === "WIFISWGET").length, 2);
  assert.equal(timeSets(pile).length, 2);
});

test("新 App 连旧固件：TIMESET 没人回，试两次后安静地放弃", async () => {
  const pile = fakePile({ wifi: false, ocpp: false, old: true });
  assert.equal(await runTimeSync(pile.io), "old");
  assert.equal(timeSets(pile).length, 2);
  assert.equal(pile.unix, null);
});

test("手机的钟不可信：不发", async () => {
  const pile = fakePile({ wifi: false, ocpp: false });
  pile.io.now = () => 1000;
  assert.equal(await runTimeSync(pile.io), "clock");
  assert.equal(timeSets(pile).length, 0);
});

test("桩回 FAIL：不重发", async () => {
  const pile = fakePile({ wifi: false, ocpp: false });
  const ask = pile.io.ask;
  pile.io.ask = (command, accept) => (command.indexOf("TIMESET") === 0
    ? (pile.sent.push(command), Promise.resolve("ACK TIMESET FAIL"))
    : ask(command, accept));
  assert.equal(await runTimeSync(pile.io), "fail");
  assert.equal(timeSets(pile).length, 1);
});

test("中途断开：后面的命令不再发", async () => {
  const pile = fakePile({ wifi: false, ocpp: false });
  let live = true;
  const ask = pile.io.ask;
  pile.io.alive = () => live;
  pile.io.ask = (command, accept) => { if (command === "OCPPSWGET") live = false; return ask(command, accept); };
  assert.equal(await runTimeSync(pile.io), "gone");
  assert.equal(timeSets(pile).length, 0);
});

/* ---------------------------------------------------------------- 心跳校时（2.6.8） */

/* 假桩的心跳那一半。fw 是桩的固件版本：2.6.8 以前只认纯 "HB"。
 * 和 wb2.c 一样：是心跳就清未应答计数；两个开关都关、格式对、差超过 2 秒或时区不同才写，
 * 两次写入至少隔 10 秒；不回任何应答。clock 是桩自己的钟（秒），每 tick 一次走 1 秒。 */
function heartPile(opts) {
  const pile = {
    fw: opts.fw, wifi: !!opts.wifi, ocpp: !!opts.ocpp,
    clock: opts.clock === undefined ? null : opts.clock, tz: 480,
    beats: 0, writes: 0, replies: [], lastWrite: -1e9, up: 0, linked: true, miss: 0,
  };
  const modern = heartbeatCarriesTime(opts.fw);
  pile.recv = (line) => {
    if (line === "HB") { pile.beats += 1; pile.seen = true; return; }
    if (!modern || line.indexOf("HB\t") !== 0) return;     /* 旧固件：不是命令，不算心跳 */
    pile.beats += 1;
    pile.seen = true;
    if (pile.wifi || pile.ocpp) return;
    const m = /^HB\t(\d{1,10})(?:\t([+-]?\d{1,4}))?$/.exec(line);
    if (!m) return;
    const unix = parseInt(m[1], 10);
    if (unix < 1577836800 || unix >= 2145916800) return;
    const tz = m[2] === undefined ? null : parseInt(m[2], 10);
    if (tz !== null && (tz < -720 || tz > 840)) return;
    const timeOff = pile.clock === null || Math.abs(pile.clock - unix) > 2;
    const tzOff = tz !== null && tz !== pile.tz;
    if (!timeOff && !tzOff) return;
    if (pile.up - pile.lastWrite < 10) return;
    pile.lastWrite = pile.up;
    pile.writes += 1;
    if (timeOff) pile.clock = unix;
    if (tzOff) pile.tz = tz;
  };
  /* 桩过 1 秒：这一秒没见到心跳就记一次，连着 3 次当作手机走了。 */
  pile.tick = () => {
    pile.up += 1;
    if (pile.clock !== null) pile.clock += 1;
    if (pile.seen) pile.miss = 0;
    else if (++pile.miss >= 3) pile.linked = false;
    pile.seen = false;
  };
  return pile;
}

/* App 连着桩跑 seconds 秒：每秒按 App 的规则发一条心跳。fwSeen 是 App 读到的版本
 *（刚连上、旧固件的状态行不带版本时是 "—"）。phone(i) 是第 i 秒手机的 Unix 秒。 */
function runHeartbeats(pile, seconds, opts) {
  const sent = [];
  for (let i = 0; i < seconds; i++) {
    const fwSeen = opts.fwSeen ? opts.fwSeen(i) : pile.fw;
    const authed = opts.authed === undefined ? true : opts.authed;
    const line = heartbeatCommand(authed && heartbeatCarriesTime(fwSeen), !!(opts.busy && opts.busy(i)),
      opts.phone(i) * 1000 + 137, opts.tz === undefined ? 480 : opts.tz);
    sent.push(line);
    pile.recv(line);
    pile.tick();
  }
  return sent;
}

test("版本号的解析和 2.6.8 的门槛", () => {
  assert.deepEqual(versionTriple("2.6.8"), [2, 6, 8]);
  assert.deepEqual(versionTriple("V2.6.8"), [2, 6, 8]);
  assert.deepEqual(versionTriple(" v2.7 "), [2, 7, 0]);
  assert.deepEqual(versionTriple("2.6.10"), [2, 6, 10]);
  for (const bad of ["", "—", null, undefined, "abc", "2", "2.", ".6.8", "2026-11-19T08:00:00Z", "2.6.8.1"]) {
    assert.equal(versionTriple(bad), null, String(bad));
  }
  for (const old of ["2.6.7", "2.6.0", "2.5.9", "1.9.9", "2.0", "V2.6.7", "—", "", null, undefined, "junk"]) {
    assert.equal(heartbeatCarriesTime(old), false, String(old));
  }
  for (const fresh of ["2.6.8", "V2.6.8", "2.6.9", "2.6.10", "2.7", "2.7.0", "2.10.0", "3.0.0"]) {
    assert.equal(heartbeatCarriesTime(fresh), true, fresh);
  }
});

test("心跳的格式：HB + UTC 秒 + 时区分钟；不该带时间时是纯 HB", () => {
  const ms = 1800000000 * 1000 + 999;
  assert.equal(heartbeatCommand(true, false, ms, 480), "HB\t1800000000\t480");
  assert.equal(heartbeatCommand(true, false, ms, -300), "HB\t1800000000\t-300");
  assert.equal(heartbeatCommand(true, false, ms, 0), "HB\t1800000000\t0");
  /* 最长的一条连换行 19 字节，最小的 MTU（23，净荷 20）一包发得完。 */
  assert.ok((heartbeatCommand(true, false, 2145916799 * 1000, -720) + "\n").length <= 20);
  /* 桩版本不够、密码没过：纯 HB。 */
  assert.equal(heartbeatCommand(false, false, ms, 480), "HB");
  /* 发送队列里排着别的数据：纯 HB。 */
  assert.equal(heartbeatCommand(true, true, ms, 480), "HB");
  /* 手机的钟不可信：纯 HB。 */
  assert.equal(heartbeatCommand(true, false, 1577836799 * 1000, 480), "HB");
  assert.equal(heartbeatCommand(true, false, 2145916800 * 1000, 480), "HB");
  assert.equal(heartbeatCommand(true, false, NaN, 480), "HB");
  /* 时区超出桩能存的范围：只带时间。 */
  assert.equal(heartbeatCommand(true, false, ms, 900), "HB\t1800000000");
  assert.equal(heartbeatCommand(true, false, ms, 1.5), "HB\t1800000000");
});

test("新 App 连 2.6.8：桩的钟慢了，心跳把它拉回来，之后不再写", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1800000000 - 30 });
  const sent = runHeartbeats(pile, 60, { phone: (i) => 1800000000 + i });
  assert.ok(sent.every((line) => /^HB\t\d+\t480$/.test(line)));
  assert.equal(pile.beats, 60);
  assert.equal(pile.writes, 1);
  assert.equal(pile.clock, 1800000000 + 60);
  assert.equal(pile.linked, true);
  assert.equal(pile.replies.length, 0);
});

test("新 App 连 2.6.8：相差 2 秒以内不写，3 秒才写", () => {
  for (const [lag, writes] of [[0, 0], [1, 0], [2, 0], [-2, 0], [3, 1], [-3, 1]]) {
    const pile = heartPile({ fw: "2.6.8", clock: 1800000000 + lag });
    runHeartbeats(pile, 20, { phone: (i) => 1800000000 + i });
    assert.equal(pile.writes, writes, "lag " + lag);
  }
});

test("新 App 连 2.6.8：手机换了时区，桩跟着换，时间不动", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1800000000 });
  runHeartbeats(pile, 5, { phone: (i) => 1800000000 + i, tz: -300 });
  assert.equal(pile.tz, -300);
  assert.equal(pile.writes, 1);
  assert.equal(pile.clock, 1800000005);
});

test("新 App 连 2.6.8，开关四种组合：任一打开时心跳照算，时间不用", () => {
  for (const [wifi, ocpp] of [[false, false], [true, false], [false, true], [true, true]]) {
    const pile = heartPile({ fw: "2.6.8", wifi, ocpp, clock: 1700000000 });
    const sent = runHeartbeats(pile, 15, { phone: (i) => 1800000000 + i });
    assert.ok(sent.every((line) => line.indexOf("HB\t") === 0));
    assert.equal(pile.beats, 15);
    assert.equal(pile.linked, true);
    if (wifi || ocpp) {
      assert.equal(pile.writes, 0);
      assert.equal(pile.clock, 1700000015);
    } else {
      assert.equal(pile.writes, 1);
      assert.equal(pile.clock, 1800000015);
    }
  }
});

test("新 App 连旧固件（2.6.7、2.6.5、读不到版本）：只发纯 HB，连接不掉", () => {
  for (const fw of ["2.6.7", "2.6.5", "—"]) {
    const pile = heartPile({ fw, clock: 1700000000 });
    const sent = runHeartbeats(pile, 30, { phone: (i) => 1800000000 + i });
    assert.ok(sent.every((line) => line === "HB"), fw);
    assert.equal(pile.beats, 30);
    assert.equal(pile.linked, true);
    assert.equal(pile.writes, 0);
  }
});

test("反例：对旧固件发带时间的心跳，3 秒后桩当手机走了（所以必须先看版本）", () => {
  const pile = heartPile({ fw: "2.6.7", clock: 1700000000 });
  for (let i = 0; i < 5; i++) {
    pile.recv(heartbeatCommand(true, false, (1800000000 + i) * 1000, 480));
    pile.tick();
  }
  assert.equal(pile.beats, 0);
  assert.equal(pile.linked, false);
});

test("刚连上还没读到版本：先发纯 HB，读到 2.6.8 之后才带时间", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1700000000 });
  const sent = runHeartbeats(pile, 10, {
    phone: (i) => 1800000000 + i,
    fwSeen: (i) => (i < 4 ? "—" : "2.6.8"),
  });
  assert.deepEqual(sent.slice(0, 4), ["HB", "HB", "HB", "HB"]);
  assert.ok(sent.slice(4).every((line) => line.indexOf("HB\t") === 0));
  assert.equal(pile.beats, 10);
  assert.equal(pile.writes, 1);
  assert.equal(pile.linked, true);
});

test("密码没通过：不带时间", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1700000000 });
  const sent = runHeartbeats(pile, 5, { phone: (i) => 1800000000 + i, authed: false });
  assert.ok(sent.every((line) => line === "HB"));
  assert.equal(pile.writes, 0);
});

test("发送队列忙（固件升级）：这几秒发纯 HB，心跳不断，时间不乱", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1800000000 });
  const sent = runHeartbeats(pile, 20, { phone: (i) => 1800000000 + i, busy: (i) => i >= 5 && i < 15 });
  assert.ok(sent.slice(5, 15).every((line) => line === "HB"));
  assert.equal(pile.beats, 20);
  assert.equal(pile.writes, 0);
  assert.equal(pile.linked, true);
});

test("旧 App 连 2.6.8：纯 HB 照旧是心跳，桩的时间不动", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1700000000 });
  for (let i = 0; i < 30; i++) { pile.recv("HB"); pile.tick(); }
  assert.equal(pile.beats, 30);
  assert.equal(pile.linked, true);
  assert.equal(pile.writes, 0);
  assert.equal(pile.clock, 1700000030);
});

test("格式错误的心跳：2.6.8 仍当心跳，不改时间", () => {
  const pile = heartPile({ fw: "2.6.8", clock: 1700000000 });
  for (const bad of ["HB\t", "HB\tabc", "HB\t1577836799\t480", "HB\t1800000000\t841", "HB\t1800000000\t48x", "HB\t1800000000\t480\t1"]) {
    pile.recv(bad);
    pile.tick();
  }
  assert.equal(pile.beats, 6);
  assert.equal(pile.linked, true);
  assert.equal(pile.writes, 0);
});

test("桩的时区被心跳改了：App 重新读 SCHEDGET，3 秒后第一次，隔 12 秒一次，最多 3 次", () => {
  const asks = (carries, pileTz, phoneTz, seconds, follow) => {
    const state = {};
    const at = [];
    let tz = pileTz;
    for (let i = 0; i <= seconds; i++) {
      if (zoneRereadDue(state, carries, tz, phoneTz, 1000000 + i * 1000)) {
        at.push(i);
        if (follow) tz = phoneTz;          /* 桩已经跟过去了，这次读回来就是手机的时区 */
      }
    }
    return at;
  };
  /* 时区一样：不问。 */
  assert.deepEqual(asks(true, 480, 480, 120, false), []);
  /* 不一样，桩跟过去了：问一次就够。 */
  assert.deepEqual(asks(true, 480, 540, 120, true), [3]);
  /* 不一样，桩不跟（开关开着）：问 3 次就停。 */
  assert.deepEqual(asks(true, 480, 540, 300, false), [3, 15, 27]);
  /* 心跳不带时间（旧固件、密码没过）：不问。 */
  assert.deepEqual(asks(false, 480, 540, 120, false), []);
  /* 手机时区超出桩的范围：心跳里不带时区，不问。 */
  assert.deepEqual(asks(true, 480, 900, 120, false), []);
  /* 手机又换了一个时区：重新开始数。 */
  const state = {};
  let n = 0;
  for (let i = 0; i <= 60; i++) if (zoneRereadDue(state, true, 480, 540, i * 1000)) n++;
  for (let i = 61; i <= 120; i++) if (zoneRereadDue(state, true, 480, 0, i * 1000)) n++;
  assert.equal(n, 6);
});
