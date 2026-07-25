import { computed, inject } from "vue";

export const ADMIN_CAPABILITIES = Object.freeze({
  ADMIN_READ: "ADMIN_READ",
  AUDIT_READ: "AUDIT_READ",
  CONFIG_WRITE: "CONFIG_WRITE",
  REVIEW_RESOLVE: "REVIEW_RESOLVE",
  REWARD_DELIVERY_WRITE: "REWARD_DELIVERY_WRITE",
  SETTLEMENT_EXECUTE: "SETTLEMENT_EXECUTE",
  DATA_EXPORT_APPROVE: "DATA_EXPORT_APPROVE",
  ACTIVITY_CONTENT_WRITE: "ACTIVITY_CONTENT_WRITE",
  ACTIVITY_PUBLISH: "ACTIVITY_PUBLISH",
  ACTIVITY_SESSION_CONTROL: "ACTIVITY_SESSION_CONTROL",
  ACTIVITY_ENROLLMENT_REVIEW: "ACTIVITY_ENROLLMENT_REVIEW",
});

export const ADMIN_ACCESS_KEY = Symbol("admin-access");

const CAPABILITY_LABELS = Object.freeze({
  [ADMIN_CAPABILITIES.ADMIN_READ]: "后台读取",
  [ADMIN_CAPABILITIES.AUDIT_READ]: "审计读取",
  [ADMIN_CAPABILITIES.CONFIG_WRITE]: "运营配置写入",
  [ADMIN_CAPABILITIES.REVIEW_RESOLVE]: "人工复核处理",
  [ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE]: "奖励发放处理",
  [ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE]: "活动结算执行",
  [ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE]: "数据导出审批",
  [ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE]: "活动内容写入",
  [ADMIN_CAPABILITIES.ACTIVITY_PUBLISH]: "活动受控发布",
  [ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL]: "活动场次管理",
  [ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW]: "活动报名审核",
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
