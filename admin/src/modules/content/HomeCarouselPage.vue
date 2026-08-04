<template>
  <section class="workbench content-workbench home-carousel-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <header class="page-heading">
      <div>
        <h1>首页轮播</h1>
        <p>管理首页展示顺序、上下线时间及关联的共用详情。</p>
      </div>
      <el-space>
        <el-button :disabled="!previewPath" @click="previewOnline">预览当前线上</el-button>
        <el-button type="primary" @click="createDraft">新建轮播</el-button>
      </el-space>
    </header>

    <el-alert
      v-if="interfaceUnavailable"
      :closable="false"
      class="content-interface-notice"
      title="Content Module 尚未接入，列表保持为空；新草稿不会被误认为已保存。"
      type="info"
    />

    <template v-if="contentReady">
    <el-form class="content-filter-bar" inline @submit.prevent>
      <el-input
        v-model="filters.keyword"
        clearable
        placeholder="搜索内部名称或展示文案"
        @input="scheduleLoad"
      />
      <el-select v-model="filters.status" placeholder="全部状态" @change="load">
        <el-option label="全部状态" value="" />
        <el-option label="草稿" value="DRAFT" />
        <el-option label="已上线" value="PUBLISHED" />
        <el-option label="已下线" value="OFFLINE" />
      </el-select>
      <el-select v-model="filters.schedule" placeholder="全部上线时间" @change="load">
        <el-option label="全部上线时间" value="" />
        <el-option label="未来 7 天" value="NEXT_7_DAYS" />
        <el-option label="长期有效" value="LONG_TERM" />
      </el-select>
      <el-button link @click="resetFilters">重置筛选</el-button>
    </el-form>

    <section class="content-table-card">
      <el-table v-loading="loading" :data="rows" empty-text="暂无首页轮播">
        <el-table-column prop="order" label="顺序" width="58" />
        <el-table-column label="轮播内容" min-width="228">
          <template #default="{ row }">
            <div class="content-row-primary">
              <div
                class="content-row-thumbnail"
                :style="row.thumbnailUrl ? { backgroundImage: `url(${row.thumbnailUrl})` } : {}"
              />
              <div>
                <strong>{{ row.internalName || "未命名轮播" }}</strong>
                <span>{{ row.copy || "展示文案未配置" }}</span>
                <small>{{ row.lineCount || 2 }} 行 · {{ row.alignmentLabel || "居中" }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="关联详情" min-width="172">
          <template #default="{ row }">
            <strong class="table-title">{{ row.detailTitle || "未关联" }}</strong>
            <span class="description-meta">{{ row.detailVersion || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="上下线时间" min-width="164">
          <template #default="{ row }">
            <span>{{ row.scheduleLabel || "未设置" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="right">
          <template #default="{ row }">
            <el-space>
              <el-button v-if="row.status === 'PUBLISHED'" link type="danger" @click="unpublishRow(row)">下线</el-button>
              <el-button link type="primary" @click="editDraft(row)">{{ row.status === "PUBLISHED" ? "复制草稿" : "编辑" }}</el-button>
            </el-space>
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
    </template>

    <el-drawer v-model="drawerVisible" class="content-edit-drawer" size="408px" :show-close="true">
      <template #header>
        <div>
          <h2>{{ draft.id ? "编辑首页轮播" : "新建首页轮播" }}</h2>
          <p>当前编辑草稿，不影响线上版本。</p>
        </div>
      </template>

      <el-form label-position="top">
        <el-form-item label="内部名称 *">
          <el-input v-model="draft.internalName" :maxlength="40" />
        </el-form-item>

        <el-form-item label="背景图 *">
          <el-upload
            accept="image/jpeg,image/png"
            :auto-upload="false"
            :limit="1"
            :on-change="handleImageChange"
            :show-file-list="false"
          >
            <div class="content-upload-box">
              <strong>{{ draft.assetName ? "更换图片" : "选择图片" }}</strong>
              <span>建议 750 × 1624 px · JPG/PNG</span>
              <span>{{ draft.order === 1 ? "首张硬上限 600KB" : "后续图片硬上限 500KB" }}</span>
            </div>
          </el-upload>
          <p v-if="draft.assetName" class="field-help">{{ draft.assetName }} · {{ draft.assetMeta }}</p>
          <p class="field-help">上传前请确认商品或人物主体避开顶部胶囊及底部导航安全区。</p>
        </el-form-item>

        <el-form-item label="展示文案 *">
          <el-input v-model="draft.copy" :maxlength="72" :rows="3" resize="none" show-word-limit type="textarea" />
        </el-form-item>

        <el-form-item label="文字预设">
          <div class="typography-controls">
            <el-select v-model="draft.lineCount">
              <el-option label="2 行" :value="2" />
              <el-option label="3 行" :value="3" />
            </el-select>
            <el-select v-model="draft.fontSize">
              <el-option label="中号" value="MEDIUM" />
              <el-option label="大号" value="LARGE" />
            </el-select>
            <el-select v-model="draft.alignment">
              <el-option label="居中" value="CENTER" />
            </el-select>
          </div>
        </el-form-item>

        <el-form-item label="关联共用详情 *">
          <el-select v-model="draft.sharedDetailVersionId" placeholder="选择已发布详情版本">
            <el-option
              v-for="detail in sharedDetailOptions"
              :key="detail.versionId"
              :label="`${detail.title} · ${detail.versionLabel}`"
              :value="detail.versionId"
            />
          </el-select>
          <p class="field-help">首页仅引用已发布的不可变详情版本。</p>
        </el-form-item>

        <el-form-item label="上线时间">
          <el-date-picker
            v-model="draft.scheduleRange"
            end-placeholder="长期有效"
            range-separator="至"
            start-placeholder="开始时间"
            type="datetimerange"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
          />
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
import { ElMessage } from "element-plus/es/components/message/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import {
  fetchHomeCarousel,
  fetchSharedDetails,
  saveHomeCarouselDraft,
  unpublishContentVersion,
  uploadContentAsset,
} from "./adminContentApi";

const emptyDraft = () => ({
  id: "",
  order: 1,
  internalName: "",
  copy: "",
  assetId: "",
  assetName: "",
  assetMeta: "",
  lineCount: 2,
  fontSize: "LARGE",
  alignment: "CENTER",
  sharedDetailVersionId: "",
  scheduleRange: [],
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
const contentReady = ref(false);
const sharedDetailOptions = ref([]);
const selectedFile = ref(null);
const objectUrls = new Set();
const draft = reactive(emptyDraft());
const filters = reactive({ keyword: "", status: "", schedule: "", page: 1 });
let searchTimer = null;
let loadSequence = 0;
let loadController = null;
let contentMountFrame = null;
let initialLoadFrame = null;

function statusLabel(status) {
  return ({ PUBLISHED: "已上线", DRAFT: "草稿", BLOCKED: "阻断", OFFLINE: "已下线" })[status] || "待确认";
}

function statusType(status) {
  if (status === "PUBLISHED") return "success";
  if (status === "BLOCKED") return "danger";
  if (status === "DRAFT") return "warning";
  return "info";
}

function scheduleLoad() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.page = 1;
    load();
  }, 300);
}

function resetFilters() {
  Object.assign(filters, { keyword: "", status: "", schedule: "", page: 1 });
  load();
}

function createDraft() {
  Object.assign(draft, emptyDraft(), { order: rows.value.length + 1 });
  selectedFile.value = null;
  drawerVisible.value = true;
}

function editDraft(row) {
  Object.assign(draft, emptyDraft(), row, {
    id: row.status === "PUBLISHED" ? "" : row.id,
    sourceVersionId: row.status === "PUBLISHED" ? row.versionId : "",
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
  const maxBytes = draft.order === 1 ? 600 * 1024 : 500 * 1024;
  if (!file || !["image/jpeg", "image/png"].includes(file.type)) {
    ElMessage.error("仅支持 JPG 或 PNG 图片");
    return;
  }
  if (file.size > maxBytes) {
    ElMessage.error(`图片超过 ${maxBytes / 1024}KB 硬上限，请先压缩`);
    return;
  }
  try {
    const dimensions = await imageDimensions(file);
    selectedFile.value = file;
    draft.assetName = file.name;
    draft.assetMeta = `${dimensions.width} × ${dimensions.height} · ${Math.ceil(file.size / 1024)}KB`;
  } catch (_) {
    ElMessage.error("图片无法读取，请更换文件");
  }
}

async function saveDraft() {
  if (!draft.internalName.trim() || !draft.copy.trim() || !draft.sharedDetailVersionId || (!draft.assetId && !selectedFile.value)) {
    ElMessage.warning("请完成所有必填项");
    return;
  }
  saving.value = true;
  errorMessage.value = "";
  try {
    let assetId = draft.assetId;
    if (selectedFile.value) {
      const uploaded = await uploadContentAsset(selectedFile.value, "home-carousel");
      assetId = uploaded.assetId;
    }
    await saveHomeCarouselDraft({
      ...draft,
      assetId,
      internalName: draft.internalName.trim(),
      copy: draft.copy.trim(),
    });
    drawerVisible.value = false;
    ElMessage.success("首页轮播草稿已保存");
    await load();
  } catch (error) {
    errorMessage.value = error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message;
  } finally {
    saving.value = false;
  }
}

async function unpublishRow(row) {
  try {
    await ElMessageBox.confirm("下线后首页新请求将不再展示该轮播，其他已发布内容不受影响。", "确认下线首页轮播？", {
      confirmButtonText: "确认下线",
      cancelButtonText: "取消",
      type: "warning",
    });
    await unpublishContentVersion(row.versionId);
    ElMessage.success("首页轮播已下线");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    errorMessage.value = error.outcomeUnknown ? "下线结果待确认，请刷新权威记录" : error.message;
  }
}

function previewOnline() {
  if (previewPath.value) window.open(previewPath.value, "_blank", "noopener,noreferrer");
}

async function loadSharedDetails() {
  try {
    const data = await fetchSharedDetails({ status: "PUBLISHED", page: 1, pageSize: 50 });
    sharedDetailOptions.value = data?.items || [];
  } catch (_) {
    sharedDetailOptions.value = [];
  }
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
    const data = await fetchHomeCarousel({ ...filters, pageSize }, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    rows.value = data?.items || [];
    total.value = Number(data?.total || 0);
    previewPath.value = data?.previewPath || "";
  } catch (error) {
    if (error.code === "ADMIN_ABORTED") return;
    if (sequence !== loadSequence) return;
    rows.value = [];
    total.value = 0;
    if (error.status === 404) interfaceUnavailable.value = true;
    else errorMessage.value = error.message;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

onMounted(() => {
  loadSharedDetails();
  contentMountFrame = requestAnimationFrame(() => {
    contentReady.value = true;
    initialLoadFrame = requestAnimationFrame(load);
  });
});
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  if (contentMountFrame !== null) cancelAnimationFrame(contentMountFrame);
  if (initialLoadFrame !== null) cancelAnimationFrame(initialLoadFrame);
  loadController?.abort();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});
defineExpose({ load });
</script>
