<template>
  <section class="workbench content-workbench health-operations-page health-initialization-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <header class="page-heading">
      <div><h1>初始化建档</h1><p>管理 12 问、选项、安全分流和联合签署版本。</p></div>
      <el-space>
        <el-button :disabled="!previewPath" @click="previewOnline">预览候选版本</el-button>
        <el-button v-if="currentStatus === 'DRAFT'" :loading="publishing" type="success" @click="publishCurrentVersion">发布当前草稿</el-button>
        <el-button :disabled="!rows.length" :loading="copying" type="primary" @click="copyCurrentVersion">复制为新版本</el-button>
      </el-space>
    </header>

    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input v-model="filters.keyword" clearable placeholder="搜索题目、编号或版本" @input="scheduleLoad" />
      <el-select v-model="filters.type" placeholder="全部题目类型" @change="load">
        <el-option label="全部题目类型" value="" /><el-option label="单选" value="single" /><el-option label="多选" value="multi" />
      </el-select>
      <el-select v-model="filters.version" placeholder="当前版本" @change="load">
        <el-option label="全部版本" value="" /><el-option v-if="currentVersion" :label="`候选版本 ${currentVersion}`" :value="currentVersion" />
      </el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>

    <section class="content-table-card health-table-card">
      <el-table v-loading="loading" :data="rows" empty-text="暂无初始化题目" height="510">
        <el-table-column label="题号" width="58"><template #default="{ row }">{{ row.number }}</template></el-table-column>
        <el-table-column label="问题" min-width="250">
          <template #default="{ row }"><div class="health-row-primary"><span :class="['health-row-marker', row.routing === 'SAFETY' && 'is-safety']" /><span><strong>{{ row.title }}</strong><small>{{ row.typeLabel }} · 第 {{ row.number }} 题</small><small>{{ row.required ? '必填' : '选填' }}</small></span></div></template>
        </el-table-column>
        <el-table-column label="选项与规则" min-width="170"><template #default="{ row }"><strong class="table-title">{{ row.optionCount }} 个选项</strong><span class="description-meta">{{ row.routingLabel }}</span></template></el-table-column>
        <el-table-column label="版本" min-width="136"><template #default="{ row }"><span>{{ row.versionLabel }}</span><span class="description-meta">候选基线</span></template></el-table-column>
        <el-table-column label="状态" width="96"><template #default="{ row }"><el-tag effect="plain" type="info">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column align="right" label="操作" width="112"><template #default="{ row }"><el-button link type="primary" @click="editQuestion(row)">编辑</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-if="total > pageSize" v-model:current-page="filters.page" class="content-pagination" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load" />
    </section>

    <el-drawer v-model="drawerVisible" class="content-edit-drawer health-edit-drawer" size="408px" :show-close="true">
      <template #header><div><h2>编辑第 {{ draft.number || '—' }} 题</h2><p>当前编辑 {{ draft.nextVersion }} 草稿；候选基线为 {{ draft.versionLabel || currentVersion }}。</p></div></template>
      <el-form label-position="top">
        <el-form-item label="题目文案 *"><el-input v-model="draft.title" maxlength="120" /></el-form-item>
        <el-form-item label="选项设置 *"><el-input v-model="draft.optionsText" :rows="4" resize="none" type="textarea" /><p class="field-help">每行一个选项；安全题选项不进入普通运营分析。</p></el-form-item>
        <el-form-item label="命中后的处理 *"><el-input v-model="draft.hitAction" :rows="2" resize="none" type="textarea" /></el-form-item>
        <el-form-item label="分流级别"><div class="typography-controls"><el-select v-model="draft.riskMode"><el-option label="风险" value="RISK" /></el-select><el-select v-model="draft.specialMode"><el-option label="特殊适用" value="SPECIAL" /></el-select><el-select v-model="draft.standardMode"><el-option label="普通" value="STANDARD" /></el-select></div></el-form-item>
        <el-form-item label="固定指引版本 *"><el-select v-model="draft.guidanceVersionId" placeholder="选择已批准固定指引"><el-option v-for="item in guidanceOptions" :key="item.versionId" :label="item.label" :value="item.versionId" /></el-select></el-form-item>
        <el-form-item label="版本签署"><el-input v-model="draft.signoffLabel" disabled /></el-form-item>
      </el-form>
      <template #footer><el-button @click="drawerVisible = false">取消</el-button><el-button :loading="saving" type="primary" @click="saveDraft">保存草稿</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import { fetchInitializationQuestions, publishInitializationVersion, saveInitializationDraft } from "./adminHealthApi";

const rows = ref([]), total = ref(0), loading = ref(false), saving = ref(false), copying = ref(false), publishing = ref(false), drawerVisible = ref(false);
const errorMessage = ref(""), currentVersion = ref(""), currentVersionId = ref(""), currentRevision = ref(0), currentStatus = ref("CANDIDATE"), previewPath = ref("");
const guidanceOptions = ref([]);
const pageSize = 20;
const filters = reactive({ keyword: "", type: "", version: "", page: 1 });
const draft = reactive({ number: "", id: "", versionId: "", expectedRevision: 0, title: "", optionsText: "", hitAction: "", riskMode: "RISK", specialMode: "SPECIAL", standardMode: "STANDARD", guidanceVersionId: "", signoffLabel: "产品 / 健康内容 / 隐私负责人（待共同签署）", versionLabel: "", nextVersion: "v1.1" });
let searchTimer = null, loadSequence = 0, loadController = null;

function statusLabel(status) { return status === "CANDIDATE" ? "候选" : status === "PUBLISHED" ? "已发布" : status === "DRAFT" ? "草稿" : "待确认"; }
function scheduleLoad() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300); }
function resetFilters() { Object.assign(filters, { keyword: "", type: "", version: "", page: 1 }); load(); }
function editQuestion(row) {
  Object.assign(draft, {
    number: row.number, id: row.id, title: row.title,
    optionsText: (row.options || []).map((item) => item.label).join("\n"),
    versionId: currentVersionId.value, expectedRevision: currentRevision.value,
    hitAction: row.hitAction || (row.routing === "SAFETY" ? "停止普通 tips 与常规推荐\n展示固定求助、就医或谨慎指引" : "进入普通分类与生活方式建议流程"),
    riskMode: row.routingSettings?.risk || "RISK", specialMode: row.routingSettings?.special || "SPECIAL", standardMode: row.routingSettings?.standard || "STANDARD", guidanceVersionId: row.guidanceVersionId || guidanceOptions.value[0]?.versionId || "",
    signoffLabel: "产品 / 健康内容 / 隐私负责人（待共同签署）", versionLabel: row.versionLabel,
    nextVersion: `v${Number(row.version || 1)}.1`,
  });
  drawerVisible.value = true;
}
async function copyCurrentVersion() {
  if (!currentVersion.value) return;
  copying.value = true; errorMessage.value = "";
  try { await saveInitializationDraft({ action: "COPY_VERSION", sourceVersionId: currentVersionId.value }); ElMessage.success("新版本草稿已创建"); await load(); }
  catch (error) { errorMessage.value = error.status === 404 ? "初始化建档版本复制能力尚未接入，未创建草稿" : (error.outcomeUnknown ? "复制结果待确认，请刷新权威记录" : error.message); if (error.status === 409) ElMessage.error(errorMessage.value); }
  finally { copying.value = false; }
}
function previewOnline() { ElMessage.info(`请在小程序预览：${previewPath.value}`); }
async function saveDraft() {
  const options = draft.optionsText.split("\n").map((item) => item.trim()).filter(Boolean);
  if (!draft.title.trim() || !options.length || !draft.hitAction.trim() || !draft.guidanceVersionId) return ElMessage.warning("请完成所有必填项");
  saving.value = true; errorMessage.value = "";
  try {
    await saveInitializationDraft({ versionId: draft.versionId, expectedRevision: draft.expectedRevision, questionId: draft.id, title: draft.title.trim(), options, routing: { risk: draft.riskMode, special: draft.specialMode, standard: draft.standardMode }, hitAction: draft.hitAction.trim(), guidanceVersionId: draft.guidanceVersionId });
    ElMessage.success("初始化建档草稿已保存"); drawerVisible.value = false; await load();
  } catch (error) { errorMessage.value = error.status === 404 ? "初始化建档草稿能力尚未接入，内容未保存" : (error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message); if (error.status === 409) ElMessage.error(errorMessage.value); }
  finally { saving.value = false; }
}
async function publishCurrentVersion() {
  try {
    await ElMessageBox.confirm("发布后该版本将成为候选环境的建档定义，已发布版本不可原地修改。生产健康写入仍保持关闭。", "确认发布", { confirmButtonText: "确认发布", cancelButtonText: "取消", type: "warning" });
  } catch (action) { if (["cancel", "close"].includes(action)) return; throw action; }
  publishing.value = true; errorMessage.value = "";
  try { await publishInitializationVersion({ versionId: currentVersionId.value, expectedRevision: currentRevision.value }); ElMessage.success("初始化建档版本已发布"); await load(); }
  catch (error) { errorMessage.value = error.outcomeUnknown ? "发布结果待确认，请刷新权威记录" : error.message; }
  finally { publishing.value = false; }
}
async function load() {
  const sequence = ++loadSequence; loadController?.abort(); const controller = new AbortController(); loadController = controller;
  loading.value = true; errorMessage.value = "";
  try {
    const data = await fetchInitializationQuestions({ ...filters, pageSize }, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    rows.value = data?.items || []; total.value = Number(data?.pagination?.total || 0); currentVersion.value = data?.currentVersion || ""; currentVersionId.value = data?.currentVersionId || ""; currentRevision.value = Number(data?.currentRevision || 0); currentStatus.value = data?.currentStatus || "CANDIDATE"; guidanceOptions.value = data?.guidanceOptions || []; previewPath.value = data?.previewPath || "";
  } catch (error) { if (error.code !== "ADMIN_ABORTED" && sequence === loadSequence) { rows.value = []; total.value = 0; errorMessage.value = error.message; } }
  finally { if (sequence === loadSequence) loading.value = false; }
}
onMounted(load);
onBeforeUnmount(() => { clearTimeout(searchTimer); loadController?.abort(); });
defineExpose({ load });
</script>
