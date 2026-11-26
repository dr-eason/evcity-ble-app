/* 一键配置（配置备份 / 还原）的主机测试：
 *
 *     node --test M01/tools/ble-finder/ui/test/
 *
 * 假桩按 文档/04-协议/M01蓝牙协议.md 的命令和应答格式回答（和固件 wb2.c 的
 * ble_handle_command 一致）；每一行都先过一遍手机蓝牙层的切行和过滤（helpers/phone-layer.mjs，
 * 行首表取自 MainActivity.java），到得了界面的才交给 profile.js。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OVER_V, DEFAULT_UNDER_V, SECTIONS, blankBody, hexToText, ocppUrlOk, profilePorts, profileWantsReboot, readPlan, sameSection, sectionSkip, voltageLimitError, writePlan } from "../src/m01/profile.js";
import { hasKey, languages, translate } from "../src/m01/i18n.js";
import { splitFrames } from "./helpers/m01-phone-layer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, "..", path), "utf8");

function toHex(text) {
  return [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PLIM_MIN = 50;
const PLIM_MAX = 2000;

/* 假桩：M01 1.0.0，出厂状态。opts.flashFail：功率上限写不进用户页；opts.forget：这几条
 * 设置命令回 OK 但其实没存。 */
function makePile(opts) {
  const o = opts || {};
  const st = {
    over: 253, under: 207,
    plim: Array(10).fill(800),
    cards: Array(10).fill(""),
    ocfw: { on: false, text: "" }, tel: false, netstop: { on: false, sec: 60 },
    wifiOn: false, ssid: "", pass: "", ocppOn: false, url: "",
    lteOn: false, apn: { proto: 0, apn: "", user: "", pass: "" },
    tz: 480,
    payModel: 1, fullW: 10, dip: 0,
    /* 并充：mode 是这次运行的，saved 是保存的（重启后生效）。busy = 有端口在充。 */
    mode: 1, saved: 1, busy: false, reboots: 0,
  };
  const sent = [];
  const portsOf = (mode) => Math.floor(10 / mode);
  const parLine = () => "ACK PAR\t" + st.mode + "\t" + portsOf(st.mode) + "\t" + st.saved;
  const payLine = () => "ACK PAY\t" + st.dip + "\t" + st.payModel + "\t" + st.fullW + "\t1\t100\t300\t-";
  const reboot = () => {
    st.reboots += 1;
    if (st.mode !== st.saved) {
      st.mode = st.saved;
      st.plim = Array(portsOf(st.mode)).fill(800 * st.mode);
    }
  };
  const forget = (name) => (o.forget || []).indexOf(name) >= 0;
  const flagText = (rest) => {
    const tab = rest.indexOf("\t");
    return tab < 0 ? [rest, ""] : [rest.slice(0, tab), rest.slice(tab + 1)];
  };
  /* 并充时端口数变少，上限的范围按每口里的物理口数放大。 */
  const plimLine = () => "ACK PLIM\t" + portsOf(st.mode) + "\t" + PLIM_MIN * st.mode + "\t" + PLIM_MAX * st.mode +
    "\t" + st.plim.join(",");
  function answer(cmd) {
    sent.push(cmd);
    const tab = cmd.indexOf("\t");
    const name = tab < 0 ? cmd : cmd.slice(0, tab);
    const arg = tab < 0 ? "" : cmd.slice(tab + 1);
    switch (name) {
      case "CFGGET": return ["CFG " + st.over.toFixed(0) + " " + st.under.toFixed(0)];
      case "CFGSET": {
        /* 两个数之间可以是制表符或空格；过压不高于 320，欠压不低于 100，过压至少高 10。 */
        const part = arg.split(/[\t ]/).map(Number);
        if (part.length < 2 || !(part[1] >= 100 && part[0] <= 320 && part[1] + 10 <= part[0])) return ["ACK CFGSET FAIL"];
        if (!forget(name)) [st.over, st.under] = [Math.round(part[0]), Math.round(part[1])];
        return ["ACK CFGSET OK"];
      }
      case "PLIMGET": return [plimLine()];
      case "PLIMSET": {
        const part = arg.split("\t");
        const port = /^\d{1,2}$/.test(part[0]) ? Number(part[0]) : NaN;
        if (!(port >= 0 && port <= portsOf(st.mode)) || part.length < 2) return ["ACK PLIMSET\t" + (Number.isInteger(port) ? port : 0) + "\tPORT"];
        const w = /^\d{1,5}$/.test(part[1]) ? Number(part[1]) : NaN;
        if (!(w >= PLIM_MIN * st.mode && w <= PLIM_MAX * st.mode)) return ["ACK PLIMSET\t" + port + "\tRANGE"];
        if (o.flashFail) return ["ACK PLIMSET\t" + port + "\tFLASH"];
        if (!forget(name)) {
          if (port === 0) st.plim = Array(portsOf(st.mode)).fill(w);
          else st.plim[port - 1] = w;
        }
        /* 成功后再补一行 ACK PLIM。 */
        return ["ACK PLIMSET\t" + port + "\tOK", plimLine()];
      }
      case "CARDGET": return ["CARD\t" + st.cards.join("\t")];
      case "CARDSET": {
        const [index, card] = flagText(arg);
        if (!/^\d{1,2}$/.test(index) || Number(index) < 1 || Number(index) > 10 ||
            card.length > 10 || /[^\x21-\x7E]/.test(card)) return ["ACK CARDSET FAIL"];
        st.cards[Number(index) - 1] = card;
        return ["ACK CARDSET OK"];
      }
      case "OCFWGET": return ["OCFW " + (st.ocfw.on ? 1 : 0) + "\t" + st.ocfw.text];
      case "OCFWSET": { const [on, text] = flagText(arg); st.ocfw = { on: on === "1", text }; return ["ACK OCFWSET OK"]; }
      case "TELGET": return ["TEL " + (st.tel ? 1 : 0)];
      case "TELSET": {
        const lines = ["ACK TELSET OK"];
        st.tel = arg === "1";
        if (st.tel && st.lteOn) { st.lteOn = false; lines.push("ACK LTE 0"); }
        return lines;
      }
      case "NETSTOPGET": return ["NETSTOP " + (st.netstop.on ? 1 : 0) + " " + st.netstop.sec];
      case "NETSTOPSET": {
        const [on, sec] = flagText(arg);
        if (!(Number(sec) >= 10 && Number(sec) <= 600)) return ["ACK NETSTOPSET FAIL"];
        st.netstop = { on: on === "1", sec: Number(sec) };
        return ["ACK NETSTOPSET OK"];
      }
      case "WIFISWGET": return ["WIFISW " + (st.wifiOn ? 1 : 0)];
      case "WIFISWSET": {
        /* 关 WiFi、4G 也没开：OCPP 开关跟着关，先补一行；应答后面总是再跟一行 OCPPSW。 */
        const lines = [];
        st.wifiOn = arg === "1";
        if (!st.wifiOn && !st.lteOn && st.ocppOn) { st.ocppOn = false; lines.push("OCPPSW 0"); }
        lines.push("ACK WIFISWSET OK", "OCPPSW " + (st.ocppOn ? 1 : 0));
        return lines;
      }
      case "WCFGGET": return ["WCFG DOWN " + (st.ssid || "-")];
      case "WSAVE": {
        const [ssid, pass] = flagText(arg);
        if (!ssid || ssid.length > 32 || pass.length > 32) return ["ACK WSAVE FAIL"];
        st.ssid = ssid;
        st.pass = pass;
        return ["ACK WSAVE OK"];
      }
      case "WPASSGET": return ["ACK WPASSGET " + (st.pass ? toHex(st.pass) : "-")];
      case "OCPPSWGET": return ["OCPPSW " + (st.ocppOn ? 1 : 0)];
      case "OCPPSWSET": st.ocppOn = arg === "1"; return ["ACK OCPPSWSET OK"];
      case "OCPPGET": return ["OCPP " + (st.url || "-")];
      case "OCPPSET": st.url = arg; return ["ACK OCPPSET OK"];
      case "APNGET": return ["ACK APN " + st.apn.proto + "\t" + st.apn.apn + "\t" + st.apn.user + "\t" + st.apn.pass];
      case "APNSET": {
        const part = arg.split("\t");
        if (part.length !== 4 || !/^[012]$/.test(part[0])) return ["ACK APNSET FAIL"];
        st.apn = { proto: Number(part[0]), apn: part[1], user: part[2], pass: part[3] };
        return ["ACK APNSET OK"];
      }
      case "TZGET": return ["ACK TZ " + st.tz];
      case "TZSET": {
        const tz = /^[+-]?\d{1,4}$/.test(arg) ? parseInt(arg, 10) : NaN;
        if (!(tz >= -720 && tz <= 840)) return ["ACK TZSET FAIL"];
        if (!forget(name)) st.tz = tz;
        return ["ACK TZSET OK"];
      }
      case "PAYGET": return [payLine()];
      case "PAYSET": {
        const part = arg.split("\t");
        if ((part.length !== 2 && part.length !== 3) || !/^[12]$/.test(part[0]) || !/^\d{1,3}$/.test(part[1]) ||
            Number(part[1]) < 1 || Number(part[1]) > 100) return ["ACK PAYSET FAIL"];
        if (part.length === 3 && (!/^\d{1,4}$/.test(part[2]) || Number(part[2]) < 10 || Number(part[2]) > 3600)) {
          return ["ACK PAYSET FAIL"];
        }
        if (!forget(name)) {
          [st.payModel, st.fullW] = [Number(part[0]), Number(part[1])];
          if (part.length === 3) st.hold = Number(part[2]);
        }
        return ["ACK PAYSET OK", payLine()];
      }
      case "PARGET": return [parLine()];
      case "PARSET": {
        /* PARSET\t<模式>[\t<0|1>]：第二个参数 0 = 只保存不重启；不带或 1 = 改了就重启。 */
        const part = arg.split("\t");
        if (part.length > 2 || ["1", "2", "3", "5"].indexOf(part[0]) < 0 ||
            (part.length === 2 && part[1] !== "0" && part[1] !== "1")) return ["ACK PARSET FAIL"];
        if (Number(part[0]) !== st.saved && st.busy) return ["ACK PARSET BUSY"];
        if (!forget(name)) st.saved = Number(part[0]);
        const lines = ["ACK PARSET OK", parLine()];
        if (part[1] !== "0" && st.saved !== st.mode) reboot();
        return lines;
      }
      case "REBOOT": reboot(); return ["ACK REBOOT OK"];
      /* 不认识的行不回任何东西（M01 没有这些命令）。 */
      default: return [];
    }
  }
  return { st, answer, sent, reboot };
}

/* App 的 askLine：发一条，桩回的每一行各是一次蓝牙通知，过手机蓝牙层（切行、过滤、去掉行尾的
 * 空字段），在到得了界面的行里找第一条 accept 认的。没有就是超时。 */
function ask(pile, step) {
  const lines = [];
  pile.answer(step.command).forEach((line) => splitFrames(line).forEach((got) => lines.push(got)));
  return lines.find((line) => step.accept(line)) || null;
}

/* runProfileJob 的读取。返回 { body, failed: [没读到的项] }。 */
function backup(pile) {
  const body = blankBody();
  const failed = [];
  for (const section of SECTIONS) {
    if (sectionSkip(section, "read", body)) continue;
    const plan = readPlan(section.key);
    let ok = !!plan.list;
    for (const step of plan.list || []) {
      const line = ask(pile, step);
      if (!line || !step.ok(line, body)) { ok = false; break; }
    }
    if (!ok) failed.push(section.key);
  }
  return { body, failed };
}

const PARGET = { command: "PARGET", accept: (line) => /^ACK PAR\t/.test(line) };

/* runProfileJob 的下发：先问现在有几路；每项写完读回来比；全部写完以后并充模式变了就发 REBOOT。
 * 返回 { failed, skipped, reasons, rebooted }。 */
function restore(pile, body) {
  const failed = [];
  const skipped = [];
  const reasons = {};
  const ports = profilePorts(ask(pile, PARGET));
  for (const section of SECTIONS) {
    if (sectionSkip(section, "write", body, ports)) { skipped.push(section.key); continue; }
    const plan = writePlan(section.key, body);
    let ok = !!plan.list;
    if (!ok) reasons[section.key] = plan.error;
    for (const step of plan.list || []) {
      const line = ask(pile, step);
      if (!line || !step.ok(line, body)) { ok = false; reasons[section.key] = step.reason(line); break; }
    }
    if (ok) {
      const got = blankBody();
      for (const step of readPlan(section.key).list) {
        const line = ask(pile, step);
        if (!line || !step.ok(line, got)) { ok = false; break; }
      }
      ok = ok && sameSection(section.key, body, got);
      if (!ok && !reasons[section.key]) reasons[section.key] = "读回的值和写入的不一样";
    }
    if (!ok) failed.push(section.key);
  }
  const rebooted = profileWantsReboot(ask(pile, PARGET));
  if (rebooted) pile.answer("REBOOT");
  return { failed, skipped, reasons, rebooted };
}

function configured(pile) {
  Object.assign(pile.st, {
    over: 260, under: 185,
    plim: [800, 1200, 400, 800, 2000, 50, 800, 800, 600, 1000],
    cards: ["A1B2C3D4", "", "0123456789", "", "", "CARD6", "", "", "", "ZZ"],
    ocfw: { on: true, text: "V9.9.9" }, tel: true, netstop: { on: true, sec: 120 },
    wifiOn: true, ssid: "Shop_5G", pass: "p w,AP 1 ACK x", ocppOn: true, url: "ws://csms.example:8080/ocpp/EVC1",
    apn: { proto: 2, apn: "cmiot", user: "", pass: "" },
    tz: -300,
    payModel: 2, fullW: 25,
  });
}

test("配置项：只有 M01 有的，M01 没有的那几项不在里面", () => {
  assert.deepEqual(SECTIONS.map((item) => item.key),
    ["safety", "plim", "pay", "ocfw", "tel", "netstop", "net", "ocpp", "apn", "tz", "par"]);
  /* 并充排在最后：它要重启才生效，别的项先写完。 */
  assert.equal(SECTIONS[SECTIONS.length - 1].key, "par");
  for (const gone of ["imax", "plug", "sched", "qr"]) {
    assert.ok(readPlan(gone).error, gone);
    assert.ok(writePlan(gone, blankBody()).error, gone);
    assert.equal(gone in blankBody(), false, gone);
  }
  const src = read("src/m01/profile.js");
  assert.ok(!/IMAXGET|IMAXSET|PLUGGET|PLUGSET|SCHEDGET|SCHEDSET|QRGET|QRSET/.test(src));
  assert.deepEqual(Object.keys(blankBody().safety), ["over", "under"]);
});

test("出厂状态的桩：各项全部读到，默认值和协议文档一致", () => {
  const { body, failed } = backup(makePile());
  assert.deepEqual(failed, []);
  assert.deepEqual(body.safety, { over: DEFAULT_OVER_V, under: DEFAULT_UNDER_V });
  assert.deepEqual(body.plim, Array(10).fill(800));
  assert.deepEqual(body.plimRange, { min: 50, max: 2000 });
  assert.deepEqual(body.wifi, { on: false, ssid: "", pass: "" });
  assert.deepEqual(body.ocpp, { on: false, url: "" });
  assert.deepEqual(body.apn, { proto: 0, apn: "", user: "", pass: "" });
  assert.equal(body.tz, 480);
  /* 收费模型 1（不退费）、充满门槛 10 W、不并充。 */
  assert.deepEqual(body.pay, { model: 1, fullW: 10, hold: 300 });
  assert.equal(body.par, 1);
});

test("配置过的桩：读到的和桩里一致", () => {
  const pile = makePile();
  configured(pile);
  const { body, failed } = backup(pile);
  assert.deepEqual(failed, []);
  assert.deepEqual(body.safety, { over: 260, under: 185 });
  assert.deepEqual(body.plim, [800, 1200, 400, 800, 2000, 50, 800, 800, 600, 1000]);
  assert.deepEqual(body.ocfw, { on: true, text: "V9.9.9" });
  assert.equal(body.tel, true);
  assert.deepEqual(body.netstop, { on: true, sec: 120 });
  assert.deepEqual(body.wifi, { on: true, ssid: "Shop_5G", pass: "p w,AP 1 ACK x" });
  assert.deepEqual(body.ocpp, { on: true, url: "ws://csms.example:8080/ocpp/EVC1" });
  assert.deepEqual(body.apn, { proto: 2, apn: "cmiot", user: "", pass: "" });
  assert.equal(body.tz, -300);
  assert.deepEqual(body.pay, { model: 2, fullW: 25, hold: 300 });
  assert.equal(body.par, 1);
});

test("平台地址：ws:// 和 wss:// 都收，大小写都行；别的 scheme、空白、太短太长不收", () => {
  for (const url of ["ws://abc", "ws://csms.example:8080/ocpp/EVC1", "wss://ab", "wss://csms.example/ocpp/EVC1",
    "wss://csms.example:443/ocpp/EVC1", "wss://csms.example:8443/x", "WSS://csms.example/x", "Wss://h/x", "WS://ab/x"]) {
    assert.equal(ocppUrlOk(url), true, url);
  }
  for (const url of ["", "ws://", "ws://h", "wss:/", "wss:/h/x", "wsss://h/x", "http://h/x", "https://h/x", "xwss://h/x",
    "wss://h/a b", " wss://h/x", "wss://h/x\n", "wss://h/a\tb", "wss://" + "a".repeat(122)]) {
    assert.equal(ocppUrlOk(url), false, JSON.stringify(url));
  }
  assert.equal(ocppUrlOk("wss://" + "a".repeat(121)), true);
  /* 一键配置：wss:// 的地址读得回来，也下发得出去。 */
  const pile = makePile();
  configured(pile);
  pile.st.url = "wss://csms.example/ocpp/EVC1";
  const { body, failed } = backup(pile);
  assert.deepEqual(failed, []);
  assert.deepEqual(body.ocpp, { on: true, url: "wss://csms.example/ocpp/EVC1" });
  const plan = writePlan("ocpp", { ocpp: { on: true, url: "WSS://csms.example:8443/ocpp/EVC1" } });
  assert.equal(plan.error, undefined);
  assert.equal(plan.list[0].command, "OCPPSET\tWSS://csms.example:8443/ocpp/EVC1");
  assert.match(writePlan("ocpp", { ocpp: { on: true, url: "https://csms.example/x" } }).error, /ws\(s\):\/\//);
});

test("还原：备份下发到另一台桩，每项读回一致，再备份一次内容相同", () => {
  const from = makePile();
  configured(from);
  const { body } = backup(from);
  const to = makePile();
  const out = restore(to, JSON.parse(JSON.stringify(body)));
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.skipped, []);
  const again = backup(to);
  assert.deepEqual(again.failed, []);
  assert.deepEqual(again.body, body);
  /* 存进手机再取出来（JSON）也还是这一份。 */
  assert.deepEqual(JSON.parse(JSON.stringify(again.body)), body);
});

test("功率上限：10 路各不相同时一路一条 PLIMSET；都一样时用端口 0 一条设完", () => {
  const body = blankBody();
  body.plim = [800, 1200, 400, 800, 2000, 50, 800, 800, 600, 1000];
  let plan = writePlan("plim", body);
  assert.deepEqual(plan.list.map((step) => step.command), body.plim.map((w, i) => "PLIMSET\t" + (i + 1) + "\t" + w));
  body.plim = Array(10).fill(600);
  plan = writePlan("plim", body);
  assert.deepEqual(plan.list.map((step) => step.command), ["PLIMSET\t0\t600"]);
  const pile = makePile();
  assert.deepEqual(restore(pile, Object.assign(backup(makePile()).body, { plim: Array(10).fill(600) })).failed, []);
  assert.deepEqual(pile.st.plim, Array(10).fill(600));
});

test("功率上限：应答只认自己那一路的 ACK PLIMSET，不把后面补的 ACK PLIM 当成它", () => {
  const body = blankBody();
  body.plim = [800, 1200, 400, 800, 2000, 50, 800, 800, 600, 1000];
  const step = writePlan("plim", body).list[1];
  assert.equal(step.accept("ACK PLIMSET\t2\tOK"), true);
  assert.equal(step.accept("ACK PLIMSET\t3\tOK"), false);
  assert.equal(step.accept("ACK PLIM\t10\t50\t2000\t800,1200,800,800,800,800,800,800,800,800"), false);
  assert.equal(step.ok("ACK PLIMSET\t2\tOK"), true);
  for (const [line, reason] of [["ACK PLIMSET\t2\tRANGE", "数值不在这台桩允许的范围内"],
    ["ACK PLIMSET\t2\tFLASH", "充电桩没有写进存储"], ["ACK PLIMSET\t2\tPORT", "充电桩没有接受"]]) {
    assert.equal(step.ok(line), false);
    assert.equal(step.reason(line), reason);
  }
  assert.equal(step.reason(null), "回复超时");
  /* 读的那一步反过来：只认 ACK PLIM。 */
  const get = readPlan("plim").list[0];
  assert.equal(get.accept("ACK PLIMSET\t2\tOK"), false);
  assert.equal(get.accept("ACK PLIM\t10\t50\t2000\t800,1200,800,800,800,800,800,800,800,800"), true);
});

test("功率上限：备份里的值超出这台桩的范围、或者桩写不进去，这一项如实报失败", () => {
  const body = backup(makePile()).body;
  body.plim = [800, 800, 800, 800, 800, 800, 800, 800, 800, 2500];
  let out = restore(makePile(), body);
  assert.deepEqual(out.failed, ["plim"]);
  assert.equal(out.reasons.plim, "数值不在这台桩允许的范围内");
  body.plim = Array(10).fill(900);
  out = restore(makePile({ flashFail: true }), body);
  assert.deepEqual(out.failed, ["plim"]);
  assert.equal(out.reasons.plim, "充电桩没有写进存储");
  /* 不是 10 个正整数的不下发。 */
  for (const bad of [[800], Array(10).fill(0), Array(10).fill("800"), Array(11).fill(800), Array(10).fill(80.5)]) {
    assert.ok(writePlan("plim", { plim: bad }).error, JSON.stringify(bad));
  }
});

test("还原：桩回了 OK 却没有真的存下来，读回核对能发现", () => {
  const from = makePile();
  configured(from);
  const { body } = backup(from);
  for (const [name, key] of [["CFGSET", "safety"], ["PLIMSET", "plim"], ["TZSET", "tz"]]) {
    const out = restore(makePile({ forget: [name] }), JSON.parse(JSON.stringify(body)));
    assert.deepEqual(out.failed, [key], name);
    assert.equal(out.reasons[key], "读回的值和写入的不一样");
  }
});

test("旧备份（没有功率上限、充电规则、APN、时区、并充）：这几项跳过，不算失败，别的照常下发", () => {
  const old = {
    safety: { over: 250, under: 190, ab: 10.5, bc: 7.5, cd: 4.5, ef: -6, earth: false, leak: false, earthMin: 150 },
    imax: 16, plug: true,
    sched: { tz: 480, mode: 2, hour: 7, minute: 30 }, qr: { on: true, text: "x" },
    ocfw: { on: false, text: "" }, tel: false, netstop: { on: false, sec: 60 },
    wifi: { on: false, ssid: "", pass: "" }, ocpp: { on: false, url: "" },
  };
  const pile = makePile();
  const out = restore(pile, old);
  assert.deepEqual(out.skipped, ["plim", "pay", "apn", "tz", "par"]);
  assert.equal(out.rebooted, false);
  assert.ok(!pile.sent.some((cmd) => /^(PAYSET|PARSET|REBOOT)/.test(cmd)));
  assert.deepEqual(out.failed, []);
  assert.equal(pile.st.over, 250);
  assert.equal(pile.st.under, 190);
  assert.ok(!pile.sent.some((cmd) => cmd.indexOf("CARDSET") === 0));
  assert.deepEqual(pile.st.plim, Array(10).fill(800));
  /* M01 没有的命令一条都没发。 */
  assert.ok(!pile.sent.some((cmd) => /^(IMAX|PLUG|SCHED|QR)/.test(cmd)));
  /* CFGSET 只带过压、欠压两个数。 */
  assert.ok(pile.sent.includes("CFGSET\t250\t190"));
});

test("跳过的条件：只有下发时、备份里没有这一项", () => {
  const byKey = (key) => SECTIONS.find((item) => item.key === key);
  for (const section of SECTIONS) assert.equal(sectionSkip(section, "read", blankBody()), "", section.key);
  const full = backup(makePile()).body;
  for (const section of SECTIONS) assert.equal(sectionSkip(section, "write", full), "", section.key);
  assert.equal(sectionSkip(byKey("plim"), "write", blankBody()), "这份配置里没有这一项");
  assert.equal(sectionSkip(byKey("tz"), "write", blankBody()), "这份配置里没有这一项");
  assert.equal(sectionSkip(byKey("apn"), "write", blankBody()), "这份配置里没有这一项");
  assert.equal(sectionSkip(byKey("pay"), "write", blankBody()), "这份配置里没有这一项");
  assert.equal(sectionSkip(byKey("par"), "write", blankBody()), "这份配置里没有这一项");
  assert.equal(sectionSkip(byKey("safety"), "write", {}), "");
  /* 功率上限：备份的端口数和桩现在的不一样时跳过；一样、或者不知道桩有几路（旧固件）时不跳。 */
  assert.equal(sectionSkip(byKey("plim"), "write", full, 10), "");
  assert.equal(sectionSkip(byKey("plim"), "write", full, null), "");
  assert.equal(sectionSkip(byKey("plim"), "write", full, 5), "这份配置的端口数和充电桩现在的不一样");
});

test("充电规则：收费模型和充满门槛一条 PAYSET 写下去，读回核对；桩不接受时如实报失败", () => {
  const body = blankBody();
  body.pay = { model: 2, fullW: 25 };
  const plan = writePlan("pay", body);
  assert.deepEqual(plan.list.map((step) => step.command), ["PAYSET\t2\t25"]);
  const step = plan.list[0];
  assert.equal(step.accept("ACK PAYSET OK"), true);
  assert.equal(step.accept("ACK PAY\t0\t2\t25\t1\t100\t300\t-"), false);
  assert.equal(step.ok("ACK PAYSET OK"), true);
  assert.equal(step.ok("ACK PAYSET FAIL"), false);
  assert.equal(step.reason("ACK PAYSET FAIL"), "数值不在这台桩允许的范围内");
  assert.equal(step.reason(null), "回复超时");
  /* 读的那一步只认 ACK PAY，不把 ACK PAYSET、ACK PAR 当成它。 */
  const get = readPlan("pay").list[0];
  assert.equal(get.command, "PAYGET");
  assert.equal(get.accept("ACK PAYSET OK"), false);
  assert.equal(get.accept("ACK PAR\t1\t10\t1"), false);
  const got = blankBody();
  assert.ok(get.accept("ACK PAY\t3\t2\t25\t1\t100\t300\tA0A1A2A3A4A5A6A7A8A9AAABACADAEAF") &&
    get.ok("ACK PAY\t3\t2\t25\t1\t100\t300\tA0A1A2A3A4A5A6A7A8A9AAABACADAEAF", got));
  /* 拨码和运营商不在备份里：它们不能靠 App 改。 */
  assert.deepEqual(got.pay, { model: 2, fullW: 25, hold: 300 });
  assert.equal(sameSection("pay", body, got), true);
  assert.equal(sameSection("pay", { pay: { model: 1, fullW: 25 } }, got), false);
  assert.equal(sameSection("pay", { pay: { model: 2, fullW: 30 } }, got), false);
  /* 下发到出厂状态的桩。 */
  const pile = makePile();
  const full = Object.assign(backup(makePile()).body, { pay: { model: 2, fullW: 25 } });
  assert.deepEqual(restore(pile, full).failed, []);
  assert.equal(pile.st.payModel, 2);
  assert.equal(pile.st.fullW, 25);
  /* 门槛超出桩的范围（1–100 W）：桩回 FAIL。回了 OK 却没存：读回发现。 */
  let out = restore(makePile(), Object.assign(backup(makePile()).body, { pay: { model: 1, fullW: 500 } }));
  assert.deepEqual(out.failed, ["pay"]);
  assert.equal(out.reasons.pay, "数值不在这台桩允许的范围内");
  out = restore(makePile({ forget: ["PAYSET"] }), full);
  assert.deepEqual(out.failed, ["pay"]);
  assert.equal(out.reasons.pay, "读回的值和写入的不一样");
  /* 不合法的备份不下发。 */
  for (const bad of [{ model: 3, fullW: 10 }, { model: 1, fullW: 0 }, { model: 1, fullW: 2.5 }, { model: "1", fullW: 10 }]) {
    assert.ok(writePlan("pay", { pay: bad }).error, JSON.stringify(bad));
  }
});

test("并充：只保存不重启（PARSET 第二个参数 0），读回核对，全部写完以后才重启", () => {
  const body = blankBody();
  body.par = 2;
  const plan = writePlan("par", body);
  assert.deepEqual(plan.list.map((step) => step.command), ["PARSET\t2\t0"]);
  const step = plan.list[0];
  assert.equal(step.accept("ACK PARSET OK"), true);
  assert.equal(step.accept("ACK PAR\t1\t10\t2"), false);
  assert.equal(step.ok("ACK PARSET BUSY"), false);
  assert.equal(step.reason("ACK PARSET BUSY"), "有端口正在充电，不能切换");
  assert.equal(step.reason("ACK PARSET FAIL"), "充电桩没有接受");
  assert.equal(step.reason(null), "回复超时");
  for (const bad of [0, 4, 6, "2", null, 2.5]) assert.ok(writePlan("par", { par: bad }).error, String(bad));
  /* 备份的是保存的模式，不是这次运行的。 */
  const got = blankBody();
  const get = readPlan("par").list[0];
  assert.ok(get.accept("ACK PAR\t1\t10\t3") && get.ok("ACK PAR\t1\t10\t3", got));
  assert.equal(got.par, 3);
  assert.equal(get.accept("ACK PARSET OK"), false);
  /* 要不要重启、现在有几路。 */
  assert.equal(profileWantsReboot("ACK PAR\t1\t10\t2"), true);
  assert.equal(profileWantsReboot("ACK PAR\t2\t5\t2"), false);
  assert.equal(profileWantsReboot(null), false);
  assert.equal(profilePorts("ACK PAR\t2\t5\t2"), 5);
  assert.equal(profilePorts(null), null);

  /* 整份下发：并充是最后一项；写的时候桩不重启，别的项都核对完了才发 REBOOT。 */
  const pile = makePile();
  const full = Object.assign(backup(makePile()).body, { par: 2, tz: -300 });
  const out = restore(pile, JSON.parse(JSON.stringify(full)));
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.skipped, []);
  assert.equal(out.rebooted, true);
  assert.equal(pile.st.reboots, 1);
  assert.equal(pile.st.mode, 2);
  assert.equal(pile.st.tz, -300);
  const parAt = pile.sent.indexOf("PARSET\t2\t0");
  const rebootAt = pile.sent.indexOf("REBOOT");
  assert.ok(parAt > pile.sent.indexOf("TZSET\t-300") && rebootAt > parAt);
  assert.equal(rebootAt, pile.sent.length - 1);
  /* 模式没变：不重启。 */
  const same = makePile();
  assert.equal(restore(same, backup(makePile()).body).rebooted, false);
  assert.equal(same.st.reboots, 0);
  /* 有端口在充：这一项失败，不重启，别的项照常写上。 */
  const busy = makePile();
  busy.st.busy = true;
  const res = restore(busy, JSON.parse(JSON.stringify(full)));
  assert.deepEqual(res.failed, ["par"]);
  assert.equal(res.reasons.par, "有端口正在充电，不能切换");
  assert.equal(res.rebooted, false);
  assert.equal(busy.st.tz, -300);
});

test("并充中的桩：端口数是 5，功率上限按 5 路备份；下发到 10 路的桩时功率上限跳过，重启后再下发就对上", () => {
  const from = makePile();
  from.st.saved = 2;
  from.reboot();
  assert.equal(from.st.mode, 2);
  from.st.plim = [1600, 1600, 1200, 1600, 3000];
  const { body, failed } = backup(from);
  assert.deepEqual(failed, []);
  assert.deepEqual(body.plim, [1600, 1600, 1200, 1600, 3000]);
  assert.equal(body.par, 2);
  /* 第一次下发：桩还是 10 路，功率上限跳过；并充写上，桩重启成 5 路。 */
  const to = makePile();
  let out = restore(to, JSON.parse(JSON.stringify(body)));
  assert.deepEqual(out.skipped, ["plim"]);
  assert.deepEqual(out.failed, []);
  assert.equal(out.rebooted, true);
  assert.equal(to.st.mode, 2);
  /* 第二次下发：端口数对上了，功率上限写上，不再重启。 */
  out = restore(to, JSON.parse(JSON.stringify(body)));
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.failed, []);
  assert.equal(out.rebooted, false);
  assert.deepEqual(to.st.plim, [1600, 1600, 1200, 1600, 3000]);
  assert.deepEqual(backup(to).body, body);
  /* 端口数不是 10 / 5 / 3 / 2 的上限表不认。 */
  for (const n of [1, 4, 6, 11]) assert.ok(writePlan("plim", { plim: Array(n).fill(800) }).error, String(n));
  for (const n of [10, 5, 3, 2]) assert.ok(writePlan("plim", { plim: Array(n).fill(800) }).list, String(n));
});

test("WPASSGET 的十六进制", () => {
  assert.equal(hexToText("7020772c31"), "p w,1");
  assert.equal(hexToText(""), "");
  assert.equal(hexToText("7"), null);
  assert.equal(hexToText("zz"), null);
  assert.equal(hexToText("ff"), null);
  const step = readPlan("net").list[2];
  assert.equal(step.command, "WPASSGET");
  const body = blankBody();
  body.wifi.ssid = "bench";
  assert.ok(step.accept("ACK WPASSGET 7020772c31") && step.ok("ACK WPASSGET 7020772c31", body));
  assert.equal(body.wifi.pass, "p w,1");
  assert.ok(step.ok("ACK WPASSGET -", body));
  assert.equal(body.wifi.pass, "");
  assert.equal(step.accept("WPASS\tabc"), false);
});

test("网络设置：先 WSAVE 再 WIFISWSET；没有热点名时不发 WSAVE，也不比热点", () => {
  const body = blankBody();
  body.wifi = { on: true, ssid: "Shop 5G", pass: "p w" };
  assert.deepEqual(writePlan("net", body).list.map((step) => step.command), ["WSAVE\tShop 5G\tp w", "WIFISWSET\t1"]);
  body.wifi = { on: false, ssid: "", pass: "" };
  assert.deepEqual(writePlan("net", body).list.map((step) => step.command), ["WIFISWSET\t0"]);
  const got = blankBody();
  got.wifi = { on: false, ssid: "old", pass: "x" };
  assert.ok(sameSection("net", body, got));
  assert.ok(writePlan("net", { wifi: { on: true, ssid: "", pass: "x" } }).error);
  assert.ok(writePlan("net", { wifi: { on: true, ssid: "a".repeat(33), pass: "" } }).error);
});

test("关 WiFi 时桩连带关 OCPP，补的 OCPPSW 行不会被当成 WIFISWSET 的应答", () => {
  const pile = makePile();
  configured(pile);
  const body = backup(pile).body;
  body.wifi.on = false;
  body.ocpp.on = false;
  const out = restore(pile, body);
  assert.deepEqual(out.failed, []);
  assert.equal(pile.st.wifiOn, false);
  assert.equal(pile.st.ocppOn, false);
  const step = writePlan("net", body).list[1];
  assert.equal(step.accept("OCPPSW 0"), false);
  assert.equal(step.accept("ACK WIFISWSET OK"), true);
  assert.equal(step.ok("ACK WIFISWSET FAIL"), false);
});

test("过压、欠压默认值和 CFG 行的格式", () => {
  assert.equal(DEFAULT_OVER_V, 253);
  assert.equal(DEFAULT_UNDER_V, 207);
  const step = readPlan("safety").list[0];
  const body = blankBody();
  assert.ok(step.accept("CFG 253 207") && step.ok("CFG 253 207", body));
  assert.deepEqual(body.safety, { over: 253, under: 207 });
  /* 以后在行尾加字段不影响。 */
  assert.ok(step.ok("CFG 260 185 1 2", body));
  assert.deepEqual(body.safety, { over: 260, under: 185 });
  for (const bad of ["CFG 253", "CFG a b", "CFG 200 207", "CFG 330 207", "CFG 253 90"]) {
    assert.equal(step.ok(bad, blankBody()), false, bad);
  }
  assert.equal(step.accept("WCFG UP bench"), false);
  assert.equal(step.accept("ACK CFGSET OK"), false);
  /* 下发：只有两个整数。 */
  assert.equal(writePlan("safety", { safety: { over: 259.6, under: 184.5 } }).list[0].command, "CFGSET\t260\t185");
});

test("过压、欠压的范围校验和固件一致", () => {
  assert.equal(voltageLimitError(253, 207), "");
  assert.equal(voltageLimitError("320", "100"), "");
  assert.equal(voltageLimitError(110, 100), "");
  assert.equal(voltageLimitError("", 207), "请把过压和欠压填成数字");
  assert.equal(voltageLimitError("abc", 207), "请把过压和欠压填成数字");
  assert.equal(voltageLimitError(200, 207), "没有保存。过压必须大于欠压");
  assert.equal(voltageLimitError(253, 99), "没有保存。欠压不能低于 100 V");
  assert.equal(voltageLimitError(321, 207), "没有保存。过压不能超过 320 V");
  assert.equal(voltageLimitError(215, 207), "没有保存。过压至少要比欠压高 10 V");
  assert.ok(writePlan("safety", { safety: { over: 321, under: 207 } }).error);
  /* 桩也是同一条规则：越界的回 FAIL。 */
  const pile = makePile();
  assert.deepEqual(pile.answer("CFGSET\t321\t207"), ["ACK CFGSET FAIL"]);
  assert.deepEqual(pile.answer("CFGSET\t215\t207"), ["ACK CFGSET FAIL"]);
  assert.deepEqual(pile.answer("CFGSET\t260\t185"), ["ACK CFGSET OK"]);
});

test("时区：TZSET 一条，读回 ACK TZ；不把 ACK TZSET、ACK TIME 当成读数", () => {
  const body = blankBody();
  body.tz = -570;
  assert.deepEqual(writePlan("tz", body).list.map((step) => step.command), ["TZSET\t-570"]);
  const get = readPlan("tz").list[0];
  assert.equal(get.command, "TZGET");
  assert.equal(get.accept("ACK TZ 480"), true);
  assert.equal(get.accept("ACK TZSET OK"), false);
  assert.equal(get.accept("ACK TIME 1800000100 -300"), false);
  const got = blankBody();
  assert.ok(get.ok("ACK TZ -570", got));
  assert.ok(sameSection("tz", body, got));
  assert.equal(get.ok("ACK TZ 900", blankBody()), false);
  for (const bad of [null, 900, 8.5, "480"]) assert.ok(writePlan("tz", { tz: bad }).error, String(bad));
});

test("设置命令的应答：只有 OK 算成功", () => {
  const step = writePlan("tel", { tel: true }).list[0];
  assert.equal(step.command, "TELSET\t1");
  assert.equal(step.ok("ACK TELSET OK"), true);
  assert.equal(step.ok("ACK TELSET FAIL"), false);
  assert.equal(step.accept("TEL 1"), false);
  assert.equal(step.accept("ACK LTE 0"), false);
  assert.equal(step.reason("ACK TELSET FAIL"), "充电桩没有接受");
  assert.equal(step.reason(null), "回复超时");
});

test("App.vue：一键配置读写期间心跳不带时间；每一项的名字和失败原因各语言的表里都有", () => {
  const vue = read("src/m01/M01App.vue");
  assert.match(vue, /const heartbeatTimed = computed\(\(\) =>\s*linkReady\.value && gateState\.value === "ok" && !otaBusy\.value && page\.value !== "profileRun"\);/);
  assert.match(vue, /await ask\(command, accept, PROFILE_ASK_MS, \{ consume: true \}\)/);
  const keys = SECTIONS.map((item) => item.name).concat(["回复超时", "充电桩没有接受", "数值不在这台桩允许的范围内",
    "充电桩没有写进存储", "这份配置里没有这一项", "读回的值和写入的不一样", "回复内容不能用", "写入后读回核对超时",
    "保护参数不能用"]);
  for (const key of keys) {
    for (const item of languages) {
      if (item.id === "zh") continue;
      /* "4G APN" 各语言都不翻。 */
      if (key === "4G APN") continue;
      const out = translate(item.id, key);
      assert.ok(out && out !== key, item.id + " 没有翻译: " + key);
    }
  }
  /* M01 新加的这几句每种语言的表里都要有，不能靠回退到英文。 */
  for (const key of ["过压欠压保护", "功率上限", "数值不在这台桩允许的范围内", "充电桩没有写进存储"]) {
    for (const item of languages) {
      if (item.id !== "zh") assert.ok(hasKey(item.id, key), item.id + " 的表里没有: " + key);
    }
  }
});
