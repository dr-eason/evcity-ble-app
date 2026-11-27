/* 启动和停止之间至少隔 1 秒（3.0.8，src/charge-toggle-guard.js）的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/charge-toggle-guard.test.mjs
 *
 * 1. 规矩本身：启动后 1 秒内停止不算、满 1 秒可以；反过来一样；每一路各算各的；
 *    命令没成马上放开；断开清掉。
 * 2. 源码：App.vue（汽车充电桩）和 m01/M01App.vue（摩托车充电桩）的每个启动 / 停止按钮都接了，
 *    按钮置灰、处理函数里也拦。
 * 3. 打包好的页面里有这段逻辑。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOGGLE_ALL, TOGGLE_GAP_MS, TOGGLE_SOLO, newToggleGuard, resetToggleGuard, toggleBlocked, toggleLeft,
  toggleMark, toggleNextMs, toggleRelease, toggleTap,
} from "../src/charge-toggle-guard.js";
import { GB_WAIT_MS, newStopGuard, stopTap, stopView } from "../src/gbstop.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, "..", path), "utf8");
const T0 = 1700000000000;

test("最小间隔是 1000 毫秒", () => {
  assert.equal(TOGGLE_GAP_MS, 1000);
});

test("启动后 1 秒内点停止不算；满 1 秒可以", () => {
  const guard = newToggleGuard();
  assert.equal(toggleTap(guard, "START", T0), true);
  for (const dt of [0, 1, 250, 500, 999]) {
    assert.equal(toggleBlocked(guard, "STOP", T0 + dt), true, String(dt));
    assert.equal(toggleTap(guard, "STOP", T0 + dt), false, String(dt));
  }
  assert.equal(toggleLeft(guard, "STOP", T0 + 400), 600);
  /* 被拦的那几下不重新计时。 */
  assert.equal(toggleBlocked(guard, "STOP", T0 + 1000), false);
  assert.equal(toggleTap(guard, "STOP", T0 + 1000), true);
});

test("停止后 1 秒内点启动不算；满 1 秒可以", () => {
  const guard = newToggleGuard();
  assert.equal(toggleTap(guard, "STOP", T0), true);
  assert.equal(toggleTap(guard, "START", T0 + 1), false);
  assert.equal(toggleTap(guard, "START", T0 + 999), false);
  assert.equal(toggleBlocked(guard, "START", T0 + 999), true);
  assert.equal(toggleTap(guard, "START", T0 + 1500), true);
  /* 刚启动：停止又要等 1 秒。 */
  assert.equal(toggleTap(guard, "STOP", T0 + 2000), false);
  assert.equal(toggleTap(guard, "STOP", T0 + 2500), true);
});

test("边界：差 1 毫秒还拦，正好 1000 毫秒放开", () => {
  const guard = newToggleGuard();
  toggleTap(guard, "START", T0);
  assert.equal(toggleLeft(guard, "STOP", T0 + TOGGLE_GAP_MS - 1), 1);
  assert.equal(toggleBlocked(guard, "STOP", T0 + TOGGLE_GAP_MS - 1), true);
  assert.equal(toggleLeft(guard, "STOP", T0 + TOGGLE_GAP_MS), 0);
  assert.equal(toggleBlocked(guard, "STOP", T0 + TOGGLE_GAP_MS), false);
  assert.equal(toggleTap(guard, "STOP", T0 + TOGGLE_GAP_MS), true);
});

test("同一个方向连着点不拦，但每点一次重新计时；连点最多被挡 1 秒", () => {
  const guard = newToggleGuard();
  assert.equal(toggleTap(guard, "START", T0), true);
  assert.equal(toggleBlocked(guard, "START", T0 + 10), false);
  assert.equal(toggleTap(guard, "START", T0 + 600), true);
  assert.equal(toggleBlocked(guard, "STOP", T0 + 1000), true);
  assert.equal(toggleBlocked(guard, "STOP", T0 + 1599), true);
  assert.equal(toggleBlocked(guard, "STOP", T0 + 1600), false);
  /* 不点了，无论如何 1 秒后放开。 */
  for (const cmd of ["START", "STOP"]) assert.equal(toggleLeft(guard, cmd, T0 + 600 + TOGGLE_GAP_MS), 0);
});

test("手机时钟往回拨了不会一直挡着；别的命令名不认", () => {
  const guard = newToggleGuard();
  toggleTap(guard, "START", T0);
  assert.equal(toggleBlocked(guard, "STOP", T0 - 5000), false);
  assert.equal(toggleTap(guard, "PORTSEL", T0), false);
  assert.equal(toggleBlocked(guard, "PORTSEL", T0), false);
  assert.equal(toggleLeft(guard, "", T0), 0);
});

test("每一路各算各的：第 3 路刚停，第 5 路马上可以启动", () => {
  const guard = newToggleGuard();
  assert.equal(toggleTap(guard, "STOP", T0, 3), true);
  assert.equal(toggleBlocked(guard, "START", T0 + 100, 3), true);
  assert.equal(toggleBlocked(guard, "START", T0 + 100, 5), false);
  assert.equal(toggleTap(guard, "START", T0 + 100, 5), true);
  /* 第 5 路刚启动：它的停止要等，第 3 路的停止不用。 */
  assert.equal(toggleTap(guard, "STOP", T0 + 200, 5), false);
  assert.equal(toggleTap(guard, "STOP", T0 + 200, 3), true);
  assert.equal(toggleTap(guard, "START", T0 + 999, 3), false);
  assert.equal(toggleTap(guard, "STOP", T0 + 1100, 5), true);
  /* 汽车充电桩用的键和端口号不相干。 */
  assert.equal(toggleBlocked(guard, "START", T0 + 1150, TOGGLE_SOLO), false);
});

test("全部停止（端口 0）：算每一路都停了；任何一路刚启动时它也要等", () => {
  const guard = newToggleGuard();
  assert.equal(TOGGLE_ALL, 0);
  assert.equal(toggleTap(guard, "START", T0, 7), true);
  assert.equal(toggleBlocked(guard, "STOP", T0 + 500, TOGGLE_ALL), true);
  assert.equal(toggleTap(guard, "STOP", T0 + 500, TOGGLE_ALL), false);
  assert.equal(toggleTap(guard, "STOP", T0 + 1000, TOGGLE_ALL), true);
  for (const port of [1, 2, 7, 10]) {
    assert.equal(toggleBlocked(guard, "START", T0 + 1500, port), true, String(port));
    assert.equal(toggleBlocked(guard, "START", T0 + 2000, port), false, String(port));
  }
  /* App 自己发的全部停止（切换并机模式）只记时刻，不拦。 */
  const other = newToggleGuard();
  toggleTap(other, "START", T0, 2);
  toggleMark(other, "STOP", T0 + 100, TOGGLE_ALL);
  assert.equal(toggleBlocked(other, "START", T0 + 600, 9), true);
  assert.equal(toggleBlocked(other, "START", T0 + 1100, 9), false);
});

test("命令没成（桩拒绝、没应答）：马上放开对面的按钮", () => {
  const guard = newToggleGuard();
  toggleTap(guard, "START", T0, 4);
  assert.equal(toggleBlocked(guard, "STOP", T0 + 50, 4), true);
  toggleRelease(guard, "START", 4);                 /* ACK START⇥4⇥BUSY，或者 3 秒没应答 */
  assert.equal(toggleBlocked(guard, "STOP", T0 + 51, 4), false);
  assert.equal(toggleTap(guard, "STOP", T0 + 51, 4), true);
  /* 只放开自己那一条：期间已经点了别的，就不动它。 */
  toggleRelease(guard, "START", 4);
  assert.equal(toggleBlocked(guard, "START", T0 + 60, 4), true);
  /* 别的路不受影响；汽车充电桩（一把枪）一样。 */
  toggleTap(guard, "START", T0, 6);
  toggleRelease(guard, "START", 4);
  assert.equal(toggleBlocked(guard, "STOP", T0 + 60, 6), true);
  const solo = newToggleGuard();
  toggleTap(solo, "START", T0);
  toggleRelease(solo, "START");                     /* ACK START REJECTED */
  assert.equal(toggleBlocked(solo, "STOP", T0 + 1), false);
  /* 不放开也最多挡 1 秒（没应答时 3 秒才知道，那时早就放开了）。 */
  const late = newToggleGuard();
  toggleTap(late, "STOP", T0, 1);
  assert.equal(toggleBlocked(late, "START", T0 + 3000, 1), false);
});

test("断开、换设备：全部清掉", () => {
  const guard = newToggleGuard();
  toggleTap(guard, "START", T0);
  toggleTap(guard, "START", T0, 3);
  toggleTap(guard, "STOP", T0, TOGGLE_ALL);
  resetToggleGuard(guard);
  for (const key of [TOGGLE_SOLO, 3, 8, TOGGLE_ALL]) {
    assert.equal(toggleBlocked(guard, "STOP", T0 + 1, key), false);
    assert.equal(toggleBlocked(guard, "START", T0 + 1, key), false);
  }
  assert.equal(toggleNextMs(guard, T0 + 1), 0);
});

test("界面什么时候再刷新：最早放开的那个按钮", () => {
  const guard = newToggleGuard();
  assert.equal(toggleNextMs(guard, T0), 0);
  toggleTap(guard, "START", T0, 1);
  toggleTap(guard, "STOP", T0 + 300, 2);
  assert.equal(toggleNextMs(guard, T0 + 400), 600);
  assert.equal(toggleNextMs(guard, T0 + 1000), 300);
  assert.equal(toggleNextMs(guard, T0 + 1300), 0);
});

test("和严格模式的停止倒计时不相干：倒计时照旧 6.5 秒，启停间隔只管 1 秒", () => {
  const toggle = newToggleGuard();
  const stop = newStopGuard();
  toggleTap(toggle, "START", T0);
  /* 启动 1 秒内：停止被启停间隔拦住，严格模式的倒计时没有开始。 */
  assert.equal(toggleBlocked(toggle, "STOP", T0 + 500), true);
  assert.deepEqual(stopView(stop, T0 + 500), { disabled: false, seconds: 0 });
  /* 满 1 秒以后点停止：严格模式开着就进 6.5 秒倒计时；启动只被挡 1 秒。 */
  const now = T0 + 5000;
  assert.equal(toggleBlocked(toggle, "STOP", now), false);
  assert.equal(stopTap(stop, now, { gbOn: true, charging: true }), true);
  assert.equal(toggleTap(toggle, "STOP", now), true);
  assert.equal(stopView(stop, now + 1200).disabled, true);
  assert.equal(stopView(stop, now + GB_WAIT_MS).disabled, false);
  assert.equal(toggleBlocked(toggle, "START", now + 999), true);
  assert.equal(toggleBlocked(toggle, "START", now + 1000), false);
});

test("App.vue（汽车充电桩）：启动、停止按钮都接了，处理函数里也拦，断开时清掉", () => {
  const vue = read("src/App.vue");
  const template = vue.slice(0, vue.indexOf("<script"));
  const script = vue.slice(vue.indexOf("<script"));
  assert.match(script, /import \{[^}]*\bnewToggleGuard\b[^}]*\} from "\.\/charge-toggle-guard\.js";/);
  /* 模板：两个按钮都置灰；不再直接 send。 */
  assert.match(template, /<button class="go" :disabled="toggleOff\.start" @click="tapStart">\{\{ t\('启动'\) \}\}<\/button>/);
  assert.match(template, /<button class="ghost" :disabled="stopBtn\.disabled \|\| toggleOff\.stop" @click="tapStop">/);
  assert.ok(!template.includes("send('START')") && !template.includes("send('STOP')"));
  /* START、STOP 各只在一个地方发，而且先问过。 */
  assert.equal(script.match(/send\("START"\)/g).length, 1);
  assert.equal(script.match(/send\("STOP"\)/g).length, 1);
  assert.match(script, /function tapStart\(\) \{\s+if \(!bridge\(\)\) return;\s+if \(!toggleTap\(toggleGuard, "START", Date\.now\(\)\)\) return;\s+toggleRefresh\(\);\s+send\("START"\);\s+\}/);
  assert.match(script, /function tapStop\(\) \{\s+const now = Date\.now\(\);\s+if \(!bridge\(\) \|\| toggleBlocked\(toggleGuard, "STOP", now\)\) return;\s+if \(!stopTap\(/);
  assert.match(script, /send\("STOP"\);\s+toggleTap\(toggleGuard, "STOP", now\);\s+toggleRefresh\(\);/);
  /* 启动没被接受：放开。 */
  assert.match(script, /if \(line\.indexOf\("ACK START REJECTED"\) === 0\) \{\s+toggleRelease\(toggleGuard, "START"\);\s+toggleRefresh\(\);/);
  /* 断开 / 换设备（resetCharge）。 */
  const reset = script.slice(script.indexOf("function resetCharge()"));
  assert.match(reset.slice(0, reset.indexOf("\n}\n")), /resetStopGuard\(stopGuard\);\s+chargeToken = "";\s+resetToggle\(\);/);
  assert.match(script, /function resetToggle\(\) \{\s+resetToggleGuard\(toggleGuard\);\s+toggleRefresh\(\);/);
  /* 置灰用的是 App 已有的 button:disabled 样式。 */
  assert.match(vue, /button:disabled, input:disabled \{ opacity: 0\.45; \}/);
  /* 固件的应答就是这一行。 */
  const wb2 = readFileSync(resolve(here, "../../../../app/src/wb2.c"), "utf8");
  assert.ok(wb2.includes('ble_queue("ACK START REJECTED");'));
});

test("M01App.vue（摩托车充电桩）：格子、详情页、全部停止都接了，每一路各算各的", () => {
  const vue = read("src/m01/M01App.vue");
  const template = vue.slice(0, vue.indexOf("<script"));
  const script = vue.slice(vue.indexOf("<script"));
  assert.match(script, /import \{[^}]*\bnewToggleGuard\b[^}]*\} from "\.\.\/charge-toggle-guard\.js";/);
  /* 首页格子。 */
  assert.ok(template.includes(`:disabled="portBusyCmd || toggleOff('STOP', item.port)" @click.stop="cardStop(item.port)"`));
  assert.ok(template.includes(`:disabled="portBusyCmd || !item.ready || toggleOff('START', item.port)" @click.stop="cardStart(item.port)"`));
  /* 详情页。 */
  assert.ok(template.includes(`<button class="go" :disabled="portBusyCmd || toggleOff('START', portSel)" @click="startPort">`));
  assert.ok(template.includes(`<button class="ghost" :disabled="portBusyCmd || toggleOff('STOP', portSel)" @click="stopPort">`));
  /* 全部停止：入口和确认都置灰。 */
  assert.ok(template.includes(`<button class="go" :disabled="portBusyCmd || toggleOff('STOP', 0)" @click="confirmStopAll">`));
  assert.ok(template.includes(`<button v-else class="ghost" :disabled="portBusyCmd || toggleOff('STOP', 0)" @click="stopAllAsk = true">`));
  /* 模板里每个启动 / 停止的处理函数所在的按钮都带 toggleOff。 */
  for (const m of template.matchAll(/<button[^>]*@click(?:\.stop)?="(?:cardStart|cardStop|startPort|stopPort|confirmStopAll)[^"]*"[^>]*>/g)) {
    assert.ok(m[0].includes("toggleOff("), m[0]);
  }
  /* 处理函数：所有 START / STOP 都走 portCommand，它先问、没成就放开。 */
  const fn = script.slice(script.indexOf("async function portCommand(cmd, port) {"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /const toggles = cmd === "START" \|\| cmd === "STOP";\s+if \(toggles\) \{\s+if \(!toggleTap\(toggleGuard, cmd, Date\.now\(\), port\)\) return undefined;\s+toggleRefresh\(\);/);
  assert.ok(body.indexOf("toggleTap(") < body.indexOf("await ask("));
  assert.match(body, /if \(toggles && \(!ack \|\| ack\.result !== "OK"\)\) \{\s+toggleRelease\(toggleGuard, cmd, port\);\s+toggleRefresh\(\);/);
  for (const call of ['portCommand("START", port)', 'portCommand("STOP", port)', "portCommand(cmd, port)", 'portCommand("STOP", 0)']) {
    assert.ok(script.includes(call), call);
  }
  /* 除了并机切换（par-switch.js 自己发 STOP⇥0，这里记了时刻）以外，没有别处直接发。 */
  assert.ok(!/ask\("(START|STOP)\\t/.test(script));
  assert.match(script, /toggleMark\(toggleGuard, "STOP", Date\.now\(\), TOGGLE_ALL\);/);
  /* 断开 / 换设备（resetCharge）。 */
  const reset = script.slice(script.indexOf("function resetCharge()"));
  assert.match(reset.slice(0, reset.indexOf("\n}\n")), /portBusyCmd\.value = false;\s+resetToggle\(\);/);
  assert.match(script, /function resetToggle\(\) \{\s+resetToggleGuard\(toggleGuard\);\s+toggleRefresh\(\);/);
  assert.match(vue, /\.m01app \.port-btn:disabled \{ opacity: 0\.35; \}/);
});

test("打包好的页面（assets/index.html）里有这一版的启停间隔", () => {
  const html = readFileSync(resolve(here, "../../assets/index.html"), "utf8");
  assert.ok(html.includes("ACK START REJECTED"));
  assert.ok(!html.includes(`send('START')`) && !/onClick:[^,]{0,40}=>\s*\w+\("START"\)/.test(html));
});
