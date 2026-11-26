/* 设置页「保存」按钮：保存的结果写在按钮上（src/save-btn.js），不再写到页面上面的提示里。
 *
 *     node --test AC06/tools/ble-finder/ui/test/save-btn.test.mjs
 *
 * 1. 状态机（假的定时器）：保存中… → 保存成功 / 保存成功，重启生效 / 保存失败，2.5 秒后回到「保存」；
 *    等不到应答按「充电桩没有应答」失败；显示期间再点不算；reset / dispose 清定时器。
 * 2. 文案：13 种语言（中文是键，另外 12 种都有译文），AC06 和 M01 的表都有。
 * 3. 源码：App.vue、m01/M01App.vue 里每个保存按钮都接了状态机；保存结果不再写到提示变量里。
 * 4. 把真的页面在 node 里跑起来（helpers/mount-shell.mjs），点保存看按钮上的字。 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAVE_BUSY_MS, SAVE_IDLE, SAVE_REASON_MAX, SAVE_SHOW_MS, SAVE_SILENT, SAVE_TEXT,
  createSaveBtn, createSaveBtns, saveClass, saveDetail, saveLabel, saveLocked, shortReason,
} from "../src/save-btn.js";
import { SAVE_KEYS, saveBtnPacks } from "../src/packs-savebtn.js";
import { languages, translate } from "../src/i18n.js";
import { hasKey, languages as m01Languages } from "../src/m01/i18n.js";
import { m01Translate } from "../src/m01/t.js";
import { mountShell, textOf } from "./helpers/mount-shell.mjs";
import { createPile } from "./helpers/m01-fw-versions.mjs";
import { APP_VERSION } from "../src/m01/fw-compat.js";
import { typeFromStatus } from "../src/devtype.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(here, "..", name), "utf8");
const AC06_VUE = read("src/App.vue");
const M01_VUE = read("src/m01/M01App.vue");

/* ------------------------------------------------------------------ 1. 状态机 */

/* 假的定时器：tick(ms) 往前走，到点的按先后调。 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const list = new Map();
  return {
    setTimer(fn, ms) { const id = ++seq; list.set(id, { at: now + ms, fn }); return id; },
    clearTimer(id) { list.delete(id); },
    pending: () => list.size,
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, item] of list) if (item.at <= end && (!next || item.at < next.item.at)) next = { id, item };
        if (!next) break;
        list.delete(next.id);
        now = next.item.at;
        next.item.fn();
      }
      now = end;
    },
  };
}
function make(extra) {
  const clock = fakeClock();
  const seen = [];
  const done = [];
  const btn = createSaveBtn(Object.assign({
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onChange: (state) => seen.push(state.kind), onDone: (kind) => done.push(kind),
  }, extra || {}));
  return { clock, seen, done, btn };
}
const zh = (text, vars) => (vars ? text.replace("{why}", vars.why) : text);

test("常量：结果显示 2.5 秒，保存中最多等 6 秒", () => {
  assert.equal(SAVE_SHOW_MS, 2500);
  assert.equal(SAVE_BUSY_MS, 6000);
  assert.deepEqual(SAVE_TEXT, {
    idle: "保存", busy: "保存中…", ok: "保存成功", restart: "保存成功，重启生效", fail: "保存失败", failWhy: "保存失败：{why}",
  });
  assert.equal(SAVE_IDLE.kind, "idle");
  assert.ok(Object.isFrozen(SAVE_IDLE));
});

test("保存成功：idle → busy → ok，2.5 秒后自己回到 idle", () => {
  const { clock, seen, done, btn } = make();
  assert.equal(btn.state.kind, "idle");
  assert.equal(btn.locked, false);
  assert.equal(btn.begin(), true);
  assert.equal(btn.state.kind, "busy");
  assert.equal(saveLabel(btn.state, "保存", zh), "保存中…");
  assert.equal(btn.locked, true);
  assert.equal(btn.ok(), true);
  assert.equal(saveLabel(btn.state, "保存", zh), "保存成功");
  assert.equal(saveClass(btn.state), "save-ok");
  assert.equal(btn.locked, true, "显示结果期间按钮不可点");
  clock.tick(SAVE_SHOW_MS - 1);
  assert.equal(btn.state.kind, "ok");
  clock.tick(1);
  assert.equal(btn.state.kind, "idle");
  assert.equal(saveLabel(btn.state, "保存", zh), "保存");
  assert.equal(saveClass(btn.state), "");
  assert.equal(btn.locked, false);
  assert.deepEqual(seen, ["busy", "ok", "idle"]);
  assert.deepEqual(done, ["ok"]);
  assert.equal(clock.pending(), 0, "看门狗和显示的定时器都清掉了");
});

test("重启生效：按钮上是「保存成功，重启生效」，下面那一行说明留到下一次点保存", () => {
  const { clock, btn } = make();
  btn.begin();
  assert.equal(btn.restart("拨到 OFF 后重新上电才按这个设置"), true);
  assert.equal(saveLabel(btn.state, "保存", zh), "保存成功，重启生效");
  assert.equal(saveClass(btn.state), "save-restart");
  assert.deepEqual(btn.state.detail, { text: "拨到 OFF 后重新上电才按这个设置", vars: null });
  assert.equal(btn.state.tone, "info");
  clock.tick(SAVE_SHOW_MS);
  assert.equal(btn.state.kind, "idle");
  assert.deepEqual(btn.state.detail, { text: "拨到 OFF 后重新上电才按这个设置", vars: null }, "按钮变回去以后说明还在");
  btn.begin();
  assert.equal(btn.state.detail, null, "再点保存，上一次的说明清掉");
});

test("保存失败：带短原因；长原因放说明里，按钮变回去以后还在", () => {
  const { clock, done, btn } = make();
  btn.begin();
  assert.equal(btn.fail("电压范围不对", "没有保存。过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V"), true);
  assert.equal(saveLabel(btn.state, "保存", zh), "保存失败：电压范围不对");
  assert.equal(saveLabel(btn.state, "UTC+08:00", zh, true), "保存失败", "窄按钮不带原因");
  assert.equal(saveClass(btn.state), "save-fail");
  assert.equal(btn.state.tone, "bad");
  clock.tick(SAVE_SHOW_MS);
  assert.equal(btn.state.kind, "idle");
  assert.equal(btn.state.detail.text, "没有保存。过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V");
  assert.equal(btn.state.tone, "bad");
  assert.deepEqual(done, ["fail"]);
  /* 没有原因：只写「保存失败」。 */
  btn.begin();
  btn.fail();
  assert.equal(saveLabel(btn.state, "保存", zh), "保存失败");
  assert.equal(btn.state.detail, null);
});

test("说明可以带占位符（{ text, vars }）", () => {
  const { btn } = make();
  btn.begin();
  btn.fail("功率上限不对", { text: "没有保存。功率上限只能是 {min} 到 {max} W", vars: { min: 50, max: 2000 } });
  assert.deepEqual(btn.state.detail, { text: "没有保存。功率上限只能是 {min} 到 {max} W", vars: { min: 50, max: 2000 } });
  assert.equal(saveDetail(""), null);
  assert.equal(saveDetail(null), null);
  assert.equal(saveDetail({}), null);
});

test("充电桩一直不应答：看门狗到点按「保存失败：充电桩没有应答」，再过 2.5 秒回到保存", () => {
  const { clock, seen, btn } = make();
  btn.begin();
  clock.tick(SAVE_BUSY_MS - 1);
  assert.equal(btn.state.kind, "busy");
  clock.tick(1);
  assert.equal(btn.state.kind, "fail");
  assert.equal(btn.state.why, SAVE_SILENT);
  assert.equal(saveLabel(btn.state, "保存", zh), "保存失败：充电桩没有应答");
  clock.tick(SAVE_SHOW_MS);
  assert.equal(btn.state.kind, "idle");
  assert.deepEqual(seen, ["busy", "fail", "idle"]);
  /* 晚到的应答不算：已经不在保存中了。 */
  assert.equal(btn.ok(), false);
  assert.equal(btn.state.kind, "idle");
});

test("看门狗的时间可以每次给；给 0 就不要看门狗；silent() 和看门狗是同一个结果", () => {
  const a = make();
  a.btn.begin(20000);
  a.clock.tick(19999);
  assert.equal(a.btn.state.kind, "busy");
  a.clock.tick(1);
  assert.equal(a.btn.state.kind, "fail");
  const b = make();
  b.btn.begin(0);
  assert.equal(b.clock.pending(), 0);
  b.clock.tick(3600000);
  assert.equal(b.btn.state.kind, "busy");
  assert.equal(b.btn.silent(), true);
  assert.equal(b.btn.state.why, SAVE_SILENT);
  const c = make({ busyMs: 1000, showMs: 500 });
  c.btn.begin();
  c.clock.tick(1000);
  assert.equal(c.btn.state.kind, "fail");
  c.clock.tick(500);
  assert.equal(c.btn.state.kind, "idle");
});

test("重复点击被挡：保存中、显示结果期间 begin() 都返回 false，状态不变", () => {
  const { clock, seen, btn } = make();
  assert.equal(btn.begin(), true);
  assert.equal(btn.begin(), false);
  assert.equal(btn.state.kind, "busy");
  btn.ok();
  assert.equal(btn.begin(), false);
  assert.equal(btn.state.kind, "ok");
  /* 结果只认第一个。 */
  assert.equal(btn.fail("x"), false);
  assert.equal(btn.state.kind, "ok");
  clock.tick(SAVE_SHOW_MS);
  assert.equal(btn.begin(), true);
  assert.deepEqual(seen, ["busy", "ok", "idle", "busy"]);
  /* 没点保存就来的应答（比如一键配置下发时的 ACK）：不算。 */
  const other = make();
  assert.equal(other.btn.ok(), false);
  assert.equal(other.btn.fail("x"), false);
  assert.deepEqual(other.seen, []);
});

test("切页 reset：回到保存，定时器清掉，说明清掉，不调 onDone", () => {
  const { clock, done, btn } = make();
  btn.begin();
  btn.fail("时长不对", "没有保存。时长只能是 10 到 600 秒");
  btn.reset();
  assert.equal(btn.state, SAVE_IDLE);
  assert.equal(clock.pending(), 0);
  clock.tick(10000);
  assert.deepEqual(done, []);
  /* 保存中 reset：看门狗也清掉。 */
  btn.begin();
  assert.equal(clock.pending(), 1);
  btn.reset();
  assert.equal(clock.pending(), 0);
  assert.equal(btn.state.kind, "idle");
  assert.equal(btn.begin(), true, "reset 之后还能用");
});

test("组件卸载 dispose：定时器清掉，之后什么都不做、不再通知", () => {
  const { clock, seen, done, btn } = make();
  btn.begin();
  btn.ok();
  const before = seen.length;
  btn.dispose();
  assert.equal(clock.pending(), 0);
  clock.tick(10000);
  assert.equal(btn.begin(), false);
  assert.equal(btn.ok(), false);
  assert.equal(seen.length, before);
  assert.deepEqual(done, []);
});

test("一页上的全部按钮：按名字各管各的；resetAll / dispose 管全部", () => {
  const clock = fakeClock();
  const seen = [];
  const done = [];
  const btns = createSaveBtns({
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onChange: (id, state) => seen.push(id + ":" + state.kind), onDone: (id, kind) => done.push(id + ":" + kind),
  });
  assert.equal(btns.state("cfg"), SAVE_IDLE);
  assert.equal(btns.locked("cfg"), false);
  assert.equal(btns.ok("cfg"), false, "没在保存中的不算");
  assert.equal(btns.begin("cfg"), true);
  assert.equal(btns.begin("qr"), true);
  assert.equal(btns.begin("cfg"), false);
  btns.ok("cfg");
  btns.fail("qr", "内容不对");
  assert.equal(btns.state("cfg").kind, "ok");
  assert.equal(btns.state("qr").kind, "fail");
  assert.equal(btns.locked("qr"), true);
  clock.tick(SAVE_SHOW_MS);
  assert.deepEqual(done, ["cfg:ok", "qr:fail"]);
  assert.deepEqual(btns.ids().sort(), ["cfg", "qr"]);
  btns.begin("cfg");
  btns.begin("qr", 20000);
  btns.resetAll();
  assert.equal(clock.pending(), 0);
  assert.equal(btns.state("cfg").kind, "idle");
  btns.begin("cfg");
  btns.dispose();
  assert.equal(clock.pending(), 0);
  assert.equal(btns.begin("cfg"), false);
  assert.equal(btns.begin("new"), false, "卸载以后新名字的也不动");
  assert.ok(seen.includes("cfg:busy") && seen.includes("qr:fail"));
});

test("默认用全局定时器（不注入也能跑）", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const btn = createSaveBtn();
    btn.begin();
    btn.ok();
    mock.timers.tick(SAVE_SHOW_MS);
    assert.equal(btn.state.kind, "idle");
    btn.begin();
    mock.timers.tick(SAVE_BUSY_MS);
    assert.equal(btn.state.why, SAVE_SILENT);
    btn.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("短原因：去掉句末标点，太长截断加 …；按钮上的字用翻译以后的原因", () => {
  assert.equal(shortReason("  电压范围不对。 "), "电压范围不对");
  assert.equal(shortReason(""), "");
  assert.equal(shortReason(null), "");
  const long = "过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V，再长一点再长一点";
  const cut = shortReason(long);
  assert.equal(Array.from(cut).length, SAVE_REASON_MAX);
  assert.ok(cut.endsWith("…"));
  assert.equal(shortReason("abcdef", 4), "abc…");
  const state = { kind: "fail", why: "电压范围不对", detail: null, tone: "bad" };
  const en = (text, vars) => translate("en", text, vars);
  assert.equal(saveLabel(state, "Save", en), "Save failed: Voltage out of range");
  assert.equal(saveLabel({ kind: "fail", why: long, detail: null }, "保存", zh), "保存失败：" + cut);
  assert.equal(saveLabel(SAVE_IDLE, "UTC+08:00", en), "UTC+08:00", "平时的字原样");
  assert.equal(saveLabel(null, "保存"), "保存");
  assert.equal(saveLocked(null), false);
  assert.equal(saveClass({ kind: "busy" }), "save-busy");
});

/* ------------------------------------------------------------------ 2. 文案 */

test("m01/ 下的 save-btn.js、packs-savebtn.js 和根下的是同一份", () => {
  assert.equal(read("src/m01/save-btn.js"), read("src/save-btn.js"));
  assert.equal(read("src/m01/packs-savebtn.js"), read("src/packs-savebtn.js"));
});

test("13 种语言：中文是键，另外 12 种每一句都有译文（AC06 和 M01 的表都有）", () => {
  const ids = languages.map((item) => item.id);
  assert.equal(ids.length, 13);
  assert.deepEqual(m01Languages.map((item) => item.id), ids);
  const others = ids.filter((id) => id !== "zh");
  assert.deepEqual(Object.keys(saveBtnPacks).sort(), others.slice().sort());
  for (const key of Object.values(SAVE_TEXT).concat([SAVE_SILENT])) {
    if (key !== SAVE_TEXT.idle) assert.ok(SAVE_KEYS.includes(key), "packs-savebtn.js 里没有: " + key);
  }
  assert.equal(new Set(SAVE_KEYS).size, SAVE_KEYS.length);
  for (const lang of others) {
    const seen = new Set();
    for (const key of SAVE_KEYS) {
      const own = saveBtnPacks[lang][key];
      assert.ok(own && own !== key && !/[\u4e00-\u9fff]/.test(lang === "ja" ? "" : own), lang + " 没翻: " + key);
      if (key.includes("{why}")) assert.ok(own.includes("{why}"), lang + " 丢了占位符: " + key);
      else assert.ok(!own.includes("{"), lang + " 多了占位符: " + key);
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 的 AC06 表里没有: " + key);
      assert.ok(hasKey(lang, key), lang + " 的 M01 表里没有: " + key);
      assert.ok(m01Translate(lang, key) !== key, lang + " M01 页面上没翻: " + key);
      seen.add(out);
    }
    /* 四种结果的字各不相同。 */
    const four = ["保存中…", "保存成功", "保存失败", "保存成功，重启生效"].map((key) => translate(lang, key));
    assert.equal(new Set(four).size, 4, lang);
    /* 「保存」两个字日文和中文同形。 */
    assert.ok(translate(lang, "保存") !== "保存" || lang === "ja", lang);
  }
  assert.equal(translate("zh", "保存成功，重启生效"), "保存成功，重启生效");
  assert.equal(translate("en", "保存失败：{why}", { why: "X" }), "Save failed: X");
});

/* 脚本里交给按钮的每一句（短原因、说明、对照表里的短原因）。 */
function saveStrings(vue) {
  const script = vue.slice(vue.indexOf("<script"));
  const out = new Set();
  for (const m of script.matchAll(/saveBtns\.(?:ok|restart|fail|silent)\((?:"[A-Za-z]+"|id)((?:, "[^"]*")*)/g)) {
    for (const one of m[1].matchAll(/"([^"]+)"/g)) out.add(one[1]);
  }
  for (const m of script.matchAll(/_WHY = \{([\s\S]*?)\};/g)) {
    for (const one of m[1].matchAll(/: "([^"]+)"/g)) out.add(one[1]);
  }
  for (const m of script.matchAll(/text: port\s*\? "([^"]+)"\s*: "([^"]+)"/g)) { out.add(m[1]); out.add(m[2]); }
  return out;
}

test("App.vue、M01App.vue 里交给按钮的短原因和说明，12 种语言都有译文", () => {
  const ac06 = saveStrings(AC06_VUE);
  const m01 = saveStrings(M01_VUE);
  assert.ok(ac06.size >= 30, String(ac06.size));
  assert.ok(m01.size >= 15, String(m01.size));
  for (const key of ["时长不对", "电压范围不对", "还没有时间", "充电桩不接受", "连接超时"]) assert.ok(ac06.has(key), key);
  for (const key of ["功率上限不对", "数值超出范围", "固件太旧", "还有端口没停", "没有切换成功"]) assert.ok(m01.has(key), key);
  for (const item of languages) {
    if (item.id === "zh") continue;
    for (const key of ac06) {
      const out = translate(item.id, key);
      assert.ok(out && out !== key, item.id + " 没翻（AC06）: " + key);
    }
    for (const key of m01) {
      const out = m01Translate(item.id, key);
      assert.ok(out && out !== key, item.id + " 没翻（M01）: " + key);
    }
  }
  /* 按钮上的短原因都短（中文不超过 8 个字），长的放说明里。 */
  for (const vue of [AC06_VUE, M01_VUE]) {
    for (const m of vue.matchAll(/saveBtns\.fail\((?:"[A-Za-z]+"|id), "([^"]+)"/g)) {
      assert.ok(Array.from(m[1]).length <= 8, "按钮上的原因太长: " + m[1]);
    }
  }
});

/* ------------------------------------------------------------------ 3. 源码 */

/* 每个保存按钮：[名字, @click 的函数]。 */
const AC06_BUTTONS = [
  ["netstop", "saveNetStop"], ["sched", "saveSched"], ["imax", "saveImax"], ["card", "saveCard"], ["ocpp", "saveOcpp"],
  ["cfg", "saveCfg"], ["qr", "saveQr"], ["ocfw", "saveOcfw"], ["apn", "saveApn"], ["wifi", "joinWifi"],
];
const AC06_PICKS = [["tz", "pickZone"], ["scrlang", "pickScrLang"], ["scrtheme", "pickScrTheme"], ["phase", "pickPhase"]];
const M01_BUTTONS = [
  ["plimOne", "savePlimOne"], ["plimList", "savePlimList"], ["plimAll", "savePlimAll"], ["pay", "savePay"], ["par", "savePar"],
  ["netstop", "saveNetStop"], ["ocpp", "saveOcpp"], ["cfg", "saveCfg"], ["ocfw", "saveOcfw"], ["apn", "saveApn"],
  ["wifi", "joinWifi"],
];
const M01_PICKS = [["tz", "pickZone"]];

function templateOf(vue) {
  return vue.slice(0, vue.indexOf("<script"));
}
function scriptOf(vue) {
  return vue.slice(vue.indexOf("<script"), vue.indexOf("<style"));
}
/* 模板里 @click 是这个函数的那个 <button …>…</button>。 */
function buttonFor(template, handler) {
  const all = [...template.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0])
    .filter((text) => new RegExp("@click=\"" + handler + "(?:\\([^\"]*\\))?\"").test(text));
  assert.equal(all.length, 1, handler + " 的按钮要有且只有一个");
  return all[0];
}
/* 脚本里这个函数的函数体（到下一个顶格的 } 为止）。 */
function bodyOf(script, name) {
  const m = script.match(new RegExp("\\n(?:async )?function " + name + "\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}\\n"));
  assert.ok(m, "找不到函数 " + name);
  return m[0];
}

for (const [label, vue, buttons, picks] of [
  ["App.vue", AC06_VUE, AC06_BUTTONS, AC06_PICKS], ["M01App.vue", M01_VUE, M01_BUTTONS, M01_PICKS],
]) {
  test(label + "：每个保存按钮都接了状态机（字、样式、不可点、按钮下面的说明）", () => {
    const template = templateOf(vue);
    const script = scriptOf(vue);
    for (const [id, handler] of buttons) {
      const button = buttonFor(template, handler);
      assert.match(button, /class="(?:go|ghost) save"/, handler);
      assert.ok(button.includes(":class=\"saveCls('" + id + "')\""), handler + " 没有接样式");
      assert.match(button, new RegExp(":disabled=\"[^\"]*saveOff\\('" + id + "'\\)\""), handler + " 显示期间要不可点");
      assert.match(button, new RegExp("\\{\\{ saveLbl\\('" + id + "'(?:, t\\('[^']+'\\))?\\) \\}\\}"), handler + " 的字要走状态机");
      /* 紧跟在按钮后面的就是那一行说明。 */
      const after = template.slice(template.indexOf(button) + button.length);
      assert.match(after, new RegExp("^\\s*<p v-if=\"saveWhy\\('" + id + "'\\)\" class=\"save-why\" :class=\"saveTone\\('" + id + "'\\)\">\\{\\{ saveWhy\\('" + id + "'\\) \\}\\}</p>"),
        handler + " 的说明要紧挨着按钮");
    }
    /* 点一格就保存的页（时区等）：点的那一格就是按钮。 */
    for (const [id, handler] of picks) {
      const button = buttonFor(template, handler);
      assert.ok(button.includes("saveCls('" + id + "')"), handler);
      assert.match(button, new RegExp(":disabled=\"[^\"]*saveOff\\('" + id + "'\\)\""), handler);
      assert.ok(button.includes("saveLbl('" + id + "', "), handler);
      assert.ok(template.includes("<p v-if=\"saveWhy('" + id + "')\" class=\"save-why\""), handler + " 没有说明那一行");
      const body = bodyOf(script, handler);
      assert.ok(body.includes("saveBtns.begin(\"" + id + "\", 20000)"), handler);
      assert.ok(body.includes("saveBtns.ok(\"" + id + "\")") && body.includes("saveBtns.silent(\"" + id + "\")"), handler);
    }
    /* 模板里不再有直接写「保存」两个字的按钮。 */
    assert.ok(!/<button[^>]*>\{\{ t\('保存'\) \}\}<\/button>/.test(template), "还有没接状态机的保存按钮");
    assert.ok(!/<button[^>]*>\{\{ t\('连接并保存'\) \}\}<\/button>/.test(template));
    /* 每个名字：有 begin，有成功，有失败；begin 挡住重复点击。 */
    for (const [id] of buttons.concat(picks)) {
      assert.match(script, new RegExp("if \\([^\\n]*!saveBtns\\.begin\\(\"" + id + "\"[^\\n]*\\) return;"), id + " 没有 begin");
      assert.match(script, new RegExp("saveBtns\\.ok\\(\"" + id + "\"|saveFromOut\\(\"" + id + "\"|plimShown\\(\"" + id + "\""), id + " 没有成功");
      assert.match(script, new RegExp("saveBtns\\.(?:fail|silent)\\(\"" + id + "\"|saveFromOut\\(\"" + id + "\"|plimShown\\(\"" + id + "\"|plimBad\\(\"" + id + "\""), id + " 没有失败");
    }
    /* 换页回到「保存」；组件卸掉时清定时器。 */
    assert.match(script, /watch\(page, \(\) => saveBtns\.resetAll\(\)\);/);
    assert.match(script, /saveBtns\.dispose\(\)/);
    assert.match(script, /import \{[^}]*createSaveBtns[^}]*\} from "\.\/save-btn\.js";/);
  });

  test(label + "：保存的结果不再写到页面的提示里", () => {
    const script = scriptOf(vue);
    /* 这些提示变量原来写保存结果，现在只留读取中、页面说明。开关（4G、WiFi、OCPP、遥测、6 秒停充）
     * 不是保存按钮，它们的提示不在这里。 */
    const notes = ["netStopNote", "schedNote", "imaxNote", "cardNote", "qrNote", "ocfwNote", "cfgNote", "payNote", "plimNote",
      "parNote", "scrLangNote", "scrThemeNote", "phaseNote"];
    for (const name of notes) {
      const bad = [...script.matchAll(new RegExp(name + "\\.value = [^;\\n]*\"(已保存|已记住|没有保存|正在保存|充电桩没有应答，没有保存|充电桩没有接受|数值不在这台桩允许的范围内|没有改动)[^\"]*\"", "g"))];
      assert.deepEqual(bad.map((m) => m[0]), [], name + " 里还有保存结果");
    }
    /* OCPP 地址：结果走按钮；ocppNote 里只剩开关的提示。 */
    assert.ok(!/ocppNote\.value = [^;\n]*"(已保存，正在重新连接|没有保存|正在保存)"/.test(script));
    /* 这两个提示变量整个去掉了。 */
    assert.ok(!/\btzNote\b/.test(vue), "tzNote 还在");
    assert.ok(!/\blteApnNote\b/.test(vue), "lteApnNote 还在");
    /* 保存函数里不再往提示变量写字。 */
    const savers = label === "App.vue"
      ? ["saveNetStop", "saveSched", "saveImax", "saveCard", "saveOcpp", "saveCfg", "saveQr", "saveOcfw", "saveApn", "pickZone", "pickPhase"]
      : ["savePlimList", "savePlimAll", "savePay", "saveNetStop", "saveOcpp", "saveCfg", "saveOcfw", "saveApn", "pickZone"];
    for (const name of savers) {
      const body = bodyOf(script, name);
      const wrote = [...body.matchAll(/\b[A-Za-z]+Note\.value = "([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(wrote, [], name + " 还在往提示里写: " + wrote.join(" / "));
    }
  });
}

test("重启生效：只有两处——AC06 保护设置被拨码压着（重新上电才按这个设置）、M01 切换并充后桩重启", () => {
  const ac06 = [...scriptOf(AC06_VUE).matchAll(/saveBtns\.restart\("([a-zA-Z]+)"/g)].map((m) => m[1]);
  const m01 = [...scriptOf(M01_VUE).matchAll(/saveBtns\.restart\("([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ac06, ["cfg"]);
  assert.deepEqual(m01, ["par"]);
  assert.match(scriptOf(AC06_VUE), /indexOf\("SW"\) >= 0\) \{\n    maskDip\.value = true;\n[^\n]*\n    saveBtns\.restart\("cfg", "已记住。印刷拨码1 仍强制屏蔽接地和漏电，拨到 OFF 后重新上电才按这个设置"\);/);
  assert.match(scriptOf(M01_VUE), /if \(out\.restart\) saveBtns\.restart\("par", detail\);\n    else saveBtns\.ok\("par", detail\);/);
  /* 自己重连、自己重启模块的（OCPP 地址、APN）是「保存成功」，下面一行说明。 */
  for (const vue of [AC06_VUE, M01_VUE]) {
    assert.ok(scriptOf(vue).includes("saveBtns.ok(\"apn\", \"已保存。4G 模块会重新启动，用新的设置联网\")"));
    assert.ok(scriptOf(vue).includes("saveBtns.ok(\"ocpp\", \"已保存，正在重新连接\")"));
  }
});

test("样式：成功绿、失败红，一行不换行，显示期间不跟着 disabled 变淡", () => {
  const css = AC06_VUE.slice(AC06_VUE.indexOf("<style"));
  assert.match(css, /\.save\.save-busy, \.save\.save-ok, \.save\.save-restart, \.save\.save-fail \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.save\.save-ok, \.save\.save-restart, \.save\.save-ok:disabled, \.save\.save-restart:disabled \{ background: #3ecf6b;[^}]*opacity: 1; \}/);
  assert.match(css, /\.save\.save-fail, \.save\.save-fail:disabled \{ background: #ff5a4d;[^}]*opacity: 1; \}/);
  assert.match(css, /\.save\.save-busy:disabled \{ opacity: 0\.6; \}/);
  assert.match(css, /\.save-why \{[^}]*font-size: 13px;[^}]*\}/);
  assert.match(css, /\.save-why\.bad \{ color: #ff6b5e; opacity: 1; \}/);
  /* 这几条在全局样式的最后，盖得住 .zone.on / .go 的底色。 */
  assert.ok(css.indexOf(".save.save-ok") > css.indexOf(".zone.on {"));
  assert.ok(css.indexOf(".save.save-ok") > css.lastIndexOf(".go {"));
  /* 颜色就是 M01 页面上已经在用的绿、红。 */
  assert.ok(M01_VUE.includes("#3ecf6b") && M01_VUE.includes("#ff5a4d"));
});

/* ------------------------------------------------------------------ 4. 页面 */

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}
async function run(ms) {
  for (let t = 0; t < ms; t += 50) {
    mock.timers.tick(50);
    await flush();
  }
}
const AC = "AA:00:00:00:02:01";
const M1 = "AA:00:00:00:02:02";

/* 一台 AC06：认密码，回断网停充、二维码、保护设置。answer(command) 可以改写应答（返回数组）。 */
function ac06Pile(answer) {
  const log = [];
  return {
    log,
    reply(command) {
      log.push(command);
      const custom = answer ? answer(command) : null;
      if (custom) return custom;
      const part = command.split("\t");
      if (part[0] === "STATUS") return ["STAT A NONE 00:00:00 0 0 0 0 0 0 0 0 V3.0.3"];
      if (part[0] === "AUTH") return [part[1] === "123456" ? "ACK AUTH OK" : "ACK AUTH FAIL"];
      if (part[0] === "NETSTOPGET") return ["NETSTOP 0 60"];
      if (part[0] === "NETSTOPSET") return ["ACK NETSTOPSET OK"];
      if (part[0] === "CFGGET") return ["CFG 253 207 10.50 7.50 4.50 -10.00 0 0 0 150"];
      if (part[0] === "CFGSET") return ["ACK CFGSET OK"];
      return [];
    },
  };
}
async function mountWith(kind, name, addr, pile) {
  let app = null;
  let linked = false;
  const deliver = (lines) => {
    lines.forEach((line, i) => setTimeout(() => {
      if (!linked) return;
      const type = typeFromStatus(line);
      if (type && !pile.kindSent) {
        pile.kindSent = true;
        app.vm.handle({ t: "kind", s: type });
      }
      app.vm.handle({ t: "line", s: line });
    }, 40 + 30 * i));
  };
  app = await mountShell({
    pins: { [addr]: "123456" },
    onSend: (command) => { if (linked) deliver(pile.reply(command)); },
    onConnect: () => setTimeout(() => {
      linked = true;
      app.vm.handle({ t: "page", s: "charge" });
      deliver(pile.reply("STATUS"));
    }, 100),
    onDisconnect: () => { linked = false; },
  });
  app.vm.handle({ t: "devs", list: [{ name, addr, rssi: -50 }] });
  await flush();
  app.click(name);
  await run(kind === "m01" ? 8000 : 3000);
  return app;
}
async function openSettings(app, ms) {
  app.click((n) => n.props.class === "tab" && textOf(n).includes("设置"));
  await run(ms);
}
async function typeInto(input, value) {
  input.value = value;
  (input.listeners.input || []).forEach((fn) => fn({ target: input }));
  await flush();
}
const classText = (node) => JSON.stringify(node.props.class || "");
/* 页面上那个保存按钮（class 里有 save 的 go 按钮）。 */
function saveButton(app) {
  const hit = app.buttons((n) => /"go save"|go save/.test(classText(n)));
  assert.equal(hit.length, 1, "这一页的保存按钮: " + hit.length);
  return hit[0];
}
const sentHead = (app, head) => app.sent.filter((c) => c === head || c.indexOf(head + "\t") === 0);

test("AC06 断网停充：点保存 → 保存中…（不可点）→ 保存成功 → 2.5 秒后变回保存；页面上面没有「已保存」", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });
  try {
    const app = await mountWith("ac06", "EVC_SAVE01", AC, ac06Pile());
    await openSettings(app, 3000);
    app.click("断网停充");
    await run(1000);
    let button = saveButton(app);
    assert.equal(textOf(button), "保存");
    assert.ok(!button.props.disabled);
    button.props.onClick({});
    await flush();
    button = saveButton(app);
    assert.equal(textOf(button), "保存中…");
    assert.equal(button.props.disabled, true);
    assert.ok(classText(button).includes("save-busy"));
    /* 保存中再点：不再发第二条。 */
    button.props.onClick({});
    await flush();
    assert.equal(sentHead(app, "NETSTOPSET").length, 1);
    await run(200);
    button = saveButton(app);
    assert.equal(textOf(button), "保存成功");
    assert.equal(button.props.disabled, true);
    assert.ok(classText(button).includes("save-ok"));
    assert.ok(!app.text().includes("已保存，断电后仍然有效"), "结果不再写到提示里");
    assert.ok(!app.text().includes("正在保存"));
    assert.equal(app.byClass("save-why").length, 0);
    await run(2000);
    assert.equal(textOf(saveButton(app)), "保存成功", "2.2 秒时还在");
    await run(600);
    button = saveButton(app);
    assert.equal(textOf(button), "保存");
    assert.ok(!button.props.disabled);
    assert.ok(!classText(button).includes("save-ok"));
    app.close();
  } finally {
    mock.timers.reset();
  }
});

test("AC06 断网停充：填错 → 保存失败：时长不对，完整原因在按钮下面，按钮变回去以后还在；再点保存清掉", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });
  try {
    const app = await mountWith("ac06", "EVC_SAVE02", AC, ac06Pile());
    await openSettings(app, 3000);
    app.click("断网停充");
    await run(1000);
    const field = app.inputs().find((n) => n.props.maxlength === "3" || n.props.maxlength === 3);
    await typeInto(field, "5");
    saveButton(app).props.onClick({});
    await flush();
    let button = saveButton(app);
    assert.equal(textOf(button), "保存失败：时长不对");
    assert.ok(classText(button).includes("save-fail"));
    assert.equal(button.props.disabled, true);
    assert.equal(sentHead(app, "NETSTOPSET").length, 0, "没填对不发命令");
    let why = app.byClass("save-why");
    assert.equal(why.length, 1);
    assert.equal(textOf(why[0]), "没有保存。时长只能是 10 到 600 秒");
    assert.ok(classText(why[0]).includes("bad"));
    await run(2600);
    assert.equal(textOf(saveButton(app)), "保存");
    assert.equal(app.byClass("save-why").length, 1, "按钮变回去以后原因还在");
    /* 改对了再保存：原因清掉，成功。 */
    await typeInto(field, "90");
    saveButton(app).props.onClick({});
    await run(200);
    assert.equal(textOf(saveButton(app)), "保存成功");
    assert.equal(app.byClass("save-why").length, 0);
    assert.deepEqual(sentHead(app, "NETSTOPSET"), ["NETSTOPSET\t0\t90"]);
    /* 换页再回来：按钮是「保存」。 */
    app.click("返回");
    await run(300);
    app.click("断网停充");
    await run(300);
    assert.equal(textOf(saveButton(app)), "保存");
    app.close();
  } finally {
    mock.timers.reset();
  }
});

test("AC06 充电桩不应答：6 秒后「保存失败：充电桩没有应答」，不会一直停在保存中", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });
  try {
    const app = await mountWith("ac06", "EVC_SAVE03", AC, ac06Pile((c) => (c.indexOf("NETSTOPSET") === 0 ? [] : null)));
    await openSettings(app, 3000);
    app.click("断网停充");
    await run(1000);
    saveButton(app).props.onClick({});
    await run(5500);
    assert.equal(textOf(saveButton(app)), "保存中…");
    await run(600);
    const button = saveButton(app);
    assert.equal(textOf(button), "保存失败：充电桩没有应答");
    assert.ok(classText(button).includes("save-fail"));
    await run(2600);
    assert.equal(textOf(saveButton(app)), "保存");
    assert.ok(!saveButton(app).props.disabled);
    app.close();
  } finally {
    mock.timers.reset();
  }
});

test("AC06 保护设置：拨码压着 → 保存成功，重启生效；桩说电压不对 → 保存失败：电压范围不对", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });
  try {
    let answer = "ACK CFGSET SW";
    const app = await mountWith("ac06", "EVC_SAVE04", AC, ac06Pile((c) => (c.indexOf("CFGSET") === 0 ? [answer] : null)));
    await openSettings(app, 3000);
    app.click("保护设置");
    await run(1000);
    assert.ok(app.text().includes("这是充电桩里的保护设置，改完点保存"), "页面的说明照旧");
    saveButton(app).props.onClick({});
    await run(200);
    let button = saveButton(app);
    assert.equal(textOf(button), "保存成功，重启生效");
    assert.ok(classText(button).includes("save-restart"));
    let why = app.byClass("save-why");
    assert.equal(textOf(why[0]), "已记住。印刷拨码1 仍强制屏蔽接地和漏电，拨到 OFF 后重新上电才按这个设置");
    assert.ok(!classText(why[0]).includes("bad"));
    await run(2600);
    assert.equal(textOf(saveButton(app)), "保存");
    answer = "ACK CFGSET FAIL";
    saveButton(app).props.onClick({});
    await run(200);
    button = saveButton(app);
    assert.equal(textOf(button), "保存失败：电压范围不对");
    why = app.byClass("save-why");
    assert.equal(textOf(why[0]), "没有保存。过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V");
    assert.ok(classText(why[0]).includes("bad"));
    assert.ok(app.text().includes("这是充电桩里的保护设置，改完点保存"), "页面的说明没有被结果盖掉");
    app.close();
  } finally {
    mock.timers.reset();
  }
});

test("M01 充电规则：保存成功写在按钮上，2.5 秒后变回保存；数值不对 → 保存失败：数值超出范围", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });
  try {
    const app = await mountWith("m01", "EVCMSAVE01", M1, createPile(APP_VERSION, { caps: "FF" }));
    assert.ok(app.text().includes("10 路充电桩"), app.text().slice(0, 200));
    await openSettings(app, 20000);
    app.click("充电规则");
    await run(4000);
    let button = saveButton(app);
    assert.equal(textOf(button), "保存");
    button.props.onClick({});
    await flush();
    assert.equal(textOf(saveButton(app)), "保存中…");
    assert.equal(saveButton(app).props.disabled, true);
    await run(1500);
    button = saveButton(app);
    assert.equal(textOf(button), "保存成功");
    assert.ok(classText(button).includes("save-ok"));
    assert.ok(!app.text().includes("已保存，断电后仍然有效"));
    assert.equal(sentHead(app, "PAYSET").length, 1);
    await run(2600);
    assert.equal(textOf(saveButton(app)), "保存");
    /* 门槛填 0：不发命令，按钮上写原因。 */
    const watts = app.inputs().find((n) => n.props.maxlength === "3" || n.props.maxlength === 3);
    await typeInto(watts, "0");
    saveButton(app).props.onClick({});
    await flush();
    assert.equal(textOf(saveButton(app)), "保存失败：数值超出范围");
    assert.equal(textOf(app.byClass("save-why")[0]), "数值不在这台桩允许的范围内");
    assert.equal(sentHead(app, "PAYSET").length, 1);
    app.close();
  } finally {
    mock.timers.reset();
  }
});
