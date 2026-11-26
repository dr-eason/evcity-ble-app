/* 固件升级拦住“桩和文件不是同一种”（src/ota-guard.js）：AC06 模块只收带 AC06VER= 的文件，
 * M01 模块只收带 M01VER= 的文件；选错了说清楚，不发 OTAPREP。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILE_MARKS, firmwareKind, firmwareTypeError } from "../src/ota-guard.js";
import { translate, languages } from "../src/i18n.js";

const src = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

function image(mark) {
  const bytes = new Uint8Array(4096).fill(0xFF);
  bytes.set([0x00, 0x80, 0x01, 0x20, 0x01, 0xC1, 0x00, 0x08]);
  if (mark) bytes.set(new TextEncoder().encode(mark + "\0"), 1000);
  return bytes;
}

test("认文件：AC06VER= 是 AC06，M01VER= 是 M01，都没有或都有是认不出", () => {
  assert.equal(firmwareKind(image("AC06VER=2.8.1")), "ac06");
  assert.equal(firmwareKind(image("M01VER=1.3.6")), "m01");
  assert.equal(firmwareKind(image("")), "");
  const both = image("AC06VER=2.8.1");
  both.set(new TextEncoder().encode("M01VER=1.3.6"), 2000);
  assert.equal(firmwareKind(both), "");
  /* 标记在文件最末尾也认。 */
  const tail = new Uint8Array(32).fill(0xFF);
  tail.set(new TextEncoder().encode("M01VER="), 32 - 7);
  assert.equal(firmwareKind(tail), "m01");
  assert.equal(firmwareKind(null), "");
  assert.deepEqual(FILE_MARKS, { ac06: "AC06VER=", m01: "M01VER=" });
});

test("选错了的提示：两个方向各一句，没有标记也说清楚；对的文件没有提示", () => {
  assert.equal(firmwareTypeError("ac06", image("AC06VER=2.8.1")), "");
  assert.equal(firmwareTypeError("m01", image("M01VER=1.3.6")), "");
  const toAc06 = firmwareTypeError("ac06", image("M01VER=1.3.6"));
  const toM01 = firmwareTypeError("m01", image("AC06VER=2.8.1"));
  assert.match(toAc06, /M01 的固件，不能升级到汽车充电桩 AC06/);
  assert.match(toM01, /AC06 的固件，不能升级到摩托车充电桩 M01/);
  assert.match(firmwareTypeError("ac06", image("")), /AC06VER=/);
  assert.match(firmwareTypeError("m01", image("")), /M01VER=/);
  for (const text of [toAc06, toM01, firmwareTypeError("ac06", image("")), firmwareTypeError("m01", image(""))]) {
    for (const { id } of languages) {
      if (id === "zh") continue;
      const out = translate(id, text);
      assert.notEqual(out, text, id + ": " + text);
      assert.ok(out.includes("AC06") && out.includes("M01") || out.includes("VER="), id + ": " + out);
    }
  }
});

test("AC06 页面（App.vue）：选文件时先查类型，不对就不进“已选文件”；开始升级前再查一次", () => {
  const vue = src("App.vue");
  const pick = vue.slice(vue.indexOf("function onFirmwareFile("), vue.indexOf("function acceptDowngrade("));
  assert.ok(pick.indexOf('firmwareTypeError("ac06", image)') > 0);
  assert.ok(pick.indexOf('firmwareTypeError("ac06", image)') < pick.indexOf("firmwareLayout(image)"), "类型在分区布局之前查");
  assert.ok(pick.indexOf('otaPhase.value = "file"') > pick.indexOf("if (typeError)"));
  const begin = vue.slice(vue.indexOf("async function beginUpgrade("), vue.indexOf("async function beginUpgrade(") + 200);
  assert.match(begin, /if \(!otaImage \|\| firmwareTypeError\("ac06", otaImage\)\) return;/);
  assert.ok(begin.indexOf("firmwareTypeError") < begin.indexOf("OTAPREP") || begin.indexOf("OTAPREP") < 0);
});

test("M01 页面（m01/M01App.vue）：同样先查类型，只收 M01VER=", () => {
  const vue = src("m01/M01App.vue");
  const pick = vue.slice(vue.indexOf("function onFirmwareFile("), vue.indexOf("function acceptDowngrade("));
  assert.ok(pick.indexOf('firmwareTypeError("m01", image)') > 0);
  assert.ok(pick.indexOf('firmwareTypeError("m01", image)') < pick.indexOf("firmwareLooksValid(image)"));
  assert.match(vue, /async function beginUpgrade\(\) \{\n  if \(!otaImage \|\| firmwareTypeError\("m01", otaImage\)\) return;/);
  /* M01 自己的版本标记还是 M01VER=。 */
  assert.match(vue, /const mark = "M01VER=";/);
});
