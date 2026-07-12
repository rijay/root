const APP_ID_ENV_NAMES = [
  "ROOT_MEMBER_CENTER_APPID",
  "ROOT_YOUZAN_APP_ID",
  "YOUZAN_MINIPROGRAM_APPID",
  "YOUZAN_MINI_APP_ID",
  "YOUZAN_APP_ID",
];

const PATH_ENV_NAMES = [
  "ROOT_MEMBER_CENTER_PRODUCT_PATH",
  "ROOT_YOUZAN_PRODUCT_PATH",
  "YOUZAN_PRODUCT_PATH",
  "YOUZAN_MINIPROGRAM_PRODUCT_PATH",
];

const ENV_VERSION_ENV_NAMES = [
  "ROOT_MEMBER_CENTER_ENV_VERSION",
  "ROOT_YOUZAN_ENV_VERSION",
  "YOUZAN_ENV_VERSION",
];

const PLACEHOLDER_APP_IDS = ["", "wx1234567890abcdef", "wx0000000000000000"];

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return Array.from(new Set(list(items).map((item) => text(item)).filter(Boolean)));
}

function present(env, name) {
  return Boolean(text(env && env[name]));
}

function isConfiguredAppId(appId) {
  return !PLACEHOLDER_APP_IDS.includes(text(appId));
}

function envRows(env, names = [], options = {}) {
  return names.map((name) => {
    const value = text(env && env[name]);
    const configured = options.appId ? isConfiguredAppId(value) : Boolean(value);
    return {
      name,
      present: Boolean(value),
      configured,
      placeholder: options.appId ? Boolean(value) && !configured : false,
    };
  });
}

function firstEnvValue(env, names = [], predicate = (value) => Boolean(text(value))) {
  for (const name of names) {
    const value = text(env && env[name]);
    if (predicate(value)) return { value, source: name };
  }
  return { value: "", source: "" };
}

function activeProducts(data) {
  return list(data && data.youzanProducts).filter((product) => text(product.status, "ACTIVE").toUpperCase() === "ACTIVE");
}

function severityForTarget(target) {
  return target === "production" ? "BLOCKED" : "NEEDS_REVIEW";
}

function makeCheck(id, label, status, message, detail = {}) {
  return { id, label, status, message, detail };
}

function statusRank(status) {
  if (status === "BLOCKED") return 2;
  if (status === "NEEDS_REVIEW") return 1;
  return 0;
}

function statusFromChecks(checks) {
  const worst = checks.reduce((rank, check) => Math.max(rank, statusRank(check.status)), 0);
  if (worst === 2) return "BLOCKED";
  if (worst === 1) return "NEEDS_REVIEW";
  return "READY";
}

function resolveAppId(product, env) {
  const global = firstEnvValue(env, APP_ID_ENV_NAMES, isConfiguredAppId);
  if (global.value) return global;
  if (isConfiguredAppId(product.youzan_app_id)) {
    return { value: text(product.youzan_app_id), source: "PRODUCT" };
  }
  return { value: "", source: "" };
}

function resolvePath(product, env) {
  const productPath = text(product.youzan_path);
  if (productPath) return { value: productPath, source: "PRODUCT" };
  return firstEnvValue(env, PATH_ENV_NAMES);
}

function productProofForRow(row, proofs) {
  const exact = list(proofs).find((proof) => text(proof.productId) === row.productId);
  return exact || list(proofs).find((proof) => text(proof.productId) === "*") || null;
}

function proofMatchesRow(proof, row) {
  if (!proof || proof.status !== "VERIFIED") return false;
  return text(proof.appId) === row.appId && text(proof.path) === row.path;
}

function productReadinessRows(products, env, options = {}) {
  const target = normalizeTarget(options.target);
  const proofSeverity = severityForTarget(target);
  return products.map((product) => {
    const appId = resolveAppId(product, env);
    const path = resolvePath(product, env);
    const missing = [];
    if (!appId.value) missing.push("appid");
    if (!path.value) missing.push("path");
    const baseRow = {
      productId: text(product.youzan_product_id),
      title: text(product.title),
      appId: appId.value,
      appIdConfigured: Boolean(appId.value),
      appIdSource: appId.source,
      pathConfigured: Boolean(path.value),
      pathSource: path.source,
      path: path.value,
    };
    const proof = productProofForRow(baseRow, options.proofs || []);
    const proofRequired = !missing.length;
    const proofReady = proofRequired && proofMatchesRow(proof, baseRow);
    const proofRejected = proof && proof.status === "REJECTED";
    const proofMismatch = proofRequired && proof && proof.status === "VERIFIED" && !proofReady;
    let status = "READY";
    let message = "购买跳转目标与体验版跳转证明已就绪。";
    if (missing.length) {
      status = "BLOCKED";
      message = `缺少 ${missing.join(" / ")}，无法从 myRoot 跳转购买。`;
    } else if (proofRejected) {
      status = "BLOCKED";
      message = "最新跳转证明为 REJECTED，需要重新实测并记录 VERIFIED。";
    } else if (proofMismatch) {
      status = proofSeverity;
      message = "最新跳转证明的 appId 或路径与当前配置不一致。";
    } else if (!proofReady) {
      status = proofSeverity;
      message = target === "production"
        ? "生产发布前必须记录体验版跳 Root 会员中心的 VERIFIED 证明。"
        : "灰度前建议记录体验版跳 Root 会员中心的 VERIFIED 证明。";
    }
    return {
      ...baseRow,
      status,
      message,
      proofRequired,
      proofReady,
      proofRejected: Boolean(proofRejected),
      proofMismatch: Boolean(proofMismatch),
      proofStatus: proof ? proof.status : "PENDING",
      proofSource: proof ? (proof.productId === "*" ? "WILDCARD" : "PRODUCT") : "",
      proofRecord: proof || null,
      proofRecordedAt: proof ? proof.recordedAt : "",
    };
  });
}

function buildChecks({ target, products, rows, configuredAppIds }) {
  const missingSeverity = severityForTarget(target);
  const activeProductCount = products.length;
  const missingAppIdCount = rows.filter((row) => !row.appIdConfigured).length;
  const missingPathCount = rows.filter((row) => !row.pathConfigured).length;
  const proofRequiredRows = rows.filter((row) => row.proofRequired);
  const missingProofCount = proofRequiredRows.filter((row) => !row.proofReady && !row.proofRejected && !row.proofMismatch).length;
  const rejectedProofCount = rows.filter((row) => row.proofRejected).length;
  const proofMismatchCount = rows.filter((row) => row.proofMismatch).length;
  const checks = [];

  checks.push(activeProductCount
    ? makeCheck("active_products", "活跃商品", "READY", `已找到 ${activeProductCount} 个活跃展示商品。`)
    : makeCheck("active_products", "活跃商品", missingSeverity, "没有活跃商品快照，myRoot 商品页无法展示可购买商品。"));

  checks.push(activeProductCount && missingAppIdCount === 0
    ? makeCheck("root_member_center_appid", "Root 会员中心 appId", "READY", "所有活跃商品都能解析到 Root 会员中心 appId。")
    : makeCheck("root_member_center_appid", "Root 会员中心 appId", missingSeverity, "需要配置 ROOT_MEMBER_CENTER_APPID，或在商品快照中补齐 youzan_app_id。", { missingAppIdCount }));

  checks.push(activeProductCount && missingPathCount === 0
    ? makeCheck("product_path", "购买路径", "READY", "所有活跃商品都能解析到购买路径。")
    : makeCheck("product_path", "购买路径", missingSeverity, "需要从有赞商品同步或后台手工维护购买路径，避免商品页无法跳转。", { missingPathCount }));

  checks.push(configuredAppIds.length > 1
    ? makeCheck("appid_consistency", "appId 一致性", "NEEDS_REVIEW", "检测到多个 Root 会员中心 appId 候选值，需要确认是否指向同一微信小程序。", { configuredAppIds })
    : makeCheck("appid_consistency", "appId 一致性", "READY", "未发现 appId 冲突。", { configuredAppIds }));

  if (!activeProductCount || !proofRequiredRows.length) {
    checks.push(makeCheck("trial_jump_proof", "体验版跳转证明", "READY", "配置项补齐后再记录商品页体验版跳转证明。", {
      missingProofCount,
      rejectedProofCount,
      proofMismatchCount,
    }));
  } else if (rejectedProofCount) {
    checks.push(makeCheck("trial_jump_proof", "体验版跳转证明", "BLOCKED", "存在 REJECTED 跳转证明，需要重新实测并记录 VERIFIED。", {
      missingProofCount,
      rejectedProofCount,
      proofMismatchCount,
    }));
  } else if (proofMismatchCount) {
    checks.push(makeCheck("trial_jump_proof", "体验版跳转证明", missingSeverity, "跳转证明的 appId 或路径与当前配置不一致。", {
      missingProofCount,
      rejectedProofCount,
      proofMismatchCount,
    }));
  } else {
    checks.push(missingProofCount === 0
      ? makeCheck("trial_jump_proof", "体验版跳转证明", "READY", "所有可跳转商品都有 VERIFIED 体验版跳转证明。", { missingProofCount, rejectedProofCount, proofMismatchCount })
      : makeCheck("trial_jump_proof", "体验版跳转证明", missingSeverity, "需要在后台记录 myRoot 商品页跳 Root 会员中心的体验版实测证明。", { missingProofCount, rejectedProofCount, proofMismatchCount }));
  }

  return checks;
}

function summarize(checks, rows, products) {
  return {
    total: checks.length,
    readyCount: checks.filter((check) => check.status === "READY").length,
    blockerCount: checks.filter((check) => check.status === "BLOCKED").length,
    warningCount: checks.filter((check) => check.status === "NEEDS_REVIEW").length,
    activeProductCount: products.length,
    readyProductCount: rows.filter((row) => row.status === "READY").length,
    missingAppIdCount: rows.filter((row) => !row.appIdConfigured).length,
    missingPathCount: rows.filter((row) => !row.pathConfigured).length,
    verifiedProofCount: rows.filter((row) => row.proofReady).length,
    missingProofCount: rows.filter((row) => row.proofRequired && !row.proofReady && !row.proofRejected && !row.proofMismatch).length,
    rejectedProofCount: rows.filter((row) => row.proofRejected).length,
    proofMismatchCount: rows.filter((row) => row.proofMismatch).length,
    appIdConflictCount: Math.max(0, checks.find((check) => check.id === "appid_consistency")?.detail?.configuredAppIds?.length - 1 || 0),
  };
}

function buildNextActions(status, summary) {
  if (status === "READY") {
    return ["Root 会员中心购买跳转已就绪，发布前保留最新体验版跳转证明。"];
  }
  const actions = [];
  if (!summary.activeProductCount) actions.push("先同步或手工维护 Root 会员中心商品快照，并确认至少一个商品为 ACTIVE。");
  if (summary.missingAppIdCount) actions.push("配置 ROOT_MEMBER_CENTER_APPID，或在商品快照中补齐 youzan_app_id。");
  if (summary.missingPathCount) actions.push("通过有赞商品同步或后台手工维护 youzan_path / ROOT_MEMBER_CENTER_PRODUCT_PATH。");
  if (summary.appIdConflictCount) actions.push("统一 ROOT_MEMBER_CENTER_APPID 与商品快照中的 appId，确认只跳到 Root 会员中心。");
  if (summary.rejectedProofCount) actions.push("对 REJECTED 商品重新执行体验版跳转测试，并记录 VERIFIED 证明。");
  if (summary.proofMismatchCount) actions.push("更新 Root 会员中心 appId/path 或重新记录与当前配置一致的跳转证明。");
  if (summary.missingProofCount) actions.push("在 Element Plus Admin 开发发布页记录商品级体验版跳转证明。");
  return actions;
}

function buildRootMemberCenterReadiness(options = {}) {
  const env = options.env || process.env;
  const target = normalizeTarget(options.target);
  const products = activeProducts(options.data || {});
  const proofs = list(options.proofs);
  const rows = productReadinessRows(products, env, { target, proofs });
  const envAppIds = APP_ID_ENV_NAMES.map((name) => env && env[name]).filter(isConfiguredAppId);
  const productAppIds = products.map((product) => product.youzan_app_id).filter(isConfiguredAppId);
  const configuredAppIds = unique(envAppIds.concat(productAppIds));
  const checks = buildChecks({ target, products, rows, configuredAppIds });
  const status = statusFromChecks(checks);
  const summary = summarize(checks, rows, products);
  const globalAppId = firstEnvValue(env, APP_ID_ENV_NAMES, isConfiguredAppId);
  const defaultPath = firstEnvValue(env, PATH_ENV_NAMES);
  const envVersion = firstEnvValue(env, ENV_VERSION_ENV_NAMES);

  return {
    status,
    target,
    appId: globalAppId.value || configuredAppIds[0] || "",
    appIdSource: globalAppId.source || (configuredAppIds[0] ? "PRODUCT" : ""),
    defaultPath: defaultPath.value,
    defaultPathSource: defaultPath.source,
    envVersion: envVersion.value || "release",
    summary,
    env: [
      ...envRows(env, APP_ID_ENV_NAMES, { appId: true }),
      ...envRows(env, PATH_ENV_NAMES),
      ...envRows(env, ENV_VERSION_ENV_NAMES),
    ],
    proofs: proofs.slice(0, 50),
    products: rows.slice(0, 50),
    checks,
    blockers: checks.filter((check) => check.status === "BLOCKED").map((check) => `${check.label}: ${check.message}`),
    warnings: checks.filter((check) => check.status === "NEEDS_REVIEW").map((check) => `${check.label}: ${check.message}`),
    nextActions: buildNextActions(status, summary),
  };
}

module.exports = {
  APP_ID_ENV_NAMES,
  PATH_ENV_NAMES,
  buildRootMemberCenterReadiness,
  isConfiguredAppId,
};
