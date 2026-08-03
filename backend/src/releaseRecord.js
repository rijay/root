const { nowISO } = require("./dates");
const actionAdapterCalibration = require("./actionAdapterCalibration");
const adapterCalibration = require("./adapterCalibration");
const adminLegacyDeprecationDecision = require("./adminLegacyDeprecationDecision");
const adminTransitionReadiness = require("./adminTransitionReadiness");
const adminLifecycleUserExports = require("./adminLifecycleUserExports");
const cloudbaseStoreReadiness = require("./cloudbaseStoreReadiness");
const externalPlatformAdapters = require("./externalPlatformAdapters");
const launchReadiness = require("./launchReadiness");
const orderFulfillment = require("./orderFulfillment");
const operationalAlerts = require("./operationalAlerts");
const productionCutoverProof = require("./productionCutoverProof");
const productionCutoverReadiness = require("./productionCutoverReadiness");
const productionEvidenceIntake = require("./productionEvidenceIntake");
const { buildProductionEnvMatrix } = require("./productionEnvMatrix");
const releaseSignoff = require("./releaseSignoff");
const rootMemberCenterJumpProof = require("./rootMemberCenterJumpProof");
const rootMemberCenterReadiness = require("./rootMemberCenterReadiness");

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function statusFromInputs(
  readiness,
  actionCalibration,
  calibration,
  productionEnvMatrix,
  externalChannelReadiness,
  signoffGate,
  adminTransition,
  productionCutover,
  cloudbaseStore,
  rootMemberCenter,
) {
  if (
    readiness.status === "BLOCKED" ||
    actionCalibration.status === "BLOCKED" ||
    calibration.status === "BLOCKED" ||
    productionEnvMatrix.status === "BLOCKED" ||
    externalChannelReadiness.status === "BLOCKED" ||
    signoffGate.status === "BLOCKED" ||
    adminTransition.status === "BLOCKED" ||
    productionCutover.status === "BLOCKED" ||
    cloudbaseStore.status === "BLOCKED" ||
    rootMemberCenter.status === "BLOCKED"
  ) return "BLOCKED";
  if (
    readiness.status === "NEEDS_REVIEW" ||
    actionCalibration.status === "NEEDS_REVIEW" ||
    calibration.status === "NEEDS_REVIEW" ||
    productionEnvMatrix.status === "NEEDS_REVIEW" ||
    externalChannelReadiness.status === "NEEDS_REVIEW" ||
    signoffGate.status === "NEEDS_REVIEW" ||
    adminTransition.status === "NEEDS_REVIEW" ||
    productionCutover.status === "NEEDS_REVIEW" ||
    cloudbaseStore.status === "NEEDS_REVIEW" ||
    rootMemberCenter.status === "NEEDS_REVIEW"
  ) return "NEEDS_REVIEW";
  return "READY";
}

function decisionText(status) {
  if (status === "READY") return "可进入发布窗口";
  if (status === "NEEDS_REVIEW") return "可小流量灰度，但需要负责人确认提醒项";
  return "暂缓发布，先处理阻塞项";
}

function envPresence(env, names) {
  return names.map((name) => ({ name, present: Boolean(env && env[name]) }));
}

function envRow(env, name) {
  return { name, present: Boolean(env && env[name]) };
}

function alertRuleRequiresOwner(rule) {
  return rule.channel === "WEBHOOK" || [
    "ADAPTER_RETRY_EXHAUSTED",
    "LIFECYCLE_SETTLEMENT_JOB_FAILED",
    "LIFECYCLE_SETTLEMENT_JOB_STALLED",
    "LIFECYCLE_EXPORT_DELIVERY_HEALTH",
    "CONSULTATION_SLA_OVERDUE",
    "CONSULTATION_SLA_ESCALATION",
  ].includes(rule.target_type);
}

function alertOwnerStatus(rule) {
  const ownerRole = text(rule.owner_role);
  const ownerName = text(rule.owner_name);
  const ownerContact = text(rule.owner_contact);
  if (!ownerRole) return "BLOCKED";
  if (!ownerName || !ownerContact) return "NEEDS_REVIEW";
  return "READY";
}

function externalChannelReadiness(data, context = {}) {
  const env = context.env || process.env;
  const rules = operationalAlerts.listEffectiveAlertRules(data)
    .filter((rule) => rule.status === "ACTIVE");
  const ownerRows = rules
    .filter(alertRuleRequiresOwner)
    .map((rule) => ({
      alertRuleId: rule.alert_rule_id,
      title: rule.title,
      targetType: rule.target_type,
      targetKey: rule.target_key,
      channel: rule.channel,
      ownerRole: rule.owner_role || "",
      ownerName: rule.owner_name || "",
      ownerContact: rule.owner_contact || "",
      routeKey: rule.route_key || "",
      status: alertOwnerStatus(rule),
    }));
  const webhookRows = rules
    .filter((rule) => rule.channel === "WEBHOOK")
    .map((rule) => ({
      alertRuleId: rule.alert_rule_id,
      title: rule.title,
      urlConfigured: Boolean(rule.webhook_url || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_URL),
      signed: Boolean(env.ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET),
      channel: rule.config_json?.webhookChannel || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL || "",
      template: rule.config_json?.webhookTemplate || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE || "",
    }));
  const deliveryChannel = text(env.ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL).toUpperCase();
  const lifecycleDeliveryEnabled = text(env.ROOT_LIFECYCLE_EXPORT_DELIVERY_ENABLED).toLowerCase() === "true" ||
    deliveryChannel === "WEBHOOK" ||
    Boolean(env.ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL);
  const lifecycleDeliveryWebhook = {
    enabled: lifecycleDeliveryEnabled,
    channel: deliveryChannel || (lifecycleDeliveryEnabled ? "WEBHOOK" : "NONE"),
    env: [
      envRow(env, "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL"),
      envRow(env, "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL"),
      envRow(env, "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE"),
      envRow(env, "ROOT_LIFECYCLE_EXPORT_DELIVERY_SECRET"),
      envRow(env, "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET"),
      envRow(env, "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED"),
    ],
  };
  const deliveryHealth = adminLifecycleUserExports.getLifecycleExportDeliveryHealth(data, { issueLimit: 5 });
  const blockers = [];
  const warnings = [];
  webhookRows
    .filter((row) => !row.urlConfigured)
    .forEach((row) => blockers.push(`外部预警 ${row.title} 未配置 webhook_url 或 ROOT_OPERATIONAL_ALERT_WEBHOOK_URL`));
  if (lifecycleDeliveryWebhook.enabled && !env.ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL && lifecycleDeliveryWebhook.channel === "WEBHOOK") {
    blockers.push("用户生命周期导出 WEBHOOK 交付已开启但未配置 ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL");
  }
  ownerRows
    .filter((row) => row.status === "BLOCKED")
    .forEach((row) => blockers.push(`运营预警 ${row.title} 缺少 ownerRole`));
  ownerRows
    .filter((row) => row.status === "NEEDS_REVIEW")
    .forEach((row) => warnings.push(`运营预警 ${row.title} 需要补齐负责人姓名和联系方式`));
  if (lifecycleDeliveryWebhook.enabled) {
    ["ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL", "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE", "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET"].forEach((name) => {
      if (!env[name]) warnings.push(`用户生命周期导出交付建议配置 ${name}`);
    });
  }
  if (!env.ROOT_OPERATIONAL_ALERT_WEBHOOK_URL) {
    warnings.push("未配置 ROOT_OPERATIONAL_ALERT_WEBHOOK_URL，运营预警仅保留站内通知");
  }
  const status = blockers.length ? "BLOCKED" : warnings.length ? "NEEDS_REVIEW" : "READY";
  return {
    status,
    summary: {
      alertRulesReviewed: ownerRows.length,
      webhookRuleCount: webhookRows.length,
      blockedCount: blockers.length,
      warningCount: warnings.length,
      lifecycleDeliveryRequestedCount: deliveryHealth.summary.requestedCount,
      lifecycleDeliveryDeadLetterCount: deliveryHealth.summary.deadLetterCount,
      lifecycleDeliveryDueRetryCount: deliveryHealth.summary.dueRetryCount,
    },
    operationalAlertWebhook: {
      status: webhookRows.some((row) => !row.urlConfigured) ? "BLOCKED" : env.ROOT_OPERATIONAL_ALERT_WEBHOOK_URL ? "READY" : "NEEDS_REVIEW",
      env: [
        envRow(env, "ROOT_OPERATIONAL_ALERT_WEBHOOK_URL"),
        envRow(env, "ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET"),
        envRow(env, "ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL"),
        envRow(env, "ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE"),
        envRow(env, "ROOT_OPERATIONAL_ALERT_WEBHOOK_TIMEOUT_MS"),
      ],
      webhookRules: webhookRows,
    },
    lifecycleExportDelivery: {
      status: lifecycleDeliveryWebhook.enabled && lifecycleDeliveryWebhook.channel === "WEBHOOK" && !env.ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL
        ? "BLOCKED"
        : lifecycleDeliveryWebhook.enabled ? "NEEDS_REVIEW" : "READY",
      webhook: lifecycleDeliveryWebhook,
      health: {
        status: deliveryHealth.status,
        message: deliveryHealth.message,
        summary: deliveryHealth.summary,
        nextRetryAt: deliveryHealth.nextRetryAt,
      },
    },
    alertOwnerRoutes: ownerRows,
    blockers,
    warnings,
  };
}

function releaseEvidence(
  data,
  context,
  readiness,
  actionCalibration,
  calibration,
  productionEnvMatrix,
  signoffGate,
  adminTransition,
  productionCutover,
  cloudbaseStore,
  rootMemberCenter,
) {
  const recentRuns = externalPlatformAdapters.listAdapterRuns(data, 8);
  const cursors = externalPlatformAdapters.listAdapterCursors(data);
  const channelReadiness = externalChannelReadiness(data, context);
  const evidenceIntake = productionEvidenceIntake.buildProductionEvidenceIntake({
    target: readiness.target,
    adapterCalibration: calibration,
    actionAdapterCalibration: actionCalibration,
    adminTransition,
    productionCutover,
    cloudbaseStore,
    rootMemberCenter,
  });
  return {
    storeAdapter: {
      kind: context.storeAdapter && context.storeAdapter.kind ? context.storeAdapter.kind : "memory",
      health: context.storeAdapter && typeof context.storeAdapter.getStoreHealth === "function"
        ? (() => {
          const health = context.storeAdapter.getStoreHealth();
          return {
            connected: health.connected !== false,
            transactional: health.transactional === true,
            multiInstanceSafe: health.multiInstanceSafe === true,
            migrationVersion: health.migrationVersion || "",
            revision: health.revision ?? null,
            projectionMode: health.projectionMode || "",
            leastPrivilegeReady: health.leastPrivilegeReady === true,
            privilegeScope: health.privilegeScope || "UNKNOWN",
          };
        })()
        : null,
    },
    env: envPresence(context.env, [
      "WECHAT_APPID",
      "WECHAT_APPSECRET",
      "ROOT_PUBLIC_BASE_URL",
      "ROOT_ADMIN_TOKEN",
      "ROOT_STORE_ADAPTER",
      "MYSQL_ADDRESS",
      "MYSQL_USERNAME",
      "MYSQL_PASSWORD",
      "MYSQL_DATABASE",
      "ROOT_CLOUDBASE_STORE_DECISION",
      "ROOT_CLOUDBASE_ENV_ID",
      "CLOUDBASE_ENV_ID",
      "TCB_ENV_ID",
      "ROOT_CLOUDBASE_REGION",
      "TENCENTCLOUD_REGION",
      "ROOT_CLOUDBASE_STORE_BACKUP_PLAN",
      "ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN",
      "ROOT_CLOUDBASE_STORE_PROOF",
      "ROOT_SQLITE_FILE",
      "ROOT_STORE_FILE",
      "ROOT_MEMBER_CENTER_APPID",
      "ROOT_MEMBER_CENTER_PRODUCT_PATH",
      "ROOT_MEMBER_CENTER_ENV_VERSION",
      "ROOT_YOUZAN_APP_ID",
      "ROOT_YOUZAN_PRODUCT_PATH",
      "ROOT_YOUZAN_ENV_VERSION",
      "YOUZAN_ORDER_LIST_URL",
      "YOUZAN_CUSTOMER_LIST_URL",
      "ROOT_FULFILLMENT_LIST_URL",
      "WEWORK_CONTACT_LIST_URL",
      "ROOT_CONSULTATION_ADVISORS",
      "ROOT_CONSULTATION_SLA_MINUTES",
      "ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES",
      "ROOT_CONSULTATION_SLA_ESCALATION_RULES",
      "ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES",
      "WEWORK_CONTACT_WRITEBACK_URL",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_URL",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL",
      "ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL",
      "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE",
      "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET",
    ]),
    productionEnvMatrix: {
      status: productionEnvMatrix.status,
      summary: productionEnvMatrix.summary,
      missingEnv: productionEnvMatrix.missingEnv,
      groups: productionEnvMatrix.groups.map((group) => ({
        id: group.id,
        label: group.label,
        status: group.status,
        ownerRole: group.ownerRole,
        missingRequired: group.missingRequired,
        missingAnyOf: group.missingAnyOf,
      })),
    },
    launchReadiness: {
      status: readiness.status,
      summary: readiness.summary,
      blockers: readiness.checks.filter((check) => check.status === "BLOCKER").map((check) => ({
        id: check.id,
        label: check.label,
        message: check.message,
      })),
      warnings: readiness.checks.filter((check) => check.status === "WARNING").map((check) => ({
        id: check.id,
        label: check.label,
        message: check.message,
      })),
    },
    adapterCalibration: {
      status: calibration.status,
      summary: calibration.summary,
      sources: calibration.sources.map((source) => ({
        sourceType: source.sourceType,
        adapterKind: source.adapterKind,
        label: source.label,
        status: source.status,
        blockers: source.summary.blockers,
        warnings: source.summary.warnings,
      })),
    },
    actionAdapterCalibration: {
      status: actionCalibration.status,
      summary: actionCalibration.summary,
      actions: actionCalibration.actions.map((action) => ({
        id: action.id,
        group: action.group,
        adapterType: action.adapterType,
        label: action.label,
        status: action.status,
        blockers: action.summary.blockers,
        warnings: action.summary.warnings,
        checks: action.checks.map((check) => ({
          id: check.id,
          label: check.label,
          status: check.status,
          message: check.message,
        })),
      })),
    },
    recentAdapterRuns: recentRuns.map((run) => ({
      runId: run.run_id,
      sourceType: run.source_type,
      adapterKind: run.adapter_kind,
      mode: run.mode,
      status: run.status,
      importedCount: run.imported_count || 0,
      errorCount: run.error_count || 0,
      warningCount: run.warning_count || 0,
      cursorAfter: run.cursor_after || "",
      finishedAt: run.finished_at || "",
      errorMessage: run.error_message || "",
    })),
    adapterCursors: cursors.map((cursor) => ({
      sourceType: cursor.source_type,
      adapterKind: cursor.adapter_kind,
      cursorValue: cursor.cursor_value,
      updatedAt: cursor.updated_at,
    })),
    externalChannelReadiness: channelReadiness,
    productionEvidenceIntake: evidenceIntake,
    signoffGate: {
      status: signoffGate.status,
      summary: signoffGate.summary,
      requiredRoles: signoffGate.requiredRoles,
      approvedRoles: signoffGate.approvedRoles,
      pendingRoles: signoffGate.pendingRoles,
      rejectedRoles: signoffGate.rejectedRoles,
      blockers: signoffGate.blockers,
      warnings: signoffGate.warnings,
      message: signoffGate.message,
    },
    adminTransitionReadiness: {
      status: adminTransition.status,
      summary: adminTransition.summary,
      legacyDeprecationDecision: adminTransition.legacyDeprecationDecision || {},
      dist: adminTransition.dist,
      moduleCoverage: adminTransition.moduleCoverage,
      blockers: adminTransition.blockers,
      warnings: adminTransition.warnings,
    },
    productionCutoverReadiness: {
      status: productionCutover.status,
      target: productionCutover.target,
      summary: productionCutover.summary,
      groups: productionCutover.groups,
      items: productionCutover.items,
      blockers: productionCutover.blockers,
      warnings: productionCutover.warnings,
    },
    cloudbaseStoreReadiness: {
      status: cloudbaseStore.status,
      target: cloudbaseStore.target,
      selectedDecision: cloudbaseStore.selectedDecision,
      selectedDecisionLabel: cloudbaseStore.selectedDecisionLabel,
      currentStoreAdapterKind: cloudbaseStore.currentStoreAdapterKind,
      summary: cloudbaseStore.summary,
      env: cloudbaseStore.env,
      checks: cloudbaseStore.checks,
      blockers: cloudbaseStore.blockers,
      warnings: cloudbaseStore.warnings,
      nextActions: cloudbaseStore.nextActions,
    },
    rootMemberCenterReadiness: {
      status: rootMemberCenter.status,
      target: rootMemberCenter.target,
      appId: rootMemberCenter.appId,
      appIdSource: rootMemberCenter.appIdSource,
      defaultPath: rootMemberCenter.defaultPath,
      defaultPathSource: rootMemberCenter.defaultPathSource,
      envVersion: rootMemberCenter.envVersion,
      summary: rootMemberCenter.summary,
      env: rootMemberCenter.env,
      proofs: rootMemberCenter.proofs,
      products: rootMemberCenter.products,
      checks: rootMemberCenter.checks,
      blockers: rootMemberCenter.blockers,
      warnings: rootMemberCenter.warnings,
      nextActions: rootMemberCenter.nextActions,
    },
    operations: {
      openTasks: (data.operationTasks || []).filter((task) => task.status === "OPEN").length,
      pendingRefunds: (data.refundWorkItems || []).filter((item) => item.status === "PENDING").length,
      readyToStartUsers: orderFulfillment.getReadyToStartUsers(data).length,
      sampleReviews: (data.externalSampleReviews || []).length,
    },
  };
}

function buildReleaseChecklist(
  status,
  readiness,
  actionCalibration,
  calibration,
  productionEnvMatrix,
  externalChannelReadiness,
  signoffGate,
  adminTransition,
  productionCutover,
  cloudbaseStore,
  rootMemberCenter,
) {
  const blockers = readiness.checks
    .filter((check) => check.status === "BLOCKER")
    .map((check) => `${check.label}: ${check.message}`)
    .concat(calibration.sources.flatMap((source) => {
      return source.checks
        .filter((check) => check.status === "BLOCKER")
        .map((check) => `${source.label}/${check.label}: ${check.message}`);
    }));
  blockers.push(...productionEnvMatrix.groups
    .filter((group) => group.status === "BLOCKER")
    .map((group) => `${group.label}: ${group.message}`));
  blockers.push(...actionCalibration.actions.flatMap((action) => action.checks
    .filter((check) => check.status === "BLOCKER")
    .map((check) => `${action.label}/${check.label}: ${check.message}`)));
  blockers.push(...externalChannelReadiness.blockers);
  blockers.push(...signoffGate.blockers);
  blockers.push(...adminTransition.blockers);
  blockers.push(...productionCutover.blockers);
  blockers.push(...cloudbaseStore.blockers);
  blockers.push(...rootMemberCenter.blockers);
  if (readiness.target === "production") blockers.push(...signoffGate.warnings);
  const warnings = readiness.checks
    .filter((check) => check.status === "WARNING")
    .map((check) => `${check.label}: ${check.message}`)
    .concat(calibration.sources.flatMap((source) => {
      return source.checks
        .filter((check) => check.status === "WARNING")
        .map((check) => `${source.label}/${check.label}: ${check.message}`);
    }));
  warnings.push(...productionEnvMatrix.groups
    .filter((group) => group.status === "WARNING")
    .map((group) => `${group.label}: ${group.message}`));
  warnings.push(...actionCalibration.actions.flatMap((action) => action.checks
    .filter((check) => check.status === "WARNING")
    .map((check) => `${action.label}/${check.label}: ${check.message}`)));
  warnings.push(...externalChannelReadiness.warnings);
  warnings.push(...adminTransition.warnings);
  warnings.push(...productionCutover.warnings);
  warnings.push(...cloudbaseStore.warnings);
  warnings.push(...rootMemberCenter.warnings);
  if (readiness.target !== "production") warnings.push(...signoffGate.warnings);
  return {
    mustFixBeforeRelease: blockers,
    mustConfirmForGray: warnings,
    finalChecks: [
      "确认小程序体验版连接的是 ROOT_PUBLIC_BASE_URL。",
      "确认数据仓库 Adapter 的备份或快照已完成。",
      "确认 production-env 矩阵、CloudBase Job Manifest 和发布校准报告使用同一组生产环境变量。",
      "确认企业微信联系回写的真实动作 Adapter 已完成小批量校准。",
      "确认 CloudBase Store 决策、环境 ID、地域、备份计划和回滚计划已写入发布记录。",
      "确认 myRoot 商品页的 Root 会员中心 appId、购买路径和体验版跳转结果已写入发布记录。",
      "确认外部预警、导出交付和运营负责人路由已写入发布记录。",
      "确认产品、运营、研发签字均绑定到同一轮发布证据包留档。",
      "确认 Element Plus Admin 主入口、backend-only 部署包、/admin-legacy 回退状态和旧后台下线决策已写入发布记录。",
      "确认生产证据收口项中每一条外部证据都有负责人、下一步动作和留档路径。",
      "确认微信开放平台、Root 会员中心 appId、CloudBase unionid、有赞、企微、CloudBase Job、外部通道、导出存储和回滚演练的生产切换证明已写入发布记录。",
      "确认 CloudRun 候选运行、同版本体验版真机、次日提醒真实送达、5% 灰度观察和候选工件追溯证明均已写入发布记录。",
    ],
    statusHint: decisionText(status),
  };
}

function buildReleaseRecord(data, options = {}) {
  const context = {
    storeAdapter: options.storeAdapter || { kind: "memory" },
    env: options.env || process.env,
    adapterImplementations: options.adapterImplementations || {},
    fetchImpl: options.fetchImpl,
    runtimeMetadata: options.runtimeMetadata || {},
  };
  const readiness = launchReadiness.buildLaunchReadiness(data, { ...context, target: options.target || "production" });
  const calibration = adapterCalibration.buildAdapterCalibration(data, context);
  const actionCalibration = actionAdapterCalibration.buildActionAdapterCalibration(data, {
    ...context,
    target: readiness.target,
  });
  const productionEnvMatrix = buildProductionEnvMatrix(context.env, { target: readiness.target });
  const cloudbaseStore = cloudbaseStoreReadiness.buildCloudbaseStoreReadiness({
    env: context.env,
    target: readiness.target,
    storeAdapter: context.storeAdapter,
  });
  const rootMemberCenter = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data,
    env: context.env,
    target: readiness.target,
    proofs: rootMemberCenterJumpProof.latestRootMemberCenterJumpProofs(data, { target: readiness.target }),
  });
  const channelReadiness = externalChannelReadiness(data, context);
  const signoffGate = releaseSignoff.buildReleaseSignoffGate(data, { target: readiness.target });
  const adminTransition = adminTransitionReadiness.buildAdminTransitionReadiness({
    env: context.env,
    deprecationDecisions: adminLegacyDeprecationDecision.latestAdminLegacyDeprecationDecisions(data, { target: readiness.target }),
    ...(context.adminTransitionOptions || {}),
  });
  const productionCutover = productionCutoverReadiness.buildProductionCutoverReadiness({
    env: context.env,
    target: readiness.target,
    proofs: productionCutoverProof.latestProductionCutoverProofs(data, { target: readiness.target }),
    runtimeMetadata: context.runtimeMetadata,
  });
  const status = statusFromInputs(
    readiness,
    actionCalibration,
    calibration,
    productionEnvMatrix,
    channelReadiness,
    signoffGate,
    adminTransition,
    productionCutover,
    cloudbaseStore,
    rootMemberCenter,
  );
  const checklist = buildReleaseChecklist(
    status,
    readiness,
    actionCalibration,
    calibration,
    productionEnvMatrix,
    channelReadiness,
    signoffGate,
    adminTransition,
    productionCutover,
    cloudbaseStore,
    rootMemberCenter,
  );
  return {
    title: "myRoot 正式上线发布记录",
    status,
    target: readiness.target,
    generatedAt: nowISO(),
    decision: {
      recommendation: decisionText(status),
      releaseOwner: "",
      operationOwner: "",
      engineeringOwner: "",
      approvedAt: "",
      note: "",
    },
    signoffs: signoffGate.signoffs,
    signoffGate,
    checklist,
    mustFixBeforeRelease: checklist.mustFixBeforeRelease,
    mustConfirmForGray: checklist.mustConfirmForGray,
    finalChecks: checklist.finalChecks,
    evidence: releaseEvidence(
      data,
      context,
      readiness,
      actionCalibration,
      calibration,
      productionEnvMatrix,
      signoffGate,
      adminTransition,
      productionCutover,
      cloudbaseStore,
      rootMemberCenter,
    ),
    rollback: [
      "暂停有赞、物流和企微写入型 Adapter，保留只读查询。",
      "运营后台改用人工维护商品、内容与活动，客服跟进改为人工记录。",
      "保留当前 Store 快照，必要时回退到发布前快照。",
      "通知运营暂停自动触达和外部回写，按人工流程承接用户问题。",
    ],
  };
}

module.exports = {
  buildReleaseRecord,
  externalChannelReadiness,
};
