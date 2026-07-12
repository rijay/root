const { nowISO } = require("./dates");
const { isValidPrivacyContact } = require("./privacyConfig");

const ENV_GROUPS = [
  {
    id: "runtime",
    label: "运行与微信登录",
    ownerRole: "研发",
    required: ["WECHAT_APPID", "WECHAT_APPSECRET", "ROOT_PUBLIC_BASE_URL"],
    anyOf: [["ROOT_ADMIN_TOKEN", "ROOT_ADMIN_TOKENS"]],
    optional: ["ROOT_ALLOW_OPENID_LOGIN", "MYROOT_REBUILD_ENABLED"],
    action: "配置正式小程序密钥、HTTPS 域名和后台访问口令。",
  },
  {
    id: "privacy_compliance",
    label: "隐私与敏感信息单独同意",
    ownerRole: "产品/运营/研发",
    required: [
      "ROOT_REQUIRE_HEALTH_CONSENT",
      "ROOT_PRIVACY_CONTROLLER_NAME",
      "ROOT_PRIVACY_CONTACT",
      "ROOT_HEALTH_DATA_RETENTION_DAYS",
      "ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED",
    ],
    requiredValues: {
      ROOT_REQUIRE_HEALTH_CONSENT: ["true", "1"],
      ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: ["true", "1"],
    },
    requiredRules: {
      ROOT_PRIVACY_CONTACT: "privacy_contact",
      ROOT_HEALTH_DATA_RETENTION_DAYS: "positive_integer",
    },
    optional: ["ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT"],
    action: "开启健康类敏感信息单独同意，配置处理者、联系方式和保存天数，并启用可审计的到期脱敏与 CloudBase 图片清理 Job。",
  },
  {
    id: "store",
    label: "生产数据仓库",
    ownerRole: "研发",
    required: ["ROOT_STORE_ADAPTER", "MYSQL_ADDRESS", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"],
    optional: ["ROOT_STORE_FILE", "ROOT_SQLITE_FILE", "ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE"],
    action: "正式环境使用 MySQL Store Adapter，并由运行时确认账号仅具目标 schema 所需权限；再确认快照、备份和回滚路径。",
  },
  {
    id: "cloudbase_store",
    label: "CloudBase Store 决策",
    ownerRole: "研发",
    required: [
      "ROOT_CLOUDBASE_STORE_DECISION",
      "ROOT_CLOUDBASE_STORE_BACKUP_PLAN",
      "ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN",
    ],
    anyOf: [
      ["ROOT_CLOUDBASE_ENV_ID", "CLOUDBASE_ENV_ID", "TCB_ENV_ID"],
      ["ROOT_CLOUDBASE_REGION", "TENCENTCLOUD_REGION"],
    ],
    optional: [
      "ROOT_CLOUDBASE_STORE_PROOF",
      "ROOT_PRODUCTION_STORE_DECISION",
    ],
    action: "确认 CloudBase 生产环境、Store 决策、备份计划、回滚计划和发布证明引用。",
  },
  {
    id: "cloudbase_jobs",
    label: "CloudBase 定时 Job",
    ownerRole: "研发",
    required: ["ROOT_JOB_BASE_URL"],
    anyOf: [["ROOT_ADMIN_JOB_TOKEN", "ROOT_ADMIN_JOB_TOKENS"]],
    optional: [
      "ROOT_ALERT_CAMPAIGN_ID",
      "ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID",
      "ROOT_LIFECYCLE_SETTLEMENT_STALE_MINUTES",
      "ROOT_LIFECYCLE_SETTLEMENT_CANCEL_AFTER_MINUTES",
      "ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL",
      "ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID",
      "ROOT_LIFECYCLE_EXPORT_LIMIT",
      "ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT",
      "ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS",
      "ROOT_LIFECYCLE_EXPORT_SENSITIVITY",
      "ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_ENABLED",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_TARGET",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_SECRET",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_INCLUDE_CSV",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_ENABLED",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS",
      "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET",
      "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED",
      "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS",
      "ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL",
      "ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET",
      "ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED",
      "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR",
      "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER",
      "ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX",
      "ROOT_WEWORK_TOUCH_TASK_TYPES",
      "ROOT_WEWORK_TOUCH_TASK_LIMIT",
      "ROOT_WEWORK_TOUCH_BATCH_SIZE",
      "ROOT_WEWORK_TOUCH_COOLDOWN_HOURS",
      "ROOT_WEWORK_TOUCH_ADAPTER_MODE",
      "ROOT_WEWORK_TOUCH_TEMPLATES",
    ],
    action: "在 CloudBase 环境变量或密钥管理中注入 Job 域名、定时任务专用口令、生命周期结算队列清理阈值、用户生命周期定时导出口径、企微自动触达口径、外部交付通道和签名下载密钥。",
  },
  {
    id: "checkin_reminder_subscription",
    label: "打卡提醒订阅消息",
    ownerRole: "产品/运营/研发",
    required: [
      "ROOT_CHECKIN_REMINDER_ENABLED",
      "ROOT_CHECKIN_REMINDER_TEMPLATE_ID",
      "ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION",
    ],
    requiredValues: {
      ROOT_CHECKIN_REMINDER_ENABLED: ["true", "1"],
    },
    anyOf: [
      ["ROOT_WECHAT_APPID", "WECHAT_APPID"],
      ["ROOT_WECHAT_APPSECRET", "WECHAT_APPSECRET"],
    ],
    optional: [
      "ROOT_CHECKIN_REMINDER_TEMPLATE_TITLE",
      "ROOT_CHECKIN_REMINDER_HOUR",
      "ROOT_CHECKIN_REMINDER_PAGE",
      "ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE",
      "ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON",
      "ROOT_CHECKIN_REMINDER_JOB_LIMIT",
    ],
    action: "开启次日打卡提醒，确认微信小程序订阅消息模板、模板版本、跳转页、发送环境和微信凭证。",
  },
  {
    id: "root_member_center_jump",
    label: "Root 会员中心购买跳转",
    ownerRole: "研发/运营",
    anyOf: [
      ["ROOT_MEMBER_CENTER_APPID", "ROOT_YOUZAN_APP_ID", "YOUZAN_MINIPROGRAM_APPID", "YOUZAN_MINI_APP_ID", "YOUZAN_APP_ID"],
      ["ROOT_MEMBER_CENTER_PRODUCT_PATH", "ROOT_YOUZAN_PRODUCT_PATH", "YOUZAN_MINIPROGRAM_PRODUCT_PATH"],
      ["ROOT_MEMBER_CENTER_ENV_VERSION", "ROOT_YOUZAN_ENV_VERSION", "YOUZAN_ENV_VERSION"],
    ],
    optional: [
      "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_ID",
      "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_TITLE",
      "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_PRICE_TEXT",
      "ROOT_MEMBER_CENTER_DEFAULT_SKU_NAME",
    ],
    action: "确认 myRoot 商品页展示 Root 会员中心商品，购买按钮跳转到 Root 会员中心小程序，并显式配置 appId、商品路径和目标版本。",
  },
  {
    id: "youzan_order",
    label: "有赞订单 Adapter",
    ownerRole: "研发/运营",
    required: [
      "YOUZAN_CLIENT_ID",
      "YOUZAN_GRANT_ID",
      "YOUZAN_ACCESS_TOKEN",
      "YOUZAN_ACCESS_TOKEN_EXPIRES_AT",
      "YOUZAN_TOKEN_MANAGEMENT_MODE",
      "YOUZAN_TOKEN_ROTATION_OWNER",
      "YOUZAN_ORDER_LIST_URL",
    ],
    requiredValues: {
      YOUZAN_TOKEN_MANAGEMENT_MODE: ["static_rotation"],
    },
    requiredRules: {
      YOUZAN_ACCESS_TOKEN_EXPIRES_AT: "future_datetime_24h",
    },
    optional: [
      "YOUZAN_TOKEN_MIN_REMAINING_MINUTES",
      "YOUZAN_ORDER_LIST_DATA_PATH",
      "YOUZAN_ORDER_LIST_CURSOR_PATH",
      "YOUZAN_ORDER_LIST_HAS_MORE_PATH",
      "YOUZAN_ORDER_FIELD_MAP",
    ],
    action: "确认 Root 会员中心订单列表 URL、店铺 grant_id、集中 token 轮换负责人、到期时间、游标和字段映射。",
  },
  {
    id: "order_after_sales",
    label: "订单售后状态映射",
    ownerRole: "研发/运营",
    optional: [
      "ROOT_AFTER_SALES_STATUS_MAP",
      "ROOT_AFTER_SALES_RECOVERY_STATUSES",
      "ROOT_AFTER_SALES_FOLLOW_STATUSES",
      "YOUZAN_AFTER_SALES_FIELD_MAP",
    ],
    action: "确认 Root 会员中心售后原始状态到内部状态的映射、触发奖励追回的状态和需要人工跟进的状态。",
    optionalOnly: true,
  },
  {
    id: "youzan_customer",
    label: "有赞客户 Adapter",
    ownerRole: "研发/运营",
    required: ["YOUZAN_CUSTOMER_LIST_URL", "YOUZAN_USER_QUERY_URL", "ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED"],
    requiredValues: {
      ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED: ["true", "1"],
    },
    anyOf: [["YOUZAN_CUSTOMER_ACCESS_TOKEN", "YOUZAN_ACCESS_TOKEN"]],
    optional: [
      "YOUZAN_CUSTOMER_LIST_DATA_PATH",
      "YOUZAN_CUSTOMER_LIST_CURSOR_PATH",
      "YOUZAN_CUSTOMER_LIST_HAS_MORE_PATH",
      "YOUZAN_CUSTOMER_FIELD_MAP",
      "YOUZAN_USER_QUERY_ACCESS_TOKEN",
      "YOUZAN_USER_QUERY_METHOD",
      "YOUZAN_USER_QUERY_ACCESS_TOKEN_LOCATION",
      "YOUZAN_USER_QUERY_ACCESS_TOKEN_PARAM",
      "YOUZAN_USER_QUERY_RESULT_TYPES",
      "YOUZAN_USER_QUERY_EXTRA_PARAMS",
      "ROOT_YOUZAN_IDENTITY_RECONCILE_BATCH_SIZE",
      "ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS",
    ],
    action: "确认有赞客户镜像、User Query URL、token 托管策略和 UnionID 到 yz_open_id 小批量对账开关。",
  },
  {
    id: "youzan_coupon",
    label: "有赞优惠券发放与状态",
    ownerRole: "研发/运营",
    required: ["YOUZAN_COUPON_SEND_URL", "YOUZAN_COUPON_STATUS_URL"],
    anyOf: [["YOUZAN_COUPON_ACCESS_TOKEN", "YOUZAN_ACCESS_TOKEN"]],
    optional: [
      "YOUZAN_COUPON_STATUS_ACCESS_TOKEN",
      "YOUZAN_COUPON_RESULT_FIELD_MAP",
      "YOUZAN_COUPON_STATUS_FIELD_MAP",
      "YOUZAN_COUPON_SEND_METHOD",
      "YOUZAN_COUPON_STATUS_METHOD",
    ],
    action: "确认发券、券状态查询 URL、token、券码路径和状态枚举。",
  },
  {
    id: "fulfillment",
    label: "物流状态 Adapter",
    ownerRole: "研发/运营",
    required: ["ROOT_FULFILLMENT_LIST_URL", "ROOT_FULFILLMENT_SECRET"],
    optional: [
      "ROOT_FULFILLMENT_LIST_DATA_PATH",
      "ROOT_FULFILLMENT_LIST_CURSOR_PATH",
      "ROOT_FULFILLMENT_LIST_HAS_MORE_PATH",
      "ROOT_FULFILLMENT_FIELD_MAP",
    ],
    action: "确认物流来源 URL、密钥、签收/异常件字段和游标口径。",
  },
  {
    id: "wework_contact",
    label: "企业微信线索 Adapter",
    ownerRole: "研发/运营",
    required: ["WEWORK_CORP_ID", "WEWORK_CONTACT_LIST_URL"],
    anyOf: [["WEWORK_CONTACT_SECRET", "WEWORK_CONTACT_ACCESS_TOKEN", "WEWORK_ACCESS_TOKEN"]],
    optional: [
      "WEWORK_CONTACT_LIST_DATA_PATH",
      "WEWORK_CONTACT_LIST_CURSOR_PATH",
      "WEWORK_CONTACT_LIST_HAS_MORE_PATH",
      "WEWORK_CONTACT_FIELD_MAP",
      "WEWORK_CONTACT_USERIDS",
      "WEWORK_TOKEN_URL",
    ],
    action: "确认企业微信客户联系凭证、外部联系人 ID、备注名、手机号和来源活动字段。",
  },
  {
    id: "wework_tag",
    label: "企业微信标签 Adapter",
    ownerRole: "研发/运营",
    required: ["WEWORK_TAG_APPLY_URL", "WEWORK_CORP_ID"],
    anyOf: [["WEWORK_TAG_ACCESS_TOKEN", "WEWORK_ACCESS_TOKEN", "WEWORK_CONTACT_ACCESS_TOKEN", "WEWORK_CONTACT_SECRET"]],
    optional: [
      "WEWORK_TAG_DEFAULT_ID",
      "WEWORK_TAG_USERID",
      "WEWORK_TAG_RESULT_FIELD_MAP",
      "WEWORK_TAG_APPLY_METHOD",
      "WEWORK_TAG_APPLY_EXTRA_PARAMS",
    ],
    action: "确认标签写入 URL、token、默认标签 ID 和外部联系人 ID 来源。",
  },
  {
    id: "consultation_advisors",
    label: "咨询顾问分配",
    ownerRole: "运营",
    optional: [
      "ROOT_CONSULTATION_ADVISORS",
    ],
    action: "若启用自动分配，配置顾问候选池，格式可为 advisor-a:张三,advisor-b:李四。",
    optionalOnly: true,
  },
  {
    id: "consultation_sla",
    label: "咨询 SLA",
    ownerRole: "运营",
    optional: [
      "ROOT_CONSULTATION_SLA_MINUTES",
      "ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES",
      "ROOT_CONSULTATION_SLA_ESCALATION_RULES",
    ],
    action: "按运营承诺配置咨询跟进 SLA 分钟数、即将超时提醒窗口和升级规则；不配置时默认 120 分钟 SLA 与 0/60/120 分钟升级链。",
    optionalOnly: true,
  },
  {
    id: "manual_review_explanation",
    label: "复核解释模板",
    ownerRole: "运营",
    optional: [
      "ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES",
    ],
    action: "按复核类型配置用户可见解释、所需证据和运营处理指引；不配置时使用默认模板。",
    optionalOnly: true,
  },
  {
    id: "wework_touch",
    label: "企业微信自动触达 Adapter",
    ownerRole: "研发/运营",
    optional: [
      "WEWORK_TOUCH_SEND_URL",
      "WEWORK_TOUCH_ACCESS_TOKEN",
      "WEWORK_TOUCH_SEND_METHOD",
      "WEWORK_TOUCH_EXTRA_PARAMS",
      "WEWORK_TOUCH_RESULT_FIELD_MAP",
    ],
    action: "确认自动企微触达 URL、token、发送方法、附加参数和回执字段；未配置时只保留本地队列、dry-run 和人工确认模式。",
    optionalOnly: true,
  },
  {
    id: "wework_contact_writeback",
    label: "企业微信联系回写 Adapter",
    ownerRole: "研发/运营",
    optional: [
      "WEWORK_CONTACT_WRITEBACK_URL",
      "WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN",
      "WEWORK_CONTACT_WRITEBACK_METHOD",
      "WEWORK_CONTACT_WRITEBACK_USERID",
      "WEWORK_CONTACT_WRITEBACK_EXTRA_PARAMS",
      "WEWORK_CONTACT_WRITEBACK_RESULT_FIELD_MAP",
    ],
    action: "确认咨询跟进结果写回企微的 URL、token、外部联系人 ID 和外部回执字段。",
  },
  {
    id: "alert_webhook",
    label: "外部预警通道",
    ownerRole: "研发/运营",
    optional: [
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_URL",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_TIMEOUT_MS",
    ],
    action: "若发布期开启外部推送，配置企微/钉钉/短信 Webhook URL、签名密钥、通道、模板和超时；未配置 URL 时仅保留站内通知落账。",
    optionalOnly: true,
  },
];

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function present(env, name) {
  return Boolean(env && env[name]);
}

function envRows(env, names = [], requiredValues = {}, requiredRules = {}) {
  return names.map((name) => {
    const isPresent = present(env, name);
    const expectedValues = requiredValues[name] || [];
    const rule = requiredRules[name] || "";
    const normalized = String(env && env[name] || "").trim().toLowerCase();
    const validByRule = rule === "positive_integer"
      ? /^\d+$/.test(normalized) && Number(normalized) > 0
      : rule === "privacy_contact"
        ? isValidPrivacyContact(String(env && env[name] || ""))
      : rule === "future_datetime_24h"
        ? Number.isFinite(Date.parse(String(env && env[name] || ""))) && Date.parse(String(env && env[name] || "")) > Date.now() + 24 * 60 * 60 * 1000
        : true;
    return {
      name,
      present: isPresent,
      valid: !isPresent || ((!expectedValues.length || expectedValues.includes(normalized)) && validByRule),
      expectedValues,
      expectedDescription: rule === "positive_integer"
        ? "正整数"
        : rule === "privacy_contact" ? "有效邮箱或 7 至 15 位电话"
        : rule === "future_datetime_24h" ? "至少晚于当前时间24小时的有效时间" : "",
    };
  });
}

function anyOfRows(env, groups = []) {
  return groups.map((names) => ({
    names,
    present: names.some((name) => present(env, name)),
    presentNames: names.filter((name) => present(env, name)),
    missingNames: names.filter((name) => !present(env, name)),
  }));
}

function groupStatus(group, target, missingRequired, missingAnyOf) {
  if (group.optionalOnly) return "OPTIONAL";
  if (!missingRequired.length && !missingAnyOf.length) return "PASS";
  return target === "production" ? "BLOCKER" : "WARNING";
}

function groupMessage(group, missingRequired, missingAnyOf) {
  if (group.optionalOnly) return group.action;
  const parts = [];
  if (missingRequired.length) parts.push(`缺少 ${missingRequired.join(", ")}`);
  if (missingAnyOf.length) parts.push(`至少需要其一：${missingAnyOf.map((item) => item.names.join(" / ")).join("；")}`);
  return parts.length ? `${parts.join("；")}。${group.action}` : "必要环境变量已配置。";
}

function buildGroup(group, env, target) {
  const required = envRows(env, group.required || [], group.requiredValues || {}, group.requiredRules || {});
  const anyOf = anyOfRows(env, group.anyOf || []);
  const optional = envRows(env, group.optional || []);
  const missingRequired = required
    .filter((item) => !item.present || !item.valid)
    .map((item) => item.valid ? item.name : `${item.name}=${item.expectedValues[0] || item.expectedDescription}`);
  const missingAnyOf = anyOf.filter((item) => !item.present);
  const status = groupStatus(group, target, missingRequired, missingAnyOf);
  return {
    id: group.id,
    label: group.label,
    ownerRole: group.ownerRole,
    status,
    message: groupMessage(group, missingRequired, missingAnyOf),
    required,
    anyOf,
    optional,
    missingRequired,
    missingAnyOf: missingAnyOf.map((item) => item.names),
    action: group.action,
  };
}

function summarize(groups) {
  const blockers = groups.filter((item) => item.status === "BLOCKER").length;
  const warnings = groups.filter((item) => item.status === "WARNING").length;
  const passed = groups.filter((item) => item.status === "PASS").length;
  const optional = groups.filter((item) => item.status === "OPTIONAL").length;
  return { blockers, warnings, passed, optional, total: groups.length };
}

function statusFromSummary(summary) {
  if (summary.blockers) return "BLOCKED";
  if (summary.warnings) return "NEEDS_REVIEW";
  return "READY";
}

function flattenMissingEnv(groups) {
  const names = [];
  for (const group of groups) {
    group.missingRequired.forEach((name) => names.push({ groupId: group.id, groupLabel: group.label, name, kind: "required" }));
    group.missingAnyOf.forEach((set) => names.push({
      groupId: group.id,
      groupLabel: group.label,
      name: set.join(" / "),
      kind: "anyOf",
    }));
  }
  return names;
}

function buildProductionEnvMatrix(env = process.env, options = {}) {
  const target = normalizeTarget(options.target);
  const groups = ENV_GROUPS.map((group) => buildGroup(group, env, target));
  const summary = summarize(groups);
  return {
    title: "ROOT 生产环境变量矩阵",
    target,
    status: statusFromSummary(summary),
    generatedAt: nowISO(),
    summary,
    groups,
    missingEnv: flattenMissingEnv(groups).filter((item) => {
      const group = groups.find((entry) => entry.id === item.groupId);
      return group && group.status !== "OPTIONAL";
    }),
    sequence: [
      "先配置运行、数据仓库、CloudBase Store 决策和 CloudBase Job 环境变量。",
      "再逐个启用有赞、物流、企微真实 Adapter，并保留 MANUAL_SAMPLE 回退。",
      "外部预警通道未配置时不阻塞上线，但 execute 前必须确认站内通知与负责人路由。",
    ],
  };
}

module.exports = {
  ENV_GROUPS,
  buildProductionEnvMatrix,
};
