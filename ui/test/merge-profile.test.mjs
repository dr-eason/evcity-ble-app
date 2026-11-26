/* 一键配置：AC06 的（model "AC06"，evcity-ac06-oneclick）和 M01 的（model "M01"，evcity-m01-oneclick）
 * 分开存、分开导出，导入时拦住另一种。 */
import test from "node:test";
import assert from "node:assert/strict";
import * as ac06 from "../src/profile.js";
import * as m01 from "../src/m01/profile-file.js";
import { blankBody as m01Blank } from "../src/m01/profile.js";
import { translate, languages } from "../src/i18n.js";

let n = 0;
const newId = () => "id" + (++n);

function m01Record(name) {
  const body = m01Blank();
  body.safety = { over: 253, under: 207 };
  body.plim = Array(10).fill(800);
  body.pay = { model: 1, fullW: 10, hold: 300 };
  body.par = 1;
  body.tz = 480;
  return m01.makeProfile(name, body, 1795000000000, newId());
}

test("M01：存的记录、导出文件的类型和型号", () => {
  const rec = m01Record("门店 M01");
  assert.equal(rec.model, "M01");
  assert.equal(m01.storedProfileOk(rec), true);
  assert.equal(m01.storedProfileOk(Object.assign({}, rec, { model: "AC06" })), false);
  assert.equal(m01.PROFILE_KEY, "m01-oneclick");
  assert.notEqual(m01.PROFILE_KEY, "ac06-oneclick");
  const text = m01.exportText([rec, Object.assign({}, rec, { id: "x", model: "AC06" })], 1795000000000);
  const data = JSON.parse(text);
  assert.equal(data.kind, "evcity-m01-oneclick");
  assert.equal(data.profiles.length, 1, "AC06 的记录不进 M01 的导出文件");
  assert.match(m01.exportFileName(new Date(2026, 10, 25, 14, 30).getTime()), /^evcity-m01-oneclick-20261125-1430\.json$/);
});

test("M01：导出再导入一样；同一份不重复导入", () => {
  const rec = m01Record("A");
  const text = m01.exportText([rec], 1);
  const got = m01.importText(text, [], newId);
  assert.equal(got.error, undefined);
  assert.equal(got.list.length, 1);
  assert.equal(got.list[0].model, "M01");
  assert.deepEqual(got.list[0].body, rec.body);
  const again = m01.importText(text, got.list, newId);
  assert.deepEqual([again.list.length, again.same], [0, 1]);
});

test("M01 模块导入 AC06 的文件：整份拒收，说清楚是汽车充电桩的", () => {
  const acBody = ac06.blankBody();
  const acRec = ac06.makeProfile("AC06 门店", acBody, 1, "a1");
  const acFile = ac06.exportText([acRec], 1);
  assert.match(m01.importText(acFile, [], newId).error, /汽车充电桩 AC06 的一键配置，不能导入到摩托车充电桩 M01/);
  /* 不带 kind 的记录数组、单独一条记录也一样按 model 拦。 */
  assert.match(m01.importText(JSON.stringify([acRec]), [], newId).error, /汽车充电桩 AC06/);
  assert.match(m01.importText(JSON.stringify(acRec), [], newId).error, /汽车充电桩 AC06/);
  assert.equal(m01.importText(JSON.stringify([Object.assign({}, m01Record("x"), { model: "X9" })]), [], newId).error,
    "第 {n} 份配置不是 M01 充电桩的");
});

test("AC06 模块导入 M01 的文件：整份拒收，说清楚是摩托车充电桩的", () => {
  const file = m01.exportText([m01Record("B")], 1);
  assert.match(ac06.importText(file, [], newId).error, /摩托车充电桩 M01 的一键配置，不能导入到汽车充电桩 AC06/);
  assert.match(ac06.importText(JSON.stringify([m01Record("C")]), [], newId).error, /摩托车充电桩 M01/);
  assert.equal(ac06.storedProfileOk(m01Record("D")), false, "M01 的记录不在 AC06 的列表里");
  assert.equal(ac06.M01_EXPORT_KIND, m01.EXPORT_KIND);
  assert.equal(m01.AC06_EXPORT_KIND, ac06.EXPORT_KIND);
});

test("拒收的提示各语言都有", () => {
  const keys = [
    "这是汽车充电桩 AC06 的一键配置，不能导入到摩托车充电桩 M01",
    "这是摩托车充电桩 M01 的一键配置，不能导入到汽车充电桩 AC06",
    "第 {n} 份配置不是 M01 充电桩的",
  ];
  for (const key of keys) {
    for (const { id } of languages) {
      if (id === "zh") continue;
      assert.notEqual(translate(id, key, { n: 2 }), key.replace("{n}", "2"), id + ": " + key);
    }
  }
});
