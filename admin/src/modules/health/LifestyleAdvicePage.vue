<template>
  <section class="workbench content-workbench health-operations-page health-lifestyle-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />
    <header class="page-heading">
      <div><h1>生活方式建议</h1><p>维护生成策略、校验规则、三条轮换与固定降级内容。</p></div>
      <el-space><el-button :disabled="!previewPath" @click="previewOnline">预览当前线上</el-button><el-button type="primary" @click="createDraft">新建策略</el-button></el-space>
    </header>
    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input v-model="filters.keyword" clearable placeholder="搜索策略、提示词或固定 tips" @input="scheduleLoad" />
      <el-select v-model="filters.status" placeholder="全部配置状态" @change="load"><el-option label="全部配置状态" value="" /><el-option label="草稿" value="DRAFT" /><el-option label="已批准" value="APPROVED" /><el-option label="当前生效" value="ACTIVE" /><el-option label="已停用" value="RETIRED" /></el-select>
      <el-select v-model="filters.version" placeholder="当前生效版本" @change="load"><el-option label="全部版本" value="" /><el-option label="当前生效版本" value="ACTIVE" /></el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>
    <section class="content-table-card health-table-card">
      <el-table v-loading="loading" :data="rows" :empty-text="interfaceUnavailable ? '正式建议策略暂不可用' : '暂无建议策略'" height="510">
        <el-table-column label="序号" width="58"><template #default="{ $index }">{{ sequenceNumber($index) }}</template></el-table-column>
        <el-table-column label="配置" min-width="250"><template #default="{ row }"><div class="health-row-primary"><span class="health-row-marker" /><span><strong>{{ row.name || '未命名策略' }}</strong><small>{{ row.deliveryLabel || '最少字段 · 三条轮换' }}</small><small>{{ row.validationLabel || '结构、禁用表达与健康安全校验' }}</small></span></div></template></el-table-column>
        <el-table-column label="版本与用途" min-width="170"><template #default="{ row }"><strong class="table-title">{{ row.versionLabel || '草稿' }} · {{ row.approvalLabel || '待审批' }}</strong><span class="description-meta">{{ row.purposeLabel || '用户生活方式建议' }}</span></template></el-table-column>
        <el-table-column label="生效时间" min-width="136"><template #default="{ row }">{{ row.effectiveAtLabel || '待配置' }}</template></el-table-column>
        <el-table-column label="状态" width="96"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column align="right" label="操作" width="164"><template #default="{ row }"><el-button link type="primary" @click="editDraft(row)">{{ ['ACTIVE', 'APPROVED'].includes(row.status) ? '复制草稿' : '编辑' }}</el-button><el-button v-if="row.status === 'DRAFT'" :loading="publishingId === row.versionId" link type="success" @click="publishDraft(row)">发布</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-if="total > pageSize" v-model:current-page="filters.page" class="content-pagination" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load" />
    </section>
    <el-drawer v-model="drawerVisible" class="content-edit-drawer health-edit-drawer" size="408px" :show-close="true">
      <template #header><div><h2>{{ draft.id || draft.sourceVersionId ? '编辑建议生成策略' : '新建建议生成策略' }}</h2><p>后台只选择已批准配置，不输入或显示模型密钥。</p></div></template>
      <el-form label-position="top">
        <el-form-item label="策略名称 *"><el-input v-model="draft.name" maxlength="80" /></el-form-item>
        <el-form-item label="模型配置 *"><el-select v-model="draft.modelConfigurationId" placeholder="选择已批准模型配置"><el-option v-for="item in modelConfigurations" :key="item.id" :label="item.label" :value="item.id" /></el-select><p class="field-help">密钥仅由后端秘密管理；模型不可用时自动使用固定内容。</p></el-form-item>
        <el-form-item label="最少字段与生成条件 *"><el-input v-model="draft.minimumFieldsSummary" :rows="3" resize="none" type="textarea" placeholder="仅允许分类、辅助标签与量表结果；资料变化时再生成" /></el-form-item>
        <el-form-item label="输出校验"><div class="typography-controls"><el-select v-model="draft.structureCheck"><el-option label="结构检查" value="REQUIRED" /></el-select><el-select v-model="draft.prohibitedLanguageCheck"><el-option label="禁用表达" value="REQUIRED" /></el-select><el-select v-model="draft.healthSafetyCheck"><el-option label="健康安全" value="REQUIRED" /></el-select></div></el-form-item>
        <el-form-item label="固定降级内容 *"><el-select v-model="draft.fallbackContentVersionId" placeholder="选择已批准固定 tips 版本"><el-option v-for="item in fallbackOptions" :key="item.versionId" :label="item.label" :value="item.versionId" /></el-select></el-form-item>
        <el-form-item label="审批与生效"><div class="health-approval-grid"><el-input v-model="draft.approver" placeholder="健康内容负责人" /><el-date-picker v-model="draft.effectiveAt" placeholder="生效时间" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></div></el-form-item>
      </el-form>
      <template #footer><el-button @click="drawerVisible = false">取消</el-button><el-button :loading="saving" type="primary" @click="saveDraft">保存草稿</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import { fetchLifestyleAdvicePolicies, publishLifestyleAdviceVersion, saveLifestyleAdviceDraft } from "./adminHealthApi";

const emptyDraft = () => ({ id: "", sourceVersionId: "", expectedRevision: 0, name: "", modelConfigurationId: "", minimumFieldsSummary: "仅发送分类、辅助标签与量表结果\n资料或评测结果变化时才重新生成", structureCheck: "REQUIRED", prohibitedLanguageCheck: "REQUIRED", healthSafetyCheck: "REQUIRED", fallbackContentVersionId: "", approver: "", effectiveAt: "" });
const rows = ref([]), total = ref(0), loading = ref(false), saving = ref(false), drawerVisible = ref(false), interfaceUnavailable = ref(false);
const modelConfigurations = ref([]), fallbackOptions = ref([]), errorMessage = ref(""), previewPath = ref(""), publishingId = ref("");
const draft = reactive(emptyDraft()), filters = reactive({ keyword: "", status: "", version: "", page: 1 });
const pageSize = 20;
let searchTimer = null, loadSequence = 0, loadController = null;
function sequenceNumber(index) { return String((filters.page - 1) * pageSize + index + 1).padStart(2, "0"); }
function statusLabel(status) { return ({ ACTIVE: "当前生效", APPROVED: "已批准", DRAFT: "草稿", RETIRED: "已停用", BLOCKED: "阻断" })[status] || "待确认"; }
function statusType(status) { return status === "ACTIVE" ? "success" : status === "BLOCKED" ? "danger" : status === "DRAFT" ? "warning" : "info"; }
function scheduleLoad() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300); }
function resetFilters() { Object.assign(filters, { keyword: "", status: "", version: "", page: 1 }); load(); }
function createDraft() { Object.assign(draft, emptyDraft()); drawerVisible.value = true; }
function editDraft(row) { Object.assign(draft, emptyDraft(), row, { id: ["ACTIVE", "APPROVED"].includes(row.status) ? "" : row.id, sourceVersionId: ["ACTIVE", "APPROVED"].includes(row.status) ? row.versionId : row.sourceVersionId || "", expectedRevision: row.status === "DRAFT" ? row.revision : 0, structureCheck: row.validation?.structure || "REQUIRED", prohibitedLanguageCheck: row.validation?.prohibitedLanguage || "REQUIRED", healthSafetyCheck: row.validation?.healthSafety || "REQUIRED" }); drawerVisible.value = true; }
function previewOnline() { ElMessage.info(`请在小程序预览：${previewPath.value}`); }
async function saveDraft() {
  if (!draft.name.trim() || !draft.modelConfigurationId || !draft.minimumFieldsSummary.trim() || !draft.fallbackContentVersionId) return ElMessage.warning("请完成所有必填项");
  saving.value = true; errorMessage.value = "";
  try { await saveLifestyleAdviceDraft({ id: draft.id, sourceVersionId: draft.sourceVersionId, expectedRevision: draft.expectedRevision, name: draft.name.trim(), modelConfigurationId: draft.modelConfigurationId, minimumFields: ["PRIMARY_CATEGORY", "AUXILIARY_TAGS", "ASSESSMENT_RESULTS"], minimumFieldsSummary: draft.minimumFieldsSummary.trim(), regenerationTrigger: "PROFILE_OR_ASSESSMENT_CHANGED", rotationSize: 3, validation: { structure: draft.structureCheck, prohibitedLanguage: draft.prohibitedLanguageCheck, healthSafety: draft.healthSafetyCheck }, fallbackContentVersionId: draft.fallbackContentVersionId, approver: draft.approver.trim(), effectiveAt: draft.effectiveAt }); ElMessage.success("建议策略草稿已保存"); drawerVisible.value = false; await load(); }
  catch (error) { errorMessage.value = error.status === 404 ? "正式建议策略草稿能力尚未接入，内容未保存" : (error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message); }
  finally { saving.value = false; }
}
async function publishDraft(row) {
  try { await ElMessageBox.confirm(`确认发布“${row.name} · ${row.versionLabel}”？该策略仅使用固定建议内容，不调用模型。`, "确认发布", { confirmButtonText: "确认发布", cancelButtonText: "取消", type: "warning" }); }
  catch (action) { if (["cancel", "close"].includes(action)) return; throw action; }
  publishingId.value = row.versionId; errorMessage.value = "";
  try { await publishLifestyleAdviceVersion({ versionId: row.versionId, expectedRevision: row.revision }); ElMessage.success("生活方式建议策略已发布"); await load(); }
  catch (error) { errorMessage.value = error.outcomeUnknown ? "发布结果待确认，请刷新权威记录" : error.message; }
  finally { publishingId.value = ""; }
}
async function load() {
  const sequence = ++loadSequence; loadController?.abort(); const controller = new AbortController(); loadController = controller; loading.value = true; errorMessage.value = ""; interfaceUnavailable.value = false;
  try { const data = await fetchLifestyleAdvicePolicies({ ...filters, pageSize }, { signal: controller.signal }); if (sequence !== loadSequence) return; rows.value = data?.items || []; total.value = Number(data?.pagination?.total ?? data?.total ?? 0); previewPath.value = data?.previewPath || ""; modelConfigurations.value = data?.modelConfigurations || []; fallbackOptions.value = data?.fallbackOptions || []; }
  catch (error) { if (error.code === "ADMIN_ABORTED" || sequence !== loadSequence) return; rows.value = []; total.value = 0; modelConfigurations.value = []; fallbackOptions.value = []; if (error.status === 404) interfaceUnavailable.value = true; else errorMessage.value = error.message; }
  finally { if (sequence === loadSequence) loading.value = false; }
}
onMounted(load); onBeforeUnmount(() => { clearTimeout(searchTimer); loadController?.abort(); }); defineExpose({ load });
</script>
