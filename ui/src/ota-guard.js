/* 固件升级时拦住“桩和文件不是同一种”。两种桩的 OTA 命令一样（OTAPREP、OTASTART……），
 * 固件那边会不会拒收另一种桩的包没有验证过，所以 App 在发 OTAPREP 之前先看文件里的标记：
 *   AC06 的镜像里有 "AC06VER=<版本>"（AC06/app/src/ota.c）
 *   M01 的镜像里有  "M01VER=<版本>"（M01/app/src/ota.c）
 * AC06 模块只收带 AC06VER= 的文件，M01 模块只收带 M01VER= 的文件。分区布局（fw-layout.js）、
 * 大小、向量表这些原来的检查照旧，在这之后。主机测试在 test/ota-guard.test.mjs。 */

export const FILE_MARKS = {
  ac06: "AC06VER=",
  m01: "M01VER=",
};

function hasMark(bytes, mark) {
  if (!bytes || !mark) return false;
  const first = mark.charCodeAt(0);
  const end = bytes.length - mark.length;
  for (let i = 0; i <= end; i++) {
    if (bytes[i] !== first) continue;
    let j = 1;
    while (j < mark.length && bytes[i + j] === mark.charCodeAt(j)) j++;
    if (j === mark.length) return true;
  }
  return false;
}

/* 文件是哪种桩的固件："ac06"、"m01"，两个标记都没有（或者都有，不该出现）返回 ""。 */
export function firmwareKind(bytes) {
  const ac06 = hasMark(bytes, FILE_MARKS.ac06);
  const m01 = hasMark(bytes, FILE_MARKS.m01);
  if (ac06 && !m01) return "ac06";
  if (m01 && !ac06) return "m01";
  return "";
}

/* 这个文件能不能发给 type 这种桩。能发返回 ""，不能返回提示（中文是翻译的键）。 */
export function firmwareTypeError(type, bytes) {
  const kind = firmwareKind(bytes);
  if (kind === type) return "";
  if (type === "ac06" && kind === "m01") return "这是摩托车充电桩 M01 的固件，不能升级到汽车充电桩 AC06";
  if (type === "m01" && kind === "ac06") return "这是汽车充电桩 AC06 的固件，不能升级到摩托车充电桩 M01";
  return type === "m01"
    ? "文件里没有 M01 固件标记（M01VER=），不是摩托车充电桩 M01 的固件"
    : "文件里没有 AC06 固件标记（AC06VER=），不是汽车充电桩 AC06 的固件";
}
