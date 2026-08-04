<template>
  <section class="workbench content-workbench activity-registrations-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <header class="page-heading">
      <div>
        <h1>报名记录</h1>
        <p>查看活动报名、取消、审核状态及请求审计。</p>
      </div>
      <el-space>
        <el-button :disabled="!selectedActivityPreview" @click="previewActivity">预览当前线上</el-button>
        <el-button :disabled="!canExport" :loading="exporting" type="primary" @click="exportCurrentList">导出当前名单</el-button>
      </el-space>
    </header>

    <el-alert
      v-if="interfaceUnavailable"
      :closable="false"
      class="content-interface-notice"
      title="Activity Module 当前没有可读取的报名记录；页面不会生成示例用户或手机号。"
      type="info"
    />

    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input v-model="filters.search" clearable placeholder="搜索昵称、用户编号或手机号" @input="scheduleLoad" />
      <el-select v-model="filters.status" placeholder="全部报名状态" @change="load">
        <el-option label="全部报名状态" value="" />
        <el-option label="待确认" value="PENDING" />
        <el-option label="已报名" value="CONFIRMED" />
        <el-option label="已取消" value="CANCELED" />
        <el-option label="已拒绝" value="REJECTED" />
      </el-select>
      <el-select v-model="filters.activityId" filterable placeholder="选择活动" @change="load">
        <el-option label="全部活动" value="" />
        <el-option v-for="activity in activityOptions" :key="activity.activityId" :label="activity.title" :value="activity.activityId" />
      </el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>

    <section class="content-table-card activity-table-card">
      <el-table v-loading="loading" :data="rows" empty-text="暂无报名记录">
        <el-table-column label="序号" width="58">
          <template #default="{ $index }">{{ String((filters.page - 1) * pageSize + $index + 1).padStart(2, "0") }}</template>
        </el-table-column>
        <el-table-column label="报名用户" min-width="236">
          <template #default="{ row }">
            <div class="registration-user-cell">
              <span class="registration-avatar">{{ userInitial(row.memberNickname) }}</span>
              <span><strong>{{ row.memberNickname || "Root用户" }}</strong><small>UID {{ row.rootUserId || "—" }}</small></span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="验证手机号" min-width="166">
          <template #default="{ row }"><span>{{ row.memberContact || "—" }}</span><span class="description-meta">{{ row.memberContact ? "微信手机号已验证" : "验证信息待确认" }}</span></template>
        </el-table-column>
        <el-table-column label="提交时间" min-width="164">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="right">
          <template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看</el-button></template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="filters.page"
        class="content-pagination"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="load"
      />
    </section>

    <el-drawer v-model="drawerVisible" class="content-edit-drawer registration-detail-drawer" size="408px" :show-close="true">
      <template #header><div><h2>报名详情</h2><p>以下状态来自 Activity Module 权威回读。</p></div></template>

      <div class="registration-detail-stack">
        <section><label>报名用户</label><div class="registration-readonly-field">{{ selectedRow.memberNickname || "Root用户" }} · UID {{ selectedRow.rootUserId || "—" }}</div></section>
        <section><label>手机号验证</label><div class="registration-readonly-panel"><strong>{{ selectedRow.memberContact || "—" }}</strong><span>{{ selectedRow.memberContact ? "微信手机号已验证" : "手机号验证状态待确认" }}</span><small>后台默认脱敏，不显示会员资产或健康答案</small></div></section>
        <section><label>活动与当前状态</label><div class="registration-readonly-panel"><strong>{{ selectedRow.activityTitle || "活动待确认" }}</strong><span>{{ statusLabel(selectedRow.status) }} · {{ capacityLabel }}</span></div></section>
        <section><label>关键时间</label><div class="registration-time-grid"><span>报名 {{ formatShortDate(selectedRow.createdAt) }}</span><span>更新 {{ formatShortDate(selectedRow.updatedAt) }}</span><span>活动 {{ formatShortDate(selectedRow.sessionStartAt) }}</span></div></section>
        <section><label>请求与审计</label><div class="registration-readonly-field">{{ selectedRow.requestId || selectedRow.enrollmentId || "请求编号待回读" }}</div></section>
        <section><label>当前动作</label><div class="registration-readonly-field">{{ actionLabel }}</div></section>
      </div>

      <template #footer>
        <el-button @click="drawerVisible = false">关闭</el-button>
        <el-button type="primary" @click="openAudit">查看状态审计</el-button>
      </template>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { exportActivityEnrollments, fetchActivityEnrollments, fetchActivityOptions } from "./adminActivityApi";

const emit = defineEmits(["navigate-module"]);
const rows = ref([]);
const total = ref(0);
const pageSize = 20;
const loading = ref(false);
const exporting = ref(false);
const errorMessage = ref("");
const interfaceUnavailable = ref(false);
const drawerVisible = ref(false);
const selectedRow = ref({});
const activityOptions = ref([]);
const filters = reactive({ search: "", status: "", activityId: "", page: 1 });
let searchTimer = null;
let loadSequence = 0;
let loadController = null;

const canExport = computed(() => Boolean(filters.activityId && total.value));
const selectedActivityPreview = computed(() => activityOptions.value.find((item) => item.activityId === filters.activityId)?.previewPath || "");
const capacityLabel = computed(() => {
  if (!selectedRow.value.capacity) return "名额状态待确认";
  return `已占 ${selectedRow.value.confirmedCount || 0} / ${selectedRow.value.capacity} 个名额`;
});
const actionLabel = computed(() => ({
  PENDING: "等待审核，不允许直接覆盖状态",
  CONFIRMED: "已确认报名；取消必须走可审计动作",
  CANCELED: "已取消，以后端状态为准",
  REJECTED: "已拒绝，以后端状态为准",
})[selectedRow.value.status] || "当前没有可执行动作");

function userInitial(value) { return String(value || "R").trim().slice(0, 1).toUpperCase(); }
function statusLabel(status) { return ({ PENDING: "待确认", CONFIRMED: "已报名", CANCELED: "已取消", REJECTED: "已拒绝" })[status] || "待确认"; }
function statusType(status) {
  if (status === "CONFIRMED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED") return "danger";
  return "info";
}
function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}
function formatShortDate(value) { return value ? formatDateTime(value) : "—"; }
function scheduleLoad() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300);
}
function resetFilters() {
  Object.assign(filters, { search: "", status: "", activityId: "", page: 1 });
  load();
}
function openDetail(row) { selectedRow.value = row; drawerVisible.value = true; }
function previewActivity() { if (selectedActivityPreview.value) window.open(selectedActivityPreview.value, "_blank", "noopener,noreferrer"); }
function openAudit() { drawerVisible.value = false; emit("navigate-module", "audit"); }

async function exportCurrentList() {
  if (!canExport.value) return ElMessage.warning("请先选择活动且确认名单不为空");
  exporting.value = true;
  try {
    const result = await exportActivityEnrollments({ search: filters.search, status: filters.status, activityId: filters.activityId });
    if (!result?.downloadUrl) throw new Error("导出未返回可验证下载地址");
    window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    ElMessage.success("名单导出已进入操作审计");
  } catch (error) {
    errorMessage.value = error.status === 404 ? "名单导出 Interface 尚未接入，未生成文件" : (error.outcomeUnknown ? "导出结果待确认，请查询操作审计" : error.message);
  } finally { exporting.value = false; }
}
async function loadActivityOptions() {
  try {
    const data = await fetchActivityOptions();
    activityOptions.value = data?.items || [];
  } catch (_) { activityOptions.value = []; }
}
async function load() {
  const sequence = ++loadSequence;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  loading.value = true;
  errorMessage.value = "";
  interfaceUnavailable.value = false;
  try {
    const data = await fetchActivityEnrollments({ ...filters, pageSize }, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    rows.value = data?.items || [];
    total.value = Number(data?.total ?? data?.pagination?.total ?? 0);
  } catch (error) {
    if (error.code === "ADMIN_ABORTED" || sequence !== loadSequence) return;
    rows.value = [];
    total.value = 0;
    if (error.status === 404) interfaceUnavailable.value = true;
    else errorMessage.value = error.message;
  } finally { if (sequence === loadSequence) loading.value = false; }
}

onMounted(() => { load(); loadActivityOptions(); });
onBeforeUnmount(() => { clearTimeout(searchTimer); loadController?.abort(); });
defineExpose({ load });
</script>
