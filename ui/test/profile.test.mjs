/* 一键配置（配置备份 / 还原）的主机测试。不需要手机和桩：
 *
 *     node --test AC06/tools/ble-finder/ui/test/
 *
 * 这里有一台假桩，按固件 wb2.c 的格式应答；中间隔着一层和 MainActivity.knownLine
 * 一样的行首过滤。读取和下发走的是 App 真正用的 readPlan / writePlan / sameSection。 */
import test from "node:test";
import assert from "node:assert/strict";
import { CARD_SLOTS, DEFAULT_OVER_V, DEFAULT_UNDER_V, SECTIONS, blankBody, cardSlotsFor, hexToText, normalCards, ocppUrlOk, readPlan, sameSection, sectionSkip, splitCardLine, voltageLimitError, writePlan } from "../src/profile.js";

/* MainActivity.knownLine。old = 2.5.4 安装包里的那张表（没有 PLUG、WPASS）。 */
function knownLine(line, old) {
  const heads = ["STAT ", "WCFG ", "FLT ", "LIVE ", "ACK ", "AP ", "OCPP ", "CFG ", "IMAX ", "SCHED ",
    "ORD ", "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "CARD\t", "QR ", "PHASE ", "OCFW "];
  if (line === "APDONE" || line === "ORDDONE" || line === "CARD") return true;
  if (heads.some((head) => line.startsWith(head))) return true;
  if (old) return false;
  return line.startsWith("PLUG ") || line.startsWith("WPASS\t") || line === "WPASS";
}

function toHex(text) {
  return [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* 假桩。fw = "2.6.0" 或 "2.5.6"：PLUGGET 和 WPASSGET 的应答格式不同；没存过保护设置时
 * 过压、欠压 2.6.0 回 253 / 207，2.5.6 回 250 / 190。 */
/* slots：本地 IC 卡格数。2.6.3 及更早 5 格（默认），2.6.4 起 10 格。 */
function makePile(fw, slots = 5) {
  const st = {
    over: fw === "2.6.0" ? 253 : 250, under: fw === "2.6.0" ? 207 : 190, cp: [10.5, 7.5, 4.5, -6], earth: false, leak: false, earthMin: 150,
    imax: 32, plug: false, cards: Array(slots).fill(""),
    sched: { tz: 480, mode: 0, hour: 8, minute: 0 }, qr: { on: false, text: "" },
    ocfw: { on: false, text: "" }, tel: false, netstop: { on: false, sec: 60 },
    wifiOn: false, ssid: "", pass: "", ocppOn: false, url: "",
  };
  const flagText = (rest) => {
    const tab = rest.indexOf("\t");
    return tab < 0 ? [rest, ""] : [rest.slice(0, tab), rest.slice(tab + 1)];
  };
  function answer(cmd) {
    const tab = cmd.indexOf("\t");
    const name = tab < 0 ? cmd : cmd.slice(0, tab);
    const arg = tab < 0 ? "" : cmd.slice(tab + 1);
    switch (name) {
      case "CFGGET":
        return ["CFG " + st.over.toFixed(0) + " " + st.under.toFixed(0) + " " + st.cp.map((v) => v.toFixed(2)).join(" ") +
          " " + (st.earth ? 1 : 0) + " " + (st.leak ? 1 : 0) + " 0 " + st.earthMin.toFixed(0)];
      case "CFGSET": {
        const part = arg.split("\t").map(Number);
        /* 固件 grid_limits_valid 的规则。 */
        if (!(part[1] >= 100 && part[0] <= 320 && part[1] + 10 <= part[0])) return ["ACK CFGSET FAIL"];
        [st.over, st.under] = part;
        st.cp = part.slice(2, 6);
        st.earth = part[6] === 1;
        st.leak = part[7] === 1;
        st.earthMin = part[8];
        return ["ACK CFGSET OK"];
      }
      case "IMAXGET": return ["IMAX " + st.imax];
      case "IMAXSET": st.imax = Number(arg); return ["ACK IMAXSET OK"];
      case "PLUGGET":
        return [fw === "2.6.0" ? "ACK PLUGGET " + (st.plug ? 1 : 0) : "PLUG " + (st.plug ? 1 : 0)];
      case "PLUGSET": st.plug = arg === "1"; return ["ACK PLUGSET OK"];
      case "CARDGET": return ["CARD\t" + st.cards.join("\t")];
      case "CARDSET": {
        /* 固件：格子号只认 1..格数，卡号最长 10 个可见字符。旧固件只认一位数字 1–5。 */
        const [index, card] = flagText(arg);
        if (!/^\d{1,2}$/.test(index) || Number(index) < 1 || Number(index) > slots ||
            card.length > 10 || /[^\x21-\x7E]/.test(card)) return ["ACK CARDSET FAIL"];
        st.cards[Number(index) - 1] = card;
        return ["ACK CARDSET OK"];
      }
      case "SCHEDGET":
        return ["SCHED 1 " + st.sched.tz + " " + st.sched.mode + " " + st.sched.hour + " " + st.sched.minute + " 0"];
      case "SCHEDSET": {
        const part = arg.split("\t").map(Number);
        st.sched = { tz: part[0], mode: part[1], hour: part[2], minute: part[3] };
        return ["ACK SCHEDSET OK"];
      }
      case "QRGET": return ["QR " + (st.qr.on ? 1 : 0) + "\t" + st.qr.text];
      case "QRSET": { const [on, text] = flagText(arg); st.qr = { on: on === "1", text }; return ["ACK QRSET OK"]; }
      case "OCFWGET": return ["OCFW " + (st.ocfw.on ? 1 : 0) + "\t" + st.ocfw.text];
      case "OCFWSET": { const [on, text] = flagText(arg); st.ocfw = { on: on === "1", text }; return ["ACK OCFWSET OK"]; }
      case "TELGET": return ["TEL " + (st.tel ? 1 : 0)];
      case "TELSET": st.tel = arg === "1"; return ["ACK TELSET OK"];
      case "NETSTOPGET": return ["NETSTOP " + (st.netstop.on ? 1 : 0) + " " + st.netstop.sec];
      case "NETSTOPSET": {
        const [on, sec] = flagText(arg);
        st.netstop = { on: on === "1", sec: Number(sec) };
        return ["ACK NETSTOPSET OK"];
      }
      case "WIFISWGET": return ["WIFISW " + (st.wifiOn ? 1 : 0)];
      case "WIFISWSET":
        st.wifiOn = arg === "1";
        if (!st.wifiOn) st.ocppOn = false;
        return ["ACK WIFISWSET OK", "OCPPSW " + (st.ocppOn ? 1 : 0)];
      case "WCFGGET": return ["WCFG DOWN " + (st.ssid || "-")];
      case "WSAVE": { const [ssid, pass] = flagText(arg); st.ssid = ssid; st.pass = pass; return ["ACK WSAVE OK"]; }
      case "WPASSGET":
        if (fw === "2.6.0") return ["ACK WPASSGET " + (st.pass ? toHex(st.pass) : "-")];
        return ["WPASS\t" + st.pass];
      case "OCPPSWGET": return ["OCPPSW " + (st.ocppOn ? 1 : 0)];
      case "OCPPSWSET": st.ocppOn = arg === "1"; return ["ACK OCPPSWSET OK"];
      case "OCPPGET": return ["OCPP " + (st.url || "-")];
      case "OCPPSET": st.url = arg; return ["ACK OCPPSET OK"];
      default: return [];
    }
  }
  return { st, answer, slots, fw };
}

/* App 的 askLine：发一条，在通过了蓝牙层过滤的行里找第一条 accept 认的。没有就是超时。 */
function ask(pile, step, oldApp) {
  /* MainActivity 把每行两头的空格和制表符去掉再交给界面：行尾的空卡字段到不了这里。 */
  const lines = pile.answer(step.command).map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .filter((line) => knownLine(line, oldApp));
  return lines.find((line) => step.accept(line)) || null;
}

/* runProfileJob 的读取。返回 { body, failed: [没读到的项] }。 */
function backup(pile, oldApp) {
  const body = blankBody();
  const failed = [];
  for (const section of SECTIONS) {
    /* App 的 runProfileJob：桩的固件不认识的项（4G APN，2.6.16 起）跳过，不算没读到。 */
    if (sectionSkip(section, "read", pile.fw, body)) continue;
    const plan = readPlan(section.key);
    let ok = !!plan.list;
    for (const step of plan.list || []) {
      const line = ask(pile, step, oldApp);
      if (!line || !step.ok(line, body)) { ok = false; break; }
    }
    if (!ok) failed.push(section.key);
  }
  return { body, failed };
}

/* runProfileJob 的下发：每项写完读回来比。 */
function restore(pile, body, opts) {
  const failed = [];
  for (const section of SECTIONS) {
    if (sectionSkip(section, "write", pile.fw, body)) continue;
    /* App 按桩上报的固件版本给 cardSlots；这里直接用假桩的格数。 */
    const plan = writePlan(section.key, body, opts || { cardSlots: pile.slots });
    let ok = !!plan.list;
    for (const step of plan.list || []) {
      const line = ask(pile, step, false);
      if (!line || !step.ok(line, body)) { ok = false; break; }
    }
    if (ok) {
      const got = blankBody();
      for (const step of readPlan(section.key).list) {
        const line = ask(pile, step, false);
        if (!line || !step.ok(line, got)) { ok = false; break; }
      }
      ok = ok && sameSection(section.key, body, got);
    }
    if (!ok) failed.push(section.key);
  }
  return failed;
}

function configured(pile) {
  Object.assign(pile.st, {
    over: 260, under: 185, cp: [10.4, 7.6, 4.4, -5.5], earth: true, leak: false, earthMin: 120,
    imax: 16, plug: true, cards: ["A1B2C3D4", "", "0123456789", "", ""],
    sched: { tz: -300, mode: 2, hour: 23, minute: 30 }, qr: { on: true, text: "https://example.com/p?id=1 2" },
    ocfw: { on: true, text: "V9.9.9" }, tel: true, netstop: { on: true, sec: 120 },
    wifiOn: true, ssid: "Shop 5G", pass: "p w,AP 1 ACK x", ocppOn: true, url: "ws://csms.example:8080/ocpp/EVC1",
  });
}

test("根因：2.5.4 的蓝牙层丢掉 PLUG 和 WPASS，这两项读取超时", () => {
  const pile = makePile("2.5.6");
  configured(pile);
  const { failed } = backup(pile, true);
  assert.deepEqual(failed, ["plug", "net"]);
});

test("新 App + 2.6.0 固件：11 项全部读到，内容和桩里一致", () => {
  const pile = makePile("2.6.0");
  configured(pile);
  const { body, failed } = backup(pile, false);
  assert.deepEqual(failed, []);
  assert.equal(body.plug, true);
  assert.deepEqual(body.wifi, { on: true, ssid: "Shop 5G", pass: "p w,AP 1 ACK x" });
  assert.equal(body.imax, 16);
  assert.equal(body.safety.over, 260);
  assert.deepEqual(body.ocpp, { on: true, url: "ws://csms.example:8080/ocpp/EVC1" });
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
  const pile = makePile("2.6.0");
  configured(pile);
  pile.st.url = "wss://csms.example/ocpp/EVC1";
  const { body, failed } = backup(pile, false);
  assert.deepEqual(failed, []);
  assert.deepEqual(body.ocpp, { on: true, url: "wss://csms.example/ocpp/EVC1" });
  const plan = writePlan("ocpp", { ocpp: { on: true, url: "WSS://csms.example:8443/ocpp/EVC1" } });
  assert.equal(plan.error, undefined);
  assert.equal(plan.list[0].command, "OCPPSET\tWSS://csms.example:8443/ocpp/EVC1");
  assert.match(writePlan("ocpp", { ocpp: { on: true, url: "https://csms.example/x" } }).error, /ws\(s\):\/\//);
});

test("旧 App + 2.6.0 固件：应答是 ACK 开头，旧蓝牙层也放行", () => {
  const pile = makePile("2.6.0");
  configured(pile);
  for (const cmd of ["PLUGGET", "WPASSGET"]) {
    for (const line of pile.answer(cmd)) assert.ok(knownLine(line, true), line);
  }
});

test("新 App + 2.5.x 固件：旧格式的应答也读得到", () => {
  const pile = makePile("2.5.6");
  configured(pile);
  const { body, failed } = backup(pile, false);
  assert.deepEqual(failed, []);
  assert.equal(body.plug, true);
  assert.equal(body.wifi.pass, "p w,AP 1 ACK x");
});

test("出厂状态的桩（没有热点、没有密码、没有地址）也能备份", () => {
  for (const fw of ["2.6.0", "2.5.6"]) {
    const { body, failed } = backup(makePile(fw), false);
    assert.deepEqual(failed, [], fw);
    assert.deepEqual(body.wifi, { on: false, ssid: "", pass: "" });
    assert.equal(body.plug, false);
  }
});

test("还原：备份下发到另一台桩，每项读回一致，再备份一次内容相同", () => {
  for (const fw of ["2.6.0", "2.5.6"]) {
    const source = makePile("2.6.0");
    configured(source);
    const saved = backup(source, false).body;
    const target = makePile(fw);
    assert.deepEqual(restore(target, JSON.parse(JSON.stringify(saved))), [], fw);
    assert.deepEqual(backup(target, false).body, saved, fw);
  }
});

test("还原：桩没有真的存下来时，读回核对能发现", () => {
  const source = makePile("2.6.0");
  configured(source);
  const saved = backup(source, false).body;
  const target = makePile("2.6.0");
  const real = target.answer;
  /* 这台桩回 OK 但不保存即插即充和热点。 */
  target.answer = (cmd) => (cmd.startsWith("PLUGSET\t") ? ["ACK PLUGSET OK"]
    : cmd.startsWith("WSAVE\t") ? ["ACK WSAVE OK"] : real(cmd));
  assert.deepEqual(restore(target, saved), ["plug", "net"]);
});

test("WPASSGET 的十六进制", () => {
  assert.equal(hexToText("7020772c31"), "p w,1");
  assert.equal(hexToText(toHex("密码 1")), "密码 1");
  assert.equal(hexToText("7"), null);
  assert.equal(hexToText("zz"), null);
  const step = readPlan("net").list[2];
  const body = blankBody();
  assert.ok(step.accept("ACK WPASSGET -") && step.ok("ACK WPASSGET -", body));
  assert.equal(body.wifi.pass, "");
  assert.ok(!step.ok("ACK WPASSGET 7", body));
  assert.ok(!step.accept("ACK WSAVE OK"));
});

test("PLUGGET 的应答只认 0 和 1，不把 PLUGSET 的应答当成它", () => {
  const step = readPlan("plug").list[0];
  const body = blankBody();
  assert.ok(step.accept("ACK PLUGGET 1") && step.ok("ACK PLUGGET 1", body) && body.plug === true);
  assert.ok(step.accept("PLUG 0") && step.ok("PLUG 0", body) && body.plug === false);
  assert.ok(!step.accept("ACK PLUGSET OK"));
  assert.ok(!step.ok("ACK PLUGGET 2", body));
});

test("过压、欠压默认值：没存过的 2.6.0 桩读到 253 和 207", () => {
  assert.equal(DEFAULT_OVER_V, 253);
  assert.equal(DEFAULT_UNDER_V, 207);
  const { body, failed } = backup(makePile("2.6.0"), false);
  assert.deepEqual(failed, []);
  assert.equal(body.safety.over, 253);
  assert.equal(body.safety.under, 207);
});

test("过压、欠压的范围校验和固件一致", () => {
  const ok = [[253, 207], [250, 190], [320, 100], [217, 207], [110, 100], ["260", " 200 "], [252.6, 206.6]];
  for (const [o, u] of ok) assert.equal(voltageLimitError(o, u), "", o + "/" + u);
  assert.equal(voltageLimitError(207, 253), "没有保存。过压必须大于欠压");
  assert.equal(voltageLimitError(230, 230), "没有保存。过压必须大于欠压");
  assert.equal(voltageLimitError(253, 99), "没有保存。欠压不能低于 100 V");
  assert.equal(voltageLimitError(321, 207), "没有保存。过压不能超过 320 V");
  assert.equal(voltageLimitError(216, 207), "没有保存。过压至少要比欠压高 10 V");
  for (const bad of [["", 207], [253, ""], ["abc", 207], [253, null], [undefined, 207], [NaN, 207], [Infinity, 207]]) {
    assert.equal(voltageLimitError(bad[0], bad[1]), "请把过压和欠压填成数字");
  }
  /* App 放行的，桩都收；App 拦下的，桩也不收。 */
  for (let o = 95; o <= 325; o += 1) {
    for (let u = 95; u <= 325; u += 5) {
      const pile = makePile("2.6.0");
      const body = blankBody();
      body.safety = { over: o, under: u, ab: 10.5, bc: 7.5, cd: 4.5, ef: -6, earth: false, leak: false, earthMin: 150 };
      const plan = writePlan("safety", body);
      if (voltageLimitError(o, u) === "") {
        assert.ok(plan.list, o + "/" + u);
        assert.equal(pile.answer(plan.list[0].command)[0], "ACK CFGSET OK", o + "/" + u);
      } else {
        assert.ok(plan.error, o + "/" + u);
        assert.equal(pile.answer("CFGSET\t" + o + "\t" + u + "\t10.5\t7.5\t4.5\t-6\t0\t0\t150")[0], "ACK CFGSET FAIL");
      }
    }
  }
});

test("过压、欠压改了以后：备份里是改后的值，还原到另一台桩后读回一致", () => {
  const a = makePile("2.6.0");
  a.st.over = 265;
  a.st.under = 195;
  const { body, failed } = backup(a, false);
  assert.deepEqual(failed, []);
  assert.equal(body.safety.over, 265);
  assert.equal(body.safety.under, 195);
  const b = makePile("2.6.0");
  assert.deepEqual(restore(b, body), []);
  assert.equal(b.st.over, 265);
  assert.equal(b.st.under, 195);
});

test("旧桩存的 250 / 190 原样备份；这份旧备份还原到 2.6.0 的桩上按 250 / 190 存", () => {
  const old = makePile("2.5.6");
  const { body, failed } = backup(old, false);
  assert.deepEqual(failed, []);
  assert.equal(body.safety.over, 250);
  assert.equal(body.safety.under, 190);
  const b = makePile("2.6.0");
  assert.deepEqual(restore(b, body), []);
  assert.equal(b.st.over, 250);
  assert.equal(b.st.under, 190);
});

test("CFG 行最后多出一个数（2.6.0 早先的版本）不影响保护参数的解析", () => {
  const step = readPlan("safety").list[0];
  const body = blankBody();
  assert.ok(step.ok("CFG 250 190 10.50 7.50 4.50 -6.00 0 1 0 150 253.0", body));
  assert.equal(body.safety.over, 250);
  assert.equal(body.safety.earthMin, 150);
  assert.equal(body.safety.leak, true);
});

/* ---------------------------------------------------------------- 本地 IC 卡 10 格（2.6.4） */
const TEN = ["A1B2C3D4", "0123456789", "C3", "", "E5", "F6", "", "H8", "I9", "J10~!@#$%^"];

test("固件版本对应的卡格数：2.6.4 起 10 格", () => {
  assert.equal(cardSlotsFor("2.6.4"), 10);
  assert.equal(cardSlotsFor("V2.6.4"), 10);
  assert.equal(cardSlotsFor("2.6.10"), 10);
  assert.equal(cardSlotsFor("2.7.0"), 10);
  assert.equal(cardSlotsFor("3.0"), 10);
  assert.equal(cardSlotsFor("2.6.3"), 5);
  assert.equal(cardSlotsFor("2.5.9"), 5);
  assert.equal(cardSlotsFor("1.9.9"), 5);
  assert.equal(cardSlotsFor("—"), 5);
  assert.equal(cardSlotsFor(""), 5);
});

test("CARD 行：10 个字段、旧固件 5 个字段、行尾空字段被去掉，都拆成 10 格", () => {
  assert.deepEqual(splitCardLine("CARD\t" + TEN.join("\t")), { cards: TEN, fields: 10 });
  assert.deepEqual(splitCardLine("CARD\ta\t\tc").cards, ["a", "", "c", "", "", "", "", "", "", ""]);
  assert.equal(splitCardLine("CARD\ta\t\tc").fields, 3);
  assert.deepEqual(splitCardLine("CARD").cards, Array(10).fill(""));
  assert.deepEqual(splitCardLine("CARD\t\t\t\t\t\tsix").cards[5], "six");
  assert.equal(splitCardLine("CARD\t\t\t\t\t\tsix").fields, 6);
  assert.equal(splitCardLine("ACK CARDSET OK"), null);
  assert.equal(splitCardLine("CARDS"), null);
  /* 多出来的第 11 个字段不要。 */
  assert.equal(splitCardLine("CARD\t1\t2\t3\t4\t5\t6\t7\t8\t9\t10\t11").cards.length, 10);
});

test("10 格的桩：10 张卡备份、还原到另一台、再备份一次内容相同", () => {
  const source = makePile("2.6.0", 10);
  configured(source);
  source.st.cards = TEN.slice();
  const saved = backup(source, false);
  assert.deepEqual(saved.failed, []);
  assert.deepEqual(saved.body.cards, TEN);
  const target = makePile("2.6.0", 10);
  target.st.cards = ["X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8", "X9", "X10"];
  assert.deepEqual(restore(target, JSON.parse(JSON.stringify(saved.body)), { cardSlots: 10 }), []);
  assert.deepEqual(target.st.cards, TEN);
  assert.deepEqual(backup(target, false).body, saved.body);
  /* 还原的每一步是 CARDSET\t<1..10>\t<卡号>，一共 10 条。 */
  const list = writePlan("cards", saved.body, { cardSlots: 10 }).list;
  assert.equal(list.length, 10);
  assert.equal(list[9].command, "CARDSET\t10\tJ10~!@#$%^");
  assert.equal(list[3].command, "CARDSET\t4\t");
});

test("满 10 张都是最长卡号也能备份还原；第 11 张、超长卡号不下发", () => {
  const full = Array.from({ length: 10 }, (_, i) => "ZZZZZZZZZ" + i);
  const pile = makePile("2.6.0", 10);
  const body = blankBody();
  body.cards = full.slice();
  assert.deepEqual(restore(pile, body, { cardSlots: 10 }).filter((key) => key === "cards"), []);
  assert.deepEqual(pile.st.cards, full);
  assert.equal(("CARD\t" + full.join("\t")).length, 114);
  body.cards = full.concat(["ELEVEN"]);
  assert.ok(writePlan("cards", body, { cardSlots: 10 }).error);
  assert.equal(normalCards(body.cards), null);
  body.cards = full.slice();
  body.cards[9] = "01234567890";
  assert.ok(writePlan("cards", body, { cardSlots: 10 }).error);
  body.cards[9] = "A B";
  assert.ok(writePlan("cards", body, { cardSlots: 10 }).error);
  /* 桩直接拒绝第 11 格。 */
  assert.deepEqual(pile.answer("CARDSET\t11\tK11"), ["ACK CARDSET FAIL"]);
  assert.deepEqual(pile.st.cards, full);
});

test("旧备份（5 格）还原到 10 格的桩：前 5 格照写，第 6–10 格清空", () => {
  const old = blankBody();
  old.cards = ["A1B2C3D4", "", "0123456789", "", "E5"];      /* 2.6.3 的 App 存的 */
  const pile = makePile("2.6.0", 10);
  pile.st.cards = ["X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8", "X9", "X10"];
  assert.deepEqual(restore(pile, old, { cardSlots: 10 }).filter((key) => key === "cards"), []);
  assert.deepEqual(pile.st.cards, ["A1B2C3D4", "", "0123456789", "", "E5", "", "", "", "", ""]);
  assert.ok(sameSection("cards", old, backup(pile, false).body));
});

test("10 格的备份还原到旧固件（5 格）：后 5 格是空的就能还原，有卡就报这一项失败", () => {
  const body = blankBody();
  body.cards = ["A1", "B2", "", "D4", "E5", "", "", "", "", ""];
  const oldPile = makePile("2.6.0", 5);
  assert.equal(writePlan("cards", body, { cardSlots: cardSlotsFor("2.6.3") }).list.length, 5);
  assert.deepEqual(restore(oldPile, body, { cardSlots: 5 }).filter((key) => key === "cards"), []);
  assert.deepEqual(oldPile.st.cards, ["A1", "B2", "", "D4", "E5"]);
  body.cards[7] = "H8";
  assert.equal(writePlan("cards", body, { cardSlots: 5 }).list.length, 10);
  assert.deepEqual(restore(oldPile, body, { cardSlots: 5 }).filter((key) => key === "cards"), ["cards"]);
  /* 前 5 张已经写进去了，没有因为后面失败而丢。 */
  assert.deepEqual(oldPile.st.cards, ["A1", "B2", "", "D4", "E5"]);
});

test("旧固件的桩备份出来也是 10 格（后 5 格空），和以前的 5 格备份算同一份", () => {
  const pile = makePile("2.6.0", 5);
  pile.st.cards = ["A1", "", "C3", "", ""];
  const body = backup(pile, false).body;
  assert.equal(body.cards.length, CARD_SLOTS);
  assert.ok(sameSection("cards", { cards: ["A1", "", "C3", "", ""] }, body));
  assert.ok(!sameSection("cards", { cards: ["A1", "", "C3", "", "E5"] }, body));
});
