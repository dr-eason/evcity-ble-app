/* 首页 WiFi 信号强度的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { liveRssi, liveRssiPending, wifiStatusText } from "../src/wifi-rssi.js";
import { translate } from "../src/i18n.js";

test("2.6.5 的 LIVE 行：第三个字段是 dBm", () => {
  assert.equal(liveRssi("LIVE 0.3 9.01 -62"), -62);
  assert.equal(liveRssi("LIVE 0.3 9.01 -100"), -100);
  assert.equal(liveRssi("LIVE 0.3 9.01 -1"), -1);
  assert.equal(liveRssi("LIVE 231.5 -12.00 -45\r"), -45);
});

test("旧固件的 LIVE 行没有这个字段：不显示数值", () => {
  assert.equal(liveRssi("LIVE 0.3 9.01"), null);
  assert.equal(liveRssi("LIVE 0.3"), null);
});

test("没连上时固件发 \"-\"；不是 dBm 的值不收", () => {
  for (const tail of ["-", "0", "62", "-121", "-6x", "--62", "-62.5", "", "NaN"]) {
    assert.equal(liveRssi("LIVE 0.3 9.01 " + tail), null, tail);
  }
  assert.equal(liveRssi("STAT 0.3 9.01 -62"), null);
  assert.equal(liveRssi(null), null);
});

test("以后再往后加字段，第三个字段照样读", () => {
  assert.equal(liveRssi("LIVE 0.3 9.01 -62 7"), -62);
});

test("首页文字：已连接才带数值，样式和原来一样", () => {
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", -62), "WiFi 已连接 (-62 dBm)  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "", -62), "WiFi 已连接 (-62 dBm)");
  /* 旧固件：和 2.6.4 的 App 显示的一字不差。 */
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", null), "WiFi 已连接  bench");
  /* 没连上时不显示，哪怕手里还留着上一次的数。 */
  assert.equal(wifiStatusText("WiFi 连接中", "JOINING", "bench", -62), "WiFi 连接中  bench");
  assert.equal(wifiStatusText("WiFi 连接失败", "FAIL", "bench", -62), "WiFi 连接失败  bench");
  assert.equal(wifiStatusText("WiFi 未连接", "DOWN", "", -62), "WiFi 未连接");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", 0), "WiFi 已连接  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", undefined), "WiFi 已连接  bench");
});

test("各语言：行首照常翻译，数值和单位原样留着", () => {
  const text = wifiStatusText("WiFi 已连接", "UP", "bench", -62);
  assert.equal(translate("zh", text), "WiFi 已连接 (-62 dBm)  bench");
  assert.equal(translate("en", text), "Wi-Fi connected (-62 dBm)  bench");
  for (const lang of ["fr", "ja", "de", "es", "pt", "ru", "hi", "ar", "bn", "id", "ur"]) {
    const out = translate(lang, text);
    assert.ok(out.endsWith(" (-62 dBm)  bench"), lang + ": " + out);
    assert.ok(out.indexOf("已连接") < 0, lang + ": " + out);
  }
});

test("2.6.12：已连接、桩还没有数值时显示 (--)，和屏幕的 Connect (--) 同一条规则", () => {
  /* 桩有这个字段，值是 "-"。 */
  assert.equal(liveRssiPending("LIVE 0.3 9.01 -"), true);
  assert.equal(liveRssiPending("LIVE 0.3 9.01 -\r"), true);
  assert.equal(liveRssiPending("LIVE 0.3 9.01 0"), true);
  /* 有数值、旧固件没有这个字段、不是 LIVE 行：都不是“等数值”。 */
  assert.equal(liveRssiPending("LIVE 0.3 9.01 -62"), false);
  assert.equal(liveRssiPending("LIVE 0.3 9.01"), false);
  assert.equal(liveRssiPending("STAT 0.3 9.01 -"), false);
  assert.equal(liveRssiPending(null), false);

  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", null, true), "WiFi 已连接 (--)  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "", null, true), "WiFi 已连接 (--)");
  /* 有数值时照常显示数值。 */
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", -55, false), "WiFi 已连接 (-55 dBm)  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", -55, true), "WiFi 已连接 (-55 dBm)  bench");
  /* 2.6.4 及更早的固件：没有字段，不带括号。 */
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", null, false), "WiFi 已连接  bench");
  /* 没连上时不带括号。 */
  assert.equal(wifiStatusText("WiFi 连接中", "JOINING", "bench", null, true), "WiFi 连接中  bench");
  assert.equal(wifiStatusText("WiFi 连接失败", "FAIL", "bench", null, true), "WiFi 连接失败  bench");
  assert.equal(wifiStatusText("WiFi 未连接", "DOWN", "", null, true), "WiFi 未连接");
});

test("各语言：(--) 原样留在行首翻译后面", () => {
  const text = wifiStatusText("WiFi 已连接", "UP", "bench", null, true);
  assert.equal(translate("en", text), "Wi-Fi connected (--)  bench");
  for (const lang of ["fr", "ja", "de", "es", "pt", "ru", "hi", "ar", "bn", "id", "ur"]) {
    const out = translate(lang, text);
    assert.ok(out.endsWith(" (--)  bench"), lang + ": " + out);
    assert.ok(out.indexOf("已连接") < 0, lang + ": " + out);
  }
});
