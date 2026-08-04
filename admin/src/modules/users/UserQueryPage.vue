<template>
  <section class="workbench user-query-workbench">
    <el-alert
      v-if="errorMessage"
      :closable="false"
      :title="errorMessage"
      class="workbench-alert"
      type="error"
    />

    <el-card shadow="never">
      <template #header>
        <div class="toolbar-title">
          <div>
            <strong>会员账号查询</strong>
            <p class="query-hint">仅支持完整手机号精确查询，结果不展示生日、性别与健康信息。</p>
          </div>
        </div>
      </template>

      <el-form class="query-form" inline @submit.prevent="load">
        <el-form-item label="手机号">
          <el-input
            v-model="phone"
            autocomplete="off"
            clearable
            maxlength="11"
            placeholder="请输入完整的 11 位手机号"
            @keyup.enter="load"
          />
        </el-form-item>
        <el-form-item>
          <el-button :loading="loading" type="primary" @click="load">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="hasQueried && user" shadow="never">
      <template #header>
        <div class="toolbar-title">
          <span>账号信息</span>
          <el-tag :type="accountStatusType(user.accountStatus)" effect="plain">
            {{ accountStatusLabel(user.accountStatus) }}
          </el-tag>
        </div>
      </template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="昵称">{{ user.nickname || "Root用户" }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ user.maskedPhone || "-" }}</el-descriptions-item>
        <el-descriptions-item label="Root账号ID">{{ user.rootUserId || "-" }}</el-descriptions-item>
        <el-descriptions-item label="资料状态">
          {{ user.profileComplete ? "已完成" : "待完善" }}
        </el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ formatDateTime(user.registeredAt) }}</el-descriptions-item>
        <el-descriptions-item label="最近登录">{{ formatDateTime(user.lastLoginAt) }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-else-if="hasQueried && !loading" shadow="never">
      <el-empty description="未找到该手机号对应的 Root 账号" />
    </el-card>
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
}

defineExpose({ load: reset });
</script>

<style scoped>
.query-hint {
  margin: 6px 0 0;
  color: var(--root-muted);
  font-size: 13px;
  font-weight: 400;
}

.query-form {
  display: flex;
  align-items: center;
}

.query-form :deep(.el-input) {
  width: 320px;
}
</style>
