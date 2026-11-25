/* 屏幕颜色（迪文屏充电界面的配色主题：首页、状态小图、停止确认层、语言列表）。
 *
 * 命令（固件 wb2.c，和 SCRLANGGET / SCRLANGSET 同一种写法；要先 AUTH 通过）：
 *   SCRTHEMEGET              应答 ACK SCRTHEME <主题>
 *   SCRTHEMESET\t<主题>      应答 ACK SCRTHEMESET OK / ACK SCRTHEMESET FAIL
 * <主题>：0 红、1 橙、2 黄（默认，原来的金色）、3 绿、4 青、5 蓝、6 紫，和屏幕设置第 6 页
 * 的 Screen Color 是同一个值，和屏幕语言存在充电桩用户页的同一条记录里，断电保留。设置以后屏幕
 * 马上换色。更早的固件不认识这两条，什么都不回。屏幕文件没有重烧（没有配色主题的图）时
 * 充电桩照样收、照样存，屏幕不变色，重烧以后生效。
 *
 * SCREEN_THEMES 的顺序和颜色跟固件 screen.c（THEME_ 开头的宏）、
 * 文档/迪文屏/工具/theme_pages.py 的 NAMES / RGB 一样，test/scrtheme.test.mjs 逐项比对。
 * name 是中文的键，界面上用 t() 翻译。 */

export const SCREEN_THEMES = [
  { id: 0, code: "red", name: "红色", color: "#ff5252" },
  { id: 1, code: "orange", name: "橙色", color: "#ff8820" },
  { id: 2, code: "yellow", name: "黄色", color: "#ffd000" },
  { id: 3, code: "green", name: "绿色", color: "#40d868" },
  { id: 4, code: "cyan", name: "青色", color: "#20d4e4" },
  { id: 5, code: "blue", name: "蓝色", color: "#489cff" },
  { id: 6, code: "purple", name: "紫色", color: "#b880ff" },
];
export const SCREEN_THEME_DEFAULT = 2;

export function screenThemeName(id) {
  const item = SCREEN_THEMES.find((theme) => theme.id === id);
  return item ? item.name : "";
}

export function screenThemeColor(id) {
  const item = SCREEN_THEMES.find((theme) => theme.id === id);
  return item ? item.color : "";
}

/* "ACK SCRTHEME 5" → { kind: "get", theme: 5 }；"ACK SCRTHEMESET OK" →
 * { kind: "set", ok: true }；别的行返回 null。主题不是 0–6 时 theme 是 null。
 * "ACK SCRTHEMEGET AUTH" 这类鉴权应答不在这里认（auth.js）。 */
export function parseScrThemeAck(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK") return null;
  if (part[1] === "SCRTHEMESET" && (part[2] === "OK" || part[2] === "FAIL") && part.length === 3) {
    return { kind: "set", ok: part[2] === "OK" };
  }
  if (part[1] === "SCRTHEME" && part.length >= 3) {
    const theme = /^\d$/.test(part[2]) ? Number(part[2]) : NaN;
    return { kind: "get", theme: Number.isInteger(theme) && theme < SCREEN_THEMES.length ? theme : null };
  }
  return null;
}

async function askTwice(io, command, accept, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!io.alive()) return null;
    const line = await io.ask(command, accept, ms);
    if (line != null && accept(line)) return line;
  }
  return null;
}

const isGet = (line) => { const got = parseScrThemeAck(line); return got !== null && got.kind === "get"; };
const isSet = (line) => { const got = parseScrThemeAck(line); return got !== null && got.kind === "set"; };

/* 读桩里的屏幕颜色。
 *   ask(command, accept, ms) / alive() 同 scrlang.js 的 readScreenLang
 * 结果：{ state: "ok", theme } / { state: "silent" }（桩不回：固件太旧）/ { state: "gone" } */
export async function readScreenTheme(io) {
  const ms = io.waitMs || 2000;
  const got = parseScrThemeAck(await askTwice(io, "SCRTHEMEGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!got || got.theme === null) return { state: "silent" };
  return { state: "ok", theme: got.theme };
}

/* 存屏幕颜色，再读回来确认。io.theme 是要存的主题（0–6）。
 *   { state: "ok", theme }           存了，读回来的就是它
 *   { state: "fail", theme? }        桩没收，或者读回来的不是它（带着桩里现在的值）
 *   { state: "silent" }              桩不回
 *   { state: "bad" }                 不是 0–6，没发
 *   { state: "gone" }                连接没了 */
export async function saveScreenTheme(io) {
  const want = Number(io.theme);
  const ms = io.waitMs || 2000;
  if (!Number.isInteger(want) || want < 0 || want >= SCREEN_THEMES.length) return { state: "bad" };
  const ack = parseScrThemeAck(await askTwice(io, "SCRTHEMESET\t" + want, isSet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!ack) return { state: "silent" };
  const back = parseScrThemeAck(await askTwice(io, "SCRTHEMEGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!back || back.theme === null) return ack.ok ? { state: "silent" } : { state: "fail" };
  if (ack.ok && back.theme === want) return { state: "ok", theme: back.theme };
  return { state: "fail", theme: back.theme };
}
