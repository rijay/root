<template>
  <section class="workbench content-workbench health-operations-page health-scales-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />
    <header class="page-heading">
      <div><h1>量表管理</h1><p>维护适用人群、题目、计分规则、结果分层与建议内容。</p></div>
      <el-space><el-button :disabled="!previewPath" @click="previewOnline">预览当前线上</el-button><el-button type="primary" @click="createDraft">新建量表</el-button></el-space>
    </header>
    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input v-model="filters.keyword" clearable placeholder="搜索量表名称或版本" @input="scheduleLoad" />
      <el-select v-model="filters.status" placeholder="全部发布状态" @change="load"><el-option label="全部发布状态" value="" /><el-option label="草稿" value="DRAFT" /><el-option label="已发布" value="PUBLISHED" /><el-option label="已停用" value="RETIRED" /></el-select>
      <el-select v-model="filters.audience" placeholder="全部适用人群" @change="load"><el-option label="全部适用人群" value="" /><el-option label="18 岁及以上" value="ADULT_18_PLUS" /><el-option label="指定人群" value="SPECIFIC" /></el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>
    <section class="content-table-card health-table-card">
      <el-table v-loading="loading" :data="rows" :empty-text="interfaceUnavailable ? '正式量表数据暂不可用' : '暂无量表'" height="510">
        <el-table-column label="序号" width="58"><template #default="{ $index }">{{ sequenceNumber($index) }}</template></el-table-column>
        <el-table-column label="量表" min-width="250"><template #default="{ row }"><div class="health-row-primary"><span class="health-row-marker" /><span><strong>{{ row.name || '未命名量表' }}</strong><small>{{ row.questionCount || 0 }} 题 · 约 {{ row.estimatedMinutes || '—' }} 分钟</small><small>{{ row.kindLabel || '标准量表' }}</small></span></div></template></el-table-column>
        <el-table-column label="版本与适用人群" min-width="170"><template #default="{ row }"><strong class="table-title">{{ row.versionLabel || '草稿' }} · {{ row.audienceLabel || '待配置' }}</strong><span class="description-meta">{{ row.adviceVersionLabel || '建议内容待关联' }}</span></template></el-table-column>
        <el-table-column label="生效时间" min-width="136"><template #default="{ row }">{{ row.effectiveAtLabel || '待配置' }}</template></el-table-column>
        <el-table-column label="状态" width="96"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column align="right" label="操作" width="164"><template #default="{ row }"><el-button link type="primary" @click="editDraft(row)">{{ row.status === 'PUBLISHED' ? '复制草稿' : '编辑' }}</el-button><el-button v-if="row.status === 'DRAFT'" :loading="publishingId === row.versionId" link type="success" @click="publishDraft(row)">发布</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-if="total > pageSize" v-model:current-page="filters.page" class="content-pagination" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load" />
    </section>
    <el-drawer v-model="drawerVisible" class="content-edit-drawer health-edit-drawer" size="408px" :show-close="true">
      <template #header><div><h2>{{ draft.sourceVersionId ? '复制量表版本' : draft.id ? '编辑量表版本' : '新建量表' }}</h2><p>题目、计分和结果分层必须作为同一版本保存。</p></div></template>
      <el-form label-position="top">
        <el-form-item label="量表名称 *"><el-input v-model="draft.name" maxlength="80" /></el-form-item>
        <el-form-item label="题目与选项 *"><el-input v-model="draft.questionSummary" :rows="4" resize="none" type="textarea" placeholder="填写题目数量、题型和预计完成时间" /><p class="field-help">长量表每组最多编辑 20 题，未展开题目不挂载。</p></el-form-item>
        <el-form-item label="计分与结果分层 *"><el-input v-model="draft.scoringSummary" :rows="3" resize="none" type="textarea" placeholder="填写总分范围、分层阈值和校验方式" /></el-form-item>
        <el-form-item label="适用与版本"><div class="typography-controls"><el-select v-model="draft.audience"><el-option label="18+" value="ADULT_18_PLUS" /></el-select><el-input-number v-model="draft.questionCount" :min="1" :max="100" controls-position="right" /><el-input-number v-model="draft.resultLevelCount" :min="1" :max="10" controls-position="right" /></div></el-form-item>
        <el-form-item label="建议内容版本 *"><el-select v-model="draft.adviceVersionId" placeholder="选择已批准建议内容版本"><el-option v-for="item in adviceOptions" :key="item.versionId" :label="item.label" :value="item.versionId" /></el-select></el-form-item>
        <el-form-item label="审批与生效"><div class="health-approval-grid"><el-input v-model="draft.approver" placeholder="健康内容负责人" /><el-date-picker v-model="draft.effectiveAt" placeholder="生效时间" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></div></el-form-item>
      </el-form>
      <template #footer><el-button @click="drawerVisible = false">取消</el-button><el-button :loading="saving" type="primary" @click="saveDraft">保存草稿</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { fetchHealthScales, publishHealthScaleVersion, saveHealthScaleDraft } from "./adminHealthApi";

const emptyDraft = () => ({ id: "", sourceVersionId: "", expectedRevision: 0, name: "", questionSummary: "", scoringSummary: "", audience: "ADULT_18_PLUS", questionCount: 12, resultLevelCount: 3, adviceVersionId: "", approver: "", effectiveAt: "" });
const rows = ref([]), total = ref(0), loading = ref(false), saving = ref(false), drawerVisible = ref(false), interfaceUnavailable = ref(false);
const errorMessage = ref(""), previewPath = ref(""), publishingId = ref(""), adviceOptions = ref([]);
const draft = reactive(emptyDraft()), filters = reactive({ keyword: "", status: "", audience: "", page: 1 });
const pageSize = 20;
let searchTimer = null, loadSequence = 0, loadController = null;
function sequenceNumber(index) { return String((filters.page - 1) * pageSize + index + 1).padStart(2, "0"); }
function statusLabel(status) { return ({ PUBLISHED: "已发布", DRAFT: "草稿", RETIRED: "已停用", BLOCKED: "阻断" })[status] || "待确认"; }
function statusType(status) { return status === "PUBLISHED" ? "success" : status === "BLOCKED" ? "danger" : status === "DRAFT" ? "warning" : "info"; }
function scheduleLoad() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300); }
function resetFilters() { Object.assign(filters, { keyword: "", status: "", audience: "", page: 1 }); load(); }
function createDraft() { Object.assign(draft, emptyDraft()); drawerVisible.value = true; }
function editDraft(row) { Object.assign(draft, emptyDraft(), row, { id: row.status === "PUBLISHED" ? "" : row.id, sourceVersionId: row.status === "PUBLISHED" ? row.versionId : row.sourceVersionId || "", expectedRevision: row.status === "DRAFT" ? row.revision : 0 }); drawerVisible.value = true; }
function previewOnline() { ElMessage.info(`请在小程序预览：${previewPath.value}`); }
async function saveDraft() {
  if (!draft.name.trim() || !draft.questionSummary.trim() || !draft.scoringSummary.trim() || !draft.adviceVersionId) return ElMessage.warning("请完成所有必填项");
  saving.value = true; errorMessage.value = "";
  try { await saveHealthScaleDraft({ ...draft, name: draft.name.trim(), questionSummary: draft.questionSummary.trim(), scoringSummary: draft.scoringSummary.trim() }); ElMessage.success("量表草稿已保存"); drawerVisible.value = false; await load(); }
  catch (error) { errorMessage.value = error.status === 404 ? "正式量表草稿能力尚未接入，内容未保存" : (error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message); }
  finally { saving.value = false; }
}
async function publishDraft(row) {
  try { await ElMessageBox.confirm(`确认发布“${row.name} · ${row.versionLabel}”？发布后该版本不可原地修改。`, "确认发布", { confirmButtonText: "确认发布", cancelButtonText: "取消", type: "warning" }); }
  catch (action) { if (["cancel", "close"].includes(action)) return; throw action; }
  publishingId.value = row.versionId; errorMessage.value = "";
  try { await publishHealthScaleVersion({ versionId: row.versionId, expectedRevision: row.revision }); ElMessage.success("量表版本已发布"); await load(); }
  catch (error) { errorMessage.value = error.outcomeUnknown ? "发布结果待确认，请刷新权威记录" : error.message; }
  finally { publishingId.value = ""; }
}
async function load() {
  const sequence = ++loadSequence; loadController?.abort(); const controller = new AbortController(); loadController = controller; loading.value = true; errorMessage.value = ""; interfaceUnavailable.value = false;
  try { const data = await fetchHealthScales({ ...filters, pageSize }, { signal: controller.signal }); if (sequence !== loadSequence) return; rows.value = data?.items || []; total.value = Number(data?.pagination?.total ?? data?.total ?? 0); adviceOptions.value = data?.adviceOptions || []; previewPath.value = data?.previewPath || ""; }
  catch (error) { if (error.code === "ADMIN_ABORTED" || sequence !== loadSequence) return; rows.value = []; total.value = 0; adviceOptions.value = []; if (error.status === 404) interfaceUnavailable.value = true; else errorMessage.value = error.message; }
  finally { if (sequence === loadSequence) loading.value = false; }
}
onMounted(load); onBeforeUnmount(() => { clearTimeout(searchTimer); loadController?.abort(); }); defineExpose({ load });
</script>
