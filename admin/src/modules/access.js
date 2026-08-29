import { computed, inject } from "vue";

export const ADMIN_CAPABILITIES = Object.freeze({
  ADMIN_READ: "ADMIN_READ",
  AUDIT_READ: "AUDIT_READ",
  ACTIVITY_CONTENT_WRITE: "ACTIVITY_CONTENT_WRITE",
  ACTIVITY_PUBLISH: "ACTIVITY_PUBLISH",
  ACTIVITY_SESSION_CONTROL: "ACTIVITY_SESSION_CONTROL",
  ACTIVITY_ENROLLMENT_REVIEW: "ACTIVITY_ENROLLMENT_REVIEW",
  CHANNEL_MANAGE: "CHANNEL_MANAGE",
  CHANNEL_ANALYTICS_READ: "CHANNEL_ANALYTICS_READ",
});

export const ADMIN_ACCESS_KEY = Symbol("admin-access");

const CAPABILITY_LABELS = Object.freeze({
  [ADMIN_CAPABILITIES.ADMIN_READ]: "后台读取",
  [ADMIN_CAPABILITIES.AUDIT_READ]: "审计读取",
  [ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE]: "活动内容写入",
  [ADMIN_CAPABILITIES.ACTIVITY_PUBLISH]: "活动受控发布",
  [ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL]: "活动场次管理",
  [ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW]: "活动报名审核",
  [ADMIN_CAPABILITIES.CHANNEL_MANAGE]: "渠道配置管理",
  [ADMIN_CAPABILITIES.CHANNEL_ANALYTICS_READ]: "渠道漏斗读取",
});

const fallbackAccess = Object.freeze({
  capabilitySet: computed(() => new Set()),
  has: () => false,
  any: (capabilities = []) => !capabilities.length,
  disabled: () => true,
  reason: () => "权限信息加载中，请刷新后台身份",
});

export function capabilityLabel(capability) {
  return CAPABILITY_LABELS[capability] || capability || "未知";
}

export function createAdminAccess(profileRef) {
  const capabilitySet = computed(() => new Set(profileRef.value?.capabilities || []));

  function has(capability) {
    if (!capability) return true;
    const profile = profileRef.value;
    if (!profile) return false;
    if (profile.tokenConfigured === false) return true;
    return capabilitySet.value.has(capability);
  }

  function any(capabilities = []) {
    if (!capabilities.length) return true;
    return capabilities.some((capability) => has(capability));
  }

  function reason(capability) {
    if (has(capability)) return "";
    if (!profileRef.value) return "权限信息加载中，请刷新后台身份";
    return `当前角色缺少「${capabilityLabel(capability)}」权限`;
  }

  return {
    capabilitySet,
    has,
    any,
    disabled: (capability) => !has(capability),
    reason,
  };
}

export function useAdminAccess() {
  return inject(ADMIN_ACCESS_KEY, fallbackAccess);
}
