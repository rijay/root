const CUTOVER_ITEMS = [
  {
    id: "wechat_open_platform",
    group: "identity",
    label: "微信开放平台认证与应用绑定",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_WECHAT_OPEN_PLATFORM_CERTIFIED",
    supportingEnv: ["WECHAT_APPID"],
    action: "完成微信开放平台认证，并把 myRoot 会员体验中心与 Root 会员中心绑定到同一开放平台主体。",
  },
  {
    id: "cloudbase_unionid",
    group: "identity",
    label: "CloudBase unionid 真实透传",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_CLOUDBASE_UNIONID_VERIFIED",
    supportingEnv: ["ROOT_PUBLIC_BASE_URL"],
    action: "在真实 CloudBase 请求中验证 x-wx-openid 与 x-wx-unionid，发布记录只保留脱敏预览。",
  },
  {
    id: "root_member_center_appid",
    group: "commerce",
    label: "Root 会员中心 appId 确认",
    ownerRole: "产品/研发",
    proofEnv: "ROOT_CUTOVER_ROOT_MEMBER_CENTER_APPID_CONFIRMED",
    supportingAnyOf: [["ROOT_MEMBER_CENTER_APPID", "YOUZAN_MINIPROGRAM_APPID"]],
    action: "确认有赞商城小程序 Root 会员中心的正式 appId 与 myRoot 跳转配置一致。",
  },
  {
    id: "youzan_live_fields",
    group: "commerce",
    label: "有赞订单/客户/商品字段校准",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_YOUZAN_FIELDS_CALIBRATED",
    supportingEnv: ["YOUZAN_ORDER_LIST_URL", "YOUZAN_CUSTOMER_LIST_URL"],
    action: "用 Root 会员中心真实导出或小批量拉取校准订单、客户、商品和 unionid/手机号字段。",
  },
  {
    id: "youzan_reward_fields",
    group: "commerce",
    label: "有赞券发放与状态字段校准",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_YOUZAN_REWARD_FIELDS_CALIBRATED",
    supportingEnv: ["YOUZAN_COUPON_SEND_URL", "YOUZAN_COUPON_STATUS_URL"],
    action: "确认发券、券状态查询、券码、核销状态和幂等外部引用字段。",
  },
  {
    id: "wework_live_fields",
    group: "operations",
    label: "企微客户联系与标签字段校准",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_WEWORK_FIELDS_CALIBRATED",
    supportingEnv: ["WEWORK_CONTACT_LIST_URL", "WEWORK_TAG_APPLY_URL", "WEWORK_CONTACT_WRITEBACK_URL"],
    action: "确认外部联系人、来源活动、备注、手机号和标签写入字段。",
  },
  {
    id: "cloudbase_jobs_created",
    group: "operations",
    label: "CloudBase 定时触发器创建",
    ownerRole: "研发",
    proofEnv: "ROOT_CUTOVER_CLOUDBASE_JOBS_CREATED",
    supportingEnv: ["ROOT_JOB_BASE_URL"],
    supportingAnyOf: [["ROOT_ADMIN_JOB_TOKEN", "ROOT_ADMIN_JOB_TOKENS"]],
    action: "在 CloudBase 控制台创建 Adapter 重试、运营预警、生命周期结算和生命周期导出相关触发器。",
  },
  {
    id: "external_channels_verified",
    group: "operations",
    label: "外部通道与负责人验收",
    ownerRole: "运营/研发",
    proofEnv: "ROOT_CUTOVER_EXTERNAL_CHANNELS_VERIFIED",
    supportingEnv: ["ROOT_OPERATIONAL_ALERT_WEBHOOK_URL"],
    action: "确认站内预警、外部 Webhook、导出交付模板和负责人路由可被运营接收。",
  },
  {
    id: "export_storage_verified",
    group: "data",
    label: "生命周期导出存储验收",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_EXPORT_STORAGE_VERIFIED",
    supportingAnyOf: [["ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER", "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR", "ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET"]],
    action: "确认生命周期导出文件的对象目录或对象存储、过期清理、签名下载和访问权限。",
  },
  {
    id: "rollback_drill_completed",
    group: "release",
    label: "发布回滚演练完成",
    ownerRole: "研发/运营",
    proofEnv: "ROOT_CUTOVER_ROLLBACK_DRILL_COMPLETED",
    action: "完成 MANUAL_SAMPLE、Adapter rollback、字段快照回滚和运营人工兜底路径演练。",
  },
];

const GROUP_LABELS = {
  identity: "账号身份",
  commerce: "有赞商城",
  operations: "运营触达",
  data: "数据导出",
  release: "发布回滚",
};

function boolEnv(value) {
  return ["1", "true", "yes", "y", "approved", "ready", "done", "verified"].includes(String(value || "").trim().toLowerCase());
}

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function present(env, name) {
  return Boolean(env && env[name]);
}

function envRows(env, names = []) {
  return names.map((name) => ({ name, present: present(env, name) }));
}

function anyOfRows(env, groups = []) {
  return groups.map((names) => ({
    names,
    present: names.some((name) => present(env, name)),
    presentNames: names.filter((name) => present(env, name)),
    missingNames: names.filter((name) => !present(env, name)),
  }));
}

function latestProofFor(item, proofs = []) {
  return proofs.find((proof) => proof && proof.itemId === item.id) || null;
}

function itemMessage(item, proofReady, proofRejected, missingRequired, missingAnyOf) {
  if (proofRejected) return `${item.label} 已被拒绝，需要重新验收后记录 VERIFIED。${item.action}`;
  if (!proofReady) return `缺少 ${item.proofEnv} 生产证明或后台 VERIFIED 证明。${item.action}`;
  const support = [];
  if (missingRequired.length) support.push(`缺少支持变量 ${missingRequired.join(", ")}`);
  if (missingAnyOf.length) {
    support.push(`至少需要其一：${missingAnyOf.map((names) => names.join(" / ")).join("；")}`);
  }
  if (support.length) return `${support.join("；")}。${item.action}`;
  return "生产证明与支持变量已就绪。";
}

function buildCutoverItem(item, env, target, proofs = []) {
  const required = envRows(env, item.supportingEnv || []);
  const anyOf = anyOfRows(env, item.supportingAnyOf || []);
  const missingRequired = required.filter((row) => !row.present).map((row) => row.name);
  const missingAnyOf = anyOf.filter((row) => !row.present).map((row) => row.names);
  const proofRecord = latestProofFor(item, proofs);
  const envProofReady = boolEnv(env && env[item.proofEnv]);
  const recordProofReady = proofRecord && proofRecord.status === "VERIFIED";
  const proofRejected = proofRecord && proofRecord.status === "REJECTED";
  const proofReady = envProofReady || recordProofReady;
  const supportReady = !missingRequired.length && !missingAnyOf.length;
  const status = proofRejected
    ? "BLOCKED"
    : proofReady
    ? supportReady ? "READY" : "NEEDS_REVIEW"
    : target === "production" ? "BLOCKED" : "NEEDS_REVIEW";
  return {
    id: item.id,
    group: item.group,
    groupLabel: GROUP_LABELS[item.group] || item.group,
    label: item.label,
    ownerRole: item.ownerRole,
    proofEnv: item.proofEnv,
    proofReady,
    proofSource: envProofReady ? "ENV" : recordProofReady ? "RECORD" : "NONE",
    proofRecord: proofRecord || null,
    proofRejected: Boolean(proofRejected),
    supportingEnv: required,
    supportingAnyOf: anyOf,
    missingRequired,
    missingAnyOf,
    status,
    action: item.action,
    message: itemMessage(item, proofReady, proofRejected, missingRequired, missingAnyOf),
  };
}

function summarize(items) {
  const blockers = items.filter((item) => item.status === "BLOCKED").length;
  const warnings = items.filter((item) => item.status === "NEEDS_REVIEW").length;
  const ready = items.filter((item) => item.status === "READY").length;
  return {
    requiredProofCount: items.length,
    readyProofCount: items.filter((item) => item.proofReady).length,
    readyCount: ready,
    blockerCount: blockers,
    warningCount: warnings,
    total: items.length,
  };
}

function groupItems(items) {
  return Object.entries(GROUP_LABELS).map(([group, label]) => {
    const rows = items.filter((item) => item.group === group);
    const summary = summarize(rows);
    const status = summary.blockerCount ? "BLOCKED" : summary.warningCount ? "NEEDS_REVIEW" : "READY";
    return {
      group,
      label,
      status,
      summary,
    };
  }).filter((group) => group.summary.total > 0);
}

function buildProductionCutoverReadiness(options = {}) {
  const target = normalizeTarget(options.target);
  const env = options.env || process.env;
  const proofs = Array.isArray(options.proofs) ? options.proofs : [];
  const items = CUTOVER_ITEMS.map((item) => buildCutoverItem(item, env, target, proofs));
  const summary = summarize(items);
  const groups = groupItems(items);
  const blockers = items
    .filter((item) => item.status === "BLOCKED")
    .map((item) => `${item.groupLabel}/${item.label}: ${item.message}`);
  const warnings = items
    .filter((item) => item.status === "NEEDS_REVIEW")
    .map((item) => `${item.groupLabel}/${item.label}: ${item.message}`);
  const status = summary.blockerCount ? "BLOCKED" : summary.warningCount ? "NEEDS_REVIEW" : "READY";
  return {
    status,
    target,
    summary,
    groups,
    items,
    blockers,
    warnings,
  };
}

module.exports = {
  CUTOVER_ITEMS,
  buildProductionCutoverReadiness,
};
