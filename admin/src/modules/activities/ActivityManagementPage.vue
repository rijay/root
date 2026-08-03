<template>
  <section class="workbench content-workbench activity-management-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <header class="page-heading">
      <div>
        <h1>活动管理</h1>
        <p>维护活动卡片、时间地点、共用详情与报名规则。</p>
      </div>
      <el-space>
        <el-button :disabled="!previewPath" @click="previewOnline">预览当前线上</el-button>
        <el-button type="primary" @click="createDraft">新建活动</el-button>
      </el-space>
    </header>

    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input v-model="filters.keyword" clearable placeholder="搜索活动名称或地点" @input="scheduleLoad" />
      <el-select v-model="filters.status" placeholder="全部活动状态" @change="load">
        <el-option label="全部活动状态" value="" />
        <el-option label="草稿" value="DRAFT" />
        <el-option label="报名中" value="OPEN" />
        <el-option label="已结束" value="ENDED" />
        <el-option label="已下线" value="OFFLINE" />
      </el-select>
      <el-select v-model="filters.schedule" placeholder="全部活动时间" @change="load">
        <el-option label="全部活动时间" value="" />
        <el-option label="未来 7 天" value="NEXT_7_DAYS" />
        <el-option label="未来 30 天" value="NEXT_30_DAYS" />
        <el-option label="历史活动" value="HISTORICAL" />
      </el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>

    <section class="content-table-card activity-table-card">
      <el-table v-loading="loading" :data="rows" :empty-text="interfaceUnavailable ? '正式活动数据暂不可用' : '暂无活动'">
        <el-table-column label="序号" width="58">
          <template #default="{ $index }">{{ String((filters.page - 1) * pageSize + $index + 1).padStart(2, "0") }}</template>
        </el-table-column>
        <el-table-column label="活动" min-width="250">
          <template #default="{ row }">
            <div class="activity-row-primary">
              <span class="activity-row-cover" :style="row.thumbnailUrl ? { backgroundImage: `url(${row.thumbnailUrl})` } : {}" />
              <span>
                <strong>{{ row.title || "未命名活动" }}</strong>
                <small>{{ row.scheduleLabel || "活动时间待配置" }}</small>
                <small>{{ row.activityTypeLabel || "线下活动" }}</small>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="共用详情" min-width="172">
          <template #default="{ row }">
            <strong class="table-title">{{ row.detailTitle || "未关联" }}</strong>
            <span class="description-meta">{{ row.detailVersionLabel || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="活动时间" min-width="170">
          <template #default="{ row }">
            <span>{{ row.startAtLabel || "未设置" }}</span>
            <span class="description-meta">{{ row.locationLabel || "地点待配置" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="132" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editDraft(row)">{{ row.status === "PUBLISHED" ? "复制草稿" : "编辑" }}</el-button>
          </template>
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

    <el-drawer v-model="drawerVisible" class="content-edit-drawer activity-edit-drawer" size="408px" :show-close="true">
      <template #header>
        <div>
          <h2>{{ draft.sourceVersionId || draft.id ? "编辑活动" : "新建活动" }}</h2>
          <p>规则保存为草稿，不影响当前线上报名。</p>
        </div>
      </template>

      <el-form label-position="top">
        <el-form-item label="活动标题 *"><el-input v-model="draft.title" :maxlength="80" /></el-form-item>

        <el-form-item label="活动主视觉 *">
          <el-upload accept="image/jpeg,image/png" :auto-upload="false" :limit="1" :on-change="handleImageChange" :show-file-list="false">
            <div class="content-upload-box">
              <strong>{{ draft.assetName ? "更换图片" : "选择图片" }}</strong>
              <span>建议 1125 × 1500 px · JPG/PNG</span>
              <span>目标 ≤ 120KB · 硬上限 180KB</span>
            </div>
          </el-upload>
          <p v-if="draft.assetName" class="field-help">{{ draft.assetName }} · {{ draft.assetMeta }}</p>
          <p class="field-help">标题、时间和人物主体需避开图片安全区。</p>
        </el-form-item>

        <el-form-item label="活动时间与地点 *">
          <el-date-picker v-model="draft.sessionRange" end-placeholder="结束时间" range-separator="至" start-placeholder="开始时间" type="datetimerange" value-format="YYYY-MM-DDTHH:mm:ssZ" />
          <div class="activity-location-fields">
            <el-input v-model="draft.city" maxlength="32" placeholder="城市" />
            <el-input v-model="draft.venue" maxlength="120" placeholder="活动地点" />
          </div>
        </el-form-item>

        <el-form-item label="报名规则 *">
          <div class="typography-controls">
            <el-input-number v-model="draft.capacity" :min="1" :max="5000" controls-position="right" />
            <el-select v-model="draft.approvalMode"><el-option label="直接报名" value="AUTO" /><el-option label="人工确认" value="MANUAL" /></el-select>
            <el-select v-model="draft.allowCancellation"><el-option label="可取消" :value="true" /><el-option label="不可取消" :value="false" /></el-select>
          </div>
        </el-form-item>

        <el-form-item label="发布共用详情 *">
          <el-select v-model="draft.sharedDetailVersionId" placeholder="选择已发布详情版本">
            <el-option v-for="detail in sharedDetailOptions" :key="detail.versionId" :label="`${detail.title} · ${detail.versionLabel}`" :value="detail.versionId" />
          </el-select>
          <p class="field-help">活动只引用不可变的已发布详情版本，不复制素材。</p>
        </el-form-item>

        <el-form-item label="报名时段 *">
          <el-date-picker v-model="draft.registrationRange" end-placeholder="报名截止" range-separator="至" start-placeholder="报名开始" type="datetimerange" value-format="YYYY-MM-DDTHH:mm:ssZ" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button :loading="saving" type="primary" @click="saveDraft">保存草稿</el-button>
      </template>
    </el-drawer>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { fetchSharedDetails, uploadContentAsset } from "@/modules/content/adminContentApi";
import { fetchFormalActivities, saveFormalActivityDraft } from "./adminActivityApi";

const emptyDraft = () => ({
  id: "", sourceVersionId: "", title: "", assetId: "", assetName: "", assetMeta: "",
  sessionRange: [], city: "", venue: "", capacity: 80, approvalMode: "AUTO",
  allowCancellation: true, sharedDetailVersionId: "", registrationRange: [],
});

const rows = ref([]);
const total = ref(0);
const pageSize = 20;
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref("");
const interfaceUnavailable = ref(false);
const previewPath = ref("");
const drawerVisible = ref(false);
const selectedFile = ref(null);
const sharedDetailOptions = ref([]);
const objectUrls = new Set();
const draft = reactive(emptyDraft());
const filters = reactive({ keyword: "", status: "", schedule: "", page: 1 });
let searchTimer = null;
let loadSequence = 0;
let loadController = null;

function statusLabel(status) {
  return ({ DRAFT: "草稿", OPEN: "报名中", PUBLISHED: "已发布", ENDED: "已结束", OFFLINE: "已下线", BLOCKED: "阻断" })[status] || "待确认";
}
function statusType(status) {
  if (["OPEN", "PUBLISHED"].includes(status)) return "success";
  if (status === "BLOCKED") return "danger";
  if (status === "DRAFT") return "warning";
  return "info";
}

function scheduleLoad() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { filters.page = 1; load(); }, 300);
}
function resetFilters() {
  Object.assign(filters, { keyword: "", status: "", schedule: "", page: 1 });
  load();
}
function createDraft() {
  Object.assign(draft, emptyDraft());
  selectedFile.value = null;
  drawerVisible.value = true;
}
function editDraft(row) {
  Object.assign(draft, emptyDraft(), row, {
    id: row.status === "PUBLISHED" ? "" : row.id,
    sourceVersionId: row.status === "PUBLISHED" ? row.versionId : row.sourceVersionId || "",
    sessionRange: [row.sessionStartAt, row.sessionEndAt].filter(Boolean),
    registrationRange: [row.registrationOpenAt, row.registrationCloseAt].filter(Boolean),
  });
  selectedFile.value = null;
  drawerVisible.value = true;
}

async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  objectUrls.add(url);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}
async function handleImageChange(uploadFile) {
  const file = uploadFile.raw;
  if (!file || !["image/jpeg", "image/png"].includes(file.type)) return ElMessage.error("仅支持 JPG 或 PNG 图片");
  if (file.size > 180 * 1024) return ElMessage.error("活动主视觉超过 180KB 硬上限，请先压缩");
  try {
    const dimensions = await imageDimensions(file);
    selectedFile.value = file;
    draft.assetName = file.name;
    draft.assetMeta = `${dimensions.width} × ${dimensions.height} · ${Math.ceil(file.size / 1024)}KB`;
  } catch (_) { ElMessage.error("图片无法读取，请更换文件"); }
}

async function saveDraft() {
  if (!draft.title.trim() || (!draft.assetId && !selectedFile.value) || draft.sessionRange.length !== 2
    || !draft.city.trim() || !draft.venue.trim() || !draft.sharedDetailVersionId || draft.registrationRange.length !== 2) {
    return ElMessage.warning("请完成所有必填项");
  }
  saving.value = true;
  errorMessage.value = "";
  try {
    let assetId = draft.assetId;
    if (selectedFile.value) assetId = (await uploadContentAsset(selectedFile.value, "activity-hero")).assetId;
    await saveFormalActivityDraft({
      id: draft.id,
      sourceVersionId: draft.sourceVersionId,
      title: draft.title.trim(),
      heroAssetId: assetId,
      sessionStartAt: draft.sessionRange[0],
      sessionEndAt: draft.sessionRange[1],
      city: draft.city.trim(),
      venue: draft.venue.trim(),
      capacity: draft.capacity,
      approvalMode: draft.approvalMode,
      allowCancellation: draft.allowCancellation,
      sharedDetailVersionId: draft.sharedDetailVersionId,
      registrationOpenAt: draft.registrationRange[0],
      registrationCloseAt: draft.registrationRange[1],
    });
    ElMessage.success("活动草稿已保存");
    drawerVisible.value = false;
    await load();
  } catch (error) {
    errorMessage.value = error.status === 404
      ? "正式活动保存 Interface 尚未接入，草稿未被保存"
      : (error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message);
  } finally { saving.value = false; }
}

function previewOnline() {
  if (previewPath.value) window.open(previewPath.value, "_blank", "noopener,noreferrer");
}
async function loadSharedDetails() {
  try {
    const data = await fetchSharedDetails({ status: "PUBLISHED", page: 1, pageSize: 50 });
    sharedDetailOptions.value = data?.items || [];
  } catch (_) { sharedDetailOptions.value = []; }
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
    const data = await fetchFormalActivities({ ...filters, pageSize }, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    rows.value = data?.items || [];
    total.value = Number(data?.total ?? data?.pagination?.total ?? 0);
    previewPath.value = data?.previewPath || "";
  } catch (error) {
    if (error.code === "ADMIN_ABORTED" || sequence !== loadSequence) return;
    rows.value = [];
    total.value = 0;
    if (error.status === 404) interfaceUnavailable.value = true;
    else errorMessage.value = error.message;
  } finally { if (sequence === loadSequence) loading.value = false; }
}

onMounted(() => { load(); loadSharedDetails(); });
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  loadController?.abort();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});
defineExpose({ load });
</script>
