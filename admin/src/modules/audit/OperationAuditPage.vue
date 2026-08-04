<template>
  <section class="workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <header class="page-heading">
      <div>
        <h1>操作审计</h1>
        <p>查询内容发布、用户查看、名单导出与受控业务动作；记录不可编辑。</p>
      </div>
    </header>

    <el-card shadow="never">
      <template #header>
        <div class="audit-toolbar">
          <span>操作审计</span>
          <el-input v-model="filters.q" clearable placeholder="搜索操作、对象、版本或请求编号" @input="scheduleLoad" @keyup.enter="load" />
          <el-input v-model="filters.operatorId" clearable placeholder="操作人" @input="scheduleLoad" @keyup.enter="load" />
          <el-input v-model="filters.action" clearable placeholder="动作" @input="scheduleLoad" @keyup.enter="load" />
          <el-button type="primary" @click="load">查询</el-button>
        </div>
      </template>

      <el-table v-loading="loading" :data="auditLogs" height="560" @row-click="selectLog">
        <el-table-column label="序号" width="66">
          <template #default="{ $index }">{{ String((filters.page - 1) * filters.pageSize + $index + 1).padStart(2, "0") }}</template>
        </el-table-column>
        <el-table-column label="操作人与动作" min-width="210">
          <template #default="{ row }">
            <div class="table-title">{{ row.operator_id || "系统" }}</div>
            <div class="table-meta">{{ row.action }}</div>
          </template>
        </el-table-column>
        <el-table-column label="对象与请求编号" min-width="280">
          <template #default="{ row }">
            <div class="table-title">{{ row.target_type || "-" }}</div>
            <div class="table-meta">{{ row.target_id || "-" }} · {{ row.request_id || "无请求编号" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="104">
          <template #default="{ row }">
            <el-tag :type="resultTagType(row)" effect="plain">
              {{ resultLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="发生时间" min-width="180" />
        <el-table-column label="操作" width="88" align="right">
          <template #default="{ row }"><el-button link type="primary" @click.stop="selectLog(row)">查看</el-button></template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > filters.pageSize"
        v-model:current-page="filters.page"
        :page-size="filters.pageSize"
        :total="total"
        class="content-pagination"
        layout="prev, pager, next"
        @current-change="load"
      />
    </el-card>

    <el-drawer v-model="detailVisible" size="44%" title="审计详情">
      <template v-if="selectedLog">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="审计编号">{{ selectedLog.audit_log_id }}</el-descriptions-item>
          <el-descriptions-item label="动作">{{ selectedLog.action }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ selectedLog.operator_id || "-" }}</el-descriptions-item>
          <el-descriptions-item label="对象">{{ selectedLog.target_type }} / {{ selectedLog.target_id }}</el-descriptions-item>
          <el-descriptions-item label="版本">{{ selectedLog.version || "-" }}</el-descriptions-item>
          <el-descriptions-item label="结果">{{ resultLabel(selectedLog) }}</el-descriptions-item>
          <el-descriptions-item label="请求编号">{{ selectedLog.request_id || "-" }}</el-descriptions-item>
        </el-descriptions>
        <h3 class="drawer-section-title">安全摘要</h3>
        <pre class="preview-json">{{ formatJson(selectedLog.summary) }}</pre>
        <p class="table-footer-hint">审计页面不返回原始请求、健康答案、身份原值或凭据。</p>
        <el-button :disabled="!selectedLog.request_id" type="primary" @click="copyRequestId">复制事件编号</el-button>
      </template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { fetchAuditLogs } from "./adminAuditApi";

const errorMessage = ref("");
const auditLogs = ref([]);
const selectedLog = ref(null);
const detailVisible = ref(false);
const loading = ref(false);
const total = ref(0);
const filters = reactive({ q: "", action: "", operatorId: "", page: 1, pageSize: 20 });
let searchTimer = null;
let loadController = null;
let loadSequence = 0;

function formatJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function resultLabel(row) {
  if (row?.outcome_unknown || row?.result === "UNKNOWN") return "待确认";
  return row?.result === "FAILURE" ? "失败" : "成功";
}

function resultTagType(row) {
  if (row?.outcome_unknown || row?.result === "UNKNOWN") return "warning";
  return row?.result === "FAILURE" ? "danger" : "success";
}

function scheduleLoad() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.page = 1;
    load();
  }, 300);
}

async function load() {
  clearTimeout(searchTimer);
  const sequence = ++loadSequence;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchAuditLogs(filters, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    auditLogs.value = result.auditLogs || [];
    total.value = Number(result.pagination?.total || 0);
  } catch (error) {
    if (error.code !== "ADMIN_ABORTED") errorMessage.value = error.message;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function selectLog(row) {
  selectedLog.value = row;
  detailVisible.value = true;
}

async function copyRequestId() {
  if (!selectedLog.value?.request_id) return;
  try {
    await navigator.clipboard.writeText(selectedLog.value.request_id);
    ElMessage.success("事件编号已复制");
  } catch (_) {
    ElMessage.error("复制失败，请手动选择事件编号");
  }
}

onMounted(load);
onUnmounted(() => {
  clearTimeout(searchTimer);
  loadController?.abort();
});

defineExpose({ load });
</script>

<style scoped>
.audit-toolbar {
  display: grid;
  grid-template-columns: 96px minmax(220px, 1.5fr) minmax(140px, 0.8fr) minmax(140px, 0.8fr) auto;
  gap: 8px;
  align-items: center;
}

.audit-toolbar > span {
  font-weight: 700;
  white-space: nowrap;
}
</style>
