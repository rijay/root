<template>
  <el-dialog
    :model-value="modelValue"
    class="publish-confirmation-dialog"
    width="680px"
    :close-on-click-modal="false"
    :show-close="true"
    @update:model-value="close"
  >
    <template #header>
      <p class="dialog-eyebrow">SECOND CONFIRMATION</p>
      <h2>确认发布内容版本？</h2>
    </template>

    <p class="dialog-description">
      本操作只替换小程序当前内容版本，<br>
      不代表代码部署、微信审核、正式发布或流量切换。
    </p>

    <div class="version-summary">
      <strong>将上线&nbsp; {{ candidateVersion || "—" }}</strong>
      <span>{{ draftCount }} 项内容变更 · 当前线上 {{ currentVersion }}</span>
      <span>{{ changeSummary }}</span>
    </div>

    <div class="validation-summary" :class="{ 'validation-summary--blocked': blockerCount }">
      <span>{{ blockerCount ? "!" : "✓" }} 系统校验{{ blockerCount ? `发现 ${blockerCount} 个阻断项` : "通过 · 0 个阻断项" }}</span>
      <span>{{ previewCompleted ? `✓ 小程序预览完成 · ${previewedAt}` : "○ 小程序预览待完成" }}</span>
    </div>

    <el-checkbox v-model="previewConfirmed" :disabled="!previewCompleted" class="preview-confirmation">
      我已在小程序预览确认首页、活动和健康内容
    </el-checkbox>

    <div class="publish-scope-warning">
      发布后，新请求读取新内容版本；异常时可回滚到上一已发布版本。<br>
      本操作不会上传代码、提交微信审核或切换线上流量。
    </div>

    <template #footer>
      <el-button @click="close(false)">返回检查</el-button>
      <el-button :disabled="!canConfirm" :loading="confirming" type="primary" @click="$emit('confirm')">
        确认发布内容
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  candidateVersion: { type: String, default: "" },
  currentVersion: { type: String, default: "—" },
  changeSummary: { type: String, default: "" },
  draftCount: { type: Number, default: 0 },
  blockerCount: { type: Number, default: 0 },
  previewCompleted: { type: Boolean, default: false },
  previewedAt: { type: String, default: "—" },
  confirming: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue", "confirm"]);
const previewConfirmed = ref(false);
const canConfirm = computed(() => Boolean(props.candidateVersion)
  && props.blockerCount === 0 && props.previewCompleted && previewConfirmed.value && !props.confirming);

watch(() => props.modelValue, (visible) => {
  if (visible) previewConfirmed.value = false;
});

function close(value) {
  if (value === false || !value) emit("update:modelValue", false);
}
</script>
