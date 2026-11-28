/* 蓝牙超级密码的默认值（固件 AC06/service/src/ble_super.c 的 ble_super_derive，两边同一条规则，
 * test/pin-change.test.mjs 拿固件单测里的例子对拍）。
 *
 * 广播名 EVC_XXXXXX 的前 3 位，每位变成两位数字，拼成 6 位：
 *   数字 d      → "0d"（0 → "00"）
 *   字母 A..Z   → "01".."26"（不分大小写）
 * 例：EVC_1B3XYZ → "010203"。
 *
 * App 不拿它放行任何东西（鉴权在固件），只用来判断“这台手机记住的密码是不是默认的超级密码”，
 * 好在改掉超级密码以后把记住的那一个一起换掉。算出来的值不显示在界面上、不写日志。 */

/* 名字不合法返回 ""。 */
export function deriveSuperPin(name) {
  const text = String(name == null ? "" : name);
  if (text.slice(0, 4) !== "EVC_") return "";
  let out = "";
  for (let i = 4; i < 7; i++) {
    const c = text.charCodeAt(i);
    let v;
    if (c >= 48 && c <= 57) v = c - 48;                 /* 0-9 */
    else if (c >= 65 && c <= 90) v = c - 64;            /* A-Z */
    else if (c >= 97 && c <= 122) v = c - 96;           /* a-z */
    else return "";
    out += (v < 10 ? "0" : "") + v;
  }
  return out;
}

/* pin 是不是这台桩默认的超级密码。名字不合法、pin 不是 6 位数字都是 false。 */
export function isDefaultSuperPin(name, pin) {
  const want = deriveSuperPin(name);
  return want !== "" && /^\d{6}$/.test(String(pin == null ? "" : pin)) && String(pin) === want;
}
