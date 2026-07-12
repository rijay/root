<template>
  <section class="workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <el-row :gutter="12" class="metric-row">
      <el-col v-for="metric in metricCards" :key="metric.key" :span="4">
        <el-card class="metric-card" shadow="never">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>有赞订单增量</template>
          <el-form label-position="top">
            <el-form-item label="Adapter">
              <el-select v-model="orderForm.adapterKind">
                <el-option label="手工样本" value="MANUAL_SAMPLE" />
                <el-option label="有赞开放平台" value="YOUZAN_OPEN" />
              </el-select>
            </el-form-item>
            <el-form-item label="每次拉取">
              <el-input-number v-model="orderForm.limit" :min="1" :max="100" />
            </el-form-item>
            <el-form-item label="游标">
              <el-input v-model="orderForm.cursor" clearable placeholder="不填则使用已保存游标" />
            </el-form-item>
            <el-form-item label="request_id">
              <el-input v-model="orderForm.requestId" clearable placeholder="order-increment-..." />
            </el-form-item>
            <el-form-item label="样本订单">
              <el-input
                v-model="orderForm.text"
                :disabled="orderForm.adapterKind !== 'MANUAL_SAMPLE'"
                :rows="9"
                placeholder="粘贴有赞订单 CSV / 表格文本；选择有赞开放平台时留空"
                type="textarea"
              />
            </el-form-item>
            <el-form-item>
              <el-checkbox v-model="orderForm.confirmRisk">已确认导入会写入订单镜像并推进游标</el-checkbox>
            </el-form-item>
            <el-space wrap>
              <el-button
                :disabled="!canConfigWrite"
                :loading="loading.preview"
                :title="configWriteTitle"
                @click="submitOrderPreview"
              >
                预览
              </el-button>
              <el-button
                :disabled="!canConfigWrite"
                :loading="loading.execute"
                :title="configWriteTitle"
                type="primary"
                @click="submitOrderExecute"
              >
                确认导入
              </el-button>
            </el-space>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="16">
        <el-card shadow="never">
          <template #header>
            <div class="toolbar-title">
              <span>订单增量结果</span>
              <span v-if="orderResult" class="table-meta">
                {{ orderResult.summary?.mode || "-" }} / 可导入 {{ orderResult.summary?.importableCount || 0 }} / 已导入 {{ orderResult.summary?.importedCount || 0 }}
              </span>
            </div>
          </template>
          <el-table :data="orderRows" height="360">
            <el-table-column prop="index" label="#" width="64" />
            <el-table-column label="订单号" min-width="170">
              <template #default="{ row }">{{ row.mapped?.youzanOrderNo || "-" }}</template>
            </el-table-column>
            <el-table-column label="手机号" width="140">
              <template #default="{ row }">{{ row.mapped?.receiverPhone || "-" }}</template>
            </el-table-column>
            <el-table-column label="订单/物流" width="150">
              <template #default="{ row }">
                {{ row.mapped?.orderStatus || "-" }} / {{ row.mapped?.deliveryStatus || "-" }}
              </template>
            </el-table-column>
            <el-table-column label="结果" width="120">
              <template #default="{ row }">
                <el-tag :type="row.importable ? 'success' : 'danger'" effect="plain">
                  {{ row.imported ? "已导入" : row.importable ? "可导入" : "阻塞" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提醒" min-width="220">
              <template #default="{ row }">
                {{ [...(row.errors || []), ...(row.warnings || [])].join("；") || "-" }}
              </template>
            </el-table-column>
          </el-table>
          <pre v-if="orderResult" class="preview-json">{{ formatJson(orderResult.summary) }}</pre>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>Adapter 状态</span>
          <el-button @click="load">刷新</el-button>
        </div>
      </template>
      <el-table :data="adapterRows" height="300">
        <el-table-column prop="label" label="Adapter" min-width="190" />
        <el-table-column prop="sourceType" label="来源" width="150" />
        <el-table-column prop="adapterKind" label="类型" width="160" />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="游标" min-width="180">
          <template #default="{ row }">{{ row.cursor?.cursor_value || "-" }}</template>
        </el-table-column>
        <el-table-column prop="nextAction" label="下一步" min-width="260" />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>有赞客户镜像</span>
          <el-space>
            <el-input
              v-model="customerFilters.keyword"
              clearable
              placeholder="yzUid / UnionID / root_user_id / 手机号 / 昵称"
              @keyup.enter="loadCustomers()"
            />
            <el-input-number v-model="customerFilters.limit" :min="1" :max="100" />
            <el-button :loading="loading.customers" @click="loadCustomers()">查询</el-button>
          </el-space>
        </div>
      </template>
      <el-table :data="youzanCustomers" height="320" @row-click="selectCustomer">
        <el-table-column prop="youzanYzUid" label="yzUid" min-width="170" />
        <el-table-column prop="nickname" label="昵称" width="130" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column label="补链状态" width="150">
          <template #default="{ row }">
            <el-tag :type="customerLinkStatusType(row.linkStatus)" effect="plain">
              {{ customerLinkStatusLabel(row.linkStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="rootUserId" label="root_user_id" min-width="170" />
        <el-table-column prop="matchSource" label="证据" width="120" />
        <el-table-column label="订单" width="120">
          <template #default="{ row }">
            {{ row.orderSummary?.boundOrders || 0 }}/{{ row.orderSummary?.totalOrders || 0 }}
            <span v-if="row.orderSummary?.unboundOrders">，未绑 {{ row.orderSummary.unboundOrders }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最近订单" min-width="170">
          <template #default="{ row }">
            {{ row.orderSummary?.latestOrderNo || "-" }}
          </template>
        </el-table-column>
        <el-table-column prop="nextAction" label="下一步" min-width="300" />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>运行台账</span>
          <el-space>
            <el-tag effect="plain" type="warning">
              到期重试 {{ retryScheduler.selectedCount || 0 }} / 待到期 {{ retryScheduler.pendingCount || 0 }}
            </el-tag>
            <el-button
              :disabled="!canConfigWrite"
              :loading="loading.retryPreview"
              :title="configWriteTitle"
              @click="previewDueRetries"
            >
              预览到期重试
            </el-button>
            <el-button
              :disabled="!canConfigWrite"
              :loading="loading.retryExecute"
              :title="configWriteTitle"
              type="warning"
              @click="executeDueRetries"
            >
              执行到期重试
            </el-button>
            <el-select v-model="runFilters.sourceType" clearable placeholder="来源">
              <el-option label="有赞订单" value="YOUZAN_ORDER" />
              <el-option label="有赞客户" value="YOUZAN_CUSTOMER" />
              <el-option label="物流状态" value="FULFILLMENT" />
              <el-option label="企业微信线索" value="WECHAT_LEAD" />
            </el-select>
            <el-select v-model="runFilters.adapterKind" clearable placeholder="Adapter">
              <el-option label="手工样本" value="MANUAL_SAMPLE" />
              <el-option label="有赞订单" value="YOUZAN_OPEN" />
              <el-option label="有赞客户" value="YOUZAN_CUSTOMER" />
              <el-option label="物流" value="FULFILLMENT_PUSH" />
              <el-option label="企微线索" value="WEWORK_CONTACT" />
            </el-select>
            <el-select v-model="runFilters.status" clearable placeholder="状态">
              <el-option label="完成" value="COMPLETED" />
              <el-option label="带错误完成" value="COMPLETED_WITH_ERRORS" />
              <el-option label="失败" value="FAILED" />
            </el-select>
          </el-space>
        </div>
      </template>
      <el-alert
        v-if="retryResult"
        :closable="false"
        :title="retryResultTitle"
        :type="retryResultType"
        class="retry-summary"
        show-icon
      />
      <pre v-if="retryResult" class="preview-json compact-json">{{ formatJson(retryResult) }}</pre>
      <el-table :data="filteredRuns" height="360" @row-click="selectRun">
        <el-table-column prop="started_at" label="开始时间" min-width="180" />
        <el-table-column prop="source_type" label="来源" width="140" />
        <el-table-column prop="adapter_kind" label="Adapter" width="160" />
        <el-table-column prop="mode" label="模式" width="90" />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="imported_count" label="导入" width="80" />
        <el-table-column label="回滚" width="120">
          <template #default="{ row }">
            <el-tag :type="rollbackStatusType(row.rollback_status)" effect="plain">
              {{ row.rollback_status || "NOT_AVAILABLE" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="重试状态" width="140">
          <template #default="{ row }">
            <el-tag :type="retryStatusType(row.retry_status)" effect="plain">
              {{ row.retry_status || "NOT_REQUIRED" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="next_retry_at" label="建议重试" min-width="170" />
        <el-table-column prop="error_count" label="错误" width="80" />
        <el-table-column label="游标" min-width="220">
          <template #default="{ row }">{{ row.cursor_before || "-" }} → {{ row.cursor_after || "-" }}</template>
        </el-table-column>
        <el-table-column prop="error_message" label="失败原因" min-width="240" />
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-space>
              <el-button
                :disabled="!canConfigWrite"
                :loading="loading.rerun"
                :title="configWriteTitle"
                size="small"
                @click.stop="rerunAdapter(row, 'PREVIEW')"
              >
                重新预览
              </el-button>
              <el-button
                :disabled="!canConfigWrite"
                :loading="loading.rerun"
                :title="configWriteTitle"
                size="small"
                type="primary"
                @click.stop="rerunAdapter(row, 'IMPORT')"
              >
                重试导入
              </el-button>
              <el-button
                :disabled="!canConfigWrite"
                v-if="canRollbackRun(row)"
                :loading="loading.rollback"
                :title="configWriteTitle"
                size="small"
                type="danger"
                @click.stop="rollbackRun(row)"
              >
                回滚
              </el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>游标记录</template>
      <el-table :data="cursors" height="220">
        <el-table-column prop="source_type" label="来源" width="150" />
        <el-table-column prop="adapter_kind" label="Adapter" width="170" />
        <el-table-column prop="cursor_value" label="游标" min-width="240" />
        <el-table-column prop="last_successful_at" label="最近成功" min-width="180" />
        <el-table-column prop="last_successful_run_id" label="运行 ID" min-width="180" />
      </el-table>
    </el-card>

    <el-drawer v-model="detailVisible" size="56%" title="Adapter 运行详情">
      <template v-if="selectedRun">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="run_id">{{ selectedRun.run_id }}</el-descriptions-item>
          <el-descriptions-item label="source_type">{{ selectedRun.source_type }}</el-descriptions-item>
          <el-descriptions-item label="adapter_kind">{{ selectedRun.adapter_kind }}</el-descriptions-item>
          <el-descriptions-item label="mode">{{ selectedRun.mode }}</el-descriptions-item>
          <el-descriptions-item label="status">{{ selectedRun.status }}</el-descriptions-item>
          <el-descriptions-item label="requested_limit">{{ selectedRun.requested_limit || "-" }}</el-descriptions-item>
          <el-descriptions-item label="cursor_before">{{ selectedRun.cursor_before || "-" }}</el-descriptions-item>
          <el-descriptions-item label="cursor_after">{{ selectedRun.cursor_after || "-" }}</el-descriptions-item>
          <el-descriptions-item label="has_more">{{ selectedRun.has_more ? "是" : "否" }}</el-descriptions-item>
          <el-descriptions-item label="review_id">{{ selectedRun.review_id || "-" }}</el-descriptions-item>
          <el-descriptions-item label="rollback_status">{{ selectedRun.rollback_status || "NOT_AVAILABLE" }}</el-descriptions-item>
          <el-descriptions-item label="rollback_targets">{{ selectedRun.rollback_targets?.length || 0 }}</el-descriptions-item>
          <el-descriptions-item label="retry_status">{{ selectedRun.retry_status || "NOT_REQUIRED" }}</el-descriptions-item>
          <el-descriptions-item label="retry_attempt">{{ selectedRun.retry_attempt || 0 }}</el-descriptions-item>
          <el-descriptions-item label="retry_source_run_id">{{ selectedRun.retry_source_run_id || "-" }}</el-descriptions-item>
          <el-descriptions-item label="next_retry_at">{{ selectedRun.next_retry_at || "-" }}</el-descriptions-item>
          <el-descriptions-item label="retry_reason">{{ selectedRun.retry_reason || "-" }}</el-descriptions-item>
          <el-descriptions-item label="error">{{ selectedRun.error_message || "-" }}</el-descriptions-item>
        </el-descriptions>
        <el-space class="drawer-actions" wrap>
          <el-button
            :disabled="!canConfigWrite"
            :loading="loading.rerun"
            :title="configWriteTitle"
            @click="rerunAdapter(selectedRun, 'PREVIEW')"
          >
            重新预览
          </el-button>
          <el-button
            :disabled="!canConfigWrite"
            :loading="loading.rerun"
            :title="configWriteTitle"
            type="primary"
            @click="rerunAdapter(selectedRun, 'IMPORT')"
          >
            重试导入
          </el-button>
          <el-button
            :disabled="!canConfigWrite"
            v-if="canRollbackRun(selectedRun)"
            :loading="loading.rollback"
            :title="configWriteTitle"
            type="danger"
            @click="rollbackRun(selectedRun)"
          >
            回滚本次导入
          </el-button>
        </el-space>

        <template v-if="selectedRun.rollback_result">
          <h3 class="drawer-section-title">回滚结果</h3>
          <pre class="preview-json">{{ formatJson(selectedRun.rollback_result) }}</pre>
        </template>

        <h3 class="drawer-section-title">取样评审</h3>
        <el-alert
          v-if="selectedRun.review_id && !selectedReview"
          :closable="false"
          title="未找到该运行对应的取样评审记录"
          type="warning"
        />
        <template v-else-if="selectedReview">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="review_id">{{ selectedReview.review_id }}</el-descriptions-item>
            <el-descriptions-item label="decision_status">
              <el-tag :type="statusType(selectedReview.decision_status)" effect="plain">
                {{ selectedReview.decision_status }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="source_type">{{ selectedReview.source_type }}</el-descriptions-item>
            <el-descriptions-item label="mode">{{ selectedReview.mode }}</el-descriptions-item>
            <el-descriptions-item label="total">{{ selectedReview.total || 0 }}</el-descriptions-item>
            <el-descriptions-item label="importable">{{ selectedReview.importable_count || 0 }}</el-descriptions-item>
            <el-descriptions-item label="imported">{{ selectedReview.imported_count || 0 }}</el-descriptions-item>
            <el-descriptions-item label="warning/error">
              {{ selectedReview.warning_count || 0 }} / {{ selectedReview.error_count || 0 }}
            </el-descriptions-item>
          </el-descriptions>

          <el-table :data="fieldCoverageRows(selectedReview)" height="260" size="small">
            <el-table-column prop="field" label="字段" min-width="170" />
            <el-table-column prop="present" label="有值" width="80" />
            <el-table-column prop="total" label="样本" width="80" />
            <el-table-column label="覆盖率" width="120">
              <template #default="{ row }">
                <el-tag :type="row.rate === 100 ? 'success' : row.rate > 0 ? 'warning' : 'danger'" effect="plain">
                  {{ row.rate }}%
                </el-tag>
              </template>
            </el-table-column>
          </el-table>

          <el-row :gutter="12">
            <el-col :span="12">
              <h3 class="drawer-section-title">缺失字段</h3>
              <el-table :data="selectedReview.missing_required_fields || []" height="180" size="small">
                <el-table-column prop="message" label="问题" min-width="180" />
                <el-table-column prop="count" label="数量" width="80" />
              </el-table>
            </el-col>
            <el-col :span="12">
              <h3 class="drawer-section-title">未知状态</h3>
              <el-table :data="selectedReview.unknown_status_values || []" height="180" size="small">
                <el-table-column prop="field" label="字段" width="120" />
                <el-table-column prop="value" label="原始值" min-width="140" />
                <el-table-column prop="count" label="数量" width="80" />
              </el-table>
            </el-col>
          </el-row>

          <h3 class="drawer-section-title">原始样本行排查</h3>
          <div class="row-filter-bar">
            <el-segmented
              v-model="reviewRowFilters.status"
              :options="reviewRowStatusOptions"
            />
            <el-input
              v-model="reviewRowFilters.keyword"
              clearable
              placeholder="搜索原始字段、映射字段、错误或警告"
            />
          </div>
          <el-table :data="filteredReviewRows" height="280" size="small" @row-click="selectReviewRow">
            <el-table-column prop="index" label="#" width="64" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="reviewRowStatusType(row)" effect="plain">
                  {{ row.imported ? "已导入" : row.status || "-" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="核心字段" min-width="220">
              <template #default="{ row }">{{ reviewRowPrimaryText(row) }}</template>
            </el-table-column>
            <el-table-column label="问题" min-width="260">
              <template #default="{ row }">{{ reviewRowIssueText(row) }}</template>
            </el-table-column>
            <el-table-column label="结果" min-width="180">
              <template #default="{ row }">
                {{ row.result_summary?.targetType || "-" }} {{ row.result_summary?.label || row.result_summary?.targetId || "" }}
              </template>
            </el-table-column>
          </el-table>
          <template v-if="selectedReviewRow">
            <h3 class="drawer-section-title">行 {{ selectedReviewRow.index }} 详情</h3>
            <el-row :gutter="12">
              <el-col :span="12">
                <h4 class="json-title">原始字段</h4>
                <pre class="preview-json compact-json">{{ formatJson(selectedReviewRow.raw) }}</pre>
              </el-col>
              <el-col :span="12">
                <h4 class="json-title">映射字段</h4>
                <pre class="preview-json compact-json">{{ formatJson(selectedReviewRow.mapped) }}</pre>
              </el-col>
            </el-row>
          </template>
        </template>
        <el-empty v-else description="该运行没有关联取样评审" />

        <h3 class="drawer-section-title">运行记录</h3>
        <pre class="preview-json">{{ formatJson(selectedRun) }}</pre>
      </template>
    </el-drawer>

    <el-drawer v-model="customerDetailVisible" size="42%" title="有赞客户镜像详情">
      <template v-if="selectedCustomer">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="yzUid">{{ selectedCustomer.youzanYzUid || "-" }}</el-descriptions-item>
          <el-descriptions-item label="补链状态">
            <el-tag :type="customerLinkStatusType(selectedCustomer.linkStatus)" effect="plain">
              {{ customerLinkStatusLabel(selectedCustomer.linkStatus) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="root_user_id">{{ selectedCustomer.rootUserId || "-" }}</el-descriptions-item>
          <el-descriptions-item label="unionid">{{ selectedCustomer.unionid || "-" }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ selectedCustomer.phone || "-" }}</el-descriptions-item>
          <el-descriptions-item label="证据">{{ selectedCustomer.matchSource || "-" }}</el-descriptions-item>
          <el-descriptions-item label="订单绑定">
            已绑 {{ selectedCustomer.orderSummary?.boundOrders || 0 }} /
            总计 {{ selectedCustomer.orderSummary?.totalOrders || 0 }} /
            未绑 {{ selectedCustomer.orderSummary?.unboundOrders || 0 }}
          </el-descriptions-item>
          <el-descriptions-item label="最近订单">{{ selectedCustomer.orderSummary?.latestOrderNo || "-" }}</el-descriptions-item>
          <el-descriptions-item label="下一步">{{ selectedCustomer.nextAction || "-" }}</el-descriptions-item>
        </el-descriptions>
        <h3 class="drawer-section-title">镜像记录</h3>
        <pre class="preview-json">{{ formatJson(selectedCustomer) }}</pre>
      </template>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ADMIN_CAPABILITIES, useAdminAccess } from "../access";
import {
  executeOrderIncrement,
  fetchExternalAdapters,
  fetchExternalSampleReviews,
  fetchYouzanCustomers,
  previewOrderIncrement,
  rollbackExternalAdapterRun,
  runDueExternalAdapterRetries,
  runExternalAdapter,
} from "./adminAdapterApi";

const errorMessage = ref("");
const catalog = ref({ manualAdapters: [], realAdapters: [], adapters: [] });
const runs = ref([]);
const cursors = ref([]);
const reviews = ref([]);
const retryScheduler = ref({ selectedCount: 0, pendingCount: 0, skippedCount: 0, candidates: [] });
const retryResult = ref(null);
const reviewDetail = ref(null);
const selectedReviewRow = ref(null);
const youzanCustomers = ref([]);
const readiness = ref({ sources: [] });
const orderResult = ref(null);
const selectedRun = ref(null);
const selectedCustomer = ref(null);
const detailVisible = ref(false);
const customerDetailVisible = ref(false);
const loading = reactive({
  load: false,
  preview: false,
  execute: false,
  rerun: false,
  rollback: false,
  customers: false,
  retryPreview: false,
  retryExecute: false,
});
const runFilters = reactive({ sourceType: "YOUZAN_ORDER", adapterKind: "", status: "" });
const customerFilters = reactive({ keyword: "", limit: 30 });
const reviewRowFilters = reactive({ status: "PROBLEM", keyword: "" });
const reviewRowStatusOptions = [
  { label: "问题行", value: "PROBLEM" },
  { label: "错误", value: "ERROR" },
  { label: "警告", value: "WARNING" },
  { label: "已导入", value: "IMPORTED" },
  { label: "全部", value: "ALL" },
];
const orderForm = reactive({
  adapterKind: "MANUAL_SAMPLE",
  limit: 20,
  cursor: "",
  requestId: "",
  confirmRisk: false,
  text: [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZ_SAMPLE_001,样本用户,13800000001,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址",
  ].join("\n"),
});
const access = useAdminAccess();
const canConfigWrite = computed(() => access.has(ADMIN_CAPABILITIES.CONFIG_WRITE));
const configWriteTitle = computed(() => access.reason(ADMIN_CAPABILITIES.CONFIG_WRITE));

function requireConfigWrite() {
  if (canConfigWrite.value) return true;
  ElMessage.warning(access.reason(ADMIN_CAPABILITIES.CONFIG_WRITE));
  return false;
}

const adapterRows = computed(() => catalog.value.adapters || []);
const orderRows = computed(() => orderResult.value?.result?.rows || []);
const failedRuns = computed(() => runs.value.filter((run) => run.status === "FAILED").length);
const retryableRuns = computed(() => runs.value.filter((run) => run.retry_status === "RETRYABLE").length);
const completedRuns = computed(() => runs.value.filter((run) => run.status === "COMPLETED").length);
const metricCards = computed(() => [
  { key: "adapters", label: "Adapter", value: adapterRows.value.length },
  { key: "ready", label: "READY", value: adapterRows.value.filter((item) => item.status === "READY").length },
  { key: "completed", label: "成功运行", value: completedRuns.value },
  { key: "failed", label: "失败/可重试", value: `${failedRuns.value}/${retryableRuns.value}` },
  { key: "cursors", label: "游标", value: cursors.value.length },
  { key: "readiness", label: "准入来源", value: readiness.value.sources?.length || 0 },
]);
const filteredRuns = computed(() => runs.value.filter((run) => {
  if (runFilters.sourceType && run.source_type !== runFilters.sourceType) return false;
  if (runFilters.adapterKind && run.adapter_kind !== runFilters.adapterKind) return false;
  if (runFilters.status && run.status !== runFilters.status) return false;
  return true;
}));
const retryResultType = computed(() => {
  if (!retryResult.value) return "info";
  if (retryResult.value.failedCount) return "warning";
  if (retryResult.value.executedCount) return "success";
  return "info";
});
const retryResultTitle = computed(() => {
  if (!retryResult.value) return "";
  const action = retryResult.value.dryRun ? "到期重试预览" : "到期重试执行";
  return `${action}：候选 ${retryResult.value.selectedCount || 0}，执行 ${retryResult.value.executedCount || 0}，成功 ${retryResult.value.successCount || 0}，失败 ${retryResult.value.failedCount || 0}`;
});
const selectedReview = computed(() => {
  const reviewId = selectedRun.value?.review_id || "";
  if (!reviewId) return null;
  const candidates = [];
  if (reviewDetail.value) candidates.push(reviewDetail.value);
  candidates.push(...reviews.value);
  return candidates.find((review) => review.review_id === reviewId) || null;
});
const filteredReviewRows = computed(() => {
  const keyword = reviewRowFilters.keyword.trim().toLowerCase();
  return (selectedReview.value?.rows || []).filter((row) => {
    if (reviewRowFilters.status === "PROBLEM" && !(row.errors?.length || row.warnings?.length)) return false;
    if (reviewRowFilters.status === "ERROR" && !(row.errors?.length)) return false;
    if (reviewRowFilters.status === "WARNING" && !(row.warnings?.length) && !(row.status === "WARNING")) return false;
    if (reviewRowFilters.status === "IMPORTED" && !row.imported) return false;
    if (!keyword) return true;
    return [
      row.status,
      ...(row.errors || []),
      ...(row.warnings || []),
      JSON.stringify(row.raw || {}),
      JSON.stringify(row.mapped || {}),
      JSON.stringify(row.result_summary || {}),
    ].join(" ").toLowerCase().includes(keyword);
  });
});

function statusType(status) {
  if (status === "READY" || status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "BLOCKED") return "danger";
  if (status === "NEEDS_CONFIG" || status === "NEEDS_MAPPING" || status === "NEEDS_REVIEW" || status === "CONFIG_READY" || status === "COMPLETED_WITH_ERRORS") return "warning";
  return "info";
}

function rollbackStatusType(status) {
  if (status === "ROLLED_BACK") return "success";
  if (status === "PARTIAL" || status === "SKIPPED") return "warning";
  if (status === "NOT_APPLIED") return "info";
  return "";
}

function retryStatusType(status) {
  if (status === "RETRY_SUCCEEDED") return "success";
  if (status === "RETRYABLE") return "warning";
  if (status === "MANUAL_REVIEW") return "danger";
  return "info";
}

function customerLinkStatusLabel(status) {
  const labels = {
    LINKED: "已补链",
    LINKED_WITH_UNBOUND_ORDERS: "订单待补",
    PENDING_USER_MATCH: "待匹配用户",
    MISSING_EVIDENCE: "缺少证据",
  };
  return labels[status] || status || "未知";
}

function customerLinkStatusType(status) {
  if (status === "LINKED") return "success";
  if (status === "LINKED_WITH_UNBOUND_ORDERS" || status === "PENDING_USER_MATCH") return "warning";
  if (status === "MISSING_EVIDENCE") return "danger";
  return "info";
}

function formatJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function initialRunId() {
  return new URLSearchParams(window.location.search).get("runId") || "";
}

function syncRunDeepLink(run) {
  if (!run?.run_id) return;
  const params = new URLSearchParams(window.location.search);
  params.set("module", "adapters");
  params.set("runId", run.run_id);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`);
}

function mergeReview(review) {
  if (!review?.review_id) return;
  const index = reviews.value.findIndex((item) => item.review_id === review.review_id);
  if (index >= 0) {
    reviews.value.splice(index, 1, review);
  } else {
    reviews.value.unshift(review);
  }
}

function fieldCoverageRows(review) {
  return Object.entries(review?.field_coverage || {}).map(([field, item]) => ({
    field,
    present: item.present || 0,
    total: item.total || 0,
    rate: item.rate || 0,
  }));
}

function reviewRowStatusType(row) {
  if (row.errors?.length || row.status === "ERROR") return "danger";
  if (row.warnings?.length || row.status === "WARNING") return "warning";
  if (row.imported || row.status === "IMPORTED") return "success";
  return "info";
}

function reviewRowIssueText(row) {
  return [...(row.errors || []), ...(row.warnings || [])].join("；") || "-";
}

function reviewRowPrimaryText(row) {
  const mapped = row.mapped || {};
  return [
    mapped.youzanOrderNo,
    mapped.youzanYzUid,
    mapped.externalContactId,
    mapped.receiverPhone,
    mapped.deliveryStatus,
    mapped.orderStatus,
  ].filter(Boolean).join(" / ") || "-";
}

function selectReviewRow(row) {
  selectedReviewRow.value = row;
}

function toOrderResult(result) {
  const run = result.run || {};
  const syncResult = result.result || {};
  return {
    ...result,
    summary: result.summary || {
      adapterKind: result.adapterKind || run.adapter_kind || "",
      mode: result.mode || run.mode || "",
      status: run.status || "",
      total: syncResult.total || run.total || 0,
      importableCount: syncResult.importableCount || run.importable_count || 0,
      importedCount: syncResult.importedCount || run.imported_count || 0,
      errorCount: syncResult.errorCount || run.error_count || 0,
      warningCount: syncResult.warningCount || run.warning_count || 0,
      cursorBefore: run.cursor_before || "",
      cursorAfter: run.cursor_after || "",
    },
  };
}

function ensureOrderRequestId() {
  if (!orderForm.requestId) {
    orderForm.requestId = `order-increment-${Date.now().toString(36)}`;
  }
  return orderForm.requestId;
}

function orderPayload() {
  const payload = {
    adapterKind: orderForm.adapterKind,
    limit: orderForm.limit,
    cursor: orderForm.cursor,
  };
  if (orderForm.adapterKind === "MANUAL_SAMPLE") payload.text = orderForm.text;
  return payload;
}

async function loadReviewForRun(run) {
  const reviewId = run?.review_id || "";
  if (!reviewId || reviews.value.some((review) => review.review_id === reviewId)) return;
  try {
    const result = await fetchExternalSampleReviews({ reviewId, limit: 1 });
    const review = result.review || (result.reviews || [])[0] || null;
    reviewDetail.value = review;
    mergeReview(review);
  } catch (error) {
    errorMessage.value = `取样评审读取失败：${error.message}`;
  }
}

function selectRun(row, options = {}) {
  selectedRun.value = row;
  selectedReviewRow.value = null;
  detailVisible.value = true;
  if (options.replaceUrl !== false) syncRunDeepLink(row);
  loadReviewForRun(row);
}

function selectCustomer(row) {
  selectedCustomer.value = row;
  customerDetailVisible.value = true;
}

function selectRunFromUrl() {
  const runId = initialRunId();
  if (!runId || selectedRun.value?.run_id === runId) return;
  const row = runs.value.find((run) => run.run_id === runId);
  if (row) selectRun(row, { replaceUrl: false });
}

function payloadFromRun(run, mode) {
  const payload = {
    sourceType: run.source_type,
    adapterKind: run.adapter_kind,
    mode,
    limit: run.requested_limit || orderForm.limit || 20,
    cursor: run.cursor_before || "",
  };
  if (run.adapter_kind === "MANUAL_SAMPLE" && run.source_type === "YOUZAN_ORDER") {
    payload.text = orderForm.text;
  }
  if (run.status === "FAILED" || run.retry_status === "RETRYABLE") {
    payload.retrySourceRunId = run.run_id;
  }
  return payload;
}

function canRollbackRun(run) {
  if (!run) return false;
  if (run.mode !== "IMPORT") return false;
  if (!["COMPLETED", "COMPLETED_WITH_ERRORS"].includes(run.status)) return false;
  if (["ROLLED_BACK", "PARTIAL", "SKIPPED"].includes(run.rollback_status)) return false;
  return Array.isArray(run.rollback_targets) && run.rollback_targets.length > 0;
}

async function load() {
  loading.load = true;
  errorMessage.value = "";
  try {
    const result = await fetchExternalAdapters();
    catalog.value = result.catalog || { manualAdapters: [], realAdapters: [], adapters: [] };
    runs.value = result.runs || [];
    cursors.value = result.cursors || [];
    reviews.value = result.reviews || [];
    retryScheduler.value = result.retryScheduler || { selectedCount: 0, pendingCount: 0, skippedCount: 0, candidates: [] };
    readiness.value = result.readiness || { sources: [] };
    if (selectedRun.value) {
      selectedRun.value = runs.value.find((run) => run.run_id === selectedRun.value.run_id) || selectedRun.value;
    }
    selectRunFromUrl();
    await loadCustomers({ silent: true });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.load = false;
  }
}

async function previewDueRetries() {
  if (!requireConfigWrite()) return;
  loading.retryPreview = true;
  try {
    retryResult.value = await runDueExternalAdapterRetries({ dryRun: true, batchSize: 5 });
    ElMessage.success("到期重试预览已生成");
    await load();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.retryPreview = false;
  }
}

async function executeDueRetries() {
  if (!requireConfigWrite()) return;
  try {
    await ElMessageBox.confirm(
      "确认执行到期 Adapter 自动重试？系统会按 next_retry_at 批量重跑真实 Adapter，并保留来源运行 lineage。",
      "执行到期重试",
      { confirmButtonText: "确认执行", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }

  loading.retryExecute = true;
  try {
    const requestId = `adapter-retry-due-${Date.now().toString(36)}`;
    retryResult.value = await runDueExternalAdapterRetries({
      dryRun: false,
      batchSize: 5,
      requestId,
    }, requestId);
    if (retryResult.value.failedCount) {
      ElMessage.warning("到期重试已执行，部分 Adapter 仍失败");
    } else {
      ElMessage.success("到期重试已执行");
    }
    await load();
  } catch (error) {
    ElMessage.error(error.message);
    await load();
  } finally {
    loading.retryExecute = false;
  }
}

async function loadCustomers(options = {}) {
  loading.customers = true;
  try {
    const result = await fetchYouzanCustomers(customerFilters);
    youzanCustomers.value = result.customers || [];
  } catch (error) {
    if (options.silent) {
      errorMessage.value = `有赞客户镜像读取失败：${error.message}`;
    } else {
      ElMessage.error(error.message);
    }
  } finally {
    loading.customers = false;
  }
}

async function submitOrderPreview() {
  if (!requireConfigWrite()) return;
  loading.preview = true;
  try {
    orderResult.value = toOrderResult(await previewOrderIncrement(orderPayload()));
    ElMessage.success("订单增量预览已生成");
    await load();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.preview = false;
  }
}

async function submitOrderExecute() {
  if (!requireConfigWrite()) return;
  loading.execute = true;
  try {
    const requestId = ensureOrderRequestId();
    orderResult.value = toOrderResult(await executeOrderIncrement({
      ...orderPayload(),
      requestId,
      confirmRisk: orderForm.confirmRisk,
      reason: "Element Plus Admin 有赞订单增量同步",
    }, requestId));
    ElMessage.success("订单增量已导入");
    await load();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.execute = false;
  }
}

async function rerunAdapter(run, mode) {
  if (!run) return;
  if (!requireConfigWrite()) return;
  if (run.adapter_kind === "MANUAL_SAMPLE" && run.source_type !== "YOUZAN_ORDER") {
    ElMessage.warning("手工样本重跑需要在对应样本表单中重新粘贴数据");
    return;
  }
  if (run.adapter_kind === "MANUAL_SAMPLE" && run.source_type === "YOUZAN_ORDER" && !orderForm.text.trim()) {
    ElMessage.warning("请先在有赞订单增量表单中粘贴样本订单");
    return;
  }

  loading.rerun = true;
  try {
    const requestId = `adapter-rerun-${Date.now().toString(36)}`;
    const result = await runExternalAdapter(payloadFromRun(run, mode), requestId);
    if (run.source_type === "YOUZAN_ORDER") orderResult.value = toOrderResult(result);
    ElMessage.success(mode === "IMPORT" ? "Adapter 重试导入已完成" : "Adapter 重新预览已完成");
    await load();
  } catch (error) {
    ElMessage.error(error.message);
    await load();
  } finally {
    loading.rerun = false;
  }
}

async function rollbackRun(run) {
  if (!canRollbackRun(run)) return;
  if (!requireConfigWrite()) return;
  try {
    await ElMessageBox.confirm(
      `确认回滚运行 ${run.run_id}？该动作会撤回本次新建数据，或恢复导入前字段快照。`,
      "回滚 Adapter 导入",
      { confirmButtonText: "确认回滚", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }

  loading.rollback = true;
  try {
    const requestId = `adapter-rollback-${Date.now().toString(36)}`;
    await rollbackExternalAdapterRun({
      runId: run.run_id,
      requestId,
      confirmRisk: true,
      reason: "Element Plus Admin 回滚 Adapter 导入",
    }, requestId);
    ElMessage.success("Adapter 导入回滚已执行");
    await load();
  } catch (error) {
    ElMessage.error(error.message);
    await load();
  } finally {
    loading.rollback = false;
  }
}

onMounted(load);

defineExpose({ load });
</script>

<style scoped>
.row-filter-bar {
  display: grid;
  grid-template-columns: minmax(280px, max-content) minmax(220px, 1fr);
  gap: 12px;
  align-items: center;
  margin: 8px 0 12px;
}

.json-title {
  margin: 10px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.compact-json {
  max-height: 260px;
  overflow: auto;
}

.retry-summary {
  margin-bottom: 10px;
}

@media (max-width: 760px) {
  .row-filter-bar {
    grid-template-columns: 1fr;
  }
}
</style>
