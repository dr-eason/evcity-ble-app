/* 合并后的外壳（App.vue）：扫描页的类型标签、点了交给哪个模块、连上后按状态行核对和换模块、
 * 记住类型、M01 模块断开回扫描页、两个模块共用一个语言设置。
 *
 * 把真的 App.vue 和 m01/M01App.vue 在 node 里跑起来（helpers/mount-shell.mjs）。对面是两种假桩：
 * M01 用 helpers/m01-fw-versions.mjs（按 M01 固件的规矩回），AC06 只回状态和密码。手机那一层照
 * MainActivity：连上报 page "charge"、自己发 STATUS、看到第一行状态报 {t:"kind"}（kindFromNative
 * 为 false 时不报，验证界面自己也认）；断开报 page "scan" 和“蓝牙已断开”。 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mountShell } from "./helpers/mount-shell.mjs";
import { createPile } from "./helpers/m01-fw-versions.mjs";
import { APP_VERSION } from "../src/m01/fw-compat.js";
import { typeFromStatus } from "../src/devtype.js";

mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}
async function run(ms) {
  for (let t = 0; t < ms; t += 50) {
    mock.timers.tick(50);
    await flush();
  }
}

function ac06Pile() {
  const log = [];
  return {
    log,
    reply(command) {
      log.push(command);
      const part = command.split("\t");
      if (part[0] === "STATUS") return ["STAT A NONE 00:00:00 0 0 0 0 0 0 0 0 V2.8.1"];
      if (part[0] === "AUTH") return [part[1] === "123456" ? "ACK AUTH OK" : "ACK AUTH FAIL"];
      return [];
    },
  };
}

/* devices：[{ name, addr, kind: "ac06" | "m01" }]。 */
async function setup(devices, opts = {}) {
  const piles = {};
  devices.forEach((d) => { piles[d.addr] = d.kind === "m01" ? createPile(APP_VERSION, { caps: "FF" }) : ac06Pile(); });
  let app = null;
  let linked = "";
  let seq = 0;
  const kindFromNative = opts.kindFromNative !== false;
  const deliver = (addr, lines) => {
    const mySeq = seq;
    lines.forEach((line, i) => setTimeout(() => {
      if (mySeq !== seq || linked !== addr) return;
      const kind = typeFromStatus(line);
      if (kind && kindFromNative && !piles[addr].kindSent) {
        piles[addr].kindSent = true;
        app.vm.handle({ t: "kind", s: kind });
      }
      app.vm.handle({ t: "line", s: line });
    }, 40 + 30 * i));
  };
  app = await mountShell({
    pins: opts.pins || {},
    store: opts.store || {},
    onSend: (command) => { if (linked) deliver(linked, piles[linked].reply(command)); },
    onConnect: (addr) => {
      seq++;
      const mySeq = seq;
      setTimeout(() => {
        if (mySeq !== seq) return;
        linked = addr;
        piles[addr].kindSent = false;
        app.vm.handle({ t: "page", s: "charge" });
        deliver(addr, piles[addr].reply("STATUS"));
      }, 100);
    },
    onDisconnect: () => {
      seq++;
      linked = "";
      app.vm.handle({ t: "page", s: "scan" });
      app.vm.handle({ t: "note", s: "蓝牙已断开" });
    },
  });
  app.vm.handle({ t: "devs", list: devices.map((d, i) => ({ name: d.name, addr: d.addr, rssi: -50 - i })) });
  await flush();
  return { app, piles, linkedAddr: () => linked };
}

function profileCalls(app) {
  return app.calls.filter((c) => c[0] === "setProfile" || c[0] === "connect" || c[0] === "disconnect")
    .map((c) => c.join(" "));
}

test("扫描页：每张卡写是哪种桩；EVC_ 的老 M01 按记住的类型写", async () => {
  const { app } = await setup([
    { name: "EVCMA1B2C3", addr: "AA:00:00:00:00:01", kind: "m01" },
    { name: "EVC_ABC123", addr: "AA:00:00:00:00:02", kind: "ac06" },
    { name: "EVC_OLD001", addr: "AA:00:00:00:00:03", kind: "m01" },
    { name: "EVC-XYZ", addr: "AA:00:00:00:00:04", kind: "ac06" },
  ], { store: { "dev-type:AA:00:00:00:00:03": "m01" } });
  const text = app.text();
  assert.equal((text.match(/摩托车充电桩/g) || []).length, 2, text);
  assert.equal((text.match(/汽车充电桩/g) || []).length, 1, text);
  assert.equal((text.match(/连接后识别/g) || []).length, 1, text);
  assert.equal(app.byClass("kind-m01").length, 2);
  assert.equal(app.byClass("kind-ac06").length, 1);
  assert.equal(app.byClass("kind-unknown").length, 1);
});

/* EVCM_ 加 6 位是 M01 现在的广播名（11 个字符），EVCM 加 6 位是 60fcf5d 那版测试固件，两种一样对待。 */
for (const m01Name of ["EVCM_A1B2C3", "EVCMA1B2C3"]) test("点 " + m01Name + " 的桩：先设 M01 的行首表再连，进 M01 模块（AC06 样式的标签栏），记住类型", async () => {
  const { app, piles } = await setup([{ name: m01Name, addr: "AA:00:00:00:00:11", kind: "m01" }],
    { pins: { "AA:00:00:00:00:11": "123456" } });
  app.click(m01Name);
  await run(8000);
  assert.deepEqual(profileCalls(app).slice(0, 2), ["setProfile m01", "connect AA:00:00:00:00:11"]);
  const text = app.text();
  assert.ok(text.includes("10 路充电桩"), text.slice(0, 300));
  assert.ok(text.includes("立即充电") && text.includes("充电记录") && text.includes("设置"), "标签栏");
  assert.ok(piles["AA:00:00:00:00:11"].log.includes("AUTH\t123456"));
  assert.equal(app.store.get("dev-type:AA:00:00:00:00:11"), "m01");
  assert.equal(app.calls.filter((c) => c[0] === "disconnect").length, 0, "名字对了不用换模块");
  app.close();
});

test("EVC_ 的老 M01（没重刷）：先按 AC06 连，状态行是 ACK SYS，断开、换 M01 模块重连；下次扫描写 M01", async () => {
  const addr = "AA:00:00:00:00:21";
  const { app, piles } = await setup([{ name: "EVC_OLD021", addr, kind: "m01" }], { pins: { [addr]: "123456" } });
  assert.ok(app.text().includes("汽车充电桩"));
  app.click("EVC_OLD021");
  await run(10000);
  assert.deepEqual(profileCalls(app).slice(0, 5), [
    "setProfile ac06", "connect " + addr, "disconnect", "setProfile m01", "connect " + addr,
  ]);
  const text = app.text();
  assert.ok(text.includes("10 路充电桩"), text.slice(0, 300));
  assert.ok(!text.includes("最大电流"), "没有留在 AC06 的页面上");
  assert.ok(piles[addr].log.filter((c) => c === "AUTH\t123456").length >= 1);
  assert.equal(app.store.get("dev-type:" + addr), "m01");
  /* 断开回扫描页：这一台现在写摩托车充电桩。 */
  app.click("断开蓝牙");
  await run(500);
  assert.ok(app.text().includes("摩托车充电桩"), app.text().slice(0, 300));
  assert.ok(app.text().includes("扫描充电桩") || app.text().includes("停止扫描"));
  app.close();
});

test("手机那一层不报 kind（老 iOS 外壳）：界面自己看第一行状态，照样换到 M01", async () => {
  const addr = "AA:00:00:00:00:22";
  const { app } = await setup([{ name: "EVC_OLD022", addr, kind: "m01" }],
    { pins: { [addr]: "123456" }, kindFromNative: false });
  app.click("EVC_OLD022");
  await run(10000);
  assert.ok(app.text().includes("10 路充电桩"));
  assert.equal(app.store.get("dev-type:" + addr), "m01");
  app.close();
});

test("老 M01 没存密码：AC06 的密码页上输的密码带到 M01 模块，不用再输", async () => {
  const addr = "AA:00:00:00:00:23";
  const { app, piles } = await setup([{ name: "EVC_OLD023", addr, kind: "m01" }]);
  app.click("EVC_OLD023");
  await flush();
  assert.ok(app.text().includes("管理员密码") || app.text().includes("6 位"), app.text().slice(0, 300));
  const input = app.root && (function find(n) {
    if (!n || !n.children) return null;
    if (n.tag === "input" && n.props.type === "password") return n;
    for (const c of n.children) { const got = find(c); if (got) return got; }
    return null;
  })(app.root);
  input.value = "123456";
  (input.props["onUpdate:modelValue"] || (() => {}))("123456");
  await flush();
  app.click((n) => n.props.class === "go");
  await run(10000);
  assert.ok(app.text().includes("10 路充电桩"), app.text().slice(0, 300));
  assert.ok(piles[addr].log.includes("AUTH\t123456"));
  app.close();
});

test("名字是 EVCM 却回 STAT（AC06）：换回 AC06 的页面", async () => {
  const addr = "AA:00:00:00:00:31";
  const { app, piles } = await setup([{ name: "EVCMWRONG1", addr, kind: "ac06" }], { pins: { [addr]: "123456" } });
  app.click("EVCMWRONG1");
  await run(10000);
  assert.deepEqual(profileCalls(app).slice(0, 5), [
    "setProfile m01", "connect " + addr, "disconnect", "setProfile ac06", "connect " + addr,
  ]);
  assert.equal(app.store.get("dev-type:" + addr), "ac06");
  assert.ok(!app.text().includes("10 路充电桩"));
  assert.ok(piles[addr].log.includes("AUTH\t123456"));
  app.close();
});

test("名字认不出：先连上看状态行（不进密码页），认出来再交给对的模块", async () => {
  const addr = "AA:00:00:00:00:41";
  const { app } = await setup([{ name: "EVC-ODD", addr, kind: "m01" }], { pins: { [addr]: "123456" } });
  app.click("EVC-ODD");
  await run(50);
  assert.ok(app.text().includes("正在连接，识别充电桩类型"), app.text().slice(0, 300));
  assert.deepEqual(profileCalls(app), ["setProfile ac06", "connect " + addr]);
  await run(150);
  /* 连上了（page "charge"）也不进 AC06 的密码页。 */
  assert.ok(!app.text().includes("管理员密码"), app.text().slice(0, 300));
  await run(10000);
  assert.ok(app.text().includes("10 路充电桩"));
  assert.equal(app.store.get("dev-type:" + addr), "m01");
  app.close();
});

test("名字认不出、10 秒没认出类型：断开，提示重试", async () => {
  const addr = "AA:00:00:00:00:42";
  const { app } = await mountShellSilent(addr);
  app.click("EVC-MUTE");
  await run(11000);
  assert.ok(app.text().includes("没有识别出充电桩类型，请重试"), app.text().slice(0, 300));
  app.close();
});
async function mountShellSilent(addr) {
  const app = await mountShell({
    onConnect: () => setTimeout(() => app.vm.handle({ t: "page", s: "charge" }), 100),
    onDisconnect: () => {
      app.vm.handle({ t: "page", s: "scan" });
      app.vm.handle({ t: "note", s: "蓝牙已断开" });
    },
  });
  app.vm.handle({ t: "devs", list: [{ name: "EVC-MUTE", addr, rssi: -40 }] });
  await flush();
  return { app };
}

test("语言：M01 模块里选的语言存在 ac06-lang，两个模块共用；不再用 m01-lang", async () => {
  const addr = "AA:00:00:00:00:51";
  const { app } = await setup([{ name: "EVCMLANG01", addr, kind: "m01" }], { pins: { [addr]: "123456" } });
  app.click("EVCMLANG01");
  await run(8000);
  app.click((n) => (n.props.class || "") === "lang");
  await flush();
  app.click("English");
  await flush();
  assert.equal(app.store.get("ac06-lang"), "en");
  assert.equal(app.store.has("m01-lang"), false);
  assert.ok(app.text().includes("Charge now"), app.text().slice(0, 300));
  app.close();
});
