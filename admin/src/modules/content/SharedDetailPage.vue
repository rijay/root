<template>
  <section :class="['workbench', 'content-workbench', 'shared-detail-page', { 'detail-editor-mode': mode === 'editor' }]">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <template v-if="mode === 'library'">
      <header class="page-heading">
        <div>
          <h1>共用详情</h1>
          <p>一份详情内容维护一份，首页和活动引用明确的已发布版本。</p>
        </div>
        <el-button type="primary" @click="createDetail">新建详情</el-button>
      </header>

      <el-alert
        v-if="interfaceUnavailable"
        :closable="false"
        class="content-interface-notice"
        title="Content Module 尚未接入，内容库保持为空；编辑器仅保存真实上传和明确校验的草稿。"
        type="info"
      />

      <el-form class="content-filter-bar" inline @submit.prevent>
        <el-input v-model="filters.keyword" clearable placeholder="搜索详情名称或版本" @input="scheduleLoad" />
        <el-select v-model="filters.status" placeholder="全部状态" @change="load">
          <el-option label="全部状态" value="" />
          <el-option label="草稿" value="DRAFT" />
          <el-option label="已发布" value="PUBLISHED" />
          <el-option label="已退役" value="RETIRED" />
        </el-select>
        <el-button link @click="resetFilters">重置筛选</el-button>
      </el-form>

      <section class="content-table-card">
        <el-table v-loading="loading" :data="rows" empty-text="暂无共用详情">
          <el-table-column prop="title" label="详情名称" min-width="260" />
          <el-table-column prop="versionLabel" label="当前版本" width="130" />
          <el-table-column prop="assetCount" label="图片" width="90" />
          <el-table-column prop="referenceCount" label="引用入口" width="110" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="updatedAtLabel" label="更新时间" width="170" />
          <el-table-column label="操作" width="150" align="right">
            <template #default="{ row }">
              <el-space>
                <el-button v-if="row.status === 'PUBLISHED'" link type="danger" @click="unpublishRow(row)">下线</el-button>
                <el-button link type="primary" @click="openDetail(row)">{{ row.status === "PUBLISHED" ? "复制草稿" : "编辑" }}</el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </template>

    <template v-else>
      <header class="detail-editor-heading">
        <div>
          <el-button class="back-to-library" link @click="backToLibrary">‹&nbsp; 返回内容库</el-button>
          <div class="detail-title-row">
            <h1>{{ detailDraft.title || "未命名共用详情" }}</h1>
            <el-button link type="primary" @click="renameDetail">编辑名称</el-button>
          </div>
          <p>{{ detailDraft.sourceVersionLabel ? `基于 ${detailDraft.sourceVersionLabel} 创建` : "新建详情草稿" }} · 当前草稿 {{ detailDraft.versionLabel || "未保存" }}</p>
        </div>
        <el-space>
          <el-button :disabled="!activeAsset?.previewUrl" @click="fullPreview">完整预览</el-button>
          <el-button :loading="saving" type="primary" @click="saveDetail">保存草稿</el-button>
        </el-space>
      </header>

      <div class="detail-editor-grid">
        <aside class="detail-asset-pane">
          <div class="detail-pane-heading">
            <strong>页面图片&nbsp; {{ detailDraft.assets.length }}</strong>
            <el-upload
              accept="image/jpeg,image/png"
              :auto-upload="false"
              :on-change="addAsset"
              :show-file-list="false"
            >
              <el-button link type="primary">+ 添加图片</el-button>
            </el-upload>
          </div>

          <button
            v-for="(asset, index) in detailDraft.assets"
            :key="asset.localId"
            :class="['detail-asset-card', { active: index === activeAssetIndex }]"
            type="button"
            @click="selectAsset(index)"
          >
            <span
              class="detail-asset-thumbnail"
              :style="asset.previewUrl ? { backgroundImage: `url(${asset.previewUrl})` } : {}"
            />
            <span>
              <strong>图片 {{ String(index + 1).padStart(2, "0") }}</strong>
              <small>{{ asset.dimensions || "尺寸待确认" }}</small>
              <small>热点 {{ asset.hotspots.length }}</small>
            </span>
          </button>

          <div v-if="!detailDraft.assets.length" class="detail-assets-empty">添加第一张纵向图片开始编辑</div>
          <p class="asset-ordering-hint">顺序按列表从上到下展示。图片需避开顶部胶囊和底部安全区；已发布版本不能原地调整。</p>
        </aside>

        <section class="detail-preview-pane">
          <div class="detail-pane-heading">
            <strong>小程序沉浸式预览<span v-if="activeAsset"> · 第 {{ activeAssetIndex + 1 }} 张</span></strong>
          </div>
          <div
            ref="previewRef"
            class="mini-program-content-preview"
            :class="{ 'has-image': activeAsset?.previewUrl }"
            :style="activeAsset?.previewUrl ? { backgroundImage: `url(${activeAsset.previewUrl})` } : {}"
            @pointerdown="startHotspot"
            @pointermove="resizeHotspot"
            @pointerup="finishHotspot"
          >
            <span class="detail-preview-wordmark">ROOT</span>
            <div v-if="!activeAsset?.previewUrl" class="detail-preview-empty">先从左侧添加图片</div>
            <button
              v-for="(hotspot, index) in activeAsset?.hotspots || []"
              :key="hotspot.id"
              :class="['preview-hotspot', { active: index === selectedHotspotIndex }]"
              :style="hotspotStyle(hotspot)"
              type="button"
              @pointerdown.stop="selectedHotspotIndex = index"
            >
              热点 {{ String(index + 1).padStart(2, "0") }}<span v-if="index === selectedHotspotIndex"> · 已选择</span>
            </button>
            <div class="detail-preview-copy">
              <span>ROOT FOUNDATION</span>
              <strong>{{ detailDraft.previewCopy || "从肠道开始，\n理解身体的节奏" }}</strong>
            </div>
            <span class="detail-preview-dots">{{ previewDots }}</span>
          </div>
        </section>

        <aside class="hotspot-properties-pane">
          <div class="detail-pane-heading">
            <strong>热点设置</strong>
          </div>
          <p class="hotspot-pane-hint">在预览画面拖动创建热点。<br>{{ selectedHotspot ? `当前选择：热点 ${String(selectedHotspotIndex + 1).padStart(2, "0")}` : "当前没有热点" }}</p>

          <template v-if="selectedHotspot">
            <label class="content-field-label">跳转类型 *</label>
            <el-select v-model="selectedHotspot.targetType" @change="resetTargetValidation">
              <el-option label="小程序内页" value="MINIPROGRAM_PAGE" />
              <el-option label="Root 会员中心固定路径" value="ROOT_MEMBER_CENTER" />
              <el-option label="白名单网页" value="WEBVIEW_ALLOWLIST" />
            </el-select>

            <label class="content-field-label">跳转目标 *</label>
            <el-input
              v-model="selectedHotspot.target"
              :rows="3"
              placeholder="选择或填写受控目标"
              resize="none"
              type="textarea"
              @input="resetTargetValidation"
            />
            <el-button class="target-validation-button" :loading="validatingTarget" @click="checkTarget">检查目标</el-button>

            <div :class="['target-validation-status', `status-${selectedHotspot.validationStatus.toLowerCase()}`]">
              <strong>{{ targetValidationTitle }}</strong>
              <span>{{ selectedHotspot.validationMessage || "保存前必须通过白名单与路径检查" }}</span>
            </div>

            <label class="content-field-label">热点位置</label>
            <p class="hotspot-position-value">
              X {{ round(selectedHotspot.x) }}%&nbsp;&nbsp; Y {{ round(selectedHotspot.y) }}%<br>
              宽 {{ round(selectedHotspot.width) }}%&nbsp;&nbsp; 高 {{ round(selectedHotspot.height) }}%
            </p>
            <p class="hotspot-safety-note">热点只负责内容跳转，不承担活动报名或订单事实。</p>
            <el-button link type="danger" @click="removeSelectedHotspot">删除当前热点</el-button>
          </template>
          <el-empty v-else :image-size="72" description="拖动预览区域创建热点" />
        </aside>
      </div>

      <el-dialog v-model="previewDialogVisible" class="content-preview-dialog" title="共用详情完整预览" width="420px">
        <div
          class="full-content-preview"
          :style="activeAsset?.previewUrl ? { backgroundImage: `url(${activeAsset.previewUrl})` } : {}"
        >
          <span>ROOT</span>
        </div>
      </el-dialog>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import {
  fetchSharedDetails,
  saveSharedDetailDraft,
  unpublishContentVersion,
  uploadContentAsset,
  validateContentTarget,
} from "./adminContentApi";

const newDetailDraft = () => ({
  id: "",
  title: "",
  versionLabel: "",
  sourceVersionId: "",
  sourceVersionLabel: "",
  previewCopy: "",
  assets: [],
});

const rows = ref([]);
const loading = ref(false);
const saving = ref(false);
const validatingTarget = ref(false);
const errorMessage = ref("");
const interfaceUnavailable = ref(false);
const mode = ref("library");
const activeAssetIndex = ref(0);
const selectedHotspotIndex = ref(-1);
const previewDialogVisible = ref(false);
const previewRef = ref(null);
const detailDraft = reactive(newDetailDraft());
const filters = reactive({ keyword: "", status: "", page: 1, pageSize: 20 });
const objectUrls = new Set();
let searchTimer = null;
let dragging = null;
let loadSequence = 0;
let loadController = null;

const activeAsset = computed(() => detailDraft.assets[activeAssetIndex.value] || null);
const selectedHotspot = computed(() => activeAsset.value?.hotspots[selectedHotspotIndex.value] || null);
const previewDots = computed(() => {
  if (!detailDraft.assets.length) return "";
  return detailDraft.assets.map((_, index) => index === activeAssetIndex.value ? "●" : "○").join("  ");
});
const targetValidationTitle = computed(() => {
  if (selectedHotspot.value?.validationStatus === "PASS") return "✓ 目标检查通过";
  if (selectedHotspot.value?.validationStatus === "BLOCKED") return "! 目标检查未通过";
  return "○ 目标待检查";
});

function statusLabel(status) {
  return ({ PUBLISHED: "已发布", DRAFT: "草稿", BLOCKED: "阻断", RETIRED: "已退役" })[status] || "待确认";
}

function statusType(status) {
  if (status === "PUBLISHED") return "success";
  if (status === "BLOCKED") return "danger";
  if (status === "DRAFT") return "warning";
  return "info";
}

function round(value) {
  return Math.round(Number(value || 0));
}

function scheduleLoad() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 300);
}

function resetFilters() {
  Object.assign(filters, { keyword: "", status: "", page: 1, pageSize: 20 });
  load();
}

function createDetail() {
  Object.assign(detailDraft, newDetailDraft());
  activeAssetIndex.value = 0;
  selectedHotspotIndex.value = -1;
  mode.value = "editor";
}

function normalizeAssets(assets = []) {
  return assets.map((asset, index) => ({
    localId: asset.id || `asset-${Date.now()}-${index}`,
    assetId: asset.assetId || "",
    file: null,
    previewUrl: asset.previewUrl || "",
    dimensions: asset.dimensions || "尺寸待确认",
    hotspots: (asset.hotspots || []).map((hotspot, hotspotIndex) => ({
      id: hotspot.id || `hotspot-${Date.now()}-${hotspotIndex}`,
      x: Number(hotspot.x || 0),
      y: Number(hotspot.y || 0),
      width: Number(hotspot.width || 0),
      height: Number(hotspot.height || 0),
      targetType: hotspot.targetType || "ROOT_MEMBER_CENTER",
      target: hotspot.target || "",
      validationStatus: hotspot.validationStatus || "PENDING",
      validationMessage: hotspot.validationMessage || "",
    })),
  }));
}

function openDetail(row) {
  Object.assign(detailDraft, newDetailDraft(), row, {
    id: row.status === "PUBLISHED" ? "" : row.id,
    sourceVersionId: row.status === "PUBLISHED" ? row.versionId : row.sourceVersionId || "",
    sourceVersionLabel: row.status === "PUBLISHED" ? row.versionLabel : row.sourceVersionLabel || "",
    assets: normalizeAssets(row.assets),
  });
  activeAssetIndex.value = 0;
  selectedHotspotIndex.value = detailDraft.assets[0]?.hotspots.length ? 0 : -1;
  mode.value = "editor";
}

function backToLibrary() {
  mode.value = "library";
  selectedHotspotIndex.value = -1;
}

async function renameDetail() {
  try {
    const result = await ElMessageBox.prompt("仅用于后台识别，不会直接展示给用户。", "编辑详情名称", {
      inputValue: detailDraft.title,
      inputPattern: /^.{1,40}$/,
      inputErrorMessage: "请输入 1–40 个字符",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
    detailDraft.title = result.value.trim();
  } catch (_) {
    // Cancel keeps the current draft unchanged.
  }
}

async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  objectUrls.add(url);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, url });
    image.onerror = reject;
    image.src = url;
  });
}

async function addAsset(uploadFile) {
  const file = uploadFile.raw;
  if (!file || !["image/jpeg", "image/png"].includes(file.type)) {
    ElMessage.error("仅支持 JPG 或 PNG 图片");
    return;
  }
  if (file.size > 600 * 1024) {
    ElMessage.error("详情图片超过 600KB 硬上限，请先压缩");
    return;
  }
  try {
    const dimensions = await imageDimensions(file);
    detailDraft.assets.push({
      localId: `asset-${Date.now()}`,
      assetId: "",
      file,
      previewUrl: dimensions.url,
      dimensions: `${dimensions.width} × ${dimensions.height}`,
      hotspots: [],
    });
    activeAssetIndex.value = detailDraft.assets.length - 1;
    selectedHotspotIndex.value = -1;
  } catch (_) {
    ElMessage.error("图片无法读取，请更换文件");
  }
}

function selectAsset(index) {
  activeAssetIndex.value = index;
  selectedHotspotIndex.value = -1;
}

function pointerPosition(event) {
  const rect = previewRef.value.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  };
}

function startHotspot(event) {
  if (!activeAsset.value?.previewUrl || event.button !== 0) return;
  const start = pointerPosition(event);
  const hotspot = {
    id: `hotspot-${Date.now()}`,
    x: start.x,
    y: start.y,
    width: 0,
    height: 0,
    targetType: "ROOT_MEMBER_CENTER",
    target: "",
    validationStatus: "PENDING",
    validationMessage: "",
  };
  activeAsset.value.hotspots.push(hotspot);
  selectedHotspotIndex.value = activeAsset.value.hotspots.length - 1;
  dragging = { start, hotspot };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function resizeHotspot(event) {
  if (!dragging) return;
  const current = pointerPosition(event);
  dragging.hotspot.x = Math.min(dragging.start.x, current.x);
  dragging.hotspot.y = Math.min(dragging.start.y, current.y);
  dragging.hotspot.width = Math.abs(current.x - dragging.start.x);
  dragging.hotspot.height = Math.abs(current.y - dragging.start.y);
}

function finishHotspot() {
  if (!dragging) return;
  if (dragging.hotspot.width < 4 || dragging.hotspot.height < 4) {
    activeAsset.value.hotspots.splice(selectedHotspotIndex.value, 1);
    selectedHotspotIndex.value = -1;
  }
  dragging = null;
}

function hotspotStyle(hotspot) {
  return {
    left: `${hotspot.x}%`,
    top: `${hotspot.y}%`,
    width: `${hotspot.width}%`,
    height: `${hotspot.height}%`,
  };
}

function resetTargetValidation() {
  if (!selectedHotspot.value) return;
  selectedHotspot.value.validationStatus = "PENDING";
  selectedHotspot.value.validationMessage = "目标已变更，请重新检查";
}

async function checkTarget() {
  if (!selectedHotspot.value?.target.trim()) {
    ElMessage.warning("请先填写跳转目标");
    return;
  }
  validatingTarget.value = true;
  try {
    const result = await validateContentTarget({
      targetType: selectedHotspot.value.targetType,
      target: selectedHotspot.value.target.trim(),
    });
    selectedHotspot.value.validationStatus = result.status === "PASS" ? "PASS" : "BLOCKED";
    selectedHotspot.value.validationMessage = result.message || "检查完成";
  } catch (error) {
    selectedHotspot.value.validationStatus = "BLOCKED";
    selectedHotspot.value.validationMessage = error.status === 404 ? "目标校验 Interface 尚未接入" : error.message;
  } finally {
    validatingTarget.value = false;
  }
}

function removeSelectedHotspot() {
  if (!activeAsset.value || selectedHotspotIndex.value < 0) return;
  activeAsset.value.hotspots.splice(selectedHotspotIndex.value, 1);
  selectedHotspotIndex.value = -1;
}

function fullPreview() {
  previewDialogVisible.value = true;
}

async function saveDetail() {
  if (!detailDraft.title.trim() || !detailDraft.assets.length) {
    ElMessage.warning("请先填写名称并添加至少一张图片");
    return;
  }
  const unchecked = detailDraft.assets.flatMap((asset) => asset.hotspots).some((hotspot) => hotspot.validationStatus !== "PASS");
  if (unchecked) {
    ElMessage.warning("所有热点目标通过检查后才能保存草稿");
    return;
  }
  saving.value = true;
  errorMessage.value = "";
  try {
    const assets = [];
    for (let index = 0; index < detailDraft.assets.length; index += 1) {
      const asset = detailDraft.assets[index];
      let assetId = asset.assetId;
      if (asset.file) {
        const uploaded = await uploadContentAsset(asset.file, "shared-detail");
        assetId = uploaded.assetId;
      }
      assets.push({ assetId, order: index + 1, hotspots: asset.hotspots });
    }
    await saveSharedDetailDraft({
      id: detailDraft.id,
      sourceVersionId: detailDraft.sourceVersionId,
      title: detailDraft.title.trim(),
      previewCopy: detailDraft.previewCopy.trim(),
      assets,
    });
    ElMessage.success("共用详情草稿已保存");
    backToLibrary();
    await load();
  } catch (error) {
    errorMessage.value = error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message;
  } finally {
    saving.value = false;
  }
}

async function unpublishRow(row) {
  if (Number(row.referenceCount || 0) > 0) {
    ElMessage.warning("该版本仍被首页或活动引用，请先下线引用入口");
    return;
  }
  try {
    await ElMessageBox.confirm("下线后该不可变详情版本不再对新请求开放。", "确认下线共用详情？", {
      confirmButtonText: "确认下线",
      cancelButtonText: "取消",
      type: "warning",
    });
    await unpublishContentVersion(row.versionId);
    ElMessage.success("共用详情已下线");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    errorMessage.value = error.outcomeUnknown ? "下线结果待确认，请刷新权威记录" : error.message;
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
    const data = await fetchSharedDetails(filters, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    rows.value = data?.items || [];
  } catch (error) {
    if (error.code === "ADMIN_ABORTED") return;
    if (sequence !== loadSequence) return;
    rows.value = [];
    if (error.status === 404) interfaceUnavailable.value = true;
    else errorMessage.value = error.message;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  loadController?.abort();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});
defineExpose({ load });
</script>
