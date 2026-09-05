<template>
  <section class="workbench labels-workbench">
    <header class="page-heading"><div><h1>用户标签</h1><p>按用户汇总来源与测评。订单、企微、用户类型和备注在飞书维护。</p></div><el-button :loading="loading" @click="load">刷新</el-button></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert title="健康信息仅在 myRoot 后台查看，暂不向飞书发送。首次访问仅包含可关联到账号的记录。" type="info" :closable="false" />
    <el-form inline @submit.prevent="search">
      <el-input v-model="filters.userId" placeholder="精确用户 ID" clearable />
      <el-select v-model="filters.sourceStatus" placeholder="全部来源状态" clearable><el-option v-for="value in ['待确认', '来源冲突待核验', '已匹配']" :key="value" :label="value" :value="value" /></el-select>
      <el-checkbox v-if="access.has(ADMIN_CAPABILITIES.USER_LABEL_HEALTH_READ)" v-model="includeHealth" @change="search">查看测评信息</el-checkbox>
      <el-button type="primary" :loading="loading" @click="search">查询</el-button>
    </el-form>
    <el-table v-loading="loading" :data="rows" row-key="rootUserId" empty-text="暂无符合条件的用户" @selection-change="selectRows">
      <el-table-column type="selection" width="46" />
      <el-table-column label="用户 ID" prop="rootUserId" min-width="210" />
      <el-table-column label="首次可识别访问" min-width="166"><template #default="{ row }">{{ time(row.firstVisitAt) }}</template></el-table-column>
      <el-table-column label="来源活动" prop="source.activity" min-width="150" />
      <el-table-column label="城市 / 合作方" min-width="160"><template #default="{ row }">{{ row.source.city }} / {{ row.source.partner }}</template></el-table-column>
      <el-table-column label="渠道类型" prop="source.channelType" min-width="130" />
      <el-table-column label="来源状态" prop="source.status" min-width="140" />
      <el-table-column v-if="includeHealth" label="测评状态" prop="health.status" width="105" />
      <el-table-column v-if="includeHealth" label="基准结果" min-width="155"><template #default="{ row }">{{ row.health?.baseline?.resultTitle || row.health?.baseline?.resultCode || '未记录' }}</template></el-table-column>
      <el-table-column label="操作" fixed="right" width="75"><template #default="{ row }"><el-button link @click="detail = row">详情</el-button></template></el-table-column>
    </el-table>
    <div class="labels-actions">
      <span>已选 {{ selected.length }} 人 · 当前共 {{ total }} 人</span>
      <el-button :disabled="!selected.length || access.disabled(ADMIN_CAPABILITIES.USER_LABEL_EXPORT)" :loading="syncing" @click="preview">预览飞书变更</el-button>
      <el-button :disabled="!selected.length || access.disabled(ADMIN_CAPABILITIES.USER_LABEL_EXPORT)" :loading="syncing" @click="reconcile">回读待核验结果</el-button>
      <el-pagination v-model:current-page="page" :page-size="50" :total="total" layout="prev, pager, next" @current-change="load" />
    </div>
    <el-drawer :model-value="Boolean(detail)" title="用户标签详情" size="540px" @close="detail = null">
      <template v-if="detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户 ID">{{ detail.rootUserId }}</el-descriptions-item>
          <el-descriptions-item label="首次访问依据">{{ detail.firstVisitBasis }}</el-descriptions-item>
          <el-descriptions-item label="扫码来源">{{ detail.source.evidence.qr?.channelId || '未记录' }}</el-descriptions-item>
          <el-descriptions-item label="自报来源">{{ detail.source.evidence.selfReported?.label || '未记录' }}</el-descriptions-item>
          <el-descriptions-item label="用户类型 / 订单 / 企微">飞书人工维护；本地尚未核验</el-descriptions-item>
          <template v-if="detail.health">
            <el-descriptions-item label="测评状态">{{ detail.health.status }}</el-descriptions-item>
            <template v-if="detail.health.baseline">
              <el-descriptions-item label="基准测评">{{ detail.health.baseline.assessmentId }} · v{{ detail.health.baseline.questionnaireVersion }}<br>{{ time(detail.health.baseline.completedAt) }}</el-descriptions-item>
              <el-descriptions-item label="基准选择">{{ detail.health.baseline.selection }}</el-descriptions-item>
              <el-descriptions-item label="自测答案">{{ detail.health.baseline.answerText }}</el-descriptions-item>
              <el-descriptions-item label="原始结果">{{ detail.health.baseline.resultCode }} · {{ detail.health.baseline.resultTitle }}<br>{{ detail.health.baseline.resultVerified ? '已匹配原问卷字典' : '结果字典待核验' }}</el-descriptions-item>
            </template>
          </template>
        </el-descriptions>
      </template>
    </el-drawer>
    <el-drawer v-model="previewVisible" title="飞书同步预览" size="650px">
      <template v-if="syncPlan">
        <p>新增 {{ syncPlan.summary.create }} 人，更新 {{ syncPlan.summary.update }} 人。此次不发送测评状态、答案或分型。</p>
        <el-alert v-if="!syncPlan.writesEnabled" title="实际写入未启用；当前仅供核对变更。" type="info" :closable="false" />
        <el-alert v-for="item in syncPlan.blockers" :key="item" :title="item" type="warning" :closable="false" />
        <el-card v-for="action in syncPlan.actions" :key="action.rootUserId" shadow="never" class="preview-card">
          <strong>{{ action.kind === 'CREATE' ? '新增' : '更新' }} · {{ action.rootUserId }}</strong>
          <p v-if="action.preservedManualFields.length">保留人工来源：{{ action.preservedManualFields.join('、') }}</p>
          <el-descriptions :column="1" border><el-descriptions-item v-for="(value, name) in action.fields" :key="name" :label="name"><span class="previous-value">{{ cell(action.before[name], name) }}</span> → {{ cell(value, name) }}</el-descriptions-item></el-descriptions>
        </el-card>
        <el-checkbox v-if="syncPlan.writesEnabled" v-model="confirmed">确认将以上非健康字段写入目标飞书表</el-checkbox>
      </template>
      <template #footer><el-button @click="previewVisible = false">关闭</el-button><el-button type="primary" :loading="syncing" :disabled="!confirmed || !syncPlan?.writesEnabled || syncPlan?.blockers.length > 0 || !syncPlan?.actions.length" @click="execute">执行本次同步</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { ADMIN_CAPABILITIES, useAdminAccess } from "../access";
import { queryUserLabels, previewLabelSync, executeLabelSync, reconcileLabelSync } from "./adminUserLabelsApi";
const access = useAdminAccess();
const rows = ref([]), total = ref(0), page = ref(1), selected = ref([]), detail = ref(null);
const loading = ref(false), syncing = ref(false), error = ref(""), includeHealth = ref(false);
const filters = reactive({ userId: "", sourceStatus: "" });
const syncPlan = ref(null), previewVisible = ref(false), confirmed = ref(false);
const time = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "未记录";
const cell = (value, name) => value == null || value === "" ? "空" : ["首次可识别访问日期", "数据更新时间"].includes(name) ? time(value) : String(value);
function selectRows(values) { selected.value = values.map((r) => r.rootUserId); syncPlan.value = null; confirmed.value = false; }
let generation = 0;
async function load() {
  const current = ++generation; loading.value = true; error.value = ""; detail.value = null; selectRows([]); rows.value = [];
  try { const result = await queryUserLabels({ ...filters, page: page.value, includeHealth: includeHealth.value }); if (current === generation) { rows.value = result.rows; total.value = result.total; } }
  catch (e) { if (current === generation) error.value = e.message; }
  finally { if (current === generation) loading.value = false; }
}
function search() { page.value = 1; return load(); }
async function preview() {
  syncing.value = true; error.value = ""; confirmed.value = false;
  try { syncPlan.value = await previewLabelSync([...selected.value]); previewVisible.value = true; }
  catch (e) { error.value = e.message; }
  finally { syncing.value = false; }
}
async function execute() {
  if (!confirmed.value || !syncPlan.value) return;
  syncing.value = true;
  try { const result = await executeLabelSync(syncPlan.value); previewVisible.value = false;
    if (result.status === "PLAN_CHANGED") error.value = "飞书内容在执行期间发生变化，已停止后续写入，请重新预览。";
    else if (result.status !== "SYNCED") error.value = "部分写入结果待核验，请使用“回读待核验结果”，不要重复创建记录。";
    else ElMessage.success("已同步并完成回读核验");
  } catch (e) { error.value = e.message; }
  finally { syncing.value = false; confirmed.value = false; syncPlan.value = null; }
}
async function reconcile() {
  syncing.value = true;
  try { const result = await reconcileLabelSync([...selected.value]);
    if (result.results.some((r) => r.status === "UNKNOWN")) error.value = "仍有结果无法确认，保持停止重试，请人工核对目标表。";
    else { error.value = ""; ElMessage.success("回读完成，可重新预览"); }
    syncPlan.value = null;
  } catch (e) { error.value = e.message; } finally { syncing.value = false; }
}
watch(() => access.has(ADMIN_CAPABILITIES.USER_LABEL_HEALTH_READ), (allowed) => { if (!allowed) { includeHealth.value = false; load(); } });
onMounted(load); defineExpose({ load });
</script>

<style scoped>
.labels-workbench { display: grid; gap: 18px; }
.labels-workbench :deep(.el-form--inline) { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.labels-workbench :deep(.el-input), .labels-workbench :deep(.el-select) { width: 210px; }
.labels-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.labels-actions :deep(.el-pagination) { margin-left: auto; }
.preview-card { margin: 16px 0; overflow-wrap: anywhere; }
.preview-card :deep(.el-descriptions__table) { table-layout: fixed; }
.preview-card :deep(.el-descriptions__label.el-descriptions__cell) { width: 150px; word-break: normal; }
.preview-card :deep(.el-descriptions__content) { overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
.previous-value { color: var(--root-muted); }
</style>
