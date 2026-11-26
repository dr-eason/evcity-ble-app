/* 2.8.0 底部标签栏（立即充电 / 预约充电 / 设置）的主机测试：
 *   - tabs.js 的规则：哪几页是标签首页、标签栏什么时候显示、返回键和返回按钮回哪里、语言页回哪里；
 *   - App.vue：设置页分组列表里原来配置菜单的入口一个不少、每个只出现一次，预约成了标签；
 *     标签栏固定在底部、让出 iOS 安全区；切标签只换 page，不发断开；
 *   - 新文案 12 种语言都有；
 *   - 蓝牙命令没有变：界面发出的命令名和 2.7.2 一样，AUTH 门控那段没动。
 * 跑法：node --test test/*.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS_GROUPS, TABS, isTabPage, langReturn, rootBack, subpageBack, tabBarShown, tabTitle } from "../src/tabs.js";
import { languages, translate } from "../src/i18n.js";

const ui = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(ui, path), "utf8");
const vue = read("src/App.vue");
const script = vue.slice(vue.indexOf("<script setup>"));
const section = (name) => {
  const m = vue.match(new RegExp("<section v-else-if=\"page === '" + name + "'\"[\\s\\S]*?</section>"));
  assert.ok(m, "找不到页面 " + name);
  return m[0];
};

test("三个标签：立即充电、预约充电、设置，对应原来的 charge、sched、menu 三页", () => {
  assert.deepEqual(TABS.map((item) => item.id), ["charge", "sched", "menu"]);
  assert.deepEqual(TABS.map((item) => item.label), ["立即充电", "预约充电", "设置"]);
  for (const id of ["charge", "sched", "menu"]) assert.equal(isTabPage(id), true, id);
  for (const id of ["scan", "gate", "lang", "privacy", "wifi", "pass", "lte", "ota", "tz", "profiles", "profileRun", "authinfo", "", undefined]) {
    assert.equal(isTabPage(id), false, String(id));
  }
  assert.equal(tabTitle("charge"), "立即充电");
  assert.equal(tabTitle("menu"), "设置");
  assert.equal(tabTitle("wifi"), "");
});

test("标签栏只在标签首页、连着、密码通过、没在打字时显示", () => {
  assert.equal(tabBarShown("charge", true, true, false), true);
  assert.equal(tabBarShown("sched", true, true, false), true);
  assert.equal(tabBarShown("menu", true, true, false), true);
  /* 没连上、密码没过（AUTH 门控期间只有密码页）、键盘弹出、二级页：都不显示。 */
  assert.equal(tabBarShown("charge", false, true, false), false);
  assert.equal(tabBarShown("charge", true, false, false), false);
  assert.equal(tabBarShown("charge", true, true, true), false);
  for (const page of ["scan", "gate", "lang", "privacy", "wifi", "ota", "tz", "authinfo"]) {
    assert.equal(tabBarShown(page, true, true, false), false, page);
  }
});

test("返回：预约、设置回立即充电；立即充电没有上一个标签（系统返回键在那里断开回扫描列表）；二级页回进来时的标签", () => {
  assert.equal(rootBack("sched"), "charge");
  assert.equal(rootBack("menu"), "charge");
  assert.equal(rootBack("charge"), null);
  assert.equal(rootBack("wifi"), null);
  assert.equal(subpageBack("sched"), "sched");
  assert.equal(subpageBack("menu"), "menu");
  assert.equal(subpageBack("charge"), "charge");
  assert.equal(subpageBack("wifi"), "menu");
  assert.equal(subpageBack(undefined), "menu");
});

test("语言页：从哪个标签进就回哪个标签；断开了或从扫描页进，回扫描页", () => {
  assert.equal(langReturn("charge", true), "charge");
  assert.equal(langReturn("sched", true), "sched");
  assert.equal(langReturn("menu", true), "menu");
  assert.equal(langReturn("menu", false), "scan");
  assert.equal(langReturn("scan", true), "scan");
  assert.equal(langReturn("wifi", true), "scan");
});

test("设置页：原来配置菜单的 18 个入口，预约变成标签，其余 17 个分组列出，各出现一次", () => {
  const menu = section("menu");
  /* 2.7.2 配置菜单里的入口（按原来的顺序）。 */
  const old = ["openImax", "page = 'plug'", "openCards", "openWifi", "openLte", "openOcpp", "openSched", "openTz", "openQr",
    "openOcfw", "openOrders", "openTelemetry", "openNetStop", "openCfg", "openReboot", "openProfiles", "openModver", "openOta"];
  const entries = [...menu.matchAll(/<button class="card device" @click="([^"]+)">/g)].map((m) => m[1]);
  for (const name of old) {
    if (name === "openSched") continue;
    assert.equal(entries.filter((e) => e === name).length, 1, name);
  }
  assert.ok(!entries.includes("openSched"), "预约已经是标签，设置页里不再重复");
  /* 分组和 tabs.js 的表一致：组名按顺序出现，入口按组排列。 */
  const titles = [...menu.matchAll(/<p class="group-title">\{\{ t\('([^']+)'\) \}\}<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(titles, SETTINGS_GROUPS.map((g) => g.title));
  assert.deepEqual(entries, SETTINGS_GROUPS.flatMap((g) => g.items));
  const listed = new Set(SETTINGS_GROUPS.flatMap((g) => g.items));
  for (const name of old) if (name !== "openSched") assert.ok(listed.has(name), name);
  /* 关于：管理员密码（只看、只清本机记住的）、隐私协议、App 版本；最下面还能断开蓝牙。 */
  assert.match(menu, /t\('App 版本'\)[\s\S]*?appVersion/);
  assert.match(menu, /@click="disconnect"/);
  /* 每组的入口在同一个 .group 里。 */
  assert.equal((menu.match(/<div class="group">/g) || []).length, SETTINGS_GROUPS.length);
});

test("预约充电标签：原来的预约页，加上当前预约、系统时间、去时区设置的入口", () => {
  const sched = section("sched");
  assert.match(sched, /t\('当前预约'\)[\s\S]*?schedLabel/);
  assert.match(sched, /@click="openTz"/);
  assert.match(sched, /@click="saveSched"/);
  for (const mode of [0, 1, 2]) assert.ok(sched.includes("pickSchedMode(" + mode + ")"), String(mode));
  /* 改了一半切走再回来不被桩里的值盖掉；保存成功才以桩里的为准。 */
  assert.match(script, /if \(!schedDirty\.value\) \{\n\s+schedMode\.value = schedSaved\.mode;/);
  assert.match(script, /line\.indexOf\("SCHEDSET"\) >= 0 && line\.indexOf\("OK"\) >= 0\) \{\n\s+schedDirty\.value = false;/);
  /* 首页上的“预约充电”一行和预约页顶上都按桩里存着的显示。 */
  assert.match(script, /const schedLabel = computed\(\(\) => \{\n\s+if \(!schedSaved\.known\) return "…";/);
  assert.match(section("charge"), /@click="goTab\('sched'\)"[\s\S]*?schedLabel/);
});

test("标签栏：固定在底部、让出安全区、选中态明显，切标签不断开蓝牙", () => {
  const nav = vue.match(/<nav v-if="tabBarOn" class="tabbar"[\s\S]*?<\/nav>/);
  assert.ok(nav, "没有标签栏");
  assert.match(nav[0], /v-for="item in TABS"/);
  assert.match(nav[0], /:class="\{ on: page === item\.id \}"/);
  assert.match(nav[0], /@click="goTab\(item\.id\)"/);
  assert.match(nav[0], /<svg /);
  /* 在所有 section 后面，不会被某一页的 v-if 一起收掉。 */
  assert.ok(vue.lastIndexOf("</section>") < vue.indexOf('<nav v-if="tabBarOn"'));
  const style = vue.slice(vue.indexOf("<style>"));
  assert.match(style, /\.tabbar \{[^}]*position: fixed;[^}]*bottom: 0;/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
  assert.match(style, /\.app\.tabbed \{[^}]*padding-bottom:/);
  assert.match(style, /\.tab\.on \{[^}]*color: #f5c400;/);
  /* 切标签：只换页、各读一次自己的数据，不断开。 */
  const goTab = script.slice(script.indexOf("function goTab(id) {"), script.indexOf("\n}\n", script.indexOf("function goTab(id) {")));
  assert.ok(goTab.length > 0);
  assert.ok(!/disconnect|stopScan|resetCharge|resetGate/.test(goTab), goTab);
  assert.match(goTab, /if \(id === "menu"\) openMenu\(\);/);
  assert.match(goTab, /else if \(id === "sched"\) openSched\(\);/);
  /* 齿轮按钮去掉了：设置在标签栏里。右上角语言按钮在扫描页和三个标签首页都有。 */
  assert.ok(!vue.includes('class="gear"'));
  assert.match(vue, /<button v-if="page === 'scan' \|\| isTabPage\(page\)" class="lang" @click="openLang">/);
  /* 断开后回到扫描页：原生层发 page=scan 那一段照旧。 */
  assert.match(script, /if \(page\.value === "scan"\) \{\n\s+stopTimeSync\(\);/);
  /* 系统返回键：只有停在扫描列表上（没连着）返回 false；立即充电和「断开蓝牙」一样 disconnect()，
   * 其余走 back()。跑起来的测试在 system-back.test.mjs。 */
  const tryBack = script.slice(script.indexOf("window.evcTryBack = function"), script.indexOf("function submitGate"));
  assert.equal((tryBack.match(/return false;/g) || []).length, 1);
  assert.match(tryBack, /if \(page\.value === "scan"\) \{\n[^\n]*\n\s+if \(!linkReady\.value\) return false;/);
  assert.match(tryBack, /if \(page\.value === "charge"\) \{\n\s+disconnect\(\);\n\s+return true;/);
  assert.match(script, /else if \(rootBack\(page\.value\)\) goTab\(rootBack\(page\.value\)\);/);
});

test("AUTH 门控没动：通过后才进立即充电，标签栏也要密码通过才出来", () => {
  assert.match(script, /const tabBarOn = computed\(\(\) => tabBarShown\(page\.value, linkReady\.value, gateState\.value === "ok", typing\.value\)\);/);
  const enter = script.slice(script.indexOf('if (step.action === "enter")'), script.indexOf('if (step.action === "resume")'));
  assert.match(enter, /page\.value = "charge";/);
  /* 管理员密码页只清本机记住的，不发命令。 */
  const info = script.slice(script.indexOf("function clearRememberedGate() {"), script.indexOf("\n}\n", script.indexOf("function clearRememberedGate() {")));
  assert.ok(info.includes("forgetGate();") && !info.includes("send("));
});

test("蓝牙命令没有变：界面发出的命令名和 2.7.2 一样", () => {
  const names = new Set();
  for (const m of vue.matchAll(/(?:send|roundTrip|askLine|askTime|askLte|askTz|askClk|askModver)\(["']([A-Z]+)/g)) names.add(m[1]);
  assert.deepEqual([...names].sort(), [
    "AUTH", "CARDGET", "CARDSET", "CFGGET", "CFGSET", "IMAXGET", "IMAXSET", "NETSTOPGET", "NETSTOPSET", "OCFWGET", "OCFWSET",
    "OCPPGET", "OCPPSET", "OCPPSWGET", "OCPPSWSET", "ORDGET", "OTAABORT", "OTACHECK", "OTADATA", "OTAEND", "OTASTART",
    "PLUGSET", "QRGET", "QRSET", "REBOOT", "SCHEDGET", "SCHEDSET", "START", "STOP", "TELGET", "TELSET", "WCFGGET",
    "WIFISWGET", "WIFISWSET", "WJOIN", "WSCAN",
  ].sort());
});

test("新文案 12 种语言都有", () => {
  const used = new Set(TABS.map((item) => item.label));
  SETTINGS_GROUPS.forEach((g) => used.add(g.title));
  for (const name of ["menu", "sched", "authinfo", "charge"]) {
    for (const m of section(name).matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  }
  for (const m of script.matchAll(/authInfoNote\.value = "([^"]+)"/g)) used.add(m[1]);
  for (const key of ["立即充电", "设置", "充电设置", "网络与平台", "保护与屏幕", "维护", "关于", "App 版本", "已记住", "未记住",
    "连接时核对屏幕上的 6 位密码", "清除记住的密码", "当前预约", "修改时区",
    "这台手机已记住这台充电桩的管理员密码，下次连接自动核对。",
    "这台手机没有记住这台充电桩的管理员密码，下次连接要输入屏幕上的密码。",
    "已清除。下次连接这台充电桩要重新输入密码。"]) {
    assert.ok(used.has(key), key);
  }
  for (const key of used) {
    for (const item of languages) {
      if (item.id === "zh") continue;
      const out = translate(item.id, key);
      /* 一两个字的词在日文里可以和中文同形。 */
      assert.ok(out && (out !== key || key.length <= 2), item.id + " 没有翻译: " + key);
    }
  }
});
