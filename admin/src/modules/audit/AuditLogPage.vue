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
          <span>审计记录</span>
          <el-space>
            <el-input v-model="filters.q" clearable placeholder="搜索操作/对象/request_id" @keyup.enter="load" />
            <el-input v-model="filters.operatorId" clearable placeholder="操作人" @keyup.enter="load" />
            <el-select v-model="filters.action" clearable placeholder="动作">
              <el-option label="单条复核" value="RESOLVE_MANUAL_REVIEW" />
              <el-option label="批量复核" value="BATCH_MANUAL_REVIEW_RESOLVE" />
              <el-option label="批量结算" value="BATCH_SETTLEMENT_EXECUTE" />
              <el-option label="奖励发放" value="REWARD_DELIVERY_BATCH_EXECUTE" />
              <el-option label="规则发布" value="PUBLISH_CAMPAIGN_RULE_VERSION" />
            </el-select>
            <el-button type="primary" @click="load">查询</el-button>
          </el-space>
        </div>
      </template>

      <el-table :data="auditLogs" height="620" @row-click="selectLog">
        <el-table-column prop="created_at" label="时间" min-width="180" />
        <el-table-column prop="action" label="动作" min-width="190" />
        <el-table-column prop="operator_id" label="操作人" width="130" />
        <el-table-column label="对象" min-width="220">
          <template #default="{ row }">
            <div class="table-title">{{ row.target_type || "-" }}</div>
            <div class="table-meta">{{ row.target_id || "-" }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="180" />
        <el-table-column label="request_id" min-width="190">
          <template #default="{ row }">
            {{ row.metadata?.requestId || row.metadata?.batchRequestId || "-" }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="detailVisible" size="44%" title="审计详情">
      <template v-if="selectedLog">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="audit_log_id">{{ selectedLog.audit_log_id }}</el-descriptions-item>
          <el-descriptions-item label="action">{{ selectedLog.action }}</el-descriptions-item>
          <el-descriptions-item label="operator_id">{{ selectedLog.operator_id || "-" }}</el-descriptions-item>
          <el-descriptions-item label="target">{{ selectedLog.target_type }} / {{ selectedLog.target_id }}</el-descriptions-item>
          <el-descriptions-item label="reason">{{ selectedLog.reason || "-" }}</el-descriptions-item>
        </el-descriptions>
        <h3 class="drawer-section-title">metadata</h3>
        <pre class="preview-json">{{ formatJson(selectedLog.metadata) }}</pre>
        <h3 class="drawer-section-title">before</h3>
        <pre class="preview-json">{{ formatJson(selectedLog.before) }}</pre>
        <h3 class="drawer-section-title">after</h3>
        <pre class="preview-json">{{ formatJson(selectedLog.after) }}</pre>
      </template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { fetchAuditLogs } from "./adminAuditApi";

const errorMessage = ref("");
const auditLogs = ref([]);
const selectedLog = ref(null);
const detailVisible = ref(false);
const filters = reactive({
  q: "",
  action: "",
  operatorId: "",
  limit: 100,
});

function formatJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

async function load() {
  errorMessage.value = "";
  try {
    const result = await fetchAuditLogs(filters);
    auditLogs.value = result.auditLogs || [];
  } catch (error) {
    errorMessage.value = error.message;
  }
}

function selectLog(row) {
  selectedLog.value = row;
  detailVisible.value = true;
}

onMounted(load);

defineExpose({ load });
</script>
