<template>
  <section class="workbench content-workbench welcome-content-page">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />

    <header class="page-heading">
      <div>
        <h1>欢迎页</h1>
        <p>固定维护两张新用户欢迎画面；这里只保存草稿，不直接替换线上版本。</p>
      </div>
      <el-button :disabled="!hasOnlinePreview" @click="previewOnline">预览当前线上</el-button>
    </header>

    <el-alert
      v-if="interfaceUnavailable"
      :closable="false"
      class="content-interface-notice"
      title="Content Module 尚未接入，当前展示安全空态；不会生成或发布虚假内容。"
      type="info"
    />

    <div class="welcome-screen-grid">
      <article v-for="(screen, index) in screens" :key="screen.slot" class="welcome-screen-card">
        <div class="welcome-card-heading">
          <div>
            <span class="content-kicker">固定画面 {{ screen.slot }}</span>
            <h2>第 {{ screen.slot }} 屏</h2>
          </div>
          <el-tag :type="statusType(screen.status)" effect="plain">{{ statusLabel(screen.status) }}</el-tag>
        </div>

        <div class="welcome-card-body">
          <div
            class="welcome-thumbnail"
            :style="screen.previewUrl ? { backgroundImage: `url(${screen.previewUrl})` } : {}"
          >
            <span class="content-preview-wordmark">ROOT</span>
            <p>{{ screen.copy || "尚未配置欢迎文案" }}</p>
            <span v-if="!screen.previewUrl" class="content-image-empty">背景图待上传</span>
          </div>
          <dl class="content-summary-list">
            <div><dt>背景图</dt><dd>{{ screen.assetName || "未配置" }}</dd></div>
            <div><dt>展示文案</dt><dd>{{ screen.copy ? `${screen.copy.length} 字` : "未配置" }}</dd></div>
            <div><dt>当前版本</dt><dd>{{ screen.version || "—" }}</dd></div>
            <div><dt>校验状态</dt><dd>{{ screen.validationLabel || "待校验" }}</dd></div>
          </dl>
        </div>

        <footer class="welcome-card-footer">
          <span>两屏固定顺序，不支持新增第三屏</span>
          <el-space>
            <el-button v-if="screen.status === 'PUBLISHED'" link type="danger" @click="unpublishScreen(screen)">下线</el-button>
            <el-button link type="primary" @click="editScreen(index)">编辑草稿</el-button>
          </el-space>
        </footer>
      </article>
    </div>

    <div class="content-version-rule">
      <strong>版本规则</strong>
      <span>已发布版本只读；任何修改都会形成新草稿，通过校验、预览和二次确认后才可发布。</span>
    </div>

    <el-drawer v-model="drawerVisible" class="content-edit-drawer" size="408px" :show-close="true">
      <template #header>
        <div>
          <h2>编辑欢迎页 · 第 {{ draft.slot }} 屏</h2>
          <p>当前编辑草稿，不影响线上版本。</p>
        </div>
      </template>

      <el-form label-position="top">
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
              <span>压缩后硬上限 600KB</span>
            </div>
          </el-upload>
          <p v-if="draft.assetName" class="field-help">{{ draft.assetName }} · {{ draft.assetMeta }}</p>
          <p class="field-help">上传前请确认主体与文字避开顶部胶囊及底部安全区。</p>
        </el-form-item>

        <el-form-item label="展示文案 *">
          <el-input v-model="draft.copy" :maxlength="500" :rows="8" resize="none" show-word-limit type="textarea" />
        </el-form-item>

        <el-form-item label="显示规则">
          <el-input :model-value="draft.slot === 1 ? '首次进入展示 · 可左右滑动 · 可跳过' : '第二屏展示 · 可返回第一屏 · 可跳过'" disabled />
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
import { ElMessage, ElMessageBox } from "element-plus";
import { fetchWelcomeContent, saveWelcomeDraft, unpublishContentVersion, uploadContentAsset } from "./adminContentApi";

const emptyScreen = (slot) => ({
  slot,
  status: "EMPTY",
  copy: "",
  assetId: "",
  assetName: "",
  assetMeta: "",
  previewUrl: "",
  version: "",
  validationLabel: "待校验",
});

const screens = ref([emptyScreen(1), emptyScreen(2)]);
const drawerVisible = ref(false);
const saving = ref(false);
const errorMessage = ref("");
const interfaceUnavailable = ref(false);
const hasOnlinePreview = ref(false);
const selectedFile = ref(null);
const objectUrls = new Set();
const draft = reactive(emptyScreen(1));

function statusLabel(status) {
  return ({ PUBLISHED: "已发布", DRAFT: "草稿", BLOCKED: "阻断", EMPTY: "未配置" })[status] || "待确认";
}

function statusType(status) {
  if (status === "PUBLISHED") return "success";
  if (status === "BLOCKED") return "danger";
  if (status === "DRAFT") return "warning";
  return "info";
}

function normalizeScreens(data) {
  const source = Array.isArray(data?.screens) ? data.screens : [];
  return [1, 2].map((slot) => {
    const item = source.find((entry) => Number(entry.slot) === slot) || {};
    return { ...emptyScreen(slot), ...item, slot };
  });
}

function editScreen(index) {
  Object.assign(draft, screens.value[index]);
  selectedFile.value = null;
  drawerVisible.value = true;
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

async function handleImageChange(uploadFile) {
  const file = uploadFile.raw;
  if (!file || !["image/jpeg", "image/png"].includes(file.type)) {
    ElMessage.error("仅支持 JPG 或 PNG 图片");
    return;
  }
  if (file.size > 600 * 1024) {
    ElMessage.error("图片超过 600KB 硬上限，请先压缩");
    return;
  }
  try {
    const dimensions = await imageDimensions(file);
    selectedFile.value = file;
    draft.assetName = file.name;
    draft.assetMeta = `${dimensions.width} × ${dimensions.height} · ${Math.ceil(file.size / 1024)}KB`;
    draft.previewUrl = dimensions.url;
  } catch (_) {
    ElMessage.error("图片无法读取，请更换文件");
  }
}

async function saveDraft() {
  if (!draft.copy.trim() || (!draft.assetId && !selectedFile.value)) {
    ElMessage.warning("请先填写文案并选择背景图");
    return;
  }
  saving.value = true;
  errorMessage.value = "";
  try {
    let assetId = draft.assetId;
    if (selectedFile.value) {
      const uploaded = await uploadContentAsset(selectedFile.value, `welcome-${draft.slot}`);
      assetId = uploaded.assetId;
    }
    await saveWelcomeDraft({ slot: draft.slot, copy: draft.copy.trim(), assetId });
    ElMessage.success("欢迎页草稿已保存");
    drawerVisible.value = false;
    await load();
  } catch (error) {
    errorMessage.value = error.outcomeUnknown ? "保存结果待确认，请刷新权威记录" : error.message;
  } finally {
    saving.value = false;
  }
}

async function unpublishScreen(screen) {
  try {
    await ElMessageBox.confirm("下线后新用户将不再读取这一已发布画面。", `确认下线第 ${screen.slot} 屏？`, {
      confirmButtonText: "确认下线",
      cancelButtonText: "取消",
      type: "warning",
    });
    await unpublishContentVersion(screen.versionId);
    ElMessage.success("欢迎页画面已下线");
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    errorMessage.value = error.outcomeUnknown ? "下线结果待确认，请刷新权威记录" : error.message;
  }
}

function previewOnline() {
  ElMessage.info("请在小程序预览版本中检查欢迎页效果");
}

async function load() {
  errorMessage.value = "";
  interfaceUnavailable.value = false;
  try {
    const data = await fetchWelcomeContent();
    screens.value = normalizeScreens(data);
    hasOnlinePreview.value = Boolean(data?.previewPath);
  } catch (error) {
    if (error.status === 404) {
      screens.value = [emptyScreen(1), emptyScreen(2)];
      interfaceUnavailable.value = true;
      return;
    }
    errorMessage.value = error.message;
  }
}

onMounted(load);
onBeforeUnmount(() => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
defineExpose({ load });
</script>
