<template>
  <el-config-provider>
    <main class="admin-shell">
      <aside class="admin-sidebar">
        <div class="brand-lockup">
          <span class="brand-mark">ROOT</span>
          <strong>myRoot Admin</strong>
        </div>
        <el-menu :default-active="activeModule" class="nav-menu" @select="activeModule = $event">
          <el-menu-item v-for="item in visibleModules" :key="item.key" :index="item.key">
            {{ item.label }}
          </el-menu-item>
        </el-menu>
      </aside>

      <section class="admin-main">
        <header class="admin-topbar">
          <div>
            <p class="eyebrow">Element Plus Admin</p>
            <h1>{{ activeModuleTitle }}</h1>
            <el-space v-if="adminProfile" class="principal-tags" wrap>
              <el-tag effect="plain">{{ adminProfile.operatorId }}</el-tag>
              <el-tag effect="plain" type="info">{{ adminProfile.role }}</el-tag>
              <el-tag v-if="adminProfile.tokenConfigured === false" effect="plain" type="warning">local</el-tag>
            </el-space>
          </div>
          <el-space>
            <el-input
              v-model="adminToken"
              class="token-input"
              clearable
              placeholder="后台口令"
              show-password
              @change="refresh"
            />
            <el-button type="primary" @click="refresh">刷新</el-button>
          </el-space>
        </header>

        <el-alert
          v-if="profileError"
          :closable="false"
          :title="profileError"
          class="workbench-alert"
          type="error"
        />
        <el-empty v-if="!profileLoading && !visibleModules.length" description="暂无可访问模块" />
        <ConfigWorkbench v-else-if="currentModuleKey === 'config'" ref="activeWorkbench" />
        <UserLifecycle v-else-if="currentModuleKey === 'users'" ref="activeWorkbench" />
        <AuditLogPage v-else-if="currentModuleKey === 'audit'" ref="activeWorkbench" />
        <AdapterRunPage v-else-if="currentModuleKey === 'adapters'" ref="activeWorkbench" />
        <OperationalAnalytics v-else-if="currentModuleKey === 'analytics'" ref="activeWorkbench" />
        <ActivityWorkbench v-else-if="currentModuleKey === 'activities'" ref="activeWorkbench" />
        <ReleaseWorkbench v-else-if="currentModuleKey === 'release'" ref="activeWorkbench" />
      </section>
    </main>
  </el-config-provider>
</template>

<script setup>
import { computed, nextTick, onMounted, provide, ref, watch } from "vue";
import AdapterRunPage from "./modules/adapters/AdapterRunPage.vue";
import OperationalAnalytics from "./modules/analytics/OperationalAnalytics.vue";
import AuditLogPage from "./modules/audit/AuditLogPage.vue";
import ActivityWorkbench from "./modules/activities/ActivityWorkbench.vue";
import ConfigWorkbench from "./modules/config/ConfigWorkbench.vue";
import ReleaseWorkbench from "./modules/release/ReleaseWorkbench.vue";
import UserLifecycle from "./modules/users/UserLifecycle.vue";
import { fetchAdminProfile, getAdminToken, setAdminToken } from "./api/client";
import { ADMIN_ACCESS_KEY, ADMIN_CAPABILITIES, createAdminAccess } from "./modules/access";

const ADMIN_MODULES = [
  {
    key: "config",
    label: "运营配置",
    title: "运营配置工作台",
    capabilities: [
      ADMIN_CAPABILITIES.CONFIG_WRITE,
      ADMIN_CAPABILITIES.REVIEW_RESOLVE,
      ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE,
      ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE,
    ],
  },
  { key: "users", label: "用户生命周期", title: "用户生命周期", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "audit", label: "审计记录", title: "审计记录", capabilities: [ADMIN_CAPABILITIES.AUDIT_READ] },
  { key: "adapters", label: "Adapter 运行", title: "Adapter 运行", capabilities: [ADMIN_CAPABILITIES.CONFIG_WRITE] },
  { key: "analytics", label: "运营数据", title: "运营数据", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  {
    key: "activities",
    label: "活动运营",
    title: "活动运营工作台",
    capabilities: [
      ADMIN_CAPABILITIES.ADMIN_READ,
      ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE,
      ADMIN_CAPABILITIES.ACTIVITY_PUBLISH,
      ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL,
      ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW,
    ],
  },
  { key: "release", label: "开发发布", title: "开发发布", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
];

function initialModule() {
  const module = new URLSearchParams(window.location.search).get("module") || "";
  return ADMIN_MODULES.some((item) => item.key === module) ? module : "config";
}

const activeModule = ref(initialModule());
const adminToken = ref(getAdminToken());
const adminProfile = ref(null);
const profileError = ref("");
const profileLoading = ref(false);
const activeWorkbench = ref(null);
const adminAccess = createAdminAccess(adminProfile);
provide(ADMIN_ACCESS_KEY, adminAccess);
const visibleModules = computed(() => ADMIN_MODULES.filter((item) => {
  return adminAccess.any(item.capabilities);
}));
const currentModuleKey = computed(() => {
  if (visibleModules.value.some((item) => item.key === activeModule.value)) return activeModule.value;
  return visibleModules.value[0]?.key || "";
});
const activeModuleTitle = computed(() => {
  return ADMIN_MODULES.find((item) => item.key === currentModuleKey.value)?.title || "myRoot Admin";
});

function saveToken() {
  setAdminToken(adminToken.value.trim());
}

async function loadAdminProfile() {
  profileLoading.value = true;
  profileError.value = "";
  try {
    adminProfile.value = await fetchAdminProfile();
  } catch (error) {
    adminProfile.value = null;
    profileError.value = error.message;
  } finally {
    profileLoading.value = false;
  }
}

async function refresh() {
  saveToken();
  await loadAdminProfile();
  await nextTick();
  if (activeWorkbench.value && typeof activeWorkbench.value.load === "function") {
    activeWorkbench.value.load();
  }
}

watch(currentModuleKey, (key) => {
  if (key && key !== activeModule.value) activeModule.value = key;
});

onMounted(loadAdminProfile);
</script>
