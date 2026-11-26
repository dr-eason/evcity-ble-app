/* 屏幕语言设置（SCRLANGGET / SCRLANGSET）的主机测试：
 *
 *     node --test AC06/tools/ble-finder/ui/test/scrlang.test.mjs
 *
 * 假桩按固件 wb2.c 的规则应答；旧固件对这两条一声不吭。 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCREEN_LANGS, parseScrLangAck, readScreenLang, saveScreenLang, screenLangName,
} from "../src/scrlang.js";
import { languages, translate } from "../src/i18n.js";
import { scrLangPacks } from "../src/packs-scrlang.js";
import { parseAuthLine, resendable } from "../src/auth.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("五种语言，顺序和固件、屏幕工具一样", () => {
  assert.deepEqual(SCREEN_LANGS.map((item) => item.code), ["EN", "ES", "PT", "FR", "ZH"]);
  assert.deepEqual(SCREEN_LANGS.map((item) => item.id), [0, 1, 2, 3, 4]);
  const tab = read("AC06/app/src/screen_lang_tab.h");
  assert.match(tab, /#define LANG_COUNT\s+5u/);
  assert.match(tab, /#define LANG_ZH\s+4u/);
  const screen = read("AC06/app/inc/screen.h");
  assert.match(screen, /#define SCREEN_LANG_COUNT\s+5u/);
  let names;
  try {
    const code = "import sys, json; sys.path.insert(0, sys.argv[1]); import lang_pages as lp; " +
      "print(json.dumps([list(lp.LANGS), list(lp.NAMES)]))";
    names = JSON.parse(execFileSync("python3", ["-c", code, resolve(root, "文档/迪文屏/工具")], { encoding: "utf8" }));
  } catch (error) {
    const text = read("文档/迪文屏/工具/lang_pages.py");
    assert.match(text, /LANGS = \("en", "es", "pt", "fr", "zh"\)/);
    return;
  }
  assert.deepEqual(names[0], ["en", "es", "pt", "fr", "zh"]);
  assert.deepEqual(names[1], SCREEN_LANGS.map((item) => item.name));
  assert.equal(screenLangName(4), "中文");
  assert.equal(screenLangName(9), "");
});

test("固件认这两条命令，未鉴权时拒绝（不在放行名单里）", () => {
  const wb2 = read("AC06/app/src/wb2.c");
  assert.match(wb2, /strcmp\(text, "SCRLANGGET"\) == 0 \|\| strncmp\(text, "SCRLANGSET\\t", 11\) == 0/);
  assert.match(wb2, /"ACK SCRLANG %u"/);
  assert.match(wb2, /"ACK SCRLANGSET OK" : "ACK SCRLANGSET FAIL"/);
  /* 没鉴权只放行 HB、AUTH、STATUS。 */
  assert.match(wb2, /if\(!s_ble_authed && strcmp\(cmd, "STATUS"\) != 0\)\{/);
  /* 被拒以后 App 认得出是要重新鉴权，并补发这条命令。 */
  assert.deepEqual(parseAuthLine("ACK SCRLANGSET AUTH"), { kind: "need", cmd: "SCRLANGSET" });
  assert.deepEqual(parseAuthLine("ACK SCRLANGGET AUTH"), { kind: "need", cmd: "SCRLANGGET" });
  assert.equal(resendable("SCRLANGSET\t2"), true);
  assert.equal(parseScrLangAck("ACK SCRLANGSET AUTH"), null);
});

test("应答行", () => {
  assert.deepEqual(parseScrLangAck("ACK SCRLANG 0"), { kind: "get", lang: 0 });
  assert.deepEqual(parseScrLangAck("ACK SCRLANG 4\r\n"), { kind: "get", lang: 4 });
  assert.deepEqual(parseScrLangAck("ACK SCRLANG 5"), { kind: "get", lang: null });
  assert.deepEqual(parseScrLangAck("ACK SCRLANG x"), { kind: "get", lang: null });
  assert.equal(parseScrLangAck("ACK SCRLANG"), null);
  assert.deepEqual(parseScrLangAck("ACK SCRLANGSET OK"), { kind: "set", ok: true });
  assert.deepEqual(parseScrLangAck("ACK SCRLANGSET FAIL"), { kind: "set", ok: false });
  assert.equal(parseScrLangAck("ACK TZ 480"), null);
  assert.equal(parseScrLangAck("ACK TZSET OK"), null);
  assert.equal(parseScrLangAck("PHASE 1"), null);
  assert.equal(parseScrLangAck(null), null);
});

/* 假桩。old：旧固件，两条都不回。 */
function pile(opts) {
  const st = Object.assign({ lang: 0, old: false, storeFail: false, mute: 0, dead: false }, opts);
  const sent = [];
  function answer(command) {
    sent.push(command);
    if (st.dead || st.old) return null;
    if (st.mute > 0) { st.mute -= 1; return null; }
    if (command === "SCRLANGGET") return "ACK SCRLANG " + st.lang;
    const part = command.split("\t");
    if (part[0] === "SCRLANGSET") {
      const ok = part.length === 2 && /^\d$/.test(part[1]) && Number(part[1]) < 5 && !st.storeFail;
      if (ok) st.lang = Number(part[1]);
      return ok ? "ACK SCRLANGSET OK" : "ACK SCRLANGSET FAIL";
    }
    return null;
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

test("读：一条 SCRLANGGET", async () => {
  const p = pile({ lang: 3 });
  assert.deepEqual(await readScreenLang(p.io), { state: "ok", lang: 3 });
  assert.deepEqual(p.sent, ["SCRLANGGET"]);
});

test("读：丢一条会再问一次；旧固件不回是 silent", async () => {
  let p = pile({ mute: 1, lang: 2 });
  assert.deepEqual(await readScreenLang(p.io), { state: "ok", lang: 2 });
  assert.deepEqual(p.sent, ["SCRLANGGET", "SCRLANGGET"]);
  p = pile({ old: true });
  assert.deepEqual(await readScreenLang(p.io), { state: "silent" });
});

test("存：五种语言每一种都存得进去，读回来就是它", async () => {
  for (const item of SCREEN_LANGS) {
    const p = pile({ lang: item.id === 0 ? 4 : 0 });
    assert.deepEqual(await saveScreenLang({ ...p.io, lang: item.id }), { state: "ok", lang: item.id });
    assert.deepEqual(p.sent, ["SCRLANGSET\t" + item.id, "SCRLANGGET"]);
  }
});

test("存：桩没存进去回 FAIL，界面拿到桩里现在的值", async () => {
  const p = pile({ lang: 1, storeFail: true });
  assert.deepEqual(await saveScreenLang({ ...p.io, lang: 4 }), { state: "fail", lang: 1 });
});

test("存：不是 0–4 不发；旧固件 silent；连接断了 gone", async () => {
  let p = pile({});
  for (const bad of [5, -1, 1.5, "x", NaN, undefined]) {
    assert.deepEqual(await saveScreenLang({ ...p.io, lang: bad }), { state: "bad" });
  }
  assert.equal(p.sent.length, 0);
  p = pile({ old: true });
  assert.deepEqual(await saveScreenLang({ ...p.io, lang: 1 }), { state: "silent" });
  assert.deepEqual(p.sent, ["SCRLANGSET\t1", "SCRLANGSET\t1"]);
  p = pile({});
  p.st.gone = true;
  assert.deepEqual(await saveScreenLang({ ...p.io, lang: 1 }), { state: "gone" });
});

test("12 种语言的文案都齐，不是中文键、也不是英文原样", () => {
  const keys = Object.keys(scrLangPacks.en);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    assert.ok(scrLangPacks[lang], lang + " 没有表");
    assert.deepEqual(Object.keys(scrLangPacks[lang]).sort(), keys.slice().sort(), lang + " 的键不齐");
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
      if (lang !== "en") assert.notEqual(out, scrLangPacks.en[key], lang + " 用了英文: " + key);
    }
  }
  assert.equal(translate("zh", "屏幕语言"), "屏幕语言");
  assert.equal(translate("en", "屏幕语言"), "Screen language");
});

test("App.vue：屏幕语言页、菜单、提示用到的字符串在每种语言里都有", () => {
  const vue = read("AC06/tools/ble-finder/ui/src/App.vue");
  const block = vue.match(/<section v-else-if="page === 'scrlang'"[\s\S]*?<\/section>/);
  assert.ok(block, "App.vue 里没有屏幕语言页");
  const used = new Set(["屏幕语言", "充电桩屏幕首页的显示语言"]);
  for (const m of block[0].matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  const script = vue.slice(vue.indexOf("<script"));
  for (const m of script.matchAll(/scrLangNote\.value = "([^"]+)"/g)) used.add(m[1]);
  /* 保存的结果写在按钮上（save-btn.js）：按钮上的短原因和按钮下面那一行说明也要有译文。 */
  for (const id of ["scrlang"]) {
    for (const m of script.matchAll(new RegExp("saveBtns\\.(?:ok|restart|fail|silent)\\(\"" + id + "\"((?:, \"[^\"]*\")*)\\)", "g"))) {
      for (const one of m[1].matchAll(/"([^"]+)"/g)) used.add(one[1]);
    }
  }
  ["保存中…", "保存成功", "保存失败", "保存失败：{why}", "充电桩没有应答"].forEach((key) => used.add(key));
  assert.ok(used.size >= 8);
  assert.match(vue, /@click="openScrLang"/);
  assert.match(vue, /if \(page\.value === "scrlang"\) return "屏幕语言";/);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  for (const lang of langs) {
    for (const key of used) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
    }
  }
});
