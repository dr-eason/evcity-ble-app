<template>
  <!-- App 自己的更新（AC-34）：轻提示 + 弹窗。规则和状态机在 app-update.js，这里只管画、把按钮报回去。
       挂在 App.vue 的最外层（不在 <main> 里），所以切到 M01 的页面时也还在。
       Android：提示 → 进度条 → 调起安装；iOS：只有一句「请前往 App Store 更新」。 -->
  <div v-if="toast" class="upd-toast" role="status" aria-live="polite">{{ t(toast) }}</div>
  <div v-if="view.open" class="upd-mask" role="alertdialog" aria-modal="true" :aria-label="t('软件更新')">
    <div class="upd-box">
      <p class="upd-title">{{ t('软件更新') }}</p>
      <p class="upd-text">{{ t(view.text, view.vars) }}</p>
      <template v-if="view.progress">
        <div class="upd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="state.pct">
          <i :style="{ width: state.pct + '%' }"></i>
        </div>
        <p class="upd-num"><bdi dir="ltr">{{ state.pct }}%</bdi><bdi v-if="sizeText" dir="ltr">{{ sizeText }}</bdi></p>
      </template>
      <p v-if="view.hint" class="upd-hint">{{ t(view.hint) }}</p>
      <div class="upd-btns" :class="{ one: view.buttons.length === 1 }">
        <button v-for="item in view.buttons" :key="item.id" type="button" class="upd-btn" :class="{ go: item.primary }"
                @click="act(item.id)">{{ t(item.label) }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { AUTO_DELAY_MS, createUpdater, fmtMB, updNew, updView } from "./app-update.js";

defineProps({
  t: { type: Function, required: true },    /* App.vue 的 t(中文键, 变量) */
});

const TOAST_MS = 2200;
const state = ref(updNew());
const toast = ref("");
const view = computed(() => updView(state.value));
/* "1.2 / 4.2 MB"；服务器没给总大小时只有已下载的。 */
const sizeText = computed(() => {
  if (!state.value.done && !state.value.total) return "";
  return state.value.total ? fmtMB(state.value.done) + " / " + fmtMB(state.value.total) + " MB" : fmtMB(state.value.done) + " MB";
});

let toastTimer = null;
let autoTimer = null;
function showToast(key) {
  toast.value = key;
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
  onToast: showToast,
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
