/* 6 位数字密码：自己画的数字键盘、改密码 / 改超级密码的流程和应答（固件 wb2.c 的 PINSET /
 * SUPERGET / SUPERSET）。这个文件不碰界面和蓝牙，主机测试 test/pin-change.test.mjs 直接用。
 *
 * 为什么自己画键盘：6 位数字用系统输入法又慢又挡画面。密码页和改密码页上没有任何
 * input / textarea，六个方格只是显示（PinPad.vue），所以系统键盘不会弹出来。外接键盘的
 * 数字键、退格键照样能用（keyFromEvent），不靠输入框的焦点。
 *
 * 命令（都要这条连接先通过 AUTH）：
 *   PINSET\t<6 位数字>     改管理员密码（屏幕和蓝牙连接是同一个）
 *                          ACK PINSET OK / ACK PINSET FAIL
 *   SUPERGET               ACK SUPER DEFAULT（还是默认值）/ ACK SUPER CUSTOM（已经改过）
 *   SUPERSET\t<6 位数字>   改超级密码。ACK SUPERSET OK / ACK SUPERSET FAIL
 * 另外可能收到 ACK <命令名> AUTH（鉴权被桩作废了）和 ACK <命令名> BUSY（写得太频繁），
 * 都按“这一次没改成”处理。更早的固件不认识这三条，什么都不回。 */
import { versionTriple } from "./time-sync.js";
import { deriveSuperPin } from "./super-pass.js";

export const PIN_LEN = 6;
/* 支持改密码 / 超级密码的最低固件版本。只用来决定桩不回应答时怎么说：版本比它低就是
 * “固件不支持，请先升级固件”，不低于它就是“没有应答，请重试”。能不能用以桩回不回
 * SUPERGET 为准，不拿版本号拦人。 */
export const PIN_CHANGE_MIN_FW = "3.0.9";

/* 固件版本够不够：true / false；读不出版本返回 null。 */
export function pinChangeFwOk(fwVersion) {
  const have = versionTriple(fwVersion);
  const need = versionTriple(PIN_CHANGE_MIN_FW);
  if (!have) return null;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

/* ---- 键盘 ---- */

/* 键盘上的十二个键，从左到右、从上到下。 */
export const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

function digitsOnly(text) {
  return String(text == null ? "" : text).replace(/\D/g, "").slice(0, PIN_LEN);
}

/* 在已经输入的数字后面按一个键："0".."9" 加一位（满 6 位不再加），"back" 删一位，
 * "clear" 清空。别的键不动。 */
export function pinEdit(text, key) {
  const now = digitsOnly(text);
  if (key === "back") return now.slice(0, -1);
  if (key === "clear") return "";
  if (/^\d$/.test(String(key))) return now.length < PIN_LEN ? now + key : now;
  return now;
}

/* 六个方格：filled 已经输入（界面上画 ●，不显示数字），on 是下一位要输入的那一格。 */
export function pinCells(text, active) {
  const n = digitsOnly(text).length;
  const out = [];
  for (let i = 0; i < PIN_LEN; i++) out.push({ filled: i < n, on: !!active && i === n });
  return out;
}

/* 外接键盘：数字键、小键盘数字、退格、Delete（清空）、回车。按了 Ctrl / Alt / Meta 的不管。 */
export function keyFromEvent(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = String(event.key == null ? "" : event.key);
  if (/^\d$/.test(key)) return key;
  if (key === "Backspace") return "back";
  if (key === "Delete" || key === "Clear") return "clear";
  if (key === "Enter") return "enter";
  return null;
}

/* ---- 输两遍 ---- */

/* 改密码时的输入：先输第一遍，满 6 位自动切到第二遍；第二遍满 6 位时和第一遍一样就可以
 * 点“确认”，不一样就两遍都清掉、从头再输。
 *   step    0 = 在输第一遍，1 = 在输第二遍
 *   error   "" 或者 "两次输入不一致，请重新输入"（按下一个键就清掉） */
export const PAD_MISMATCH = "两次输入不一致，请重新输入";

export function padNew() {
  return { step: 0, first: "", second: "", error: "" };
}

export function padReady(pad) {
  return !!pad && pad.first.length === PIN_LEN && pad.second === pad.first;
}

/* 可以提交的那个密码；还没输完两遍或者不一致是 ""。 */
export function padValue(pad) {
  return padReady(pad) ? pad.first : "";
}

/* 现在这一遍已经输入的数字（给方格用）。 */
export function padShown(pad) {
  return pad.step === 0 ? pad.first : pad.second;
}

export function padKey(pad, key) {
  const next = { step: pad.step, first: pad.first, second: pad.second, error: "" };
  if (key === "clear") return padNew();
  if (next.step === 0) {
    next.first = pinEdit(next.first, key);
    if (next.first.length === PIN_LEN) next.step = 1;
    return next;
  }
  if (key === "back" && next.second === "") {
    /* 第二遍还是空的时候按退格：回到第一遍，删掉它的最后一位。 */
    next.step = 0;
    next.first = next.first.slice(0, -1);
    return next;
  }
  next.second = pinEdit(next.second, key);
  if (next.second.length === PIN_LEN && next.second !== next.first) {
    const fresh = padNew();
    fresh.error = PAD_MISMATCH;
    return fresh;
  }
  return next;
}

/* ---- 应答 ---- */

export function isPinCommand(name) {
  return name === "PINSET" || name === "SUPERSET" || name === "SUPERGET";
}

/* "ACK PINSET OK" → { kind: "pinset", ok: true }
 * "ACK SUPERSET FAIL" → { kind: "superset", ok: false, why: "fail" }
 * "ACK PINSET AUTH" / "ACK SUPERSET BUSY" → ok: false，why: "auth" / "busy"
 * "ACK SUPER DEFAULT" / "ACK SUPER CUSTOM" → { kind: "super", custom: false / true }
 * "ACK SUPERGET AUTH" / "ACK SUPERGET BUSY" → { kind: "super", custom: null, why }
 * 别的行返回 null。按整行认；应答里从来没有密码，多出来的字段一律不认。 */
export function parsePinLine(line) {
  if (typeof line !== "string") return null;
  const part = line.trim().split(/\s+/);
  if (part[0] !== "ACK" || part.length !== 3) return null;
  if (part[1] === "PINSET" || part[1] === "SUPERSET") {
    const kind = part[1] === "PINSET" ? "pinset" : "superset";
    if (part[2] === "OK") return { kind, ok: true };
    if (part[2] === "FAIL") return { kind, ok: false, why: "fail" };
    if (part[2] === "AUTH") return { kind, ok: false, why: "auth" };
    if (part[2] === "BUSY") return { kind, ok: false, why: "busy" };
    return null;
  }
  if (part[1] === "SUPER") {
    if (part[2] === "DEFAULT") return { kind: "super", custom: false };
    if (part[2] === "CUSTOM") return { kind: "super", custom: true };
    return null;
  }
  if (part[1] === "SUPERGET" && (part[2] === "AUTH" || part[2] === "BUSY")) {
    return { kind: "super", custom: null, why: part[2].toLowerCase() };
  }
  return null;
}

/* ---- 改密码的流程 ---- */

/* kind: "user" 改管理员密码，"super" 改超级密码。
 * stage:
 *   enter     在输入（两遍）
 *   warn      改超级密码：弹出“忘记密码后将无法重置”，等用户点 取消 / 确认修改
 *   sending   命令发出去了，等应答
 *   done      改成了
 * note 是给用户看的一句话（中文键）；noteVars 是里面的变量。 */
export function flowNew(kind) {
  return { kind: kind === "super" ? "super" : "user", stage: "enter", pad: padNew(), note: "", noteVars: null };
}

export function flowCommand(flow) {
  const pin = padValue(flow.pad);
  if (!pin) return "";
  return (flow.kind === "super" ? "SUPERSET\t" : "PINSET\t") + pin;
}

function withNote(flow, stage, note, vars) {
  return { kind: flow.kind, stage, pad: flow.pad, note: note || "", noteVars: vars || null };
}

/* 走一步。返回 { flow, send }：send 不是 "" 时把它发给桩，然后等应答。
 * action:
 *   { t: "key", key }         键盘上按了一个键（输入阶段才管）
 *   { t: "confirm" }          点了“确认修改”：管理员密码直接发；超级密码先弹警告
 *   { t: "warn-cancel" }      警告框点了“取消”：回到输入，输过的还在
 *   { t: "warn-ok" }          警告框点了“确认修改”：发 SUPERSET
 *   { t: "reply", reply }     parsePinLine 的结果
 *   { t: "timeout", fwOk }    等不到应答；fwOk 是 pinChangeFwOk 的结果 */
export function flowStep(flow, action) {
  const a = action || {};
  if (a.t === "key") {
    if (flow.stage !== "enter") return { flow, send: "" };
    const pad = padKey(flow.pad, a.key);
    return { flow: { kind: flow.kind, stage: "enter", pad, note: pad.error, noteVars: null }, send: "" };
  }
  if (a.t === "confirm") {
    if (flow.stage !== "enter" || !padReady(flow.pad)) return { flow, send: "" };
    if (flow.kind === "super") return { flow: withNote(flow, "warn", ""), send: "" };
    return { flow: withNote(flow, "sending", "正在修改"), send: flowCommand(flow) };
  }
  if (a.t === "warn-cancel") {
    if (flow.stage !== "warn") return { flow, send: "" };
    return { flow: withNote(flow, "enter", ""), send: "" };
  }
  if (a.t === "warn-ok") {
    if (flow.stage !== "warn" || !padReady(flow.pad)) return { flow, send: "" };
    return { flow: withNote(flow, "sending", "正在修改"), send: flowCommand(flow) };
  }
  if (a.t === "reply") {
    const want = flow.kind === "super" ? "superset" : "pinset";
    if (flow.stage !== "sending" || !a.reply || a.reply.kind !== want) return { flow, send: "" };
    if (a.reply.ok) {
      return { flow: withNote(flow, "done", flow.kind === "super" ? "超级密码已修改" : "管理员密码已修改"), send: "" };
    }
    /* 没改成：输过的清掉，从头再来。 */
    return { flow: { kind: flow.kind, stage: "enter", pad: padNew(), note: "修改失败，请重试", noteVars: null }, send: "" };
  }
  if (a.t === "timeout") {
    if (flow.stage !== "sending") return { flow, send: "" };
    const silent = silentNote(a.fwOk);
    return { flow: { kind: flow.kind, stage: "enter", pad: padNew(), note: silent.text, noteVars: silent.vars }, send: "" };
  }
  return { flow, send: "" };
}

/* 桩不回应答时的那一句。固件版本够新（fwOk 为真）是“没有应答，请重试”；版本低或者读不出来
 * 是“固件不支持，请先升级固件”。 */
export function silentNote(fwOk) {
  if (fwOk === true) return { text: "充电桩没有应答，请重试", vars: null };
  return { text: "固件不支持，请先升级固件（需要 {v} 或更高版本）", vars: { v: PIN_CHANGE_MIN_FW } };
}

/* ---- 改完以后，手机上记住的密码怎么办 ----
 * saved    这台手机为这台桩记住的密码（"" = 没记）
 * session  这条连接上通过 AUTH 用的密码（悄悄重新核对时用它）
 * 返回新的 { saved, session }。 */

/* 管理员密码改成了 pin：这条连接以后用新密码重新核对；原来记着密码的，换成新的；
 * 原来没记的（用户没勾“保存密码”），还是不记。 */
export function rememberAfterPinset(have, pin) {
  const saved = /^\d{6}$/.test(String(have.saved || "")) ? String(pin) : "";
  return { saved, session: String(pin) };
}

/* 超级密码改成了 pin。只有“记住的那个正好是被改掉的旧超级密码”才换：
 * 旧的超级密码是默认值（wasCustom 为假）时，App 能从桩的名字算出来，对得上就换成新的；
 * 旧的已经是自定义值时 App 不知道它是多少，一律不动（记住的要是旧超级密码，下次连接
 * 核对不过，照现有的流程回到输密码那一页）。 */
export function rememberAfterSuperset(have, pin, name, wasCustom) {
  const old = wasCustom ? "" : deriveSuperPin(name);
  const saved = String(have.saved || "");
  const session = String(have.session || "");
  return {
    saved: old && saved === old ? String(pin) : saved,
    session: old && session === old ? String(pin) : session,
  };
}

/* 这个文件和改密码页用到的界面文字（中文键），测试拿它核对各语言都翻了。 */
export const PIN_TEXTS = [
  "取消",
  "修改密码",
  "修改管理员密码或超级密码",
  "修改管理员密码",
  "屏幕和蓝牙连接共用的 6 位密码",
  "修改超级密码",
  "忘记管理员密码时，可以用超级密码连接蓝牙并重设。",
  "超级密码默认由设备编号推算，建议修改。",
  "默认密码",
  "已修改",
  "固件不支持，请先升级固件（需要 {v} 或更高版本）",
  "充电桩没有应答，请重试",
  "重试",
  "请输入新的 6 位密码",
  "请再输入一次",
  "两次输入不一致，请重新输入",
  "确认修改",
  "忘记密码后将无法重置",
  "正在修改",
  "管理员密码已修改",
  "超级密码已修改",
  "修改失败，请重试",
  "清空",
  "退格",
  "已输入 {n} 位，共 6 位",
];
