const { nowISO } = require("./dates");

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return Array.from(new Set(list(items).map((item) => text(item)).filter(Boolean)));
}

function normalizeBaseUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    return raw.replace(/\?.*$/, "").replace(/\/+$/, "");
  }
}

function normalizeStatus(status) {
  const value = text(status).toUpperCase();
  if (["BLOCKED", "BLOCKER", "FAIL", "FAILED"].includes(value)) return "BLOCKED";
  if (["NEEDS_REVIEW", "WARNING", "WARN"].includes(value)) return "NEEDS_REVIEW";
  if (["READY", "PASS", "PASSED", "OK", "HEALTHY", "IDLE"].includes(value)) return "READY";
  return value || "NEEDS_REVIEW";
}

function worstStatus(statuses) {
  const normalized = list(statuses).map(normalizeStatus);
  if (normalized.includes("BLOCKED")) return "BLOCKED";
  if (normalized.includes("NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "READY";
}

function releaseBlockers(record) {
  return list(record.mustFixBeforeRelease || (record.checklist && record.checklist.mustFixBeforeRelease));
}

function releaseWarnings(record) {
  return list(record.mustConfirmForGray || (record.checklist && record.checklist.mustConfirmForGray));
}

function releaseFinalChecks(record) {
  return list(record.finalChecks || (record.checklist && record.checklist.finalChecks));
}

function matrixBlockers(matrix) {
  return list(matrix.missingEnv).map((item) => {
    return `${item.groupLabel || item.groupId || "生产环境"}: ${item.name}`;
  });
}

function externalChannel(record) {
  return record && record.evidence && record.evidence.externalChannelReadiness
    ? record.evidence.externalChannelReadiness
    : { status: "NEEDS_REVIEW", summary: {}, blockers: [], warnings: [], alertOwnerRoutes: [] };
}

function releaseSignoffGate(record) {
  return record && record.signoffGate
    ? record.signoffGate
    : { status: "NEEDS_REVIEW", summary: {}, blockers: ["发布签字闸口未生成"], warnings: [], signoffs: [] };
}

function adminTransition(record) {
  return record && record.evidence && record.evidence.adminTransitionReadiness
    ? record.evidence.adminTransitionReadiness
    : { status: "NEEDS_REVIEW", summary: {}, blockers: ["Admin 迁移 Gate 未生成"], warnings: [] };
}

function productionCutover(record) {
  return record && record.evidence && record.evidence.productionCutoverReadiness
    ? record.evidence.productionCutoverReadiness
    : { status: "NEEDS_REVIEW", summary: {}, blockers: ["生产切换 Gate 未生成"], warnings: [] };
}

function cloudbaseStoreReadiness(record) {
  return record && record.evidence && record.evidence.cloudbaseStoreReadiness
    ? record.evidence.cloudbaseStoreReadiness
    : { status: "NEEDS_REVIEW", summary: {}, blockers: [], warnings: ["CloudBase Store 决策未生成"], checks: [] };
}

function rootMemberCenterReadiness(record) {
  return record && record.evidence && record.evidence.rootMemberCenterReadiness
    ? record.evidence.rootMemberCenterReadiness
    : { status: "NEEDS_REVIEW", summary: {}, blockers: [], warnings: ["Root 会员中心购买跳转 Gate 未生成"], products: [], checks: [] };
}

function productionEvidenceIntake(record) {
  return record && record.evidence && record.evidence.productionEvidenceIntake
    ? record.evidence.productionEvidenceIntake
    : { status: "NEEDS_REVIEW", summary: {}, blockers: [], warnings: ["生产证据收口未生成"], items: [], groups: [] };
}

function adapterCalibration(record, explicitCalibration) {
  if (explicitCalibration) return explicitCalibration;
  return record && record.evidence && record.evidence.adapterCalibration
    ? record.evidence.adapterCalibration
    : { status: "NEEDS_REVIEW", summary: {}, sources: [] };
}

function actionAdapterCalibration(record, explicitCalibration) {
  if (explicitCalibration) return explicitCalibration;
  return record && record.evidence && record.evidence.actionAdapterCalibration
    ? record.evidence.actionAdapterCalibration
    : { status: "NEEDS_REVIEW", summary: {}, actions: [] };
}

function calibrationMessages(calibration, checkStatus, fallbackStatus) {
  return list(calibration.actions).flatMap((action) => {
    const checks = list(action.checks).filter((check) => check.status === checkStatus);
    if (checks.length) {
      return checks.map((check) => `${action.label || action.id}/${check.label || check.id}: ${check.message || check.status}`);
    }
    if (action.status === fallbackStatus) {
      return [`${action.label || action.id}: ${fallbackStatus}`];
    }
    return [];
  });
}

function buildEvidenceCommands(target, baseUrl) {
  const url = baseUrl || "<ROOT_PUBLIC_BASE_URL>";
  return [
    `npm run production-env --prefix backend -- --target ${target}`,
    `npm run jobs:manifest --prefix backend -- --base-url ${url} --strict`,
    `npm run calibrate --prefix backend -- --base-url ${url} --target ${target} --strict`,
    `npm run release:evidence --prefix backend -- --base-url ${url} --target ${target} --strict`,
  ];
}

function summarizeJobs(manifest) {
  return list(manifest.jobs).map((job) => ({
    id: job.id,
    title: job.title,
    cron: job.schedule && job.schedule.cron,
    timezone: job.schedule && job.schedule.timezone,
    httpInterface: job.http ? `${job.http.method} ${job.http.path}` : "",
    requiredEnv: list(job.requiredEnv),
    optionalEnvCount: list(job.optionalEnv).length,
    safeguards: list(job.safeguards),
  }));
}

function buildReleaseEvidencePack(input = {}) {
  const releaseRecord = input.releaseRecord || {};
  const productionEnvMatrix = input.productionEnvMatrix ||
    (releaseRecord.evidence && releaseRecord.evidence.productionEnvMatrix) ||
    { status: "NEEDS_REVIEW", summary: {}, missingEnv: [], groups: [] };
  const cloudbaseJobManifest = input.cloudbaseJobManifest || { jobs: [] };
  const cloudbaseJobValidation = input.cloudbaseJobValidation || { status: "FAIL", errors: ["CloudBase Job Manifest 未生成"], warnings: [] };
  const calibration = adapterCalibration(releaseRecord, input.adapterCalibration);
  const actionCalibration = actionAdapterCalibration(releaseRecord, input.actionAdapterCalibration);
  const channel = input.externalChannelReadiness || externalChannel(releaseRecord);
  const signoffGate = releaseSignoffGate(releaseRecord);
  const adminGate = adminTransition(releaseRecord);
  const cutoverGate = productionCutover(releaseRecord);
  const cloudbaseStore = cloudbaseStoreReadiness(releaseRecord);
  const rootMemberCenter = rootMemberCenterReadiness(releaseRecord);
  const evidenceIntake = productionEvidenceIntake(releaseRecord);
  const target = text(input.target || releaseRecord.target, "production");
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const blockers = unique([
    ...releaseBlockers(releaseRecord),
    ...matrixBlockers(productionEnvMatrix),
    ...list(cloudbaseJobValidation.errors).map((item) => `CloudBase Job Manifest: ${item}`),
    ...calibrationMessages(actionCalibration, "BLOCKER", "BLOCKED"),
    ...list(channel.blockers),
    ...list(signoffGate.blockers),
    ...list(adminGate.blockers),
    ...list(cutoverGate.blockers),
    ...list(cloudbaseStore.blockers),
    ...list(rootMemberCenter.blockers),
    ...list(evidenceIntake.blockers),
  ]);
  const warnings = unique([
    ...releaseWarnings(releaseRecord),
    ...list(cloudbaseJobValidation.warnings).map((item) => `CloudBase Job Manifest: ${item}`),
    ...calibrationMessages(actionCalibration, "WARNING", "NEEDS_REVIEW"),
    ...list(channel.warnings),
    ...(signoffGate.status === "BLOCKED" ? [] : list(signoffGate.warnings)),
    ...(adminGate.status === "BLOCKED" ? [] : list(adminGate.warnings)),
    ...(cutoverGate.status === "BLOCKED" ? [] : list(cutoverGate.warnings)),
    ...(cloudbaseStore.status === "BLOCKED" ? [] : list(cloudbaseStore.warnings)),
    ...(rootMemberCenter.status === "BLOCKED" ? [] : list(rootMemberCenter.warnings)),
    ...(evidenceIntake.status === "BLOCKED" ? [] : list(evidenceIntake.warnings)),
  ]);
  const status = blockers.length
    ? "BLOCKED"
    : worstStatus([
      releaseRecord.status,
      productionEnvMatrix.status,
      cloudbaseJobValidation.status,
      calibration.status,
      actionCalibration.status,
      channel.status,
      signoffGate.status,
      adminGate.status,
      cutoverGate.status,
      cloudbaseStore.status,
      rootMemberCenter.status,
      evidenceIntake.status,
    ]);
  return {
    version: 1,
    title: "ROOT 发布证据包",
    target,
    status,
    generatedAt: input.generatedAt || nowISO(),
    baseUrl,
    sanitization: {
      policy: "只保留状态、变量名、负责人路由和脱敏预览；不输出 token、secret、openid、unionid 或手机号原文。",
      secretValuesIncluded: false,
      rawIdentityIncluded: false,
    },
    summary: {
      releaseStatus: normalizeStatus(releaseRecord.status),
      productionEnvStatus: normalizeStatus(productionEnvMatrix.status),
      cloudbaseJobManifestStatus: cloudbaseJobValidation.status === "PASS" ? "READY" : "BLOCKED",
      adapterCalibrationStatus: normalizeStatus(calibration.status),
      actionAdapterCalibrationStatus: normalizeStatus(actionCalibration.status),
      externalChannelStatus: normalizeStatus(channel.status),
      signoffGateStatus: normalizeStatus(signoffGate.status),
      adminTransitionStatus: normalizeStatus(adminGate.status),
      productionCutoverStatus: normalizeStatus(cutoverGate.status),
      cloudbaseStoreStatus: normalizeStatus(cloudbaseStore.status),
      rootMemberCenterStatus: normalizeStatus(rootMemberCenter.status),
      productionEvidenceIntakeStatus: normalizeStatus(evidenceIntake.status),
      blockerCount: blockers.length,
      warningCount: warnings.length,
      jobCount: list(cloudbaseJobManifest.jobs).length,
      missingEnvCount: list(productionEnvMatrix.missingEnv).length,
    },
    blockers,
    warnings,
    evidence: {
      releaseRecord: {
        status: releaseRecord.status || "UNKNOWN",
        target: releaseRecord.target || target,
        generatedAt: releaseRecord.generatedAt || "",
        decision: releaseRecord.decision || {},
        mustFixBeforeRelease: releaseBlockers(releaseRecord),
        mustConfirmForGray: releaseWarnings(releaseRecord),
        finalChecks: releaseFinalChecks(releaseRecord),
      },
      signoffGate: {
        status: signoffGate.status || "UNKNOWN",
        summary: signoffGate.summary || {},
        requiredRoles: list(signoffGate.requiredRoles),
        approvedRoles: list(signoffGate.approvedRoles),
        pendingRoles: list(signoffGate.pendingRoles),
        rejectedRoles: list(signoffGate.rejectedRoles),
        blockers: list(signoffGate.blockers),
        warnings: list(signoffGate.warnings),
        message: signoffGate.message || "",
        signoffs: list(signoffGate.signoffs).map((item) => ({
          role: item.role,
          roleLabel: item.roleLabel,
          status: item.status,
          archiveId: item.archiveId || "",
          signedAt: item.signedAt || "",
        })),
      },
      adminTransitionReadiness: {
        status: adminGate.status || "UNKNOWN",
        summary: adminGate.summary || {},
        legacyDeprecationDecision: adminGate.legacyDeprecationDecision || {},
        dist: adminGate.dist || {},
        moduleCoverage: list(adminGate.moduleCoverage),
        blockers: list(adminGate.blockers),
        warnings: list(adminGate.warnings),
      },
      productionCutoverReadiness: {
        status: cutoverGate.status || "UNKNOWN",
        target: cutoverGate.target || target,
        summary: cutoverGate.summary || {},
        groups: list(cutoverGate.groups),
        items: list(cutoverGate.items),
        blockers: list(cutoverGate.blockers),
        warnings: list(cutoverGate.warnings),
      },
      cloudbaseStoreReadiness: {
        status: cloudbaseStore.status || "UNKNOWN",
        target: cloudbaseStore.target || target,
        selectedDecision: cloudbaseStore.selectedDecision || "",
        selectedDecisionLabel: cloudbaseStore.selectedDecisionLabel || "",
        currentStoreAdapterKind: cloudbaseStore.currentStoreAdapterKind || "",
        summary: cloudbaseStore.summary || {},
        env: list(cloudbaseStore.env),
        checks: list(cloudbaseStore.checks),
        blockers: list(cloudbaseStore.blockers),
        warnings: list(cloudbaseStore.warnings),
        nextActions: list(cloudbaseStore.nextActions),
      },
      rootMemberCenterReadiness: {
        status: rootMemberCenter.status || "UNKNOWN",
        target: rootMemberCenter.target || target,
        appId: rootMemberCenter.appId || "",
        appIdSource: rootMemberCenter.appIdSource || "",
        defaultPath: rootMemberCenter.defaultPath || "",
        defaultPathSource: rootMemberCenter.defaultPathSource || "",
        envVersion: rootMemberCenter.envVersion || "",
        summary: rootMemberCenter.summary || {},
        env: list(rootMemberCenter.env),
        proofs: list(rootMemberCenter.proofs),
        products: list(rootMemberCenter.products),
        checks: list(rootMemberCenter.checks),
        blockers: list(rootMemberCenter.blockers),
        warnings: list(rootMemberCenter.warnings),
        nextActions: list(rootMemberCenter.nextActions),
      },
      productionEvidenceIntake: {
        status: evidenceIntake.status || "UNKNOWN",
        target: evidenceIntake.target || target,
        summary: evidenceIntake.summary || {},
        groups: list(evidenceIntake.groups),
        items: list(evidenceIntake.items),
        blockers: list(evidenceIntake.blockers),
        warnings: list(evidenceIntake.warnings),
      },
      productionEnvMatrix: {
        status: productionEnvMatrix.status || "UNKNOWN",
        summary: productionEnvMatrix.summary || {},
        missingEnv: list(productionEnvMatrix.missingEnv),
        groups: list(productionEnvMatrix.groups).map((group) => ({
          id: group.id,
          label: group.label,
          status: group.status,
          ownerRole: group.ownerRole,
          missingRequired: list(group.missingRequired),
          missingAnyOf: list(group.missingAnyOf),
        })),
      },
      cloudbaseJobManifest: {
        status: cloudbaseJobValidation.status === "PASS" ? "READY" : "BLOCKED",
        validation: {
          status: cloudbaseJobValidation.status,
          errors: list(cloudbaseJobValidation.errors),
          warnings: list(cloudbaseJobValidation.warnings),
        },
        jobs: summarizeJobs(cloudbaseJobManifest),
      },
      adapterCalibration: {
        status: calibration.status || "UNKNOWN",
        summary: calibration.summary || {},
        sources: list(calibration.sources).map((source) => ({
          sourceType: source.sourceType,
          adapterKind: source.adapterKind,
          label: source.label,
          status: source.status,
          blockers: source.summary ? source.summary.blockers : 0,
          warnings: source.summary ? source.summary.warnings : 0,
        })),
      },
      actionAdapterCalibration: {
        status: actionCalibration.status || "UNKNOWN",
        summary: actionCalibration.summary || {},
        actions: list(actionCalibration.actions).map((action) => ({
          id: action.id,
          group: action.group,
          adapterType: action.adapterType,
          label: action.label,
          status: action.status,
          blockers: action.summary ? action.summary.blockers : action.blockers || 0,
          warnings: action.summary ? action.summary.warnings : action.warnings || 0,
          checks: list(action.checks).map((check) => ({
            id: check.id,
            label: check.label,
            status: check.status,
            message: check.message,
          })),
        })),
      },
      externalChannelReadiness: {
        status: channel.status || "UNKNOWN",
        summary: channel.summary || {},
        alertOwnerRoutes: list(channel.alertOwnerRoutes),
        operationalAlertWebhook: channel.operationalAlertWebhook || {},
        lifecycleExportDelivery: channel.lifecycleExportDelivery || {},
        blockers: list(channel.blockers),
        warnings: list(channel.warnings),
      },
      commands: buildEvidenceCommands(target, baseUrl),
    },
    reports: {
      releaseCalibration: input.calibrationReport || "",
    },
  };
}

function formatList(items, fallback) {
  const normalized = list(items).filter(Boolean);
  if (!normalized.length) return [`- ${fallback}`];
  return normalized.map((item) => `- ${item}`);
}

function buildReleaseEvidencePackReport(pack, validation = { errors: [], warnings: [] }) {
  const evidence = pack.evidence || {};
  const lines = [
    `# ${pack.title}`,
    "",
    `目标：${pack.target}`,
    `状态：${pack.status}`,
    `生成时间：${pack.generatedAt}`,
    `base_url：${pack.baseUrl || "<未提供>"}`,
    "",
    "## 摘要",
    `- 发布记录：${pack.summary.releaseStatus}`,
    `- 生产环境矩阵：${pack.summary.productionEnvStatus}`,
    `- CloudBase Job Manifest：${pack.summary.cloudbaseJobManifestStatus}`,
    `- Adapter 校准：${pack.summary.adapterCalibrationStatus}`,
    `- 动作 Adapter 校准：${pack.summary.actionAdapterCalibrationStatus}`,
    `- 外部通道与负责人：${pack.summary.externalChannelStatus}`,
    `- 发布签字：${pack.summary.signoffGateStatus}`,
    `- Admin 迁移：${pack.summary.adminTransitionStatus}`,
    `- 生产切换：${pack.summary.productionCutoverStatus}`,
    `- CloudBase Store：${pack.summary.cloudbaseStoreStatus}`,
    `- Root 会员中心购买跳转：${pack.summary.rootMemberCenterStatus}`,
    `- 生产证据收口：${pack.summary.productionEvidenceIntakeStatus}`,
    `- 阻塞：${pack.summary.blockerCount}`,
    `- 提醒：${pack.summary.warningCount}`,
    "",
    "## 必须修复",
    ...formatList(pack.blockers, "暂无阻塞项"),
    "",
    "## 灰度确认",
    ...formatList(pack.warnings, "暂无提醒项"),
    "",
    "## 生产环境矩阵",
    `- 状态：${evidence.productionEnvMatrix ? evidence.productionEnvMatrix.status : "UNKNOWN"}`,
    `- 缺失变量：${pack.summary.missingEnvCount}`,
    ...formatList(list(evidence.productionEnvMatrix && evidence.productionEnvMatrix.missingEnv).map((item) => `${item.groupLabel || item.groupId}: ${item.name}`), "暂无缺失项"),
    "",
    "## CloudBase Jobs",
    `- 状态：${evidence.cloudbaseJobManifest ? evidence.cloudbaseJobManifest.status : "UNKNOWN"}`,
    `- Job 数：${pack.summary.jobCount}`,
    ...formatList(list(evidence.cloudbaseJobManifest && evidence.cloudbaseJobManifest.jobs).map((job) => `${job.id}: ${job.cron} ${job.httpInterface}`), "暂无 Job"),
    "",
    "## 动作 Adapter 校准",
    `- 状态：${evidence.actionAdapterCalibration ? evidence.actionAdapterCalibration.status : "UNKNOWN"}`,
    ...formatList(list(evidence.actionAdapterCalibration && evidence.actionAdapterCalibration.actions).map((action) => {
      return `${action.label || action.id}: ${action.status}，Adapter=${action.adapterType || "-"}`;
    }), "暂无动作 Adapter 校准记录"),
    "",
    "## 外部通道与负责人",
    `- 状态：${evidence.externalChannelReadiness ? evidence.externalChannelReadiness.status : "UNKNOWN"}`,
    ...formatList(list(evidence.externalChannelReadiness && evidence.externalChannelReadiness.alertOwnerRoutes).map((item) => {
      const owner = [item.ownerRole, item.ownerName, item.ownerContact].filter(Boolean).join(" / ") || "未填写";
      return `${item.alertRuleId}: ${item.status}，负责人：${owner}`;
    }), "暂无负责人路由"),
    "",
    "## 发布签字",
    `- 状态：${evidence.signoffGate ? evidence.signoffGate.status : "UNKNOWN"}`,
    ...formatList(list(evidence.signoffGate && evidence.signoffGate.signoffs).map((item) => {
      return `${item.roleLabel || item.role}: ${item.status}${item.archiveId ? `，留档：${item.archiveId}` : ""}`;
    }), "暂无签字记录"),
    "",
    "## Admin 迁移 Gate",
    `- 状态：${evidence.adminTransitionReadiness ? evidence.adminTransitionReadiness.status : "UNKNOWN"}`,
    `- 下线决策：${evidence.adminTransitionReadiness && evidence.adminTransitionReadiness.legacyDeprecationDecision ? `${evidence.adminTransitionReadiness.legacyDeprecationDecision.status || "PENDING"} / ${evidence.adminTransitionReadiness.legacyDeprecationDecision.source || "NONE"}` : "PENDING / NONE"}`,
    ...formatList(list(evidence.adminTransitionReadiness && evidence.adminTransitionReadiness.moduleCoverage).map((item) => {
      return `${item.label}: ${item.status}`;
    }), "暂无 Admin 模块覆盖记录"),
    "",
    "## 生产切换 Gate",
    `- 状态：${evidence.productionCutoverReadiness ? evidence.productionCutoverReadiness.status : "UNKNOWN"}`,
    ...formatList(list(evidence.productionCutoverReadiness && evidence.productionCutoverReadiness.items).map((item) => {
      return `${item.groupLabel || item.group}: ${item.label} - ${item.status}`;
    }), "暂无生产切换证明记录"),
    "",
    "## CloudBase Store 决策",
    `- 状态：${evidence.cloudbaseStoreReadiness ? evidence.cloudbaseStoreReadiness.status : "UNKNOWN"}`,
    `- 决策：${evidence.cloudbaseStoreReadiness ? evidence.cloudbaseStoreReadiness.selectedDecisionLabel : "-"}`,
    `- 当前 Adapter：${evidence.cloudbaseStoreReadiness ? evidence.cloudbaseStoreReadiness.currentStoreAdapterKind : "-"}`,
    ...formatList(list(evidence.cloudbaseStoreReadiness && evidence.cloudbaseStoreReadiness.nextActions), "暂无后续动作"),
    "",
    "## Root 会员中心购买跳转",
    `- 状态：${evidence.rootMemberCenterReadiness ? evidence.rootMemberCenterReadiness.status : "UNKNOWN"}`,
    `- appId：${evidence.rootMemberCenterReadiness && evidence.rootMemberCenterReadiness.appId ? "<已配置>" : "<未配置>"}`,
    ...formatList(list(evidence.rootMemberCenterReadiness && evidence.rootMemberCenterReadiness.products).map((item) => {
      return `${item.productId}: ${item.status}，appid=${item.appIdConfigured ? "已配置" : "缺失"}，path=${item.pathConfigured ? "已配置" : "缺失"}，proof=${item.proofStatus || "PENDING"}`;
    }), "暂无商品跳转记录"),
    ...formatList(list(evidence.rootMemberCenterReadiness && evidence.rootMemberCenterReadiness.nextActions), "暂无后续动作"),
    "",
    "## 生产证据收口",
    `- 状态：${evidence.productionEvidenceIntake ? evidence.productionEvidenceIntake.status : "UNKNOWN"}`,
    ...formatList(list(evidence.productionEvidenceIntake && evidence.productionEvidenceIntake.items).map((item) => {
      return `${item.backlogId || item.id}: ${item.label} - ${item.status}，负责人：${item.ownerRole || "-"}`;
    }), "暂无生产证据收口项"),
    "",
    "## 留证命令",
    ...formatList(evidence.commands, "暂无命令"),
    "",
    "## 脱敏策略",
    `- ${pack.sanitization.policy}`,
  ];
  if (validation.errors && validation.errors.length) {
    lines.push("", "## 证据包错误", ...validation.errors.map((item) => `- ${item}`));
  }
  if (validation.warnings && validation.warnings.length) {
    lines.push("", "## 证据包提醒", ...validation.warnings.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}

function validateReleaseEvidencePack(pack) {
  const errors = [];
  const warnings = [];
  if (!pack || pack.version !== 1) errors.push("pack.version must be 1");
  if (!pack || !pack.evidence) errors.push("pack.evidence is required");
  if (pack && pack.sanitization && pack.sanitization.secretValuesIncluded) errors.push("secret values must not be included");
  const evidence = pack && pack.evidence ? pack.evidence : {};
  if (!evidence.releaseRecord) errors.push("releaseRecord evidence is required");
  if (!evidence.productionEnvMatrix) errors.push("productionEnvMatrix evidence is required");
  if (!evidence.cloudbaseJobManifest) errors.push("cloudbaseJobManifest evidence is required");
  if (!evidence.actionAdapterCalibration) errors.push("actionAdapterCalibration evidence is required");
  if (!evidence.externalChannelReadiness) errors.push("externalChannelReadiness evidence is required");
  if (!evidence.signoffGate) errors.push("signoffGate evidence is required");
  if (!evidence.adminTransitionReadiness) errors.push("adminTransitionReadiness evidence is required");
  if (!evidence.productionCutoverReadiness) errors.push("productionCutoverReadiness evidence is required");
  if (!evidence.cloudbaseStoreReadiness) errors.push("cloudbaseStoreReadiness evidence is required");
  if (!evidence.rootMemberCenterReadiness) errors.push("rootMemberCenterReadiness evidence is required");
  if (!evidence.productionEvidenceIntake) errors.push("productionEvidenceIntake evidence is required");
  if (!Array.isArray(evidence.commands) || !evidence.commands.some((item) => item.includes("release:evidence"))) {
    errors.push("release:evidence command must be included");
  }
  const serialized = JSON.stringify(pack || {});
  if (/ROOT_ADMIN(?:_JOB)?_TOKENS?=[^*\s]/.test(serialized)) errors.push("admin token value leaked into evidence pack");
  if (/SECRET=[^*\s]/.test(serialized)) errors.push("secret value leaked into evidence pack");
  if (pack && pack.status === "BLOCKED") warnings.push("发布证据包仍有阻塞项，不能作为正式上线签字依据");
  return {
    status: errors.length ? "FAIL" : "PASS",
    errors,
    warnings,
  };
}

module.exports = {
  buildReleaseEvidencePack,
  buildReleaseEvidencePackReport,
  normalizeBaseUrl,
  validateReleaseEvidencePack,
};
