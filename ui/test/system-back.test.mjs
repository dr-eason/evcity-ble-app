/* 系统返回键 / 侧滑（Android 的 dispatchSystemBack、iOS 的左边缘右滑）调的 window.evcTryBack()。
 *
 * 返回 false 时 Android 退出应用（finish()），所以只有停在扫描列表上、什么都没连才许返回 false。
 * 连着充电桩时：二级页回上一级；预约 / 记录、设置标签回立即充电；立即充电和点「断开蓝牙」一样
 * disconnect()，手机那一层报 page "scan" 后回到扫描列表。AC06 页面和 M01 模块都一样。
 *
 * 和 merge-router.test.mjs 一样把真的 App.vue + m01/M01App.vue 跑起来（helpers/mount-shell.mjs）。
 * 手机那一层照 MainActivity：disconnect() 是 handler.post 出去的，稍后才报 page "scan" 和“蓝牙已断开”。 */
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

/* devices：[{ name, addr, kind: "ac06" | "m01" }]。opts.mute：连上后桩什么都不回。 */
async function setup(devices, opts = {}) {
  const piles = {};
  devices.forEach((d) => { piles[d.addr] = d.kind === "m01" ? createPile(APP_VERSION, { caps: "FF" }) : ac06Pile(); });
  let app = null;
  let linked = "";
  let seq = 0;
  const deliver = (addr, lines) => {
    if (opts.mute) return;
    const mySeq = seq;
    lines.forEach((line, i) => setTimeout(() => {
      if (mySeq !== seq || linked !== addr) return;
      const kind = typeFromStatus(line);
      if (kind && !piles[addr].kindSent) {
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
      setTimeout(() => {
        app.vm.handle({ t: "page", s: "scan" });
        app.vm.handle({ t: "note", s: "蓝牙已断开" });
      }, 20);
    },
  });
  app.vm.handle({ t: "devs", list: devices.map((d, i) => ({ name: d.name, addr: d.addr, rssi: -50 - i })) });
  await flush();
  return { app, piles, linkedAddr: () => linked };
}

const count = (app, name) => app.calls.filter((c) => c[0] === name).length;
const onScanList = (app) => {
  const text = app.text();
  return (text.includes("扫描充电桩") || text.includes("停止扫描")) && !text.includes("断开蓝牙");
};
const back = () => window.evcTryBack();

const AC = "AA:00:00:00:01:01";
const M1 = "AA:00:00:00:01:02";

async function ac06Charge(extra = {}) {
  const ctx = await setup([{ name: "EVC_ABC123", addr: AC, kind: "ac06" }], Object.assign({ pins: { [AC]: "123456" } }, extra));
  ctx.app.click("EVC_ABC123");
  await run(3000);
  assert.ok(ctx.app.text().includes("断开蓝牙"), "连上、密码通过，在立即充电页: " + ctx.app.text().slice(0, 200));
  assert.equal(count(ctx.app, "disconnect"), 0);
  return ctx;
}
async function m01Charge(name) {
  const ctx = await setup([{ name, addr: M1, kind: "m01" }], { pins: { [M1]: "123456" } });
  ctx.app.click(name);
  await run(8000);
  assert.ok(ctx.app.text().includes("10 路充电桩"), ctx.app.text().slice(0, 200));
  assert.equal(count(ctx.app, "disconnect"), 0);
  return ctx;
}

test("扫描列表上（没连着）：evcTryBack() 是 false，Android 退出应用，不发断开", async () => {
  const { app } = await setup([{ name: "EVC_ABC123", addr: AC, kind: "ac06" }]);
  assert.ok(onScanList(app));
  assert.equal(back(), false);
  assert.equal(count(app, "disconnect"), 0);
  assert.equal(count(app, "connect"), 0);
  app.close();
});

test("AC06 立即充电：evcTryBack() 是 true（Android 不 finish），和「断开蓝牙」一样断开，回到扫描列表", async () => {
  const { app, linkedAddr } = await ac06Charge();
  assert.strictEqual(back(), true);
  assert.equal(count(app, "disconnect"), 1);
  await run(200);
  assert.equal(linkedAddr(), "");
  assert.ok(onScanList(app), app.text().slice(0, 300));
  assert.ok(app.text().includes("EVC_ABC123"), "列表还在");
  assert.ok(app.text().includes("蓝牙已断开"));
  assert.equal(count(app, "disconnect"), 1, "只断开一次");
  /* 回到扫描列表以后再按：这才退出。 */
  assert.equal(back(), false);
  assert.equal(count(app, "disconnect"), 1);
  app.close();
});

test("AC06 系统返回和点「断开蓝牙」走的是同一条路：对手机那一层的调用一样", async () => {
  const a = await ac06Charge();
  const before = a.app.calls.length;
  a.app.click("断开蓝牙");
  await run(200);
  const byButton = a.app.calls.slice(before).map((c) => c.join(" "));
  a.app.close();
  const b = await ac06Charge();
  const beforeB = b.app.calls.length;
  assert.equal(back(), true);
  await run(200);
  assert.deepEqual(b.app.calls.slice(beforeB).map((c) => c.join(" ")), byButton);
  assert.equal(byButton[0], "disconnect");
  b.app.close();
});

for (const tabName of ["设置", "预约充电"]) test("AC06 " + tabName + "标签：第一次回立即充电、不断开；第二次才断开回扫描列表", async () => {
  const { app, linkedAddr } = await ac06Charge();
  app.click((n) => inTabBar(n) && textIs(n, tabName));
  await run(300);
  assert.equal(selectedTab(app), tabName);
  assert.equal(back(), true);
  await run(300);
  assert.equal(count(app, "disconnect"), 0, "回立即充电不断开");
  assert.equal(linkedAddr(), AC);
  assert.ok(!onScanList(app));
  assert.ok(app.text().includes("断开蓝牙"));
  assert.equal(selectedTab(app), "立即充电");
  assert.equal(back(), true);
  await run(200);
  assert.equal(count(app, "disconnect"), 1);
  assert.ok(onScanList(app), app.text().slice(0, 300));
  app.close();
});

test("AC06 二级页（设置 → WiFi）：一次回一级，一直连着；回到立即充电再按才断开", async () => {
  const { app, linkedAddr } = await ac06Charge();
  app.click((n) => inTabBar(n) && textIs(n, "设置"));
  await run(300);
  app.click((n) => n.props.onClick && String(n.props.onClick).includes("openWifi"));
  await run(300);
  assert.equal(app.byClass("tabbar").length, 0, "二级页没有标签栏");
  assert.ok(app.text().includes("返回"));
  assert.equal(back(), true);
  await run(300);
  assert.equal(selectedTab(app), "设置", "回到设置标签");
  assert.equal(count(app, "disconnect"), 0);
  assert.equal(linkedAddr(), AC);
  assert.equal(back(), true);
  await run(300);
  assert.equal(selectedTab(app), "立即充电");
  assert.equal(count(app, "disconnect"), 0);
  assert.equal(back(), true);
  await run(200);
  assert.equal(count(app, "disconnect"), 1);
  assert.ok(onScanList(app));
  app.close();
});

test("AC06 密码页：系统返回断开，回扫描列表，不退出", async () => {
  const { app } = await setup([{ name: "EVC_ABC123", addr: AC, kind: "ac06" }]);
  app.click("EVC_ABC123");
  await run(100);
  assert.ok(app.text().includes("管理员密码"), app.text().slice(0, 200));
  assert.equal(back(), true);
  await run(200);
  assert.equal(count(app, "disconnect"), 1);
  assert.ok(onScanList(app), app.text().slice(0, 300));
  assert.equal(back(), false);
  app.close();
});

test("AC06 用已保存的密码连接中（页面还停在扫描页，其实连着）：系统返回断开，不退出应用", async () => {
  const { app, linkedAddr } = await setup([{ name: "EVC_ABC123", addr: AC, kind: "ac06" }], { pins: { [AC]: "123456" }, mute: true });
  app.click("EVC_ABC123");
  await run(300);
  assert.ok(app.text().includes("正在连接并核对已保存的密码"), app.text().slice(0, 200));
  assert.equal(linkedAddr(), AC);
  assert.equal(back(), true);
  assert.equal(count(app, "disconnect"), 1);
  await run(200);
  assert.equal(linkedAddr(), "");
  assert.ok(onScanList(app));
  assert.equal(back(), false, "断开以后才是真的扫描列表");
  app.close();
});

for (const name of ["EVCM_A1B2C3", "EVCMA1B2C3"]) test("M01（" + name + "）立即充电：evcTryBack() 是 true，断开，回到扫描列表", async () => {
  const { app, linkedAddr } = await m01Charge(name);
  assert.strictEqual(back(), true);
  assert.equal(count(app, "disconnect"), 1);
  await run(300);
  assert.equal(linkedAddr(), "");
  assert.ok(onScanList(app), app.text().slice(0, 300));
  assert.ok(!app.text().includes("10 路充电桩"), "M01 模块收起来了");
  assert.ok(app.text().includes(name), "列表还在");
  assert.equal(count(app, "disconnect"), 1);
  assert.deepEqual(app.calls.filter((c) => c[0] === "setProfile").pop(), ["setProfile", "ac06"], "行首表换回 AC06");
  assert.equal(back(), false, "扫描列表上再按才退出");
  app.close();
});

test("M01 系统返回和点「断开蓝牙」走的是同一条路", async () => {
  const a = await m01Charge("EVCM_A1B2C3");
  const before = a.app.calls.length;
  a.app.click("断开蓝牙");
  await run(300);
  const byButton = a.app.calls.slice(before).map((c) => c.join(" "));
  a.app.close();
  const b = await m01Charge("EVCM_A1B2C3");
  const beforeB = b.app.calls.length;
  assert.equal(back(), true);
  await run(300);
  assert.deepEqual(b.app.calls.slice(beforeB).map((c) => c.join(" ")), byButton);
  assert.equal(byButton[0], "disconnect");
  b.app.close();
});

test("M01 设置标签、二级页（设置 → WiFi）：一次回一级，不断开；立即充电再按才断开", async () => {
  const { app, linkedAddr } = await m01Charge("EVCM_A1B2C3");
  app.click((n) => inTabBar(n) && textIs(n, "设置"));
  await run(300);
  assert.equal(selectedTab(app), "设置");
  app.click((n) => n.props.onClick && String(n.props.onClick).includes("openWifi"));
  await run(300);
  assert.equal(app.byClass("tabbar").length, 0, "二级页没有标签栏");
  assert.equal(back(), true);
  await run(300);
  assert.equal(selectedTab(app), "设置");
  assert.equal(count(app, "disconnect"), 0);
  assert.equal(back(), true);
  await run(300);
  assert.equal(selectedTab(app), "立即充电");
  assert.ok(app.text().includes("10 路充电桩"));
  assert.equal(count(app, "disconnect"), 0);
  assert.equal(linkedAddr(), M1);
  assert.equal(back(), true);
  await run(300);
  assert.equal(count(app, "disconnect"), 1);
  assert.ok(onScanList(app));
  app.close();
});

test("M01 充电记录标签：回立即充电，不断开", async () => {
  const { app, linkedAddr } = await m01Charge("EVCM_A1B2C3");
  app.click((n) => inTabBar(n) && textIs(n, "充电记录"));
  await run(300);
  assert.equal(selectedTab(app), "充电记录");
  assert.equal(back(), true);
  await run(300);
  assert.equal(selectedTab(app), "立即充电");
  assert.equal(count(app, "disconnect"), 0);
  assert.equal(linkedAddr(), M1);
  app.close();
});

test("M01 连接中（用已保存的密码，还没到首页）：系统返回断开回扫描列表，不退出", async () => {
  const { app } = await setup([{ name: "EVCM_A1B2C3", addr: M1, kind: "m01" }], { pins: { [M1]: "123456" }, mute: true });
  app.click("EVCM_A1B2C3");
  await run(300);
  assert.ok(app.text().includes("正在连接并核对已保存的密码"), app.text().slice(0, 200));
  assert.equal(back(), true);
  assert.equal(count(app, "disconnect"), 1);
  await run(300);
  assert.ok(onScanList(app), app.text().slice(0, 300));
  assert.equal(back(), false);
  app.close();
});

test("认类型的那一次连接（名字认不出）：系统返回不退出应用，断开，留在扫描列表，不再往下连", async () => {
  const addr = "AA:00:00:00:01:41";
  const { app } = await setup([{ name: "EVC-ODD", addr, kind: "m01" }], { pins: { [addr]: "123456" }, mute: true });
  app.click("EVC-ODD");
  await run(300);
  assert.ok(app.text().includes("正在连接，识别充电桩类型"));
  assert.equal(back(), true);
  assert.equal(count(app, "disconnect"), 1);
  await run(12000);
  assert.equal(count(app, "disconnect"), 1, "10 秒的定时器取消了，不再断一次");
  assert.equal(count(app, "connect"), 1);
  assert.ok(onScanList(app));
  assert.ok(!app.text().includes("没有识别出充电桩类型"));
  assert.equal(back(), false);
  app.close();
});

test("换模块的半路上按系统返回：不退出、不多发一次断开、不再重连，留在扫描列表", async () => {
  const addr = "AA:00:00:00:01:21";
  /* EVC_ 的老 M01：先按 AC06 连，认出是 M01 后断开、换模块。 */
  const { app } = await setup([{ name: "EVC_OLD021", addr, kind: "m01" }], { pins: { [addr]: "123456" } });
  app.click("EVC_OLD021");
  let hit = false;
  for (let i = 0; i < 40 && !hit; i++) {
    await run(50);
    hit = app.text().includes("正在切换");
  }
  assert.ok(hit, "到了换模块这一步: " + app.text().slice(0, 200));
  assert.equal(count(app, "disconnect"), 1);
  assert.equal(count(app, "connect"), 1);
  assert.equal(back(), true);
  assert.equal(back(), true, "连按也一样");
  await run(6000);
  assert.equal(count(app, "disconnect"), 1, "换模块自己断的那一次，没有第二次");
  assert.equal(count(app, "connect"), 1, "不再重连");
  assert.ok(onScanList(app), app.text().slice(0, 300));
  assert.ok(!app.text().includes("10 路充电桩"));
  assert.equal(app.store.get("dev-type:" + addr), "m01", "认出来的类型照样记住");
  assert.equal(back(), false, "收拾完是真的扫描列表");
  /* 再点一次：这回直接进 M01 模块，照常连上。 */
  app.click("EVC_OLD021");
  await run(8000);
  assert.ok(app.text().includes("10 路充电桩"), app.text().slice(0, 300));
  app.close();
});

test("换模块没按返回：照常换过去（上面那个开关不影响正常流程）", async () => {
  const addr = "AA:00:00:00:01:22";
  const { app } = await setup([{ name: "EVC_OLD022", addr, kind: "m01" }], { pins: { [addr]: "123456" } });
  app.click("EVC_OLD022");
  await run(10000);
  assert.ok(app.text().includes("10 路充电桩"), app.text().slice(0, 300));
  assert.equal(count(app, "connect"), 2);
  /* 换过去以后在 M01 立即充电页按返回：断开回扫描列表。 */
  assert.equal(back(), true);
  await run(300);
  assert.ok(onScanList(app));
  app.close();
});

function textIs(node, want) {
  const text = (n) => (n.tag === "#text" ? n.text : n.tag === "#comment" ? "" : (n.children || []).map(text).join(""));
  return text(node).trim() === want;
}
function inTabBar(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (/tabbar/.test(JSON.stringify(p.props && p.props.class || ""))) return true;
  }
  return false;
}
/* 标签栏上选中的那个标签（没有标签栏就是 ""）。 */
function selectedTab(app) {
  const text = (n) => (n.tag === "#text" ? n.text : n.tag === "#comment" ? "" : (n.children || []).map(text).join(""));
  return app.buttons((n) => inTabBar(n) && n.props["aria-selected"] === "true").map((n) => text(n).trim()).join("|");
}
