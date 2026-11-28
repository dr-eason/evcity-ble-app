<template>
  <!-- App 自己的更新（AC-34）：轻提示 + 弹窗。规则和状态机在 app-update.js，这里只管画、把按钮报回去。
       挂在 App.vue 的最外层（不在 <main> 里），所以切到 M01 的页面时也还在。
       Android：提示 → 进度条 → 调起安装；iOS：只有一句「请前往 App Store 更新」。
       界面热更新（h5-update.js）用同一个窗口、同一套样式，只是标题和句子不同：提示 → 进度条 →
       「正在校验并解压」（没有按钮）→ 重新加载，或者连着桩时的「立即切换 / 下次生效」。 -->
  <div v-if="toast" class="upd-toast" role="status" aria-live="polite">{{ t(toast, toastVars) }}</div>
  <div v-if="view.open" class="upd-mask" role="alertdialog" aria-modal="true" :aria-label="t(view.title)">
    <div class="upd-box">
      <p class="upd-title">{{ t(view.title) }}</p>
      <p class="upd-text">{{ t(view.text, view.vars) }}</p>
      <template v-if="view.progress">
        <div class="upd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="state.pct">
          <i :style="{ width: state.pct + '%' }"></i>
        </div>
        <p class="upd-num"><bdi dir="ltr">{{ state.pct }}%</bdi><bdi v-if="sizeText" dir="ltr">{{ sizeText }}</bdi></p>
      </template>
      <p v-if="view.hint" class="upd-hint">{{ t(view.hint) }}</p>
      <div v-if="view.buttons.length" class="upd-btns" :class="{ one: view.buttons.length === 1 }">
        <button v-for="item in view.buttons" :key="item.id" type="button" class="upd-btn" :class="{ go: item.primary }"
                @click="act(item.id)">{{ t(item.label) }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { AUTO_DELAY_MS, createUpdater, fmtMB, updNew, updView } from "./app-update.js";
import { h5Rev } from "./app-version.js";
import { H5_TOAST_ROLLED_BACK, H5_TOAST_UPDATED, h5RevLabel, readH5Info } from "./h5-update.js";

defineProps({
  t: { type: Function, required: true },    /* App.vue 的 t(中文键, 变量) */
});

const TOAST_MS = 2200;
const state = ref(updNew());
const toast = ref("");
const toastVars = ref(null);
/* 现在连没连着桩（App.vue provide 的 evcUpdLinkState）："free" / "linked" / "busy"。热更新下载、切换完
 * 以后要不要马上重新加载页面看它；单独挂这个组件时没有，当 "free"。 */
const linkState = inject("evcUpdLinkState", () => "free");
const view = computed(() => updView(state.value, linkState()));
/* "1.2 / 4.2 MB"；服务器没给总大小时只有已下载的。 */
const sizeText = computed(() => {
  if (!state.value.done && !state.value.total) return "";
  return state.value.total ? fmtMB(state.value.done) + " / " + fmtMB(state.value.total) + " MB" : fmtMB(state.value.done) + " MB";
});

let toastTimer = null;
let autoTimer = null;
function showToast(key, vars) {
  toast.value = key;
  toastVars.value = vars || null;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastTimer = null; toast.value = ""; }, TOAST_MS);
}
const updater = createUpdater({
  api: () => (typeof window !== "undefined" && window.EVC) || null,
  win: typeof window !== "undefined" ? window : null,
  onState: (next) => {
    state.value = next;
    /* 弹窗一出来就把「正在检查更新」收掉。 */
    if (next.phase !== "idle" && next.phase !== "checking" && toast.value) toast.value = "";
  },
  onToast: (key) => showToast(key),
  linkState: () => linkState(),
  /* 这一页编译时的基座和修订号（vite.config.js）：有没有新的热更新按它比。 */
  h5Base: typeof __H5_BASE__ === "string" ? __H5_BASE__ : "",
  h5Rev: h5Rev(typeof __H5_REV__ === "number" ? __H5_REV__ : 0),
});
function act(id) {
  updater.act(id);
}
/* 点版本号：手动查一次。 */
function check() {
  updater.manual();
}
defineExpose({ check });

onMounted(() => {
  /* 这一页是热更新之后重新加载出来的（EVC.h5Info()）：这次运行已经自动查过，不再查（一次运行只自动
   * 查一次的规则跟着进程走，不跟着页面走），轻提示更新到了第几版；是退回来的就提示已恢复。 */
  const info = readH5Info((typeof window !== "undefined" && window.EVC) || null);
  if (info && info.rolledBack) showToast(H5_TOAST_ROLLED_BACK);
  else if (info && info.reloaded) showToast(H5_TOAST_UPDATED, { v: h5RevLabel(h5Rev(typeof __H5_REV__ === "number" ? __H5_REV__ : info.rev)) });
  if (info && (info.reloaded || info.rolledBack)) return;
  /* 打开 App 后过一会儿自动查一次；一次运行只有这一次。 */
  autoTimer = setTimeout(() => { autoTimer = null; updater.auto(); }, AUTO_DELAY_MS);
});
onBeforeUnmount(() => {
  if (autoTimer !== null) clearTimeout(autoTimer);
  if (toastTimer !== null) clearTimeout(toastTimer);
  updater.stop();
});
</script>

<style>
.upd-mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.78); }
.upd-box { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 360px; max-height: 100%; overflow-y: auto; padding: 22px 16px 16px; background: #161616; border: 1px solid #f5c400; border-radius: 18px; color: #fff; }
.upd-title { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.4; text-align: center; color: #f5c400; }
.upd-text { margin: 0; font-size: 15px; line-height: 1.5; text-align: center; overflow-wrap: anywhere; }
.upd-hint { margin: 0; font-size: 13px; line-height: 1.5; text-align: center; color: #f0a020; overflow-wrap: anywhere; }
.upd-bar { height: 8px; background: #2a2a2a; border-radius: 4px; overflow: hidden; direction: ltr; }
.upd-bar i { display: block; height: 100%; background: #f5c400; border-radius: 4px; transition: width 0.15s linear; }
.upd-num { display: flex; justify-content: space-between; gap: 12px; margin: 0; font-size: 13px; color: #bdbdbd; font-variant-numeric: tabular-nums; }
.upd-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
.upd-btns.one { grid-template-columns: 1fr; }
.upd-btn { border-radius: 14px; padding: 14px 8px; border: 1px solid #f5c400; background: #000; color: #fff; font-size: 15px; overflow-wrap: anywhere; touch-action: manipulation; }
.upd-btn.go { background: #f5c400; color: #000; font-weight: 750; }
.upd-toast { position: fixed; left: 50%; bottom: 96px; bottom: calc(96px + env(safe-area-inset-bottom)); z-index: 41; transform: translateX(-50%); max-width: 80%; padding: 9px 16px; background: rgba(38, 38, 38, 0.96); border: 1px solid #3a3a3a; border-radius: 18px; color: #fff; font-size: 13px; line-height: 1.4; text-align: center; pointer-events: none; }
</style>
