/* 读仓库根的 VERSION（单仓里才有；公开镜像仓 evcity-ble-app 只有 ui/ 和 ios/，没有它 → null）。
 *
 * VERSION 记四个数（规则见 文档/版本规则.md）：
 *     APP=3.02     大版本.APP版本（两位补零）
 *     AC06=01      AC06 固件自己的第 3 段
 *     M01=01       M01 固件自己的第 3 段
 * 返回 { app: "3.02", build: "30200", ac06: "3.02.01", m01: "3.02.01", major: 3, appNo: 2 }：
 *   app    App 的商店版本（versionName / EVC_VERSION / APP_VERSION），只有前两段
 *   build  versionCode / EVC_BUILD = 大版本×10000 + APP版本×100
 *   ac06 / m01  两款固件各自的完整三段版本 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const VERSION_PATH = resolve(root, "VERSION");

export function parseVersionFile(text) {
  const got = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(APP|AC06|M01)\s*=\s*(\S+)$/.exec(line);
    if (!m || m[1] in got) throw new Error("VERSION 里看不懂的一行: " + line);
    got[m[1]] = m[2];
  }
  const app = /^([1-9]\d?|0)\.(\d{2})$/.exec(got.APP || "");
  if (!app || !/^\d{2}$/.test(got.AC06 || "") || !/^\d{2}$/.test(got.M01 || "")) {
    throw new Error("VERSION 要有 APP=大版本.两位、AC06=两位、M01=两位 三行");
  }
  const major = Number(app[1]);
  const appNo = Number(app[2]);
  return {
    app: got.APP,
    build: String(major * 10000 + appNo * 100),
    ac06: got.APP + "." + got.AC06,
    m01: got.APP + "." + got.M01,
    major,
    appNo,
  };
}

export function repoVersion() {
  if (!existsSync(VERSION_PATH)) return null;
  return parseVersionFile(readFileSync(VERSION_PATH, "utf8"));
}
