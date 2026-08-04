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
    <el-drawer v-model="drawerVisible" class="content-edit-drawer health-edit-drawer" size="640px" :show-close="true">
      <template #header><div><h2>{{ draft.sourceVersionId ? '复制量表版本' : draft.id ? '编辑量表版本' : '新建量表' }}</h2><p>题目、计分和结果分层必须作为同一版本保存。</p></div></template>
      <el-form label-position="top">
        <el-form-item label="量表名称 *"><el-input v-model="draft.name" maxlength="80" /></el-form-item>
        <el-form-item label="题目说明 *"><el-input v-model="draft.questionSummary" :rows="2" resize="none" type="textarea" placeholder="例如：12 道必答单选题，约 3 分钟完成" /></el-form-item>
        <div class="scale-editor-section">
          <div class="scale-editor-heading"><span>真实题目与选项 *</span><el-space><el-button size="small" @click="addQuestion">新增题目</el-button><el-button :disabled="draft.questions.length <= 1" size="small" type="danger" plain @click="removeQuestion">删除当前题</el-button></el-space></div>
          <div class="scale-question-nav"><el-select v-model="currentQuestionIndex"><el-option v-for="(question, index) in draft.questions" :key="question.id" :label="`第 ${index + 1} 题 · ${question.title || '待填写'}`" :value="index" /></el-select><span>{{ currentQuestionIndex + 1 }} / {{ draft.questions.length }}</span></div>
          <template v-if="currentQuestion">
            <el-input v-model="currentQuestion.title" maxlength="200" placeholder="输入题目文案" />
            <div class="scale-option-list">
              <div v-for="(option, optionIndex) in currentQuestion.options" :key="option.value" class="scale-option-row">
                <span>{{ String.fromCharCode(65 + optionIndex) }}</span><el-input v-model="option.label" maxlength="160" placeholder="选项文案" /><el-input-number v-model="option.score" :min="0" :max="20" controls-position="right" /><el-button :disabled="currentQuestion.options.length <= 2" link type="danger" @click="removeOption(optionIndex)">删除</el-button>
              </div>
            </div>
            <el-button :disabled="currentQuestion.options.length >= 10" link type="primary" @click="addOption">+ 新增选项</el-button>
          </template>
          <p class="field-help">首发仅支持必答单选；长量表按每组最多 20 题整理，编辑器只展开当前题；分值不会下发到小程序。</p>
        </div>
        <el-form-item label="计分说明 *"><el-input v-model="draft.scoringSummary" :rows="2" resize="none" type="textarea" placeholder="说明分数含义与校验方式" /></el-form-item>
        <div class="scale-editor-section">
          <div class="scale-editor-heading"><span>计分与结果分层 *</span><el-button :disabled="draft.resultLevels.length >= 10" size="small" @click="addResultLevel">新增等级</el-button></div>
          <div v-for="(level, index) in draft.resultLevels" :key="level.id" class="scale-result-card">
            <div class="scale-result-card__heading"><strong>等级 {{ index + 1 }}</strong><el-button :disabled="draft.resultLevels.length <= 1" link type="danger" @click="removeResultLevel(index)">删除</el-button></div>
            <div class="scale-result-range"><el-input-number v-model="level.minScore" :min="0" :max="2000" controls-position="right" /><span>至</span><el-input-number v-model="level.maxScore" :min="0" :max="2000" controls-position="right" /><el-input v-model="level.title" maxlength="80" placeholder="结果标题" /></div>
            <el-input v-model="level.summary" :rows="2" resize="none" type="textarea" placeholder="非诊断性的结果说明" />
            <el-input v-model="level.tipsText" placeholder="生活方式提示，最多三条，用换行分隔" type="textarea" :rows="2" />
          </div>
          <p class="field-help">等级需覆盖全部可得分数，区间必须连续且不能重叠。</p>
        </div>
        <el-form-item label="适用与版本"><el-select v-model="draft.audience"><el-option label="18 岁及以上" value="ADULT_18_PLUS" /></el-select><p class="field-help">当前 {{ draft.questions.length }} 题 · {{ draft.resultLevels.length }} 个结果等级</p></el-form-item>
        <el-form-item label="建议内容版本 *"><el-select v-model="draft.adviceVersionId" placeholder="选择已批准建议内容版本"><el-option v-for="item in adviceOptions" :key="item.versionId" :label="item.label" :value="item.versionId" /></el-select></el-form-item>
        <el-form-item label="审批与生效"><div class="health-approval-grid"><el-input v-model="draft.approver" placeholder="健康内容负责人" /><el-date-picker v-model="draft.effectiveAt" placeholder="生效时间" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></div></el-form-item>
      </el-form>
      <template #footer><el-button @click="drawerVisible = false">取消</el-button><el-button :loading="saving" type="primary" @click="saveDraft">保存草稿</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import { fetchHealthScales, publishHealthScaleVersion, saveHealthScaleDraft } from "./adminHealthApi";

let localId = 0;
function nextId(prefix) { localId += 1; return `${prefix}_${Date.now().toString(36)}_${localId}`; }
function newQuestion() { return { id: nextId("question"), title: "", type: "SINGLE", required: true, options: [{ value: nextId("option"), label: "", score: 0 }, { value: nextId("option"), label: "", score: 1 }] }; }
function newResultLevel() { return { id: nextId("level"), minScore: 0, maxScore: 1, title: "", summary: "", tipsText: "" }; }
const emptyDraft = () => ({ id: "", sourceVersionId: "", expectedRevision: 0, name: "", questionSummary: "", scoringSummary: "", audience: "ADULT_18_PLUS", questions: [newQuestion()], resultLevels: [newResultLevel()], adviceVersionId: "", approver: "", effectiveAt: "" });
const rows = ref([]), total = ref(0), loading = ref(false), saving = ref(false), drawerVisible = ref(false), interfaceUnavailable = ref(false);
const errorMessage = ref(""), previewPath = ref(""), publishingId = ref(""), adviceOptions = ref([]);
const draft = reactive(emptyDraft()), filters = reactive({ keyword: "", status: "", audience: "", page: 1 });
const currentQuestionIndex = ref(0);
const currentQuestion = computed(() => draft.questions[currentQuestionIndex.value] || null);
const pageSize = 20;
let searchTimer = null, loadSequence = 0, loadController = null;
function sequenceNumber(index) { return String((filters.page - 1) * pageSize + index + 1).padStart(2, "0"); }
function statusLabel(status) { return ({ PUBLISHED: "已发布", DRAFT: "草稿", RETIRED: "已停用", BLOCKED: "阻断" })[status] || "待确认"; }
function statusType(status) { return status === "PUBLISHED" ? "success" : status === "BLOCKED" ? "danger" : status === "DRAFT" ? "warning" : "info"; }
function scheduleLoad() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300); }
function resetFilters() { Object.assign(filters, { keyword: "", status: "", audience: "", page: 1 }); load(); }
function normalizeRow(row) { return { ...row, questions: (row.questions || []).map((question) => ({ ...question, options: (question.options || []).map((option) => ({ ...option })) })), resultLevels: (row.resultLevels || []).map((level) => ({ ...level, tipsText: (level.tips || []).join("\n") })) }; }
function createDraft() { Object.assign(draft, emptyDraft()); currentQuestionIndex.value = 0; drawerVisible.value = true; }
function editDraft(row) { Object.assign(draft, emptyDraft(), normalizeRow(row), { id: row.status === "PUBLISHED" ? "" : row.id, sourceVersionId: row.status === "PUBLISHED" ? row.versionId : row.sourceVersionId || "", expectedRevision: row.status === "DRAFT" ? row.revision : 0 }); if (!draft.questions.length) draft.questions = [newQuestion()]; if (!draft.resultLevels.length) draft.resultLevels = [newResultLevel()]; currentQuestionIndex.value = 0; drawerVisible.value = true; }
function addQuestion() { if (draft.questions.length >= 100) return; draft.questions.push(newQuestion()); currentQuestionIndex.value = draft.questions.length - 1; }
function removeQuestion() { if (draft.questions.length <= 1) return; draft.questions.splice(currentQuestionIndex.value, 1); currentQuestionIndex.value = Math.min(currentQuestionIndex.value, draft.questions.length - 1); }
function addOption() { if (!currentQuestion.value || currentQuestion.value.options.length >= 10) return; currentQuestion.value.options.push({ value: nextId("option"), label: "", score: currentQuestion.value.options.length }); }
function removeOption(index) { if (!currentQuestion.value || currentQuestion.value.options.length <= 2) return; currentQuestion.value.options.splice(index, 1); }
function addResultLevel() { if (draft.resultLevels.length >= 10) return; const previous = draft.resultLevels[draft.resultLevels.length - 1]; draft.resultLevels.push({ ...newResultLevel(), minScore: Number(previous.maxScore) + 1, maxScore: Number(previous.maxScore) + 1 }); }
function removeResultLevel(index) { if (draft.resultLevels.length <= 1) return; draft.resultLevels.splice(index, 1); }
function previewOnline() { ElMessage.info(`请在小程序预览：${previewPath.value}`); }
async function saveDraft() {
  const invalidQuestion = draft.questions.some((question) => !question.title.trim() || question.options.length < 2 || question.options.some((option) => !option.label.trim()));
  const invalidLevel = draft.resultLevels.some((level) => !level.title.trim() || !level.summary.trim());
  if (!draft.name.trim() || !draft.questionSummary.trim() || !draft.scoringSummary.trim() || !draft.adviceVersionId || invalidQuestion || invalidLevel) return ElMessage.warning("请完成所有必填项");
  saving.value = true; errorMessage.value = "";
  const payload = { ...draft, name: draft.name.trim(), questionSummary: draft.questionSummary.trim(), scoringSummary: draft.scoringSummary.trim(), questions: draft.questions.map((question) => ({ ...question, title: question.title.trim(), options: question.options.map((option) => ({ ...option, label: option.label.trim() })) })), resultLevels: draft.resultLevels.map((level) => ({ ...level, title: level.title.trim(), summary: level.summary.trim(), tips: level.tipsText.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 3) })) };
  try { await saveHealthScaleDraft(payload); ElMessage.success("量表草稿已保存"); drawerVisible.value = false; await load(); }
  catch (error) { errorMessage.value = error.status === 404 ? "正式量表草稿能力尚未接入，内容未保存" : (error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message); if (error.status === 409) ElMessage.error(errorMessage.value); }
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

<style scoped>
.scale-editor-section { margin: 0 0 22px; padding: 16px; background: #f8f7f3; border: 1px solid #ebe7dd; border-radius: 10px; }
.scale-editor-heading, .scale-question-nav, .scale-result-card__heading, .scale-result-range, .scale-option-row { display: flex; align-items: center; gap: 10px; }
.scale-editor-heading, .scale-result-card__heading { justify-content: space-between; margin-bottom: 12px; }
.scale-question-nav { margin-bottom: 12px; }
.scale-question-nav .el-select { flex: 1; }
.scale-question-nav span, .scale-option-row > span { color: #8a8172; font-size: 12px; white-space: nowrap; }
.scale-option-list { display: grid; gap: 8px; margin-top: 10px; }
.scale-option-row .el-input { flex: 1; }
.scale-option-row .el-input-number { width: 110px; }
.scale-result-card { display: grid; gap: 10px; margin-top: 12px; padding: 14px; background: #fff; border: 1px solid #e8e2d7; border-radius: 8px; }
.scale-result-range .el-input-number { width: 110px; }
.scale-result-range .el-input { flex: 1; }
</style>
