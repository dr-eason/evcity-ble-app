/* 修改密码 / 超级密码、自己画的数字键盘（系统键盘不弹出）。
 *   node --test APP/ui/test/pin-change.test.mjs
 *
 * 一、纯逻辑：超级密码默认值的推导（和固件单测 AC06/tests/host/test_ble_super.c 里的例子对拍）、
 *     PINSET / SUPERGET / SUPERSET 应答、键盘状态机、输两遍、警告确认框的流程、改完以后记住的密码。
 * 二、模板：密码页、改密码页、键盘组件里没有 input / textarea，键是 button；没有 focus()。
 * 三、把 App.vue 真的挂起来，接一台假桩，在键盘上点着走一遍。
 * 四、13 种语言的新文案都齐。 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSuperPin, isDefaultSuperPin } from "../src/super-pass.js";
import {
  PAD_KEYS, PAD_MISMATCH, PIN_CHANGE_MIN_FW, PIN_LEN, PIN_TEXTS, flowCommand, flowNew, flowStep, isPinCommand,
  keyFromEvent, padKey, padNew, padReady, padShown, padValue, parsePinLine, pinCells, pinChangeFwOk, pinEdit,
  rememberAfterPinset, rememberAfterSuperset, silentNote,
} from "../src/pin-pad.js";
import { parseAuthLine, queueRefused, resendable } from "../src/auth.js";
import { languages, translate } from "../src/i18n.js";
import { pinPacks } from "../src/packs-pin.js";
import { SETTINGS_GROUPS } from "../src/tabs.js";
import { typeFromStatus } from "../src/devtype.js";
import { mountShell, textOf } from "./helpers/mount-shell.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const vue = read("APP/ui/src/App.vue");
const pad = read("APP/ui/src/PinPad.vue");
const template = vue.slice(0, vue.indexOf("<script setup>"));
const script = vue.slice(vue.indexOf("<script setup>"), vue.indexOf("</script>"));
const section = (name) => {
  const m = vue.match(new RegExp("<section v-else-if=\"page === '" + name + "'\"[\\s\\S]*?</section>"));
  assert.ok(m, "找不到页面 " + name);
  return m[0];
};

/* ------------------------------------------------------------------ 一、纯逻辑 */

test("超级密码默认值：广播名前 3 位，数字 d → 0d，字母 → 01..26，不分大小写", () => {
  assert.equal(deriveSuperPin("EVC_1B3XYZ"), "010203");
  assert.equal(deriveSuperPin("EVC_A0Z123"), "010026");
  assert.equal(deriveSuperPin("EVC_000000"), "000000");
  assert.equal(deriveSuperPin("EVC_999AAA"), "090909");
  assert.equal(deriveSuperPin("EVC_ZZZ000"), "262626");
  assert.equal(deriveSuperPin("EVC_JKL000"), "101112");
  assert.equal(deriveSuperPin("EVC_abz000"), "010226");
  assert.equal(deriveSuperPin("EVC_1B3"), "010203");
  /* 不是单射：数字 1 和字母 A 都是 01。 */
  assert.equal(deriveSuperPin("EVC_111000"), deriveSuperPin("EVC_AAA000"));
  for (const bad of [null, undefined, "", "EVC_", "EVC_1B", "EVC_1-3XYZ", "EVC_ 23XYZ", "EVC_12é", "evc_1B3XYZ", "AC06-0001", "XEVC_1B3", "EVCM1B3XYZ"]) {
    assert.equal(deriveSuperPin(bad), "", String(bad));
  }
  assert.equal(isDefaultSuperPin("EVC_1B3XYZ", "010203"), true);
  assert.equal(isDefaultSuperPin("EVC_1B3XYZ", "010204"), false);
  assert.equal(isDefaultSuperPin("AC06-0001", ""), false);
  assert.equal(isDefaultSuperPin("EVC_1B3XYZ", "01020"), false);
});

test("推导和固件对拍：固件单测里每一个例子，App 算出来一样", () => {
  const c = read("AC06/tests/host/test_ble_super.c");
  const good = [...c.matchAll(/derives\("([^"]*)", "(\d{6})"\)/g)];
  assert.ok(good.length >= 10, "固件单测里的例子: " + good.length);
  for (const m of good) assert.equal(deriveSuperPin(m[1]), m[2], m[1]);
  assert.ok(good.some((m) => m[1] === "EVC_1B3XYZ" && m[2] === "010203"));
  const bad = [...c.matchAll(/!ble_super_derive\("((?:[^"\\]|\\.)*)", out\)/g)].map((m) => m[1]);
  assert.ok(bad.length >= 6, "固件单测里的非法名字: " + bad.length);
  for (const name of bad) {
    if (name.includes("\\")) continue;              /* C 的转义写法（UTF-8 字节），上面已经单独测过 */
    assert.equal(deriveSuperPin(name), "", name);
  }
  /* 固件的规则写在 ble_super.c 里：前缀、三位、字母加一。 */
  const fw = read("AC06/service/src/ble_super.c");
  assert.match(fw, /strncmp\(name, "EVC_", 4u\) != 0/);
  assert.match(fw, /for\(i = 0u; i < 3u; i\+\+\)/);
  assert.match(fw, /v = \(unsigned\)\(c - 'A'\) \+ 1u;/);
});

test("PINSET / SUPERGET / SUPERSET 的应答按整行认，应答里没有密码", () => {
  assert.deepEqual(parsePinLine("ACK PINSET OK"), { kind: "pinset", ok: true });
  assert.deepEqual(parsePinLine("ACK PINSET FAIL"), { kind: "pinset", ok: false, why: "fail" });
  assert.deepEqual(parsePinLine("ACK PINSET AUTH"), { kind: "pinset", ok: false, why: "auth" });
  assert.deepEqual(parsePinLine("ACK PINSET BUSY"), { kind: "pinset", ok: false, why: "busy" });
  assert.deepEqual(parsePinLine("ACK SUPERSET OK"), { kind: "superset", ok: true });
  assert.deepEqual(parsePinLine("ACK SUPERSET FAIL"), { kind: "superset", ok: false, why: "fail" });
  assert.deepEqual(parsePinLine("ACK SUPERSET BUSY"), { kind: "superset", ok: false, why: "busy" });
  assert.deepEqual(parsePinLine("ACK SUPER DEFAULT"), { kind: "super", custom: false });
  assert.deepEqual(parsePinLine(" ACK SUPER CUSTOM\r\n"), { kind: "super", custom: true });
  assert.deepEqual(parsePinLine("ACK SUPERGET AUTH"), { kind: "super", custom: null, why: "auth" });
  for (const other of ["ACK PINSET", "ACK PINSET OK 123456", "ACK SUPER 010203", "ACK SUPER DEFAULT 010203", "ACK SUPERSET",
    "ACK AUTH OK", "ACK SCRTHEMESET OK", "PINSET OK", "ACK PINGET OK", "", null, undefined, 5]) {
    assert.equal(parsePinLine(other), null, String(other));
  }
  /* 固件里就是这几行。 */
  const wb2 = read("AC06/app/src/wb2.c");
  for (const line of ["ACK PINSET OK", "ACK PINSET FAIL", "ACK SUPER CUSTOM", "ACK SUPER DEFAULT", "ACK SUPERSET OK", "ACK SUPERSET FAIL"]) {
    assert.ok(wb2.includes('"' + line + '"'), line);
    assert.notEqual(parsePinLine(line), null, line);
  }
  for (const cmd of ['strncmp(text, "PINSET\\t", 7) == 0', 'strcmp(text, "SUPERGET") == 0', 'strncmp(text, "SUPERSET\\t", 9) == 0']) {
    assert.ok(wb2.includes(cmd), "ble_is_command 里没有 " + cmd);
  }
  /* 鉴权应答还是 auth.js 认；改密码不悄悄补发，新密码不留在补发清单里。 */
  assert.deepEqual(parseAuthLine("ACK PINSET AUTH"), { kind: "need", cmd: "PINSET" });
  assert.deepEqual(parseAuthLine("ACK SUPERSET AUTH"), { kind: "need", cmd: "SUPERSET" });
  assert.equal(parseAuthLine("ACK PINSET OK"), null);
  assert.equal(parseAuthLine("ACK SUPER DEFAULT"), null);
  assert.equal(resendable("PINSET\t123456"), false);
  assert.equal(resendable("SUPERSET\t123456"), false);
  assert.equal(resendable("SUPERGET"), true);
  assert.deepEqual(queueRefused([], "PINSET\t123456"), []);
  assert.ok(isPinCommand("PINSET") && isPinCommand("SUPERSET") && isPinCommand("SUPERGET") && !isPinCommand("AUTH"));
});

test("支持这个功能的最低固件版本集中在 PIN_CHANGE_MIN_FW（先填 3.0.9）", () => {
  assert.equal(PIN_CHANGE_MIN_FW, "3.0.9");
  assert.equal(pinChangeFwOk("3.0.9"), true);
  assert.equal(pinChangeFwOk("V3.0.10"), true);
  assert.equal(pinChangeFwOk("3.1.0"), true);
  assert.equal(pinChangeFwOk("3.0.8"), false);
  assert.equal(pinChangeFwOk("2.8.0"), false);
  assert.equal(pinChangeFwOk("—"), null);
  assert.equal(pinChangeFwOk(""), null);
  assert.deepEqual(silentNote(true), { text: "充电桩没有应答，请重试", vars: null });
  assert.deepEqual(silentNote(false), { text: "固件不支持，请先升级固件（需要 {v} 或更高版本）", vars: { v: "3.0.9" } });
  assert.equal(silentNote(null).text, silentNote(false).text);
  /* 这个数只写在一处。 */
  assert.ok(!vue.includes("3.0.9"));
});

test("键盘：数字、退格、清空；满 6 位不再加；方格只说填没填", () => {
  assert.deepEqual(PAD_KEYS, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"]);
  assert.equal(PIN_LEN, 6);
  let text = "";
  for (const key of "12345") text = pinEdit(text, key);
  assert.equal(text, "12345");
  assert.equal(pinEdit(text, "back"), "1234");
  assert.equal(pinEdit(text, "6"), "123456");
  assert.equal(pinEdit("123456", "7"), "123456");
  assert.equal(pinEdit("123456", "clear"), "");
  assert.equal(pinEdit("", "back"), "");
  assert.equal(pinEdit("12", "x"), "12");
  assert.equal(pinEdit("12", "10"), "12");
  assert.equal(pinEdit("1a2b", "3"), "123");
  assert.equal(pinEdit(null, "0"), "0");
  const cells = pinCells("123", true);
  assert.equal(cells.length, 6);
  assert.deepEqual(cells.map((c) => c.filled), [true, true, true, false, false, false]);
  assert.deepEqual(cells.map((c) => c.on), [false, false, false, true, false, false]);
  assert.ok(pinCells("123456", true).every((c) => c.filled && !c.on));
  assert.ok(pinCells("12", false).every((c) => !c.on));
  /* 方格的数据里没有数字本身。 */
  assert.ok(!JSON.stringify(pinCells("987654", true)).includes("9"));
});

test("外接键盘：数字键、退格、Delete、回车；带 Ctrl / Alt / Meta 的不管", () => {
  for (const d of "0123456789") assert.equal(keyFromEvent({ key: d }), d);
  assert.equal(keyFromEvent({ key: "Backspace" }), "back");
  assert.equal(keyFromEvent({ key: "Delete" }), "clear");
  assert.equal(keyFromEvent({ key: "Enter" }), "enter");
  for (const key of ["a", "Tab", "Escape", " ", "ArrowLeft", "F5", "Unidentified", "Process", ""]) {
    assert.equal(keyFromEvent({ key }), null, key);
  }
  assert.equal(keyFromEvent({ key: "1", ctrlKey: true }), null);
  assert.equal(keyFromEvent({ key: "1", metaKey: true }), null);
  assert.equal(keyFromEvent({ key: "1", altKey: true }), null);
  assert.equal(keyFromEvent(null), null);
});

const typeAll = (state, digits) => { for (const d of digits) state = padKey(state, d); return state; };

test("输两遍：第一遍满 6 位切到第二遍；一致才能确认；不一致两遍都清掉重来", () => {
  let state = padNew();
  assert.deepEqual(state, { step: 0, first: "", second: "", error: "" });
  state = typeAll(state, "13579");
  assert.equal(state.step, 0);
  assert.equal(padShown(state), "13579");
  assert.equal(padReady(state), false);
  state = padKey(state, "0");
  assert.equal(state.step, 1);
  assert.equal(padShown(state), "", "切到第二遍，方格是空的");
  assert.equal(padReady(state), false);
  assert.equal(padValue(state), "");
  state = typeAll(state, "13579");
  assert.equal(padReady(state), false);
  state = padKey(state, "0");
  assert.equal(padReady(state), true);
  assert.equal(padValue(state), "135790");
  /* 已经一致了，再按数字不变。 */
  assert.deepEqual(padKey(state, "5"), state);
  /* 退格：第二遍删一位，不再能确认。 */
  state = padKey(state, "back");
  assert.equal(padShown(state), "13579");
  assert.equal(padReady(state), false);
  /* 第二遍输得不一样：两遍清掉，回到第一遍，带一句提示；下一个键把提示清掉。 */
  state = padKey(state, "1");
  assert.deepEqual(state, { step: 0, first: "", second: "", error: PAD_MISMATCH });
  assert.equal(PAD_MISMATCH, "两次输入不一致，请重新输入");
  state = padKey(state, "2");
  assert.deepEqual(state, { step: 0, first: "2", second: "", error: "" });
  /* 第二遍还空着的时候按退格：回第一遍，删掉最后一位。 */
  state = typeAll(padNew(), "246810");
  assert.equal(state.step, 1);
  state = padKey(state, "back");
  assert.deepEqual(state, { step: 0, first: "24681", second: "", error: "" });
  /* 清空：从头来。 */
  state = typeAll(typeAll(padNew(), "246810"), "246");
  assert.deepEqual(padKey(state, "clear"), padNew());
  /* 只输了一遍的不算数。 */
  assert.equal(padValue(typeAll(padNew(), "246810")), "");
});

const enterTwice = (flow, pin) => {
  for (const d of pin + pin) flow = flowStep(flow, { t: "key", key: d }).flow;
  return flow;
};

test("改管理员密码的流程：输两遍 → 确认修改 → 发 PINSET → OK / FAIL / 没应答", () => {
  let flow = flowNew("user");
  assert.equal(flow.stage, "enter");
  /* 没输完不能确认，什么也不发。 */
  let out = flowStep(flow, { t: "confirm" });
  assert.equal(out.send, "");
  assert.equal(out.flow.stage, "enter");
  flow = enterTwice(flow, "135790");
  assert.equal(flowCommand(flow), "PINSET\t135790");
  out = flowStep(flow, { t: "confirm" });
  assert.equal(out.send, "PINSET\t135790");
  assert.equal(out.flow.stage, "sending");
  assert.equal(out.flow.note, "正在修改");
  /* 等应答的时候键盘不管用，再点确认不再发。 */
  assert.equal(flowStep(out.flow, { t: "key", key: "1" }).flow, out.flow);
  assert.equal(flowStep(out.flow, { t: "confirm" }).send, "");
  /* 别的命令的应答不认。 */
  assert.equal(flowStep(out.flow, { t: "reply", reply: parsePinLine("ACK SUPERSET OK") }).flow.stage, "sending");
  const ok = flowStep(out.flow, { t: "reply", reply: parsePinLine("ACK PINSET OK") });
  assert.equal(ok.flow.stage, "done");
  assert.equal(ok.flow.note, "管理员密码已修改");
  for (const line of ["ACK PINSET FAIL", "ACK PINSET BUSY", "ACK PINSET AUTH"]) {
    const fail = flowStep(out.flow, { t: "reply", reply: parsePinLine(line) });
    assert.equal(fail.flow.stage, "enter", line);
    assert.equal(fail.flow.note, "修改失败，请重试", line);
    assert.deepEqual(fail.flow.pad, padNew(), "输过的清掉");
    assert.equal(fail.send, "");
  }
  /* 没应答：固件旧 → 请先升级；固件够新 → 请重试。都回到输入，不卡在“正在修改”。 */
  let late = flowStep(out.flow, { t: "timeout", fwOk: false });
  assert.equal(late.flow.stage, "enter");
  assert.equal(late.flow.note, "固件不支持，请先升级固件（需要 {v} 或更高版本）");
  assert.deepEqual(late.flow.noteVars, { v: PIN_CHANGE_MIN_FW });
  late = flowStep(out.flow, { t: "timeout", fwOk: null });
  assert.equal(late.flow.note, "固件不支持，请先升级固件（需要 {v} 或更高版本）");
  late = flowStep(out.flow, { t: "timeout", fwOk: true });
  assert.equal(late.flow.note, "充电桩没有应答，请重试");
  /* 管理员密码没有警告框。 */
  assert.equal(flowStep(flow, { t: "warn-ok" }).send, "");
});

test("改超级密码的流程：确认修改先弹警告，点了「确认修改」才发 SUPERSET；取消回到输入", () => {
  let flow = enterTwice(flowNew("super"), "864209");
  assert.equal(flowCommand(flow), "SUPERSET\t864209");
  let out = flowStep(flow, { t: "confirm" });
  assert.equal(out.send, "", "警告之前什么都不发");
  assert.equal(out.flow.stage, "warn");
  /* 警告框开着：键盘不管用。 */
  assert.equal(flowStep(out.flow, { t: "key", key: "back" }).flow, out.flow);
  assert.equal(flowStep(out.flow, { t: "confirm" }).send, "");
  /* 取消：回到输入，输过的还在，还是什么都没发。 */
  const cancel = flowStep(out.flow, { t: "warn-cancel" });
  assert.equal(cancel.send, "");
  assert.equal(cancel.flow.stage, "enter");
  assert.equal(padValue(cancel.flow.pad), "864209");
  /* 再来一次，这回确认。 */
  out = flowStep(cancel.flow, { t: "confirm" });
  out = flowStep(out.flow, { t: "warn-ok" });
  assert.equal(out.send, "SUPERSET\t864209");
  assert.equal(out.flow.stage, "sending");
  assert.equal(flowStep(out.flow, { t: "warn-ok" }).send, "", "不会发第二次");
  const ok = flowStep(out.flow, { t: "reply", reply: parsePinLine("ACK SUPERSET OK") });
  assert.equal(ok.flow.stage, "done");
  assert.equal(ok.flow.note, "超级密码已修改");
  assert.equal(flowStep(out.flow, { t: "reply", reply: parsePinLine("ACK PINSET OK") }).flow.stage, "sending");
  const fail = flowStep(out.flow, { t: "reply", reply: parsePinLine("ACK SUPERSET FAIL") });
  assert.equal(fail.flow.stage, "enter");
  assert.equal(fail.flow.note, "修改失败，请重试");
  /* 没走到警告就点 warn-ok：不发。 */
  assert.equal(flowStep(flow, { t: "warn-ok" }).send, "");
  /* 两遍不一致：提示，回到第一遍。 */
  let wrong = flowNew("super");
  for (const d of "864209864200") wrong = flowStep(wrong, { t: "key", key: d }).flow;
  assert.equal(wrong.note, "两次输入不一致，请重新输入");
  assert.equal(wrong.pad.step, 0);
  assert.equal(flowStep(wrong, { t: "confirm" }).flow.stage, "enter");
});

test("改完以后手机上记住的密码", () => {
  /* 管理员密码：记着的换成新的；没记的不记；这条连接以后用新的重新核对。 */
  assert.deepEqual(rememberAfterPinset({ saved: "123456", session: "123456" }, "135790"), { saved: "135790", session: "135790" });
  assert.deepEqual(rememberAfterPinset({ saved: "", session: "123456" }, "135790"), { saved: "", session: "135790" });
  /* 用超级密码进来的（记住的是超级密码）：换成新的管理员密码，一样能连。 */
  assert.deepEqual(rememberAfterPinset({ saved: "010203", session: "010203" }, "135790"), { saved: "135790", session: "135790" });
  /* 超级密码：记住的正好是旧的（默认的）超级密码 → 换成新的。 */
  assert.deepEqual(rememberAfterSuperset({ saved: "010203", session: "010203" }, "864209", "EVC_1B3XYZ", false),
    { saved: "864209", session: "864209" });
  /* 记住的是管理员密码 → 不动。 */
  assert.deepEqual(rememberAfterSuperset({ saved: "123456", session: "123456" }, "864209", "EVC_1B3XYZ", false),
    { saved: "123456", session: "123456" });
  /* 没记 → 还是没记；这条连接是用默认超级密码进来的 → 以后用新的重新核对。 */
  assert.deepEqual(rememberAfterSuperset({ saved: "", session: "010203" }, "864209", "EVC_1B3XYZ", false),
    { saved: "", session: "864209" });
  /* 旧的超级密码已经是自定义的：App 不知道它是多少，一律不动。 */
  assert.deepEqual(rememberAfterSuperset({ saved: "010203", session: "555555" }, "864209", "EVC_1B3XYZ", true),
    { saved: "010203", session: "555555" });
  /* 名字认不出来：不动。 */
  assert.deepEqual(rememberAfterSuperset({ saved: "010203", session: "010203" }, "864209", "AC06-0001", false),
    { saved: "010203", session: "010203" });
});

/* ------------------------------------------------------------------ 二、模板 */

test("密码页、改密码页、键盘组件：没有 input / textarea / select，键是 button，不会调出系统键盘", () => {
  const noField = /<(input|textarea|select)\b|contenteditable|inputmode=|autofocus|v-model=/i;
  for (const name of ["gate", "pinmenu", "pinedit"]) {
    assert.ok(!noField.test(section(name)), name + " 页里还有输入框");
  }
  const padTemplate = pad.slice(pad.indexOf("<template>"), pad.indexOf("<script setup>"));
  assert.ok(!noField.test(padTemplate), "键盘组件里有输入框");
  assert.ok(!/tabindex|\.focus\(/.test(pad));
  /* 键盘的每个键是 button；方格是 span，只显示 ●，不显示数字。 */
  assert.match(padTemplate, /<button v-for="key in PAD_KEYS" :key="key" type="button" class="pin-key"/);
  assert.match(padTemplate, /<span v-for="\(cell, i\) in cells"[^>]*class="pin-cell"[^>]*>\{\{ cell\.filled \? '●' : '' \}\}<\/span>/);
  assert.ok(!/\{\{\s*(value|props\.value)/.test(padTemplate), "方格里显示了密码");
  /* 三页都用这个键盘；密码页的输入框没有了，原来的「连接」按钮、锁定倒计时还在。 */
  const gate = section("gate");
  assert.match(gate, /<PinPad :value="gateInput"[^>]*@key="gatePadKey"/);
  assert.match(gate, /<button class="go" :disabled="gateLockLeft > 0" @click="submitGate">/);
  assert.match(gate, /gateNoteShown/);
  /* 「保存密码」是按钮，不是 checkbox。 */
  assert.match(gate, /<button type="button" class="row check" role="switch" :aria-checked="gateSave \? 'true' : 'false'" @click="gateSave = !gateSave">/);
  assert.match(section("pinedit"), /<PinPad :value="pinShown"[^>]*@key="pinPadKey"/);
  /* 整个界面没有主动 focus() 的地方，也没有 autofocus；进这几页会把别处输入框的焦点放掉。 */
  assert.ok(!/\.focus\(/.test(vue), "App.vue 里有 focus()");
  assert.ok(!/autofocus/i.test(vue));
  assert.match(script, /watch\(page, \(now\) => \{ if \(now === "gate" \|\| now === "pinmenu" \|\| now === "pinedit"\) blurTyping\(\); \}\);/);
  /* 外接键盘从 document 上收按键，不靠输入框。 */
  assert.match(script, /document\.addEventListener\("keydown", onPinKeydown\);/);
  assert.match(script, /if \(page\.value !== "gate" && page\.value !== "pinedit"\) return;/);
  /* 键够大：最小 44px 高（最矮的屏），平常 60px。 */
  const heights = [...pad.matchAll(/\.pin-key \{[^}]*min-height: (\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(heights.length >= 3 && Math.min(...heights) >= 44 && Math.max(...heights) >= 56, heights.join(","));
  /* 阿拉伯语、乌尔都语下键盘也是从左到右。 */
  assert.match(padTemplate, /<div class="pinpad" dir="ltr">/);
});

test("M01 的页面没有动：它还是自己的密码输入框，不用 AC06 的键盘", () => {
  const m01 = read("APP/ui/src/m01/M01App.vue");
  assert.match(m01, /<input v-model="gateInput" class="field" type="password" inputmode="numeric" maxlength="6"/);
  assert.ok(!m01.includes("PinPad") && !m01.includes("pin-pad") && !m01.includes("PINSET") && !m01.includes("SUPERSET"));
  /* AC06 的键盘处理在 M01 模块开着的时候不管事。 */
  assert.match(script, /function onPinKeydown\(event\) \{\n\s+if \(mod\.value === "m01"\) return;/);
});

test("修改密码的入口在 设置 → 关于；警告框有 取消 / 确认修改 两个按钮；界面不显示密码和推导规则", () => {
  assert.ok(SETTINGS_GROUPS.find((g) => g.title === "关于").items.includes("openPinMenu"));
  const menu = section("menu");
  assert.match(menu, /@click="openPinMenu">\s*<span><strong>\{\{ t\('修改密码'\) \}\}<\/strong>/);
  const edit = section("pinedit");
  const warn = edit.match(/<div v-if="pinFlow\.stage === 'warn'" class="pin-warn" role="alertdialog"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(warn, "没有警告框");
  assert.match(warn[0], /t\('忘记密码后将无法重置'\)/);
  assert.match(warn[0], /@click="pinAct\(\{ t: 'warn-cancel' \}\)">\{\{ t\('取消'\) \}\}<\/button>/);
  assert.match(warn[0], /@click="pinAct\(\{ t: 'warn-ok' \}\)">\{\{ t\('确认修改'\) \}\}<\/button>/);
  assert.equal((warn[0].match(/<button/g) || []).length, 2);
  const pinmenu = section("pinmenu");
  assert.match(pinmenu, /t\('超级密码默认由设备编号推算，建议修改。'\)/);
  /* 界面上不算、不显示默认超级密码；推导规则不写在界面文字里。 */
  assert.ok(!template.includes("deriveSuperPin") && !template.includes("isDefaultSuperPin"));
  for (const lang of Object.keys(pinPacks)) {
    for (const text of Object.values(pinPacks[lang])) assert.ok(!/01.*26|A.?=.?01/.test(text), lang + ": " + text);
  }
  /* 新密码不进 lastSent（resendable 为假），不进日志。 */
  assert.ok(!/console\.(log|info|warn|error)\([^)]*pin/i.test(script));
  /* 原生层：新应答都以 "ACK " 开头，Android 和 iOS 的白名单本来就放行，不用改。 */
  assert.match(read("APP/android/src/com/evcity/acv2/MainActivity.java"), /static boolean knownLineAc06\(String line\) \{[\s\S]*?line\.startsWith\("ACK "\)/);
  assert.match(read("APP/ios/Core/Sources/EVCCore/FrameParser.swift"), /"STAT ", "WCFG ", "FLT ", "LIVE ", "ACK "/);
});

/* ------------------------------------------------------------------ 三、挂起来点一遍 */

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}
async function run(ms) {
  for (let t = 0; t < ms; t += 50) {
    mock.timers.tick(50);
    await flush();
  }
}

/* 假桩：和固件一样的规则。opts.old：旧固件，不认识 PINSET / SUPERGET / SUPERSET（什么都不回）。 */
function fakePile(name, opts = {}) {
  const pile = {
    name, user: opts.user || "123456", superPin: deriveSuperPin(name), custom: false, authed: false, log: [],
    fw: opts.fw || "3.0.9", old: !!opts.old, failNext: false,
    reply(command) {
      pile.log.push(command);
      const part = command.split("\t");
      const digits = /^\d{6}$/.test(part[1] || "") && part.length === 2;
      /* 和固件一样的状态行：…… 插枪、已存、拨码、电量、固件版本、时钟。 */
      if (part[0] === "STATUS") return ["STAT A NONE 00:00:00 230 0 0 0 0 0 0 1 OFF 0 0 0 0 " + pile.fw + " -"];
      if (part[0] === "HB") return [];
      if (part[0] === "AUTH") {
        pile.authed = part[1] === pile.user || part[1] === pile.superPin;
        return [pile.authed ? "ACK AUTH OK" : "ACK AUTH FAIL"];
      }
      if (pile.old && (part[0] === "PINSET" || part[0] === "SUPERGET" || part[0] === "SUPERSET")) return [];
      if (!pile.authed) return ["ACK " + part[0] + " AUTH"];
      if (part[0] === "SUPERGET") return [pile.custom ? "ACK SUPER CUSTOM" : "ACK SUPER DEFAULT"];
      if (part[0] === "PINSET" || part[0] === "SUPERSET") {
        if (!digits || pile.failNext) {
          pile.failNext = false;
          return ["ACK " + part[0] + " FAIL"];
        }
        if (part[0] === "PINSET") pile.user = part[1];
        else { pile.superPin = part[1]; pile.custom = true; }
        return ["ACK " + part[0] + " OK"];
      }
      return [];
    },
  };
  return pile;
}

async function mountWith(pile, addr, pins) {
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
    pins: pins || {},
    onSend: (command) => { if (linked) deliver(pile.reply(command)); },
    onConnect: () => setTimeout(() => {
      linked = true;
      pile.authed = false;
      app.vm.handle({ t: "page", s: "charge" });
      deliver(pile.reply("STATUS"));
    }, 100),
    onDisconnect: () => { linked = false; },
  });
  app.vm.handle({ t: "devs", list: [{ name: pile.name, addr, rssi: -50 }] });
  await flush();
  app.click(pile.name);
  await run(3000);
  return app;
}
const classes = (n) => String(n.props.class || "").split(/\s+/);
const keyButton = (app, key) => {
  const hit = app.buttons((n) => classes(n).includes("pin-key") &&
    (key === "back" ? classes(n).includes("back") : key === "clear" ? classes(n).includes("word") : textOf(n) === key));
  assert.equal(hit.length, 1, "键盘上的键 " + key + ": " + hit.length);
  return hit[0];
};
async function tap(app, keys) {
  for (const key of keys) {
    const button = keyButton(app, key);
    assert.ok(!button.props.disabled, "键 " + key + " 不可点");
    button.props.onClick({});
    await flush();
  }
}
const dots = (app) => app.byClass("pin-cell").map((n) => textOf(n)).join("|");
const sentHead = (app, head) => app.sent.filter((c) => c === head || c.indexOf(head + "\t") === 0);
async function openPinMenu(app) {
  app.click((n) => n.props.class === "tab" && textOf(n).includes("设置"));
  await run(1000);
  app.click("修改密码");
  await run(600);
}
const withTimers = (fn) => async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1795000000000 });
  try { await fn(); } finally { mock.timers.reset(); }
};

test("密码页：没有输入框；在键盘上点 6 位自动核对；方格只有 ●；退格、清空管用", withTimers(async () => {
  const addr = "AA:00:00:00:10:01";
  const pile = fakePile("EVC_1B3XYZ");
  const app = await mountWith(pile, addr);
  assert.ok(app.text().includes("连接这台充电桩需要屏幕上的管理员密码"));
  assert.equal(app.inputs().length, 0, "密码页上有 input");
  assert.equal(app.buttons((n) => classes(n).includes("pin-key")).length, 12);
  assert.equal(app.byClass("pin-cell").length, 6);
  assert.equal(dots(app), "|||||");
  await tap(app, "98");
  assert.equal(dots(app), "●|●||||");
  assert.ok(!app.text().includes("98"), "方格里显示了数字");
  await tap(app, ["back"]);
  assert.equal(dots(app), "●|||||");
  await tap(app, ["clear"]);
  assert.equal(dots(app), "|||||");
  assert.equal(sentHead(app, "AUTH").length, 0, "没满 6 位不发");
  /* 输错一次：回到密码页，方格清空，有提示。 */
  await tap(app, "000000");
  await run(1500);
  assert.deepEqual(sentHead(app, "AUTH"), ["AUTH\t000000"]);
  assert.ok(app.text().includes("密码不对"));
  assert.equal(dots(app), "|||||");
  /* 输对：满 6 位自动核对，进充电页，不用点「连接」。记住了。 */
  await tap(app, "123456");
  await run(1500);
  assert.equal(sentHead(app, "AUTH").at(-1), "AUTH\t123456");
  assert.ok(app.text().includes("立即充电"));
  assert.equal(app.byClass("pin-cell").length, 0);
  assert.equal(app.evc.loadGate(addr), "123456");
  app.close();
}));

test("密码页：不勾「保存密码」就不记；默认的超级密码也能连进来", withTimers(async () => {
  const addr = "AA:00:00:00:10:02";
  const pile = fakePile("EVC_1B3XYZ", { user: "777777" });
  const app = await mountWith(pile, addr);
  const toggle = app.buttons((n) => classes(n).includes("check"))[0];
  assert.equal(toggle.props["aria-checked"], "true");
  toggle.props.onClick({});
  await flush();
  assert.equal(app.buttons((n) => classes(n).includes("check"))[0].props["aria-checked"], "false");
  await tap(app, "010203");                       /* EVC_1B3XYZ 的默认超级密码 */
  await run(1500);
  assert.ok(pile.authed);
  assert.ok(app.text().includes("立即充电"));
  assert.equal(app.evc.loadGate(addr), "");
  app.close();
}));

test("改管理员密码：输两遍 → 确认修改 → PINSET → 提示成功；记住的密码换成新的；不用重新登录", withTimers(async () => {
  const addr = "AA:00:00:00:10:03";
  const pile = fakePile("EVC_1B3XYZ");
  const app = await mountWith(pile, addr, { [addr]: "123456" });
  assert.ok(app.text().includes("立即充电"));
  await openPinMenu(app);
  assert.deepEqual(sentHead(app, "SUPERGET"), ["SUPERGET"]);
  assert.ok(app.text().includes("修改管理员密码") && app.text().includes("修改超级密码"));
  assert.ok(app.text().includes("超级密码默认由设备编号推算，建议修改。"));
  assert.ok(app.text().includes("默认密码"));
  assert.ok(!app.text().includes("010203"), "界面上显示了默认超级密码");
  app.click("修改管理员密码");
  await flush();
  assert.equal(app.inputs().length, 0, "改密码页上有 input");
  assert.ok(app.text().includes("请输入新的 6 位密码"));
  const confirm = () => app.buttons((n) => classes(n).includes("go") && textOf(n) === "确认修改")[0];
  assert.equal(confirm().props.disabled, true);
  await tap(app, "135790");
  assert.ok(app.text().includes("请再输入一次"), "满 6 位切到第二遍");
  assert.equal(dots(app), "|||||");
  assert.equal(confirm().props.disabled, true);
  /* 第二遍输错：提示，回到第一遍。 */
  await tap(app, "135791");
  assert.ok(app.text().includes("两次输入不一致，请重新输入"));
  assert.ok(app.text().includes("请输入新的 6 位密码"));
  assert.equal(confirm().props.disabled, true);
  assert.equal(sentHead(app, "PINSET").length, 0);
  await tap(app, "135790135790");
  assert.equal(dots(app), "●|●|●|●|●|●");
  assert.equal(confirm().props.disabled, false);
  assert.ok(!app.text().includes("135790"));
  confirm().props.onClick({});
  await flush();
  assert.deepEqual(sentHead(app, "PINSET"), ["PINSET\t135790"]);
  assert.ok(app.text().includes("正在修改"));
  await run(300);
  assert.ok(app.text().includes("管理员密码已修改"));
  assert.equal(pile.user, "135790");
  assert.equal(app.evc.loadGate(addr), "135790", "记住的密码换成新的");
  assert.equal(app.store.get("ac06-gate:" + addr), "135790");
  assert.equal(sentHead(app, "AUTH").length, 1, "没有重新登录");
  assert.ok(!app.text().includes("135790"));
  /* 桩把鉴权作废了（蓝牙恢复流程）：App 用新密码悄悄重新核对，不回密码页。 */
  pile.authed = false;
  app.click("修改超级密码");
  await flush();
  app.click("返回");
  await run(3000);
  assert.equal(sentHead(app, "AUTH").at(-1), "AUTH\t135790");
  assert.ok(pile.authed);
  assert.ok(!app.text().includes("连接这台充电桩需要屏幕上的管理员密码"));
  app.close();
}));

test("改管理员密码：桩回 FAIL → 提示失败，可以重来；记住的密码不变", withTimers(async () => {
  const addr = "AA:00:00:00:10:04";
  const pile = fakePile("EVC_1B3XYZ");
  const app = await mountWith(pile, addr, { [addr]: "123456" });
  await openPinMenu(app);
  app.click("修改管理员密码");
  await flush();
  pile.failNext = true;
  await tap(app, "246810246810");
  app.click((n) => classes(n).includes("go") && textOf(n) === "确认修改");
  await run(300);
  assert.ok(app.text().includes("修改失败，请重试"));
  assert.ok(app.text().includes("请输入新的 6 位密码"));
  assert.equal(dots(app), "|||||");
  assert.equal(pile.user, "123456");
  assert.equal(app.evc.loadGate(addr), "123456");
  /* 再来一次就成了。 */
  await tap(app, "246810246810");
  app.click((n) => classes(n).includes("go") && textOf(n) === "确认修改");
  await run(300);
  assert.ok(app.text().includes("管理员密码已修改"));
  assert.equal(app.evc.loadGate(addr), "246810");
  app.close();
}));

test("改超级密码：先弹「忘记密码后将无法重置」，取消不发，确认修改才发 SUPERSET；记住的旧超级密码跟着换", withTimers(async () => {
  const addr = "AA:00:00:00:10:05";
  const pile = fakePile("EVC_1B3XYZ");
  /* 这台手机记住的是默认的超级密码（用它连进来的）。 */
  const app = await mountWith(pile, addr, { [addr]: "010203" });
  assert.ok(app.text().includes("立即充电"));
  await openPinMenu(app);
  app.click("修改超级密码");
  await flush();
  assert.equal(app.inputs().length, 0);
  await tap(app, "864209864209");
  assert.equal(app.byClass("pin-warn").length, 0);
  app.click((n) => classes(n).includes("go") && textOf(n) === "确认修改");
  await flush();
  assert.equal(app.byClass("pin-warn").length, 1, "没有弹警告");
  assert.ok(app.text().includes("忘记密码后将无法重置"));
  assert.equal(sentHead(app, "SUPERSET").length, 0, "警告之前不发");
  const warnButtons = () => {
    const box = app.byClass("pin-warn")[0];
    const out = [];
    (function walk(n) { if (n.tag === "button") out.push(n); (n.children || []).forEach(walk); })(box);
    return out;
  };
  assert.deepEqual(warnButtons().map((n) => textOf(n)), ["取消", "确认修改"]);
  /* 取消：警告框关掉，没发，输过的还在。 */
  warnButtons()[0].props.onClick({});
  await run(500);
  assert.equal(app.byClass("pin-warn").length, 0);
  assert.equal(sentHead(app, "SUPERSET").length, 0);
  assert.equal(dots(app), "●|●|●|●|●|●");
  assert.equal(pile.superPin, "010203");
  /* 再点确认修改 → 警告 → 确认修改。 */
  app.click((n) => classes(n).includes("go") && textOf(n) === "确认修改" && !classes(n).includes("pin-key"));
  await flush();
  warnButtons()[1].props.onClick({});
  await flush();
  assert.deepEqual(sentHead(app, "SUPERSET"), ["SUPERSET\t864209"]);
  await run(300);
  assert.ok(app.text().includes("超级密码已修改"));
  assert.ok(app.text().includes("已修改"));
  assert.ok(!app.text().includes("超级密码默认由设备编号推算，建议修改。"));
  assert.equal(pile.superPin, "864209");
  assert.equal(pile.custom, true);
  assert.equal(app.evc.loadGate(addr), "864209", "记住的旧超级密码换成新的");
  assert.ok(!app.text().includes("864209"));
  app.close();
}));

test("改超级密码：记住的是管理员密码 → 不动", withTimers(async () => {
  const addr = "AA:00:00:00:10:06";
  const pile = fakePile("EVC_1B3XYZ");
  const app = await mountWith(pile, addr, { [addr]: "123456" });
  await openPinMenu(app);
  app.click("修改超级密码");
  await flush();
  await tap(app, "864209864209");
  app.click((n) => classes(n).includes("go") && textOf(n) === "确认修改");
  await flush();
  app.click((n) => textOf(n) === "确认修改" && !classes(n).includes("go") === false && n.parent && classes(n.parent).includes("pair"));
  await run(300);
  assert.equal(pile.superPin, "864209");
  assert.equal(app.evc.loadGate(addr), "123456");
  app.close();
}));

test("旧固件（不回应答）：提示“固件不支持，请先升级固件”，两个入口点不了，不卡死", withTimers(async () => {
  const addr = "AA:00:00:00:10:07";
  const pile = fakePile("EVC_1B3XYZ", { old: true, fw: "3.0.8" });
  const app = await mountWith(pile, addr, { [addr]: "123456" });
  await openPinMenu(app);
  assert.ok(app.text().includes("正在读取"));
  await run(5000);
  assert.equal(sentHead(app, "SUPERGET").length, 2, "问两次");
  assert.ok(app.text().includes("固件不支持，请先升级固件（需要 3.0.9 或更高版本）"), app.text().slice(0, 200));
  assert.ok(!app.text().includes("正在读取"));
  for (const name of ["修改管理员密码", "修改超级密码"]) {
    const card = app.buttons((n) => textOf(n).includes(name))[0];
    assert.equal(card.props.disabled, true, name);
  }
  /* 返回照常。 */
  app.click("返回");
  await run(500);
  assert.ok(app.text().includes("隐私协议"));
  app.close();
}));

test("固件版本够新但这一下没应答：提示“没有应答，请重试”，有「重试」", withTimers(async () => {
  const addr = "AA:00:00:00:10:08";
  const pile = fakePile("EVC_1B3XYZ", { old: true, fw: "3.0.9" });
  const app = await mountWith(pile, addr, { [addr]: "123456" });
  await openPinMenu(app);
  await run(5000);
  assert.ok(app.text().includes("充电桩没有应答，请重试"));
  pile.old = false;
  app.click("重试");
  await run(500);
  assert.ok(!app.text().includes("充电桩没有应答，请重试"));
  assert.equal(app.buttons((n) => textOf(n).includes("修改管理员密码"))[0].props.disabled, false);
  /* 改到一半桩不回了：5 秒后回到输入并提示，不停在“正在修改”。 */
  app.click("修改管理员密码");
  await flush();
  pile.old = true;
  await tap(app, "111111111111");
  app.click((n) => classes(n).includes("go") && textOf(n) === "确认修改");
  await run(1000);
  assert.ok(app.text().includes("正在修改"));
  await run(5000);
  assert.ok(!app.text().includes("正在修改"));
  assert.ok(app.text().includes("充电桩没有应答，请重试"));
  assert.equal(app.evc.loadGate(addr), "123456");
  app.close();
}));

/* ------------------------------------------------------------------ 四、文案 */

test("13 种语言：新文案都齐（中文是键，其余 12 种都翻了，不是中文、也不是英文原样）", () => {
  assert.equal(languages.length, 13);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  assert.deepEqual(Object.keys(pinPacks.en).sort(), PIN_TEXTS.slice().sort());
  for (const lang of langs) {
    assert.ok(pinPacks[lang], lang + " 没有表");
    assert.deepEqual(Object.keys(pinPacks[lang]).sort(), PIN_TEXTS.slice().sort(), lang + " 的键不齐");
    for (const key of PIN_TEXTS) {
      const out = translate(lang, key, { v: "3.0.9", n: 4 });
      assert.ok(out && out !== translate("zh", key, { v: "3.0.9", n: 4 }), lang + " 没翻: " + key);
      assert.ok(!/[一-鿿]/.test(out) || lang === "ja", lang + " 里有中文: " + out);
      if (lang !== "en") assert.notEqual(out, translate("en", key, { v: "3.0.9", n: 4 }), lang + " 用了英文: " + key);
      assert.ok(!out.includes("{"), lang + " 变量没替换: " + out);
      /* 带变量的两条：变量都还在。 */
      if (key.includes("{v}")) assert.ok(pinPacks[lang][key].includes("{v}"), lang + ": " + key);
      if (key.includes("{n}")) assert.ok(pinPacks[lang][key].includes("{n}"), lang + ": " + key);
    }
  }
  /* 中文原样。 */
  assert.equal(translate("zh", "忘记密码后将无法重置"), "忘记密码后将无法重置");
  assert.equal(translate("en", "忘记密码后将无法重置"), "A forgotten password cannot be reset");
  /* 三页模板和脚本里用到的文字，12 种语言都有。 */
  const used = new Set();
  for (const name of ["gate", "pinmenu", "pinedit"]) {
    for (const m of section(name).matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
  }
  for (const key of ["修改密码", "修改管理员密码", "修改超级密码", "正在读取", "取消", "确认修改", "管理员密码", ...PIN_TEXTS]) used.add(key);
  for (const lang of langs) {
    for (const key of used) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
    }
  }
  /* pin-pad.js 里流程用到的每一句都在 PIN_TEXTS 里。 */
  const padJs = read("APP/ui/src/pin-pad.js");
  for (const m of padJs.matchAll(/(?:text|note|PAD_MISMATCH =|\? ) ?[:=]? ?"([^"]*[一-鿿][^"]*)"/g)) {
    assert.ok(PIN_TEXTS.includes(m[1]), "PIN_TEXTS 里没有: " + m[1]);
  }
});
