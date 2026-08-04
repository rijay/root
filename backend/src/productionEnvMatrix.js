const { nowISO } = require("./dates");
const { isValidPrivacyContact } = require("./privacyConfig");
const {
  parsePreviousKeyring,
  parseRetiredKeyIds,
} = require("./keyRotationConfiguration");
const { parseScopedJobRouteTokens } = require("./jobRouteToken");
const { calculateV1MysqlConnectionCapacity } = require("./mysqlConnectionCapacity");
const { resolveWechatOpenApiUrl } = require("./wechatOpenApiEndpoint");

const ENV_GROUPS = [
  {
    id: "runtime",
    label: "运行与微信登录",
    ownerRole: "研发",
    required: [
      "WECHAT_APPID",
      "WECHAT_APPSECRET",
      "ROOT_PUBLIC_BASE_URL",
      "ROOT_RELEASE_ID",
      "ROOT_PHONE_HMAC_KEY",
      "ROOT_COMMAND_REQUEST_DIGEST_KEY",
      "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID",
      "ROOT_COMMAND_RESULT_ENCRYPTION_KEY",
      "ROOT_COMMAND_RESULT_KEY_ID",
      "ROOT_INBOX_CONTENT_ENCRYPTION_KEY",
      "ROOT_INBOX_CONTENT_KEY_ID",
    ],
    anyOf: [["ROOT_ADMIN_TOKEN", "ROOT_ADMIN_TOKENS"]],
    anyOfRules: {
      ROOT_ADMIN_TOKEN: "nonblank_secret",
      ROOT_ADMIN_TOKENS: "admin_token_rotation",
    },
    requiredRules: {
      ROOT_RELEASE_ID: "release_id",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: "strong_key",
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "key_id",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "strong_key",
      ROOT_COMMAND_RESULT_KEY_ID: "key_id",
      ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "strong_key",
      ROOT_INBOX_CONTENT_KEY_ID: "key_id",
    },
    optional: [
      "ROOT_ALLOW_OPENID_LOGIN",
      "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON",
      "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON",
      "ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON",
      "ROOT_WECHAT_OPENAPI_BASE_URL",
    ],
    optionalRules: {
      ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: "request_digest_keyring",
      ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: "command_result_keyring",
      ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: "inbox_content_keyring",
      ROOT_WECHAT_OPENAPI_BASE_URL: "wechat_official_openapi_origin",
    },
    action: "配置正式小程序密钥、HTTPS 域名、唯一候选 ROOT_RELEASE_ID、手机号 HMAC 密钥、命令请求摘要密钥、命令结果加密密钥、Inbox 内容加密密钥及各自 key id，并配置后台访问口令；旧 key 只进入相应有界验证/解密 keyring。",
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
    id: "v1_runtime_control",
    label: "v1 Runtime Control Plane",
    ownerRole: "研发/SRE",
    required: [
      "MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED",
      "ROOT_V1_RUNTIME_READY_REQUIRED",
      "MYROOT_V1_RUNTIME_KILL_SWITCH",
      "MYROOT_V1_RUNTIME_OWNER",
      "MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS",
      "MYROOT_V1_RUNTIME_ENVIRONMENT_ID",
      "MYROOT_V1_RUNTIME_TARGET_GENERATION",
      "MYROOT_V1_RUNTIME_CONNECTION_LIMIT",
      "MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE",
      "ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF",
      "ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT",
      "ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET",
      "ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY",
      "ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID",
      "ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY",
      "ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID",
      "ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY",
      "ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID",
      "MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_USERNAME",
      "MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD",
      "MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CURRENT_USER",
      "MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT",
      "MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_USERNAME",
      "MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD",
      "MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CURRENT_USER",
      "MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT",
      "MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_USERNAME",
      "MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_PASSWORD",
      "MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER",
      "MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT",
      "MYROOT_CLOUDRUN_MAX_INSTANCES",
      "MYSQL_SERVER_MAX_CONNECTIONS",
      "MYROOT_MYSQL_CONNECTION_HEADROOM",
      "MYROOT_MYSQL_CAPACITY_EVIDENCE_REF",
      "MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED",
      "MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED",
      "MYROOT_INBOX_WORKER_HARNESS_ENABLED",
      "ROOT_KEY_INVENTORY_READINESS_ENABLED",
      "MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED",
      "ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY",
      "ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID",
      "MYSQL_CONNECTION_LIMIT",
    ],
    requiredRules: {
      MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED: "exact_true",
      ROOT_V1_RUNTIME_READY_REQUIRED: "exact_true",
      MYROOT_V1_RUNTIME_KILL_SWITCH: "exact_disengaged",
      MYROOT_V1_RUNTIME_OWNER: "opaque_ascii",
      MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS: "integer_1_3600",
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "opaque_ascii",
      MYROOT_V1_RUNTIME_TARGET_GENERATION: "opaque_ascii",
      MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "integer_3_64",
      ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "opaque_ascii_128",
      ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: "https_endpoint",
      ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET: "strong_key",
      ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY: "strong_key",
      ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "key_id",
      ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY: "strong_key",
      ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "key_id",
      ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY: "strong_key",
      ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID: "key_id",
      MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_USERNAME: "mysql_role_username",
      MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD: "mysql_role_password",
      MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CURRENT_USER: "mysql_current_user",
      MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT: "integer_1_64",
      MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_USERNAME: "mysql_role_username",
      MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD: "mysql_role_password",
      MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CURRENT_USER: "mysql_current_user",
      MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT: "integer_1_64",
      MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_USERNAME: "mysql_role_username",
      MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_PASSWORD: "mysql_role_password",
      MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER: "mysql_current_user",
      MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT: "integer_1_64",
      MYROOT_CLOUDRUN_MAX_INSTANCES: "integer_1_10000",
      MYSQL_SERVER_MAX_CONNECTIONS: "integer_1_1000000000",
      MYROOT_MYSQL_CONNECTION_HEADROOM: "integer_0_1000000000",
      MYROOT_MYSQL_CAPACITY_EVIDENCE_REF: "opaque_ascii",
      MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED: "exact_true",
      MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED: "exact_true",
      MYROOT_INBOX_WORKER_HARNESS_ENABLED: "exact_true",
      ROOT_KEY_INVENTORY_READINESS_ENABLED: "exact_true",
      MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED: "exact_true",
      ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY: "strong_key",
      ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "key_id",
      MYSQL_CONNECTION_LIMIT: "integer_3_1024",
    },
    requiredValues: {
      MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: ["controlled"],
    },
    anyOf: [["K_REVISION", "ROOT_RELEASE_ARTIFACT_DIGEST"]],
    anyOfRules: {
      K_REVISION: "opaque_ascii_128",
      ROOT_RELEASE_ARTIFACT_DIGEST: "sha256_digest",
    },
    optional: ["ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON"],
    optionalRules: {
      ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: "retired_key_ids",
    },
    action: "在 Candidate 中显式启用 Control Plane、持久 readiness、Orchestration、Bridge、Worker、Key Inventory 与受控告警投递；Registrar、Worker、Inspector 必须使用独立凭据和 pool，并以主池 + orchestration 池 + Registrar/heartbeat + Worker + Inspector、实例上限及运维余量核验数据库总连接预算；正式执行仍须先取得运行授权。",
  },
  {
    id: "store",
    label: "生产数据仓库",
    ownerRole: "研发",
    required: ["ROOT_STORE_ADAPTER", "ROOT_MYSQL_MIGRATION_MODE", "MYSQL_ADDRESS", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"],
    requiredValues: {
      ROOT_STORE_ADAPTER: ["mysql"],
      ROOT_MYSQL_MIGRATION_MODE: ["verify_only"],
    },
    requiredRules: {
      MYSQL_ADDRESS: "mysql_address",
      MYSQL_USERNAME: "opaque_ascii_128",
      MYSQL_PASSWORD: "nonblank_value",
      MYSQL_DATABASE: "opaque_ascii_64",
    },
    optional: [
      "MYSQL_HOST",
      "MYSQL_PORT",
      "ROOT_STORE_FILE",
      "ROOT_SQLITE_FILE",
      "ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE",
    ],
    optionalRules: {
      MYSQL_HOST: "opaque_ascii_255",
      MYSQL_PORT: "integer_1_65535",
    },
    action: "正式环境使用 MySQL Store Adapter，运行时固定 verify_only 并以独立迁移 Adapter 升级 schema；运行时账号只保留数据读写权限，再确认快照、备份和回滚路径。",
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
    anyOfRules: {
      ROOT_CLOUDBASE_ENV_ID: "opaque_ascii_128",
      CLOUDBASE_ENV_ID: "opaque_ascii_128",
      TCB_ENV_ID: "opaque_ascii_128",
    },
    optional: [
      "ROOT_CLOUDBASE_STORE_PROOF",
      "ROOT_PRODUCTION_STORE_DECISION",
    ],
    action: "确认 CloudBase 生产环境、Store 决策、备份计划、回滚计划和发布证明引用。",
  },
  {
    id: "cloudbase_object_storage",
    label: "CloudBase 对象存储",
    ownerRole: "研发",
    required: ["ROOT_CLOUDBASE_STORAGE_TRANSPORT"],
    requiredValues: {
      ROOT_CLOUDBASE_STORAGE_TRANSPORT: ["http", "http_api"],
    },
    anyOf: [
      ["ROOT_CLOUDBASE_ENV_ID", "CLOUDBASE_ENV_ID", "TCB_ENV_ID"],
      ["CLOUDBASE_APIKEY", "ROOT_CLOUDBASE_API_KEY"],
    ],
    anyOfRules: {
      ROOT_CLOUDBASE_ENV_ID: "opaque_ascii_128",
      CLOUDBASE_ENV_ID: "opaque_ascii_128",
      TCB_ENV_ID: "opaque_ascii_128",
    },
    optional: [
      "ROOT_CLOUDBASE_STORAGE_API_BASE_URL",
      "ROOT_CLOUDBASE_STORAGE_TIMEOUT_MS",
    ],
    action: "容器型云托管使用 CloudBase HTTP Interface，并从生产密钥配置注入服务端 API Key；不得把 Key 写入仓库、日志或客户端。",
  },
  {
    id: "cloudbase_jobs",
    label: "CloudBase 定时 Job",
    ownerRole: "研发",
    required: [
      "ROOT_JOB_BASE_URL",
      "ROOT_CLOUDBASE_JOB_INVOCATION_POLICY_EVIDENCE",
      "ROOT_ADMIN_JOB_ROUTE_TOKENS",
      "ROOT_REQUIRE_SCOPED_JOB_TOKENS",
    ],
    requiredValues: {
      ROOT_REQUIRE_SCOPED_JOB_TOKENS: ["true"],
    },
    requiredRules: {
      ROOT_JOB_BASE_URL: "https_url",
      ROOT_CLOUDBASE_JOB_INVOCATION_POLICY_EVIDENCE: "opaque_ascii",
      ROOT_ADMIN_JOB_ROUTE_TOKENS: "job_route_token_rotation",
    },
    optional: [
      "ROOT_JOB_DRY_RUN",
      "ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN",
      "ROOT_V1_RUNTIME_SCHEDULER_TIMEOUT_SECONDS",
      "ROOT_V1_RUNTIME_BRIDGE_LIMIT",
      "ROOT_V1_RUNTIME_RECOVERY_LIMIT",
      "ROOT_V1_RUNTIME_WORKER_LIMIT",
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
    optionalRules: {
      ROOT_JOB_DRY_RUN: "exact_boolean",
      ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN: "exact_boolean",
      ROOT_V1_RUNTIME_SCHEDULER_TIMEOUT_SECONDS: "integer_1_25",
      ROOT_V1_RUNTIME_BRIDGE_LIMIT: "integer_1_100",
      ROOT_V1_RUNTIME_RECOVERY_LIMIT: "integer_1_100",
      ROOT_V1_RUNTIME_WORKER_LIMIT: "integer_1_100",
    },
    action: "在 CloudBase 环境变量或密钥管理中注入 HTTPS Job 域名、可解析的定时任务专用口令轮换配置，并附上仅允许平台 timer 调用函数的策略证据；再配置生命周期结算队列清理阈值、用户生命周期定时导出口径、企微自动触达口径、外部交付通道和签名下载密钥。",
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
      "YOUZAN_AFTER_SALES_FIELD_MAP",
    ],
    action: "确认 Root 会员中心售后原始状态到内部状态的映射。",
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

function isStrongKey(value) {
  const key = String(value || "");
  return Buffer.byteLength(key, "utf8") >= 32
    && Buffer.byteLength(key, "utf8") <= 4096
    && key === key.trim()
    && !key.includes("\u0000")
    && new Set(Array.from(key)).size >= 8;
}

function isPreviousKeyring(value, env, activeKeyIdName) {
  try {
    parsePreviousKeyring(value, {
      activeKeyId: env && env[activeKeyIdName],
      validateSecret: isStrongKey,
    });
    return true;
  } catch {
    return false;
  }
}

function isRetiredKeyIds(value, env) {
  try {
    const retired = parseRetiredKeyIds(value);
    const domains = [
      ["REQUEST_DIGEST", "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID", "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON"],
      ["COMMAND_RESULT", "ROOT_COMMAND_RESULT_KEY_ID", "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON"],
      ["INBOX_CONTENT", "ROOT_INBOX_CONTENT_KEY_ID", "ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON"],
      ["NOTIFICATION_RECEIPT", "ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID", null],
    ];
    for (const [domain, activeKeyIdName, previousKeyringName] of domains) {
      const activeKeyId = env && env[activeKeyIdName];
      const previous = parsePreviousKeyring(
        previousKeyringName && env && Object.prototype.hasOwnProperty.call(env, previousKeyringName)
          ? env[previousKeyringName]
          : undefined,
        { activeKeyId, validateSecret: isStrongKey }
      );
      if (retired[domain].includes(activeKeyId)
        || [...previous.keys()].some((keyId) => retired[domain].includes(keyId))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPersistenceKeyId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value || ""));
}

function isReleaseIdentifier(value) {
  const text = String(value || "");
  return text.length >= 1
    && text.length <= 128
    && text === text.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(text);
}

function isOpaqueAscii(value, maximumLength = 96) {
  const text = String(value || "");
  return text.length >= 1
    && text.length <= maximumLength
    && text === text.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text);
}

function isMysqlAddress(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim()) return false;
  const matched = raw.match(/^([^:]+):(\d+)$/);
  if (!matched || !isOpaqueAscii(matched[1], 255)) return false;
  const port = Number(matched[2]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isNonblankValue(value) {
  const raw = String(value || "");
  return raw.length >= 1
    && raw.length <= 4096
    && Boolean(raw.trim())
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isMysqlRoleUsername(value) {
  const raw = String(value || "");
  return raw.length >= 1
    && raw.length <= 128
    && raw === raw.trim()
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isMysqlRolePassword(value) {
  const raw = String(value || "");
  return raw.length >= 16
    && raw.length <= 4096
    && raw === raw.trim()
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isMysqlCurrentUser(value) {
  const raw = String(value || "");
  return raw.length >= 3
    && raw.length <= 288
    && raw.includes("@")
    && /^[\x21-\x7e]+$/.test(raw);
}

function isHttpsBaseUrl(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim()) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:"
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return false;
  }
}

function isHttpsEndpoint(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim() || raw.length > 2048) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:"
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.hash;
  } catch {
    return false;
  }
}

function isWechatOfficialOpenApiOrigin(value) {
  try {
    const target = resolveWechatOpenApiUrl("/", {
      NODE_ENV: "production",
      ROOT_WECHAT_OPENAPI_BASE_URL: value,
    });
    return target.href === "https://api.weixin.qq.com/";
  } catch {
    return false;
  }
}

function isNonblankSecret(value) {
  const raw = String(value || "");
  return raw.length >= 16
    && raw.length <= 4096
    && raw === raw.trim()
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isJobTokenRotation(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 64 * 1024) return false;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  if (entries.length < 1 || entries.length > 16) return false;
  const tokens = entries.map((item) => (
    typeof item === "string" ? item : item && typeof item === "object" ? item.token : ""
  ));
  return tokens.every(isNonblankSecret) && new Set(tokens).size === tokens.length;
}

function isJobRouteTokenRotation(value) {
  try {
    return parseScopedJobRouteTokens({ ROOT_ADMIN_JOB_ROUTE_TOKENS: value }).configured;
  } catch {
    return false;
  }
}

function isAdminTokenRotation(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 64 * 1024) return false;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  let tokens;
  if (Array.isArray(parsed)) {
    if (parsed.length < 1 || parsed.length > 64) return false;
    // parseAdminTokens accepts only object entries in array form. Keeping this
    // rule identical prevents the readiness matrix from accepting a rotation
    // that the runtime would parse as configured-but-empty.
    tokens = parsed.map((item) => (
      item && typeof item === "object" && !Array.isArray(item) ? item.token : ""
    ));
  } else if (parsed && typeof parsed === "object") {
    const entries = Object.values(parsed);
    if (entries.length < 1 || entries.length > 64) return false;
    tokens = entries.map((item) => (
      typeof item === "string"
        ? item
        : item && typeof item === "object" && !Array.isArray(item)
          ? item.token
          : ""
    ));
  } else {
    return false;
  }
  return tokens.every(isNonblankSecret) && new Set(tokens).size === tokens.length;
}

function envRows(env, names = [], requiredValues = {}, requiredRules = {}) {
  return names.map((name) => {
    const expectedValues = requiredValues[name] || [];
    const rule = requiredRules[name] || "";
    const strictConfiguredRule = [
      "request_digest_keyring",
      "command_result_keyring",
      "inbox_content_keyring",
      "retired_key_ids",
    ].includes(rule);
    const isPresent = present(env, name)
      || (strictConfiguredRule && Boolean(env)
        && Object.prototype.hasOwnProperty.call(env, name));
    const normalized = String(env && env[name] || "").trim().toLowerCase();
    const raw = String(env && env[name] || "");
    const validByRule = rule === "positive_integer"
      ? /^\d+$/.test(normalized) && Number(normalized) > 0
      : rule === "nonnegative_integer"
        ? /^\d+$/.test(normalized)
      : rule === "integer_min_3"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 3
      : rule === "integer_3_64"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 3 && Number(normalized) <= 64
      : rule === "integer_3_1024"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 3 && Number(normalized) <= 1024
      : rule === "integer_1_25"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 25
      : rule === "integer_1_64"
        ? /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= 64
      : rule === "integer_1_100"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 100
      : rule === "integer_1_10000"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 10000
      : rule === "integer_1_65535"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 65535
      : rule === "integer_1_1000000000"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 1000000000
      : rule === "integer_0_1000000000"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 0 && Number(normalized) <= 1000000000
      : rule === "integer_1_3600"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 3600
      : rule === "exact_true"
        ? raw === "true"
      : rule === "exact_boolean"
        ? raw === "true" || raw === "false"
      : rule === "exact_disengaged"
        ? raw === "DISENGAGED"
      : rule === "opaque_ascii"
        ? isOpaqueAscii(raw)
      : rule === "opaque_ascii_64"
        ? isOpaqueAscii(raw, 64)
      : rule === "opaque_ascii_128"
        ? isOpaqueAscii(raw, 128)
      : rule === "opaque_ascii_255"
        ? isOpaqueAscii(raw, 255)
      : rule === "mysql_address"
        ? isMysqlAddress(raw)
      : rule === "nonblank_value"
        ? isNonblankValue(raw)
      : rule === "mysql_role_username"
        ? isMysqlRoleUsername(raw)
      : rule === "mysql_role_password"
        ? isMysqlRolePassword(raw)
      : rule === "mysql_current_user"
        ? isMysqlCurrentUser(raw)
      : rule === "sha256_digest"
        ? /^[0-9a-f]{64}$/.test(raw)
      : rule === "https_url"
        ? isHttpsBaseUrl(raw)
      : rule === "https_endpoint"
        ? isHttpsEndpoint(raw)
      : rule === "wechat_official_openapi_origin"
        ? isWechatOfficialOpenApiOrigin(raw)
      : rule === "privacy_contact"
        ? isValidPrivacyContact(String(env && env[name] || ""))
      : rule === "future_datetime_24h"
        ? Number.isFinite(Date.parse(String(env && env[name] || ""))) && Date.parse(String(env && env[name] || "")) > Date.now() + 24 * 60 * 60 * 1000
      : rule === "min_length_32"
        ? String(env && env[name] || "").length >= 32
      : rule === "strong_key"
        ? isStrongKey(env && env[name])
      : rule === "key_id"
        ? isPersistenceKeyId(env && env[name])
      : rule === "release_id"
        ? isReleaseIdentifier(env && env[name])
      : rule === "request_digest_keyring"
        ? isPreviousKeyring(raw, env, "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID")
      : rule === "command_result_keyring"
        ? isPreviousKeyring(raw, env, "ROOT_COMMAND_RESULT_KEY_ID")
      : rule === "inbox_content_keyring"
        ? isPreviousKeyring(raw, env, "ROOT_INBOX_CONTENT_KEY_ID")
      : rule === "retired_key_ids"
        ? isRetiredKeyIds(raw, env)
        : true;
    return {
      name,
      present: isPresent,
      valid: !isPresent || ((!expectedValues.length || expectedValues.includes(normalized)) && validByRule),
      expectedValues,
      expectedDescription: rule === "positive_integer"
        ? "正整数"
        : rule === "nonnegative_integer" ? "非负整数"
        : rule === "integer_min_3" ? "不小于 3 的整数"
        : rule === "integer_3_64" ? "3 至 64 的整数"
        : rule === "integer_3_1024" ? "3 至 1024 的整数"
        : rule === "integer_1_25" ? "1 至 25 的整数"
        : rule === "integer_1_64" ? "1 至 64 的规范十进制整数"
        : rule === "integer_1_100" ? "1 至 100 的整数"
        : rule === "integer_1_10000" ? "1 至 10000 的整数"
        : rule === "integer_1_65535" ? "1 至 65535 的整数"
        : rule === "integer_1_1000000000" ? "1 至 1000000000 的整数"
        : rule === "integer_0_1000000000" ? "0 至 1000000000 的整数"
        : rule === "integer_1_3600" ? "1 至 3600 的整数"
        : rule === "exact_true" ? "精确字符串 true"
        : rule === "exact_boolean" ? "精确字符串 true 或 false"
        : rule === "exact_disengaged" ? "精确字符串 DISENGAGED"
        : rule === "opaque_ascii" ? "1 至 96 位稳定 ASCII 标识"
        : rule === "opaque_ascii_64" ? "1 至 64 位稳定 ASCII 标识"
        : rule === "opaque_ascii_128" ? "1 至 128 位稳定 ASCII 标识"
        : rule === "opaque_ascii_255" ? "1 至 255 位稳定 ASCII 标识"
        : rule === "mysql_address" ? "host:port（端口为 1 至 65535）"
        : rule === "nonblank_value" ? "非空、无控制字符且不超过 4096 位"
        : rule === "mysql_role_username" ? "1 至 128 位、无首尾空白或控制字符的 MySQL 角色用户名"
        : rule === "mysql_role_password" ? "16 至 4096 位、无首尾空白或控制字符的 MySQL 角色凭据"
        : rule === "mysql_current_user" ? "3 至 288 位、含 @ 且仅含非空白可打印 ASCII 的 CURRENT_USER"
        : rule === "sha256_digest" ? "64 位小写十六进制 SHA-256 摘要"
        : rule === "https_url" ? "无用户信息、查询或片段的 HTTPS origin"
        : rule === "https_endpoint" ? "无用户信息或片段的 HTTPS endpoint"
        : rule === "wechat_official_openapi_origin" ? "精确微信官方 HTTPS origin https://api.weixin.qq.com"
        : rule === "privacy_contact" ? "有效邮箱或 7 至 15 位电话"
        : rule === "future_datetime_24h" ? "至少晚于当前时间24小时的有效时间"
        : rule === "min_length_32" ? "至少 32 个字符"
        : rule === "strong_key" ? "至少 32 UTF-8 字节、无首尾空白且字符多样性不低于 8"
        : rule === "key_id" ? "1 至 64 位字母、数字、点、下划线或连字符"
        : rule === "request_digest_keyring" ? "不超过 8 个非当前请求摘要 key 的有界 JSON 对象"
        : rule === "command_result_keyring" ? "不超过 8 个非当前命令结果 key 的有界 JSON 对象"
        : rule === "inbox_content_keyring" ? "不超过 8 个非当前 Inbox key 的有界 JSON 对象"
        : rule === "retired_key_ids" ? "精确包含 REQUEST_DIGEST、COMMAND_RESULT、INBOX_CONTENT、NOTIFICATION_RECEIPT 四域的有界 JSON 对象"
        : rule === "release_id" ? "1 至 128 位发布标识（字母或数字开头，仅含 . _ : + -）" : "",
    };
  });
}

function anyOfRows(env, groups = [], rules = {}) {
  return groups.map((names) => {
    const presentNames = names.filter((name) => present(env, name));
    const validNames = presentNames.filter((name) => {
      const rule = rules[name] || "";
      if (rule === "nonblank_secret") return isNonblankSecret(env[name]);
      if (rule === "job_route_token_rotation") return isJobRouteTokenRotation(env[name]);
      if (rule === "job_token_rotation") return isJobTokenRotation(env[name]);
      if (rule === "admin_token_rotation") return isAdminTokenRotation(env[name]);
      if (rule === "opaque_ascii_128") return isOpaqueAscii(env[name], 128);
      if (rule === "sha256_digest") return /^[0-9a-f]{64}$/.test(String(env[name] || ""));
      return true;
    });
    const invalidNames = presentNames.filter((name) => !validNames.includes(name));
    return {
      names,
      present: validNames.length > 0 && invalidNames.length === 0,
      presentNames,
      validNames,
      invalidNames,
      missingNames: names.filter((name) => !present(env, name)),
    };
  });
}

function crossGroupMissing(group, env) {
  if (group.id === "cloudbase_jobs") {
    return String(env && env.ROOT_REQUIRE_SCOPED_JOB_TOKENS || "") === "true"
      && !isJobRouteTokenRotation(env && env.ROOT_ADMIN_JOB_ROUTE_TOKENS)
      ? ["ROOT_ADMIN_JOB_ROUTE_TOKENS=每个 exact Job route 的独立轮换 token"]
      : [];
  }
  if (group.id !== "v1_runtime_control") return [];
  const registrarUsername = String(env && env.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_USERNAME || "");
  const workerUsername = String(env && env.MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_USERNAME || "");
  const inspectorUsername = String(env && env.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_USERNAME || "");
  const registrarCurrentUser = String(env && env.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CURRENT_USER || "");
  const workerCurrentUser = String(env && env.MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CURRENT_USER || "");
  const inspectorCurrentUser = String(env && env.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER || "");
  const authorityMissing = [];
  if ([registrarUsername, workerUsername, inspectorUsername].every(Boolean)
    && new Set([registrarUsername, workerUsername, inspectorUsername]).size !== 3) {
    authorityMissing.push("MYROOT_V1_RUNTIME_ALERT_MYSQL_USERNAMES_DISTINCT=required");
  }
  if ([registrarCurrentUser, workerCurrentUser, inspectorCurrentUser].every(Boolean)
    && new Set([registrarCurrentUser, workerCurrentUser, inspectorCurrentUser]).size !== 3) {
    authorityMissing.push("MYROOT_V1_RUNTIME_ALERT_MYSQL_PRINCIPALS_DISTINCT=required");
  }
  const rolePasswords = [
    String(env && env.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD || ""),
    String(env && env.MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD || ""),
    String(env && env.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_PASSWORD || ""),
  ];
  if (rolePasswords.every(Boolean) && new Set(rolePasswords).size !== 3) {
    authorityMissing.push("MYROOT_V1_RUNTIME_ALERT_MYSQL_CREDENTIALS_DISTINCT=required");
  }
  const mainUsername = String(env && env.MYSQL_USERNAME || "");
  if (mainUsername && [registrarUsername, workerUsername, inspectorUsername].includes(mainUsername)) {
    authorityMissing.push("MYROOT_V1_RUNTIME_ALERT_MYSQL_USERNAMES_DISTINCT_FROM_MAIN=required");
  }
  const mainPassword = String(env && env.MYSQL_PASSWORD || "");
  if (mainPassword && rolePasswords.includes(mainPassword)) {
    authorityMissing.push("MYROOT_V1_RUNTIME_ALERT_MYSQL_CREDENTIALS_DISTINCT_FROM_MAIN=required");
  }
  const alertDigestKeyIds = [
    String(env && env.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID || ""),
    String(env && env.ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID || ""),
    String(env && env.ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID || ""),
  ];
  if (alertDigestKeyIds.every(Boolean) && new Set(alertDigestKeyIds).size !== 3) {
    authorityMissing.push("ROOT_V1_RUNTIME_ALERT_DIGEST_KEY_IDS_DISTINCT=required");
  }
  const alertDigestKeys = [
    String(env && env.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY || ""),
    String(env && env.ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY || ""),
    String(env && env.ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY || ""),
  ];
  if (alertDigestKeys.every(Boolean) && new Set(alertDigestKeys).size !== 3) {
    authorityMissing.push("ROOT_V1_RUNTIME_ALERT_DIGEST_KEYS_DISTINCT=required");
  }
  const names = [
    "MYSQL_CONNECTION_LIMIT",
    "MYROOT_V1_RUNTIME_CONNECTION_LIMIT",
    "MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT",
    "MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT",
    "MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT",
    "MYROOT_CLOUDRUN_MAX_INSTANCES",
    "MYSQL_SERVER_MAX_CONNECTIONS",
    "MYROOT_MYSQL_CONNECTION_HEADROOM",
  ];
  const positiveNames = names.filter((name) => name !== "MYROOT_MYSQL_CONNECTION_HEADROOM");
  if (positiveNames.some((name) => !/^[1-9][0-9]*$/.test(String(env && env[name] || "")))
    || !/^(0|[1-9][0-9]*)$/.test(String(env && env.MYROOT_MYSQL_CONNECTION_HEADROOM || ""))) {
    return authorityMissing;
  }
  const server = Number(env.MYSQL_SERVER_MAX_CONNECTIONS);
  if (!Number.isSafeInteger(server)) return authorityMissing;
  let capacity;
  try {
    capacity = calculateV1MysqlConnectionCapacity({
      mainPool: Number(env.MYSQL_CONNECTION_LIMIT),
      orchestrationPool: Number(env.MYROOT_V1_RUNTIME_CONNECTION_LIMIT),
      registrarPool: Number(env.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT),
      registrarHeartbeatPool: 1,
      workerPool: Number(env.MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT),
      inspectorPool: Number(env.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT),
      maximumInstances: Number(env.MYROOT_CLOUDRUN_MAX_INSTANCES),
      headroom: Number(env.MYROOT_MYSQL_CONNECTION_HEADROOM),
    });
  } catch {
    return authorityMissing;
  }
  return capacity.calculatedRequirement <= server
    ? authorityMissing
    : [...authorityMissing, `MYSQL_CONNECTION_CAPACITY_BUDGET=${capacity.calculatedRequirement}<=${server}`];
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
  const anyOf = anyOfRows(env, group.anyOf || [], group.anyOfRules || {});
  const optional = envRows(env, group.optional || [], {}, group.optionalRules || {});
  const missingRequired = required
    .filter((item) => !item.present || !item.valid)
    .map((item) => item.valid ? item.name : `${item.name}=${item.expectedValues[0] || item.expectedDescription}`);
  missingRequired.push(...crossGroupMissing(group, env));
  missingRequired.push(...optional
    .filter((item) => item.present && !item.valid)
    .map((item) => `${item.name}=${item.expectedDescription}`));
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
