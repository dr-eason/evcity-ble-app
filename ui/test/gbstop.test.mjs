/* 严格模式（原名新国标 6 秒停充；GBSTOPGET / GBSTOPSET、LIVE 行里的等车状态、首页停止按钮的倒计时）的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/gbstop.test.mjs
 *
 * 假桩按固件 wb2.c 的规则应答；更早的固件对这两条一声不吭，LIVE 行也只有三个字段。
 * 一键配置（备份 / 还原、导出 / 导入）里的这一项在 profile.test.mjs。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GB_SETTLE_MS, GB_WAIT_MS, gbChargingState, liveGbStop, newStopGuard, parseGbStopLine, readGbStop,
  resetStopGuard, saveGbStop, stopLive, stopState, stopTap, stopView,
} from "../src/gbstop.js";
import { liveRssi, liveRssiPending } from "../src/wifi-rssi.js";
import { languages, translate } from "../src/i18n.js";
import { GB_STOP_KEYS, gbStopPacks } from "../src/packs-gbstop.js";
import { parseAuthLine, resendable } from "../src/auth.js";
import { SETTINGS_GROUPS } from "../src/tabs.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/* 假桩：只管这两条命令。opts.silent 旧固件不回；opts.gone 连接没了；opts.dropSet 回 OK 但没存；
 * opts.failSet 回 FAIL。 */
function makePile(opts = {}) {
  const pile = { on: !!opts.on, sent: [] };
  function answer(command) {
    if (opts.silent) return null;
    if (command === "GBSTOPGET") return "ACK GBSTOPGET " + (pile.on ? 1 : 0);
    const m = /^GBSTOPSET\t(.*)$/.exec(command);
    if (!m) return null;
    if ((m[1] !== "0" && m[1] !== "1") || opts.failSet) return "ACK GBSTOPSET FAIL";
    if (!opts.dropSet) pile.on = m[1] === "1";
    return "ACK GBSTOPSET OK";
  }
  pile.io = {
    waitMs: 5,
    alive: () => !opts.gone,
    ask: async (command, accept) => {
      pile.sent.push(command);
      const line = answer(command);
      return line != null && accept(line) ? line : null;
    },
  };
  return pile;
}

test("固件认这两条命令，应答、LIVE 字段、OCPP 键和这里解析的一样", () => {
  const wb2 = read("AC06/app/src/wb2.c");
  assert.match(wb2, /strcmp\(text, "GBSTOPGET"\) == 0 \|\| strncmp\(text, "GBSTOPSET\\t", 10\) == 0/);
  for (const reply of ["ACK GBSTOPGET 1", "ACK GBSTOPGET 0", "ACK GBSTOPSET OK", "ACK GBSTOPSET FAIL"]) {
    assert.ok(wb2.includes('"' + reply + '"'), reply);
  }
  assert.ok(wb2.includes('"LIVE %.1f %.2f %s %u %u %u"'));
  assert.ok(wb2.includes('{"GB6sStopEnabled",'));
  /* 没鉴权只放行 HB、AUTH、STATUS；被拒以后 App 认得出要重新鉴权，并补发这条命令。 */
  assert.deepEqual(parseAuthLine("ACK GBSTOPSET AUTH"), { kind: "need", cmd: "GBSTOPSET" });
  assert.deepEqual(parseAuthLine("ACK GBSTOPGET AUTH"), { kind: "need", cmd: "GBSTOPGET" });
  assert.equal(resendable("GBSTOPSET\t1"), true);
  /* 手机蓝牙层本来就放行 "ACK " 和 "LIVE " 行首，原生代码不用改。 */
  const java = read("AC06/tools/ble-finder/src/com/evcity/acv2/MainActivity.java");
  assert.ok(java.includes('line.startsWith("ACK ")') && java.includes('line.startsWith("LIVE ")'));
  const swift = read("AC06/tools/ble-ios/Core/Sources/EVCCore/FrameParser.swift");
  assert.ok(swift.includes('"ACK "') && swift.includes('"LIVE "'));
  /* 桩最多等 6.5 秒（3.0.6；标准要求超过 6 秒才强制断开），和这里的倒计时一样长。Smart Charging
   * 暂停那个 6 秒（PAUSE_OPEN_TICKS）是另一个数，没有变。 */
  const charge = read("AC06/app/src/charge_control.c");
  assert.match(charge, /#define GB_STOP_OPEN_TICKS\s+\(6500u \/ CHARGE_TICK_MS\)/);
  assert.match(charge, /#define PAUSE_OPEN_TICKS\s+\(6000u \/ CHARGE_TICK_MS\)/);
  assert.equal(GB_WAIT_MS, 6500);
});

test("解析：ACK GBSTOPGET 0/1、ACK GBSTOPSET OK/FAIL/BUSY；别的行和鉴权应答不认", () => {
  assert.deepEqual(parseGbStopLine("ACK GBSTOPGET 0"), { kind: "get", on: false });
  assert.deepEqual(parseGbStopLine("ACK GBSTOPGET 1 "), { kind: "get", on: true });
  assert.deepEqual(parseGbStopLine("ACK GBSTOPSET OK"), { kind: "set", ok: true });
  assert.deepEqual(parseGbStopLine("ACK GBSTOPSET FAIL"), { kind: "set", ok: false });
  assert.deepEqual(parseGbStopLine("ACK GBSTOPSET BUSY"), { kind: "set", ok: false });
  for (const line of ["ACK GBSTOPGET 2", "ACK GBSTOPGET", "ACK GBSTOPGET 1 1", "GBSTOPGET 1", "ACK GBSTOPSET AUTH",
    "ACK GBSTOPGET AUTH", "ACK GBSTOPSET", "ACK STOP OK", "ACK NETSTOPSET OK", "ACK PLUGGET 1", "STAT 1", "", null,
    undefined, 5]) {
    assert.equal(parseGbStopLine(line), null, String(line));
  }
});

test("LIVE 行：这一版多三个字段；旧固件的两种写法返回 null，信号强度照旧读得到", () => {
  assert.deepEqual(liveGbStop("LIVE 0.4 6.02 -52 0 0 0"), { on: false, waiting: false, remainMs: 0 });
  assert.deepEqual(liveGbStop("LIVE 0.4 6.02 -52 1 0 0"), { on: true, waiting: false, remainMs: 0 });
  assert.deepEqual(liveGbStop("LIVE 0.4 6.02 -52 1 1 5990"), { on: true, waiting: true, remainMs: 5990 });
  assert.deepEqual(liveGbStop("LIVE 0.4 6.02 -52 1 1 6490"), { on: true, waiting: true, remainMs: 6490 });
  assert.deepEqual(liveGbStop("LIVE 0.4 6.02 - 1 1 10"), { on: true, waiting: true, remainMs: 10 });
  /* 剩余时间不会超过 6.5 秒；没有在等时一律是 0。 */
  assert.equal(liveGbStop("LIVE 0.4 6.02 -52 1 1 65535").remainMs, GB_WAIT_MS);
  assert.equal(liveGbStop("LIVE 0.4 6.02 -52 1 0 3000").remainMs, 0);
  for (const line of ["LIVE 0.4 11.98", "LIVE 0.4 11.98 -62", "LIVE 0.4 11.98 -", "LIVE 0.4 6.02 -52 1 1",
    "LIVE 0.4 6.02 -52 2 0 0", "LIVE 0.4 6.02 -52 1 x 0", "LIVE 0.4 6.02 -52 1 1 -5", "LIVE 0.4 6.02 -52 1 1 5.5",
    "STAT CHARGING NONE 12", "", null]) {
    assert.equal(liveGbStop(line), null, String(line));
  }
  assert.equal(liveRssi("LIVE 0.4 6.02 -52 1 1 5990"), -52);
  assert.equal(liveRssi("LIVE 0.4 6.02 - 1 1 5990"), null);
  assert.equal(liveRssiPending("LIVE 0.4 6.02 - 1 0 0"), true);
});

test("读：桩回 0 / 1；桩不回是 silent（固件还不支持）；连接没了是 gone", async () => {
  const pile = makePile({ on: true });
  assert.deepEqual(await readGbStop(pile.io), { state: "ok", on: true });
  assert.deepEqual(pile.sent, ["GBSTOPGET"]);
  assert.deepEqual(await readGbStop(makePile().io), { state: "ok", on: false });
  const quiet = makePile({ silent: true });
  assert.deepEqual(await readGbStop(quiet.io), { state: "silent" });
  assert.deepEqual(quiet.sent, ["GBSTOPGET", "GBSTOPGET"]);
  assert.deepEqual(await readGbStop(makePile({ gone: true }).io), { state: "gone" });
});

test("存：OK 后读回确认；FAIL、没存上、桩不回都不算保存", async () => {
  const pile = makePile();
  assert.deepEqual(await saveGbStop({ ...pile.io, on: true }), { state: "ok", on: true });
  assert.deepEqual(pile.sent, ["GBSTOPSET\t1", "GBSTOPGET"]);
  assert.equal(pile.on, true);
  assert.deepEqual(await saveGbStop({ ...pile.io, on: false }), { state: "ok", on: false });
  assert.equal(pile.on, false);
  const refused = makePile({ failSet: true });
  assert.deepEqual(await saveGbStop({ ...refused.io, on: true }), { state: "fail", on: false });
  const liar = makePile({ dropSet: true });
  assert.deepEqual(await saveGbStop({ ...liar.io, on: true }), { state: "fail", on: false });
  assert.deepEqual(await saveGbStop({ ...makePile({ silent: true }).io, on: true }), { state: "silent" });
  assert.deepEqual(await saveGbStop({ ...makePile({ gone: true }).io, on: true }), { state: "gone" });
});

test("哪些状态下停止会进等车这一步：充电中和继电器吸合", () => {
  assert.equal(gbChargingState("CHARGING"), true);
  assert.equal(gbChargingState("RELAY_PULL_IN"), true);
  for (const token of ["AVAILABLE", "CONNECTED", "PREPARING", "SUSPENDED_EV", "SUSPENDED_EVSE", "FINISHED",
    "BLOCKED", "SELFCHECK", "", undefined]) {
    assert.equal(gbChargingState(token), false, String(token));
  }
});

test("设置关着：点停止照发，按钮不变，怎么点都一样（和以前一样）", () => {
  const guard = newStopGuard();
  let now = 1000000;
  for (let i = 0; i < 5; i++) {
    assert.equal(stopTap(guard, now, { gbOn: false, charging: true }), true);
    assert.deepEqual(stopView(guard, now), { disabled: false, seconds: 0 });
    stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 0 0 0"), now + 50);
    stopState(guard, false, now + 60);
    assert.deepEqual(stopView(guard, now + 100), { disabled: false, seconds: 0 });
    now += 300;
  }
  /* 旧固件（LIVE 没有这几个字段，App 不知道有这个设置）：同上。 */
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52"), now);
  assert.equal(stopTap(guard, now, { gbOn: false, charging: true }), true);
  assert.equal(stopView(guard, now).disabled, false);
});

test("设置开着、没有在充电：停止照发，按钮不置灰", () => {
  const guard = newStopGuard();
  assert.equal(stopTap(guard, 5000, { gbOn: true, charging: false }), true);
  assert.deepEqual(stopView(guard, 5000), { disabled: false, seconds: 0 });
});

test("设置开着、充电中点停止：按钮置灰，倒计时 6.5 秒，这期间再点不发；到点自己放开", () => {
  const guard = newStopGuard();
  const t0 = 2000000;
  assert.equal(stopTap(guard, t0, { gbOn: true, charging: true }), true);
  assert.deepEqual(stopView(guard, t0), { disabled: true, seconds: 7 });
  /* 再点：不发 STOP，倒计时不重新开始。 */
  assert.equal(stopTap(guard, t0 + 200, { gbOn: true, charging: true }), false);
  assert.equal(stopTap(guard, t0 + 2500, { gbOn: true, charging: true }), false);
  assert.deepEqual(stopView(guard, t0 + 1), { disabled: true, seconds: 7 });
  assert.deepEqual(stopView(guard, t0 + 499), { disabled: true, seconds: 7 });
  assert.deepEqual(stopView(guard, t0 + 500), { disabled: true, seconds: 6 });
  assert.deepEqual(stopView(guard, t0 + 1000), { disabled: true, seconds: 6 });
  assert.deepEqual(stopView(guard, t0 + 1500), { disabled: true, seconds: 5 });
  assert.deepEqual(stopView(guard, t0 + 2500), { disabled: true, seconds: 4 });
  assert.deepEqual(stopView(guard, t0 + 5500), { disabled: true, seconds: 1 });
  assert.deepEqual(stopView(guard, t0 + 6499), { disabled: true, seconds: 1 });
  assert.deepEqual(stopView(guard, t0 + GB_WAIT_MS), { disabled: false, seconds: 0 });
  /* 放开以后再点：又是一轮。 */
  assert.equal(stopTap(guard, t0 + 7000, { gbOn: true, charging: true }), true);
  assert.equal(stopView(guard, t0 + 7000).seconds, 7);
});

test("桩报正在等车：倒计时跟桩的剩余时间走；桩报继电器断开（不再等）：提前放开", () => {
  const guard = newStopGuard();
  const t0 = 3000000;
  assert.equal(stopTap(guard, t0, { gbOn: true, charging: true }), true);
  /* 20 ms 后桩补发的状态：正在等，还剩 6490 ms。 */
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 1 6490"), t0 + 60);
  assert.deepEqual(stopView(guard, t0 + 60), { disabled: true, seconds: 7 });
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 1 5490"), t0 + 1060);
  assert.deepEqual(stopView(guard, t0 + 1060), { disabled: true, seconds: 6 });
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 1 4990"), t0 + 1060);
  assert.deepEqual(stopView(guard, t0 + 1060), { disabled: true, seconds: 5 });
  /* 状态行还是 CHARGING：不放开。 */
  stopState(guard, true, t0 + 1100);
  assert.equal(stopView(guard, t0 + 1100).disabled, true);
  /* 车在 1.4 秒停了，继电器断开：桩补发 "1 0 0"，按钮马上能点。 */
  stopLive(guard, liveGbStop("LIVE 0.4 9.01 -52 1 0 0"), t0 + 1420);
  assert.deepEqual(stopView(guard, t0 + 1420), { disabled: false, seconds: 0 });
  assert.equal(stopTap(guard, t0 + 1500, { gbOn: true, charging: false }), true);
});

test("刚点完收到的旧状态不算：点之前排着的 LIVE / STAT 不会把按钮提前放开", () => {
  const guard = newStopGuard();
  const t0 = 4000000;
  assert.equal(stopTap(guard, t0, { gbOn: true, charging: true }), true);
  /* 桩在处理 STOP 之前已经排着的状态：没有在等、状态里还有别的。 */
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 0 0"), t0 + 30);
  assert.equal(stopView(guard, t0 + 30).disabled, true);
  stopState(guard, false, t0 + 40);
  assert.equal(stopView(guard, t0 + 40).disabled, true);
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 0 0"), t0 + GB_SETTLE_MS - 1);
  assert.equal(stopView(guard, t0 + GB_SETTLE_MS - 1).disabled, true);
  /* 过了 1.5 秒桩还说没有在等：这次停止没有进等车这一步（比如车已经停了），放开。 */
  stopLive(guard, liveGbStop("LIVE 0.4 9.01 -52 1 0 0"), t0 + GB_SETTLE_MS);
  assert.equal(stopView(guard, t0 + GB_SETTLE_MS).disabled, false);
});

test("状态行说已经停下来了（桩报过在等之后）：放开", () => {
  const guard = newStopGuard();
  const t0 = 5000000;
  stopTap(guard, t0, { gbOn: true, charging: true });
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 1 5980"), t0 + 50);
  stopState(guard, false, t0 + 900);
  assert.deepEqual(stopView(guard, t0 + 900), { disabled: false, seconds: 0 });
});

test("别处发起的停止（屏上点的、平台远程）：手机没点，桩报正在等车，按钮同样置灰倒计时", () => {
  const guard = newStopGuard();
  const t0 = 6000000;
  assert.equal(stopView(guard, t0).disabled, false);
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 1 4200"), t0);
  assert.deepEqual(stopView(guard, t0), { disabled: true, seconds: 5 });
  assert.equal(stopTap(guard, t0 + 100, { gbOn: true, charging: true }), false);
  stopLive(guard, liveGbStop("LIVE 0.4 6.02 -52 1 1 3200"), t0 + 1000);
  assert.deepEqual(stopView(guard, t0 + 1000), { disabled: true, seconds: 4 });
  /* 桩不再发状态（蓝牙断了一下）：按最后一次报的剩余时间到点放开，不会一直灰着。 */
  assert.equal(stopView(guard, t0 + 1000 + 3200).disabled, false);
  /* 等满 6.5 秒强制断开那一下。 */
  const again = newStopGuard();
  stopLive(again, liveGbStop("LIVE 0.4 6.02 -52 1 1 10"), t0);
  stopLive(again, liveGbStop("LIVE 0.4 6.02 -52 1 0 0"), t0 + 20);
  assert.equal(stopView(again, t0 + 20).disabled, false);
});

test("断开蓝牙：清掉", () => {
  const guard = newStopGuard();
  stopTap(guard, 100, { gbOn: true, charging: true });
  assert.equal(stopView(guard, 200).disabled, true);
  resetStopGuard(guard);
  assert.deepEqual(guard, { until: 0, pressedAt: 0, seen: false });
  assert.deepEqual(stopView(guard, 200), { disabled: false, seconds: 0 });
});

test("12 种语言的文案都齐，不是中文键、也不是英文原样", () => {
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  assert.equal(GB_STOP_KEYS.length, 6);
  assert.deepEqual(Object.keys(gbStopPacks).sort(), langs.slice().sort());
  for (const lang of langs) {
    assert.deepEqual(Object.keys(gbStopPacks[lang]).sort(), GB_STOP_KEYS.slice().sort(), lang + " 的键不齐");
    for (const key of GB_STOP_KEYS) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
      assert.ok(!/[一-鿿]/.test(out) || lang === "ja", lang + " 里还有汉字: " + key);
      if (lang !== "en") assert.notEqual(gbStopPacks[lang][key], gbStopPacks.en[key], lang + " 用了英文: " + key);
    }
    /* 标准号每种语言都原样带着；页面说明里 6.5 秒这个数也都在（小数点按各语言写成 . 或 ,）。 */
    assert.ok(translate(lang, "按 GB/T 18487.1-2023 的停止和故障时序").includes("GB/T 18487.1-2023"), lang);
    assert.ok(translate(lang, GB_STOP_KEYS[3]).includes("GB/T 18487.1-2023"), lang);
    assert.match(translate(lang, GB_STOP_KEYS[3]), /6[.,]5|৬\.৫/, lang);
    assert.match(translate(lang, GB_STOP_KEYS[3]), /100/, lang);
    /* 旧名字（新国标 6 秒停充 / GB 6-second stop）不再出现在界面上。 */
    for (const key of GB_STOP_KEYS.slice(0, 3)) assert.ok(!/GB 6|GB-Stopp|GB en 6|GB em 6|GB ৬|GB за 6/.test(translate(lang, key)), lang + ": " + key);
  }
  assert.equal(translate("zh", "开启严格模式"), "开启严格模式");
  assert.equal(translate("zh", "等待车端关闭，请勿重复点击停止"), "等待车端关闭，请勿重复点击停止");
  assert.equal(translate("en", "等待车端关闭，请勿重复点击停止"), "Waiting for the vehicle to stop. Do not tap Stop again");
});

test("App.vue：首页停止按钮、设置页、菜单入口；用到的字符串每种语言都有", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/App.vue");
  const template = vue.slice(0, vue.indexOf("<script"));
  const script = vue.slice(vue.indexOf("<script"));
  /* 停止按钮：置灰、倒计时、点了走 tapStop；模板里不再直接 send('STOP')。
   * toggleOff.stop 是 3.0.8 的启停最小间隔（charge-toggle-guard.test.mjs），倒计时和提示行只跟 stopBtn。 */
  assert.match(template, /<button class="ghost" :disabled="stopBtn\.disabled \|\| toggleOff\.stop" @click="tapStop">\{\{ t\('停止'\) \}\}<template v-if="stopBtn\.disabled"> \(\{\{ stopBtn\.seconds \}\} s\)<\/template><\/button>/);
  assert.ok(!template.includes("send('STOP')"));
  assert.match(template, /<p v-if="stopBtn\.disabled" class="note">\{\{ t\('等待车端关闭，请勿重复点击停止'\) \}\}<\/p>/);
  /* STOP 只在 tapStop 里发，而且先问 stopTap。 */
  assert.equal(script.match(/send\("STOP"\)/g).length, 1);
  assert.match(script, /if \(!stopTap\(stopGuard, now, \{ gbOn: gbStopOn\.value, charging: gbChargingState\(chargeToken\) \}\)\) return;\s+stopRefresh\(now\);\s+send\("STOP"\);/);
  /* LIVE、STAT、断开各自喂给按钮。 */
  assert.match(script, /stopLive\(stopGuard, gb, Date\.now\(\)\);/);
  assert.match(script, /stopState\(stopGuard, gbChargingState\(chargeToken\), Date\.now\(\)\);/);
  assert.match(script, /resetStopGuard\(stopGuard\);\s+chargeToken = "";/);
  /* ACK GBSTOP… 不走到 applyAck（那里按“行里有 STOP”认成“已发出停止”）。 */
  const at = script.indexOf("if (parseGbStopLine(line) !== null) {");
  assert.ok(at > 0 && at < script.indexOf('if (line.indexOf("ACK ") === 0) {'));
  /* 设置页。 */
  const block = template.match(/<section v-else-if="page === 'gbstop'"[\s\S]*?<\/section>/);
  assert.ok(block, "App.vue 里没有严格模式的设置页");
  assert.match(block[0], /:checked="gbStopOn" :disabled="gbStopSaving \|\| gbStopState !== 'ok'"/);
  assert.match(script, /readGbStop\(\{ ask: askScr, alive \}\)/);
  assert.match(script, /saveGbStop\(\{ ask: askScr, alive, on: !!on \}\)/);
  assert.ok(!/send\("GBSTOP/.test(script));
  assert.match(script, /if \(page\.value === "gbstop"\) return "严格模式";/);
  /* 菜单：在充电设置里，挨着即插即充。 */
  assert.match(template, /@click="openGbStop"/);
  const group = SETTINGS_GROUPS.find((item) => item.title === "充电设置");
  assert.equal(group.items.indexOf("openGbStop"), group.items.indexOf("page = 'plug'") + 1);
  const used = new Set(["严格模式", "按 GB/T 18487.1-2023 的停止和故障时序", "等待车端关闭，请勿重复点击停止", "停止", "开", "关"]);
  for (const m of block[0].matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of script.matchAll(/gbStopNote\.value = "([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.has("充电桩没有应答。充电桩固件可能还不支持这个设置，需要升级后再设置"));
  assert.ok(used.has("已保存，断电后仍然有效") && used.has("没有保存"));
  assert.ok(used.size >= 12);
  for (const key of GB_STOP_KEYS) assert.ok(used.has(key), "没用到: " + key);
  for (const lang of languages.map((item) => item.id).filter((id) => id !== "zh")) {
    for (const key of used) {
      if (!key) continue;
      const out = translate(lang, key);
      assert.ok(out && (out !== key || (lang === "ja" && key === "停止")), lang + " 没翻: " + key);
    }
  }
});

test("打包好的页面（assets/index.html）里有这一版的界面", () => {
  const html = read("AC06/tools/ble-finder/assets/index.html");
  assert.ok(html.includes("GBSTOPGET") && html.includes("GBSTOPSET"));
  assert.ok(html.includes("等待车端关闭，请勿重复点击停止"));
  assert.ok(html.includes("Waiting for the vehicle to stop. Do not tap Stop again"));
});
