<template>
  <!-- 6 位数字密码：六个方格只是显示（不是输入框，拿不到焦点，系统键盘不会弹出来），已经输入的
       位画 ●，下一位要输入的那一格高亮；下面是自己画的数字键盘，每个键都是 button。
       规则在 pin-pad.js，这里只管画和把按键报给上一层。 -->
  <div class="pinpad" dir="ltr">
    <div class="pin-cells" role="img" :aria-label="cellsLabel">
      <span v-for="(cell, i) in cells" :key="i" class="pin-cell" :class="{ filled: cell.filled, on: cell.on }" aria-hidden="true">{{ cell.filled ? '●' : '' }}</span>
    </div>
    <div class="pin-keys">
      <button v-for="key in PAD_KEYS" :key="key" type="button" class="pin-key" :class="{ word: key === 'clear', back: key === 'back' }"
              :disabled="disabled" :aria-label="key === 'back' ? backLabel : null" @click="$emit('key', key)">
        <template v-if="key === 'clear'">{{ clearLabel }}</template>
        <svg v-else-if="key === 'back'" viewBox="0 0 28 20" width="28" height="20" aria-hidden="true">
          <path d="M9 1.5h15.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H9L1.5 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M13.5 6.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <template v-else>{{ key }}</template>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { PAD_KEYS, pinCells } from "./pin-pad.js";

const props = defineProps({
  value: { type: String, default: "" },        /* 已经输入的数字（只用来数位数，不显示） */
  active: { type: Boolean, default: true },     /* 高亮下一格 */
  disabled: { type: Boolean, default: false },
  clearLabel: { type: String, default: "" },
  backLabel: { type: String, default: "" },
  cellsLabel: { type: String, default: "" },
});
defineEmits(["key"]);
const cells = computed(() => pinCells(props.value, props.active && !props.disabled));
</script>

<style>
.pinpad { display: flex; flex-direction: column; gap: 14px; align-items: center; width: 100%; user-select: none; -webkit-user-select: none; }
.pin-cells { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; width: 100%; max-width: 336px; }
.pin-cell { display: flex; align-items: center; justify-content: center; height: 50px; background: #111; border: 1px solid #333; border-radius: 12px; font-size: 18px; line-height: 1; color: #fff; }
.pin-cell.filled { border-color: #666; }
.pin-cell.on { border-color: #f5c400; box-shadow: 0 0 0 1px #f5c400 inset; }
.pin-keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: 100%; max-width: 336px; }
.pin-key { display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 4px; background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; color: #fff; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.pin-key:active:not(:disabled) { background: #f5c400; border-color: #f5c400; color: #000; }
.pin-key.word { font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
.pin-key.word, .pin-key.back { background: #000; }
@media (max-height: 640px) {
  .pinpad { gap: 10px; }
  .pin-cell { height: 44px; }
  .pin-keys { gap: 8px; }
  .pin-key { min-height: 50px; font-size: 23px; }
}
@media (max-height: 520px) {
  .pin-cell { height: 38px; }
  .pin-key { min-height: 44px; font-size: 21px; }
}
</style>
