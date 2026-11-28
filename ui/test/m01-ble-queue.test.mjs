/* 一问一答队列（ble-queue.js）的主机测试：
 *
 *     node --test APP/ui/test/
 *
 * 假桩照协议文档 2.3 节：应答先进一个 4 行的队列，满了以后新的行直接丢掉；不认识的命令
 * 不回任何东西。用假时钟推进，不真的等。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createQueue } from "../src/m01/ble-queue.js";

const here = dirname(fileURLToPath(import.meta.url));
const tick = () => new Promise((done) => setImmediate(done));

/* 假时钟 + 假桩。桩每 step 毫秒从 4 行的回复队列里发出一行。 */
function rig(opts) {
  const o = Object.assign({ step: 100, queueLen: 4 }, opts);
  const timers = [];
  let now = 0;
  let seq = 0;
  const sent = [];
  const outbox = [];
  const dropped = [];
  let inFlightMax = 0;
  const known = (cmd) => /^(PORTGET|PLIMGET|PLIMSET|TELGET|CFGGET|START|STOP|ORDGET|WIFISWSET)(\t|$)/.test(cmd);
  function replyTo(cmd) {
    const name = cmd.split("\t")[0];
    if (name === "PORTGET") return ["ACK PORT\t" + cmd.split("\t")[1] + "\tP\t230.0\t0.00\t0\t0\t0\t0\t800\tNONE\t0\tUNKNOWN\t-\t0"];
    if (name === "PLIMGET") return ["ACK PLIM\t10\t50\t2000\t800,800,800,800,800,800,800,800,800,800"];
    if (name === "PLIMSET") return ["ACK PLIMSET\t" + cmd.split("\t")[1] + "\tOK", "ACK PLIM\t10\t50\t2000\t800,800,800,800,800,800,800,800,800,800"];
    if (name === "TELGET") return ["TEL 0"];
    if (name === "CFGGET") return ["CFG 253 207"];
    if (name === "START") return ["ACK START\t" + cmd.split("\t")[1] + "\tOK"];
    if (name === "STOP") return ["ACK STOP\t" + cmd.split("\t")[1] + "\tIDLE"];
    if (name === "WIFISWSET") return ["OCPPSW 0", "ACK WIFISWSET OK", "OCPPSW 0"];
    return [];
  }
  /* 手机发一条命令给桩。 */
  const send = (cmd) => {
    sent.push({ cmd, at: now });
    if (!known(cmd)) return;
    replyTo(cmd).forEach((line) => {
      if (outbox.length >= o.queueLen) dropped.push(line);
      else outbox.push(line);
    });
  };
  const q = createQueue({
    send,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  const got = [];
  /* 推进 ms 毫秒：到点的定时器触发；桩每 step 毫秒发一行给 App。 */
  async function run(ms) {
    const end = now + ms;
    while (now < end) {
      now += 10;
      if (now % o.step === 0 && outbox.length) {
        const line = outbox.shift();
        got.push(line);
        q.feed(line);
      }
      timers.filter((t) => t.at <= now).forEach((t) => {
        const i = timers.indexOf(t);
        if (i >= 0) { timers.splice(i, 1); t.fn(); }
      });
      inFlightMax = Math.max(inFlightMax, q.pending());
      await tick();
    }
  }
  return { q, run, send, sent, got, dropped, outbox, now: () => now, timers, inFlightMax: () => inFlightMax };
}
const isPort = (line) => line.indexOf("ACK PORT\t") === 0;
const startsWith = (text) => (line) => line.indexOf(text) === 0;

test("一次只有一条在路上：三条同时问，一条回来才发下一条", async () => {
  const r = rig();
  const a = r.q.ask("TELGET", startsWith("TEL "), 2000);
  const b = r.q.ask("CFGGET", startsWith("CFG "), 2000);
  const c = r.q.ask("PLIMGET", startsWith("ACK PLIM\t"), 2000);
  assert.deepEqual(r.sent.map((s) => s.cmd), ["TELGET"]);
  assert.equal(r.q.idle(), false);
  await r.run(100);
  assert.equal(await a, "TEL 0");
  assert.deepEqual(r.sent.map((s) => s.cmd), ["TELGET", "CFGGET"]);
  await r.run(200);
  assert.equal(await b, "CFG 253 207");
  assert.equal((await c).indexOf("ACK PLIM\t"), 0);
  assert.deepEqual(r.sent.map((s) => s.cmd), ["TELGET", "CFGGET", "PLIMGET"]);
  assert.equal(r.q.idle(), true);
  assert.equal(r.timers.length, 0, "定时器没收干净");
});

test("超时：桩不回（不认识的命令）返回 null，然后照常发下一条", async () => {
  const r = rig();
  const a = r.q.ask("IMAXGET", startsWith("IMAX "), 500);
  const b = r.q.ask("TELGET", startsWith("TEL "), 500);
  await r.run(490);
  assert.deepEqual(r.sent.map((s) => s.cmd), ["IMAXGET"]);
  await r.run(20);
  assert.equal(await a, null);
  assert.deepEqual(r.sent.map((s) => s.cmd), ["IMAXGET", "TELGET"]);
  assert.equal(r.sent[1].at, 500);
  await r.run(200);
  assert.equal(await b, "TEL 0");
});

test("超时从这一条发出去时算起，不从排队时算起", async () => {
  const r = rig();
  const a = r.q.ask("IMAXGET", startsWith("IMAX "), 1000);
  const b = r.q.ask("IMAXGET", startsWith("IMAX "), 1000);
  let bDone = false;
  b.then(() => { bDone = true; });
  await r.run(1900);
  assert.equal(await a, null);
  assert.equal(bDone, false);
  await r.run(200);
  assert.equal(bDone, true);
});

test("不是它等的行不算应答：每秒推送的状态行夹在中间没关系", async () => {
  const r = rig();
  const a = r.q.ask("CFGGET", startsWith("CFG "), 2000);
  assert.equal(r.q.feed("WCFG UP bench"), false);
  assert.equal(r.q.feed("FLT NONE"), false);
  assert.equal(r.q.feed("ACK SYS\t1.0.0\t10\t230.4\t31\t1\t-62\tUP\tON\t-\tbench"), false);
  assert.equal(r.q.idle(), false);
  await r.run(100);
  assert.equal(await a, "CFG 253 207");
});

test("consume：一键配置等的应答只给它，界面别的地方不再处理；默认不拦", async () => {
  const r = rig();
  const plain = r.q.ask("TELGET", startsWith("TEL "), 2000);
  assert.equal(r.q.feed("TEL 1"), false);
  assert.equal(await plain, "TEL 1");
  const eaten = r.q.ask("TELGET", startsWith("TEL "), 2000, { consume: true });
  assert.equal(r.q.feed("OCPPSW 0"), false);
  assert.equal(r.q.feed("TEL 0"), true);
  assert.equal(await eaten, "TEL 0");
  /* 没有人在等时什么都不拦。 */
  assert.equal(r.q.feed("TEL 0"), false);
});

test("accept 抛异常不会把队列卡死", async () => {
  const r = rig();
  const a = r.q.ask("TELGET", () => { throw new Error("x"); }, 300);
  const b = r.q.ask("CFGGET", startsWith("CFG "), 300);
  await r.run(400);
  assert.equal(await a, null);
  await r.run(200);
  assert.equal(await b, "CFG 253 207");
});

test("断开连接：在路上的和排着的都返回 null，之后还能接着用", async () => {
  const r = rig();
  const a = r.q.ask("TELGET", startsWith("TEL "), 2000);
  const b = r.q.ask("CFGGET", startsWith("CFG "), 2000);
  r.q.reset();
  assert.equal(await a, null);
  assert.equal(await b, null);
  assert.equal(r.q.idle(), true);
  assert.equal(r.timers.length, 0);
  assert.deepEqual(r.sent.map((s) => s.cmd), ["TELGET"]);
  /* 断开前桩已经在路上的那一行迟到了：没人等，不拦。 */
  assert.equal(r.q.feed("TEL 0"), false);
  r.outbox.length = 0;
  const c = r.q.ask("CFGGET", startsWith("CFG "), 2000);
  await r.run(100);
  assert.equal(await c, "CFG 253 207");
});

test("每秒一次的 PORTGET 只在队列空着时排进来：不挤别的命令，别的命令也不被它饿死", async () => {
  /* 桩慢：一行要 400 ms 才发得出来。详情页开着 20 秒，其间用户点了启动、改了功率上限、
   * 进菜单读了开关。 */
  const r = rig({ step: 400 });
  const results = [];
  const user = [
    [2000, "START\t3", startsWith("ACK START\t")],
    [5000, "PLIMSET\t3\t900", startsWith("ACK PLIMSET\t")],
    [9000, "TELGET", startsWith("TEL ")],
    [9000, "CFGGET", startsWith("CFG ")],
    [9000, "PLIMGET", startsWith("ACK PLIM\t")],
  ];
  let polls = 0;
  for (let t = 0; t < 20000; t += 1000) {
    user.filter((u) => u[0] === t).forEach((u) => {
      const at = r.now();
      r.q.ask(u[1], u[2], 3000).then((line) => results.push({ cmd: u[1], line, took: r.now() - at }));
    });
    if (r.q.idle()) { polls += 1; r.q.ask("PORTGET\t3", isPort, 1500); }
    await r.run(1000);
  }
  /* 用户的 5 条命令都等到了应答，没有超时，最慢的也在 3 秒内。 */
  assert.equal(results.length, 5);
  results.forEach((item) => {
    assert.ok(item.line, item.cmd + " 超时了");
    assert.ok(item.took <= 3000, item.cmd + " 等了 " + item.took);
  });
  /* 轮询没有停：20 秒里问了十几次，都有应答。 */
  assert.ok(polls >= 14, "只轮询了 " + polls + " 次");
  assert.equal(r.got.filter(isPort).length, polls);
  /* 桩的 4 行队列一次也没满过。 */
  assert.deepEqual(r.dropped, []);
  assert.ok(r.inFlightMax() <= 4);
});

test("反例：不排队、一口气发 8 条，桩的 4 行队列装不下，后 4 条的应答被丢掉；排队就一条不丢", async () => {
  /* 绕过队列直接发。 */
  const raw = rig({ step: 400 });
  for (let i = 1; i <= 8; i++) raw.send("PORTGET\t" + i);
  await raw.run(8 * 400 + 100);
  assert.equal(raw.got.length, 4);
  assert.equal(raw.dropped.length, 4);
  assert.deepEqual(raw.got.map((line) => line.split("\t")[1]), ["1", "2", "3", "4"]);
  /* 同样 8 条从队列走。 */
  const queued = rig({ step: 400 });
  const asks = [];
  for (let i = 1; i <= 8; i++) asks.push(queued.q.ask("PORTGET\t" + i, isPort, 1500));
  await queued.run(8 * 400 + 100);
  const lines = await Promise.all(asks);
  assert.deepEqual(lines.map((line) => line && line.split("\t")[1]), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.deepEqual(queued.dropped, []);
});

test("一条命令回几行（WIFISWSET）：等的是 ACK 那一行，前后补的开关行照常交给界面", async () => {
  const r = rig();
  const seen = [];
  const a = r.q.ask("WIFISWSET\t0", startsWith("ACK WIFISWSET"), 3000, { consume: true });
  /* 桩先补一行 OCPPSW 0，再回 ACK，再跟一行 OCPPSW。 */
  for (const line of ["OCPPSW 0", "ACK WIFISWSET OK", "OCPPSW 0"]) {
    if (!r.q.feed(line)) seen.push(line);
  }
  assert.equal(await a, "ACK WIFISWSET OK");
  assert.deepEqual(seen, ["OCPPSW 0", "OCPPSW 0"]);
});

test("App.vue：命令都从队列走；直接 send 的只有固件升级的数据片、放弃升级和悄悄重发的 AUTH", () => {
  const vue = readFileSync(resolve(here, "../src/m01/M01App.vue"), "utf8");
  const script = vue.slice(vue.indexOf("<script setup>"), vue.indexOf("</script>"));
  const direct = [...script.matchAll(/(?<![A-Za-z.])send\(([^)]{0,24})/g)].map((m) => m[1])
    .filter((arg) => arg !== "text" && arg !== "seq");
  assert.ok(direct.length >= 3);
  /* 悄悄重发的 AUTH 不排队：队列里在等的那条命令还没走完（见 applyAuthLine）。 */
  direct.forEach((arg) => assert.ok(/^"OTAABORT"$|^"OTADATA\\t" \+ seq|^"AUTH\\t" \+ step\.pass$/.test(arg), "直接发了 " + arg));
  assert.match(script, /const queue = createQueue\(\{ send \}\);/);
  assert.match(script, /if \(queue\.feed\(line\)\) return;/);
  /* 断开连接、换一台桩时队列清空。 */
  assert.ok((script.match(/queue\.reset\(\)/g) || []).length >= 2);
  /* 每秒那一拍：队列不空就不轮询。 */
  assert.match(script, /if \(!linkReady\.value \|\| gateState\.value !== "ok" \|\| otaBusy\.value \|\| !queue\.idle\(\)\) return;\s*if \(page\.value === "port"\) pollPort\(\);/);
});
