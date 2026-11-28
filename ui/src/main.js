import { createApp } from "vue";
import App from "./App.vue";

const vm = createApp(App).mount("#app");
window.onBle = (msg) => vm.handle(msg);
/* 界面热更新的报到（h5-update.js）：页面挂载好了告诉原生壳一声。壳加载的是热更新出来的界面时，
 * 10 秒内没等到这一声就退回上一份界面；内置的界面也调，壳不理会。老壳没有这个方法，跳过。 */
try {
  if (window.EVC && typeof window.EVC.h5Ready === "function") window.EVC.h5Ready();
} catch (e) { /* 桥不在：不影响页面 */ }
