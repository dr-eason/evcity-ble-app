/* 屏幕语言（迪文屏 S3.4 的充电界面：首页四页、状态小图、停止确认层、首页的状态句）。
 *
 * 命令（固件 wb2.c，2.8.0 起才有；要先 AUTH 通过）：
 *   SCRLANGGET               应答 ACK SCRLANG <语言>
 *   SCRLANGSET\t<语言>       应答 ACK SCRLANGSET OK / ACK SCRLANGSET FAIL
 * <语言>：0 English、1 Español、2 Português、3 Français、4 中文，和屏幕右上角的下拉列表是
 * 同一个值，存在充电桩的用户页里，断电保留。设置以后屏幕首页马上换过去。
 * 更早的固件不认识这两条，什么都不回。
 *
 * SCREEN_LANGS 的顺序和固件 screen.c 的 s_lang_base[]、AC06/文档/迪文屏/工具/lang_pages.py 的
 * LANGS 一样，test/scrlang.test.mjs 逐项比对。名字用各自语言写，和屏上的列表一样，不翻译。 */

export const SCREEN_LANGS = [
  { id: 0, code: "EN", name: "English" },
  { id: 1, code: "ES", name: "Español" },
  { id: 2, code: "PT", name: "Português" },
  { id: 3, code: "FR", name: "Français" },
  { id: 4, code: "ZH", name: "中文" },
];

export function screenLangName(id) {
  const item = SCREEN_LANGS.find((lang) => lang.id === id);
  return item ? item.name : "";
}

/* "ACK SCRLANG 4" → { kind: "get", lang: 4 }；"ACK SCRLANGSET OK" →
 * { kind: "set", ok: true }；别的行返回 null。语言不是 0–4 时 lang 是 null。
 * "ACK SCRLANGGET AUTH" 这类鉴权应答不在这里认（auth.js）。 */
export function parseScrLangAck(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK") return null;
  if (part[1] === "SCRLANGSET" && (part[2] === "OK" || part[2] === "FAIL") && part.length === 3) {
    return { kind: "set", ok: part[2] === "OK" };
  }
  if (part[1] === "SCRLANG" && part.length >= 3) {
    const lang = /^\d$/.test(part[2]) ? Number(part[2]) : NaN;
    return { kind: "get", lang: Number.isInteger(lang) && lang < SCREEN_LANGS.length ? lang : null };
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

const isGet = (line) => { const got = parseScrLangAck(line); return got !== null && got.kind === "get"; };
const isSet = (line) => { const got = parseScrLangAck(line); return got !== null && got.kind === "set"; };

/* 读桩里的屏幕语言。
 *   ask(command, accept, ms) / alive() 同 tz.js 的 saveZone
 * 结果：{ state: "ok", lang } / { state: "silent" }（桩不回：固件太旧）/ { state: "gone" } */
export async function readScreenLang(io) {
  const ms = io.waitMs || 2000;
  const got = parseScrLangAck(await askTwice(io, "SCRLANGGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!got || got.lang === null) return { state: "silent" };
  return { state: "ok", lang: got.lang };
}

/* 存屏幕语言，再读回来确认。io.lang 是要存的语言（0–4）。
 *   { state: "ok", lang }            存了，读回来的就是它
 *   { state: "fail", lang? }         桩没收，或者读回来的不是它（带着桩里现在的值）
 *   { state: "silent" }              桩不回
 *   { state: "bad" }                 不是 0–4，没发
 *   { state: "gone" }                连接没了 */
export async function saveScreenLang(io) {
  const want = Number(io.lang);
  const ms = io.waitMs || 2000;
  if (!Number.isInteger(want) || want < 0 || want >= SCREEN_LANGS.length) return { state: "bad" };
  const ack = parseScrLangAck(await askTwice(io, "SCRLANGSET\t" + want, isSet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!ack) return { state: "silent" };
  const back = parseScrLangAck(await askTwice(io, "SCRLANGGET", isGet, ms));
  if (!io.alive()) return { state: "gone" };
  if (!back || back.lang === null) return ack.ok ? { state: "silent" } : { state: "fail" };
  if (ack.ok && back.lang === want) return { state: "ok", lang: back.lang };
  return { state: "fail", lang: back.lang };
}
