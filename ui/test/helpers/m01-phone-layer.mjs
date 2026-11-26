/* 手机蓝牙层（AC06/tools/ble-finder/src/com/evcity/acv2/MainActivity.java）在连 M01 时的参照实现，
 * 给 M01 模块的主机测试用（从 M01 仓库的 test/helpers/phone-layer.mjs 拷来，改成读合并后的 Java）。
 *
 * 行首表直接从 Java 源码里读出来（FRAME_HEADS_M01、knownLineM01），所以 Java 那边改了表，这里的
 * 测试跟着变。splitFrames 照 takeFrames / frameEnd / nextHead / insideLongerHead 的规则切行：
 * 桩在 AT 模式下发的行后面没有换行，靠行首在字节流里找下一行的开头。 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const JAVA_PATH = resolve(here, "../../../src/com/evcity/acv2/MainActivity.java");
export const javaSource = readFileSync(JAVA_PATH, "utf8");

function unescape(text) {
  return text.replace(/\\t/g, "\t");
}

function block(start, end) {
  const from = javaSource.indexOf(start);
  if (from < 0) throw new Error("MainActivity.java 里找不到 " + start);
  return javaSource.slice(from, javaSource.indexOf(end, from));
}
function heads(name) {
  return [...block(name + " = new byte[][] {", "};").matchAll(/"((?:[^"\\]|\\.)*)"\.getBytes/g)].map((m) => unescape(m[1]));
}
function known(name) {
  const text = block("static boolean " + name + "(String line) {", "\n    }\n");
  return {
    prefixes: [...text.matchAll(/line\.startsWith\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => unescape(m[1])),
    exact: [...text.matchAll(/"((?:[^"\\]|\\.)*)"\.equals\(line\)/g)].map((m) => unescape(m[1])),
  };
}
/* M01 的表（这些测试用的）；AC06 的表也读出来，给“两张表不混”的测试用。 */
export const FRAME_HEADS = heads("FRAME_HEADS_M01");
export const FRAME_HEADS_AC06 = heads("FRAME_HEADS_AC06");
const m01Known = known("knownLineM01");
export const KNOWN_PREFIXES = m01Known.prefixes;
export const KNOWN_EXACT = m01Known.exact;
export const AC06_KNOWN = known("knownLineAc06");

export function knownLine(line) {
  return KNOWN_PREFIXES.some((head) => line.indexOf(head) === 0) || KNOWN_EXACT.indexOf(line) >= 0;
}

function insideLongerHead(text, at) {
  for (const head of FRAME_HEADS) {
    for (let i = Math.max(0, at - head.length + 1); i < at; i++) {
      if (i + head.length > at && text.indexOf(head, i) === i) return true;
    }
  }
  return false;
}
function nextHead(text) {
  let best = -1;
  for (const head of FRAME_HEADS) {
    let search = 1;
    while (search < text.length) {
      const at = text.indexOf(head, search);
      if (at < 0) break;
      if (!insideLongerHead(text, at)) {
        if (best < 0 || at < best) best = at;
        break;
      }
      search = at + 1;
    }
  }
  return best;
}

/* 一串收到的字节（几行连在一起，行与行之间可以有也可以没有换行）→ 界面收到的行。 */
export function splitFrames(stream) {
  let rest = stream.replace(/^[\r\n\0]+/, "");
  const out = [];
  const accept = (raw) => {
    let line = raw.replace(/^[ \t]+/, "").replace(/[ \t\r\n]+$/, "");
    if (!line || line.length > 380) return;
    /* acceptFrame：AT 模式下模组把逗号换成了 0x00，这里换回来。 */
    line = line.replace(/\0/g, ",");
    if (/[\x00-\x08\x0A-\x1F\x7F�]/.test(line) || !knownLine(line)) return;
    out.push(line);
  };
  while (rest.length) {
    const newline = rest.search(/[\r\n]/);
    const headAt = nextHead(rest);
    let end = newline;
    if (headAt > 0 && (newline < 0 || headAt < newline)) end = headAt;
    if (end <= 0) break;
    accept(rest.slice(0, end));
    rest = rest.slice(end).replace(/^[\r\n\0]+/, "");
  }
  /* 剩下的那一段等 120 ms 没有后续就当一行。 */
  if (rest.length) accept(rest);
  return out;
}

/* 这一行单独发时能原样到界面：行首认识，正文里没有别的行首把它切开。 */
export function phoneKeeps(line) {
  const got = splitFrames(line);
  return got.length === 1 && got[0] === line.replace(/[ \t]+$/, "");
}

/* AT 模式下桩发出去、手机收到的字节：一行一条 AT+BLESEND，后面没有换行；模组把正文里的
 * 每个逗号换成 0x00（2026-11-23 在手机上抓到的，长度不变）。 */
export function atModeStream(lines) {
  return lines.map((line) => line.replace(/,/g, "\0")).join("");
}
