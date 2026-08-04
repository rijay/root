<template>
  <section class="workbench content-workbench user-query-workbench">
    <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" class="workbench-alert" type="error" />

    <header class="page-heading">
      <div>
        <h1>用户查询</h1>
        <p>按完整手机号查询注册与身份状态，不展示生日、性别或健康信息。</p>
      </div>
    </header>

    <el-form class="content-filter-bar user-query-filter" inline @submit.prevent="load">
      <el-input
        v-model="phone"
        autocomplete="off"
        clearable
        maxlength="11"
        placeholder="输入完整的 11 位手机号"
        @keyup.enter="load"
      />
      <el-select model-value="" disabled placeholder="全部账号状态">
        <el-option label="全部账号状态" value="" />
      </el-select>
      <el-select model-value="" disabled placeholder="全部身份状态">
        <el-option label="全部身份状态" value="" />
      </el-select>
      <el-button :loading="loading" type="primary" @click="load">查询</el-button>
      <el-button link @click="reset">重置筛选</el-button>
    </el-form>

    <section class="content-table-card user-table-card">
      <el-table v-loading="loading" :data="user ? [user] : []" :empty-text="hasQueried ? '未找到该手机号对应的 Root 账号' : '输入完整手机号后查询'" height="510">
        <el-table-column label="序号" width="58"><template #default>01</template></el-table-column>
        <el-table-column label="用户" min-width="260">
          <template #default="{ row }">
            <div class="user-row-primary">
              <span class="user-row-avatar">{{ (row.nickname || "R").slice(0, 1) }}</span>
              <span><strong>{{ row.nickname || "Root用户" }}</strong><small>UID {{ row.rootUserId || "-" }}</small></span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="验证手机号" min-width="180"><template #default="{ row }"><span>{{ row.maskedPhone || "-" }}</span><span class="description-meta">微信手机号已验证</span></template></el-table-column>
        <el-table-column label="注册与资料" min-width="180"><template #default="{ row }"><span>{{ formatDateTime(row.registeredAt) }}</span><span class="description-meta">{{ row.profileComplete ? "资料已完成" : "资料待完善" }}</span></template></el-table-column>
        <el-table-column label="状态" width="104"><template #default="{ row }"><el-tag :type="accountStatusType(row.accountStatus)" effect="plain">{{ accountStatusLabel(row.accountStatus) }}</el-tag></template></el-table-column>
        <el-table-column align="right" label="操作" width="88"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看</el-button></template></el-table-column>
      </el-table>
    </section>

    <el-drawer v-model="detailVisible" class="content-edit-drawer user-detail-drawer" size="408px" :show-close="true">
      <template #header><div><h2>用户详情</h2><p>仅展示注册与身份处理所需信息，不展示健康答案。</p></div></template>
      <template v-if="selectedUser">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户编号与昵称">{{ selectedUser.rootUserId || "-" }} · {{ selectedUser.nickname || "Root用户" }}</el-descriptions-item>
          <el-descriptions-item label="验证手机号">{{ selectedUser.maskedPhone || "-" }}<br>微信手机号已验证</el-descriptions-item>
          <el-descriptions-item label="注册与资料">{{ formatDateTime(selectedUser.registeredAt) }}<br>{{ selectedUser.profileComplete ? "资料已完成" : "资料待完善" }}</el-descriptions-item>
          <el-descriptions-item label="账号状态">{{ accountStatusLabel(selectedUser.accountStatus) }}</el-descriptions-item>
          <el-descriptions-item label="最近登录">{{ formatDateTime(selectedUser.lastLoginAt) }}</el-descriptions-item>
        </el-descriptions>
        <p class="table-footer-hint">完整手机号仅用于本次精确查询，不在结果或审计中返回。</p>
      </template>
      <template #footer><el-button @click="detailVisible = false">关闭</el-button></template>
    </el-drawer>
  </section>
</template>

<script setup>
import { ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index";
import { queryFormalUserByPhone } from "./adminUserQueryApi";

const phone = ref("");
const user = ref(null);
const loading = ref(false);
const hasQueried = ref(false);
const errorMessage = ref("");
const detailVisible = ref(false);
const selectedUser = ref(null);

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function accountStatusLabel(status) {
  return {
    ACTIVE: "正常",
    PROFILE_PENDING: "资料待完善",
    DELETION_PENDING: "注销处理中",
    DELETED: "已注销",
  }[status] || "待核验";
}

function accountStatusType(status) {
  if (status === "ACTIVE") return "success";
  if (status === "DELETION_PENDING") return "warning";
  if (status === "DELETED") return "info";
  return "warning";
}

function openDetail(row) {
  selectedUser.value = row;
  detailVisible.value = true;
}

async function load() {
  const value = phone.value.trim();
  errorMessage.value = "";
  user.value = null;
  hasQueried.value = false;
  if (!/^1\d{10}$/.test(value)) {
    ElMessage.warning("请输入完整的 11 位手机号");
    return;
  }
  loading.value = true;
  try {
    const result = await queryFormalUserByPhone(value);
    user.value = result.user || null;
    hasQueried.value = true;
    if (user.value) openDetail(user.value);
    phone.value = "";
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function reset() {
  phone.value = "";
  user.value = null;
  errorMessage.value = "";
  hasQueried.value = false;
  selectedUser.value = null;
  detailVisible.value = false;
}

defineExpose({ load: reset });
</script>

<style scoped>
.user-query-filter :deep(.el-input) {
  width: 250px;
}

.user-row-primary {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-row-primary > span:last-child {
  display: grid;
  gap: 5px;
}

.user-row-primary small,
.description-meta {
  display: block;
  color: var(--root-muted);
  font-size: 12px;
}

.user-row-avatar {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 50%;
  background: #304734;
  color: #fff;
  font-weight: 700;
}
</style>
