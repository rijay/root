#!/usr/bin/env node

const DEFAULT_CAMPAIGN_ID = "ROOT_7D_RESET";
const DEFAULT_BASE_URL = "${ROOT_JOB_BASE_URL}";
const REQUIRED_ENV = ["ROOT_JOB_BASE_URL", "ROOT_ADMIN_JOB_TOKEN"];

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveBaseUrl(env = process.env, explicitBaseUrl = "") {
  return normalizeBaseUrl(
    explicitBaseUrl ||
      env.ROOT_JOB_BASE_URL ||
      env.ROOT_CALIBRATION_BASE_URL ||
      env.ROOT_PUBLIC_BASE_URL ||
      "",
  );
}

function parseArgs(argv, env = process.env) {
  const args = {
    baseUrl: resolveBaseUrl(env),
    campaignId: env.ROOT_ALERT_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID,
    lifecycleCampaignId: env.ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID,
    lifecycleExportCampaignId: env.ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID,
    json: false,
    strict: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = normalizeBaseUrl(argv[index += 1] || args.baseUrl);
    else if (item === "--campaign" || item === "--campaign-id") args.campaignId = String(argv[index += 1] || args.campaignId).trim();
    else if (item === "--lifecycle-campaign" || item === "--lifecycle-campaign-id") args.lifecycleCampaignId = String(argv[index += 1] || args.lifecycleCampaignId).trim();
    else if (item === "--lifecycle-export-campaign" || item === "--lifecycle-export-campaign-id") args.lifecycleExportCampaignId = String(argv[index += 1] || args.lifecycleExportCampaignId).trim();
    else if (item === "--json") args.json = true;
    else if (item === "--strict") args.strict = true;
  }
  return args;
}

function buildCloudbaseJobManifest(options = {}) {
  const baseUrl = resolveBaseUrl(options.env, options.baseUrl) || DEFAULT_BASE_URL;
  const campaignId = options.campaignId || (options.env && options.env.ROOT_ALERT_CAMPAIGN_ID) || DEFAULT_CAMPAIGN_ID;
  const lifecycleCampaignId = options.lifecycleCampaignId ||
    (options.env && options.env.ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID) ||
    DEFAULT_CAMPAIGN_ID;
  const lifecycleExportCampaignId = options.lifecycleExportCampaignId ||
    (options.env && options.env.ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID) ||
    DEFAULT_CAMPAIGN_ID;
  return {
    version: 1,
    title: "ROOT CloudBase Scheduled Jobs",
    environment: {
      baseUrl,
      requiredEnv: REQUIRED_ENV,
      optionalEnv: [
        "ROOT_JOB_ROUTE_QUERY",
        "ROOT_ALERT_CAMPAIGN_ID",
        "ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID",
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
        "ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED",
        "ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT",
        "ROOT_PRIVACY_CONTROLLER_NAME",
        "ROOT_PRIVACY_CONTACT",
        "ROOT_CHECKIN_REMINDER_TEMPLATE_ID",
        "ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION",
        "ROOT_CHECKIN_REMINDER_TEMPLATE_TITLE",
        "ROOT_CHECKIN_REMINDER_HOUR",
        "ROOT_CHECKIN_REMINDER_PAGE",
        "ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE",
        "ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON",
        "ROOT_CHECKIN_REMINDER_JOB_LIMIT",
        "ROOT_WECHAT_APPID",
        "ROOT_WECHAT_APPSECRET",
        "ROOT_WEWORK_TOUCH_TASK_TYPES",
        "ROOT_WEWORK_TOUCH_TASK_LIMIT",
        "ROOT_WEWORK_TOUCH_BATCH_SIZE",
        "ROOT_WEWORK_TOUCH_COOLDOWN_HOURS",
        "ROOT_WEWORK_TOUCH_ADAPTER_MODE",
        "ROOT_WEWORK_TOUCH_TEMPLATES",
        "ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED",
        "ROOT_YOUZAN_IDENTITY_RECONCILE_BATCH_SIZE",
        "ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS",
        "YOUZAN_USER_QUERY_URL",
        "YOUZAN_USER_QUERY_ACCESS_TOKEN",
        "YOUZAN_USER_QUERY_METHOD",
        "YOUZAN_USER_QUERY_ACCESS_TOKEN_LOCATION",
        "YOUZAN_USER_QUERY_ACCESS_TOKEN_PARAM",
        "YOUZAN_USER_QUERY_RESULT_TYPES",
        "YOUZAN_USER_QUERY_EXTRA_PARAMS",
        "WEWORK_TOUCH_SEND_URL",
        "WEWORK_TOUCH_ACCESS_TOKEN",
        "WEWORK_TOUCH_SEND_METHOD",
        "WEWORK_TOUCH_EXTRA_PARAMS",
        "WEWORK_TOUCH_RESULT_FIELD_MAP",
      ],
      tokenHeader: "X-Admin-Token",
      requestIdPolicy: "execute 模式必须使用稳定 request_id；runner 未显式传入时按分钟生成默认 request_id。",
    },
    jobs: [
      {
        id: "adapter_retry_due",
        title: "Adapter 到期自动重试",
        schedule: {
          cron: "*/10 * * * *",
          timezone: "Asia/Shanghai",
          description: "每 10 分钟扫描一次 RETRYABLE 且已到期的 Adapter 运行。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/adapter-retry-due",
          body: {
            dryRun: false,
            batchSize: 5,
            maxAttempts: 5,
            requestId: "adapter-retry-due-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run adapter-retry --prefix backend -- --dry-run --batch-size 5 --max-attempts 5`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run adapter-retry --prefix backend -- --execute --batch-size 5 --max-attempts 5`,
        requiredEnv: REQUIRED_ENV,
        safeguards: [
          "默认批量 5 条，避免外部平台临时异常时放大重试压力。",
          "非 0 退出码会暴露 HTTP 调用失败或重试失败，CloudBase/cron 可据此告警。",
          "执行链路复用 Adapter Retry Scheduler Module、后台鉴权、幂等和审计。",
        ],
      },
      {
        id: "operational_alerts",
        title: "运营预警扫描与通知",
        schedule: {
          cron: "*/30 * * * *",
          timezone: "Asia/Shanghai",
          description: "每 30 分钟扫描一次运营漏斗、阈值和 Adapter 重试耗尽预警。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/operational-alerts",
          body: {
            campaignId,
            dryRun: false,
            requestId: "operational-alert-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_ALERT_CAMPAIGN_ID=${campaignId} npm run operational-alerts --prefix backend -- --dry-run`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_ALERT_CAMPAIGN_ID=${campaignId} npm run operational-alerts --prefix backend -- --execute`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: ["ROOT_ALERT_CAMPAIGN_ID"],
        safeguards: [
          "默认 campaign 使用 ROOT_7D_RESET，可用 ROOT_ALERT_CAMPAIGN_ID 覆盖。",
          "预警规则自身带冷却时间，避免同一异常在短时间内重复通知。",
          "执行链路复用 Operational Alerts Module、负责人路由、通知落账、幂等和审计。",
        ],
      },
      {
        id: "checkin_reminders",
        title: "次日打卡提醒订阅消息发送",
        schedule: {
          cron: "*/10 * * * *",
          timezone: "Asia/Shanghai",
          description: "每 10 分钟扫描一次已到期的次日打卡提醒任务。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/checkin-reminders",
          body: {
            dryRun: false,
            limit: 50,
            requestId: "checkin-reminders-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run checkin-reminders --prefix backend -- --dry-run --limit 50`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run checkin-reminders --prefix backend -- --execute --limit 50`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_CHECKIN_REMINDER_TEMPLATE_ID",
          "ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION",
          "ROOT_CHECKIN_REMINDER_TEMPLATE_TITLE",
          "ROOT_CHECKIN_REMINDER_HOUR",
          "ROOT_CHECKIN_REMINDER_PAGE",
          "ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE",
          "ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON",
          "ROOT_CHECKIN_REMINDER_JOB_LIMIT",
          "ROOT_WECHAT_APPID",
          "ROOT_WECHAT_APPSECRET",
        ],
        safeguards: [
          "只发送已由用户接受订阅的模板版本，拒绝或禁止订阅会跳过。",
          "发送前检查提醒日期是否已打卡，已完成用户不再发送。",
          "每轮默认最多 50 条，适合路演内测并发，避免模板消息瞬时放大。",
          "模板 ID、字段映射和版本均由环境变量控制，版本提升后旧任务仍按旧快照发送或跳过。",
        ],
      },
      {
        id: "wework_touch_due",
        title: "企微自动触达到期执行",
        schedule: {
          cron: "*/10 * * * *",
          timezone: "Asia/Shanghai",
          description: "每 10 分钟扫描一次待跟进运营任务，生成并推进企微触达队列。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/wework-touch-due",
          body: {
            dryRun: false,
            limit: 50,
            batchSize: 20,
            cooldownHours: 24,
            adapterMode: "AUTO",
            requestId: "wework-touch-due-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run wework-touch --prefix backend -- --dry-run --limit 50 --batch-size 20 --cooldown-hours 24`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run wework-touch --prefix backend -- --execute --limit 50 --batch-size 20 --cooldown-hours 24 --adapter-mode AUTO`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_WEWORK_TOUCH_TASK_TYPES",
          "ROOT_WEWORK_TOUCH_TASK_LIMIT",
          "ROOT_WEWORK_TOUCH_BATCH_SIZE",
          "ROOT_WEWORK_TOUCH_COOLDOWN_HOURS",
          "ROOT_WEWORK_TOUCH_ADAPTER_MODE",
          "ROOT_WEWORK_TOUCH_TEMPLATES",
          "WEWORK_TOUCH_SEND_URL",
          "WEWORK_TOUCH_ACCESS_TOKEN",
          "WEWORK_TOUCH_SEND_METHOD",
          "WEWORK_TOUCH_EXTRA_PARAMS",
          "WEWORK_TOUCH_RESULT_FIELD_MAP",
        ],
        safeguards: [
          "默认只扫描 OPEN 待办，不创建新的咨询或结算事实。",
          "同一用户同类任务默认 24 小时冷却，避免活动现场重复触达。",
          "缺少 externalContactId 的候选会进入 BLOCKED Job，供运营补链后重跑。",
          "真实企微发送需配置 WEWORK_TOUCH_SEND_URL 和 token；未配置时可 dry-run 或用 MANUAL 模式本地确认。",
        ],
      },
      {
        id: "lifecycle_settlement_due",
        title: "生命周期结算队列自动执行",
        schedule: {
          cron: "*/15 * * * *",
          timezone: "Asia/Shanghai",
          description: "每 15 分钟推进一次已创建的生命周期结算队列。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/lifecycle-settlement-due",
          body: {
            campaignId: lifecycleCampaignId,
            dryRun: false,
            batchSize: 20,
            jobLimit: 3,
            requestId: "lifecycle-settlement-due-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID=${lifecycleCampaignId} npm run lifecycle-settlement --prefix backend -- --dry-run --batch-size 20 --job-limit 3`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID=${lifecycleCampaignId} npm run lifecycle-settlement --prefix backend -- --execute --batch-size 20 --job-limit 3`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: ["ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID"],
        safeguards: [
          "只推进已由运营确认创建的队列，不自动按筛选条件创建新队列。",
          "默认每个队列每批 20 人、每轮最多 3 个队列，贴合路演并发并避免集中结算压力。",
          "失败队列不会自动重试失败项，需运营在生命周期页确认后放回队列。",
        ],
      },
      {
        id: "lifecycle_settlement_cleanup",
        title: "生命周期结算队列超时清理",
        schedule: {
          cron: "5 * * * *",
          timezone: "Asia/Shanghai",
          description: "每小时扫描一次长时间未推进的生命周期结算队列。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/lifecycle-settlement-cleanup",
          body: {
            campaignId: lifecycleCampaignId,
            dryRun: false,
            staleMinutes: 120,
            cancelAfterMinutes: 1440,
            allowCancel: false,
            jobLimit: 20,
            requestId: "lifecycle-settlement-cleanup-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID=${lifecycleCampaignId} npm run lifecycle-settlement-cleanup --prefix backend -- --dry-run --stale-minutes 120 --cancel-after-minutes 1440 --job-limit 20`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID=${lifecycleCampaignId} npm run lifecycle-settlement-cleanup --prefix backend -- --execute --stale-minutes 120 --cancel-after-minutes 1440 --job-limit 20`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID",
          "ROOT_LIFECYCLE_SETTLEMENT_STALE_MINUTES",
          "ROOT_LIFECYCLE_SETTLEMENT_CANCEL_AFTER_MINUTES",
          "ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL",
        ],
        safeguards: [
          "默认只重置长时间卡在 RUNNING 的队列为 QUEUED，不取消运营可能刻意暂停的队列。",
          "只有显式允许 allowCancel 且超过硬阈值时才取消队列。",
          "所有清理动作写入审计，并保留 cleanup 元信息供队列抽屉排查。",
        ],
      },
      {
        id: "lifecycle_users_export",
        title: "用户生命周期每日定时导出",
        schedule: {
          cron: "30 9 * * *",
          timezone: "Asia/Shanghai",
          description: "每天上午生成一次生命周期用户筛选 CSV，供运营复盘和活动结算前检查。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/lifecycle-users-export",
          body: {
            dryRun: false,
            filters: {
              campaignId: lifecycleExportCampaignId,
              limit: 200,
            },
            retentionDays: 7,
            sensitivity: "MASKED",
            approvalRequired: false,
            deliveryEnabled: false,
            deliveryChannel: "NONE",
            requestId: "lifecycle-users-export-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID=${lifecycleExportCampaignId} ROOT_LIFECYCLE_EXPORT_SENSITIVITY=MASKED npm run lifecycle-users-export --prefix backend -- --dry-run --limit 200 --sensitivity MASKED`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID=${lifecycleExportCampaignId} ROOT_LIFECYCLE_EXPORT_SENSITIVITY=MASKED npm run lifecycle-users-export --prefix backend -- --execute --limit 200 --retention-days 7 --sensitivity MASKED`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID",
          "ROOT_LIFECYCLE_EXPORT_LIMIT",
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
          "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX",
        ],
        safeguards: [
          "默认最多导出 200 人，贴合路演并发与运营巡检场景，避免把后台快照当成离线数仓。",
          "execute 模式必须带 request_id，CloudBase 重试不会生成重复记录。",
          "默认使用 MASKED 字段策略；只有 admin 角色显式请求 RAW 时才输出原始手机号、UnionID 和 OpenID。",
          "可用 ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED 要求定时导出下载先经过审批。",
          "默认不外部交付；只有显式设置 ROOT_LIFECYCLE_EXPORT_DELIVERY_ENABLED 与交付通道后才记录交付意图。",
          "Webhook 交付会带导出 ID、request_id、签名头、通道/模板和响应摘要；可用 ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET 生成短期签名下载链接，给邮件、企微或对象存储投递 Adapter 复用。",
          "外部交付必须复用导出审批状态；RAW 或待审批记录不能绕过审批直接交付。",
          "可用 ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER=CLOUDBASE 启用 CloudBase 云存储 Adapter；本地测试仍可使用 ROOT_LIFECYCLE_EXPORT_OBJECT_DIR。",
          "导出记录默认保留 7 天，对象存储或提醒 Adapter 只接同一导出 Interface。",
        ],
      },
      {
        id: "lifecycle_user_exports_delivery_retry",
        title: "用户生命周期导出交付到期重试",
        schedule: {
          cron: "*/20 * * * *",
          timezone: "Asia/Shanghai",
          description: "每 20 分钟扫描一次已到期的用户生命周期导出外部交付重试。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/lifecycle-user-exports-delivery-retry",
          body: {
            dryRun: false,
            limit: 20,
            deliveryRetryEnabled: true,
            deliveryMaxAttempts: 3,
            deliveryRetryDelaySeconds: 300,
            requestId: "lifecycle-user-exports-delivery-retry-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run lifecycle-user-exports-delivery-retry --prefix backend -- --dry-run --batch-size 20 --max-attempts 3`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run lifecycle-user-exports-delivery-retry --prefix backend -- --execute --batch-size 20 --max-attempts 3 --retry-delay-seconds 300`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_SECRET",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS",
          "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS",
          "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET",
          "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED",
          "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX",
        ],
        safeguards: [
          "只处理已有导出交付记录，不自动创建新导出。",
          "默认每轮最多 20 条、最大 3 次尝试，避免外部通道异常时放大推送压力。",
          "达到最大尝试次数会进入 DEAD_LETTER，并保留最后错误和死信原因。",
          "execute 模式必须带 request_id，CloudBase 重试不会重复推进同一批结果。",
        ],
      },
      {
        id: "lifecycle_user_exports_cleanup",
        title: "用户生命周期导出过期清理",
        schedule: {
          cron: "45 3 * * *",
          timezone: "Asia/Shanghai",
          description: "每天凌晨清理已过保留期的用户生命周期导出记录和对象文件。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/lifecycle-user-exports-cleanup",
          body: {
            dryRun: false,
            limit: 50,
            objectCleanup: true,
            requestId: "lifecycle-user-exports-cleanup-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run lifecycle-user-exports-cleanup --prefix backend -- --dry-run --limit 50`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run lifecycle-user-exports-cleanup --prefix backend -- --execute --limit 50 --object-cleanup`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER",
          "ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX",
        ],
        safeguards: [
          "默认每天凌晨处理 50 条，避免一次性扫空历史大表。",
          "execute 模式必须带 request_id，CloudBase 重试不会重复清理同一批记录。",
          "对象删除失败或删除 Adapter 未配置时不会移除后台记录，修复配置后可以重跑。",
          "未配置 CloudBase、本地目录或自定义对象存储 Adapter 时，object-backed 导出只进入失败/跳过结果，不会误删记录。",
        ],
      },
      {
        id: "health_data_retention_cleanup",
        title: "健康敏感数据保存期限到期清理",
        schedule: {
          cron: "15 4 * * *",
          timezone: "Asia/Shanghai",
          description: "每天凌晨按已确认保存天数脱敏过期健康内容并清理 CloudBase 图片。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/health-data-retention-cleanup",
          body: {
            dryRun: false,
            limit: 50,
            objectCleanup: true,
            requestId: "health-data-retention-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run health-data-retention-cleanup --prefix backend -- --dry-run --limit 50`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run health-data-retention-cleanup --prefix backend -- --execute --limit 50`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_REQUIRE_HEALTH_CONSENT",
          "ROOT_HEALTH_DATA_RETENTION_DAYS",
          "ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED",
          "ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT",
          "ROOT_PRIVACY_CONTROLLER_NAME",
          "ROOT_PRIVACY_CONTACT",
          "ROOT_CLOUDBASE_ENV_ID",
        ],
        safeguards: [
          "默认 dry-run，execute 必须有稳定 request_id 且显式开启 ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED。",
          "脱敏原始身体画像、问卷答案、排便反馈及本地运营派生自由文本，保留任务完成、状态、关联 ID、结算、奖励与同意审计事实。",
          "CloudBase 图片先删对象再移除引用；删除失败时保留待重试引用并输出失败计数。",
          "审计只记录截止日期、数量和类型，不保存健康原文或图片 fileID。",
        ],
      },
      {
        id: "youzan_identity_reconcile",
        title: "有赞 UnionID 身份小批量对账",
        schedule: {
          cron: "25 * * * *",
          timezone: "Asia/Shanghai",
          description: "每小时小批量查询 UnionID 对应的 yz_open_id，并补链未归属订单。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/youzan-identity-reconcile",
          body: {
            dryRun: false,
            batchSize: 5,
            requestId: "youzan-identity-reconcile-YYYYMMDDHHmm",
          },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run youzan-identity-reconcile --prefix backend -- --dry-run --batch-size 5`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run youzan-identity-reconcile --prefix backend -- --execute --batch-size 5`,
        requiredEnv: REQUIRED_ENV,
        optionalEnv: [
          "ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED",
          "ROOT_YOUZAN_IDENTITY_RECONCILE_BATCH_SIZE",
          "ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS",
          "YOUZAN_USER_QUERY_URL",
          "YOUZAN_USER_QUERY_ACCESS_TOKEN",
          "YOUZAN_CUSTOMER_ACCESS_TOKEN",
          "YOUZAN_ACCESS_TOKEN",
          "YOUZAN_USER_QUERY_METHOD",
          "YOUZAN_USER_QUERY_ACCESS_TOKEN_LOCATION",
          "YOUZAN_USER_QUERY_ACCESS_TOKEN_PARAM",
          "YOUZAN_USER_QUERY_RESULT_TYPES",
          "YOUZAN_USER_QUERY_EXTRA_PARAMS",
        ],
        safeguards: [
          "默认 dry-run；execute 必须显式开启 ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED 并提供稳定 request_id。",
          "默认每小时最多查询 5 个 UnionID，按顺序执行并对失败记录退避，避免放大有赞限流。",
          "成功身份默认 7 天复核一次，发现后续新增的 yz_open_id 时继续补链。",
          "允许同一 UnionID 对应多个 yz_open_id；已有订单归属冲突只创建人工待办，不自动改绑。",
          "对账记录只保存 UnionID 指纹和聚合计数，Job 输出与审计不保存 UnionID、手机号或 token。",
        ],
      },
    ],
  };
}

function isCronExpression(value) {
  return String(value || "").trim().split(/\s+/).length === 5;
}

function validateCloudbaseJobManifest(manifest, options = {}) {
  const errors = [];
  const warnings = [];
  if (!manifest || manifest.version !== 1) errors.push("manifest.version must be 1");
  if (!manifest || !manifest.environment) errors.push("manifest.environment is required");
  const jobs = manifest && Array.isArray(manifest.jobs) ? manifest.jobs : [];
  if (jobs.length < 11) errors.push("manifest.jobs must include adapter retry, operational alerts, checkin reminders, wework touch, lifecycle settlement, lifecycle cleanup, lifecycle export, lifecycle export delivery retry, lifecycle export cleanup, health data retention cleanup, and Youzan identity reconciliation jobs");
  const ids = new Set();
  for (const job of jobs) {
    if (!job.id) errors.push("job.id is required");
    if (ids.has(job.id)) errors.push(`duplicate job id: ${job.id}`);
    ids.add(job.id);
    if (!job.schedule || !isCronExpression(job.schedule.cron)) errors.push(`${job.id || "job"} schedule.cron must use five-field cron`);
    if (!job.http || job.http.method !== "POST" || !String(job.http.path || "").startsWith("/api/v1/jobs/")) {
      errors.push(`${job.id || "job"} http Interface must call POST /api/v1/jobs/*`);
    }
    if (!job.executeCommand || !job.executeCommand.includes("--execute")) errors.push(`${job.id || "job"} executeCommand must be explicit execute mode`);
    if (!job.dryRunCommand || !job.dryRunCommand.includes("--dry-run")) errors.push(`${job.id || "job"} dryRunCommand must be explicit dry-run mode`);
    for (const name of REQUIRED_ENV) {
      if (!Array.isArray(job.requiredEnv) || !job.requiredEnv.includes(name)) errors.push(`${job.id || "job"} missing required env ${name}`);
    }
  }
  for (const expectedId of ["adapter_retry_due", "operational_alerts", "checkin_reminders", "wework_touch_due", "lifecycle_settlement_due", "lifecycle_settlement_cleanup", "lifecycle_users_export", "lifecycle_user_exports_delivery_retry", "lifecycle_user_exports_cleanup", "health_data_retention_cleanup", "youzan_identity_reconcile"]) {
    if (!ids.has(expectedId)) errors.push(`missing job ${expectedId}`);
  }
  const baseUrl = manifest && manifest.environment && manifest.environment.baseUrl;
  if (!baseUrl || baseUrl === DEFAULT_BASE_URL) warnings.push("ROOT_JOB_BASE_URL is not resolved; configure it in CloudBase before execute mode");
  if (options.strict && String(baseUrl || "").startsWith("http://")) errors.push("strict mode requires HTTPS ROOT_JOB_BASE_URL");
  return {
    status: errors.length ? "FAIL" : "PASS",
    errors,
    warnings,
  };
}

function buildCloudbaseJobManifestReport(manifest, validation) {
  const lines = [
    "# ROOT CloudBase Job 发布 Manifest",
    "",
    `状态：${validation.status}`,
    `base_url：${manifest.environment.baseUrl}`,
    `必需环境变量：${manifest.environment.requiredEnv.join(", ")}`,
    "",
    "## 定时任务",
  ];
  for (const job of manifest.jobs) {
    lines.push(
      `- ${job.id}：${job.schedule.description}`,
      `  - cron：${job.schedule.cron} (${job.schedule.timezone})`,
      `  - Interface：${job.http.method} ${job.http.path}`,
      `  - dry-run：${job.dryRunCommand}`,
      `  - execute：${job.executeCommand}`,
    );
  }
  if (validation.warnings.length) {
    lines.push("", "## 提醒", ...validation.warnings.map((item) => `- ${item}`));
  }
  if (validation.errors.length) {
    lines.push("", "## 错误", ...validation.errors.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildCloudbaseJobManifest(args);
  const validation = validateCloudbaseJobManifest(manifest, { strict: args.strict });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ manifest, validation }, null, 2)}\n`);
  } else {
    process.stdout.write(buildCloudbaseJobManifestReport(manifest, validation));
  }
  process.exitCode = validation.status === "PASS" ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCloudbaseJobManifest,
  buildCloudbaseJobManifestReport,
  parseArgs,
  resolveBaseUrl,
  validateCloudbaseJobManifest,
};
