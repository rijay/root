<template>
  <section class="workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>运营数据漏斗</span>
          <el-space wrap>
            <el-input v-model="filters.campaignId" clearable placeholder="campaign_id" />
            <el-date-picker v-model="filters.dateFrom" placeholder="开始日期" type="date" value-format="YYYY-MM-DD" />
            <el-date-picker v-model="filters.dateTo" placeholder="结束日期" type="date" value-format="YYYY-MM-DD" />
            <el-switch v-model="autoRefresh" active-text="自动刷新" />
            <el-button :loading="loading" type="primary" @click="load">刷新</el-button>
            <el-button :loading="exportLoading" @click="downloadCsv">导出 CSV</el-button>
          </el-space>
        </div>
      </template>
      <el-row :gutter="12" class="metric-row">
        <el-col v-for="metric in metricCards" :key="metric.key" :span="4">
          <el-card class="metric-card" shadow="never">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never">
      <template #header>预警</template>
      <el-empty v-if="!alerts.length" description="暂无预警" />
      <el-table v-else :data="alerts" height="260">
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="severityType(row.severity)" effect="plain">{{ row.severity }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="label" label="预警" min-width="180" />
        <el-table-column prop="count" label="数量" width="90" />
        <el-table-column prop="message" label="说明" min-width="180" />
        <el-table-column prop="nextAction" label="下一步" min-width="260" />
      </el-table>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>预警阈值配置</template>
          <el-form :model="alertRuleForm" label-position="top">
            <el-form-item label="规则 ID">
              <el-input v-model="alertRuleForm.alertRuleId" placeholder="留空则按目标生成" />
            </el-form-item>
            <el-row :gutter="10">
              <el-col :span="12">
                <el-form-item label="目标类型">
                  <el-select v-model="alertRuleForm.targetType">
                    <el-option v-for="item in targetTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="目标 Key">
                  <el-input v-model="alertRuleForm.targetKey" placeholder="unresolved_leads 或 *" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="10">
              <el-col :span="8">
                <el-form-item label="指标">
                  <el-input v-model="alertRuleForm.metricKey" placeholder="count / conversionRate" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="条件">
                  <el-select v-model="alertRuleForm.operator">
                    <el-option v-for="item in operatorOptions" :key="item" :label="item" :value="item" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="阈值">
                  <el-input-number v-model="alertRuleForm.thresholdValue" :precision="1" :step="1" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="10">
              <el-col :span="8">
                <el-form-item label="级别">
                  <el-select v-model="alertRuleForm.severity">
                    <el-option label="danger" value="danger" />
                    <el-option label="warning" value="warning" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="渠道">
                  <el-select v-model="alertRuleForm.channel">
                    <el-option label="IN_APP" value="IN_APP" />
                    <el-option label="WEBHOOK" value="WEBHOOK" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="状态">
                  <el-select v-model="alertRuleForm.status">
                    <el-option label="ACTIVE" value="ACTIVE" />
                    <el-option label="DISABLED" value="DISABLED" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="10">
              <el-col :span="8">
                <el-form-item label="冷却分钟">
                  <el-input-number v-model="alertRuleForm.cooldownMinutes" :min="0" :step="15" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="路由 Key">
                  <el-input v-model="alertRuleForm.routeKey" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="request_id">
                  <el-input v-model="alertRuleForm.requestId" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="10">
              <el-col :span="8">
                <el-form-item label="负责角色">
                  <el-input v-model="alertRuleForm.ownerRole" placeholder="运营 / 研发" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="负责人">
                  <el-input v-model="alertRuleForm.ownerName" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="联系方式">
                  <el-input v-model="alertRuleForm.ownerContact" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="Webhook">
              <el-input v-model="alertRuleForm.webhookUrl" placeholder="WEBHOOK 渠道启用时填写" />
            </el-form-item>
            <el-form-item label="说明">
              <el-input v-model="alertRuleForm.description" type="textarea" />
            </el-form-item>
            <el-space wrap>
              <el-button
                :disabled="!canConfigWrite"
                :loading="alertRuleLoading"
                :title="configWriteTitle"
                type="primary"
                @click="submitAlertRule"
              >
                保存阈值
              </el-button>
              <el-button @click="resetAlertRuleForm">清空</el-button>
            </el-space>
          </el-form>
        </el-card>
      </el-col>
      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <div class="toolbar-title">
              <span>预警规则与 Job</span>
              <el-space wrap>
                <el-tag effect="plain">命中 {{ alertSummary.triggeredCount || 0 }}</el-tag>
                <el-button
                  :disabled="!canConfigWrite"
                  :loading="alertJobLoading"
                  :title="configWriteTitle"
                  @click="previewAlertJob"
                >
                  预览 Job
                </el-button>
                <el-button
                  :disabled="!canConfigWrite"
                  :loading="alertJobLoading"
                  :title="configWriteTitle"
                  type="warning"
                  @click="executeAlertJob"
                >
                  执行 Job
                </el-button>
              </el-space>
            </div>
          </template>
          <el-table :data="alertRules" height="260" @row-click="fillAlertRule">
            <el-table-column prop="title" label="规则" min-width="150" />
            <el-table-column prop="targetType" label="目标" width="140" />
            <el-table-column prop="targetKey" label="Key" min-width="150" />
            <el-table-column label="阈值" width="120">
              <template #default="{ row }">{{ row.metricKey }} {{ row.operator }} {{ row.thresholdValue }}</template>
            </el-table-column>
            <el-table-column prop="severity" label="级别" width="90" />
            <el-table-column prop="channel" label="渠道" width="95" />
            <el-table-column label="负责人" min-width="130">
              <template #default="{ row }">{{ row.ownerName || row.ownerRole || "-" }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="95" />
          </el-table>
          <el-alert
            v-if="alertJobResult"
            :closable="false"
            :title="`Job ${alertJobResult.dryRun ? '预览' : '执行'}：命中 ${alertJobResult.summary?.triggeredCount || 0}，发出 ${alertJobResult.summary?.deliveredCount || 0}，跳过 ${alertJobResult.summary?.skippedCount || 0}`"
            class="job-result"
            type="success"
          />
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>预警通知记录</template>
      <el-table :data="alertNotifications" height="220">
        <el-table-column prop="createdAt" label="时间" min-width="170" />
        <el-table-column prop="severity" label="级别" width="90" />
        <el-table-column prop="channel" label="渠道" width="100" />
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column prop="externalRef" label="外部回执" min-width="120" />
        <el-table-column prop="error" label="错误" min-width="160" />
        <el-table-column label="负责人" min-width="130">
          <template #default="{ row }">{{ row.ownerName || row.ownerRole || "-" }}</template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column prop="message" label="说明" min-width="260" />
        <el-table-column prop="requestId" label="request_id" min-width="180" />
      </el-table>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="15">
        <el-card shadow="never">
          <template #header>阶段转化</template>
          <el-table :data="stages" height="520">
            <el-table-column prop="label" label="阶段" min-width="150" />
            <el-table-column prop="count" label="数量" width="90" />
            <el-table-column label="转化率" width="130">
              <template #default="{ row }">
                <span>{{ rateText(row.conversionRate) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="转化进度" min-width="160">
              <template #default="{ row }">
                <el-progress
                  :percentage="row.conversionRate === null ? 100 : Math.max(0, Math.min(100, row.conversionRate))"
                  :show-text="false"
                  :status="row.conversionRate === null || row.conversionRate >= 70 ? 'success' : row.conversionRate >= 40 ? 'warning' : 'exception'"
                />
              </template>
            </el-table-column>
            <el-table-column prop="dropoff" label="流失" width="90" />
            <el-table-column prop="note" label="口径" min-width="240" />
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card shadow="never">
          <template #header>运营卡点</template>
          <el-table :data="bottlenecks" height="520">
            <el-table-column label="状态" width="88">
              <template #default="{ row }">
                <el-tag :type="severityType(row.severity)" effect="plain">{{ row.count }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="label" label="卡点" min-width="150" />
            <el-table-column prop="nextAction" label="下一步" min-width="240" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>日期趋势</template>
      <el-table :data="trend" height="340">
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column prop="leads" label="线索" width="90" />
        <el-table-column prop="registeredUsers" label="注册" width="90" />
        <el-table-column prop="participants" label="参与" width="90" />
        <el-table-column prop="productJumpUsers" label="跳有赞" width="100" />
        <el-table-column prop="orders" label="订单" width="90" />
        <el-table-column prop="taskUsers" label="任务" width="90" />
        <el-table-column prop="qualifiedSettlements" label="结算通过" width="110" />
        <el-table-column prop="rewardUsers" label="生成奖励" width="110" />
        <el-table-column prop="deliveredRewardUsers" label="奖励发放" min-width="110" />
      </el-table>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>漏斗图表</template>
          <div class="chart-list">
            <div v-for="bar in funnelBars" :key="bar.key" class="chart-row">
              <div class="chart-row__meta">
                <span>{{ bar.label }}</span>
                <strong>{{ bar.count }}</strong>
              </div>
              <div class="chart-row__track">
                <span
                  class="chart-row__fill"
                  :class="`chart-row__fill--${bar.severity}`"
                  :style="{ width: `${Math.max(4, bar.widthRate)}%` }"
                />
              </div>
              <small>转化 {{ rateText(bar.conversionRate) }} · 流失 {{ bar.dropoff }}</small>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>趋势图表</template>
          <div class="chart-list">
            <div v-for="series in trendSeriesRows" :key="series.key" class="chart-row">
              <div class="chart-row__meta">
                <span>{{ series.label }}</span>
                <strong>{{ series.total }}</strong>
              </div>
              <div class="chart-row__track">
                <span class="chart-row__fill chart-row__fill--info" :style="{ width: `${Math.max(4, series.widthRate)}%` }" />
              </div>
              <small>{{ series.points.length }} 天窗口</small>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="15">
        <el-card shadow="never">
          <template #header>来源分群留存</template>
          <el-table :data="retentionSegments" height="360">
            <el-table-column prop="label" label="来源" min-width="130" />
            <el-table-column prop="leads" label="线索" width="78" />
            <el-table-column prop="rootUsers" label="注册" width="78" />
            <el-table-column prop="participantUsers" label="参与" width="78" />
            <el-table-column prop="taskUsers" label="任务" width="78" />
            <el-table-column label="任务启动" width="100">
              <template #default="{ row }">{{ rateText(row.taskStartRate) }}</template>
            </el-table-column>
            <el-table-column label="结算达标" width="100">
              <template #default="{ row }">{{ rateText(row.settlementReadyRate) }}</template>
            </el-table-column>
            <el-table-column label="奖励发放" width="100">
              <template #default="{ row }">{{ rateText(row.rewardDeliveredRate) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="88">
              <template #default="{ row }">
                <el-tag :type="severityType(row.severity)" effect="plain">{{ row.severity }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="nextAction" label="下一步" min-width="260" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="9">
        <el-card shadow="never">
          <template #header>分群任务启动</template>
          <div class="chart-list">
            <div v-for="bar in segmentBars" :key="bar.key" class="chart-row">
              <div class="chart-row__meta">
                <span>{{ bar.label }}</span>
                <strong>{{ rateText(bar.taskStartRate) }}</strong>
              </div>
              <div class="chart-row__track">
                <span
                  class="chart-row__fill"
                  :class="`chart-row__fill--${bar.severity}`"
                  :style="{ width: `${Math.max(4, bar.widthRate)}%` }"
                />
              </div>
              <small>{{ bar.participantUsers }} 人参与 · 达标 {{ rateText(bar.settlementReadyRate) }}</small>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>任务分布</template>
          <el-table :data="distributionRows('taskType')" height="260">
            <el-table-column prop="key" label="类型" min-width="130" />
            <el-table-column prop="count" label="数量" width="80" />
            <el-table-column label="占比" width="90">
              <template #default="{ row }">{{ rateText(row.rate) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>来源分布</template>
          <el-table :data="sourceRows" height="260">
            <el-table-column prop="key" label="来源" min-width="130" />
            <el-table-column prop="count" label="数量" width="80" />
            <el-table-column label="占比" width="90">
              <template #default="{ row }">{{ rateText(row.rate) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>奖励状态</template>
          <el-table :data="distributionRows('rewardStatus')" height="260">
            <el-table-column prop="key" label="状态" min-width="130" />
            <el-table-column prop="count" label="数量" width="80" />
            <el-table-column label="占比" width="90">
              <template #default="{ row }">{{ rateText(row.rate) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>最近动作</template>
      <el-table :data="recentActivity" height="320">
        <el-table-column prop="occurredAt" label="时间" min-width="180" />
        <el-table-column prop="type" label="类型" width="150" />
        <el-table-column prop="rootUserId" label="root_user_id" min-width="180" />
        <el-table-column prop="label" label="动作" min-width="240" />
      </el-table>
    </el-card>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { ADMIN_CAPABILITIES, useAdminAccess } from "../access";
import {
  exportOperationalAnalyticsCsv,
  fetchOperationalAnalytics,
  runOperationalAlertJob,
  upsertOperationalAlertRule,
} from "./adminAnalyticsApi";

const loading = ref(false);
const exportLoading = ref(false);
const alertRuleLoading = ref(false);
const alertJobLoading = ref(false);
const alertJobResult = ref(null);
const errorMessage = ref("");
const autoRefresh = ref(false);
let refreshTimer = 0;
const access = useAdminAccess();
const canConfigWrite = computed(() => access.has(ADMIN_CAPABILITIES.CONFIG_WRITE));
const configWriteTitle = computed(() => access.reason(ADMIN_CAPABILITIES.CONFIG_WRITE));
const analytics = ref({
  stages: [],
  bottlenecks: [],
  alerts: [],
  alertRules: [],
  alertSummary: {},
  alertNotifications: [],
  alertRuns: [],
  trend: [],
  retentionSegments: [],
  charts: { funnelBars: [], trendSeries: [], segmentBars: [] },
  distributions: {},
  recentActivity: [],
  totals: {},
  filters: {},
  refresh: {},
});
const filters = reactive({ campaignId: "", dateFrom: "", dateTo: "" });

const stages = computed(() => analytics.value.stages || []);
const bottlenecks = computed(() => analytics.value.bottlenecks || []);
const alerts = computed(() => analytics.value.alerts || []);
const alertRules = computed(() => analytics.value.alertRules || []);
const alertSummary = computed(() => analytics.value.alertSummary || {});
const alertNotifications = computed(() => analytics.value.alertNotifications || []);
const trend = computed(() => analytics.value.trend || []);
const retentionSegments = computed(() => analytics.value.retentionSegments || []);
const charts = computed(() => analytics.value.charts || { funnelBars: [], trendSeries: [], segmentBars: [] });
const funnelBars = computed(() => charts.value.funnelBars || []);
const segmentBars = computed(() => charts.value.segmentBars || []);
const maxTrendTotal = computed(() => Math.max(1, ...(charts.value.trendSeries || []).map((item) => Number(item.total || 0))));
const trendSeriesRows = computed(() => (charts.value.trendSeries || []).map((item) => ({
  ...item,
  widthRate: Math.round((Number(item.total || 0) / maxTrendTotal.value) * 1000) / 10,
})));
const recentActivity = computed(() => analytics.value.recentActivity || []);
const totals = computed(() => analytics.value.totals || {});
const metricCards = computed(() => [
  { key: "leads", label: "企微线索", value: totals.value.leads || 0 },
  { key: "participants", label: "活动用户", value: totals.value.participants || 0 },
  { key: "jumps", label: "有赞跳转", value: totals.value.productJumps || 0 },
  { key: "orders", label: "订单镜像", value: totals.value.orders || 0 },
  { key: "settlements", label: "结算记录", value: totals.value.settlements || 0 },
  { key: "rewards", label: "奖励记录", value: totals.value.rewards || 0 },
]);
const sourceRows = computed(() => [
  ...(analytics.value.distributions?.leadSource || []),
  ...(analytics.value.distributions?.participantSource || []),
  ...(analytics.value.distributions?.productJumpSource || []),
].slice(0, 12));
const targetTypeOptions = [
  { label: "瓶颈项", value: "BOTTLENECK" },
  { label: "阶段转化", value: "STAGE_CONVERSION" },
  { label: "来源分群", value: "SEGMENT_RATE" },
  { label: "Adapter 重试耗尽", value: "ADAPTER_RETRY_EXHAUSTED" },
  { label: "结算队列失败", value: "LIFECYCLE_SETTLEMENT_JOB_FAILED" },
  { label: "结算队列卡住", value: "LIFECYCLE_SETTLEMENT_JOB_STALLED" },
  { label: "导出交付健康", value: "LIFECYCLE_EXPORT_DELIVERY_HEALTH" },
  { label: "咨询 SLA 超时", value: "CONSULTATION_SLA_OVERDUE" },
  { label: "咨询 SLA 升级", value: "CONSULTATION_SLA_ESCALATION" },
];
const operatorOptions = [">", ">=", "<", "<=", "="];
const alertRuleForm = reactive({
  alertRuleId: "",
  title: "运营预警",
  description: "",
  targetType: "BOTTLENECK",
  targetKey: "unresolved_leads",
  metricKey: "count",
  operator: ">",
  thresholdValue: 0,
  severity: "warning",
  channel: "IN_APP",
  ownerRole: "运营",
  ownerName: "",
  ownerContact: "",
  routeKey: "BOTTLENECK:unresolved_leads",
  webhookUrl: "",
  cooldownMinutes: 60,
  status: "ACTIVE",
  requestId: defaultRequestId("alert-rule"),
});

function distributionRows(key) {
  return analytics.value.distributions?.[key] || [];
}

function rateText(value) {
  return value === null || value === undefined ? "-" : `${value}%`;
}

function severityType(severity) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

function defaultRequestId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function resetAlertRuleForm() {
  Object.assign(alertRuleForm, {
    alertRuleId: "",
    title: "运营预警",
    description: "",
    targetType: "BOTTLENECK",
    targetKey: "unresolved_leads",
    metricKey: "count",
    operator: ">",
    thresholdValue: 0,
    severity: "warning",
    channel: "IN_APP",
    ownerRole: "运营",
    ownerName: "",
    ownerContact: "",
    routeKey: "BOTTLENECK:unresolved_leads",
    webhookUrl: "",
    cooldownMinutes: 60,
    status: "ACTIVE",
    requestId: defaultRequestId("alert-rule"),
  });
}

function fillAlertRule(row) {
  Object.assign(alertRuleForm, {
    alertRuleId: row.alertRuleId,
    title: row.title || "运营预警",
    description: row.description || "",
    targetType: row.targetType || "BOTTLENECK",
    targetKey: row.targetKey || "*",
    metricKey: row.metricKey || "count",
    operator: row.operator || ">",
    thresholdValue: Number(row.thresholdValue || 0),
    severity: row.severity || "warning",
    channel: row.channel || "IN_APP",
    ownerRole: row.ownerRole || "",
    ownerName: row.ownerName || "",
    ownerContact: row.ownerContact || "",
    routeKey: row.routeKey || "",
    webhookUrl: row.webhookUrl || "",
    cooldownMinutes: Number(row.cooldownMinutes || 60),
    status: row.status || "ACTIVE",
    requestId: defaultRequestId("alert-rule"),
  });
}

function alertJobPayload(dryRun) {
  return {
    campaignId: filters.campaignId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    dryRun,
  };
}

function requireConfigWrite() {
  if (canConfigWrite.value) return true;
  ElMessage.warning(access.reason(ADMIN_CAPABILITIES.CONFIG_WRITE));
  return false;
}

async function submitAlertRule() {
  if (!requireConfigWrite()) return;
  alertRuleLoading.value = true;
  errorMessage.value = "";
  try {
    const requestId = alertRuleForm.requestId || defaultRequestId("alert-rule");
    await upsertOperationalAlertRule({ ...alertRuleForm, campaignId: filters.campaignId }, requestId);
    await load();
    alertRuleForm.requestId = defaultRequestId("alert-rule");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    alertRuleLoading.value = false;
  }
}

async function previewAlertJob() {
  if (!requireConfigWrite()) return;
  alertJobLoading.value = true;
  errorMessage.value = "";
  try {
    alertJobResult.value = await runOperationalAlertJob(alertJobPayload(true));
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    alertJobLoading.value = false;
  }
}

async function executeAlertJob() {
  if (!requireConfigWrite()) return;
  if (!window.confirm("确认执行运营预警 Job？")) return;
  alertJobLoading.value = true;
  errorMessage.value = "";
  try {
    const requestId = defaultRequestId("alert-job");
    alertJobResult.value = await runOperationalAlertJob(alertJobPayload(false), requestId);
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    alertJobLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    analytics.value = await fetchOperationalAnalytics(filters);
    filters.campaignId = analytics.value.filters?.campaignId || filters.campaignId;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function downloadCsv() {
  exportLoading.value = true;
  errorMessage.value = "";
  try {
    const csv = await exportOperationalAnalyticsCsv(filters);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `root-operational-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    exportLoading.value = false;
  }
}

function stopAutoRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = 0;
}

function syncAutoRefresh() {
  stopAutoRefresh();
  if (!autoRefresh.value) return;
  const interval = Math.max(30, Number(analytics.value.refresh?.defaultIntervalSeconds || 60));
  refreshTimer = window.setInterval(load, interval * 1000);
}

onMounted(load);
onUnmounted(stopAutoRefresh);
watch(autoRefresh, syncAutoRefresh);
watch(() => analytics.value.refresh?.defaultIntervalSeconds, syncAutoRefresh);

defineExpose({ load });
</script>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.workbench-alert {
  margin-bottom: 0;
}

.job-result {
  margin-top: 12px;
}

.toolbar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.metric-row {
  row-gap: 12px;
}

.metric-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 76px;
}

.metric-card span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.metric-card strong {
  color: var(--el-text-color-primary);
  font-size: 24px;
  line-height: 1;
}

.chart-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 260px;
}

.chart-row {
  display: grid;
  gap: 6px;
}

.chart-row__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.chart-row__meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-row__meta strong {
  font-size: 14px;
}

.chart-row small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.chart-row__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--el-fill-color-light);
}

.chart-row__fill {
  display: block;
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  background: var(--el-color-primary);
}

.chart-row__fill--success {
  background: var(--el-color-success);
}

.chart-row__fill--warning {
  background: var(--el-color-warning);
}

.chart-row__fill--danger {
  background: var(--el-color-danger);
}

.chart-row__fill--info {
  background: var(--el-color-primary);
}
</style>
