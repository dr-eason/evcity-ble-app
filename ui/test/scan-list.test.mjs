/* 扫描页卡片的先后（src/scan-list.js）：rssi 平滑、回差、先到先排、手指按住不动、消失和清空。
 * 最后几条把真的 App.vue 跑起来（helpers/mount-shell.mjs），看页面确实用了它。 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  HOLD_MAX_MS, RELEASE_MS, RSSI_ALPHA, SUSTAIN, THRESHOLD_DB, createScanList, smoothRssi,
} from "../src/scan-list.js";
import { mountShell } from "./helpers/mount-shell.mjs";

mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });

const A = "AA:00:00:00:00:0A";
const B = "AA:00:00:00:00:0B";
const C = "AA:00:00:00:00:0C";
const D = "AA:00:00:00:00:0D";
const dev = (addr, rssi, name) => ({ name: name || "EVC_" + addr.slice(-2), addr, rssi });
const addrs = (rows) => rows.map((r) => r.addr);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " ≈ " + b);

test("常数：系数 0.3、回差 6 dB、连续 2 次", () => {
  assert.equal(RSSI_ALPHA, 0.3);
  assert.equal(THRESHOLD_DB, 6);
  assert.equal(SUSTAIN, 2);
  assert.ok(RELEASE_MS > 0 && HOLD_MAX_MS > RELEASE_MS);
});

test("smoothRssi：第一次用原值，之后 alpha * 新 + (1 - alpha) * 旧", () => {
  assert.equal(smoothRssi(undefined, -60), -60);
  assert.equal(smoothRssi(null, -60), -60);
  near(smoothRssi(-60, -50), -57);
  near(smoothRssi(-60, -50, 0.5), -55);
  assert.equal(smoothRssi(-60, NaN), -60);
  assert.equal(smoothRssi(undefined, NaN), null);
});

test("每台桩各自平滑；卡片上的数字是最新的原值", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -70)]);
  assert.equal(list.smoothed(A), -60);
  assert.equal(list.smoothed(B), -70);
  const rows = list.update([dev(A, -50), dev(B, -80)]);
  near(list.smoothed(A), -57);
  near(list.smoothed(B), -73);
  assert.deepEqual(rows.map((r) => r.rssi), [-50, -80]);
  list.update([dev(A, -50), dev(B, -80)]);
  near(list.smoothed(A), 0.3 * -50 + 0.7 * -57);
  assert.equal(list.smoothed("没有这台"), null);
});

test("第一份列表：明显强的在前，差不多的按出现的先后", () => {
  const list = createScanList();
  assert.deepEqual(addrs(list.update([dev(A, -70), dev(B, -68), dev(C, -50), dev(D, -66)])), [C, A, B, D]);
});

test("信号差不多：来回超过对方也不换行", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -61)]);
  for (let i = 0; i < 200; i++) {
    const flip = i % 2 ? 4 : -4;
    const rows = list.update([dev(A, -60 + flip), dev(B, -60 - flip)]);
    assert.deepEqual(addrs(rows), [A, B], "第 " + i + " 次");
  }
});

test("手机那一层换了报的先后（Android 的表没有固定顺序）也不换行", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -60)]);
  assert.deepEqual(addrs(list.update([dev(B, -59), dev(A, -61)])), [A, B]);
  assert.deepEqual(addrs(list.update([dev(B, -58), dev(A, -62)])), [A, B]);
});

test("原值跳一下 20 dB：平滑后不够回差，不换", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -62)]);
  /* B 一次跳到 -45：ema = -56.9，只比 A 强 3.1 */
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -45)])), [A, B]);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -62)])), [A, B]);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -62)])), [A, B]);
});

test("平滑后的差一直小于 6 dB：多久都不换", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -60)]);
  for (let i = 0; i < 100; i++) assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -54.5)])), [A, B]);
  assert.ok(list.smoothed(B) - list.smoothed(A) < THRESHOLD_DB);
});

test("强过 6 dB 并且连续 2 次才换到上面", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -60)]);
  let rows;
  let gaps = [];
  const steps = [];
  for (let i = 0; i < 12; i++) {
    rows = list.update([dev(A, -60), dev(B, -50)]);
    gaps.push(list.smoothed(B) - list.smoothed(A));
    steps.push(addrs(rows).join(","));
  }
  const firstOver = gaps.findIndex((g) => g >= THRESHOLD_DB);
  assert.ok(firstOver > 0, "平滑后要过几次才到 6 dB");
  /* 第一次到 6 dB 的那一次还不换，下一次（连续第 2 次）才换 */
  assert.equal(steps[firstOver], [A, B].join(","));
  assert.equal(steps[firstOver + 1], [B, A].join(","));
  assert.equal(steps[11], [B, A].join(","));
});

test("只强过一次就掉回去：重新数，不换", () => {
  const list = createScanList({ alpha: 1 });
  list.update([dev(A, -60), dev(B, -60)]);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -50)])), [A, B]);   /* 第 1 次 */
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -58)])), [A, B]);   /* 断了 */
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -50)])), [A, B]);   /* 又是第 1 次 */
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -50)])), [B, A]);   /* 连续第 2 次 */
});

test("换上去以后，对方要反过来强 6 dB 才换回来", () => {
  const list = createScanList({ alpha: 1 });
  list.update([dev(A, -60), dev(B, -50)]);
  assert.deepEqual(list.order(), [B, A]);
  for (let i = 0; i < 5; i++) assert.deepEqual(addrs(list.update([dev(A, -52), dev(B, -57)])), [B, A]);
  list.update([dev(A, -50), dev(B, -57)]);
  assert.deepEqual(addrs(list.update([dev(A, -50), dev(B, -57)])), [A, B]);
});

test("隔着几行也能上去：每相邻两行只差 3 dB，最下面比最上面强 9 dB", () => {
  const list = createScanList({ alpha: 1 });
  list.update([dev(A, -60), dev(B, -60), dev(C, -60), dev(D, -60)]);
  list.update([dev(A, -59), dev(B, -56), dev(C, -53), dev(D, -50)]);
  const rows = list.update([dev(A, -59), dev(B, -56), dev(C, -53), dev(D, -50)]);
  /* D 比 A 强 9、比 B 强 6：到 A 上面；C 比 A 强 6：也到 A 上面；B 只比 A 强 3：不动 */
  assert.deepEqual(addrs(rows), [D, C, A, B]);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(addrs(list.update([dev(A, -59), dev(B, -56), dev(C, -53), dev(D, -50)])), [D, C, A, B]);
  }
});

test("同一份数据再报多少次，先后都不再变（不会来回倒）", () => {
  const list = createScanList({ alpha: 1 });
  const sample = [dev(A, -71), dev(B, -64), dev(C, -58), dev(D, -52)];
  list.update([dev(A, -60), dev(B, -60), dev(C, -60), dev(D, -60)]);
  list.update(sample);
  const settled = addrs(list.update(sample));
  assert.equal(settled[0], D);
  assert.equal(settled[3], A);
  for (let i = 0; i < 20; i++) assert.deepEqual(addrs(list.update(sample)), settled);
});

test("新出现的桩：明显强就放到前面，差不多就排在最后", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -62)]);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -62), dev(C, -58)])), [A, B, C]);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -62), dev(C, -58), dev(D, -40)])), [D, A, B, C]);
  assert.equal(list.firstSeen(A), 0);
  assert.equal(list.firstSeen(B), 1);
  assert.equal(list.firstSeen(C), 2);
  assert.equal(list.firstSeen(D), 3);
});

test("先到先排：一样强的桩按第一次出现的先后，和后来报的先后无关", () => {
  const list = createScanList();
  list.update([dev(B, -60)]);
  list.update([dev(A, -60), dev(B, -60)]);
  list.update([dev(C, -60), dev(A, -60), dev(B, -60)]);
  assert.deepEqual(list.order(), [B, A, C]);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(C, -60), dev(B, -60)])), [B, A, C]);
});

test("按住时：该换的也不换，数字照常更新；松开过一小会儿才换", () => {
  const list = createScanList({ alpha: 1 });
  let now = 1000;
  list.update([dev(A, -60), dev(B, -60)], now);
  list.hold(now);
  assert.equal(list.frozen(now), true);
  let rows;
  for (let i = 0; i < 5; i++) {
    now += 200;
    rows = list.update([dev(A, -60 - i), dev(B, -40)], now);
    assert.deepEqual(addrs(rows), [A, B]);
    assert.equal(rows[0].rssi, -60 - i);
    assert.equal(rows[1].rssi, -40);
  }
  list.release(now);
  assert.equal(list.frozen(now), true, "刚松手还冻着，等点击处理完");
  assert.deepEqual(addrs(list.rows(now + RELEASE_MS - 1)), [A, B]);
  assert.equal(list.frozen(now + RELEASE_MS), false);
  assert.deepEqual(addrs(list.rows(now + RELEASE_MS)), [B, A], "不用等下一次广播");
});

test("按住时没强到要换：松开后也不动", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -61)], 0);
  list.hold(0);
  list.update([dev(A, -63), dev(B, -59)], 100);
  list.release(200);
  assert.deepEqual(addrs(list.rows(200 + RELEASE_MS)), [A, B]);
  assert.deepEqual(addrs(list.update([dev(A, -63), dev(B, -59)], 1000)), [A, B]);
});

test("按住时新出现的桩只加在最后，松开后再按信号放位置", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -62)], 0);
  list.hold(0);
  assert.deepEqual(addrs(list.update([dev(C, -30), dev(A, -60), dev(B, -62)], 100)), [A, B, C]);
  assert.deepEqual(addrs(list.update([dev(D, -61), dev(C, -30), dev(A, -60), dev(B, -62)], 200)), [A, B, C, D]);
  list.release(300);
  assert.deepEqual(addrs(list.rows(300 + RELEASE_MS)), [C, A, B, D]);
});

test("按住时消失的桩照常去掉，其余的先后不变", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -60), dev(C, -60)], 0);
  list.hold(0);
  assert.deepEqual(addrs(list.update([dev(C, -30), dev(A, -60)], 100)), [A, C]);
  assert.equal(list.smoothed(B), null);
});

test("松开的事件丢了：按住超过上限就不再冻", () => {
  const list = createScanList({ alpha: 1 });
  list.update([dev(A, -60), dev(B, -60)], 0);
  list.hold(0);
  list.update([dev(A, -60), dev(B, -40)], 100);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -40)], HOLD_MAX_MS - 1)), [A, B]);
  assert.equal(list.frozen(HOLD_MAX_MS), false);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -40)], HOLD_MAX_MS)), [B, A]);
  /* 再按一次重新计时 */
  list.hold(HOLD_MAX_MS + 5);
  assert.equal(list.frozen(HOLD_MAX_MS + 10), true);
});

test("没按就 release：什么都不变", () => {
  const list = createScanList();
  list.update([dev(A, -60)], 0);
  list.release(50);
  assert.equal(list.frozen(51), false);
});

test("消失的桩去掉；再出现算新的（平滑和先后都从头来）", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -90), dev(C, -60)]);
  list.update([dev(A, -60), dev(B, -90), dev(C, -60)]);
  assert.deepEqual(addrs(list.update([dev(B, -90), dev(C, -60)])), [C, B]);
  assert.equal(list.smoothed(A), null);
  assert.equal(list.firstSeen(A), null);
  const rows = list.update([dev(A, -80), dev(B, -90), dev(C, -60)]);
  assert.equal(list.smoothed(A), -80, "不接着以前的 -60 算");
  assert.equal(list.firstSeen(A), 3);
  assert.deepEqual(addrs(rows), [C, A, B]);
});

test("消失的桩留下的“连续几次”不带到再出现的那一次", () => {
  const list = createScanList({ alpha: 1 });
  list.update([dev(A, -60), dev(B, -60)]);
  list.update([dev(A, -60), dev(B, -50)]);            /* B 强过第 1 次 */
  list.update([dev(A, -60)]);                         /* B 没了 */
  list.update([dev(A, -60), dev(B, -58)]);            /* 再出现，排在后面 */
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -50)])), [A, B], "这是第 1 次，不是第 2 次");
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -50)])), [B, A]);
});

test("空列表（重新扫描）：全部清零", () => {
  const list = createScanList();
  list.update([dev(A, -80), dev(B, -50)]);
  list.update([dev(A, -80), dev(B, -50)]);
  assert.deepEqual(list.update([]), []);
  assert.deepEqual(list.order(), []);
  assert.equal(list.smoothed(A), null);
  assert.equal(list.firstSeen(B), null);
  const rows = list.update([dev(A, -70), dev(B, -70)]);
  assert.deepEqual(addrs(rows), [A, B]);
  assert.equal(list.smoothed(A), -70);
  assert.equal(list.firstSeen(A), 0);
  assert.deepEqual(list.update(null), []);
  assert.deepEqual(list.update(undefined), []);
});

test("按住时清空再来：新的一轮按新的先后，不留上一轮冻住的行", () => {
  const list = createScanList();
  list.update([dev(A, -60), dev(B, -60)], 0);
  list.hold(0);
  list.update([], 100);
  assert.deepEqual(addrs(list.update([dev(B, -60), dev(A, -60)], 200)), [B, A]);
});

test("坏数据：没有 addr 的不要，重复的 addr 只留第一条，rssi 不是数也不出错", () => {
  const list = createScanList();
  const rows = list.update([null, { name: "x" }, dev(A, -60), dev(A, -20), { name: "EVC_Q", addr: B }]);
  assert.deepEqual(addrs(rows), [A, B]);
  assert.equal(rows[0].rssi, -60);
  assert.equal(list.smoothed(B), null);
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -30)])), [A, B], "B 的第 1 个数刚来，第 1 次强过");
  assert.deepEqual(addrs(list.update([dev(A, -60), dev(B, -30)])), [B, A]);
});

test("不改手机那一层给的对象，也不改传进来的数组", () => {
  const input = [Object.freeze(dev(B, -70)), Object.freeze(dev(A, -40))];
  const copy = input.slice();
  const list = createScanList();
  const rows = list.update(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(addrs(rows), [A, B]);
  assert.notEqual(list.order(), list.order());
});

/* ---- 真的页面 ---- */

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}
function cards(app) {
  return app.byClass("device").map((n) => ({
    node: n,
    name: app.byClass("device").length && n.children ? textOfStrong(n) : "",
  }));
}
function textOfStrong(node) {
  let out = "";
  const walk = (n) => {
    if (!n || !n.children) return;
    if (n.tag === "strong") out += n.children.map((c) => c.text || "").join("");
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}
const names = (app) => cards(app).map((c) => c.name);
const rssiShown = (app) => app.byClass("device").map((n) => {
  const em = n.children.filter((c) => c.tag === "em")[0];
  return em.children.map((c) => c.text || "").join("");
});
const P1 = { name: "EVC_ONE001", addr: "AA:00:00:00:01:01" };
const P2 = { name: "EVC_TWO002", addr: "AA:00:00:00:01:02" };
const P3 = { name: "EVCMTHREE3", addr: "AA:00:00:00:01:03" };
const devs = (app, list) => app.vm.handle({ t: "devs", list: list.map(([p, rssi]) => ({ name: p.name, addr: p.addr, rssi })) });

test("页面：信号差不多的两张卡不来回换，数字跟着最新的变，类型标签还在", async () => {
  const app = await mountShell({});
  devs(app, [[P1, -60], [P2, -61], [P3, -75]]);
  await flush();
  assert.deepEqual(names(app), [P1.name, P2.name, P3.name]);
  for (let i = 0; i < 20; i++) {
    devs(app, i % 2 ? [[P1, -64], [P2, -57], [P3, -75]] : [[P2, -64], [P3, -75], [P1, -57]]);
    await flush();
    assert.deepEqual(names(app), [P1.name, P2.name, P3.name]);
  }
  assert.deepEqual(rssiShown(app), ["-64", "-57", "-75"]);
  const kinds = app.byClass("device").map((n) => String(n.props.class));
  assert.match(kinds[0], /kind-ac06/);
  assert.match(kinds[2], /kind-m01/);
  app.close();
});

test("页面：按住列表时不换行，松开后过一小会儿换；空列表清掉", async () => {
  const app = await mountShell({});
  devs(app, [[P1, -60], [P2, -60]]);
  await flush();
  const box = app.byClass("scan-list")[0];
  for (const key of ["onPointerdown", "onPointerup", "onPointercancel", "onPointerleave", "onTouchend", "onTouchcancel"]) {
    assert.equal(typeof box.props[key], "function", key);
  }
  const touchStart = box.props.onTouchstartPassive || box.props.onTouchstart;
  assert.equal(typeof touchStart, "function");
  box.props.onPointerdown({});
  touchStart({});
  for (let i = 0; i < 12; i++) {
    mock.timers.tick(200);
    devs(app, [[P1, -80], [P2, -40]]);
    await flush();
    assert.deepEqual(names(app), [P1.name, P2.name]);
  }
  assert.deepEqual(rssiShown(app), ["-80", "-40"]);
  /* 滚动：指针被取消了，手指还在 */
  box.props.onPointercancel({});
  mock.timers.tick(RELEASE_MS + 100);
  devs(app, [[P1, -80], [P2, -40]]);
  await flush();
  assert.deepEqual(names(app), [P1.name, P2.name]);
  box.props.onTouchend({});
  await flush();
  assert.deepEqual(names(app), [P1.name, P2.name], "刚松手不动");
  mock.timers.tick(RELEASE_MS + 100);
  await flush();
  assert.deepEqual(names(app), [P2.name, P1.name]);
  devs(app, []);
  await flush();
  assert.deepEqual(names(app), []);
  assert.match(app.text(), /附近还没有名为 EVC 的充电桩/);
  devs(app, [[P1, -60], [P2, -60]]);
  await flush();
  assert.deepEqual(names(app), [P1.name, P2.name], "上一轮的先后不留");
  app.close();
});

test("页面：按下、松开、点击，连的是手指下的那一台", async () => {
  /* 两台都存了密码：点了就直接连（没存的话先停在输密码那一页） */
  const app = await mountShell({ pins: { [P1.addr]: "123456", [P2.addr]: "123456" } });
  devs(app, [[P1, -60], [P2, -60]]);
  await flush();
  const box = app.byClass("scan-list")[0];
  /* 先让 P2 攒够“该换到上面”，但手指按着 */
  box.props.onPointerdown({});
  for (let i = 0; i < 12; i++) {
    devs(app, [[P1, -85], [P2, -40]]);
    await flush();
  }
  const first = app.byClass("device")[0];
  assert.equal(textOfStrong(first), P1.name);
  box.props.onPointerup({});
  devs(app, [[P1, -85], [P2, -40]]);
  await flush();
  /* 点击紧跟在松手后面：行还没动，按钮还是 P1 */
  assert.equal(textOfStrong(app.byClass("device")[0]), P1.name);
  first.props.onClick({ stopPropagation() {} });
  await flush();
  const connects = app.calls.filter((c) => c[0] === "connect");
  assert.deepEqual(connects, [["connect", P1.addr]]);
  app.close();
});
