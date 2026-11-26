/* 2.8.0：连上并通过密码之后的底部标签栏（App.vue 用，主机测试在 test/tabs.test.mjs）。
 *
 * 三个标签就是原来的三页：
 *   charge  立即充电   原来的充电首页（状态、启停、电压电流、联网）
 *   sched   预约充电   原来配置菜单里的“预约充电”页
 *   menu    设置       原来的配置菜单，改成分组列表
 * 切标签只是换 page，蓝牙连接、读到的状态、没保存的输入都留在 App.vue 里，不断开、不清空。
 * 二级页（WiFi、4G、保护、升级……）不显示标签栏，左上角“返回”回到进来时的那个标签。
 * 这里只放和界面无关的规则，命令一条都不发。 */

export const TABS = [
  { id: "charge", label: "立即充电" },
  { id: "sched", label: "预约充电" },
  { id: "menu", label: "设置" },
];

const TAB_IDS = TABS.map((item) => item.id);

/* 这一页是不是某个标签的首页。 */
export function isTabPage(page) {
  return TAB_IDS.indexOf(page) >= 0;
}

/* 标签栏显不显示：在三个首页之一、蓝牙连着、密码通过了，并且没有在输入框里打字
 * （手机键盘弹出来时固定在底部的栏会顶到键盘上面，挡住输入框）。 */
export function tabBarShown(page, linked, authed, typing) {
  return isTabPage(page) && !!linked && !!authed && !typing;
}

/* 首页标题。 */
export function tabTitle(page) {
  const found = TABS.find((item) => item.id === page);
  return found ? found.label : "";
}

/* 标签首页往回退到哪个标签：预约、设置回到立即充电；立即充电返回 null（没有「返回」按钮，
 * 系统返回键在这一页由 App.vue 的 evcTryBack 断开蓝牙、回扫描列表，不退出应用）。 */
export function rootBack(page) {
  if (page === "sched" || page === "menu") return "charge";
  return null;
}

/* 二级页按“返回”回哪个标签：进来时所在的标签，不认识就回设置（二级页大多从设置进）。 */
export function subpageBack(tab) {
  return isTabPage(tab) ? tab : "menu";
}

/* 选完语言回哪一页：从标签首页进来、而且还连着，就回那个标签；否则回扫描页。 */
export function langReturn(from, linked) {
  return linked && isTabPage(from) ? from : "scan";
}

/* 设置页的分组：组名和每组里的入口（App.vue 模板里按钮的 @click）。模板里是一个一个写的
 * （测试要从模板里认出入口），这张表给测试核对：原来配置菜单里的入口一个不少，每个只出现一次。 */
export const SETTINGS_GROUPS = [
  { title: "充电设置", items: ["openImax", "page = 'plug'", "openGbStop", "openCards", "openNetStop", "openOrders"] },
  { title: "网络与平台", items: ["openWifi", "openLte", "openOcpp", "openOcfw"] },
  { title: "保护与屏幕", items: ["openCfg", "openPhase", "openTz", "openScrLang", "openScrTheme", "openQr"] },
  { title: "维护", items: ["openProfiles", "openOta", "openModver", "openTelemetry", "openReboot"] },
  { title: "关于", items: ["openAuthInfo", "openPrivacy('menu')"] },
];
