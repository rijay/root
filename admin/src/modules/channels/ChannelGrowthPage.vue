<template>
  <section class="workbench">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <header class="page-heading">
      <div>
        <h1>渠道码与评测漏斗</h1>
        <p>短码仅进入肠道健康 5 道题自测；首触达不可覆盖，每次评测保留当次扫码来源。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </header>

    <el-tabs v-model="activeTab" class="channel-tabs">
      <el-tab-pane v-if="access.has(ADMIN_CAPABILITIES.USER_LABEL_READ)" label="用户来源映射" name="label-mappings" lazy><LabelMappingPanel /></el-tab-pane>
      <el-tab-pane label="漏斗报表" name="funnel">
        <el-card shadow="never">
          <div class="filter-row">
            <el-date-picker
              v-model="dateRange"
              end-placeholder="结束日期"
              range-separator="至"
              start-placeholder="开始日期"
              type="daterange"
              value-format="YYYY-MM-DD"
            />
            <el-input v-model="filters.channelId" clearable placeholder="渠道 ID" />
            <el-input v-model="filters.campaignId" clearable placeholder="活动 ID" />
            <el-input v-model="filters.shortCode" clearable placeholder="短码" />
            <el-button :loading="funnelLoading" type="primary" @click="loadFunnel">查询</el-button>
          </div>
        </el-card>

        <el-row :gutter="12" class="funnel-metrics">
          <el-col v-for="stage in stages" :key="stage.key" :span="4">
            <el-card shadow="never">
              <div class="metric-label">{{ stage.label }}</div>
              <div class="metric-value">{{ funnel.totals?.[stage.key] || 0 }}</div>
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never">
          <el-table v-loading="funnelLoading" :data="funnel.rows || []" empty-text="当前筛选范围暂无渠道数据">
            <el-table-column label="渠道码" min-width="180">
              <template #default="{ row }">
                <div class="table-title">{{ row.label || row.shortCode }}</div>
                <div class="table-meta">{{ row.shortCode }} · {{ row.channelId }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="campaignId" label="活动 ID" min-width="150" />
            <el-table-column v-for="stage in stages" :key="stage.key" :label="stage.short" width="88" align="right">
              <template #default="{ row }">{{ row.counts?.[stage.key] || 0 }}</template>
            </el-table-column>
            <el-table-column label="完成率" width="100" align="right">
              <template #default="{ row }">{{ percent(row.completionRate) }}</template>
            </el-table-column>
            <el-table-column label="结果查看率" width="112" align="right">
              <template #default="{ row }">{{ percent(row.resultViewRate) }}</template>
            </el-table-column>
          </el-table>
          <p class="table-footer-hint">各阶段按一次扫码产生的 visitId 去重；同一用户先扫 A、后扫 B 会分别进入 A、B 的评测漏斗。</p>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="渠道码管理" name="codes">
        <div class="management-grid">
          <el-card shadow="never">
            <template #header><strong>渠道配置</strong></template>
            <el-form label-position="top" :model="channelForm">
              <el-form-item label="渠道 ID"><el-input v-model="channelForm.channelId" placeholder="例如 STORE_SHANGHAI_01" /></el-form-item>
              <el-form-item label="活动 ID"><el-input v-model="channelForm.campaignId" placeholder="例如 GUT_SELF_TEST_2026Q3" /></el-form-item>
              <el-form-item label="状态">
                <el-select v-model="channelForm.status"><el-option v-for="item in statuses" :key="item.value" :label="item.label" :value="item.value" /></el-select>
              </el-form-item>
              <el-form-item label="有效期（可选）">
                <el-date-picker v-model="channelDates" end-placeholder="结束日期" range-separator="至" start-placeholder="开始日期" type="daterange" value-format="YYYY-MM-DD" />
              </el-form-item>
              <el-button
                :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                :loading="savingChannel"
                :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                type="primary"
                @click="submitChannel"
              >保存渠道</el-button>
            </el-form>
          </el-card>

          <el-card shadow="never">
            <template #header><strong>生成渠道码</strong></template>
            <el-form label-position="top" :model="codeForm">
              <el-form-item label="渠道">
                <el-select v-model="codeForm.channelId" filterable placeholder="选择渠道">
                  <el-option v-for="item in configuration.channels" :key="item.channelDefinitionId" :label="`${item.channelId} / ${item.campaignId}`" :value="item.channelId" />
                </el-select>
              </el-form-item>
              <el-form-item label="渠道码名称"><el-input v-model="codeForm.label" placeholder="例如 上海门店桌卡 01" maxlength="80" /></el-form-item>
              <el-form-item label="小程序版本">
                <el-select v-model="codeForm.envVersion">
                  <el-option label="正式版" value="release" />
                  <el-option label="体验版" value="trial" />
                  <el-option label="开发版" value="develop" />
                </el-select>
              </el-form-item>
              <el-form-item label="有效期（可选）">
                <el-date-picker v-model="codeDates" end-placeholder="结束日期" range-separator="至" start-placeholder="开始日期" type="daterange" value-format="YYYY-MM-DD" />
              </el-form-item>
              <el-button
                :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                :loading="creatingCode"
                :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                type="primary"
                @click="submitCode"
              >生成短码</el-button>
            </el-form>
          </el-card>
        </div>

        <el-card shadow="never">
          <template #header><strong>渠道列表</strong></template>
          <el-table :data="configuration.channels || []" empty-text="尚未配置渠道">
            <el-table-column prop="channelId" label="渠道 ID" min-width="180" />
            <el-table-column prop="campaignId" label="活动 ID" min-width="180" />
            <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="tagType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column prop="startsAt" label="开始时间" min-width="170" />
            <el-table-column prop="endsAt" label="结束时间" min-width="170" />
            <el-table-column label="操作" width="84" align="right">
              <template #default="{ row }">
                <el-button
                  :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  link
                  type="primary"
                  @click="editChannel(row)"
                >编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>渠道码列表</strong></template>
          <el-table :data="configuration.codes || []" empty-text="尚未生成渠道码">
            <el-table-column label="名称与短码" min-width="210">
              <template #default="{ row }"><div class="table-title">{{ row.label }}</div><div class="table-meta">{{ row.shortCode }} · {{ row.scene }}</div></template>
            </el-table-column>
            <el-table-column label="渠道与活动" min-width="220">
              <template #default="{ row }"><div>{{ row.channelId }}</div><div class="table-meta">{{ row.campaignId }}</div></template>
            </el-table-column>
            <el-table-column label="版本" width="92"><template #default="{ row }">{{ envLabel(row.envVersion) }}</template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="tagType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="操作" min-width="230" align="right">
              <template #default="{ row }">
                <el-button link @click="copyScene(row)">复制 scene</el-button>
                <el-button
                  :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  :loading="downloadingCodeId === row.channelQrCodeId"
                  :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  link
                  type="primary"
                  @click="downloadCode(row)"
                >下载小程序码</el-button>
                <el-button
                  v-if="row.status === 'ACTIVE'"
                  :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  link
                  type="warning"
                  @click="setCodeStatus(row, 'PAUSED')"
                >暂停</el-button>
                <el-button
                  v-else-if="row.status === 'PAUSED'"
                  :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
                  link
                  type="success"
                  @click="setCodeStatus(row, 'ACTIVE')"
                >启用</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="来源确认配置" name="source-survey">
        <el-alert
          :closable="false"
          title="该配置只影响肠道五题完成后的来源确认页；停用或不配置选项时，小程序直接进入结果页。"
          type="info"
        />
        <el-card class="source-survey-card" shadow="never">
          <template #header>
            <div class="card-heading">
              <strong>评测来源确认</strong>
              <span>当前配置版本：{{ surveyForm.configVersion || '尚未配置' }}</span>
            </div>
          </template>
          <el-form label-position="top" :model="surveyForm">
            <el-form-item label="状态">
              <el-select v-model="surveyForm.status">
                <el-option v-for="item in surveyStatuses" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="页面标题">
              <el-input v-model="surveyForm.title" maxlength="80" show-word-limit />
            </el-form-item>
            <el-form-item label="补充说明">
              <el-input v-model="surveyForm.subtitle" maxlength="180" show-word-limit type="textarea" :rows="2" />
            </el-form-item>
            <el-form-item label="渠道选项（最多 30 项）">
              <div class="survey-options">
                <div v-for="(option, index) in surveyForm.options" :key="index" class="survey-option-row">
                  <el-input v-model="option.optionId" placeholder="唯一 ID，如 OFFLINE_EVENT" maxlength="48" />
                  <el-input v-model="option.label" placeholder="用户看到的名称，如 线下活动" maxlength="40" />
                  <el-button link type="danger" @click="removeSurveyOption(index)">删除</el-button>
                </div>
                <el-button :disabled="surveyForm.options.length >= 30" plain @click="addSurveyOption">添加渠道选项</el-button>
              </div>
            </el-form-item>
            <el-button
              :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
              :loading="savingSurvey"
              :title="access.reason(ADMIN_CAPABILITIES.CHANNEL_MANAGE)"
              type="primary"
              @click="submitSurvey"
            >保存来源确认配置</el-button>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<script setup>
import { ElTabs, ElTabPane } from "element-plus/es/components/tabs/index";
import { ElRow } from "element-plus/es/components/row/index";
import { ElCol } from "element-plus/es/components/col/index";
import "element-plus/theme-chalk/el-tabs.css";
import "element-plus/theme-chalk/el-row.css";
import "element-plus/theme-chalk/el-col.css";
import "element-plus/es/components/date-picker/style/css.mjs";
import { defineAsyncComponent, inject, onMounted, reactive, ref } from "vue";
const LabelMappingPanel = defineAsyncComponent(() => import("./LabelMappingPanel.vue"));
import { ElMessage } from "element-plus/es/components/message/index";
import { ADMIN_ACCESS_KEY, ADMIN_CAPABILITIES } from "../access";
import {
  changeChannelCodeStatus,
  createChannelCode,
  downloadChannelCode,
  fetchAssessmentSourceSurvey,
  fetchChannelConfiguration,
  fetchChannelFunnel,
  saveAssessmentSourceSurvey,
  saveChannel,
} from "./adminChannelApi";

const access = inject(ADMIN_ACCESS_KEY);
const activeTab = ref("funnel");
const loading = ref(false);
const funnelLoading = ref(false);
const savingChannel = ref(false);
const creatingCode = ref(false);
const savingSurvey = ref(false);
const downloadingCodeId = ref("");
const errorMessage = ref("");
const dateRange = ref([]);
const channelDates = ref([]);
const codeDates = ref([]);
const configuration = reactive({ channels: [], codes: [] });
const funnel = reactive({ totals: {}, rows: [] });
const filters = reactive({ channelId: "", campaignId: "", shortCode: "" });
const channelForm = reactive({ channelId: "", campaignId: "", status: "ACTIVE" });
const codeForm = reactive({ channelId: "", label: "", envVersion: "release" });
const surveyForm = reactive({
  assessmentType: "GUT_REGULARITY",
  status: "PAUSED",
  title: "你是从哪里知道 ROOT 的？",
  subtitle: "请选择最接近的一项，帮助我们优化后续活动与服务。",
  configVersion: 0,
  options: [],
});
const statuses = [
  { label: "启用", value: "ACTIVE" },
  { label: "暂停", value: "PAUSED" },
  { label: "归档", value: "ARCHIVED" },
];
const surveyStatuses = statuses.filter((item) => item.value !== "ARCHIVED");
const stages = [
  { key: "SCAN_OPEN", label: "扫码打开", short: "打开" },
  { key: "INTRO_VIEW", label: "到达介绍", short: "介绍" },
  { key: "START_CLICK", label: "点击开始", short: "点击" },
  { key: "ASSESSMENT_CREATED", label: "创建评测", short: "创建" },
  { key: "ASSESSMENT_COMPLETED", label: "完成评测", short: "完成" },
  { key: "RESULT_VIEWED", label: "查看结果", short: "结果" },
];

function isoRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return {};
  return { startsAt: `${range[0]}T00:00:00+08:00`, endsAt: `${range[1]}T23:59:59+08:00` };
}

function percent(value) { return `${(Number(value || 0) * 100).toFixed(1)}%`; }
function statusLabel(value) { return statuses.find((item) => item.value === value)?.label || value; }
function tagType(value) { return value === "ACTIVE" ? "success" : value === "PAUSED" ? "warning" : "info"; }
function envLabel(value) { return ({ release: "正式版", trial: "体验版", develop: "开发版" })[value] || value; }

async function loadConfiguration() {
  const result = await fetchChannelConfiguration();
  configuration.channels = result.channels || [];
  configuration.codes = result.codes || [];
}

async function loadSurveyConfiguration() {
  const result = await fetchAssessmentSourceSurvey();
  Object.assign(surveyForm, {
    assessmentType: result.assessmentType || "GUT_REGULARITY",
    status: result.status || "PAUSED",
    title: result.title || "你是从哪里知道 ROOT 的？",
    subtitle: result.subtitle || "请选择最接近的一项，帮助我们优化后续活动与服务。",
    configVersion: Number(result.configVersion || 0),
    options: (result.options || []).map((item) => ({ optionId: item.optionId, label: item.label })),
  });
}

async function loadFunnel() {
  funnelLoading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchChannelFunnel({ ...filters, ...isoRange(dateRange.value) });
    funnel.totals = result.totals || {};
    funnel.rows = result.rows || [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    funnelLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try { await Promise.all([loadConfiguration(), loadFunnel(), loadSurveyConfiguration()]); }
  catch (error) { errorMessage.value = error.message; }
  finally { loading.value = false; }
}

function addSurveyOption() {
  if (surveyForm.options.length >= 30) return;
  surveyForm.options.push({ optionId: "", label: "" });
}

function removeSurveyOption(index) {
  surveyForm.options.splice(index, 1);
}

async function submitSurvey() {
  const options = surveyForm.options.map((item) => ({
    optionId: String(item.optionId || "").trim().toUpperCase(),
    label: String(item.label || "").trim(),
  }));
  if (!surveyForm.title.trim()) return ElMessage.warning("请填写页面标题");
  if (options.some((item) => !/^[A-Z0-9][A-Z0-9_-]{0,47}$/.test(item.optionId) || !item.label)) {
    return ElMessage.warning("请补全渠道选项，ID 仅支持大写字母、数字、下划线和短横线");
  }
  if (surveyForm.status === "ACTIVE" && !options.length) return ElMessage.warning("启用前至少配置一个渠道选项");
  savingSurvey.value = true;
  try {
    await saveAssessmentSourceSurvey({
      assessmentType: "GUT_REGULARITY",
      status: surveyForm.status,
      title: surveyForm.title.trim(),
      subtitle: surveyForm.subtitle.trim(),
      options,
    });
    ElMessage.success(surveyForm.status === "ACTIVE" ? "来源确认页已启用" : "来源确认页已停用");
    await loadSurveyConfiguration();
  } catch (error) { errorMessage.value = error.message; }
  finally { savingSurvey.value = false; }
}

async function submitChannel() {
  if (!channelForm.channelId.trim() || !channelForm.campaignId.trim()) return ElMessage.warning("请填写渠道 ID 和活动 ID");
  savingChannel.value = true;
  try {
    await saveChannel({ ...channelForm, ...isoRange(channelDates.value) });
    ElMessage.success("渠道配置已保存");
    await loadConfiguration();
  } catch (error) { errorMessage.value = error.message; }
  finally { savingChannel.value = false; }
}

async function submitCode() {
  if (!codeForm.channelId || !codeForm.label.trim()) return ElMessage.warning("请选择渠道并填写渠道码名称");
  creatingCode.value = true;
  try {
    await createChannelCode({ ...codeForm, ...isoRange(codeDates.value) });
    codeForm.label = "";
    ElMessage.success("渠道短码已生成");
    await loadConfiguration();
  } catch (error) { errorMessage.value = error.message; }
  finally { creatingCode.value = false; }
}

function editChannel(row) {
  Object.assign(channelForm, { channelId: row.channelId, campaignId: row.campaignId, status: row.status });
  channelDates.value = row.startsAt && row.endsAt ? [row.startsAt.slice(0, 10), row.endsAt.slice(0, 10)] : [];
  activeTab.value = "codes";
}

async function setCodeStatus(row, status) {
  try {
    await changeChannelCodeStatus(row.channelQrCodeId, status);
    ElMessage.success(status === "ACTIVE" ? "渠道码已启用" : "渠道码已暂停");
    await loadConfiguration();
  } catch (error) { errorMessage.value = error.message; }
}

async function copyScene(row) {
  try { await navigator.clipboard.writeText(row.scene); ElMessage.success("scene 已复制"); }
  catch (_) { ElMessage.error("复制失败，请手动复制"); }
}

async function downloadCode(row) {
  downloadingCodeId.value = row.channelQrCodeId;
  try {
    const result = await downloadChannelCode(row.channelQrCodeId);
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ROOT-${row.shortCode}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
    ElMessage.success("小程序码已生成并下载");
  } catch (error) { errorMessage.value = error.message; }
  finally { downloadingCodeId.value = ""; }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.channel-tabs { display: grid; gap: 14px; }
.filter-row { display: grid; grid-template-columns: minmax(280px, 1.3fr) repeat(3, minmax(140px, 0.8fr)) auto; gap: 10px; }
.funnel-metrics { margin: 14px 0; }
.metric-label { color: var(--root-muted); font-size: 12px; }
.metric-value { margin-top: 8px; font-size: 30px; font-weight: 650; }
.management-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
.management-grid :deep(.el-select), .management-grid :deep(.el-date-editor) { width: 100%; }
.source-survey-card { margin-top: 14px; }
.source-survey-card :deep(.el-select) { width: 100%; }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.card-heading span { color: var(--root-muted); font-size: 12px; }
.survey-options { display: grid; width: 100%; gap: 10px; }
.survey-option-row { display: grid; grid-template-columns: minmax(180px, 0.8fr) minmax(240px, 1.2fr) auto; gap: 10px; align-items: center; }
</style>
