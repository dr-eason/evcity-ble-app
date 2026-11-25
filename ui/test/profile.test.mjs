/* 一键配置（配置备份 / 还原）的主机测试。不需要手机和桩：
 *
 *     node --test AC06/tools/ble-finder/ui/test/
 *
 * 这里有一台假桩，按固件 wb2.c 的格式应答；中间隔着一层和 MainActivity.knownLine
 * 一样的行首过滤。读取和下发走的是 App 真正用的 readPlan / writePlan / sameSection。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARD_SLOTS, DEFAULT_OVER_V, DEFAULT_UNDER_V, SECTIONS, blankBody, cardSlotsFor, hexToText, normalCards, ocppUrlOk, quietSkip, readPlan, sameSection, sectionSkip, splitCardLine, voltageLimitError, writePlan } from "../src/profile.js";
import {
  EXPORT_KIND, IMPORT_MAX_BYTES, PROFILE_FORMAT, PROFILE_MODEL, bodyProblem, exportFileName, exportText, hasSection, importText,
  makeProfile, phaseReason, profileFormat, storedProfileOk,
} from "../src/profile.js";
import { PHASE_BUSY_REASON } from "../src/phase.js";
import { languages, translate } from "../src/i18n.js";

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
/* 2.8.0：fw 可以是 "2.6.16"（有 4G）、"2.8.0"（还有屏幕语言、屏幕颜色）。noScr：版本号已经是
 * 2.8.0、但还没有屏幕语言和颜色命令的开发版固件（对这两组一声不吭）。相位所有版本都有。 */
function fwAtLeast(fw, need) {
  const have = String(fw).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((have[i] || 0) !== need[i]) return (have[i] || 0) > need[i];
  }
  return true;
}

function makePile(fw, slots = 5, extra) {
  const lte = fwAtLeast(fw, [2, 6, 16]);
  const scr = fwAtLeast(fw, [2, 8, 0]) && !(extra && extra.noScr);
  const st = {
    phase: 0, charging: false, lteOn: false, apn: { proto: 0, apn: "", user: "", pass: "" }, scrLang: 0, scrTheme: 2,
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
      /* 相位：wb2.c。充电中改成另一个值回 BUSY，值没变回 OK。 */
      case "PHASEGET": return ["PHASE " + st.phase];
      case "PHASESET": {
        if (arg !== "0" && arg !== "1") return ["ACK PHASESET FAIL"];
        if (Number(arg) !== st.phase && st.charging) return ["ACK PHASESET BUSY"];
        st.phase = Number(arg);
        return ["ACK PHASESET OK"];
      }
      default: break;
    }
    if (lte) {
      switch (name) {
        case "LTEGET": return ["ACK LTE " + (st.lteOn ? 1 : 0)];
        case "LTESET":
          if (arg !== "0" && arg !== "1") return ["ACK LTESET FAIL"];
          st.lteOn = arg === "1";
          /* lte_cfg_exclusive：开 4G 关 WiFi 和遥测；两条链路都关了，OCPP 跟着关。 */
          if (st.lteOn) { st.wifiOn = false; st.tel = false; }
          else if (!st.wifiOn) st.ocppOn = false;
          return ["ACK LTESET OK"];
        case "APNGET": return ["ACK APN " + st.apn.proto + "\t" + st.apn.apn + "\t" + st.apn.user + "\t" + st.apn.pass];
        case "APNSET": {
          const part = arg.split("\t");
          st.apn = { proto: Number(part[0]), apn: part[1] || "", user: part[2] || "", pass: part[3] || "" };
          return ["ACK APNSET OK"];
        }
        default: break;
      }
    }
    if (scr) {
      switch (name) {
        case "SCRLANGGET": return ["ACK SCRLANG " + st.scrLang];
        case "SCRLANGSET":
          if (!/^[0-4]$/.test(arg)) return ["ACK SCRLANGSET FAIL"];
          st.scrLang = Number(arg);
          return ["ACK SCRLANGSET OK"];
        case "SCRTHEMEGET": return ["ACK SCRTHEME " + st.scrTheme];
        case "SCRTHEMESET":
          if (!/^[0-6]$/.test(arg)) return ["ACK SCRTHEMESET FAIL"];
          st.scrTheme = Number(arg);
          return ["ACK SCRTHEMESET OK"];
        default: break;
      }
    }
    return [];
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

/* runProfileJob 的读取。返回 { body, failed: [没读到的项], skipped: [跳过的项] }。 */
function backup(pile, oldApp) {
  const body = blankBody();
  const failed = [];
  const skipped = [];
  for (const section of SECTIONS) {
    /* App 的 runProfileJob：桩的固件不认识的项（4G 2.6.16 起、屏幕语言和颜色 2.8.0 起）跳过，不算没读到。 */
    if (sectionSkip(section, "read", pile.fw, body)) { skipped.push(section.key); continue; }
    const plan = readPlan(section.key);
    let ok = !!plan.list;
    let quiet = false;
    for (const step of plan.list || []) {
      const line = ask(pile, step, oldApp);
      if (!line && quietSkip(section, line)) { quiet = true; break; }
      if (!line || !step.ok(line, body)) { ok = false; break; }
    }
    if (quiet) skipped.push(section.key);
    else if (!ok) failed.push(section.key);
  }
  return { body, failed, skipped };
}

/* runProfileJob 的下发：每项写完读回来比。返回没写上的项；failed.reasons 是各项的原因，
 * failed.skipped 是跳过的项。 */
function restore(pile, body, opts) {
  const failed = [];
  /* 不可枚举：老用例拿返回值和 [] 做 deepEqual。 */
  Object.defineProperty(failed, "reasons", { value: {}, enumerable: false });
  Object.defineProperty(failed, "skipped", { value: [], enumerable: false });
  for (const section of SECTIONS) {
    if (sectionSkip(section, "write", pile.fw, body, opts)) { failed.skipped.push(section.key); continue; }
    /* App 按桩上报的固件版本给 cardSlots；这里直接用假桩的格数。 */
    const plan = writePlan(section.key, body, Object.assign({ cardSlots: pile.slots }, opts || {}));
    let ok = !!plan.list;
    let quiet = false;
    for (const step of plan.list || []) {
      const line = ask(pile, step, false);
      if (!line && quietSkip(section, line)) { quiet = true; break; }
      if (!line || !step.ok(line, body)) { ok = false; failed.reasons[section.key] = step.reason(line); break; }
    }
    if (quiet) { failed.skipped.push(section.key); continue; }
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


/* ---------------- 2.8.0：屏幕语言、屏幕颜色、相位、4G 开关，格式版本，导出导入 ---------------- */

/* 2.8.0 的桩，五样新东西都设成和出厂不一样的值。 */
function configured28(pile) {
  configured(pile);
  Object.assign(pile.st, {
    phase: 1, scrLang: 4, scrTheme: 5, lteOn: false, apn: { proto: 2, apn: "private.apn", user: "bob", pass: "s3cret" },
  });
}

/* 2.8.0 之前的 App 存的记录：没有 format，body 只有前 11 组（加 apn）。 */
function oldRecord(body) {
  const old = JSON.parse(JSON.stringify(body));
  delete old.lte;
  delete old.scrLang;
  delete old.scrTheme;
  delete old.phase;
  return { id: "old1", name: "门店标准", savedAt: 1760000000000, model: "AC06", body: old };
}

test("新的几组：屏幕语言、屏幕颜色、相位在最后；since 和跳过规则", () => {
  const keys = SECTIONS.map((item) => item.key);
  assert.deepEqual(keys.slice(-3), ["scrlang", "scrtheme", "phase"]);
  const find = (key) => SECTIONS.find((item) => item.key === key);
  assert.deepEqual(find("scrlang").since, [2, 8, 0]);
  assert.deepEqual(find("scrtheme").since, [2, 8, 0]);
  assert.equal(find("phase").since, undefined);
  for (const key of ["scrlang", "scrtheme", "phase", "lte", "apn"]) assert.equal(find(key).optional, true, key);
  /* 屏幕语言、颜色：旧固件（或版本读不出）跳过；相位哪个版本都读。 */
  for (const fw of ["2.7.2", "2.6.16", "", "—"]) {
    assert.equal(sectionSkip(find("scrlang"), "read", fw, blankBody()), "固件不支持", fw);
    assert.equal(sectionSkip(find("scrtheme"), "read", fw, blankBody()), "固件不支持", fw);
    assert.equal(sectionSkip(find("phase"), "read", fw, blankBody()), "", fw);
  }
  assert.equal(sectionSkip(find("scrlang"), "read", "2.8.0", blankBody()), "");
  assert.equal(sectionSkip(find("scrtheme"), "read", "V3.0.0", blankBody()), "");
  /* 下发：备份里没有就跳过，不算失败。 */
  for (const key of ["scrlang", "scrtheme", "phase"]) {
    assert.equal(sectionSkip(find(key), "write", "2.8.0", blankBody()), "这份配置里没有这一项", key);
    assert.equal(sectionSkip(find(key), "write", "2.8.0", oldRecord(blankBody()).body), "这份配置里没有这一项", key);
  }
  assert.equal(sectionSkip(find("phase"), "write", "2.5.6", { phase: 0 }), "");
  assert.equal(sectionSkip(find("scrtheme"), "write", "2.8.0", { scrTheme: 0 }), "");
  /* 屏幕语言、颜色桩不回：按不支持跳过；相位桩不回：照常算失败。 */
  assert.equal(quietSkip(find("scrlang"), null), "充电桩没有应答，固件可能还不支持这一项");
  assert.equal(quietSkip(find("scrtheme"), null), "充电桩没有应答，固件可能还不支持这一项");
  assert.equal(quietSkip(find("scrlang"), "ACK SCRLANG 1"), "");
  assert.equal(quietSkip(find("phase"), null), "");
  assert.equal(quietSkip(find("imax"), null), "");
});

test("新三组的 readPlan / writePlan / sameSection", () => {
  const body = blankBody();
  const read = (key, line) => {
    const step = readPlan(key).list[0];
    return step.accept(line) && step.ok(line, body);
  };
  assert.equal(readPlan("scrlang").list[0].command, "SCRLANGGET");
  assert.equal(readPlan("scrtheme").list[0].command, "SCRTHEMEGET");
  assert.equal(readPlan("phase").list[0].command, "PHASEGET");
  assert.ok(read("scrlang", "ACK SCRLANG 3"));
  assert.ok(read("scrtheme", "ACK SCRTHEME 6"));
  assert.ok(read("phase", "PHASE 1"));
  assert.deepEqual([body.scrLang, body.scrTheme, body.phase], [3, 6, 1]);
  /* 不认的值、别的行：不收。 */
  assert.equal(read("scrlang", "ACK SCRLANG 7"), false);
  assert.equal(read("scrtheme", "ACK SCRTHEME 9"), false);
  assert.equal(read("phase", "PHASE 2"), false);
  assert.equal(readPlan("phase").list[0].accept("ACK PHASESET OK"), false);
  assert.equal(readPlan("scrlang").list[0].accept("ACK SCRLANGSET OK"), false);
  assert.equal(readPlan("scrtheme").list[0].accept("ACK SCRLANG 1"), false);
  /* 下发的命令。 */
  assert.equal(writePlan("scrlang", { scrLang: 4 }).list[0].command, "SCRLANGSET\t4");
  assert.equal(writePlan("scrtheme", { scrTheme: 0 }).list[0].command, "SCRTHEMESET\t0");
  assert.equal(writePlan("phase", { phase: 1 }).list[0].command, "PHASESET\t1");
  assert.equal(writePlan("phase", { phase: 0 }).list[0].command, "PHASESET\t0");
  for (const [key, bad] of [["scrlang", { scrLang: 5 }], ["scrlang", { scrLang: "1" }], ["scrtheme", { scrTheme: 7 }],
    ["scrtheme", { scrTheme: null }], ["phase", { phase: 2 }], ["phase", { phase: true }], ["phase", {}]]) {
    assert.ok(writePlan(key, bad).error, key + " " + JSON.stringify(bad));
  }
  const ok = (key, line) => writePlan(key, { scrLang: 1, scrTheme: 1, phase: 1 }).list[0].ok(line);
  assert.equal(ok("scrlang", "ACK SCRLANGSET OK"), true);
  assert.equal(ok("scrlang", "ACK SCRLANGSET FAIL"), false);
  assert.equal(ok("scrtheme", "ACK SCRTHEMESET OK"), true);
  assert.equal(ok("phase", "ACK PHASESET OK"), true);
  assert.equal(ok("phase", "ACK PHASESET BUSY"), false);
  /* 读回核对。 */
  assert.equal(sameSection("scrlang", { scrLang: 2 }, { scrLang: 2 }), true);
  assert.equal(sameSection("scrlang", { scrLang: 2 }, { scrLang: 3 }), false);
  assert.equal(sameSection("scrtheme", { scrTheme: 0 }, { scrTheme: 0 }), true);
  assert.equal(sameSection("scrtheme", { scrTheme: null }, { scrTheme: null }), false);
  assert.equal(sameSection("phase", { phase: 1 }, { phase: 1 }), true);
  assert.equal(sameSection("phase", { phase: 1 }, { phase: 0 }), false);
  assert.equal(sameSection("lte", { lte: true }, { lte: true }), true);
  assert.equal(sameSection("lte", { lte: true }, { lte: false }), false);
});

test("2.8.0 的桩：16 组都读到（4G 开关也读），还原到另一台 2.8.0 的桩，读回一致", () => {
  const source = makePile("2.8.0", 10);
  configured28(source);
  const { body, failed, skipped } = backup(source, false);
  assert.deepEqual(failed, []);
  assert.deepEqual(skipped, []);
  assert.equal(body.scrLang, 4);
  assert.equal(body.scrTheme, 5);
  assert.equal(body.phase, 1);
  assert.equal(body.lte, false);
  assert.deepEqual(body.apn, { proto: 2, apn: "private.apn", user: "bob", pass: "s3cret" });
  const target = makePile("2.8.0", 10);
  const result = restore(target, JSON.parse(JSON.stringify(body)));
  assert.deepEqual(result, []);
  /* 没勾 4G 开关：跳过，其余都写了。 */
  assert.deepEqual(result.skipped, ["lte"]);
  assert.deepEqual([target.st.scrLang, target.st.scrTheme, target.st.phase], [4, 5, 1]);
  assert.deepEqual(backup(target, false).body, body);
});

test("旧备份（没有屏幕语言、颜色、相位、4G 开关）还原到 2.8.0 的桩：这几组跳过，不算失败，桩上原值不动", () => {
  const source = makePile("2.6.16", 10);
  configured(source);
  const saved = oldRecord(backup(source, false).body);
  const target = makePile("2.8.0", 10);
  Object.assign(target.st, { scrLang: 3, scrTheme: 0, phase: 1 });
  const result = restore(target, JSON.parse(JSON.stringify(saved.body)), { withLte: true });
  assert.deepEqual(result, []);
  assert.deepEqual(result.skipped, ["lte", "scrlang", "scrtheme", "phase"]);
  assert.deepEqual([target.st.scrLang, target.st.scrTheme, target.st.phase], [3, 0, 1]);
  /* 原来的几组照样写上了。 */
  assert.equal(target.st.imax, 16);
  assert.deepEqual(target.st.apn, source.st.apn);
});

test("2.8.0 的备份还原到旧固件：屏幕语言、颜色、4G 跳过（固件不支持），相位照写", () => {
  const source = makePile("2.8.0", 10);
  configured28(source);
  const saved = backup(source, false).body;
  const target = makePile("2.6.0", 10);
  const result = restore(target, JSON.parse(JSON.stringify(saved)), { withLte: true });
  assert.deepEqual(result, []);
  assert.deepEqual(result.skipped, ["lte", "apn", "scrlang", "scrtheme"]);
  assert.equal(target.st.phase, 1);
  /* 旧固件的桩备份出来：这几组是 null，整份照样保存。 */
  const back = backup(makePile("2.6.0"), false);
  assert.deepEqual(back.failed, []);
  assert.deepEqual([back.body.scrLang, back.body.scrTheme, back.body.lte, back.body.phase], [null, null, null, 0]);
});

test("版本号是 2.8.0、但还没有屏幕语言和颜色命令的固件：读、写都按不支持跳过，整份照样保存", () => {
  const pile = makePile("2.8.0", 10, { noScr: true });
  configured28(pile);
  const { body, failed, skipped } = backup(pile, false);
  assert.deepEqual(failed, []);
  assert.deepEqual(skipped, ["scrlang", "scrtheme"]);
  assert.equal(body.scrLang, null);
  assert.equal(body.phase, 1);
  const full = makePile("2.8.0", 10);
  configured28(full);
  const result = restore(makePile("2.8.0", 10, { noScr: true }), backup(full, false).body);
  assert.deepEqual(result, []);
  assert.deepEqual(result.skipped, ["lte", "scrlang", "scrtheme"]);
});

test("相位：充电中改成另一个值桩回 BUSY，这一组失败并提示先停充电；其余组照写，不回滚", () => {
  const source = makePile("2.8.0", 10);
  configured28(source);
  const saved = backup(source, false).body;
  const target = makePile("2.8.0", 10);
  target.st.charging = true;
  target.st.phase = 0;
  const result = restore(target, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(result, ["phase"]);
  assert.equal(result.reasons.phase, PHASE_BUSY_REASON);
  assert.equal(PHASE_BUSY_REASON, "充电桩正在充电，请先停止充电后再下发相位");
  assert.equal(target.st.phase, 0);
  /* 前面各组已经写上了，没有回滚。 */
  assert.equal(target.st.imax, 16);
  assert.equal(target.st.scrTheme, 5);
  /* 值没变：充电中也回 OK，这一组成功。 */
  const same = makePile("2.8.0", 10);
  same.st.charging = true;
  same.st.phase = 1;
  assert.deepEqual(restore(same, JSON.parse(JSON.stringify(saved))), []);
  /* 原因函数本身。 */
  assert.equal(phaseReason("ACK PHASESET BUSY"), PHASE_BUSY_REASON);
  assert.equal(phaseReason("ACK PHASESET FAIL"), "充电桩没有接受");
  assert.equal(phaseReason(null), "回复超时");
  assert.equal(writePlan("phase", { phase: 1 }).list[0].reason("ACK PHASESET BUSY"), PHASE_BUSY_REASON);
});

test("4G 开关：勾了才下发；下发在 OCPP 前面，用 4G 联网的备份还原后 OCPP 开关读回一致", () => {
  const source = makePile("2.8.0", 10);
  configured28(source);
  Object.assign(source.st, { lteOn: true, wifiOn: false, tel: false, ocppOn: true });
  const saved = backup(source, false).body;
  assert.equal(saved.lte, true);
  assert.equal(hasSection("lte", saved), true);
  /* 目标桩现在用 WiFi。 */
  const target = makePile("2.8.0", 10);
  Object.assign(target.st, { wifiOn: true, lteOn: false });
  const result = restore(target, JSON.parse(JSON.stringify(saved)), { withLte: true });
  assert.deepEqual(result, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual([target.st.lteOn, target.st.wifiOn, target.st.ocppOn], [true, false, true]);
  /* 不勾：4G 开关不动。 */
  const keep = makePile("2.8.0", 10);
  Object.assign(keep.st, { wifiOn: false, lteOn: true });
  const plain = restore(keep, JSON.parse(JSON.stringify(Object.assign({}, saved, { lte: false }))));
  assert.ok(plain.skipped.includes("lte"));
  assert.equal(keep.st.lteOn, true);
});

test("格式版本：新记录带 format 2；没有 format 的旧记录照样能列出、能下发", () => {
  assert.equal(PROFILE_FORMAT, 2);
  assert.equal(PROFILE_MODEL, "AC06");
  const rec = makeProfile("门店", blankBody(), 123, "id1");
  assert.deepEqual(Object.keys(rec).sort(), ["body", "format", "id", "model", "name", "savedAt"]);
  assert.equal(rec.format, 2);
  assert.equal(profileFormat(rec), 2);
  const old = oldRecord(blankBody());
  assert.equal(profileFormat(old), 1);
  assert.equal(storedProfileOk(old), true);
  assert.equal(storedProfileOk(rec), true);
  assert.equal(storedProfileOk(Object.assign({}, rec, { model: "AC05" })), false);
  assert.equal(storedProfileOk(Object.assign({}, rec, { body: null })), false);
  assert.equal(profileFormat({ format: "x" }), 0);
  /* App.vue 用的就是这些：存新记录用 makeProfile，列表用 storedProfileOk。 */
  const vue = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
  assert.match(vue, /list\.unshift\(makeProfile\(name, body, Date\.now\(\), newProfileId\(\)\)\);/);
  assert.match(vue, /return raw\.filter\(storedProfileOk\);/);
});

test("导出 / 导入：往返一致，id 重新取，同一份不重复导入", () => {
  const pile = makePile("2.8.0", 10);
  configured28(pile);
  const body = backup(pile, false).body;
  const oldPile = makePile("2.6.3");
  configured(oldPile);
  /* 2.6.3 的 App 存的：5 格卡、没有 apn、没有 format。 */
  const legacy = oldRecord(backup(oldPile, false).body);
  legacy.body.cards = legacy.body.cards.slice(0, 5);
  delete legacy.body.apn;
  const list = [makeProfile("门店 A", body, 1761000000000, "a1"), legacy];
  const text = exportText(list, 1762000000000);
  const data = JSON.parse(text);
  assert.equal(data.kind, EXPORT_KIND);
  assert.equal(data.format, PROFILE_FORMAT);
  assert.equal(data.exportedAt, 1762000000000);
  assert.equal(data.profiles.length, 2);
  assert.equal(data.profiles[1].format, 1);
  let next = 0;
  const newId = () => "n" + (++next);
  const got = importText(text, [], newId);
  assert.equal(got.error, undefined);
  assert.equal(got.list.length, 2);
  assert.deepEqual(got.list.map((item) => item.id), ["n1", "n2"]);
  assert.deepEqual(got.list[0].body, body);
  assert.equal(got.list[0].name, "门店 A");
  assert.equal(got.list[0].savedAt, 1761000000000);
  assert.equal(got.list[0].model, "AC06");
  /* 旧记录的卡表补成 10 格，格式还是 1。 */
  assert.equal(got.list[1].body.cards.length, 10);
  assert.equal(got.list[1].format, 1);
  for (const item of got.list) assert.ok(storedProfileOk(item));
  /* 再导一次：都已经在列表里。 */
  const again = importText(text, got.list, newId);
  assert.deepEqual(again.list, []);
  assert.equal(again.same, 2);
  /* id 撞了就换一个。 */
  const clash = importText(text, [{ id: "n3", name: "x", body: {}, model: "AC06" }], () => (next < 4 ? "n" + (++next) : "z" + (++next)));
  assert.ok(clash.list.every((item) => item.id !== "n3"));
  /* 也认单独一条记录、记录数组，带 BOM 也行。 */
  assert.equal(importText(JSON.stringify(list[0]), [], newId).list.length, 1);
  assert.equal(importText(JSON.stringify(list), [], newId).list.length, 2);
  assert.equal(importText("﻿" + text, [], newId).list.length, 2);
  /* 导出后还原到桩上照样能用。 */
  const target = makePile("2.8.0", 10);
  assert.deepEqual(restore(target, got.list[0].body), []);
  assert.deepEqual([target.st.scrLang, target.st.scrTheme, target.st.phase], [4, 5, 1]);
  /* 文件名。 */
  assert.match(exportFileName(Date.now()), /^evcity-ac06-oneclick-\d{8}-\d{4}\.json$/);
  assert.equal(exportFileName(NaN), "evcity-ac06-oneclick.json");
});

test("导入：坏文件整份不进，说清楚原因", () => {
  const good = makeProfile("门店", JSON.parse(JSON.stringify(backup((() => { const p = makePile("2.8.0", 10); configured28(p); return p; })(), false).body)), 1, "g");
  const wrap = (profiles, extra) => JSON.stringify(Object.assign({ kind: EXPORT_KIND, format: 2, exportedAt: 1, profiles }, extra || {}));
  const bad = (mutate) => {
    const item = JSON.parse(JSON.stringify(good));
    mutate(item);
    return importText(wrap([good, item]), [], () => "x" + Math.random());
  };
  const newId = () => "id";
  assert.equal(importText("not json", [], newId).error, "这个文件不是一键配置文件");
  assert.equal(importText("42", [], newId).error, "这个文件不是一键配置文件");
  assert.equal(importText(JSON.stringify({ hello: 1 }), [], newId).error, "这个文件不是一键配置文件");
  assert.equal(importText(wrap([good], { kind: "other" }), [], newId).error, "这个文件不是一键配置文件");
  assert.equal(importText(wrap([]), [], newId).error, "文件里没有配置");
  assert.equal(importText(wrap([good], { format: 3 }), [], newId).error, "这个文件是更新版本的 App 导出的，请先升级 App");
  assert.equal(importText("x".repeat(IMPORT_MAX_BYTES + 1), [], newId).error, "文件太大，不是一键配置文件");
  assert.equal(bad((item) => { item.format = 9; }).error, "这个文件是更新版本的 App 导出的，请先升级 App");
  assert.deepEqual(bad((item) => { item.model = "AC05"; }), { error: "第 {n} 份配置不是 AC06 充电桩的", vars: { n: 2 } });
  assert.deepEqual(bad((item) => { item.name = ""; }), { error: "第 {n} 份配置的名称不能用", vars: { n: 2 } });
  assert.deepEqual(bad((item) => { item.name = "x".repeat(33); }), { error: "第 {n} 份配置的名称不能用", vars: { n: 2 } });
  const field = (mutate) => bad(mutate).vars && bad(mutate).vars.name;
  assert.equal(field((item) => { item.body.cards = Array(11).fill(""); }), "本地IC卡");
  assert.equal(field((item) => { item.body.cards[0] = "TOO-LONG-CARD"; }), "本地IC卡");
  assert.equal(field((item) => { item.body.imax = 40; }), "最大电流");
  assert.equal(field((item) => { item.body.safety.over = 400; }), "安全管理参数");
  assert.equal(field((item) => { delete item.body.sched; }), "预约充电");
  assert.equal(field((item) => { item.body.wifi.pass = "a\tb"; }), "网络设置");
  assert.equal(field((item) => { item.body.ocpp.url = "http://x/y"; }), "OCPP设置");
  assert.equal(field((item) => { item.body.scrTheme = 7; }), "屏幕颜色");
  assert.equal(field((item) => { item.body.scrLang = "1"; }), "屏幕语言");
  assert.equal(field((item) => { item.body.phase = 3; }), "相位");
  assert.equal(field((item) => { item.body.lte = 1; }), "4G 开关");
  assert.equal(field((item) => { item.body.apn = { proto: 5 }; }), "4G APN");
  assert.equal(bad((item) => { item.body.scrTheme = 7; }).error, "第 {n} 份配置里的「{name}」不能用，整个文件没有导入");
  assert.deepEqual(bad((item) => { item.body = "x"; }).vars, { n: 2, name: "配置内容" });
  assert.deepEqual(importText(JSON.stringify([null]), [], newId), { error: "第 {n} 份配置不能用", vars: { n: 1 } });
  /* 新加的几组可以没有（旧备份），也可以是 null（桩不支持）。 */
  assert.equal(bodyProblem(oldRecord(good.body).body), "");
  assert.equal(bodyProblem(Object.assign({}, good.body, { scrLang: null, scrTheme: null, phase: null, lte: null, apn: null })), "");
  /* 空白模板不是一份真配置（保护参数全是 0）。 */
  assert.equal(bodyProblem(blankBody()), "安全管理参数");
});

test("新提示 12 种语言都有：跳过原因、相位 BUSY、导出导入、4G 开关、新的组名", () => {
  const keys = ["相位", "4G 开关", "屏幕语言", "屏幕颜色", "没有勾选，不下发", "充电桩没有应答，固件可能还不支持这一项",
    PHASE_BUSY_REASON, "这个文件不是一键配置文件", "文件太大，不是一键配置文件", "文件里没有配置",
    "这个文件是更新版本的 App 导出的，请先升级 App", "第 {n} 份配置不能用", "第 {n} 份配置不是 AC06 充电桩的",
    "第 {n} 份配置的名称不能用", "第 {n} 份配置里的「{name}」不能用，整个文件没有导入", "配置内容"];
  const vue = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
  const block = vue.match(/<section v-else-if="page === 'profiles'"[\s\S]*?<\/section>/)[0];
  for (const m of block.matchAll(/t\('([^']+)'/g)) keys.push(m[1]);
  for (const m of vue.matchAll(/profileFileNote\.value = "([^"]+)"/g)) keys.push(m[1]);
  assert.ok(keys.includes("导出的文件里有明文的 WiFi 密码和 4G APN 密码，拿到文件的人都能看到。请只存到自己信任的地方，不要随便发给别人。"));
  assert.ok(keys.includes("同时下发 4G 开关"));
  assert.ok(keys.includes("已导出。文件里有明文密码，请妥善保管"));
  const legacy = new Set(["这份配置存在这台手机上，不绑定某一台桩。连上同型号的充电桩后，都可以下发。", "从当前充电桩保存", "还没有一键配置",
    "把「{name}」下发到当前连接的充电桩？", "确认删除这份配置？", "确认下发", "取消", "确认删除", "重命名", "下发到当前充电桩", "删除"]);
  for (const item of languages) {
    if (item.id === "zh") continue;
    for (const key of keys) {
      if (legacy.has(key)) continue;    /* 2.8.0 之前就有、别的语言退回英文的老字符串，不在这次范围 */
      const out = translate(item.id, key, { n: 2, same: 1, name: "X" });
      assert.ok(out && out !== key, item.id + " 没翻: " + key);
      if (key.includes("{n}")) assert.ok(out.includes("2"), item.id + " 丢了 {n}: " + key);
      if (key.includes("{name}")) assert.ok(out.includes("X"), item.id + " 丢了 {name}: " + key);
    }
  }
});
