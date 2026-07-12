const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_ADMIN_MODULES = [
  { key: "config", label: "运营配置", file: "modules/config/ConfigWorkbench.vue" },
  { key: "users", label: "用户生命周期", file: "modules/users/UserLifecycle.vue" },
  { key: "audit", label: "审计记录", file: "modules/audit/AuditLogPage.vue" },
  { key: "adapters", label: "Adapter 运行", file: "modules/adapters/AdapterRunPage.vue" },
  { key: "analytics", label: "运营数据", file: "modules/analytics/OperationalAnalytics.vue" },
  { key: "release", label: "开发发布", file: "modules/release/ReleaseWorkbench.vue" },
];
const ADMIN_BUILD_MANIFEST_FILENAME = "admin-build-manifest.json";

function boolEnv(value) {
  return ["1", "true", "yes", "y", "approved"].includes(String(value || "").trim().toLowerCase());
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return "";
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function listRelativeFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRelativeFiles(fullPath, relativePath));
    else files.push(relativePath);
  }
  return files.sort();
}

function inspectAdminDist(dir) {
  const resolved = path.resolve(dir);
  const files = listRelativeFiles(resolved);
  const indexHtml = safeRead(path.join(resolved, "index.html"));
  const assets = files.filter((file) => file.startsWith(`assets${path.sep}`) || file.startsWith("assets/"));
  const jsAssets = assets.filter((file) => file.endsWith(".js"));
  const cssAssets = assets.filter((file) => file.endsWith(".css"));
  const ready = Boolean(indexHtml && jsAssets.length && indexHtml.includes("/admin/assets/"));
  return {
    ready,
    indexExists: Boolean(indexHtml),
    assetCount: assets.length,
    jsAssetCount: jsAssets.length,
    cssAssetCount: cssAssets.length,
    usesAdminBase: indexHtml.includes("/admin/assets/"),
  };
}

function buildModuleCoverage(projectRoot, appFile, bundledAdminDistDir) {
  const appSource = safeRead(appFile);
  const manifest = safeReadJson(path.join(bundledAdminDistDir, ADMIN_BUILD_MANIFEST_FILENAME)) || {};
  const manifestModules = new Set((manifest.modules || []).map((item) => (
    typeof item === "string" ? item : item && item.key
  )).filter(Boolean));
  return REQUIRED_ADMIN_MODULES.map((item) => {
    const modulePath = path.join(projectRoot, "admin", "src", item.file);
    const presentInApp = appSource.includes(`key: "${item.key}"`) &&
      appSource.includes(item.file.split("/").pop().replace(".vue", ""));
    const fileExists = fs.existsSync(modulePath);
    const presentInBuildManifest = manifestModules.has(item.key);
    return {
      key: item.key,
      label: item.label,
      file: item.file,
      presentInApp,
      fileExists,
      presentInBuildManifest,
      evidenceSource: presentInApp && fileExists ? "SOURCE" : presentInBuildManifest ? "BUILD_MANIFEST" : "NONE",
      status: (presentInApp && fileExists) || presentInBuildManifest ? "READY" : "BLOCKED",
    };
  });
}

function normalizeDecision(value = {}) {
  const status = String(value.status || "").trim().toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(status)) return null;
  return {
    source: "RECORD",
    status,
    approved: status === "APPROVED",
    evidenceRef: value.evidenceRef || value.evidence_ref || "",
    rollbackRef: value.rollbackRef || value.rollback_ref || "",
    decidedAt: value.decidedAt || value.decided_at || "",
    operatorId: value.operatorId || value.operator_id || "",
    requestId: value.requestId || value.request_id || "",
    note: value.note || "",
  };
}

function latestLegacyDeprecationDecision(decisions = []) {
  if (!Array.isArray(decisions)) return null;
  for (const item of decisions) {
    const decision = normalizeDecision(item);
    if (decision) return decision;
  }
  return null;
}

function buildLegacyDeprecationDecision(env, decisions = []) {
  const recordDecision = latestLegacyDeprecationDecision(decisions);
  if (recordDecision) return recordDecision;
  const envApproved = boolEnv(env.ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED || env.ROOT_ADMIN_LEGACY_DEPRECATION_APPROVED);
  return {
    source: envApproved ? "ENV" : "NONE",
    status: envApproved ? "APPROVED" : "PENDING",
    approved: envApproved,
    evidenceRef: "",
    rollbackRef: "",
    decidedAt: "",
    operatorId: "",
    requestId: "",
    note: "",
  };
}

function buildAdminTransitionReadiness(options = {}) {
  const backendRootFromSource = path.resolve(__dirname, "..");
  const monorepoRootFromSource = path.resolve(backendRootFromSource, "..");
  const defaultProjectRoot = fs.existsSync(path.join(monorepoRootFromSource, "backend", "public"))
    ? monorepoRootFromSource
    : backendRootFromSource;
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const backendRoot = fs.existsSync(path.join(projectRoot, "backend", "public"))
    ? path.join(projectRoot, "backend")
    : projectRoot;
  const backendOnlyLayout = backendRoot === projectRoot;
  const env = options.env || process.env;
  const sourceAdminDistDir = options.sourceAdminDistDir || path.join(projectRoot, "admin", "dist");
  const bundledAdminDistDir = options.bundledAdminDistDir || path.join(backendRoot, "public", "admin-dist");
  const elementAdminDir = options.elementAdminDir || (fs.existsSync(path.join(sourceAdminDistDir, "index.html"))
    ? sourceAdminDistDir
    : bundledAdminDistDir);
  const legacyAdminFile = options.legacyAdminFile || path.join(backendRoot, "public", "admin.html");
  const appFile = options.appFile || path.join(projectRoot, "admin", "src", "App.vue");
  const source = inspectAdminDist(sourceAdminDistDir);
  const bundled = inspectAdminDist(bundledAdminDistDir);
  const effective = inspectAdminDist(elementAdminDir);
  const moduleCoverage = buildModuleCoverage(projectRoot, appFile, bundledAdminDistDir);
  const legacyFallbackAvailable = fs.existsSync(legacyAdminFile);
  const legacyDeprecationDecision = buildLegacyDeprecationDecision(env, options.deprecationDecisions || []);
  const deprecationApproved = legacyDeprecationDecision.approved;
  const blockers = [];
  const warnings = [];
  const missingModules = moduleCoverage.filter((item) => item.status !== "READY");
  if (missingModules.length) {
    blockers.push(`Element Plus Admin 缺少模块：${missingModules.map((item) => item.label).join("、")}`);
  }
  if (!effective.ready) blockers.push("Element Plus Admin dist 未就绪，/admin 仍可能回退旧静态后台");
  if (!bundled.ready) blockers.push("backend-only Admin dist 未准备，发布前需运行 npm run deploy:prepare-admin");
  if (!legacyFallbackAvailable && !deprecationApproved && legacyDeprecationDecision.status === "REJECTED") {
    blockers.push("旧静态后台回退入口缺失，且最新下线决策为 REJECTED");
  } else if (!legacyFallbackAvailable && !deprecationApproved) {
    blockers.push("旧静态后台回退入口缺失，且尚未批准下线");
  }
  if (!source.ready && !backendOnlyLayout) warnings.push("本地 admin/dist 未生成，需在发布流水线执行 npm run admin:build");
  if (legacyFallbackAvailable && legacyDeprecationDecision.status === "REJECTED") {
    warnings.push("最新旧静态后台下线决策为 REJECTED，继续保留 /admin-legacy");
  } else if (legacyFallbackAvailable && !deprecationApproved) {
    warnings.push("旧静态后台下线尚未批准，继续保留 /admin-legacy 作为回退入口");
  }
  const status = blockers.length ? "BLOCKED" : warnings.length ? "NEEDS_REVIEW" : "READY";
  return {
    status,
    summary: {
      requiredModuleCount: REQUIRED_ADMIN_MODULES.length,
      readyModuleCount: moduleCoverage.filter((item) => item.status === "READY").length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      sourceDistReady: source.ready,
      bundledDistReady: bundled.ready,
      effectiveDistReady: effective.ready,
      legacyFallbackAvailable,
      deprecationApproved,
      deprecationSource: legacyDeprecationDecision.source,
      deprecationDecisionStatus: legacyDeprecationDecision.status,
      backendOnlyLayout,
    },
    legacyDeprecationDecision,
    dist: {
      source,
      bundled,
      effective,
    },
    moduleCoverage,
    blockers,
    warnings,
  };
}

module.exports = {
  ADMIN_BUILD_MANIFEST_FILENAME,
  REQUIRED_ADMIN_MODULES,
  buildAdminTransitionReadiness,
  inspectAdminDist,
};
