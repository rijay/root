<template>
  <section class="workbench content-workbench health-operations-page health-recommendations-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />
    <header class="page-heading">
      <div><h1>推荐规则</h1><p>管理主分类、辅助标签到已发布量表版本的确定性映射。</p></div>
      <el-space><el-button :disabled="!previewPath" @click="previewOnline">预览当前线上</el-button><el-button type="primary" @click="createDraft">新建规则</el-button></el-space>
    </header>
    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input v-model="filters.keyword" clearable placeholder="搜索分类、标签或量表" @input="scheduleLoad" />
      <el-select v-model="filters.status" placeholder="全部规则状态" @change="load"><el-option label="全部规则状态" value="" /><el-option label="草稿" value="DRAFT" /><el-option label="已发布" value="PUBLISHED" /><el-option label="已停用" value="RETIRED" /></el-select>
      <el-select v-model="filters.category" placeholder="全部主分类" @change="load"><el-option label="全部主分类" value="" /><el-option label="肠道规律关注型" value="BOWEL" /><el-option label="睡眠节律关注型" value="SLEEP" /><el-option label="压力活力关注型" value="ENERGY" /></el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>
    <section class="content-table-card health-table-card">
      <el-table v-loading="loading" :data="rows" :empty-text="interfaceUnavailable ? '正式推荐规则暂不可用' : '暂无推荐规则'" height="510">
        <el-table-column label="序号" width="58"><template #default="{ $index }">{{ sequenceNumber($index) }}</template></el-table-column>
        <el-table-column label="人群分类" min-width="250"><template #default="{ row }"><div class="health-row-primary"><span class="health-row-marker" /><span><strong>{{ row.primaryCategoryLabel || '分类待配置' }}</strong><small>辅助：{{ (row.auxiliaryTags || []).join('、') || '无' }}</small><small>优先级 {{ row.priority || '—' }}</small></span></div></template></el-table-column>
        <el-table-column label="推荐量表版本" min-width="170"><template #default="{ row }"><strong class="table-title">{{ row.scaleName || '未关联量表' }}</strong><span class="description-meta">{{ row.scaleVersionLabel || '仅允许已发布版本' }}</span></template></el-table-column>
        <el-table-column label="生效时间" min-width="136"><template #default="{ row }">{{ row.effectiveAtLabel || '待配置' }}</template></el-table-column>
        <el-table-column label="状态" width="96"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column align="right" label="操作" width="164"><template #default="{ row }"><el-button link type="primary" @click="editDraft(row)">{{ row.status === 'PUBLISHED' ? '复制草稿' : '编辑' }}</el-button><el-button v-if="row.status === 'DRAFT'" :loading="publishingId === row.versionId" link type="success" @click="publishDraft(row)">发布</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-if="total > pageSize" v-model:current-page="filters.page" class="content-pagination" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load" />
    </section>
    <el-drawer v-model="drawerVisible" class="content-edit-drawer health-edit-drawer" size="408px" :show-close="true">
      <template #header><div><h2>{{ draft.id || draft.sourceVersionId ? '编辑推荐规则' : '新建推荐规则' }}</h2><p>规则保存为草稿，不改变用户已有评测结果。</p></div></template>
      <el-form label-position="top">
        <el-form-item label="主分类 *"><el-select v-model="draft.primaryCategory" placeholder="选择建档主分类"><el-option label="肠道规律关注型" value="BOWEL" /><el-option label="腹胀反酸关注型" value="DIGESTION" /><el-option label="睡眠节律关注型" value="SLEEP" /><el-option label="压力活力关注型" value="ENERGY" /><el-option label="活动饮食调整型" value="LIFESTYLE" /><el-option label="基础状态维护型" value="BASELINE" /><el-option label="生活方式波动型" value="VARIABLE" /></el-select></el-form-item>
        <el-form-item label="辅助标签"><el-input v-model="draft.auxiliaryTagsText" :rows="4" resize="none" type="textarea" placeholder="每行一个辅助标签" /><p class="field-help">只使用建档输出标签，不使用手机号、昵称或原始健康答案。</p></el-form-item>
        <el-form-item label="匹配结果 *"><el-input v-model="draft.matchSummary" :rows="2" resize="none" type="textarea" placeholder="说明推荐目的；实际结果以下方量表版本为准" /></el-form-item>
        <el-form-item label="匹配控制"><div class="typography-controls"><el-input-number v-model="draft.priority" :min="1" :max="999" controls-position="right" /><el-select v-model="draft.matchMode"><el-option label="命中任一" value="ANY" /><el-option label="全部命中" value="ALL" /></el-select><el-input-number v-model="draft.maxRecommendations" :min="1" :max="3" controls-position="right" /></div><p class="field-help">优先级 · 标签命中方式 · 最多 3 份</p></el-form-item>
        <el-form-item label="量表版本 *"><el-select v-model="draft.scaleVersionId" placeholder="选择已发布且有效的量表版本"><el-option v-for="scale in scaleOptions" :key="scale.versionId" :label="`${scale.name} · ${scale.versionLabel}`" :value="scale.versionId" /></el-select></el-form-item>
        <el-form-item label="生效时间"><el-date-picker v-model="draft.effectiveAt" placeholder="选择生效时间" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="drawerVisible = false">取消</el-button><el-button :loading="saving" type="primary" @click="saveDraft">保存草稿</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { fetchHealthScales, fetchRecommendationRules, publishRecommendationRuleVersion, saveRecommendationRuleDraft } from "./adminHealthApi";

const emptyDraft = () => ({ id: "", sourceVersionId: "", expectedRevision: 0, primaryCategory: "", auxiliaryTagsText: "", matchSummary: "", priority: 10, matchMode: "ANY", maxRecommendations: 3, scaleVersionId: "", effectiveAt: "" });
const rows = ref([]), total = ref(0), loading = ref(false), saving = ref(false), drawerVisible = ref(false), interfaceUnavailable = ref(false), scaleOptions = ref([]);
const errorMessage = ref(""), previewPath = ref(""), publishingId = ref("");
const draft = reactive(emptyDraft()), filters = reactive({ keyword: "", status: "", category: "", page: 1 });
const pageSize = 20;
let searchTimer = null, loadSequence = 0, loadController = null;
function sequenceNumber(index) { return String((filters.page - 1) * pageSize + index + 1).padStart(2, "0"); }
function statusLabel(status) { return ({ PUBLISHED: "已发布", DRAFT: "草稿", RETIRED: "已停用", BLOCKED: "阻断" })[status] || "待确认"; }
function statusType(status) { return status === "PUBLISHED" ? "success" : status === "BLOCKED" ? "danger" : status === "DRAFT" ? "warning" : "info"; }
function scheduleLoad() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300); }
function resetFilters() { Object.assign(filters, { keyword: "", status: "", category: "", page: 1 }); load(); }
function createDraft() { Object.assign(draft, emptyDraft()); drawerVisible.value = true; }
function editDraft(row) { Object.assign(draft, emptyDraft(), row, { id: row.status === "PUBLISHED" ? "" : row.id, sourceVersionId: row.status === "PUBLISHED" ? row.versionId : row.sourceVersionId || "", expectedRevision: row.status === "DRAFT" ? row.revision : 0, auxiliaryTagsText: (row.auxiliaryTags || []).join("\n") }); drawerVisible.value = true; }
function previewOnline() { ElMessage.info(`请在小程序预览：${previewPath.value}`); }
async function saveDraft() {
  const auxiliaryTags = draft.auxiliaryTagsText.split("\n").map((item) => item.trim()).filter(Boolean);
  if (!draft.primaryCategory || !draft.matchSummary.trim() || !draft.scaleVersionId) return ElMessage.warning("请完成所有必填项");
  saving.value = true; errorMessage.value = "";
  try { await saveRecommendationRuleDraft({ id: draft.id, sourceVersionId: draft.sourceVersionId, expectedRevision: draft.expectedRevision, primaryCategory: draft.primaryCategory, auxiliaryTags, matchSummary: draft.matchSummary.trim(), priority: draft.priority, matchMode: draft.matchMode, maxRecommendations: draft.maxRecommendations, scaleVersionId: draft.scaleVersionId, effectiveAt: draft.effectiveAt }); ElMessage.success("推荐规则草稿已保存"); drawerVisible.value = false; await load(); }
  catch (error) { errorMessage.value = error.status === 404 ? "正式推荐规则草稿能力尚未接入，内容未保存" : (error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message); }
  finally { saving.value = false; }
}
async function publishDraft(row) {
  try { await ElMessageBox.confirm(`确认发布“${row.primaryCategoryLabel} → ${row.scaleName}”？发布后该版本不可原地修改。`, "确认发布", { confirmButtonText: "确认发布", cancelButtonText: "取消", type: "warning" }); }
  catch (action) { if (["cancel", "close"].includes(action)) return; throw action; }
  publishingId.value = row.versionId; errorMessage.value = "";
  try { await publishRecommendationRuleVersion({ versionId: row.versionId, expectedRevision: row.revision }); ElMessage.success("推荐规则已发布"); await load(); }
  catch (error) { errorMessage.value = error.outcomeUnknown ? "发布结果待确认，请刷新权威记录" : error.message; }
  finally { publishingId.value = ""; }
}
async function loadScaleOptions() { try { const data = await fetchHealthScales({ status: "PUBLISHED", page: 1, pageSize: 50 }); scaleOptions.value = data?.items || []; } catch (_) { scaleOptions.value = []; } }
async function load() {
  const sequence = ++loadSequence; loadController?.abort(); const controller = new AbortController(); loadController = controller; loading.value = true; errorMessage.value = ""; interfaceUnavailable.value = false;
  try { const data = await fetchRecommendationRules({ ...filters, pageSize }, { signal: controller.signal }); if (sequence !== loadSequence) return; rows.value = data?.items || []; total.value = Number(data?.pagination?.total ?? data?.total ?? 0); previewPath.value = data?.previewPath || ""; }
  catch (error) { if (error.code === "ADMIN_ABORTED" || sequence !== loadSequence) return; rows.value = []; total.value = 0; if (error.status === 404) interfaceUnavailable.value = true; else errorMessage.value = error.message; }
  finally { if (sequence === loadSequence) loading.value = false; }
}
onMounted(() => { load(); loadScaleOptions(); }); onBeforeUnmount(() => { clearTimeout(searchTimer); loadController?.abort(); }); defineExpose({ load });
</script>
