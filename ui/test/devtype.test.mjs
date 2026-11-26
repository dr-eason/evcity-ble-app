/* 合并后认桩的类型（src/devtype.js）：广播名 → 类型、第一行状态 → 类型、按地址记住、扫描页用哪个。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TYPE_AC06, TYPE_LABELS, TYPE_M01, TYPE_UNKNOWN, deviceType, needsSwitch, profileFor, rememberType,
  rememberedType, typeFromName, typeFromStatus, typeKey,
} from "../src/devtype.js";

function memory(init) {
  const map = new Map(Object.entries(init || {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test("广播名：第 4 个字符 M 是 M01，_ 是 AC06，别的认不出", () => {
  /* M01 现在的广播名：EVCM_ 加 6 位，11 个字符。 */
  assert.equal(typeFromName("EVCM_A1B2C3"), TYPE_M01);
  assert.equal(typeFromName("evcm_a1b2c3"), TYPE_M01);
  /* 60fcf5d 那版测试固件：EVCM 加 6 位，没有下划线。 */
  assert.equal(typeFromName("EVCMA1B2C3"), TYPE_M01);
  assert.equal(typeFromName("evcma1b2c3"), TYPE_M01);
  assert.equal(typeFromName("EVC_ABC123"), TYPE_AC06);
  assert.equal(typeFromName("evc_abc123"), TYPE_AC06);
  for (const name of ["EVC", "EVCX12345", "EVC-ODD", "", null, undefined, "ABC_123456", "XEVCM12345", "EVB_123456"]) {
    assert.equal(typeFromName(name), TYPE_UNKNOWN, String(name));
  }
});

test("第一行状态：STAT 开头是 AC06，ACK SYS（制表符）是 M01；别的行不算", () => {
  assert.equal(typeFromStatus("STAT A NONE 00:00:00 0 0"), TYPE_AC06);
  assert.equal(typeFromStatus("ACK SYS\t1.3.6\t10\t230.4"), TYPE_M01);
  assert.equal(typeFromStatus("ACK PORTS\t10\tP,0,0,0"), TYPE_M01);
  for (const line of ["ACK SYS 1.3.6", "ACK SYSX\t1", "STAT", "ACK AUTH OK", "LIVE 1", "FLT NONE", "", null]) {
    assert.equal(typeFromStatus(line), "", String(line));
  }
});

test("按地址记住类型：只记 ac06 / m01，读回来认不出的值当没记", () => {
  const store = memory();
  assert.equal(rememberedType("AA", store), "");
  assert.equal(rememberType("AA", TYPE_M01, store), true);
  assert.equal(store.map.get(typeKey("AA")), "m01");
  assert.equal(typeKey("AA"), "dev-type:AA");
  assert.equal(rememberedType("AA", store), TYPE_M01);
  assert.equal(rememberType("AA", TYPE_UNKNOWN, store), false);
  assert.equal(rememberType("", TYPE_M01, store), false);
  assert.equal(rememberedType("BB", memory({ "dev-type:BB": "junk" })), "");
  const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(rememberedType("AA", broken), "");
  assert.equal(rememberType("AA", TYPE_M01, broken), false);
});

test("扫描页用哪种：EVCM 直接是 M01；EVC_ 和认不出的先看记住的", () => {
  const store = memory({ "dev-type:01": "m01", "dev-type:02": "ac06", "dev-type:03": "ac06" });
  assert.equal(deviceType({ name: "EVCM_A1B2C3", addr: "09" }, store), TYPE_M01);
  assert.equal(deviceType({ name: "EVCMA1B2C3", addr: "09" }, store), TYPE_M01);
  /* 没重刷的 M01：名字是 EVC_，连过一次记住了 M01。 */
  assert.equal(deviceType({ name: "EVC_OLD001", addr: "01" }, store), TYPE_M01);
  assert.equal(deviceType({ name: "EVC_ABC123", addr: "02" }, store), TYPE_AC06);
  assert.equal(deviceType({ name: "EVC_NEW999", addr: "10" }, store), TYPE_AC06);
  assert.equal(deviceType({ name: "EVC-ODD", addr: "11" }, store), TYPE_UNKNOWN);
  assert.equal(deviceType({ name: "EVC-ODD", addr: "03" }, store), TYPE_AC06);
  /* EVCM 只有 M01 发，记住的值（比如以前当 AC06 连过同一个地址）不改它。 */
  assert.equal(deviceType({ name: "EVCM_A1B2C3", addr: "02" }, store), TYPE_M01);
  assert.equal(deviceType({ name: "EVCMA1B2C3", addr: "02" }, store), TYPE_M01);
  /* 反过来：EVC_ 的名字记住了 M01（老 M01），不会因为名字像 AC06 被改回去。 */
  assert.equal(deviceType({ name: "EVC_A1B2C3", addr: "01" }, store), TYPE_M01);
});

test("要不要换模块、行首表用哪张", () => {
  assert.equal(needsSwitch(TYPE_AC06, TYPE_M01), true);
  assert.equal(needsSwitch(TYPE_M01, TYPE_AC06), true);
  assert.equal(needsSwitch(TYPE_M01, TYPE_M01), false);
  assert.equal(needsSwitch(TYPE_AC06, ""), false);
  assert.equal(profileFor(TYPE_M01), "m01");
  assert.equal(profileFor(TYPE_AC06), "ac06");
  assert.equal(profileFor(TYPE_UNKNOWN), "ac06");
  assert.deepEqual(Object.keys(TYPE_LABELS).sort(), ["ac06", "m01", "unknown"]);
});
