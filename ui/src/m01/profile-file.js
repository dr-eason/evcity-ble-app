/* M01 一键配置的记录格式、导出和导入（合并进 AC06 App 时新加）。
 *
 * 和 AC06 的分开存（m01-oneclick / ac06-oneclick），记录里 model 是 "M01"，导出文件的类型是
 * evcity-m01-oneclick。导入时型号不是 M01 的整份不导入：AC06 的配置项（最大电流、即插即充、
 * 预约……）M01 没有，反过来也一样，下发了只会一项一项失败。
 * 读写桩的步骤还在 profile.js（从 M01 App 原样拷来）。主机测试在 test/m01-profile-file.test.mjs。 */

import { blankBody, cleanProfileName } from "./profile.js";

export const PROFILE_KEY = "m01-oneclick";
export const PROFILE_MODEL = "M01";
export const PROFILE_FORMAT = 1;
export const EXPORT_KIND = "evcity-m01-oneclick";
/* AC06 的导出文件类型（profile.js 的 EXPORT_KIND），认出来给一句明白的提示。 */
export const AC06_EXPORT_KIND = "evcity-ac06-oneclick";
export const IMPORT_MAX_BYTES = 1024 * 1024;

export function storedProfileOk(item) {
  return !!(item && item.id && item.name && item.body && typeof item.body === "object" &&
    item.model === PROFILE_MODEL);
}

export function makeProfile(name, body, savedAt, id) {
  return { format: PROFILE_FORMAT, id, name, savedAt, model: PROFILE_MODEL, body };
}

/* 记录里的 body 大体对不对：每一项要么没有（读的时候桩没回），要么是对的类型。
 * 值的范围由下发时的读回核对把关（profile.js 的 sameSection）。 */
export function bodyOk(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const blank = blankBody();
  const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!obj(body.safety) || !Number.isFinite(body.safety.over) || !Number.isFinite(body.safety.under)) return false;
  if (body.plim !== null && body.plim !== undefined &&
      !(Array.isArray(body.plim) && body.plim.every((w) => Number.isInteger(w)))) return false;
  if (body.pay !== null && body.pay !== undefined && !obj(body.pay)) return false;
  if (body.par !== null && body.par !== undefined && !Number.isInteger(body.par)) return false;
  if (body.tz !== null && body.tz !== undefined && !Number.isInteger(body.tz)) return false;
  if (body.apn !== null && body.apn !== undefined && !obj(body.apn)) return false;
  for (const key of ["ocfw", "netstop", "wifi", "ocpp"]) {
    if (!obj(body[key]) || typeof body[key].on !== "boolean") return false;
  }
  if (typeof body.tel !== "boolean") return false;
  return Object.keys(blank).every((key) => key in body || blank[key] === null);
}

export function exportText(list, now) {
  const profiles = (Array.isArray(list) ? list : []).filter(storedProfileOk).map((item) => ({
    format: PROFILE_FORMAT,
    id: String(item.id),
    name: String(item.name),
    savedAt: item.savedAt,
    model: PROFILE_MODEL,
    body: item.body,
  }));
  return JSON.stringify({ kind: EXPORT_KIND, format: PROFILE_FORMAT, exportedAt: now, profiles }, null, 2) + "\n";
}

/* evcity-m01-oneclick-20261125-1430.json（按手机本地时间）。 */
export function exportFileName(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return EXPORT_KIND + ".json";
  const p = (n) => (n < 10 ? "0" : "") + n;
  return EXPORT_KIND + "-" + date.getFullYear() + p(date.getMonth() + 1) + p(date.getDate()) + "-" +
    p(date.getHours()) + p(date.getMinutes()) + ".json";
}

function sameProfile(a, b) {
  return a.name === b.name && a.savedAt === b.savedAt && JSON.stringify(a.body) === JSON.stringify(b.body);
}

/* 读导入的文件。认三种写法：导出文件（{ kind, format, profiles }）、记录数组、单独一条记录。
 * 有一条不合格就整份不导入，返回 { error, vars }；合格返回 { list, same }。 */
export function importText(text, existing, newId) {
  const raw = String(text == null ? "" : text);
  if (new TextEncoder().encode(raw).length > IMPORT_MAX_BYTES) return { error: "文件太大，不是一键配置文件" };
  let data;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { error: "这个文件不是一键配置文件" };
  }
  let items;
  if (Array.isArray(data)) items = data;
  else if (data && typeof data === "object" && Array.isArray(data.profiles)) {
    if (data.kind === AC06_EXPORT_KIND) return { error: "这是汽车充电桩 AC06 的一键配置，不能导入到摩托车充电桩 M01" };
    if (data.kind !== undefined && data.kind !== EXPORT_KIND) return { error: "这个文件不是一键配置文件" };
    if (!Number.isInteger(data.format) || data.format < 1) return { error: "这个文件不是一键配置文件" };
    if (data.format > PROFILE_FORMAT) return { error: "这个文件是更新版本的 App 导出的，请先升级 App" };
    items = data.profiles;
  }
  else if (data && typeof data === "object" && data.body) items = [data];
  else return { error: "这个文件不是一键配置文件" };
  if (!items.length) return { error: "文件里没有配置" };
  const have = Array.isArray(existing) ? existing.slice() : [];
  const list = [];
  let same = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const n = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "第 {n} 份配置不能用", vars: { n } };
    if (item.model === "AC06") return { error: "这是汽车充电桩 AC06 的一键配置，不能导入到摩托车充电桩 M01" };
    if (item.model !== PROFILE_MODEL) return { error: "第 {n} 份配置不是 M01 充电桩的", vars: { n } };
    const name = cleanProfileName(item.name);
    if (!name || typeof item.name !== "string") return { error: "第 {n} 份配置的名称不能用", vars: { n } };
    if (!bodyOk(item.body)) return { error: "第 {n} 份配置不能用", vars: { n } };
    const body = JSON.parse(JSON.stringify(item.body));
    const savedAt = Number.isFinite(item.savedAt) ? item.savedAt : Date.now();
    const record = { format: PROFILE_FORMAT, id: "", name, savedAt, model: PROFILE_MODEL, body };
    if (have.some((old) => storedProfileOk(old) && sameProfile(old, record))) {
      same += 1;
      continue;
    }
    let id = String(newId());
    while (have.some((old) => old && old.id === id)) id = String(newId());
    record.id = id;
    have.push(record);
    list.push(record);
  }
  return { list, same };
}
