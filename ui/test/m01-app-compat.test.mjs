/* （从 M01 仓库的 test/app-compat.test.mjs 拷来：合并后 M01 的页面在 m01/M01App.vue，由外壳 App.vue
 * 挂上；设置从底部标签栏的「设置」进，原来是右上角的齿轮。）
 *
 * 新 App 连各版固件：把真的 App.vue 在 node 里跑起来（helpers/mount-app.mjs），对面是按各版
 * 规矩应答的模拟桩（helpers/fw-versions.mjs），从扫描、连接、核对密码一路走到首页和设置页。
 *
 *     node --test M01/tools/ble-finder/ui/test/app-compat.test.mjs
 *
 * 看的是：App 从不给老固件发它不认的命令；首页、菜单上的提示；充电规则、并充、广播诊断、
 * OCPP wss://、搜索热点在老固件上的回退；读不到版本时按最老的处理；固件比 App 新。 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mountShell as mountApp, textOf } from "./helpers/mount-shell.mjs";
import { createPile, knows } from "./helpers/m01-fw-versions.mjs";
import { APP_VERSION } from "../src/m01/fw-compat.js";

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

/* 连上一台这一版的桩，走到首页。返回 { app, pile, unknown(): App 发过的、这一版不认的命令 }。 */
async function connect(version, opts = {}) {
  let app = null;
  const pile = createPile(version, opts);
  const deliver = (lines) => {
    lines.forEach((line, i) => setTimeout(() => app.vm.handle({ t: "line", s: line }), 40 + 30 * i));
  };
  app = await mountApp({
    pins: { "AA:BB:CC:DD:EE:01": "123456" },
    onSend: (command) => deliver(pile.reply(command)),
    /* 手机那一层：连上就报 charge 页，并且自己发 STATUS（MainActivity.requestStatus）。 */
    onConnect: () => setTimeout(() => {
      app.vm.handle({ t: "page", s: "charge" });
      deliver(pile.reply("STATUS"));
    }, 100),
  });
  app.vm.handle({ t: "devs", list: [{ name: "EVCMABC123", addr: "AA:BB:CC:DD:EE:01", rssi: -50 }] });
  await flush();
  app.click("EVCMABC123");
  await run(6000);
  const unknown = () => pile.log.filter((c) => c.indexOf("HB") !== 0 && !knows(version, c));
  return { app, pile, unknown };
}
function sentHead(app, head) {
  return app.sent.filter((c) => c === head || c.indexOf(head + "\t") === 0);
}
async function openMenu(app) {
  app.click((n) => n.props.class === "tab" && textOf(n).includes("设置"));
  await run(20000);
}
async function typeInto(input, value) {
  input.value = value;
  (input.listeners.input || []).forEach((fn) => fn({ target: input }));
  await flush();
}

test("1.0.0 的桩：进得了首页，按推送画格子；不发 SNAPGET；首页写固件比 App 旧", async () => {
  const { app, unknown } = await connect("1.0.0");
  await run(10000);
  const text = app.text();
  assert.ok(text.includes("充电桩固件 1.0.0 比 App " + APP_VERSION + " 旧"), text.slice(0, 400));
  assert.equal(sentHead(app, "SNAPGET").length, 0);
  assert.ok(sentHead(app, "AUTH").length >= 1);
  assert.deepEqual(unknown(), []);
  /* 菜单：充电规则、并充写需升级固件，不发 PAYGET、PARGET。 */
  await openMenu(app);
  assert.equal((app.text().match(/需升级固件/g) || []).length, 2);
  assert.equal(sentHead(app, "PAYGET").length + sentHead(app, "PARGET").length, 0);
  assert.deepEqual(unknown(), []);
  /* 点进充电规则：说明要升级到 1.1.0，不发命令。 */
  app.click("充电规则");
  await run(3000);
  assert.ok(app.text().includes("充电桩固件 1.0.0 没有这项功能。请升级到 1.1.0 或以上"));
  assert.deepEqual(unknown(), []);
});

test("1.2.0 的桩：并充、翻页有；广播诊断不发 ADVGET，写要升级到 1.3.0；wss:// 不下发", async () => {
  const { app, unknown } = await connect("1.2.0");
  await openMenu(app);
  assert.ok(!app.text().includes("需升级固件"));
  assert.ok(sentHead(app, "PAYGET").length >= 1 && sentHead(app, "PARGET").length >= 1);
  app.click("蓝牙WiFi版本");
  await run(5000);
  assert.equal(sentHead(app, "ADVGET").length, 0);
  assert.ok(app.text().includes("充电桩固件 1.2.0 没有这项功能。请升级到 1.3.0 或以上"));
  app.click("返回");
  await run(15000);
  app.click("OCPP 服务器");
  await run(3000);
  const url = app.inputs().find((n) => n.props.placeholder === "ws(s)://主机/路径");
  await typeInto(url, "wss://csms.example/ocpp/EVC0001");
  app.click("保存");
  await run(3000);
  assert.equal(sentHead(app, "OCPPSET").length, 0);
  assert.ok(app.text().includes("充电桩固件 1.2.0 不认 wss:// 地址。请升级到 1.3.0 或以上，或者改用 ws://"));
  /* ws:// 照常保存。 */
  await typeInto(url, "ws://csms.example/ocpp/EVC0001");
  app.click("保存");
  await run(3000);
  assert.deepEqual(sentHead(app, "OCPPSET"), ["OCPPSET\tws://csms.example/ocpp/EVC0001"]);
  assert.deepEqual(unknown(), []);
});

test("1.3.0 的桩：充电规则只发两个参数，保存成功；持续时间不能改；WiFi 开关关着不发 WSCAN", async () => {
  const { app, pile, unknown } = await connect("1.3.0");
  await openMenu(app);
  app.click("充电规则");
  await run(4000);
  const hold = app.inputs().find((n) => n.props.maxlength === "4" || n.props.maxlength === 4);
  assert.ok(hold && hold.props.disabled, "持续时间的输入框要是灰的");
  assert.ok(app.text().includes("充电桩固件 1.3.0 不能改持续时间，固定 300 秒。升级到 1.3.2 或以上才能改"));
  app.click((n) => textOf(n) === "保存");
  await run(4000);
  assert.deepEqual(sentHead(app, "PAYSET"), ["PAYSET\t1\t10"]);
  assert.ok(app.text().includes("已保存，断电后仍然有效"));
  assert.equal(pile.state.fullW, 10);
  app.click("返回");
  await run(15000);
  /* WiFi：开关关着，搜索热点不发 WSCAN（老固件回 OK 却不扫）。 */
  app.click("WiFi 配网");
  await run(3000);
  app.click("搜索热点");
  await run(3000);
  assert.equal(sentHead(app, "WSCAN").length, 0);
  assert.ok(app.text().includes("充电桩固件 1.3.0 要先打开 WiFi 开关才能搜索热点。升级到 1.3.2 或以上不用"));
  assert.equal(sentHead(app, "SNAPGET").length, 0);
  assert.deepEqual(unknown(), []);
});

/* 1.3.3（全部停止逐路停）的蓝牙命令和 1.3.2 一样，也没有能力位：按版本号走，功能全有。 */
for (const version of ["1.3.2", "1.3.3"]) {
test(version + " 的桩（没有能力位）：首页用快照，三个参数的 PAYSET，开关关着也搜索热点", async () => {
  const { app, unknown } = await connect(version);
  await run(5000);
  assert.ok(sentHead(app, "SNAPGET").length >= 2);
  assert.ok(app.text().includes("充电桩固件 " + version + " 比 App " + APP_VERSION + " 旧"));
  await openMenu(app);
  app.click("充电规则");
  await run(4000);
  app.click((n) => textOf(n) === "保存");
  await run(4000);
  assert.deepEqual(sentHead(app, "PAYSET"), ["PAYSET\t1\t10\t300"]);
  app.click("返回");
  await run(15000);
  app.click("WiFi 配网");
  await run(3000);
  app.click("搜索热点");
  await run(3000);
  assert.equal(sentHead(app, "WSCAN").length, 1);
  assert.ok(app.text().includes("shop"));
  assert.deepEqual(unknown(), []);
});
}

test("同版的桩（带能力位）：没有提示，全部功能；能力位说没有的照样不发", async () => {
  const same = await connect(APP_VERSION, { caps: "1FFF" });
  await run(5000);
  assert.ok(sentHead(same.app, "SNAPGET").length >= 2);
  assert.ok(!same.app.text().includes("比 App"));
  assert.ok(!same.app.text().includes("没有读到充电桩的固件版本"));
  /* 版本号一样新，但能力位里没有快照（bit 10）：照能力位，不发 SNAPGET。 */
  const trimmed = await connect(APP_VERSION, { caps: (0x1FFF & ~(1 << 10)).toString(16).toUpperCase() });
  await run(5000);
  assert.equal(sentHead(trimmed.app, "SNAPGET").length, 0);
});

test("比 App 新的桩：写固件比 App 新，App 认识的功能照常用", async () => {
  const { app, unknown } = await connect("1.4.0", { caps: "3FFF" });
  await run(5000);
  assert.ok(app.text().includes("充电桩固件 1.4.0 比 App " + APP_VERSION + " 新。新加的功能要更新 App 才能用"));
  assert.ok(sentHead(app, "SNAPGET").length >= 2);
  await openMenu(app);
  assert.ok(!app.text().includes("需升级固件"));
  assert.deepEqual(unknown(), []);
});

test("读不到版本（STATUS 不回 ACK SYS）：再问 3 次，按最老的 1.0.0 处理并提示", async () => {
  const { app, pile, unknown } = await connect("1.3.2", { noSys: true });
  await run(8000);
  assert.ok(pile.log.filter((c) => c === "STATUS").length >= 4, "要再问几次 STATUS");
  assert.ok(app.text().includes("没有读到充电桩的固件版本，按最老的 1.0.0 处理，有些功能先不用"));
  assert.equal(sentHead(app, "SNAPGET").length, 0);
  await openMenu(app);
  assert.equal(sentHead(app, "PAYGET").length + sentHead(app, "PARGET").length, 0);
  assert.deepEqual(unknown(), []);
});
