/* 蓝牙/WiFi 模组版本的主机测试：
 *
 *     node --test M01/tools/ble-finder/ui/test/
 *
 * 假桩按固件 wb2.c 里 MODVERGET 的规则应答。 */
import test from "node:test";
import assert from "node:assert/strict";
import { modverLabel, modverShort, parseModver, readModver } from "../src/m01/modver.js";
import { translate } from "../src/m01/i18n.js";

const MANUAL = "ACK MODVER 3\tat version:release/V4.18_P2.19.1" +
  "\tsdk version:release_bl_iot_sdk_1.6.36\tfirmware version:V4.18_P1.4.4-e15d67b";

test("手册上的三行：名字、值都读出来", () => {
  const got = parseModver(MANUAL);
  assert.equal(got.count, 3);
  assert.deepEqual(got.items, [
    { key: "at version", value: "release/V4.18_P2.19.1" },
    { key: "sdk version", value: "release_bl_iot_sdk_1.6.36" },
    { key: "firmware version", value: "V4.18_P1.4.4-e15d67b" },
  ]);
  assert.equal(modverShort(got.items), "V4.18_P2.19.1");
  assert.equal(modverLabel("at version"), "模组版本号");
  assert.equal(modverLabel("firmware version"), "模组固件版本号");
  assert.equal(modverLabel("sdk version"), "SDK 版本");
});

test("还没读到：0 行", () => {
  assert.deepEqual(parseModver("ACK MODVER 0"), { count: 0, items: [] });
  assert.deepEqual(parseModver("ACK MODVER 0\r\n"), { count: 0, items: [] });
  /* 行数写着有、正文没有：当作没读到。 */
  assert.equal(parseModver("ACK MODVER 3").count, 0);
  assert.equal(parseModver("ACK MODVER").count, 0);
});

test("别的行不认", () => {
  for (const line of ["ACK MODVERX 1\ta:b", "ACK TIMESET OK", "MODVER 1\ta:b", "ACK", "", "STAT A B",
    "ACK OCFWSET OK", null, undefined, 3]) {
    assert.equal(parseModver(line), null, String(line));
  }
});

test("格式不完全一样的也收：大小写、下划线、没见过的名字、没有冒号的行", () => {
  const got = parseModver("ACK MODVER 4\tAT version:release/V4.18_P2.21.0\tSDK_Version:BUILD_AP_1" +
    "\tcompile time:Nov 20 2024 10:00:00\tjust text\t\tempty:");
  assert.deepEqual(got.items, [
    { key: "at version", value: "release/V4.18_P2.21.0" },
    { key: "sdk version", value: "BUILD_AP_1" },
    { key: "compile time", value: "Nov 20 2024 10:00:00" },
    { key: "", value: "just text" },
  ]);
  assert.equal(got.count, 4);
  assert.equal(modverLabel("compile time"), "编译时间");
  assert.equal(modverLabel("boot version"), "boot version");
  assert.equal(modverLabel(""), "版本信息");
  /* 没有 AT 版本时菜单上用模组固件版本，再没有用第一行。 */
  assert.equal(modverShort([{ key: "sdk version", value: "s" }, { key: "firmware version", value: "V1" }]), "V1");
  assert.equal(modverShort([{ key: "sdk version", value: "s" }]), "s");
  assert.equal(modverShort([]), "");
  assert.equal(modverShort(null), "");
});

/* 假桩。replies：对第 n 次 MODVERGET 回什么；null = 不回。用完之后一直用最后一个。 */
function fakePile(replies) {
  const pile = { sent: [], waits: [], alive: true };
  pile.io = {
    alive: () => pile.alive,
    wait: async (ms) => { pile.waits.push(ms); },
    ask: async (command, accept, ms) => {
      pile.sent.push(command);
      const reply = replies[Math.min(pile.sent.length - 1, replies.length - 1)];
      if (reply == null) return null;
      /* 桩同时在发的状态行不是这条命令的应答。 */
      assert.equal(accept("ACK SYS\t1.0.0\t10\t230.4\t31\t1\t-62\tUP\tON\t-\tbench"), false);
      assert.equal(accept("ACK OCFWSET OK"), false);
      return accept(reply) ? reply : null;
    },
  };
  return pile;
}

test("M01 1.0.0：一次读到", async () => {
  const pile = fakePile([MANUAL]);
  const got = await readModver(pile.io);
  assert.equal(got.state, "ok");
  assert.equal(modverShort(got.items), "V4.18_P2.19.1");
  assert.deepEqual(pile.sent, ["MODVERGET"]);
});

test("不看固件版本：没有 fw 这个参数也照问", async () => {
  const pile = fakePile([MANUAL]);
  assert.equal("fw" in pile.io, false);
  assert.equal((await readModver(pile.io)).state, "ok");
});

test("桩还没读到（0 行）：隔 2.5 秒再读，读到为止", async () => {
  const pile = fakePile(["ACK MODVER 0", "ACK MODVER 0", MANUAL]);
  const got = await readModver(pile.io);
  assert.equal(got.state, "ok");
  assert.equal(pile.sent.length, 3);
  assert.deepEqual(pile.waits, [2500, 2500]);
});

test("模组一直不回答 AT+GMR：读 6 次后显示未知", async () => {
  const pile = fakePile(["ACK MODVER 0"]);
  assert.deepEqual(await readModver(pile.io), { state: "empty" });
  assert.equal(pile.sent.length, 6);
});

test("丢了一次应答：再问一次就有", async () => {
  const pile = fakePile([null, MANUAL]);
  assert.equal((await readModver(pile.io)).state, "ok");
  assert.equal(pile.sent.length, 2);
});

test("两次都没回（蓝牙太差）：是 silent，界面显示未知并提示重新读取", async () => {
  const pile = fakePile([null]);
  assert.deepEqual(await readModver(pile.io), { state: "silent" });
  assert.deepEqual(pile.sent, ["MODVERGET", "MODVERGET"]);
});

test("连接断了就停", async () => {
  const pile = fakePile(["ACK MODVER 0"]);
  pile.io.wait = async () => { pile.alive = false; };
  assert.deepEqual(await readModver(pile.io), { state: "gone" });
  assert.equal(pile.sent.length, 1);
});

test("各语言都有这几句", () => {
  const keys = ["蓝牙WiFi版本", "蓝牙/WiFi 模组的版本号和固件版本号", "未知",
    "这是充电桩里的蓝牙/WiFi 模组自己报告的版本，充电桩上电时读出来保存着。",
    "模组版本号", "模组固件版本号", "SDK 版本", "编译时间", "版本信息",
    "充电桩没有应答，请重新读取",
    "未知。充电桩还没有从模组读到版本，请稍后重新读取。", "正在读取", "重新读取"];
  const seen = {};
  for (const lang of ["en", "fr", "ja", "de", "es", "pt", "ru", "hi", "ar", "bn", "id", "ur"]) {
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + ": " + key);
      assert.ok(!/[一-鿿]/.test(out) || lang === "ja", lang + ": " + out);
      if (lang !== "en") assert.notEqual(out, translate("en", key), lang + " 用了英文: " + key);
      seen[lang + key] = out;
    }
  }
  assert.equal(translate("zh", "蓝牙WiFi版本"), "蓝牙WiFi版本");
  assert.equal(translate("en", "蓝牙WiFi版本"), "Bluetooth/Wi-Fi version");
});
