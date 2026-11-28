/* 首页 WiFi 那一行的主机测试：
 *
 *     node --test APP/ui/test/
 *
 * 信号强度在每秒的 ACK SYS 行里（ports.js 的 parseSys），这里测显示规则。 */
import test from "node:test";
import assert from "node:assert/strict";
import { wifiStatusText } from "../src/m01/wifi-rssi.js";
import { parseSys } from "../src/m01/ports.js";
import { translate } from "../src/m01/i18n.js";

const SYS_UP = "ACK SYS\t1.0.0\t10\t230.4\t31\t1\t-62\tUP\tON\t2027-01-15T08:00:00Z\tbench";
const SYS_DOWN = "ACK SYS\t1.0.0\t10\t-\t-\t0\t-\tDOWN\tOFF\t-\t-";

test("ACK SYS 第 6 个字段是 dBm；没连上或还没问到是 -", () => {
  assert.equal(parseSys(SYS_UP).rssi, -62);
  assert.equal(parseSys(SYS_DOWN).rssi, null);
  assert.equal(parseSys(SYS_UP.replace("-62", "0")).rssi, null);
  assert.equal(parseSys(SYS_UP.replace("-62", "-130")).rssi, null);
  assert.equal(parseSys(SYS_UP.replace("-62", "62")).rssi, null);
});

test("首页文字：已连接才带括号，有数值写 dBm，没数值写 (--)", () => {
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", -62), "WiFi 已连接 (-62 dBm)  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", null), "WiFi 已连接 (--)  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "", -62), "WiFi 已连接 (-62 dBm)");
  assert.equal(wifiStatusText("WiFi 连接中", "JOINING", "bench", -62), "WiFi 连接中  bench");
  assert.equal(wifiStatusText("WiFi 连接失败", "FAIL", "bench", null), "WiFi 连接失败  bench");
  assert.equal(wifiStatusText("WiFi 未连接", "DOWN", "", null), "WiFi 未连接");
  /* 不是 dBm 的值不显示成数值。 */
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", 0), "WiFi 已连接 (--)  bench");
  assert.equal(wifiStatusText("WiFi 已连接", "UP", "bench", -121), "WiFi 已连接 (--)  bench");
});

test("从 ACK SYS 到首页那一行", () => {
  const got = parseSys(SYS_UP);
  assert.equal(wifiStatusText("WiFi 已连接", got.wifi, got.ssid, got.rssi), "WiFi 已连接 (-62 dBm)  bench");
  const down = parseSys(SYS_DOWN);
  assert.equal(wifiStatusText("WiFi 未连接", down.wifi, down.ssid, down.rssi), "WiFi 未连接");
});

test("各语言：行首照常翻译，数值、单位和 (--) 原样留着", () => {
  const text = wifiStatusText("WiFi 已连接", "UP", "bench", -62);
  const pending = wifiStatusText("WiFi 已连接", "UP", "bench", null);
  assert.equal(translate("zh", text), "WiFi 已连接 (-62 dBm)  bench");
  assert.equal(translate("en", text), "Wi-Fi connected (-62 dBm)  bench");
  assert.equal(translate("en", pending), "Wi-Fi connected (--)  bench");
  for (const lang of ["fr", "ja", "de", "es", "pt", "ru", "hi", "ar", "bn", "id", "ur"]) {
    const out = translate(lang, text);
    assert.ok(out.endsWith(" (-62 dBm)  bench"), lang + ": " + out);
    assert.ok(out.indexOf("WiFi 已连接") < 0, lang + ": " + out);
    assert.ok(translate(lang, pending).endsWith(" (--)  bench"), lang);
  }
});
