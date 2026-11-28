<template>
  <!-- 固件升级页的「云端固件」：AC06 和 M01 两个页面共用。默认插槽放页面原有的「选择固件文件」按钮，
       两个按钮并排。点「云端固件」→ 选版本 → 选 .bin → 确认 → 下载 → 校验，成功后
       emit("loaded", { name, bytes })，后面的升级流程还是页面原来的那一套。规则在 cloud-fw.js。 -->
  <div class="cloud-fw">
    <div class="cloud-row">
      <slot></slot>
      <button type="button" class="ghost cloud-open" :disabled="disabled || stage === 'loading' || stage === 'downloading'" @click="open">{{ t(TEXTS.button) }}</button>
    </div>

    <div v-if="stage === 'loading'" class="card cloud-panel">
      <p class="note">{{ t(TEXTS.loading) }}</p>
      <button type="button" class="ghost cloud-cancel" @click="close">{{ t(TEXTS.cancel) }}</button>
    </div>

    <div v-else-if="stage === 'error'" class="card cloud-panel">
      <p class="note warn cloud-note">{{ t(problem.text, problem.vars) }}</p>
      <button v-if="problem.retry" type="button" class="go cloud-retry" @click="retry">{{ t(TEXTS.retry) }}</button>
      <button v-if="backTo" type="button" class="ghost cloud-back" @click="goBack">{{ t(TEXTS.back) }}</button>
      <button type="button" class="ghost cloud-cancel" @click="close">{{ t(TEXTS.cancel) }}</button>
    </div>

    <div v-else-if="stage === 'versions'" class="card cloud-panel">
      <strong>{{ t(TEXTS.pickVersion) }}</strong>
      <div class="cloud-list">
        <button v-for="item in versions" :key="item.name" type="button" class="ghost cloud-item cloud-version" @click="pickVersion(item)">{{ item.label }}</button>
      </div>
      <button type="button" class="ghost cloud-cancel" @click="close">{{ t(TEXTS.cancel) }}</button>
    </div>

    <div v-else-if="stage === 'files' || stage === 'confirm'" class="card cloud-panel">
      <strong>{{ t(TEXTS.pickFile) }} · {{ folder ? folder.label : '' }}</strong>
      <div class="cloud-list">
        <button v-for="item in files" :key="item.name" type="button" class="ghost cloud-item cloud-file" @click="pickFile(item)">
          <span class="cloud-name">{{ item.name }}</span>
          <small class="cloud-meta">{{ metaLine(item) }}</small>
        </button>
      </div>
      <button type="button" class="ghost cloud-back" @click="showVersions">{{ t(TEXTS.back) }}</button>
      <button type="button" class="ghost cloud-cancel" @click="close">{{ t(TEXTS.cancel) }}</button>
    </div>

    <div v-else-if="stage === 'downloading'" class="card cloud-panel">
      <strong class="cloud-name">{{ file ? file.name : '' }}</strong>
      <div class="ota-track"><div class="ota-fill" :style="{ width: pct + '%' }"></div></div>
      <p class="note cloud-pct">{{ t(TEXTS.downloading, { p: pct }) }}</p>
      <button type="button" class="ghost cloud-cancel" @click="cancelDownload">{{ t(TEXTS.cancel) }}</button>
    </div>

    <div v-if="stage === 'confirm' && file" class="cloud-ask" role="alertdialog" aria-modal="true">
      <div class="cloud-ask-box">
        <strong class="cloud-name">{{ file.name }}</strong>
        <p v-if="file.size" class="note">{{ t('大小') }} {{ file.size }}</p>
        <p v-if="file.version" class="note">{{ t('文件版本') }} V{{ file.version }}</p>
        <p v-if="file.crc" class="note" dir="ltr">CRC {{ file.crc }}</p>
        <p class="cloud-ask-text">{{ t(TEXTS.ask) }}</p>
        <div class="cloud-ask-btns">
          <button type="button" class="ghost cloud-no" @click="stage = 'files'">{{ t(TEXTS.cancel) }}</button>
          <button type="button" class="go cloud-yes" @click="download">{{ t(TEXTS.ok) }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import { CLOUD_TEXTS as TEXTS, cloudDirPath, cloudGet, cloudProblem, cloudSupported, cloudUrl, filesFrom, firmwareFrom, percent, versionsFrom } from "./cloud-fw.js";

const props = defineProps({
  /* "ac06" 读服务器的 AC06/，"m01" 读 M01/。 */
  kind: { type: String, default: "ac06" },
  /* 升级进行中（otaBusy）：不能打开云端选择。 */
  disabled: { type: Boolean, default: false },
  /* 页面的翻译函数 t(中文, vars)。 */
  t: { type: Function, required: true },
});
const emit = defineEmits(["loaded"]);

/* "" 收起 | loading | versions | files | confirm | downloading | error */
const stage = ref("");
const versions = ref([]);
const files = ref([]);
const folder = ref(null);
const file = ref(null);
const pct = ref(0);
const problem = ref({ text: "", vars: null, retry: false });
/* 出错那一屏的「返回」回到哪一步："" 没有 | versions | files */
const backTo = ref("");
let job = null;
let again = null;

/* 取消正在进行的请求：迟到的回调 cloud-fw.js 不理；这里再用 job 是否还是自己把一道关。 */
function stopJob() {
  const j = job;
  job = null;
  if (j) j.cancel();
}
function close() {
  stopJob();
  again = null;
  stage.value = "";
}
function fail(p, action, back) {
  problem.value = p;
  again = action;
  backTo.value = back || "";
  stage.value = "error";
}
async function run(url, kind, onProgress) {
  stopJob();
  const mine = cloudGet(url, kind, { onProgress: (done, total) => { if (job === mine) onProgress(done, total); } });
  job = mine;
  const result = await mine.promise;
  if (job !== mine || result.cancelled) return null;
  job = null;
  return result;
}

function open() {
  if (props.disabled) return;
  if (!cloudSupported()) {
    stopJob();
    fail(cloudProblem({ status: 0, error: "unsupported" }, props.kind, "versions"), null, "");
    return;
  }
  loadVersions();
}
async function loadVersions() {
  stage.value = "loading";
  const result = await run(cloudUrl(cloudDirPath(props.kind)), "text", () => {});
  if (!result) return;
  const got = versionsFrom(result, props.kind);
  if (got.problem) {
    fail(got.problem, loadVersions, "");
    return;
  }
  versions.value = got.items;
  stage.value = "versions";
}
function showVersions() {
  stopJob();
  if (versions.value.length) stage.value = "versions";
  else loadVersions();
}
async function pickVersion(item) {
  folder.value = item;
  files.value = [];
  file.value = null;
  stage.value = "loading";
  const result = await run(cloudUrl(item.href), "text", () => {});
  if (!result) return;
  const got = filesFrom(result, props.kind, item);
  if (got.problem) {
    fail(got.problem, () => pickVersion(item), "versions");
    return;
  }
  files.value = got.items;
  stage.value = "files";
}
function pickFile(item) {
  file.value = item;
  stage.value = "confirm";
}
async function download() {
  const item = file.value;
  if (!item || props.disabled) return;
  pct.value = 0;
  stage.value = "downloading";
  const result = await run(cloudUrl(item.href), "bin", (done, total) => { pct.value = percent(done, total); });
  if (!result) return;
  const got = firmwareFrom(result, props.kind, item);
  if (got.problem) {
    fail(got.problem, download, "files");
    return;
  }
  pct.value = 100;
  again = null;
  stage.value = "";
  emit("loaded", { name: item.name, bytes: got.bytes });
}
function cancelDownload() {
  stopJob();
  stage.value = "files";
}
function retry() {
  const action = again;
  if (props.disabled || !action) return;
  action();
}
function goBack() {
  stopJob();
  if (backTo.value === "files" && files.value.length) stage.value = "files";
  else showVersions();
}
function metaLine(item) {
  const parts = [];
  if (item.size) parts.push(item.size);
  if (item.version) parts.push("V" + item.version);
  if (item.crc) parts.push("CRC " + item.crc);
  return parts.join(" · ");
}

/* 升级一开始（disabled 变真）就收起来，进行中的请求取消。 */
watch(() => props.disabled, (on) => { if (on) close(); });
/* 离开固件升级页（组件卸掉）：取消进行中的请求。 */
onBeforeUnmount(close);
</script>

<style scoped>
.cloud-fw { display: flex; flex-direction: column; gap: 12px; }
.cloud-row { display: flex; gap: 10px; }
.cloud-row > button, .cloud-row > :slotted(button) { flex: 1 1 0; min-width: 0; }
.cloud-panel { display: flex; flex-direction: column; gap: 10px; }
.cloud-list { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow-y: auto; }
.cloud-item { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding: 12px; text-align: start; border-color: #2a2a2a; }
.cloud-name { overflow-wrap: anywhere; }
.cloud-meta { opacity: 0.72; font-size: 13px; }
.cloud-ask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.78); }
.cloud-ask-box { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 360px; padding: 20px 16px 16px; background: #161616; border: 1px solid #f5c400; border-radius: 18px; }
.cloud-ask-text { margin: 6px 0 0; font-size: 17px; font-weight: 700; line-height: 1.45; text-align: center; }
.cloud-ask-btns { display: flex; gap: 10px; }
.cloud-ask-btns > button { flex: 1 1 0; }
</style>
