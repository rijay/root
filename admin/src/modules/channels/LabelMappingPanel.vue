<template>
  <div class="mapping-panel">
    <p>为渠道码或自报来源配置活动属性。首次配置可回填实际开始时间，后续版本须从未来时间生效。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="来源类型"><el-select v-model="draft.sourceType" @change="draft.sourceId = ''"><el-option label="渠道码" value="QR_CODE" /><el-option label="用户自报来源" value="SELF_REPORTED" /></el-select></el-form-item>
      <el-form-item label="来源"><el-select v-model="draft.sourceId" filterable placeholder="选择已配置的来源"><el-option v-for="item in sources" :key="item.id" :label="item.label" :value="item.id" /></el-select></el-form-item>
      <el-form-item label="来源活动"><el-input v-model="draft.activity" maxlength="80" /></el-form-item>
      <el-form-item label="来源城市"><el-input v-model="draft.city" maxlength="80" placeholder="活动所在城市" /></el-form-item>
      <el-form-item label="合作方 / 渠道"><el-input v-model="draft.partner" maxlength="80" /></el-form-item>
      <el-form-item label="渠道类型"><el-select v-model="draft.channelType"><el-option v-for="value in channelTypes" :key="value" :label="value" :value="value" /></el-select></el-form-item>
      <el-form-item label="生效时间"><el-date-picker v-model="draft.effectiveFrom" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="首次建映射可填写实际活动开始时间" /></el-form-item>
      <el-form-item label="配置依据"><el-input v-model="draft.reason" maxlength="200" placeholder="例如：已确认的活动排期与合作方" /></el-form-item>
      <el-button type="primary" :loading="saving" :disabled="access.disabled(ADMIN_CAPABILITIES.CHANNEL_MANAGE)" @click="save">保存新版本</el-button>
    </el-form>
    <el-table :data="mappings" empty-text="尚未配置用户来源映射">
      <el-table-column label="来源" min-width="200"><template #default="{ row }">{{ row.source_type === 'QR_CODE' ? '渠道码' : '自报来源' }} · {{ row.source_id }}</template></el-table-column>
      <el-table-column label="活动 / 城市" min-width="170"><template #default="{ row }">{{ row.attributes_json.activity }} / {{ row.attributes_json.city }}</template></el-table-column>
      <el-table-column label="合作方" prop="attributes_json.partner" min-width="150" />
      <el-table-column label="版本" prop="mapping_version" width="70" />
      <el-table-column label="生效时间" min-width="180"><template #default="{ row }">{{ new Date(row.effective_from).toLocaleString('zh-CN') }}</template></el-table-column>
    </el-table>
  </div>
</template>
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { ADMIN_CAPABILITIES, useAdminAccess } from "../access";
import { fetchLabelConfiguration, saveLabelMapping } from "../users/adminUserLabelsApi";
import { fetchChannelConfiguration } from "./adminChannelApi";
const access = useAdminAccess(), error = ref(""), saving = ref(false), mappings = ref([]), codes = ref([]), options = ref([]);
const draft = reactive({ sourceType: "QR_CODE", sourceId: "", activity: "", city: "", partner: "", channelType: "", effectiveFrom: "", reason: "" });
const channelTypes = ["市集活动", "场馆陪伴计划", "内部测试", "通用自然流量", "待确认"];
const sources = computed(() => draft.sourceType === "QR_CODE" ? codes.value.map((c) => ({ id: c.channelQrCodeId, sourceId: c.channelQrCodeId, sourceVersion: 0, label: `${c.label} · ${c.channelId}` })) : options.value.map((o) => ({ ...o, id: `${o.sourceVersion}:${o.sourceId}`, label: `${o.label} · 配置 v${o.sourceVersion}` })));
async function load() {
  try { const [config, channels] = await Promise.all([fetchLabelConfiguration(), fetchChannelConfiguration()]);
    mappings.value = config.mappings; codes.value = channels.codes;
    options.value = config.selfReportedSources || [];
  } catch (e) { error.value = e.message; }
}
async function save() {
  saving.value = true; error.value = "";
  try { const source = sources.value.find((s) => s.id === draft.sourceId);
    if (!source) throw new Error("请选择已配置的来源");
    const expectedVersion = mappings.value.filter((m) => m.source_type === draft.sourceType && m.source_id === source.sourceId && m.source_version === source.sourceVersion).length;
    await saveLabelMapping({ ...draft, sourceId: source.sourceId, sourceVersion: source.sourceVersion, expectedVersion }); await load(); ElMessage.success("已保存来源映射新版本");
  } catch (e) { error.value = e.message; } finally { saving.value = false; }
}
onMounted(load);
</script>
<style scoped>
.mapping-panel { display: grid; gap: 16px; }
.mapping-panel :deep(.el-form) { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 8px 24px; max-width: 900px; }
.mapping-panel :deep(.el-select), .mapping-panel :deep(.el-date-editor) { width: 100%; }
@media(max-width: 800px) { .mapping-panel :deep(.el-form) { grid-template-columns: 1fr; } }
</style>
