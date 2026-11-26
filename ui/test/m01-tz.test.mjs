/* 时区设置的主机测试：
 *
 *     node --test M01/tools/ble-finder/ui/test/
 *
 * 假桩按固件 wb2.c 里 TZSET / TZGET 的规则应答（文档/04-协议/M01蓝牙协议.md 5.6）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TZ_ZONES, parseTzAck, readZone, saveZone, tzIndex, tzLabel } from "../src/m01/tz.js";
import * as tzModule from "../src/m01/tz.js";
import { hasKey, languages, translate } from "../src/m01/i18n.js";
import { tzPacks } from "../src/m01/packs-tz.js";

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

test("写法：UTC+08:00，9 个字符", () => {
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

test("没有旧固件的退路：不看版本号，不走 SCHEDGET / SCHEDSET", () => {
  for (const name of ["tzSupported", "legacyCommand", "parseSchedLine", "TZSET_MIN_VERSION"]) {
    assert.equal(name in tzModule, false, name + " 还在");
  }
  assert.ok(!/SCHED/.test(read("AC06/tools/ble-finder/ui/src/m01/tz.js")));
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
  assert.equal(parseTzAck("ACK TIME 1800000100 -300"), null);
  assert.equal(parseTzAck("ACK SYS\t1.0.0\t10\t230.4\t31\t1\t-62\tUP\tON\t-\tbench"), null);
  assert.equal(parseTzAck(null), null);
});

/* 假桩：M01 1.0.0。TZSET 不看联网开关，只改时区。 */
function pile(opts) {
  const st = Object.assign({ tz: 480, storeFail: false, mute: 0, dead: false }, opts);
  const sent = [];
  function answer(command) {
    sent.push(command);
    if (st.dead) return null;
    if (st.mute > 0) { st.mute -= 1; return null; }
    const part = command.split("\t");
    if (part[0] === "TZSET") {
      const value = /^[+-]?\d{1,4}$/.test(part[1] || "") && part.length === 2 ? parseInt(part[1], 10) : NaN;
      if (!Number.isInteger(value) || value < -720 || value > 840) return "ACK TZSET FAIL";
      if (st.storeFail) return "ACK TZSET FAIL";
      st.tz = value;
      return "ACK TZSET OK";
    }
    if (command === "TZGET") return "ACK TZ " + st.tz;
    return null;      /* 不认识的行不回任何东西 */
  }
  const io = {
    alive: () => !st.gone,
    waitMs: 5,
    ask: async (command, accept) => {
      const line = answer(command);
      return line !== null && accept(line) ? line : null;
    },
  };
  return { st, sent, io };
}

test("39 个时区每一个都存得进去，读回来就是它；只发 TZSET 和 TZGET", async () => {
  for (const zone of TZ_ZONES) {
    const p = pile({ tz: zone === 480 ? 0 : 480 });
    const got = await saveZone({ ...p.io, tz: zone });
    assert.deepEqual(got, { state: "ok", tz: zone });
    assert.deepEqual(p.sent, ["TZSET\t" + zone, "TZGET"]);
  }
});

test("固件版本是 1.0.0 也照存：命令里和 io 里都不带版本", async () => {
  const p = pile({});
  assert.equal("fw" in p.io, false);
  assert.deepEqual(await saveZone({ ...p.io, tz: -300 }), { state: "ok", tz: -300 });
});

test("没存进用户页回 FAIL，界面拿到桩里现在的值", async () => {
  const p = pile({ storeFail: true });
  assert.deepEqual(await saveZone({ ...p.io, tz: 60 }), { state: "fail", tz: 480 });
});

test("丢一条应答会再问一次；一直不回是 silent", async () => {
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

test("只读时区：读到是分钟数，不回是 null", async () => {
  let p = pile({ tz: -570 });
  assert.equal(await readZone(p.io), -570);
  assert.deepEqual(p.sent, ["TZGET"]);
  p = pile({ dead: true });
  assert.equal(await readZone(p.io), null);
  assert.deepEqual(p.sent, ["TZGET", "TZGET"]);
});

test("12 种语言：时区设置的字符串都有，没有漏成英文或中文", () => {
  const keys = Object.keys(tzPacks.en);
  assert.ok(keys.length >= 5);
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
  /* 预约充电没有了，和它有关的句子不留在表里。 */
  for (const key of keys) assert.ok(!/预约/.test(key), key);
});

test("App.vue：时区页用到的字符串每种语言的表里都有；没有预约页", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/m01/M01App.vue");
  const tzPage = vue.match(/<section v-else-if="page === 'tz'"[\s\S]*?<\/section>/);
  assert.ok(tzPage);
  const used = new Set();
  for (const m of tzPage[0].matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  const script = vue.slice(vue.indexOf("<script"));
  for (const m of script.matchAll(/tzNote\.value = "([^"]+)"/g)) used.add(m[1]);
  used.add("时区设置");
  used.add("充电记录和首页的钟点按这个时区");
  assert.ok(used.size >= 10);
  for (const key of used) {
    for (const item of languages) {
      if (item.id === "zh") continue;
      assert.ok(hasKey(item.id, key), item.id + " 的表里没有: " + key);
    }
  }
  assert.ok(!/page === 'sched'/.test(vue), "预约页还在");
  assert.ok(!/SCHEDGET|SCHEDSET/.test(vue), "还在发预约的命令");
  /* 一页列完 39 个，不分页。 */
  assert.match(tzPage[0], /v-for="zone in TZ_ZONES"/);
  assert.match(vue, /openTz/);
});
