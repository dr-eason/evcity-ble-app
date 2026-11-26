/* M01 模块按 AC06 的样子重做（m01/M01App.vue、m01/tabs.js）：底部三个标签、分组设置、没有自己的
 * 扫描页；M01 原来菜单里的入口一个不少；语言、本地存储的键和 AC06 分开或共用得对。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { M01_MENU_ITEMS, SETTINGS_GROUPS, TABS, isTabPage, rootBack, subpageBack, tabBarShown } from "../src/m01/tabs.js";

const vue = readFileSync(new URL("../src/m01/M01App.vue", import.meta.url), "utf8");
const template = vue.slice(0, vue.indexOf("<script setup>"));
const script = vue.slice(vue.indexOf("<script setup>"), vue.indexOf("</script>"));
const shell = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");

test("标签：立即充电（10 路首页）/ 充电记录 / 设置；规则和 AC06 的 tabs.js 一样", () => {
  assert.deepEqual(TABS.map((t) => t.id), ["charge", "orders", "menu"]);
  assert.equal(isTabPage("port"), false);
  assert.equal(tabBarShown("charge", true, true, false), true);
  assert.equal(tabBarShown("charge", true, false, false), false);
  assert.equal(tabBarShown("charge", true, true, true), false);
  assert.equal(tabBarShown("ota", true, true, false), false);
  assert.equal(rootBack("orders"), "charge");
  assert.equal(rootBack("menu"), "charge");
  assert.equal(rootBack("charge"), null);
  assert.equal(subpageBack("port", "menu"), "charge");
  assert.equal(subpageBack("wifi", "menu"), "menu");
  assert.equal(subpageBack("wifi", "x"), "menu");
  assert.match(template, /<nav v-if="tabBarOn" class="tabbar" role="tablist">/);
});

test("设置分组：M01 原来菜单里的入口一个不少，每个只出现一次（充电记录挪到了标签栏）", () => {
  const menu = template.slice(template.indexOf("v-else-if=\"page === 'menu'\""), template.indexOf("v-else-if=\"page === 'authinfo'\""));
  const clicks = [...menu.matchAll(/@click="(open[A-Za-z]+)/g)].map((m) => m[1]);
  const grouped = SETTINGS_GROUPS.flatMap((g) => g.items);
  assert.deepEqual(clicks, grouped);
  assert.equal(new Set(clicks).size, clicks.length);
  for (const item of M01_MENU_ITEMS) {
    if (item === "openOrders") continue;
    assert.ok(clicks.includes(item), item);
  }
  for (const group of SETTINGS_GROUPS) assert.ok(menu.includes("t('" + group.title + "')"), group.title);
  assert.match(script, /else if \(id === "orders"\) openOrders\(\);/);
});

test("M01 的页面一个不少（扫描、语言存储归外壳）", () => {
  const pages = [...template.matchAll(/page === '([a-zA-Z]+)'/g)].map((m) => m[1]);
  for (const name of ["charge", "port", "plim", "pay", "par", "gate", "lang", "privacy", "menu", "profiles", "profileName",
    "profileRun", "netstop", "reboot", "orders", "wifi", "pass", "ocpp", "cfg", "ocfw", "tz", "lte", "modver", "ota", "telemetry"]) {
    assert.ok(pages.includes(name), name);
  }
  assert.ok(!pages.includes("scan"), "M01 模块没有自己的扫描页");
  assert.ok(!/page\.value = "scan"/.test(script));
  assert.ok(!/startScan\(/.test(script));
  assert.ok(!/evcTryBack/.test(script.replace(/\/\*[\s\S]*?\*\//g, "")), "系统返回键由外壳转过来");
  assert.match(script, /defineExpose\(\{ handle, connect, tryBack \}\);/);
});

test("本地存储：密码、一键配置用 m01- 的键；语言用外壳的 ac06-lang（m01-lang 不再用）", () => {
  assert.match(script, /return "m01-gate:" \+ linkAddr\.value;/);
  assert.ok(!/m01-lang/.test(script));
  for (const m of script.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^,)]+)/g)) {
    assert.ok(/gateKey\(|PROFILE_KEY/.test(m[1]), m[1]);
  }
  assert.match(shell, /localStorage\.setItem\("ac06-lang", id\)/);
  assert.match(shell, /<M01App v-if="mod === 'm01'" ref="m01Ref" :lang="lang" @exit="onM01Exit" @set-lang="storeLang" \/>/);
});

test("AC06 样式：同一套类名（卡片、分组、按钮、标签栏），M01 独有的样式挂在 .m01app 下", () => {
  assert.match(template, /<main class="app m01app"/);
  assert.match(template, /class="body settings"/);
  assert.match(template, /class="group-title"/);
  const style = vue.slice(vue.indexOf("<style>"), vue.indexOf("</style>"));
  for (const line of style.split("\n")) {
    if (/^\s*[.#a-z][^{]*\{/.test(line)) assert.match(line, /^\.m01app /, line);
  }
  assert.ok(!/<style scoped>/.test(vue));
});

test("卸掉模块时停下每秒一拍，之后不再往蓝牙发东西", () => {
  assert.match(script, /onBeforeUnmount\(\(\) => \{\n  gone = true;\n  linkReady\.value = false;\n  clearInterval\(tickTimer\);\n  clearInterval\(otaLeaseTimer\);/);
  assert.match(script, /if \(!api \|\| gone\) return;/);
});
