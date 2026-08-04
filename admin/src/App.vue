<template>
  <el-config-provider>
    <main class="admin-shell">
      <aside class="admin-sidebar">
        <div class="brand-lockup">
          <span class="brand-mark" aria-label="Root">ROOT</span>
          <span class="brand-product">运营管理后台</span>
        </div>

        <nav aria-label="运营后台导航">
          <el-menu :default-active="activeModule" class="nav-menu" @select="activeModule = $event">
            <el-menu-item index="release">发布工作台</el-menu-item>

            <template v-for="group in navigationGroups" :key="group.label">
              <li class="nav-group-label">{{ group.label }}</li>
              <el-menu-item
                v-for="item in group.items"
                :key="item.key"
                :disabled="item.disabled"
                :index="item.key"
              >
                {{ item.label }}
              </el-menu-item>
            </template>
          </el-menu>
        </nav>

        <div class="sidebar-footer">
          <span>myRoot Admin&nbsp; v1.0.0</span>
          <span>Element Plus</span>
        </div>
      </aside>

      <section class="admin-main">
        <header class="admin-topbar">
          <p class="topbar-path">{{ activeModuleTitle }}<span>/</span>首页</p>
          <div class="topbar-status">
            <el-tag class="environment-tag" effect="plain">候选环境</el-tag>
            <span class="content-version">线上内容 {{ onlineContentVersion }}</span>
            <el-tag class="change-tag" effect="light" type="warning">未发布 {{ unpublishedCount }}</el-tag>
            <el-popover placement="bottom-end" :width="280" trigger="click">
              <template #reference>
                <el-button class="operator-button" text>
                  {{ operatorLabel }}⌄
                </el-button>
              </template>
              <div class="session-panel">
                <p>后台会话</p>
                <el-input
                  v-model="adminToken"
                  clearable
                  placeholder="后台口令"
                  show-password
                  @change="refresh"
                />
                <el-button :loading="profileLoading" type="primary" @click="refresh">重新验证</el-button>
              </div>
            </el-popover>
          </div>
        </header>

        <div class="admin-page">
          <el-alert
            v-if="profileError"
            :closable="false"
            :title="profileError"
            class="workbench-alert"
            type="error"
          />
          <el-skeleton v-if="showProfileSkeleton" :rows="6" animated class="admin-loading-skeleton" />
          <el-empty v-else-if="!profileLoading && !visibleModules.length" description="暂无可访问模块" />
          <ReleaseWorkbench
            v-else-if="currentModuleKey === 'release'"
            ref="activeWorkbench"
            @release-meta="updateReleaseMeta"
          />
          <WelcomeContentPage v-else-if="currentModuleKey === 'welcome'" ref="activeWorkbench" />
          <HomeCarouselPage v-else-if="currentModuleKey === 'home'" ref="activeWorkbench" />
          <SharedDetailPage v-else-if="currentModuleKey === 'details'" ref="activeWorkbench" />
          <ActivityManagementPage v-else-if="currentModuleKey === 'activities'" ref="activeWorkbench" />
          <ActivityRegistrationsPage
            v-else-if="currentModuleKey === 'registrations'"
            ref="activeWorkbench"
            @navigate-module="activeModule = $event"
          />
          <InitializationPage v-else-if="currentModuleKey === 'profile'" ref="activeWorkbench" />
          <ScaleManagementPage v-else-if="currentModuleKey === 'scales'" ref="activeWorkbench" />
          <RecommendationRulesPage v-else-if="currentModuleKey === 'recommendations'" ref="activeWorkbench" />
          <LifestyleAdvicePage v-else-if="currentModuleKey === 'lifestyle'" ref="activeWorkbench" />
          <UserQueryPage v-else-if="currentModuleKey === 'users'" ref="activeWorkbench" />
          <OperationAuditPage v-else-if="currentModuleKey === 'audit'" ref="activeWorkbench" />
        </div>
      </section>
    </main>
  </el-config-provider>
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { fetchAdminProfile, getAdminToken, setAdminToken } from "./api/client";
import { ADMIN_ACCESS_KEY, ADMIN_CAPABILITIES, createAdminAccess } from "./modules/access";

const ADMIN_MODULES = [
  { key: "release", label: "发布工作台", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "welcome", label: "欢迎页", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "home", label: "首页轮播", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "details", label: "共用详情", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  {
    key: "activities",
    label: "活动管理",
    capabilities: [
      ADMIN_CAPABILITIES.ADMIN_READ,
      ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE,
      ADMIN_CAPABILITIES.ACTIVITY_PUBLISH,
      ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL,
      ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW,
    ],
  },
  { key: "registrations", label: "报名记录", capabilities: [ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW] },
  { key: "profile", label: "初始化建档", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "scales", label: "量表管理", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "recommendations", label: "推荐规则", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "lifestyle", label: "生活方式建议", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "users", label: "用户查询", capabilities: [ADMIN_CAPABILITIES.ADMIN_READ] },
  { key: "audit", label: "操作审计", capabilities: [ADMIN_CAPABILITIES.AUDIT_READ] },
];

const navigationGroups = [
  {
    label: "内容运营",
    items: [
      { key: "welcome", label: "欢迎页" },
      { key: "home", label: "首页轮播" },
      { key: "details", label: "共用详情" },
    ],
  },
  {
    label: "活动运营",
    items: [
      { key: "activities", label: "活动管理" },
      { key: "registrations", label: "报名记录" },
    ],
  },
  {
    label: "健康运营",
    items: [
      { key: "profile", label: "初始化建档" },
      { key: "scales", label: "量表管理" },
      { key: "recommendations", label: "推荐规则" },
      { key: "lifestyle", label: "生活方式建议" },
    ],
  },
  {
    label: "用户与审计",
    items: [
      { key: "users", label: "用户查询" },
      { key: "audit", label: "操作审计" },
    ],
  },
];

const ReleaseWorkbench = defineAsyncComponent(() => import("./modules/release/ReleaseWorkbench.vue"));
const WelcomeContentPage = defineAsyncComponent(() => import("./modules/content/WelcomeContentPage.vue"));
const loadHomeCarouselPage = () => import("./modules/content/HomeCarouselPage.vue");
const HomeCarouselPage = defineAsyncComponent(loadHomeCarouselPage);
const SharedDetailPage = defineAsyncComponent(() => import("./modules/content/SharedDetailPage.vue"));
const ActivityManagementPage = defineAsyncComponent(() => import("./modules/activities/ActivityManagementPage.vue"));
const ActivityRegistrationsPage = defineAsyncComponent(() => import("./modules/activities/ActivityRegistrationsPage.vue"));
const InitializationPage = defineAsyncComponent(() => import("./modules/health/InitializationPage.vue"));
const ScaleManagementPage = defineAsyncComponent(() => import("./modules/health/ScaleManagementPage.vue"));
const RecommendationRulesPage = defineAsyncComponent(() => import("./modules/health/RecommendationRulesPage.vue"));
const LifestyleAdvicePage = defineAsyncComponent(() => import("./modules/health/LifestyleAdvicePage.vue"));
const UserQueryPage = defineAsyncComponent(() => import("./modules/users/UserQueryPage.vue"));
const OperationAuditPage = defineAsyncComponent(() => import("./modules/audit/OperationAuditPage.vue"));

function initialModule() {
  const module = new URLSearchParams(window.location.search).get("module") || "";
  return ADMIN_MODULES.some((item) => item.key === module) ? module : "release";
}

const activeModule = ref(initialModule());
const adminToken = ref(getAdminToken());
const adminProfile = ref(null);
const profileError = ref("");
const profileLoading = ref(false);
const showProfileSkeleton = ref(false);
const releaseMeta = ref({ contentVersion: "—", unpublishedCount: 0 });
const activeWorkbench = ref(null);
let profileSkeletonTimer = null;
let cancelHomeCarouselPreload = null;
const adminAccess = createAdminAccess(adminProfile);
provide(ADMIN_ACCESS_KEY, adminAccess);

const visibleModules = computed(() => ADMIN_MODULES.filter((item) => adminAccess.any(item.capabilities)));
const currentModuleKey = computed(() => {
  if (visibleModules.value.some((item) => item.key === activeModule.value)) return activeModule.value;
  return visibleModules.value[0]?.key || "";
});
const activeModuleTitle = computed(() => {
  return ADMIN_MODULES.find((item) => item.key === currentModuleKey.value)?.label || "运营后台";
});
const operatorLabel = computed(() => adminProfile.value?.operatorId || "管理员");
const onlineContentVersion = computed(() => releaseMeta.value.contentVersion);
const unpublishedCount = computed(() => releaseMeta.value.unpublishedCount);

function updateReleaseMeta(meta = {}) {
  releaseMeta.value = {
    contentVersion: meta.contentVersion || "—",
    unpublishedCount: Number(meta.unpublishedCount || 0),
  };
}

function saveToken() {
  setAdminToken(adminToken.value.trim());
}

async function loadAdminProfile() {
  profileLoading.value = true;
  showProfileSkeleton.value = false;
  clearTimeout(profileSkeletonTimer);
  profileSkeletonTimer = setTimeout(() => {
    if (profileLoading.value) showProfileSkeleton.value = true;
  }, 300);
  profileError.value = "";
  try {
    adminProfile.value = await fetchAdminProfile();
  } catch (error) {
    adminProfile.value = null;
    profileError.value = error.message;
  } finally {
    clearTimeout(profileSkeletonTimer);
    profileLoading.value = false;
    showProfileSkeleton.value = false;
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

function scheduleHomeCarouselPreload() {
  const preload = () => {
    cancelHomeCarouselPreload = null;
    loadHomeCarouselPage().catch(() => {});
  };
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(preload, { timeout: 1500 });
    cancelHomeCarouselPreload = () => window.cancelIdleCallback(idleId);
    return;
  }
  const timeoutId = window.setTimeout(preload, 500);
  cancelHomeCarouselPreload = () => window.clearTimeout(timeoutId);
}

async function initializeApp() {
  await loadAdminProfile();
  scheduleHomeCarouselPreload();
}

watch(currentModuleKey, (key) => {
  if (key && key !== activeModule.value) activeModule.value = key;
});

onMounted(initializeApp);
onUnmounted(() => {
  clearTimeout(profileSkeletonTimer);
  cancelHomeCarouselPreload?.();
});
</script>
