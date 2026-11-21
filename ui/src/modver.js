/* 蓝牙/WiFi 模组（安信可 Ai-WB2）的版本（固件 2.6.12 起）。
 *
 * 命令：MODVERGET
 * 应答：ACK MODVER <行数>\t<名字:值>\t<名字:值>…
 *   行数 0：桩还没从模组读到（模组没回答 AT+GMR），桩会在串口空着时补问，过两三秒再读。
 *   每一行是模组对 AT+GMR 回的原文，冒号两边的空格去掉了。手册上是三行：
 *       at version:release/V4.18_P2.19.1
 *       sdk version:release_bl_iot_sdk_1.6.36
 *       firmware version:V4.18_P1.4.4-e15d67b
 *   桩最多给 4 行，每行最多 51 个字符；大写字母后面的空格桩换成了下划线。
 * 2.6.11 及更早的固件不认识这条命令，什么都不回：等不到应答就显示“固件不支持”。 */

export const MODVER_MIN_VERSION = [2, 6, 12];

/* "ACK MODVER 3\t..." → { count, items: [{ key, value }] }；不是这条应答返回 null。
 * 认不出的行（没有冒号）留着原文，key 是 ""。 */
export function parseModver(line) {
  if (typeof line !== "string") return null;
  const part = line.replace(/[\r\n]+$/, "").split("\t");
  const head = part[0].trim().split(/\s+/);
  if (head[0] !== "ACK" || head[1] !== "MODVER") return null;
  const count = /^\d{1,2}$/.test(head[2] || "") ? parseInt(head[2], 10) : 0;
  const items = [];
  for (let i = 1; i < part.length && items.length < 8; i++) {
    const text = part[i].trim();
    if (!text) continue;
    const colon = text.indexOf(":");
    if (colon <= 0) {
      items.push({ key: "", value: text });
      continue;
    }
    const value = text.slice(colon + 1).trim();
    if (!value) continue;
    items.push({ key: text.slice(0, colon).trim().toLowerCase().replace(/[\s_]+/g, " "), value });
  }
  /* 行数写着有、正文却没有：当作没读到。 */
  return { count: items.length ? Math.max(count, items.length) : 0, items };
}

/* 各行在界面上的名字（中文是翻译的键）。不认识的名字原样显示。 */
const LABELS = {
  "at version": "模组版本号",
  "firmware version": "模组固件版本号",
  "sdk version": "SDK 版本",
  "compile time": "编译时间",
};
export function modverLabel(key) {
  return LABELS[key] || key || "版本信息";
}

/* 菜单那一行右边显示的短版本：AT 版本去掉 "release/"，例如 V4.18_P2.19.1。
 * 没有 AT 版本就用模组固件版本，再没有用第一行。 */
export function modverShort(items) {
  if (!Array.isArray(items) || !items.length) return "";
  const pick = items.find((item) => item.key === "at version") ||
    items.find((item) => item.key === "firmware version") || items[0];
  return String(pick.value).replace(/^release\//i, "");
}

/* 桩的固件认不认识 MODVERGET。true / false；版本没读到返回 null（那就问一次，等不到再说）。 */
export function modverSupported(fwVersion) {
  const m = String(fwVersion == null ? "" : fwVersion).trim().replace(/^[Vv]/, "")
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])/);
  if (!m) return null;
  const have = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== MODVER_MIN_VERSION[i]) return have[i] > MODVER_MIN_VERSION[i];
  }
  return true;
}

/* 读一次模组版本。
 *   ask(command, accept, ms)  发一条命令，等 accept(line) 为真的那一行；超时返回 null
 *   wait(ms)                  等一会儿
 *   alive()                   连接还在、这一轮没被顶掉
 *   fw                        桩的固件版本（STAT 行里的），没读到传 ""
 * 结果：{ state: "ok", items } 读到了
 *       { state: "unsupported" } 固件太旧，或者问了两次都不回
 *       { state: "empty" }       固件认识这条命令，但模组一直没回答 AT+GMR
 *       { state: "gone" }        连接没了 */
export async function readModver(io) {
  const accept = (line) => parseModver(line) !== null;
  if (modverSupported(io.fw) === false) return { state: "unsupported" };
  let silent = 0;
  for (let round = 0; round < 6; round++) {
    if (!io.alive()) return { state: "gone" };
    const line = await io.ask("MODVERGET", accept, 1500);
    if (!io.alive()) return { state: "gone" };
    const got = parseModver(line);
    if (!got) {
      silent += 1;
      if (silent >= 2) return { state: modverSupported(io.fw) ? "empty" : "unsupported" };
      continue;
    }
    silent = 0;
    if (got.count > 0) return { state: "ok", items: got.items };
    await io.wait(2500);
  }
  return { state: "empty" };
}
