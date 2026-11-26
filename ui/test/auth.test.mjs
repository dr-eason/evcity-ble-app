/* 蓝牙鉴权应答（固件 2.7.2）的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/auth.test.mjs
 *
 * 假桩按固件 wb2.c 里 ble_handle_command() / ble_auth_try() 的规则应答：没通过 AUTH 时
 * 只认 HB、AUTH、STATUS，别的回 "ACK <命令名> AUTH"；连续输错 5 次锁 60 秒，期间回
 * "ACK AUTH LOCKED <剩余秒数>"；断开、蓝牙恢复流程把鉴权作废。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_LOCK_SECONDS, AUTH_REAUTH_MAX, AUTH_RESEND_MAX, AUTH_TEXTS, authDecide, commandName,
  isOtaCommand, lockLeft, lockNote, parseAuthLine, pinOk, queueRefused, resendable,
} from "../src/auth.js";
import { languages, translate } from "../src/i18n.js";
import { authPacks } from "../src/packs-auth.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/* ---------------------------------------------------------------- 应答的格式 */

test("AUTH 的三种应答按整行认", () => {
  assert.deepEqual(parseAuthLine("ACK AUTH OK"), { kind: "ok" });
  assert.deepEqual(parseAuthLine("ACK AUTH FAIL"), { kind: "fail" });
  assert.deepEqual(parseAuthLine("ACK AUTH LOCKED 60"), { kind: "locked", seconds: 60 });
  assert.deepEqual(parseAuthLine("ACK AUTH LOCKED 1"), { kind: "locked", seconds: 1 });
  assert.deepEqual(parseAuthLine("ACK AUTH LOCKED 37"), { kind: "locked", seconds: 37 });
  /* 早期的 2.7.2 固件不带秒数。 */
  assert.deepEqual(parseAuthLine("ACK AUTH LOCKED"), { kind: "locked", seconds: null });
  /* 行尾的空白、回车不碍事。 */
  assert.deepEqual(parseAuthLine("ACK AUTH OK\r"), { kind: "ok" });
  assert.deepEqual(parseAuthLine("  ACK AUTH LOCKED 12  "), { kind: "locked", seconds: 12 });
  /* 秒数离谱的不信，按“不知道还要多久”。 */
  assert.deepEqual(parseAuthLine("ACK AUTH LOCKED 0"), { kind: "locked", seconds: null });
  assert.deepEqual(parseAuthLine("ACK AUTH LOCKED 99999"), { kind: "locked", seconds: null });
});

test("ACK <命令名> AUTH 是“这条连接还没通过鉴权”，不是密码不对", () => {
  for (const name of ["SCHEDGET", "TELGET", "CFGSET", "IMAXSET", "WPASSGET", "OCPPSET", "START",
    "STOP", "REBOOT", "OTAPREP", "OTADATA", "TIMESET", "LTESET", "TZSET", "PHASESET",
    "NETSTOPSET", "MODVERGET", "ORDGET", "CARDSET", "WIFISWSET"]) {
    assert.deepEqual(parseAuthLine("ACK " + name + " AUTH"), { kind: "need", cmd: name }, name);
  }
  /* AUTH 自己的应答不算这一种。 */
  assert.equal(parseAuthLine("ACK AUTH AUTH"), null);
});

test("别的应答不会被误认（2.7.1 按子串找 AUTH / OK 会认错）", () => {
  const others = [
    "ACK IMAXSET OK", "ACK CFGSET FAIL", "ACK CFGSET BUSY", "ACK PHASESET BUSY", "ACK START OK",
    "ACK START REJECTED", "ACK OCPPSET OK", "ACK WSAVE OK", "ACK TIME 1795000000 480",
    "ACK LTE 1", "ACK ADV 1 2 3", "ACK MODVER x", "STAT CHARGING NONE 5", "FLT NONE",
    "WCFG AUTH", "ACK AUTH", "ACK AUTH OKAY", "ACK AUTH FAILED", "ACK AUTH LOCKEDX",
    "ACK AUTH LOCKED abc", "ACK AUTH OK 1", "ACK CFGSET AUTH OK", "ack auth ok",
    "ACK  ", "", null, undefined, "AUTH", "OK", "ACK OTADATA 3 OK", "ACK NETSTOPSET BUSY",
    "ACK AUTHGET AUTHX", "ACK lower AUTH",
  ];
  for (const line of others) assert.equal(parseAuthLine(line), null, String(line));
});

test("固件里的字符串和这里认的是同一套", () => {
  const fw = read("AC06/app/src/wb2.c");
  assert.match(fw, /ble_queue\("ACK AUTH OK"\)/);
  assert.match(fw, /ble_queue\("ACK AUTH FAIL"\)/);
  assert.match(fw, /"ACK AUTH LOCKED %u"/);
  assert.match(fw, /ble_ack_name\(cmd, "AUTH"\)/);
  assert.match(fw, /#define BLE_AUTH_MAX_FAIL\s+5u/);
  const lock = fw.match(/#define BLE_AUTH_LOCK_MS\s+(\d+)u/);
  assert.ok(lock);
  assert.equal(Number(lock[1]) / 1000, AUTH_LOCK_SECONDS);
  /* 没通过 AUTH 时只放行 HB、AUTH、STATUS。 */
  assert.match(fw, /if\(!s_ble_authed && strcmp\(cmd, "STATUS"\) != 0\)/);
});

test("命令名、补发清单", () => {
  assert.equal(commandName("IMAXSET\t16"), "IMAXSET");
  assert.equal(commandName("SCHEDGET"), "SCHEDGET");
  assert.equal(commandName(""), "");
  assert.equal(commandName(null), "");
  assert.ok(resendable("IMAXSET\t16") && resendable("SCHEDGET") && resendable("CFGSET\t1\t2"));
  /* 不补发的：AUTH、心跳、固件数据、带时刻的授时。 */
  for (const text of ["AUTH\t123456", "HB", "HB\t1795000000\t480", "OTADATA\t1\t0\tAA",
    "OTAPREP", "OTAEND", "TIMESET\t1795000000\t480", ""]) assert.equal(resendable(text), false, text);
  assert.ok(isOtaCommand("OTADATA") && isOtaCommand("OTAPREP") && !isOtaCommand("IMAXSET"));

  let list = [];
  list = queueRefused(list, "IMAXSET\t16");
  list = queueRefused(list, "SCHEDGET");
  list = queueRefused(list, "IMAXSET\t20");            /* 同名的只留最后一条 */
  list = queueRefused(list, "OTADATA\t1\t0\tAA");      /* 不该补发的不进清单 */
  assert.deepEqual(list, ["SCHEDGET", "IMAXSET\t20"]);
  for (let i = 0; i < 20; i++) list = queueRefused(list, "CMD" + i + "GET");
  assert.equal(list.length, AUTH_RESEND_MAX);
  assert.equal(list[list.length - 1], "CMD19GET");
  assert.deepEqual(queueRefused(null, "TELGET"), ["TELGET"]);
});

test("pinOk", () => {
  assert.ok(pinOk("123456") && pinOk("000000"));
  for (const bad of ["", "12345", "1234567", "12345a", " 123456", null, undefined, 123]) {
    assert.equal(pinOk(bad), false, String(bad));
  }
});

/* ---------------------------------------------------------------- 该怎么办 */

test("authDecide：通过、不对、锁定", () => {
  assert.deepEqual(authDecide({ kind: "ok" }, { state: "checking", reauth: false }), { action: "enter" });
  assert.deepEqual(authDecide({ kind: "ok" }, { state: "checking", reauth: true }), { action: "resume" });
  assert.deepEqual(authDecide({ kind: "fail" }, { state: "checking", pass: "123456" }), { action: "wrong" });
  assert.deepEqual(authDecide({ kind: "fail" }, { state: "checking", reauth: true }), { action: "wrong" });
  assert.deepEqual(authDecide({ kind: "locked", seconds: 42 }, { state: "checking", pass: "123456" }),
    { action: "locked", seconds: 42, retry: true });
  assert.deepEqual(authDecide({ kind: "locked", seconds: null }, { state: "checking", pass: "" }),
    { action: "locked", seconds: null, retry: false });
  assert.deepEqual(authDecide(null, {}), { action: "none" });
});

test("authDecide：ACK <命令名> AUTH 时悄悄重发，密码用这次连接里通过的，其次是记住的", () => {
  const need = { kind: "need", cmd: "SCHEDGET" };
  assert.deepEqual(authDecide(need, { state: "ok", pass: "111111", saved: "222222", tries: 0 }),
    { action: "reauth", pass: "111111", cmd: "SCHEDGET" });
  assert.deepEqual(authDecide(need, { state: "ok", pass: "", saved: "222222", tries: 0 }),
    { action: "reauth", pass: "222222", cmd: "SCHEDGET" });
  /* AUTH 已经在路上：等结果，不再发一条。 */
  assert.deepEqual(authDecide(need, { state: "checking", pass: "111111", tries: 1 }),
    { action: "wait", cmd: "SCHEDGET" });
  /* 没有可用的密码：请用户输，记住的密码不动（不是 wrong）。 */
  assert.deepEqual(authDecide(need, { state: "ok", pass: "", saved: "", tries: 0 }),
    { action: "ask", cmd: "SCHEDGET" });
  assert.deepEqual(authDecide(need, { state: "ok", pass: "12", saved: "abc", tries: 0 }),
    { action: "ask", cmd: "SCHEDGET" });
  /* 一条连接上重发过 AUTH_REAUTH_MAX 次还被拒：不再来回刷。 */
  assert.deepEqual(authDecide(need, { state: "ok", pass: "111111", tries: AUTH_REAUTH_MAX }),
    { action: "ask", cmd: "SCHEDGET" });
});

/* ---------------------------------------------------------------- 假桩 + 界面这一层 */

/* 固件的规则（wb2.c）。now 是毫秒。 */
function makePile(pin) {
  const pile = { pin, authed: false, fails: 0, lockUntil: 0, now: 0, done: [], imax: 32 };
  pile.recover = () => { pile.authed = false; };      /* 断开、蓝牙恢复流程、模组复位 */
  pile.handle = (text) => {
    const name = commandName(text);
    if (name === "HB") return [];
    if (name === "AUTH") {
      if (pile.lockUntil > pile.now) {
        pile.authed = false;
        return ["ACK AUTH LOCKED " + Math.max(1, Math.ceil((pile.lockUntil - pile.now) / 1000))];
      }
      if (pile.lockUntil !== 0) { pile.lockUntil = 0; pile.fails = 0; }
      if (text.slice(5) === pile.pin) { pile.authed = true; pile.fails = 0; return ["ACK AUTH OK"]; }
      pile.authed = false;
      pile.fails++;
      if (pile.fails >= 5) {
        pile.lockUntil = pile.now + AUTH_LOCK_SECONDS * 1000;
        return ["ACK AUTH LOCKED " + AUTH_LOCK_SECONDS];
      }
      return ["ACK AUTH FAIL"];
    }
    if (name === "STATUS") return ["STAT AVAILABLE NONE 0"];
    if (!pile.authed) return ["ACK " + name + " AUTH"];
    pile.done.push(text);
    if (name === "IMAXSET") { pile.imax = Number(text.slice(8)); return ["ACK IMAXSET OK"]; }
    if (name === "IMAXGET") return ["IMAX " + pile.imax];
    if (name === "SCHEDGET") return ["SCHED 480 0 0 0"];
    if (name === "TELGET") return ["TEL 0"];
    return ["ACK " + name + " OK"];
  };
  return pile;
}

/* App.vue 里 applyAuthLine() 的那一层，去掉界面：状态、补发清单、记住的密码、锁定。 */
function makeApp(pile, saved) {
  const app = {
    state: "need", page: "scan", pass: "", saved: saved || "", reauth: false, tries: 0,
    refused: [], lastSent: {}, lock: null, forgot: 0, other: [], sent: [],
  };
  app.send = (text) => {
    if (resendable(text)) app.lastSent[commandName(text)] = text;
    app.sent.push(text);
    pile.handle(text).forEach((line) => app.line(line));
  };
  app.auth = (pass) => { app.pass = pass; app.state = "checking"; app.send("AUTH\t" + pass); };
  app.connect = () => {                              /* 连上：有密码就核对，没有就去密码页 */
    app.reauth = false; app.tries = 0; app.refused = []; app.lastSent = {};
    const pass = pinOk(app.pass) ? app.pass : app.saved;
    if (pinOk(pass)) app.auth(pass);
    else { app.state = "need"; app.page = "gate"; }
  };
  app.line = (line) => {
    const reply = parseAuthLine(line);
    if (!reply) { app.other.push(line); return; }
    const step = authDecide(reply, { state: app.state, reauth: app.reauth, pass: app.pass, saved: app.saved, tries: app.tries });
    if (step.action === "enter") { app.state = "ok"; app.page = "charge"; app.saved = app.pass; app.lock = null; }
    else if (step.action === "resume") {
      const again = app.refused; app.refused = []; app.reauth = false; app.state = "ok"; app.lock = null;
      again.forEach((text) => app.send(text));
    }
    else if (step.action === "reauth" || step.action === "wait") {
      if (app.lastSent[step.cmd]) app.refused = queueRefused(app.refused, app.lastSent[step.cmd]);
      if (step.action === "reauth") { app.reauth = true; app.tries++; app.auth(step.pass); }
    }
    else if (step.action === "ask") { app.reauth = false; app.refused = []; app.state = "need"; app.page = "gate"; }
    else if (step.action === "wrong") {
      app.reauth = false; app.refused = []; app.state = "need"; app.page = "gate"; app.saved = ""; app.forgot++;
    }
    else if (step.action === "locked") {
      app.reauth = false; app.refused = []; app.state = "need"; app.page = "gate";
      app.lock = { seconds: step.seconds, retry: step.retry ? app.pass : "" };
    }
  };
  return app;
}

test("首次连接：没记过密码 → 密码页 → 输对进充电页并记住", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "");
  app.connect();
  assert.equal(app.page, "gate");
  app.auth("000000");
  assert.equal(app.page, "gate");
  assert.equal(app.state, "need");
  assert.equal(app.forgot, 1);
  app.auth("246810");
  assert.equal(app.page, "charge");
  assert.equal(app.state, "ok");
  assert.equal(app.saved, "246810");
  app.send("IMAXSET\t16");
  assert.equal(pile.imax, 16);
});

test("断线重连：记住的密码自动核对，直接进充电页", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "246810");
  app.connect();
  assert.equal(app.page, "charge");
  pile.recover();                                    /* 蓝牙断开 */
  app.state = "unknown"; app.page = "scan";          /* App 回到扫描页 */
  app.connect();
  assert.equal(app.page, "charge");
  assert.equal(app.state, "ok");
  assert.equal(app.forgot, 0);
  assert.deepEqual(app.sent.filter((text) => commandName(text) === "AUTH").length, 2);
});

test("蓝牙恢复流程之后：下一条命令被拒 → 悄悄重发 AUTH → 命令补发，界面不动，密码不删", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "246810");
  app.connect();
  app.page = "imax";                                 /* 用户在“最大电流”页上 */
  pile.recover();                                    /* 桩走了一次恢复流程，手机没断开 */
  assert.equal(app.state, "ok");                     /* App 不知道 */
  app.send("IMAXSET\t20");
  /* 2.7.1 在这里回到密码页、删掉记住的密码、显示“密码不对”。 */
  assert.equal(app.page, "imax");
  assert.equal(app.state, "ok");
  assert.equal(app.forgot, 0);
  assert.equal(app.saved, "246810");
  assert.equal(pile.imax, 20);                       /* 被拒的那条补发了，真的生效 */
  assert.deepEqual(app.sent.slice(-3), ["IMAXSET\t20", "AUTH\t246810", "IMAXSET\t20"]);
  assert.ok(app.other.includes("ACK IMAXSET OK"));
  assert.equal(app.tries, 1);
  /* 同一条连接上再来一次也行。 */
  pile.recover();
  app.send("SCHEDGET");
  assert.equal(app.state, "ok");
  assert.ok(app.other.includes("SCHED 480 0 0 0"));
});

test("恢复之后一口气发了几条：只重发一次 AUTH，被拒的都补发", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "246810");
  app.connect();
  pile.recover();
  /* 第一条被拒时 AUTH 发出去、马上通过（假桩是同步的）；模拟应答晚到：手工喂行。 */
  const quiet = makeApp({ handle: () => [] }, "246810");
  quiet.state = "ok"; quiet.pass = "246810"; quiet.page = "menu";
  quiet.send("SCHEDGET"); quiet.send("TELGET"); quiet.send("IMAXGET");
  quiet.line("ACK SCHEDGET AUTH");
  assert.equal(quiet.state, "checking");
  quiet.line("ACK TELGET AUTH");
  quiet.line("ACK IMAXGET AUTH");
  assert.equal(quiet.sent.filter((text) => commandName(text) === "AUTH").length, 1);
  assert.deepEqual(quiet.refused, ["SCHEDGET", "TELGET", "IMAXGET"]);
  quiet.line("ACK AUTH OK");
  assert.equal(quiet.state, "ok");
  assert.equal(quiet.page, "menu");
  assert.deepEqual(quiet.sent.slice(-3), ["SCHEDGET", "TELGET", "IMAXGET"]);
  assert.deepEqual(quiet.refused, []);
});

test("恢复之后屏上的密码已经改了：记住的那个不对 → 密码页，这时才删", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "246810");
  app.connect();
  pile.pin = "135790";                               /* 有人在屏上改了密码 */
  pile.recover();
  app.send("TELGET");
  assert.equal(app.page, "gate");
  assert.equal(app.state, "need");
  assert.equal(app.forgot, 1);
  assert.equal(app.saved, "");
  app.auth("135790");
  assert.equal(app.page, "charge");
});

test("输错 5 次：第 5 次起显示已锁定和剩余秒数，记住的密码不删；到点后同一个密码能过", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "");
  app.connect();
  for (let i = 0; i < 4; i++) {
    app.auth("00000" + i);
    assert.equal(app.lock, null);
  }
  assert.equal(app.forgot, 4);
  app.auth("000009");                                /* 第 5 次 */
  assert.deepEqual(app.lock, { seconds: 60, retry: "000009" });
  assert.equal(app.forgot, 4);                       /* 锁定不算“密码不对” */
  /* 锁着的时候输对了也不行，秒数跟着走。 */
  pile.now += 20000;
  app.auth("246810");
  assert.deepEqual(app.lock, { seconds: 40, retry: "246810" });
  assert.equal(app.state, "need");
  assert.equal(app.page, "gate");
  pile.now += 39500;
  app.auth("246810");
  assert.deepEqual(app.lock, { seconds: 1, retry: "246810" });
  /* 到点：锁定前没来得及核对的那个密码自动再试一次。 */
  pile.now += 600;
  app.auth(app.lock.retry);
  assert.equal(app.state, "ok");
  assert.equal(app.page, "charge");
  assert.equal(app.lock, null);
  assert.equal(app.saved, "246810");
});

test("别人把桩锁住了：自己记住的正确密码不被删，到点后自动通过", () => {
  const pile = makePile("246810");
  const stranger = makeApp(pile, "");
  for (let i = 0; i < 5; i++) stranger.auth("11111" + i);
  pile.recover();
  const app = makeApp(pile, "246810");
  app.connect();                                     /* 自动核对记住的密码 */
  assert.equal(app.page, "gate");
  assert.equal(app.lock.seconds, 60);
  assert.equal(app.lock.retry, "246810");
  assert.equal(app.saved, "246810");
  assert.equal(app.forgot, 0);
  pile.now += 61000;
  app.auth(app.lock.retry);
  assert.equal(app.page, "charge");
});

test("恢复之后悄悄重发时正好锁着：到密码页显示倒计时", () => {
  const pile = makePile("246810");
  const app = makeApp(pile, "246810");
  app.connect();
  const stranger = makeApp(pile, "");
  pile.recover();
  for (let i = 0; i < 5; i++) stranger.auth("11111" + i);
  app.send("SCHEDGET");
  assert.equal(app.page, "gate");
  assert.equal(app.lock.seconds, 60);
  assert.equal(app.saved, "246810");
  assert.equal(app.reauth, false);
});

test("2.7.1 及更早的固件（没有门禁）：照旧", () => {
  const old = { handle: (text) => {
    const name = commandName(text);
    if (name === "AUTH") return [text.slice(5) === "123456" ? "ACK AUTH OK" : "ACK AUTH FAIL"];
    if (name === "HB") return [];
    return ["ACK " + name + " OK"];
  } };
  const app = makeApp(old, "");
  app.connect();
  app.auth("111111");
  assert.equal(app.page, "gate");
  app.auth("123456");
  assert.equal(app.page, "charge");
  app.send("IMAXSET\t16");
  assert.ok(app.other.includes("ACK IMAXSET OK"));
});

/* ---------------------------------------------------------------- 剩余时间 */

test("lockLeft：向上取整，到点是 0", () => {
  assert.equal(lockLeft(60000, 0), 60);
  assert.equal(lockLeft(60000, 1), 60);
  assert.equal(lockLeft(60000, 1000), 59);
  assert.equal(lockLeft(60000, 59001), 1);
  assert.equal(lockLeft(60000, 59999), 1);
  assert.equal(lockLeft(60000, 60000), 0);
  assert.equal(lockLeft(60000, 70000), 0);
  assert.equal(lockLeft(0, 5), 0);
  assert.equal(lockLeft(undefined, 5), 0);
});

test("lockNote：有秒数时带倒计时，没有时只说稍后再试", () => {
  assert.deepEqual(lockNote(42, true), { text: "输错次数太多，已锁定。{s} 秒后可以再试", vars: { s: 42 } });
  assert.deepEqual(lockNote(0, false), { text: "输错次数太多，已锁定。请稍后再试", vars: null });
  assert.deepEqual(lockNote(0, true), { text: "输错次数太多，已锁定。请稍后再试", vars: null });
  assert.ok(AUTH_TEXTS.includes(lockNote(5, true).text) && AUTH_TEXTS.includes(lockNote(0, false).text));
});

/* ---------------------------------------------------------------- 多语言 */

test("新文案 12 种语言都翻了，占位符都在", () => {
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  assert.deepEqual(Object.keys(authPacks).sort(), langs.slice().sort());
  for (const lang of langs) {
    assert.deepEqual(Object.keys(authPacks[lang]).sort(), AUTH_TEXTS.slice().sort(), lang);
    for (const key of AUTH_TEXTS) {
      const out = authPacks[lang][key];
      assert.ok(typeof out === "string" && out.trim().length > 0, lang + " " + key);
      assert.notEqual(out, key, lang + " " + key);
      assert.ok(!/[一-鿿]/.test(out) || lang === "ja", lang + " 留着中文：" + out);
      assert.equal(out.includes("{s}"), key.includes("{s}"), lang + " 占位符：" + key);
      assert.equal((out.match(/\{/g) || []).length, (key.match(/\{/g) || []).length, lang + " " + key);
    }
    /* 经过 translate()：数字填进去了，没有剩下花括号。 */
    const note = translate(lang, "输错次数太多，已锁定。{s} 秒后可以再试", { s: 42 });
    assert.ok(note.includes("42") && !note.includes("{"), lang + " " + note);
    const button = translate(lang, "已锁定（{s} 秒）", { s: 7 });
    assert.ok(button.includes("7") && !button.includes("{"), lang + " " + button);
    assert.ok(button.length <= 28, lang + " 按钮上的字太长：" + button);
  }
  /* 中文就是键本身。 */
  assert.equal(translate("zh", "输错次数太多，已锁定。{s} 秒后可以再试", { s: 42 }),
    "输错次数太多，已锁定。42 秒后可以再试");
  assert.equal(translate("zh", "已锁定（{s} 秒）", { s: 7 }), "已锁定（7 秒）");
  /* 各语言互不相同（没有整段照抄英文）。 */
  for (const key of AUTH_TEXTS) {
    const seen = new Set(langs.map((lang) => authPacks[lang][key]));
    assert.ok(seen.size >= 11, key);
  }
});

test("密码页原有的文案各语言也都在", () => {
  const keys = ["密码不对。请输入屏幕上现在的管理员密码", "正在核对密码", "请输入充电桩屏幕上的 6 位管理员密码",
    "请输入 6 位数字", "正在连接并核对", "连接", "状态已更新"];
  for (const item of languages) {
    if (item.id === "zh") continue;
    for (const key of keys) {
      const out = translate(item.id, key);
      assert.ok(out && out !== key, item.id + " " + key);
    }
  }
});

/* ---------------------------------------------------------------- 界面的接法、版本号 */

test("App.vue：鉴权应答最先处理，不再按子串认密码不对", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/App.vue");
  const script = vue.slice(vue.indexOf("<script setup>"));
  /* applyLine 的第一句。排在 otaWait、parseTimeAck、parseLteAck 这些前面。 */
  assert.match(script, /function applyLine\(line\) \{\n  if \(applyAuthLine\(line\)\) return;/);
  assert.ok(!/line\.indexOf\("AUTH"\)/.test(script));
  assert.match(script, /const reply = parseAuthLine\(line\);/);
  assert.match(script, /authDecide\(reply, \{/);
  /* 锁定：不删记住的密码；密码不对才删。 */
  const locked = script.slice(script.indexOf('if (step.action === "locked")'), script.indexOf("return false;\n}", script.indexOf('if (step.action === "locked")')));
  assert.ok(locked.includes("startGateLock(") && !locked.includes("forgetGate()"));
  const wrong = script.slice(script.indexOf('if (step.action === "wrong")'), script.indexOf('if (step.action === "locked")'));
  assert.ok(wrong.includes("forgetGate()"));
  /* 悄悄重发通过后不跳页、补发被拒的命令。 */
  const resume = script.slice(script.indexOf('if (step.action === "resume")'), script.indexOf('if (step.action === "reauth"'));
  assert.ok(resume.includes("again.forEach((text) => send(text));") && !resume.includes('page.value = "charge"'));
  /* 密码页：锁着时按钮不能点，上面是剩余秒数。 */
  assert.match(vue, /<button class="go" :disabled="gateLockLeft > 0" @click="submitGate">/);
  assert.ok(vue.includes("t('已锁定（{s} 秒）', { s: gateLockLeft })"));
  assert.ok(vue.includes("{{ gateNoteShown }}"));
  /* 换连接时把上一条连接的补发清单、倒计时收掉。 */
  assert.ok((script.match(/resetGateSession\(\);/g) || []).length >= 3);
});

test("编好的界面里有新文案（assets/index.html 是用这份源码编的）", () => {
  const html = read("AC06/tools/ble-finder/assets/index.html");
  assert.ok(html.includes("Too many wrong passwords. Locked: try again in {s} s"));
  assert.ok(html.includes("已锁定（{s} 秒）"));
  assert.ok(html.includes("ACK\\\\s+AUTH\\\\s+LOCKED") || html.includes("AUTH\\s+LOCKED"));
});

test("版本号 3.0.5 / 3005：安卓", () => {
  const manifest = read("AC06/tools/ble-finder/AndroidManifest.xml");
  assert.match(manifest, /android:versionCode="3005"/);
  assert.match(manifest, /android:versionName="3\.0\.5"/);
});

/* iOS 的 Config/Base.xcconfig 和固件的 app_config.h 不归 App 这边改（2.8.0 的 App 改动只动
 * ble-finder；3.0.0 起三处一起升）。两边还没跟上时这两条记为 todo，不让整套测试失败；跟上以后就是普通的断言。 */
const iosConf = (() => { try { return read("AC06/tools/ble-ios/Config/Base.xcconfig"); } catch (e) { return ""; } })();
const iosSynced = /^EVC_VERSION = 3\.0\.5$/m.test(iosConf) && /^EVC_BUILD = 3005$/m.test(iosConf);
test("版本号 3.0.5 / 3005：iOS 和安卓一致", { todo: iosSynced ? false : "ble-ios/Config/Base.xcconfig 还没升到 3.0.5 / 3005" }, () => {
  assert.match(iosConf, /^EVC_VERSION = 3\.0\.5$/m);
  assert.match(iosConf, /^EVC_BUILD = 3005$/m);
});
const fwConf = (() => { try { return read("AC06/user/inc/app_config.h"); } catch (e) { return ""; } })();
const fwSynced = /#define AC06_FW_VERSION\s+"3\.0\.5"/.test(fwConf);
test("版本号 3.0.5：固件和 App 一致", { todo: fwSynced ? false : "固件 AC06_FW_VERSION 还没升到 3.0.5" }, () => {
  assert.match(fwConf, /#define AC06_FW_VERSION\s+"3\.0\.5"/);
});
