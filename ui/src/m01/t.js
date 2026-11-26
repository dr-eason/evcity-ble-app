/* M01 模块的翻译：先查 M01 自己的表（m01/i18n.js，从 M01 App 原样拷来），没有再查 AC06 的表
 * （../i18n.js，合并新加的字符串在 ../packs-merge.js，也并在那里面）。中文是键，原样返回。 */

import { hasKey, translate as m01Raw } from "./i18n.js";
import { translate as ac06Raw } from "../i18n.js";

function applyVars(text, vars) {
  let out = String(text);
  if (!vars) return out;
  Object.keys(vars).forEach((key) => {
    out = out.split("{" + key + "}").join(String(vars[key]));
  });
  return out;
}

/* text 可以是 { text, vars }（fw-compat.js 的 lackNote 这样给）。 */
export function m01Translate(lang, text, vars) {
  if (text && typeof text === "object") return m01Translate(lang, text.text, text.vars);
  const key = text == null ? "" : String(text);
  if (!key) return "";
  if (lang === "zh" || hasKey(lang, key)) return m01Raw(lang, key, vars);
  const viaAc06 = ac06Raw(lang, key, vars);
  if (viaAc06 !== applyVars(key, vars)) return viaAc06;
  return m01Raw(lang, key, vars);
}

/* 这一句在 lang 里有没有译文（M01 的表或 AC06 的表）。给测试用。 */
export function m01HasText(lang, key) {
  if (lang === "zh") return true;
  if (hasKey(lang, key)) return true;
  return ac06Raw(lang, key) !== key;
}
