/* 合并新加的字符串（src/packs-merge.js）每种语言都有；扫描页的类型标签、M01 模块（m01/M01App.vue）
 * 界面上的每一句在每种语言里都翻得出来（先查 M01 的表，再查 AC06 的表）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MERGE_LANGS, MERGE_ROWS, mergePacks } from "../src/packs-merge.js";
import { languages, translate } from "../src/i18n.js";
import { languages as m01Languages } from "../src/m01/i18n.js";
import { m01HasText, m01Translate } from "../src/m01/t.js";
import { TYPE_LABELS } from "../src/devtype.js";
import { TABS, SETTINGS_GROUPS } from "../src/m01/tabs.js";

const src = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const CJK = /[一-鿿]/;
const others = languages.map((item) => item.id).filter((id) => id !== "zh");
/* M01 原来就靠规则拼的片段（i18n.js 的行首表、“已找到 N 个热点”），不是整句。 */
const FRAGMENTS = new Set(["配置 ", "已找到 ", " 个热点", "正在连接 ", "扫描失败，错误码 "]);

test("语言：两边是同一组 13 种；新字符串表每一行 13 项，占位符原样留着", () => {
  assert.deepEqual(languages.map((l) => l.id), m01Languages.map((l) => l.id));
  assert.deepEqual(MERGE_LANGS.slice().sort(), others.slice().sort());
  const seen = new Set();
  for (const row of MERGE_ROWS) {
    const key = row[0];
    assert.equal(row.length, 13, key);
    assert.ok(!seen.has(key), "重复: " + key);
    seen.add(key);
    const holders = (key.match(/\{[a-z]+\}/g) || []).sort();
    row.slice(1).forEach((text, i) => {
      const lang = MERGE_LANGS[i];
      assert.ok(typeof text === "string" && text.trim() === text && text.length > 0, lang + ": " + key);
      assert.deepEqual((text.match(/\{[a-z]+\}/g) || []).sort(), holders, lang + ": " + key);
      if (lang !== "ja") assert.ok(!CJK.test(text), lang + " 里还有中文: " + text);
      /* 型号原样带过去。 */
      for (const model of ["AC06", "M01"]) if (key.includes(model)) assert.ok(text.includes(model), lang + " 少了 " + model + ": " + key);
      assert.equal(mergePacks[lang][key], text);
      assert.equal(translate(lang, key), text.replace(/\{n\}/g, "{n}"));
    });
  }
});

test("扫描页：类型标签在每种语言里都有，App.vue 用它们", () => {
  for (const label of Object.values(TYPE_LABELS)) {
    for (const lang of others) assert.notEqual(translate(lang, label), label, lang + ": " + label);
  }
  const vue = src("App.vue");
  assert.match(vue, /t\(TYPE_LABELS\[item\.type\]\)/);
  assert.match(vue, /v-for="item in scanRows"/);
  for (const key of ["正在连接，识别充电桩类型", "没有识别出充电桩类型，请重试", "这是摩托车充电桩 M01，正在切换", "这是汽车充电桩 AC06，正在切换"]) {
    assert.ok(vue.includes('"' + key + '"'), key);
    for (const lang of others) assert.notEqual(translate(lang, key), key, lang + ": " + key);
  }
});

function m01Keys() {
  const vue = src("m01/M01App.vue");
  const template = vue.slice(0, vue.indexOf("<script setup>"));
  const script = vue.slice(vue.indexOf("<script setup>"), vue.indexOf("</script>"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const keys = new Set();
  for (const m of template.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) if (CJK.test(m[1])) keys.add(m[1]);
  for (const m of script.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) if (CJK.test(m[1])) keys.add(m[1]);
  for (const file of ["ports.js", "profile.js", "profile-file.js", "lte.js", "modver.js", "auth.js", "adv-diag.js", "par-switch.js", "wifi-setup.js", "fw-compat.js", "tabs.js"]) {
    const text = src("m01/" + file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) if (CJK.test(m[1])) keys.add(m[1]);
  }
  for (const key of FRAGMENTS) keys.delete(key);
  return keys;
}

test("M01 模块：界面上用到的每一句，12 种语言都翻得出来（M01 的表或 AC06 的表）", () => {
  const keys = m01Keys();
  assert.ok(keys.size > 300, String(keys.size));
  const missing = [];
  for (const key of keys) for (const lang of others) if (!m01HasText(lang, key)) missing.push(lang + ": " + key);
  assert.deepEqual(missing, []);
  /* 标签栏、设置分组的名字。 */
  for (const name of TABS.map((t) => t.label).concat(SETTINGS_GROUPS.map((g) => g.title))) {
    for (const lang of others) assert.notEqual(m01Translate(lang, name), name, lang + ": " + name);
  }
  /* { text, vars } 这种写法（fw-compat.js 的 lackNote）也认。 */
  assert.equal(m01Translate("zh", { text: "第 {n} 路", vars: { n: 3 } }), "第 3 路");
});
