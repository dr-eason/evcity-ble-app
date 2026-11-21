import { createApp } from "vue";
import App from "./App.vue";

const vm = createApp(App).mount("#app");
window.onBle = (msg) => vm.handle(msg);
