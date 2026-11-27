/* 启动和停止之间至少隔 1 秒（3.0.8）。
 *
 * 以前首页的启动、停止可以连着点：继电器刚吸合就断开、刚断开又吸合，对继电器和车都不好。
 * 现在点了启动以后 1 秒内「停止」置灰、点了不算；点了停止以后 1 秒内「启动」置灰、点了不算。
 * 汽车充电桩（App.vue）整台桩用一份；摩托车充电桩（m01/M01App.vue）每一路各算各的：
 * 第 3 路刚停，不妨碍马上启动第 5 路。「全部停止」（端口 0）算作每一路都停了一次，
 * 而且任何一路刚启动不到 1 秒时它也置灰。
 *
 * 从哪一刻算起：从用户点下去、命令交给蓝牙的那一刻算（不是从桩应答的那一刻）。这样不管桩
 * 回得快、回得慢还是不回，用户最多被挡 1 秒；桩那边收到两条命令的间隔也就是 1 秒左右
 * （蓝牙单条命令的延迟远小于 1 秒）。命令没被接受（桩回了拒绝、没应答、发不出去）时调用
 * toggleRelease 马上放开：这一下没有让继电器动作，没有必要再挡对面的按钮。
 *
 * 同一个方向连着点不拦（重复的启动 / 停止桩自己会拒绝或忽略），但每点一次都重新计时。
 * 手机时钟被往回拨了（now 比记下的时刻还早）按“已经过了”算，不会把人一直挡住。
 *
 * 这个文件不碰界面和蓝牙，主机测试 ui/test/charge-toggle-guard.test.mjs 直接用。 */

/* 启动和停止之间的最小间隔。 */
export const TOGGLE_GAP_MS = 1000;
/* 摩托车桩「全部停止」用的端口号（协议里 STOP⇥0 就是全部）。 */
export const TOGGLE_ALL = 0;
/* 只有一把枪的桩（汽车充电桩）用的键。 */
export const TOGGLE_SOLO = "solo";

const other = (cmd) => (cmd === "START" ? "STOP" : cmd === "STOP" ? "START" : "");

/* guard.last[键] = { cmd: "START" | "STOP", at: 点下去的时刻 }。每条连接用一份。 */
export function newToggleGuard() {
  return { last: Object.create(null) };
}

/* 断开、换设备、换设备类型：全部忘掉。 */
export function resetToggleGuard(guard) {
  guard.last = Object.create(null);
}

function leftOf(entry, cmd, now) {
  if (!entry || entry.cmd !== other(cmd)) return 0;
  const gone = now - entry.at;
  if (!(gone >= 0) || gone >= TOGGLE_GAP_MS) return 0;
  return TOGGLE_GAP_MS - gone;
}

/* 现在点 cmd（"START" / "STOP"）还要等多少毫秒；0 = 可以点。
 * key 是端口号；TOGGLE_ALL 看所有端口（任何一路刚做过相反的动作都要等）。 */
export function toggleLeft(guard, cmd, now, key = TOGGLE_SOLO) {
  if (!other(cmd)) return 0;
  const last = guard.last;
  if (key === TOGGLE_ALL) {
    let most = 0;
    for (const name in last) most = Math.max(most, leftOf(last[name], cmd, now));
    return most;
  }
  return Math.max(leftOf(last[key], cmd, now), leftOf(last[TOGGLE_ALL], cmd, now));
}

/* 按钮要不要置灰。 */
export function toggleBlocked(guard, cmd, now, key = TOGGLE_SOLO) {
  return toggleLeft(guard, cmd, now, key) > 0;
}

/* 用户点了启动 / 停止。返回这一下要不要把命令发出去；发的话记下时刻，对面的按钮从现在起挡 1 秒。 */
export function toggleTap(guard, cmd, now, key = TOGGLE_SOLO) {
  if (!other(cmd)) return false;
  if (toggleBlocked(guard, cmd, now, key)) return false;
  guard.last[key] = { cmd, at: now };
  return true;
}

/* 不是用户点按钮、但 App 自己发了启动 / 停止（比如切换并机模式前的全部停止）：只记时刻，不拦。 */
export function toggleMark(guard, cmd, now, key = TOGGLE_SOLO) {
  if (other(cmd)) guard.last[key] = { cmd, at: now };
}

/* 这条命令没成（桩拒绝、没应答、没发出去）：马上放开对面的按钮。
 * 只放开自己记下的那一条；期间如果已经又点了别的，不动它。 */
export function toggleRelease(guard, cmd, key = TOGGLE_SOLO) {
  const entry = guard.last[key];
  if (entry && entry.cmd === cmd) delete guard.last[key];
}

/* 离最近一个按钮放开还有多少毫秒（界面用它定下一次刷新）；0 = 没有按钮在等。 */
export function toggleNextMs(guard, now) {
  let least = 0;
  for (const name in guard.last) {
    const entry = guard.last[name];
    const left = leftOf(entry, other(entry.cmd), now);
    if (left > 0 && (least === 0 || left < least)) least = left;
  }
  return least;
}
