/* 屏幕颜色设置（SCRTHEMEGET / SCRTHEMESET）的主机测试：
 *
 *     node --test APP/ui/test/scrtheme.test.mjs
 *
 * 假桩按固件 wb2.c 的规则应答；旧固件对这两条一声不吭。 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCREEN_THEMES, SCREEN_THEME_DEFAULT, parseScrThemeAck, readScreenTheme, saveScreenTheme,
  screenThemeColor, screenThemeName,
} from "../src/scrtheme.js";
import { parseScrLangAck } from "../src/scrlang.js";
import { languages, translate } from "../src/i18n.js";
import { scrThemePacks } from "../src/packs-scrtheme.js";
import { parseAuthLine, resendable } from "../src/auth.js";
import { SETTINGS_GROUPS } from "../src/tabs.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("七种颜色，顺序、默认值和颜色跟固件、屏幕工具一样", () => {
  assert.deepEqual(SCREEN_THEMES.map((item) => item.code),
    ["red", "orange", "yellow", "green", "cyan", "blue", "purple"]);
  assert.deepEqual(SCREEN_THEMES.map((item) => item.id), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(SCREEN_THEME_DEFAULT, 2);
  const header = read("AC06/app/inc/screen.h");
  assert.match(header, /#define SCREEN_THEME_COUNT\s+7u/);
  const screen = read("AC06/app/src/screen.c");
  assert.match(screen, /#define THEME_DEFAULT\s+2u/);
  assert.match(screen, /#define THEME_COUNT\s+SCREEN_THEME_COUNT/);
  assert.equal(screenThemeName(5), "蓝色");
  assert.equal(screenThemeName(9), "");
  assert.equal(screenThemeColor(0), "#ff5252");
  assert.equal(screenThemeColor(9), "");
  let tool;
  try {
    const code = "import sys, json; sys.path.insert(0, sys.argv[1]); import theme_pages as tp; " +
      "print(json.dumps([list(tp.NAMES), [list(c) for c in tp.RGB], tp.DEFAULT, list(tp.NAMES_ZH)]))";
    tool = JSON.parse(execFileSync("python3", ["-c", code, resolve(root, "AC06/文档/迪文屏/工具")], { encoding: "utf8" }));
  } catch (error) {
    const text = read("AC06/文档/迪文屏/工具/theme_pages.py");
    assert.match(text, /NAMES = \("red", "orange", "yellow", "green", "cyan", "blue", "purple"\)/);
    return;
  }
  assert.deepEqual(tool[0], SCREEN_THEMES.map((item) => item.code));
  const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  assert.deepEqual(tool[1].map(hex), SCREEN_THEMES.map((item) => item.color));
  assert.equal(tool[2], SCREEN_THEME_DEFAULT);
  assert.deepEqual(tool[3].map((name) => name + "色"), SCREEN_THEMES.map((item) => item.name));
});

test("固件认这两条命令，未鉴权时拒绝（不在放行名单里）", () => {
  const wb2 = read("AC06/app/src/wb2.c");
  assert.match(wb2, /strcmp\(text, "SCRTHEMEGET"\) == 0 \|\| strncmp\(text, "SCRTHEMESET\\t", 12\) == 0/);
  assert.match(wb2, /"ACK SCRTHEME %u"/);
  assert.match(wb2, /"ACK SCRTHEMESET OK" : "ACK SCRTHEMESET FAIL"/);
  /* 没鉴权只放行 HB、AUTH、STATUS。 */
  assert.match(wb2, /if\(!s_ble_authed && strcmp\(cmd, "STATUS"\) != 0\)\{/);
  /* 被拒以后 App 认得出是要重新鉴权，并补发这条命令。 */
  assert.deepEqual(parseAuthLine("ACK SCRTHEMESET AUTH"), { kind: "need", cmd: "SCRTHEMESET" });
  assert.deepEqual(parseAuthLine("ACK SCRTHEMEGET AUTH"), { kind: "need", cmd: "SCRTHEMEGET" });
  assert.equal(resendable("SCRTHEMESET\t5"), true);
  assert.equal(parseScrThemeAck("ACK SCRTHEMESET AUTH"), null);
});

test("应答行；和屏幕语言的应答互不相认", () => {
  assert.deepEqual(parseScrThemeAck("ACK SCRTHEME 0"), { kind: "get", theme: 0 });
  assert.deepEqual(parseScrThemeAck("ACK SCRTHEME 6\r\n"), { kind: "get", theme: 6 });
  assert.deepEqual(parseScrThemeAck("ACK SCRTHEME 7"), { kind: "get", theme: null });
  assert.deepEqual(parseScrThemeAck("ACK SCRTHEME x"), { kind: "get", theme: null });
  assert.equal(parseScrThemeAck("ACK SCRTHEME"), null);
  assert.deepEqual(parseScrThemeAck("ACK SCRTHEMESET OK"), { kind: "set", ok: true });
  assert.deepEqual(parseScrThemeAck("ACK SCRTHEMESET FAIL"), { kind: "set", ok: false });
  assert.equal(parseScrThemeAck("ACK SCRLANG 3"), null);
  assert.equal(parseScrThemeAck("ACK SCRLANGSET OK"), null);
  assert.equal(parseScrLangAck("ACK SCRTHEME 3"), null);
  assert.equal(parseScrLangAck("ACK SCRTHEMESET OK"), null);
  assert.equal(parseScrThemeAck("ACK TZ 480"), null);
  assert.equal(parseScrThemeAck(null), null);
});

/* 假桩。old：旧固件，两条都不回。 */
function pile(opts) {
  const st = Object.assign({ theme: 2, old: false, storeFail: false, mute: 0, dead: false }, opts);
  const sent = [];
  function answer(command) {
    sent.push(command);
    if (st.dead || st.old) return null;
    if (st.mute > 0) { st.mute -= 1; return null; }
    if (command === "SCRTHEMEGET") return "ACK SCRTHEME " + st.theme;
    const part = command.split("\t");
    if (part[0] === "SCRTHEMESET") {
      const ok = part.length === 2 && /^\d$/.test(part[1]) && Number(part[1]) < 7 && !st.storeFail;
      if (ok) st.theme = Number(part[1]);
      return ok ? "ACK SCRTHEMESET OK" : "ACK SCRTHEMESET FAIL";
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

test("读：一条 SCRTHEMEGET；丢一条会再问一次；旧固件不回是 silent", async () => {
  let p = pile({ theme: 5 });
  assert.deepEqual(await readScreenTheme(p.io), { state: "ok", theme: 5 });
  assert.deepEqual(p.sent, ["SCRTHEMEGET"]);
  p = pile({ mute: 1, theme: 0 });
  assert.deepEqual(await readScreenTheme(p.io), { state: "ok", theme: 0 });
  assert.deepEqual(p.sent, ["SCRTHEMEGET", "SCRTHEMEGET"]);
  p = pile({ old: true });
  assert.deepEqual(await readScreenTheme(p.io), { state: "silent" });
});

test("存：七种颜色每一种都存得进去，读回来就是它", async () => {
  for (const item of SCREEN_THEMES) {
    const p = pile({ theme: item.id === 0 ? 6 : 0 });
    assert.deepEqual(await saveScreenTheme({ ...p.io, theme: item.id }), { state: "ok", theme: item.id });
    assert.deepEqual(p.sent, ["SCRTHEMESET\t" + item.id, "SCRTHEMEGET"]);
  }
});

test("存：桩没存进去回 FAIL，界面拿到桩里现在的值", async () => {
  const p = pile({ theme: 1, storeFail: true });
  assert.deepEqual(await saveScreenTheme({ ...p.io, theme: 4 }), { state: "fail", theme: 1 });
});

test("存：不是 0–6 不发；旧固件 silent；连接断了 gone", async () => {
  let p = pile({});
  for (const bad of [7, -1, 1.5, "x", NaN, undefined]) {
    assert.deepEqual(await saveScreenTheme({ ...p.io, theme: bad }), { state: "bad" });
  }
  assert.equal(p.sent.length, 0);
  p = pile({ old: true });
  assert.deepEqual(await saveScreenTheme({ ...p.io, theme: 1 }), { state: "silent" });
  assert.deepEqual(p.sent, ["SCRTHEMESET\t1", "SCRTHEMESET\t1"]);
  p = pile({});
  p.st.gone = true;
  assert.deepEqual(await saveScreenTheme({ ...p.io, theme: 1 }), { state: "gone" });
});

test("12 种语言的文案都齐，不是中文键、也不是英文原样", () => {
  const keys = Object.keys(scrThemePacks.en);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    assert.ok(scrThemePacks[lang], lang + " 没有表");
    assert.deepEqual(Object.keys(scrThemePacks[lang]).sort(), keys.slice().sort(), lang + " 的键不齐");
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
      /* Orange 在几种语言里和英文同形，颜色名不查这一条。 */
      const colour = SCREEN_THEMES.some((item) => item.name === key);
      if (lang !== "en" && !colour) assert.notEqual(out, scrThemePacks.en[key], lang + " 用了英文: " + key);
    }
    const names = SCREEN_THEMES.map((item) => translate(lang, item.name));
    assert.equal(new Set(names).size, SCREEN_THEMES.length, lang + " 的颜色名有重复");
  }
  assert.equal(translate("zh", "屏幕颜色"), "屏幕颜色");
  assert.equal(translate("en", "屏幕颜色"), "Screen colour");
});

test("App.vue：屏幕颜色页、菜单、提示用到的字符串在每种语言里都有", () => {
  const vue = read("APP/ui/src/App.vue");
  const block = vue.match(/<section v-else-if="page === 'scrtheme'"[\s\S]*?<\/section>/);
  assert.ok(block, "App.vue 里没有屏幕颜色页");
  const used = new Set(["屏幕颜色", "充电桩屏幕充电界面的配色"]);
  for (const m of block[0].matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  for (const item of SCREEN_THEMES) used.add(item.name);
  const script = vue.slice(vue.indexOf("<script"));
  for (const m of script.matchAll(/scrThemeNote\.value = "([^"]+)"/g)) used.add(m[1]);
  /* 保存的结果写在按钮上（save-btn.js）：按钮上的短原因和按钮下面那一行说明也要有译文。 */
  for (const id of ["scrtheme"]) {
    for (const m of script.matchAll(new RegExp("saveBtns\\.(?:ok|restart|fail|silent)\\(\"" + id + "\"((?:, \"[^\"]*\")*)\\)", "g"))) {
      for (const one of m[1].matchAll(/"([^"]+)"/g)) used.add(one[1]);
    }
  }
  ["保存中…", "保存成功", "保存失败", "保存失败：{why}", "充电桩没有应答"].forEach((key) => used.add(key));
  assert.ok(used.size >= 16);
  assert.match(vue, /@click="openScrTheme"/);
  assert.match(vue, /if \(page\.value === "scrtheme"\) return "屏幕颜色";/);
  /* 入口在“保护与屏幕”一组里，挨着屏幕语言。 */
  const group = SETTINGS_GROUPS.find((item) => item.title === "保护与屏幕");
  assert.equal(group.items.indexOf("openScrTheme"), group.items.indexOf("openScrLang") + 1);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  for (const lang of langs) {
    for (const key of used) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
    }
  }
});
