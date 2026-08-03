<template>
  <section class="workbench release-workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <header class="page-heading">
      <div>
        <h1>发布工作台</h1>
        <p>集中查看内容变更、校验结果与线上版本，发布前先解决阻断项。</p>
      </div>
      <el-space>
        <el-button :disabled="!previewAvailable" @click="openPreview">预览小程序</el-button>
        <el-button
          :loading="loading"
          type="primary"
          @click="openPublishConfirmation"
        >
          检查并发布
        </el-button>
      </el-space>
    </header>

    <div class="release-kpi-grid" aria-label="内容发布概况">
      <article class="release-kpi-card">
        <span>未发布修改</span>
        <strong>{{ draftCount }}</strong>
      </article>
      <article class="release-kpi-card release-kpi-card--danger">
        <span>发布阻断</span>
        <strong>{{ blockerCount }}</strong>
      </article>
      <article class="release-kpi-card">
        <span>未来 7 天定时上线</span>
        <strong>{{ scheduledCount }}</strong>
      </article>
    </div>

    <section class="release-flow-card">
      <div class="release-section-heading">
        <h2>本次发布流程</h2>
        <span v-if="blockerCount" class="release-flow-warning">阻断项解决后才能进入预览</span>
        <span v-else class="release-flow-ready">校验完成后进入小程序预览</span>
      </div>
      <ol class="release-flow" :data-step="flowStep">
        <li v-for="(step, index) in releaseSteps" :key="step.label" :class="{ active: index <= flowStep }">
          <span class="flow-dot" />
          <span>{{ step.label }}</span>
        </li>
      </ol>
    </section>

    <section class="blocking-section">
      <div class="release-section-heading">
        <h2>需要先处理</h2>
        <span>共 {{ blockingItems.length }} 项</span>
      </div>
      <el-table :data="blockingItems" class="blocking-table" empty-text="当前没有发布阻断项">
        <el-table-column prop="type" label="类型" width="122" />
        <el-table-column prop="content" label="内容" min-width="186" />
        <el-table-column prop="issue" label="问题" min-width="324" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <span :class="['release-status', `release-status--${row.level}`]">{{ row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="172" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleBlockingItem(row)">{{ row.action || "立即处理" }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="table-footer-hint">系统只校验已批准规则；修复后重新运行检查，不影响当前线上版本。</p>
    </section>

    <el-dialog
      v-model="publishDialogVisible"
      class="publish-confirmation-dialog"
      width="680px"
      :close-on-click-modal="false"
      :show-close="true"
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
        <el-button @click="publishDialogVisible = false">返回检查</el-button>
        <el-button
          :disabled="!canConfirmPublish"
          :loading="publishing"
          type="primary"
          @click="confirmPublish"
        >
          确认发布内容
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { fetchReleaseRecord, publishContentVersion } from "./adminReleaseApi";

const emit = defineEmits(["release-meta"]);

const loading = ref(false);
const publishing = ref(false);
const errorMessage = ref("");
const releaseRecord = ref(null);
const publishDialogVisible = ref(false);
const previewConfirmed = ref(false);

const contentRelease = computed(() => {
  return releaseRecord.value?.contentRelease || releaseRecord.value?.evidence?.contentRelease || {};
});
const draftCount = computed(() => Number(contentRelease.value.draftCount || 0));
const scheduledCount = computed(() => Number(contentRelease.value.scheduledCount || 0));
const candidateVersion = computed(() => contentRelease.value.candidateVersion || "");
const currentVersion = computed(() => contentRelease.value.currentVersion || "—");
const previewCompleted = computed(() => contentRelease.value.previewStatus === "COMPLETED");
const previewedAt = computed(() => contentRelease.value.previewedAt || "—");
const previewAvailable = computed(() => Boolean(contentRelease.value.previewPath));
const changeSummary = computed(() => contentRelease.value.changeSummary || "欢迎页 0 · 首页 0 · 活动 0 · Root4U 0");

const blockingItems = computed(() => {
  return (contentRelease.value.blockers || []).map((item) => ({
    type: item.type || item.scope || "内容",
    content: item.content || item.title || item.name || "—",
    issue: item.issue || item.message || "待处理",
    status: item.statusLabel || (item.status === "BLOCKED" ? "阻断" : "需确认"),
    level: item.status === "BLOCKED" ? "blocked" : "review",
    action: item.actionLabel || "立即处理",
    module: item.module || "",
  }));
});
const blockerCount = computed(() => {
  const count = contentRelease.value.blockerCount;
  return Number.isFinite(Number(count)) ? Number(count) : blockingItems.value.filter((item) => item.level === "blocked").length;
});
const flowStep = computed(() => {
  if (contentRelease.value.status === "PUBLISHED") return 3;
  if (previewCompleted.value) return 2;
  if (!blockerCount.value && candidateVersion.value) return 1;
  return draftCount.value ? 0 : -1;
});
const releaseSteps = computed(() => [
  { label: `草稿 ${draftCount.value}` },
  { label: blockerCount.value ? `系统校验 · ${blockerCount.value} 项阻断` : "系统校验通过" },
  { label: "小程序预览" },
  { label: "二次确认并发布" },
]);
const canConfirmPublish = computed(() => {
  return Boolean(candidateVersion.value) && blockerCount.value === 0 && previewCompleted.value && previewConfirmed.value;
});

function openPreview() {
  if (!previewAvailable.value) return;
  window.open(contentRelease.value.previewPath, "_blank", "noopener,noreferrer");
}

function openPublishConfirmation() {
  previewConfirmed.value = false;
  publishDialogVisible.value = true;
}

function handleBlockingItem(row) {
  if (row.module) {
    window.location.assign(`${window.location.pathname}?module=${encodeURIComponent(row.module)}`);
    return;
  }
  ElMessage.info("请进入对应内容页面完成修复");
}

async function confirmPublish() {
  if (!canConfirmPublish.value) return;
  publishing.value = true;
  errorMessage.value = "";
  try {
    await publishContentVersion({ version: candidateVersion.value });
    publishDialogVisible.value = false;
    ElMessage.success("内容版本已发布");
    await load();
  } catch (error) {
    errorMessage.value = error.outcomeUnknown
      ? "发布结果待确认，请刷新权威记录；当前页面不会显示为发布成功"
      : error.message;
  } finally {
    publishing.value = false;
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    releaseRecord.value = await fetchReleaseRecord("production");
    emit("release-meta", {
      contentVersion: currentVersion.value,
      unpublishedCount: draftCount.value,
    });
  } catch (error) {
    releaseRecord.value = null;
    emit("release-meta", { contentVersion: "—", unpublishedCount: 0 });
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
defineExpose({ load });
</script>
