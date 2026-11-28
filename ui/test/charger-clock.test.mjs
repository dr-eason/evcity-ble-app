/* 时区页“充电桩当前时间”（2.6.15）的主机测试：
 *
 *     node --test APP/ui/test/charger-clock.test.mjs
 *
 * 假桩按固件 wb2.c 里 TIMEGET 的规则应答（ACK TIME <UTC 秒> <时区分钟>，没有时间时秒数 0）；
 * 2.6.14 及更早的假桩对 TIMEGET 一声不吭。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLOCK_NONE, CLOCK_RESYNC_MS, CLOCK_RETRY_MS, chargerClock, chargerUnix, clockText, parseTimeGet,
  readChargerTime, timeGetSupported,
} from "../src/charger-clock.js";
import { TZ_ZONES, parseTzAck, tzSupported } from "../src/tz.js";
import { parseTimeAck } from "../src/time-sync.js";
import { languages, translate } from "../src/i18n.js";
import { tzPacks } from "../src/packs-tz.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s || 0) / 1000;

test("时间字符串：UTC 秒 + 时区分钟，固定 16 个字符，不显示秒", () => {
  const t = utc(2026, 11, 20, 8, 5, 59);
  assert.equal(clockText(t, 0), "2026-11-20 08:05");
  assert.equal(clockText(t, 480), "2026-11-20 16:05");
  assert.equal(clockText(t + 1, 0), "2026-11-20 08:06");
  for (const zone of TZ_ZONES) assert.match(clockText(t, zone), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("半小时和 45 分的时区", () => {
  const t = utc(2026, 11, 20, 8, 5);
  assert.equal(clockText(t, 330), "2026-11-20 13:35");    /* 印度 +05:30 */
  assert.equal(clockText(t, 345), "2026-11-20 13:50");    /* 尼泊尔 +05:45 */
  assert.equal(clockText(t, 525), "2026-11-20 16:50");    /* +08:45 */
  assert.equal(clockText(t, 765), "2026-11-20 20:50");    /* +12:45 */
  assert.equal(clockText(t, 570), "2026-11-20 17:35");    /* +09:30 */
  assert.equal(clockText(t, -210), "2026-11-20 04:35");   /* -03:30 */
  assert.equal(clockText(t, -570), "2026-11-19 22:35");   /* -09:30，退到前一天 */
});

test("负时区", () => {
  const t = utc(2026, 11, 20, 12, 0);
  assert.equal(clockText(t, -300), "2026-11-20 07:00");
  assert.equal(clockText(t, -480), "2026-11-20 04:00");
  assert.equal(clockText(t, -720), "2026-11-20 00:00");
  assert.equal(clockText(t - 60, -720), "2026-11-19 23:59");
});

test("跨日、跨月、跨年、闰日", () => {
  assert.equal(clockText(utc(2026, 11, 20, 23, 30), 60), "2026-11-21 00:30");
  assert.equal(clockText(utc(2026, 11, 20, 0, 30), -60), "2026-11-19 23:30");
  assert.equal(clockText(utc(2026, 11, 20, 10, 0), 840), "2026-11-21 00:00");
  assert.equal(clockText(utc(2026, 11, 20, 11, 59), -720), "2026-11-19 23:59");
  assert.equal(clockText(utc(2026, 11, 30, 20, 0), 480), "2026-12-01 04:00");
  assert.equal(clockText(utc(2026, 12, 31, 18, 30), 345), "2027-01-01 00:15");
  assert.equal(clockText(utc(2027, 1, 1, 0, 15), -570), "2026-12-31 14:45");
  assert.equal(clockText(utc(2028, 2, 28, 20, 0), 480), "2028-02-29 04:00");
  assert.equal(clockText(utc(2028, 3, 1, 1, 0), -300), "2028-02-29 20:00");
  assert.equal(clockText(utc(2027, 2, 28, 20, 0), 480), "2027-03-01 04:00");
});

test("和手机的时区无关：换 TZ 环境变量结果一样", () => {
  const t = utc(2026, 11, 20, 23, 50);
  const keep = process.env.TZ;
  const out = [];
  for (const zone of ["UTC", "Asia/Shanghai", "America/Los_Angeles", "Asia/Kathmandu"]) {
    process.env.TZ = zone;
    out.push(clockText(t, 345));
  }
  if (keep === undefined) delete process.env.TZ; else process.env.TZ = keep;
  assert.deepEqual(out, Array(4).fill("2026-11-21 05:35"));
});

test("算不出来的输入返回空串", () => {
  assert.equal(clockText(0, 480), "");
  assert.equal(clockText(1577836799, 0), "");
  assert.equal(clockText(1577836800, 0), "2020-01-01 00:00");
  assert.equal(clockText(2145916799, 840), "2038-01-01 13:59");
  assert.equal(clockText(2145916800, 0), "");
  assert.equal(clockText(1800000000, 841), "");
  assert.equal(clockText(1800000000, -721), "");
  assert.equal(clockText(1800000000, 8.5), "");
  assert.equal(clockText(NaN, 0), "");
  assert.equal(clockText(null, null), "");
  assert.equal(clockText("x", 0), "");
});

test("ACK TIME 的解析；别的应答不会被当成它，它也不会被当成别的应答", () => {
  assert.deepEqual(parseTimeGet("ACK TIME 1800000000 480"), { unix: 1800000000, tz: 480 });
  assert.deepEqual(parseTimeGet("ACK TIME 1800000000 -570\r\n"), { unix: 1800000000, tz: -570 });
  assert.deepEqual(parseTimeGet("ACK TIME 0 345"), { unix: 0, tz: 345 });
  assert.deepEqual(parseTimeGet("ACK TIME 12345 0"), { unix: 0, tz: 0 });
  assert.deepEqual(parseTimeGet("ACK TIME 1800000000 999"), { unix: 1800000000, tz: null });
  assert.deepEqual(parseTimeGet("ACK TIME 1800000000 x"), { unix: 1800000000, tz: null });
  assert.equal(parseTimeGet("ACK TIME 1800000000"), null);
  assert.equal(parseTimeGet("ACK TIME abc 480"), null);
  assert.equal(parseTimeGet("ACK TIME -5 480"), null);
  assert.equal(parseTimeGet("ACK TIMESET OK"), null);
  assert.equal(parseTimeGet("ACK TIMESET NET"), null);
  assert.equal(parseTimeGet("ACK TZ 480"), null);
  assert.equal(parseTimeGet("ACK TZSET OK"), null);
  assert.equal(parseTimeGet("SCHED 1 480 0 0 0 0"), null);
  assert.equal(parseTimeGet(null), null);
  assert.equal(parseTimeAck("ACK TIME 1800000000 480"), null);
  assert.equal(parseTzAck("ACK TIME 1800000000 480"), null);
});

test("固件版本：2.6.15 起有 TIMEGET", () => {
  assert.equal(timeGetSupported("2.6.15"), true);
  assert.equal(timeGetSupported("V2.6.16"), true);
  assert.equal(timeGetSupported("2.7.0"), true);
  assert.equal(timeGetSupported("3.0"), true);
  assert.equal(timeGetSupported("2.6.14"), false);
  assert.equal(timeGetSupported("2.6.8"), false);
  assert.equal(timeGetSupported("2.5.99"), false);
  assert.equal(timeGetSupported(""), null);
  assert.equal(timeGetSupported("—"), null);
  assert.equal(timeGetSupported(null), null);
  /* 2.6.14 认识 TZSET 但不认识 TIMEGET。 */
  assert.equal(tzSupported("2.6.14"), true);
});

test("App 端走表：按手机走过的毫秒数往前推，跨分才变字", () => {
  const base = { unix: utc(2026, 11, 20, 15, 59, 30), at: 5000000 };
  assert.equal(chargerUnix(base, 5000000), base.unix);
  assert.equal(chargerUnix(base, 5000999), base.unix);
  assert.equal(chargerUnix(base, 5001000), base.unix + 1);
  assert.equal(chargerUnix(base, 4000000), base.unix);          /* 手机的钟往回拨 */
  assert.equal(chargerUnix(null, 1), 0);
  const show = (ms) => chargerClock({ base, tz: 480, tzKnown: true, nowMs: ms });
  assert.deepEqual(show(5000000), { kind: "charger", text: "2026-11-20 23:59" });
  assert.equal(show(5029999).text, "2026-11-20 23:59");
  assert.equal(show(5030000).text, "2026-11-21 00:00");         /* 跨分同时跨日 */
  assert.equal(show(5089999).text, "2026-11-21 00:00");
  assert.equal(show(5090000).text, "2026-11-21 00:01");
  /* 一小时里字正好变 60 次。 */
  let last = "";
  let changes = 0;
  for (let ms = 5000000; ms < 5000000 + 3600000; ms += 1000) {
    const text = show(ms).text;
    if (text !== last) changes += 1;
    last = text;
  }
  assert.equal(changes, 61);
  assert.ok(CLOCK_RESYNC_MS >= 30000 && CLOCK_RETRY_MS >= 5000 && CLOCK_RETRY_MS < CLOCK_RESYNC_MS);
});

test("改时区：同一个 UTC 秒，换了时区字马上跟着变", () => {
  const base = { unix: utc(2026, 11, 20, 8, 5), at: 1000 };
  const show = (tz) => chargerClock({ base, tz, tzKnown: true, nowMs: 1000 }).text;
  assert.equal(show(480), "2026-11-20 16:05");
  assert.equal(show(330), "2026-11-20 13:35");
  assert.equal(show(345), "2026-11-20 13:50");
  assert.equal(show(-570), "2026-11-19 22:35");
  assert.equal(show(840), "2026-11-20 22:05");
  assert.equal(show(-150), "2026-11-20 05:35");                  /* 不在列表里的时区也算 */
  const seen = new Set(TZ_ZONES.map(show));
  assert.equal(seen.size, 39);
});

test("显示的是桩的时间，不是手机的时间", () => {
  /* 桩比手机慢 3 小时 7 分：页面跟桩走。 */
  const phoneMs = utc(2026, 11, 20, 12, 0) * 1000;
  const base = { unix: utc(2026, 11, 20, 8, 53), at: phoneMs };
  assert.equal(chargerClock({ base, tz: 0, tzKnown: true, nowMs: phoneMs + 60000, phoneFed: true }).text,
    "2026-11-20 08:54");
});

test("拿不到时显示 --；桩没有时间、退路各是各的", () => {
  const nowMs = utc(2026, 11, 20, 8, 5, 20) * 1000;
  assert.equal(CLOCK_NONE, "--");
  assert.deepEqual(chargerClock(null), { kind: "none", text: "--" });
  assert.deepEqual(chargerClock({ tzKnown: true, tz: 480, nowMs }), { kind: "none", text: "--" });
  /* 时区还没读到：有时间也不写。 */
  assert.deepEqual(chargerClock({ base: { unix: 1800000000, at: nowMs }, tzKnown: false, tz: 480, nowMs }),
    { kind: "none", text: "--" });
  assert.deepEqual(chargerClock({ noTime: true, tzKnown: true, tz: 480, nowMs }), { kind: "notime", text: "" });
  /* 桩说没有时间时不拿手机的时间顶上。 */
  assert.equal(chargerClock({ noTime: true, phoneFed: true, tzKnown: true, tz: 480, nowMs }).kind, "notime");
  /* 旧固件、桩的时间是手机给的：手机的 UTC + 桩的时区。 */
  assert.deepEqual(chargerClock({ phoneFed: true, tzKnown: true, tz: 345, nowMs }),
    { kind: "phone", text: "2026-11-20 13:50" });
  assert.deepEqual(chargerClock({ phoneFed: true, tzKnown: true, tz: -570, nowMs }),
    { kind: "phone", text: "2026-11-19 22:35" });
  /* 手机的钟明显不对：不显示。 */
  assert.deepEqual(chargerClock({ phoneFed: true, tzKnown: true, tz: 0, nowMs: 1000 }), { kind: "none", text: "--" });
  /* 坏数据不抛异常。 */
  assert.deepEqual(chargerClock({ base: { unix: "x", at: 0 }, tzKnown: true, tz: 0, nowMs }), { kind: "none", text: "--" });
  assert.deepEqual(chargerClock({ base: { unix: 1800000000, at: 0 }, tzKnown: true, tz: 9999, nowMs }),
    { kind: "none", text: "--" });
});

/* 假桩。fw 低于 2.6.15 的不回 TIMEGET；mute 是先丢几次。 */
function fakePile(opts) {
  const pile = { unix: opts.unix, tz: opts.tz === undefined ? 480 : opts.tz, sent: [], mute: opts.mute || 0, up: true };
  pile.io = {
    waitMs: 5,
    fw: opts.fw === undefined ? "2.6.15" : opts.fw,
    now: () => 777000,
    alive: () => pile.up,
    ask: (command, accept) => {
      pile.sent.push(command);
      if (opts.drop) pile.up = false;
      let line = null;
      if (command === "TIMEGET" && !opts.old) {
        if (pile.mute > 0) pile.mute -= 1;
        else line = "ACK TIME " + (pile.unix || 0) + " " + pile.tz;
      }
      return new Promise((done) => setTimeout(() => done(line !== null && accept(line) ? line : null), 1));
    },
  };
  return pile;
}

test("读桩时间：2.6.15 的桩", async () => {
  const pile = fakePile({ unix: 1800000000, tz: 345 });
  assert.deepEqual(await readChargerTime(pile.io),
    { state: "ok", base: { unix: 1800000000, at: 777000 }, tz: 345 });
  assert.deepEqual(pile.sent, ["TIMEGET"]);
});

test("读桩时间：桩还没有时间", async () => {
  const pile = fakePile({ unix: 0, tz: -300 });
  assert.deepEqual(await readChargerTime(pile.io), { state: "notime", tz: -300 });
});

test("读桩时间：丢一次重发一次，两次都不回就是没回", async () => {
  const once = fakePile({ unix: 1800000000, mute: 1 });
  assert.equal((await readChargerTime(once.io)).state, "ok");
  assert.deepEqual(once.sent, ["TIMEGET", "TIMEGET"]);
  const never = fakePile({ unix: 1800000000, mute: 9 });
  assert.deepEqual(await readChargerTime(never.io), { state: "silent" });
  assert.deepEqual(never.sent, ["TIMEGET", "TIMEGET"]);
});

test("读桩时间：2.6.14 及更早的固件不发；版本没读到的旧固件发了不回，都不报错", async () => {
  for (const fw of ["2.6.14", "2.6.13", "2.6.8", "2.5.0"]) {
    const pile = fakePile({ unix: 1800000000, old: true, fw });
    assert.deepEqual(await readChargerTime(pile.io), { state: "old" });
    assert.deepEqual(pile.sent, []);
  }
  const blind = fakePile({ unix: 1800000000, old: true, fw: "" });
  assert.deepEqual(await readChargerTime(blind.io), { state: "silent" });
  assert.deepEqual(blind.sent, ["TIMEGET", "TIMEGET"]);
});

test("读桩时间：中途断开", async () => {
  const pile = fakePile({ unix: 1800000000, drop: true });
  assert.deepEqual(await readChargerTime(pile.io), { state: "gone" });
  assert.deepEqual(pile.sent, ["TIMEGET"]);
});

test("固件 wb2.c：TIMEGET 在白名单里，应答格式和这里解析的一样", () => {
  const src = read("AC06/app/src/wb2.c");
  assert.ok(src.includes('strcmp(text, "TIMEGET") == 0'));
  assert.ok(src.includes('strcmp(cmd, "TIMEGET") == 0'));
  const fmt = src.match(/"(ACK TIME [^"]+)"/);
  assert.ok(fmt && fmt[1] === "ACK TIME %lu %d");
  const line = fmt[1].replace("%lu", "1800000000").replace("%d", "-570");
  assert.deepEqual(parseTimeGet(line), { unix: 1800000000, tz: -570 });
});

test("12 种语言：新加的三句都有，没有漏成英文或中文", () => {
  const keys = ["充电桩当前时间", "充电桩固件低于 2.6.15，读不到充电桩的时间。",
    "充电桩固件低于 2.6.15，这里显示的是手机校给充电桩的时间。", "时间未同步"];
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没有翻译: " + key);
      if (lang !== "en" && key !== "时间未同步") assert.notEqual(out, tzPacks.en[key], lang + " 用了英文: " + key);
    }
    for (const key of keys.slice(1, 3)) assert.ok(translate(lang, key).includes("2.6.15"), lang + ": " + key);
  }
  assert.equal(translate("zh", keys[0]), keys[0]);
  assert.equal(translate("en", keys[0]), "Charger date and time");
});

test("App.vue：时间在时区页最上面，字符串都走翻译，TIMEGET 的应答有人接", () => {
  const vue = read("APP/ui/src/App.vue");
  const tzPage = vue.match(/<section v-else-if="page === 'tz'"[\s\S]*?<\/section>/);
  assert.ok(tzPage);
  const at = (text) => tzPage[0].indexOf(text);
  assert.ok(at("充电桩当前时间") > 0);
  assert.ok(at("充电桩当前时间") < at("充电桩当前时区"));
  assert.ok(at("充电桩当前时间") < at("点一个时区"));
  assert.ok(at("clkShown.text") > 0 && at("t('时间未同步')") > 0);
  assert.ok(vue.includes("if (parseTimeGet(line) !== null) {"));
  assert.ok(/function openTz\(\) \{[^}]*startClk\(\);/.test(vue));
  assert.ok(/async function pickZone[\s\S]*?readClk\(\);\n\}/.test(vue));
});
