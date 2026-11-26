/* 蓝牙广播看护的诊断计数（固件 1.3.0 起）。
 *
 * 命令：ADVGET
 * 应答：ACK ADV restarts=<n> fail=<n> resets=<n> reason=<词> reboots=<n> drops=<n>
 *   restarts  看护重开广播的次数            fail     其中没成的次数
 *   resets    复位模组的次数（+++ 加 AT+RST）  reason   最近一次重开的原因
 *   reboots   认出模组自己重启的次数         drops    模组串口收丢的字节数
 * 都从充电桩上电算起，不存盘。原因是这几个词之一：none、periodic、wifi、retry、mode、name、
 * module-reboot、transparent、no-reply，界面上原样显示。
 * 1.2.0 及更早的固件不认这条命令，不回任何东西：App.vue 先问兼容框架（fw-compat.js 的
 * advDiag），没有这项就不发。 */

export const ADV_FIELDS = ["restarts", "fail", "resets", "reason", "reboots", "drops"];

/* "ACK ADV restarts=3 fail=1 …" → { restarts, fail, resets, reason, reboots, drops }；
 * 不是这条应答、缺字段或数字不对返回 null。字段顺序不限，多出来的字段不看。 */
export function parseAdv(line) {
  if (typeof line !== "string") return null;
  const part = line.replace(/[\r\n]+$/, "").trim().split(/\s+/);
  if (part[0] !== "ACK" || part[1] !== "ADV") return null;
  const out = {};
  for (let i = 2; i < part.length; i++) {
    const eq = part[i].indexOf("=");
    if (eq <= 0) continue;
    const key = part[i].slice(0, eq);
    const value = part[i].slice(eq + 1);
    if (key === "reason") {
      if (/^[a-z-]{1,20}$/.test(value)) out.reason = value;
    } else if (ADV_FIELDS.indexOf(key) >= 0 && /^\d{1,10}$/.test(value)) {
      out[key] = parseInt(value, 10);
    }
  }
  for (const key of ADV_FIELDS) {
    if (out[key] === undefined) return null;
  }
  return out;
}

/* 界面上的几行：名字（中文是翻译的键）和值。 */
export function advRows(diag) {
  if (!diag) return [];
  return [
    { label: "重开广播", value: String(diag.restarts) },
    { label: "重开失败", value: String(diag.fail) },
    { label: "复位模组", value: String(diag.resets) },
    { label: "模组自己重启", value: String(diag.reboots) },
    { label: "串口丢字节", value: String(diag.drops) },
    { label: "最近一次原因", value: diag.reason },
  ];
}

/* 读一次。ask(command, accept, ms)：发一条命令，等 accept(line) 为真的那一行，超时返回 null。
 * 结果：{ state: "ok", diag } / { state: "silent" }（两次都没回）/ { state: "gone" } */
export async function readAdv(io) {
  const accept = (line) => parseAdv(line) !== null;
  for (let round = 0; round < 2; round++) {
    if (!io.alive()) return { state: "gone" };
    const line = await io.ask("ADVGET", accept, 1500);
    if (!io.alive()) return { state: "gone" };
    const diag = parseAdv(line);
    if (diag) return { state: "ok", diag };
  }
  return { state: "silent" };
}
