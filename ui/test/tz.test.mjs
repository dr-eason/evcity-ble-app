/* 时区设置（2.6.14）的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/
 *
 * 假桩按固件 wb2.c 里 TZSET / TZGET / SCHEDGET / SCHEDSET 的规则应答；2.6.13 及更早的
 * 假桩对 TZSET、TZGET 一声不吭。 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TZ_ZONES, legacyCommand, parseSchedLine, parseTzAck, saveZone, tzIndex, tzLabel, tzSupported,
} from "../src/tz.js";
import { languages, translate } from "../src/i18n.js";
import { tzPacks } from "../src/packs-tz.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("39 个时区：整点 -12 到 +14，加 12 个半小时、45 分的", () => {
  const extra = [-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765, 825];
  const want = [];
  for (let m = -720; m <= 840; m += 60) want.push(m);
  extra.forEach((m) => want.push(m));
  want.sort((a, b) => a - b);
  assert.equal(TZ_ZONES.length, 39);
  assert.deepEqual(TZ_ZONES, want);
  assert.ok(TZ_ZONES.includes(0));
  assert.equal(new Set(TZ_ZONES).size, 39);
});

test("和屏幕固件 screen.c 的 s_tz_list[] 逐项相同", () => {
  const src = read("AC06/app/src/screen.c");
  const m = src.match(/static const int16_t s_tz_list\[TZ_COUNT\] = \{([^}]*)\}/);
  assert.ok(m, "screen.c 里没找到 s_tz_list");
  const list = m[1].split(",").map((text) => text.trim()).filter(Boolean).map(Number);
  assert.deepEqual(list, TZ_ZONES);
  assert.match(src, /#define TZ_COUNT\s+39u/);
});

test("和迪文屏工具 tz_zones.py 的 ZONES 逐项相同", () => {
  const code = "import sys, json; sys.path.insert(0, sys.argv[1]); import tz_zones; " +
    "print(json.dumps([list(tz_zones.ZONES), [tz_zones.label(z) for z in tz_zones.ZONES]]))";
  let out;
  try {
    out = execFileSync("python3", ["-c", code, resolve(root, "文档/迪文屏/工具")], { encoding: "utf8" });
  } catch (error) {
    /* 没有 python3 的机器：退回按文件文字核对。 */
    const text = read("文档/迪文屏/工具/tz_zones.py");
    assert.match(text, /ZONES = tuple\(sorted\(set\(range\(-720, 841, 60\)\) \| set\(EXTRA\)\)\)/);
    assert.match(text, /EXTRA = \(-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765, 825\)/);
    return;
  }
  const [zones, labels] = JSON.parse(out);
  assert.deepEqual(zones, TZ_ZONES);
  assert.deepEqual(labels, TZ_ZONES.map(tzLabel));
});

test("写法和屏幕一样：UTC+08:00，9 个字符", () => {
  assert.equal(tzLabel(480), "UTC+08:00");
  assert.equal(tzLabel(0), "UTC+00:00");
  assert.equal(tzLabel(-570), "UTC-09:30");
  assert.equal(tzLabel(345), "UTC+05:45");
  assert.equal(tzLabel(840), "UTC+14:00");
  assert.equal(tzLabel(-720), "UTC-12:00");
  assert.equal(tzLabel(-30), "UTC-00:30");
  TZ_ZONES.forEach((zone) => assert.match(tzLabel(zone), /^UTC[+-]\d\d:\d\d$/));
  assert.equal(tzLabel("x"), "");
  assert.equal(tzIndex(480), 27);
  assert.equal(tzIndex(-150), -1);
});

test("固件版本：2.6.14 起有 TZSET", () => {
  assert.equal(tzSupported("2.6.14"), true);
  assert.equal(tzSupported("V2.6.14"), true);
  assert.equal(tzSupported("2.6.15"), true);
  assert.equal(tzSupported("2.7.0"), true);
  assert.equal(tzSupported("3.0"), true);
  assert.equal(tzSupported("2.6.13"), false);
  assert.equal(tzSupported("2.6.9"), false);
  assert.equal(tzSupported("2.5.20"), false);
  assert.equal(tzSupported(""), null);
  assert.equal(tzSupported("—"), null);
  assert.equal(tzSupported(null), null);
});

test("应答行", () => {
  assert.deepEqual(parseTzAck("ACK TZSET OK"), { kind: "set", ok: true });
  assert.deepEqual(parseTzAck("ACK TZSET FAIL"), { kind: "set", ok: false });
  assert.deepEqual(parseTzAck("ACK TZ 480"), { kind: "get", tz: 480 });
  assert.deepEqual(parseTzAck("ACK TZ -570\r\n"), { kind: "get", tz: -570 });
  assert.deepEqual(parseTzAck("ACK TZ 0"), { kind: "get", tz: 0 });
  assert.deepEqual(parseTzAck("ACK TZ 900"), { kind: "get", tz: null });
  assert.deepEqual(parseTzAck("ACK TZ"), { kind: "get", tz: null });
  assert.equal(parseTzAck("ACK TIMESET OK"), null);
  assert.equal(parseTzAck("ACK SCHEDSET OK"), null);
  assert.equal(parseTzAck("SCHED 1 480 0 8 0 0"), null);
  assert.equal(parseTzAck(null), null);
  assert.deepEqual(parseSchedLine("SCHED 1 -300 2 7 30 1"),
    { ready: true, tz: -300, mode: 2, hour: 7, minute: 30, armed: 1 });
  assert.equal(parseSchedLine("SCHED 1 480"), null);
  assert.equal(parseSchedLine("ACK TZ 480"), null);
});

/* 假桩。fw 决定认不认 TZSET；net 为真表示 WiFi 或 OCPP 开着（TZSET 不看它）。 */
function pile(opts) {
  const st = Object.assign({
    fw: "2.6.14", tz: 480, mode: 0, hour: 8, minute: 0, armed: 0, ready: true,
    storeFail: false, mute: 0, dead: false, net: false,
  }, opts);
  const sent = [];
  function answer(command) {
    sent.push(command);
    if (st.dead) return null;
    if (st.mute > 0) { st.mute -= 1; return null; }
    const neu = tzSupported(st.fw) === true;
    const part = command.split("\t");
    if (part[0] === "TZSET" && neu) {
      const value = /^[+-]?\d{1,4}$/.test(part[1] || "") && part.length === 2 ? parseInt(part[1], 10) : NaN;
      if (!Number.isInteger(value) || value < -720 || value > 840) return "ACK TZSET FAIL";
      st.tz = value;
      return st.storeFail ? "ACK TZSET FAIL" : "ACK TZSET OK";
    }
    if (part[0] === "TZGET" && neu) return "ACK TZ " + st.tz;
    if (part[0] === "SCHEDGET") {
      return "SCHED " + (st.ready ? 1 : 0) + " " + st.tz + " " + st.mode + " " + st.hour + " " +
        st.minute + " " + st.armed;
    }
    if (part[0] === "SCHEDSET") {
      const [tz, mode, hour, minute] = part.slice(1).map(Number);
      if (mode !== 0 && !st.ready) return "ACK SCHEDSET TIME";
      if (tz < -720 || tz > 840 || mode > 2 || hour > 23 || minute > 59) return "ACK SCHEDSET FAIL";
      st.tz = tz; st.mode = mode; st.hour = hour; st.minute = minute;
      st.armed = mode === 0 ? 0 : 1;
      return "ACK SCHEDSET OK";
    }
    return null;      /* 不认识的命令：旧固件什么都不回 */
  }
  const io = {
    alive: () => !st.gone,
    fw: st.fw,
    waitMs: 5,
    ask: async (command, accept) => {
      const line = answer(command);
      return line !== null && accept(line) ? line : null;
    },
  };
  return { st, sent, io };
}

test("新固件：39 个时区每一个都存得进去，读回来就是它；不发 SCHEDSET", async () => {
  for (const zone of TZ_ZONES) {
    const p = pile({ tz: zone === 480 ? 0 : 480, mode: 2, hour: 7, minute: 30, armed: 1, net: true });
    const got = await saveZone({ ...p.io, tz: zone });
    assert.deepEqual(got, { state: "ok", tz: zone });
    assert.deepEqual(p.sent, ["TZSET\t" + zone, "TZGET"]);
    /* 预约原样不动。 */
    assert.deepEqual([p.st.mode, p.st.hour, p.st.minute, p.st.armed], [2, 7, 30, 1]);
  }
});

test("新固件：桩没有时间、存着预约也能改时区", async () => {
  const p = pile({ ready: false, mode: 2 });
  assert.deepEqual(await saveZone({ ...p.io, tz: -300 }), { state: "ok", tz: -300 });
});

test("新固件：没存进用户页回 FAIL，界面拿到桩里现在的值", async () => {
  const p = pile({ storeFail: true });
  assert.deepEqual(await saveZone({ ...p.io, tz: 60 }), { state: "fail", tz: 60 });
});

test("新固件：丢一条应答会再问一次；一直不回是 silent", async () => {
  let p = pile({ mute: 1 });
  assert.deepEqual(await saveZone({ ...p.io, tz: 330 }), { state: "ok", tz: 330 });
  assert.deepEqual(p.sent, ["TZSET\t330", "TZSET\t330", "TZGET"]);
  p = pile({ dead: true });
  assert.deepEqual(await saveZone({ ...p.io, tz: 330 }), { state: "silent" });
  assert.deepEqual(p.sent, ["TZSET\t330", "TZSET\t330"]);
});

test("不是 -720 到 840 的整数：不发", async () => {
  const p = pile({});
  for (const bad of [900, -721, 8.5, "abc", NaN, null]) {
    assert.deepEqual(await saveZone({ ...p.io, tz: bad === null ? undefined : bad }), { state: "bad" });
  }
  assert.equal(p.sent.length, 0);
});

test("连接断了：gone", async () => {
  const p = pile({});
  p.st.gone = true;
  assert.deepEqual(await saveZone({ ...p.io, tz: 60 }), { state: "gone" });
});

test("旧固件（2.6.13）：退回 SCHEDGET + SCHEDSET，预约原样带回去", async () => {
  const p = pile({ fw: "2.6.13", tz: 480, mode: 2, hour: 7, minute: 30, armed: 1 });
  const got = await saveZone({ ...p.io, tz: -300 });
  assert.deepEqual(got, { state: "ok", legacy: true, tz: -300 });
  assert.deepEqual(p.sent, ["SCHEDGET", "SCHEDSET\t-300\t2\t7\t30", "SCHEDGET"]);
  assert.deepEqual([p.st.tz, p.st.mode, p.st.hour, p.st.minute], [-300, 2, 7, 30]);
  /* 旧固件上不发它不认识的命令。 */
  assert.ok(!p.sent.some((command) => command.indexOf("TZ") === 0));
});

test("旧固件：一次性、已经执行过的预约写成关闭，不会被重新排上", async () => {
  const p = pile({ fw: "2.6.9", mode: 1, hour: 22, minute: 5, armed: 0 });
  const got = await saveZone({ ...p.io, tz: 540 });
  assert.equal(got.state, "ok");
  assert.equal(p.sent[1], "SCHEDSET\t540\t0\t22\t5");
  assert.equal(p.st.armed, 0);
  assert.equal(legacyCommand(60, { mode: 1, hour: 6, minute: 0, armed: 1 }), "SCHEDSET\t60\t1\t6\t0");
});

test("旧固件：桩里有预约但没有时间，SCHEDSET 回 TIME，时区没存", async () => {
  const p = pile({ fw: "2.6.13", ready: false, mode: 2, tz: 480 });
  const got = await saveZone({ ...p.io, tz: 0 });
  assert.deepEqual(got, { state: "time", legacy: true, tz: 480 });
  assert.equal(p.st.tz, 480);
});

test("旧固件：不回是 silent", async () => {
  const p = pile({ fw: "2.6.13", dead: true });
  assert.deepEqual(await saveZone({ ...p.io, tz: 0 }), { state: "silent", legacy: true });
});

test("版本没读到：先试 TZSET，不回再走旧办法", async () => {
  let p = pile({ fw: "2.6.13" });
  let got = await saveZone({ ...p.io, fw: "", tz: 120 });
  assert.deepEqual(got, { state: "ok", legacy: true, tz: 120 });
  assert.deepEqual(p.sent.slice(0, 3), ["TZSET\t120", "TZSET\t120", "SCHEDGET"]);
  p = pile({ fw: "2.6.14" });
  got = await saveZone({ ...p.io, fw: "", tz: 120 });
  assert.deepEqual(got, { state: "ok", tz: 120 });
});

test("12 种语言：时区设置的字符串都有，没有漏成英文或中文", () => {
  const keys = Object.keys(tzPacks.en);
  assert.ok(keys.length >= 15);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    assert.deepEqual(Object.keys(tzPacks[lang]).sort(), keys.slice().sort(), lang + " 的键不齐");
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没有翻译: " + key);
      if (lang !== "en") assert.notEqual(out, tzPacks.en[key], lang + " 用了英文: " + key);
    }
  }
  assert.equal(translate("zh", "时区设置"), "时区设置");
  assert.equal(translate("en", "时区设置"), "Time zone");
});

test("App.vue：时区页用到的字符串都在表里；预约页不再有时区输入框", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/App.vue");
  const tzPage = vue.match(/<section v-else-if="page === 'tz'"[\s\S]*?<\/section>/);
  const sched = vue.match(/<section v-else-if="page === 'sched'"[\s\S]*?<\/section>/);
  assert.ok(tzPage && sched);
  const used = new Set();
  for (const block of [tzPage[0], sched[0]]) {
    for (const m of block.matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  }
  /* 脚本里时区页、预约页写进提示的句子。 */
  const script = vue.slice(vue.indexOf("<script"));
  for (const name of ["schedNote"]) {
    for (const m of script.matchAll(new RegExp(name + "\\.value = (?:[^;]*?\\? )?\"([^\"]+)\"(?:\\s*:\\s*\"([^\"]+)\")?", "g"))) {
      used.add(m[1]);
      if (m[2]) used.add(m[2]);
    }
  }
  /* 保存的结果写在按钮上（save-btn.js）：按钮上的短原因和按钮下面那一行说明也要有译文。 */
  for (const id of ["tz", "sched"]) {
    for (const m of script.matchAll(new RegExp("saveBtns\\.(?:ok|restart|fail|silent)\\(\"" + id + "\"((?:, \"[^\"]*\")*)\\)", "g"))) {
      for (const one of m[1].matchAll(/"([^"]+)"/g)) used.add(one[1]);
    }
  }
  ["保存中…", "保存成功", "保存失败", "保存失败：{why}", "充电桩没有应答"].forEach((key) => used.add(key));
  used.add("时区设置");
  used.add("屏幕、充电记录和预约的钟点按这个时区");
  used.add("按充电桩时区的钟点启动");
  assert.ok(used.size >= 20);
  for (const key of used) {
    if (key === "") continue;
    for (const item of languages) {
      if (item.id === "zh") continue;
      const out = translate(item.id, key);
      /* 一两个字的词在日文里可以和中文同形（“分”）。 */
      assert.ok(out && (out !== key || key.length <= 2), item.id + " 没有翻译: " + key);
    }
  }
  assert.ok(!/tzInput/.test(vue), "预约页的时区输入框还在");
  assert.ok(!/例如 8 或 -5 或 5\.5/.test(sched[0]));
  assert.ok(!/v-model="tz/.test(sched[0]));
  assert.match(sched[0], /充电桩时区/);
  /* 一页列完 39 个，不分页。 */
  assert.match(tzPage[0], /v-for="zone in TZ_ZONES"/);
  assert.match(vue, /openTz/);
});
