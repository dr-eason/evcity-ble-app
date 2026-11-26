/* M01 模块连上并通过密码之后的底部标签栏，照 AC06 的 tabs.js 的做法（M01App.vue 用，
 * 主机测试在 test/m01-tabs.test.mjs）。
 *
 *   charge  立即充电   10 路首页：整桩状态、每路一格、按路启停、全部停止
 *   orders  充电记录   10 路共用的订单，一页 32 条，往前翻
 *   menu    设置       分组列表：充电设置、网络与平台、保护与时间、维护、关于
 *
 * 首页的 id 还叫 charge：手机那一层连上后发 {t:"page", s:"charge"}，和 AC06 一样。
 * 切标签只换 page，蓝牙连接、读到的状态都留在 M01App.vue 里。二级页不显示标签栏，
 * 左上角“返回”回到进来时的那个标签。这里只放规则，命令一条都不发。 */

export const TABS = [
  { id: "charge", label: "立即充电" },
  { id: "orders", label: "充电记录" },
  { id: "menu", label: "设置" },
];

const TAB_IDS = TABS.map((item) => item.id);

export function isTabPage(page) {
  return TAB_IDS.indexOf(page) >= 0;
}

/* 在三个首页之一、蓝牙连着、密码通过、没有在输入框里打字时显示。 */
export function tabBarShown(page, linked, authed, typing) {
  return isTabPage(page) && !!linked && !!authed && !typing;
}

/* 标签首页往回退到哪个标签：记录、设置回到立即充电；立即充电返回 null（没有「返回」按钮，
 * 系统返回键在这一页由 M01App.vue 的 tryBack 断开蓝牙、回扫描列表，不退出应用）。 */
export function rootBack(page) {
  if (page === "orders" || page === "menu") return "charge";
  return null;
}

/* 二级页按“返回”回哪个标签。单路详情从首页进，回首页；其余大多从设置进。 */
export function subpageBack(page, tab) {
  if (page === "port") return "charge";
  return isTabPage(tab) ? tab : "menu";
}

/* 设置页的分组。模板里按钮是一个一个写的（测试从模板里认入口），这张表给测试核对：
 * M01 原来配置菜单里的入口一个不少，每个只出现一次。 */
export const SETTINGS_GROUPS = [
  { title: "充电设置", items: ["openPlim", "openPay", "openPar", "openNetStop"] },
  { title: "网络与平台", items: ["openWifi", "openLte", "openOcpp", "openOcfw"] },
  { title: "保护与时间", items: ["openCfg", "openTz"] },
  { title: "维护", items: ["openProfiles", "openOta", "openModver", "openTelemetry", "openReboot"] },
  { title: "关于", items: ["openAuthInfo", "openPrivacy"] },
];

/* M01 原来菜单（App.vue 的 menu 页）里的入口。充电记录从菜单挪到了标签栏。 */
export const M01_MENU_ITEMS = [
  "openPlim", "openPay", "openPar", "openWifi", "openLte", "openOcpp", "openTz", "openOcfw",
  "openOrders", "openTelemetry", "openNetStop", "openCfg", "openReboot", "openProfiles",
  "openModver", "openOta",
];
