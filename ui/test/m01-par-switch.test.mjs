/* 设置里改并充（src/par-switch.js）：先无条件停掉全部充电，等每一路都停下，再切换并充，读回核对。
 *
 *     node --test APP/ui/test/par-switch.test.mjs
 *
 * 用一台假的桩：10 路，状态字母和固件一样（C 充电中、S 暂停输出、F 结束中约 1 秒、P 空闲）；
 * STOP⇥0 只停在充的（gap 不为 0 时像新固件一样逐路停：端口号从小到大每 gap 毫秒停一路，
 * 重发不重排）；PARSET 要所有端口空闲（还有"刚授权、还没合闸"这种状态上看不出来的
 * 情况），成功回 ACK PARSET OK 再跟 ACK PAR。时钟是假的，sleep 只往前拨。 */
import test from "node:test";
import assert from "node:assert/strict";
import { PAR_RESTOP_MS, PAR_SWITCH_TIMEOUT_MS, STOP_ALL_GAP_MS, parBusyPorts, parSwitchStep, parSwitchText, runParSwitch } from "../src/m01/par-switch.js";
import { translate } from "../src/m01/i18n.js";
import { M01_LANGS } from "../src/m01/packs-m01.js";

function fakePile(init) {
  const pile = {
    t: 0,
    ports: Array(10).fill("P"),
    finishAt: Array(10).fill(0),
    stuck: new Set(),            /* STOP 停不下来的路 */
    hidden: 0,                   /* 状态上看不出来的待合闸次数：PARSET 回 BUSY，STOP 能停掉 */
    mode: 1,
    saved: 1,
    sent: [],
    silent: false,               /* 什么都不回 */
    dropAt: null,                /* 到这个时刻蓝牙断开 */
    lose: new Set(),             /* 这些行发出去就丢 */
    parsetReply: null,           /* 换掉 PARSET 的应答 */
    onRead: null,                /* 每次读状态之前调一下：模拟别人起充 */
    linked: true,
    gap: 0,                      /* 逐路停的间隔，0 = 一次全停（老固件） */
    stopAt: Array(10).fill(null),/* 逐路停：这一路排到的停止时刻 */
    stopTimes: [],               /* 逐路停：[端口, 停下的时刻] */
    ...init,
  };
  pile.tick = () => {
    if (pile.dropAt !== null && pile.t >= pile.dropAt) pile.linked = false;
    pile.ports = pile.ports.map((s, i) => {
      if ((s === "C" || s === "S") && pile.stopAt[i] !== null && pile.t >= pile.stopAt[i]) {
        pile.stopTimes.push([i + 1, pile.stopAt[i]]);
        pile.finishAt[i] = pile.stopAt[i] + 1000;
        pile.stopAt[i] = null;
        return pile.t >= pile.finishAt[i] ? "P" : "F";
      }
      return s;
    });
    pile.ports = pile.ports.map((s, i) => (s === "F" && pile.t >= pile.finishAt[i] ? "P" : s));
  };
  pile.answer = (command) => {
    pile.sent.push(command);
    pile.tick();
    if (!pile.linked || pile.silent) return [];
    if (command === "STOP\t0" && pile.gap > 0) {
      let any = pile.hidden > 0;
      pile.hidden = 0;
      const queued = pile.stopAt.filter((at) => at !== null);
      let next = queued.length ? Math.max(...queued) + pile.gap : pile.t + 50;
      pile.ports.forEach((s, i) => {
        if (s !== "C" && s !== "S") return;
        any = true;
        if (pile.stuck.has(i + 1) || pile.stopAt[i] !== null) return;
        pile.stopAt[i] = next;
        next += pile.gap;
      });
      return ["ACK STOP\t0\t" + (any ? "OK" : "IDLE")];
    }
    if (command === "STOP\t0") {
      let any = pile.hidden > 0;
      pile.hidden = 0;
      pile.ports = pile.ports.map((s, i) => {
        if ((s === "C" || s === "S") && !pile.stuck.has(i + 1)) {
          any = true;
          pile.finishAt[i] = pile.t + 1000;
          return "F";
        }
        if (s === "C" || s === "S") any = true;
        return s;
      });
      return ["ACK STOP\t0\t" + (any ? "OK" : "IDLE")];
    }
    if (command.indexOf("PARSET\t") === 0) {
      if (pile.parsetReply) return pile.parsetReply;
      const mode = Number(command.slice(7));
      if (pile.hidden > 0 || pile.ports.some((s) => s !== "P")) return ["ACK PARSET BUSY"];
      pile.saved = mode;
      return ["ACK PARSET OK", "ACK PAR\t" + pile.mode + "\t10\t" + pile.saved];
    }
    return [];
  };
  return pile;
}

/* App 那一侧：ble-queue 的 ask（等第一条 accept 认的行，没有就超时）、读状态、假时钟。 */
function appSide(pile) {
  const steps = [];
  const io = {
    now: () => pile.t,
    sleep: async (ms) => { pile.t += ms; },
    alive: () => { pile.tick(); return pile.linked; },
    progress: (step, vars) => steps.push(vars ? step + ":" + vars.ports.join(",") : step),
    ask: async (command, accept, ms) => {
      const lines = pile.answer(command).filter((line) => !pile.lose.has(line));
      for (const line of lines) {
        if (accept(line)) {
          pile.t += 50;
          return line;
        }
      }
      pile.t += ms;
      return null;
    },
    readPorts: async () => {
      if (pile.onRead) pile.onRead(pile);
      pile.tick();
      pile.sent.push("READ");
      if (!pile.linked || pile.silent) {
        pile.t += 2000;
        return null;
      }
      pile.t += 100;
      return pile.ports.slice();
    },
  };
  return { io, steps };
}

test("还没停下的状态：充电中、暂停输出、结束中；空闲、故障、停用、预约不算", () => {
  assert.deepEqual(parBusyPorts(["P", "C", "S", "F", "R", "U", "X", "P", "?", "C"]), [2, 3, 4, 10]);
  assert.deepEqual(parBusyPorts([]), []);
  assert.deepEqual(parBusyPorts(null), []);
});

test("有 3 路在充：先 STOP⇥0，等到全部停下才发 PARSET，读回保存的模式，桩会重启", async () => {
  const pile = fakePile();
  pile.ports[1] = "C"; pile.ports[4] = "S"; pile.ports[8] = "C";
  const { io, steps } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "done", restart: true, checked: true });
  assert.equal(pile.sent[0], "STOP\t0");
  const parset = pile.sent.indexOf("PARSET\t2");
  assert.equal(parset, pile.sent.length - 1, "PARSET 只发一次，而且是最后一条");
  /* PARSET 之前那一次读状态是全部空闲；中间等过结束中。 */
  assert.equal(pile.sent[parset - 1], "READ");
  assert.ok(steps.includes("wait:2,5,9"), steps.join(" "));
  assert.deepEqual(steps.slice(-1), ["switch"]);
  assert.equal(pile.saved, 2);
  assert.ok(pile.t < 5000, String(pile.t));
  assert.deepEqual(parSwitchText(out).text, "已切换并核对，充电桩正在重启，请稍后重新连接");
});

test("全部空闲：照样先发 STOP⇥0（回 IDLE），马上切换", async () => {
  const pile = fakePile();
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 5);
  assert.equal(out.code, "done");
  assert.deepEqual(pile.sent, ["STOP\t0", "READ", "PARSET\t5"]);
});

test("选的就是这次运行的模式（之前只保存过别的）：切换成功，不用重启", async () => {
  const pile = fakePile({ mode: 2, saved: 3 });
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "done", restart: false, checked: true });
  assert.equal(parSwitchText(out).text, "已切换，不用重启");
});

test("新固件逐路停：10 路在充，只发一次 STOP⇥0，按 0.3 秒一路停完、结束中回空闲后再切换", async () => {
  const pile = fakePile({ gap: STOP_ALL_GAP_MS });
  pile.ports = Array(10).fill("C");
  const { io, steps } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "done", restart: true, checked: true });
  assert.equal(pile.sent.filter((c) => c === "STOP\t0").length, 1, pile.sent.join(" "));
  assert.deepEqual(pile.stopTimes.map((one) => one[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const first = pile.stopTimes[0][1];
  pile.stopTimes.forEach((one, k) => assert.equal(one[1], first + k * STOP_ALL_GAP_MS));
  /* 10 路逐路停完、最后一路结束中回空闲，都在补发 STOP⇥0 的间隔之内。 */
  assert.ok(9 * STOP_ALL_GAP_MS + 1000 < PAR_RESTOP_MS);
  assert.ok(pile.t < 9 * STOP_ALL_GAP_MS + 1000 + 3000, String(pile.t));
  assert.ok(steps.some((one) => one.indexOf("wait:") === 0 && one.indexOf("10") > 0));
  assert.equal(pile.saved, 2);
});

test("新固件逐路停：读状态慢、等的时候又起了一路，补发一次 STOP⇥0 停掉它，30 秒内照样切换", async () => {
  let reads = 0;
  const pile = fakePile({
    gap: STOP_ALL_GAP_MS,
    onRead: (p) => { if (++reads === 2) p.ports[9] = "C"; },
  });
  pile.ports = ["C", "C", "C", "C", "C", "P", "P", "P", "P", "P"];
  const { io } = appSide(pile);
  io.readPorts = (orig => async () => { pile.t += 900; return orig(); })(io.readPorts);
  const out = await runParSwitch(io, 5);
  assert.equal(out.code, "done");
  assert.ok(pile.t < PAR_SWITCH_TIMEOUT_MS, String(pile.t));
  assert.deepEqual(pile.stopTimes.map((one) => one[0]), [1, 2, 3, 4, 5, 10]);
  assert.equal(pile.sent.filter((c) => c === "STOP\t0").length, 2, pile.sent.join(" "));
  assert.equal(pile.saved, 5);
});

test("等的时候又有人起了一路：看到了就再停一次，最后照样切换", async () => {
  let reads = 0;
  const pile = fakePile({
    onRead: (p) => { if (++reads === 2) p.ports[3] = "C"; },
  });
  pile.ports[0] = "C";
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.equal(out.code, "done");
  assert.ok(pile.sent.filter((c) => c === "STOP\t0").length >= 2, pile.sent.join(" "));
  assert.equal(pile.sent.filter((c) => c.indexOf("PARSET") === 0).length, 1);
});

test("状态上看不出来的待合闸（刚授权）：PARSET 回 BUSY，再停一次、再等，然后切换", async () => {
  let reads = 0;
  const pile = fakePile({
    onRead: (p) => { if (++reads === 1) p.hidden = 1; },
  });
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 3);
  assert.equal(out.code, "done");
  const cmds = pile.sent.filter((c) => c !== "READ");
  assert.deepEqual(cmds, ["STOP\t0", "PARSET\t3", "STOP\t0", "PARSET\t3"]);
  assert.equal(pile.saved, 3);
});

test("有一路一直停不下来：每 5 秒补发 STOP⇥0，30 秒到了就放弃，不发 PARSET，告诉是哪一路", async () => {
  const pile = fakePile({ stuck: new Set([4]) });
  pile.ports[3] = "C";
  pile.ports[6] = "C";
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "timeout", ports: [4] });
  assert.ok(!pile.sent.some((c) => c.indexOf("PARSET") === 0));
  const stops = pile.sent.filter((c) => c === "STOP\t0").length;
  assert.ok(stops >= PAR_SWITCH_TIMEOUT_MS / PAR_RESTOP_MS - 1 && stops <= PAR_SWITCH_TIMEOUT_MS / PAR_RESTOP_MS + 1, String(stops));
  assert.ok(pile.t >= PAR_SWITCH_TIMEOUT_MS && pile.t < PAR_SWITCH_TIMEOUT_MS + 5000, String(pile.t));
  assert.equal(pile.saved, 1);
  const shown = parSwitchText(out);
  assert.equal(shown.ok, false);
  assert.equal(shown.text, "等了 30 秒，第 {list} 路还没停下，没有切换。请到首页看一下再试");
  assert.deepEqual(shown.vars, { list: "4" });
});

test("等的时候蓝牙断开：马上结束，不发 PARSET，说明没有切换", async () => {
  const pile = fakePile({ dropAt: 600 });
  pile.ports[0] = "C";
  pile.stuck = new Set([1]);
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "link", sent: false });
  assert.ok(!pile.sent.some((c) => c.indexOf("PARSET") === 0));
  assert.ok(pile.t < 5000, String(pile.t));
  assert.equal(parSwitchText(out).text, "蓝牙断开了，没有切换。充电可能已经停了，重新连接后请先看首页");
});

test("PARSET 发出去以后蓝牙断开、没收到应答：说明可能已经切换，让用户重新连上看", async () => {
  const pile = fakePile();
  const { io } = appSide(pile);
  const ask = io.ask;
  io.ask = async (command, accept, ms) => {
    if (command.indexOf("PARSET") === 0) {
      pile.answer(command);
      pile.linked = false;
      pile.t += ms;
      return null;
    }
    return ask(command, accept, ms);
  };
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "link", sent: true });
  assert.equal(parSwitchText(out).text, "蓝牙断开了。可能已经切换、充电桩正在重启，重新连接后在这里看现在的模式");
});

test("ACK PARSET OK 到了、ACK PAR 丢了（桩马上重启）：算切换成功，没能读回", async () => {
  const pile = fakePile();
  pile.lose.add("ACK PAR\t1\t10\t2");
  const { io } = appSide(pile);
  const out = await runParSwitch(io, 2);
  assert.deepEqual(out, { code: "done", restart: true, checked: false });
  assert.equal(parSwitchText(out).text, "已切换，充电桩正在重启，请稍后重新连接");
});

test("PARSET 一行都没回：30 秒里重来；桩不接受、读回不对都停下来", async () => {
  /* 第一次 PARSET 的应答整个丢了，第二次正常。 */
  let first = true;
  const pile = fakePile();
  const { io } = appSide(pile);
  const ask = io.ask;
  io.ask = async (command, accept, ms) => {
    if (command.indexOf("PARSET") === 0 && first) {
      first = false;
      pile.sent.push(command);
      pile.t += ms;
      return null;
    }
    return ask(command, accept, ms);
  };
  assert.equal((await runParSwitch(io, 2)).code, "done");
  assert.equal(pile.sent.filter((c) => c === "PARSET\t2").length, 2);

  /* PARSET 没回、其实桩已经切换并重启：再来一遍时蓝牙断开，要说"可能已经切换"。 */
  const gone = fakePile();
  const goneSide = appSide(gone);
  const goneAsk = goneSide.io.ask;
  goneSide.io.ask = async (command, accept, ms) => {
    if (command.indexOf("PARSET") === 0) {
      gone.answer(command);
      gone.dropAt = gone.t + ms + 100;
      gone.t += ms;
      return null;
    }
    return goneAsk(command, accept, ms);
  };
  assert.deepEqual(await runParSwitch(goneSide.io, 2), { code: "link", sent: true });

  const fail = fakePile({ parsetReply: ["ACK PARSET FAIL"] });
  const outFail = await runParSwitch(appSide(fail).io, 2);
  assert.deepEqual(outFail, { code: "rejected" });
  assert.equal(parSwitchText(outFail).text, "充电桩没有接受");

  const wrong = fakePile({ parsetReply: ["ACK PARSET OK", "ACK PAR\t1\t10\t3"] });
  const outWrong = await runParSwitch(appSide(wrong).io, 2);
  assert.deepEqual(outWrong, { code: "mismatch", saved: 3 });
  assert.equal(parSwitchText(outWrong).text, "读回来的模式不对，没有切换成功，请再试一次");
});

test("桩一直不回：30 秒后报没有应答，不卡住", async () => {
  const pile = fakePile({ silent: true });
  const out = await runParSwitch(appSide(pile).io, 2);
  assert.deepEqual(out, { code: "noreply" });
  assert.ok(pile.t >= PAR_SWITCH_TIMEOUT_MS && pile.t < PAR_SWITCH_TIMEOUT_MS + 6000, String(pile.t));
  assert.equal(parSwitchText(out).text, "充电桩没有应答");
});

test("老固件（没有 SNAPGET）：读状态由 App 换成 STATUS，流程一样；命令只有 STOP⇥0 和 PARSET", async () => {
  const pile = fakePile();
  pile.ports[2] = "C";
  const { io } = appSide(pile);
  await runParSwitch(io, 2);
  assert.ok(pile.sent.every((c) => c === "READ" || c === "STOP\t0" || c === "PARSET\t2"), pile.sent.join(" "));
});

test("进度和结果的每一句 12 种语言都有", () => {
  const keys = new Set();
  ["stop", "switch"].forEach((step) => keys.add(parSwitchStep(step, null).text));
  keys.add(parSwitchStep("wait", { n: 2, ports: [3, 7] }).text);
  assert.deepEqual(parSwitchStep("wait", { n: 2, ports: [3, 7] }).vars, { n: 2, list: "3, 7" });
  const outs = [
    { code: "done", restart: true, checked: true }, { code: "done", restart: true, checked: false },
    { code: "done", restart: false, checked: true }, { code: "timeout", ports: [4] }, { code: "timeout", ports: [] },
    { code: "link", sent: false }, { code: "link", sent: true }, { code: "rejected" }, { code: "mismatch", saved: 3 },
    { code: "noreply" },
  ];
  outs.forEach((out) => keys.add(parSwitchText(out).text));
  for (const key of keys) {
    for (const lang of M01_LANGS) {
      const text = translate(lang, key);
      assert.ok(text !== key && (lang === "ja" || !/[一-鿿]/.test(text)), lang + ": " + key);
    }
  }
});
