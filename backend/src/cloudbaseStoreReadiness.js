function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function normalizeDecision(value) {
  const normalized = text(value).toUpperCase().replace(/[-\s]+/g, "_");
  if (["MYSQL", "CLOUDBASE_MYSQL", "MYSQL_ON_CLOUDBASE", "TCB_MYSQL"].includes(normalized)) {
    return "MYSQL_ON_CLOUDBASE";
  }
  if (["EXTERNAL_MYSQL", "MANAGED_MYSQL", "MYSQL_EXTERNAL"].includes(normalized)) {
    return "EXTERNAL_MYSQL";
  }
  if (["CLOUDBASE_DB", "CLOUDBASE_DATABASE", "TCB_DB", "TCB_DATABASE"].includes(normalized)) {
    return "CLOUDBASE_DATABASE";
  }
  if (["JSON", "JSON_FILE", "JSON_FILE_GRAY"].includes(normalized)) {
    return "JSON_FILE_GRAY";
  }
  return normalized || "UNDECIDED";
}

function decisionLabel(decision) {
  return {
    MYSQL_ON_CLOUDBASE: "CloudBase 云托管 MySQL",
    EXTERNAL_MYSQL: "外部托管 MySQL",
    CLOUDBASE_DATABASE: "CloudBase Database",
    JSON_FILE_GRAY: "JSON 文件灰度",
    UNDECIDED: "未决定",
  }[decision] || decision;
}

function present(env, name) {
  return Boolean(env && env[name]);
}

function firstPresent(env, names = []) {
  return names.find((name) => present(env, name)) || "";
}

function envRows(env, names = []) {
  return names.map((name) => ({ name, present: present(env, name) }));
}

function makeCheck(id, label, status, message, detail = {}) {
  return { id, label, status, message, detail };
}

function statusRank(status) {
  if (status === "BLOCKED") return 2;
  if (status === "NEEDS_REVIEW") return 1;
  return 0;
}

function summarize(checks) {
  return {
    blockerCount: checks.filter((check) => check.status === "BLOCKED").length,
    warningCount: checks.filter((check) => check.status === "NEEDS_REVIEW").length,
    readyCount: checks.filter((check) => check.status === "READY").length,
    total: checks.length,
  };
}

function statusFromChecks(checks) {
  const worst = checks.reduce((rank, check) => Math.max(rank, statusRank(check.status)), 0);
  if (worst === 2) return "BLOCKED";
  if (worst === 1) return "NEEDS_REVIEW";
  return "READY";
}

function mysqlEnvReady(env) {
  const hasAddress = present(env, "MYSQL_ADDRESS") || present(env, "MYSQL_HOST");
  return hasAddress &&
    present(env, "MYSQL_USERNAME") &&
    present(env, "MYSQL_PASSWORD") &&
    present(env, "MYSQL_DATABASE");
}

function decisionCheck(decision, target) {
  if (decision !== "UNDECIDED") {
    return makeCheck("decision", "CloudBase Store 决策", "READY", `已选择 ${decisionLabel(decision)}。`, { decision });
  }
  return makeCheck(
    "decision",
    "CloudBase Store 决策",
    target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
    "未配置 ROOT_CLOUDBASE_STORE_DECISION，无法判断生产数据仓库应走 CloudBase 云托管 MySQL、外部 MySQL 还是 CloudBase Database。",
    { decision }
  );
}

function cloudbaseEnvCheck(env, target) {
  const envIdName = firstPresent(env, ["ROOT_CLOUDBASE_ENV_ID", "CLOUDBASE_ENV_ID", "TCB_ENV_ID"]);
  const regionName = firstPresent(env, ["ROOT_CLOUDBASE_REGION", "TENCENTCLOUD_REGION"]);
  if (envIdName && regionName) {
    return makeCheck("cloudbase_env", "CloudBase 环境", "READY", "已配置 CloudBase 环境 ID 和地域变量。", {
      envIdConfiguredBy: envIdName,
      regionConfiguredBy: regionName,
    });
  }
  return makeCheck(
    "cloudbase_env",
    "CloudBase 环境",
    target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
    "需要配置 CloudBase 环境 ID 和地域，发布证据包才能定位真实云环境。",
    {
      missingEnvId: !envIdName,
      missingRegion: !regionName,
    }
  );
}

function storeAdapterCheck(decision, storeAdapter, target) {
  const kind = storeAdapter && storeAdapter.kind ? storeAdapter.kind : "memory";
  const health = storeAdapter && typeof storeAdapter.getStoreHealth === "function" ? storeAdapter.getStoreHealth() : {};
  if (decision === "JSON_FILE_GRAY") {
    return makeCheck(
      "store_adapter_match",
      "运行 Store Adapter",
      target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
      "JSON 文件只能作为灰度或演示 Store，不能作为生产 Store 决策。",
      { decision, kind }
    );
  }
  if (decision === "CLOUDBASE_DATABASE") {
    return makeCheck(
      "store_adapter_match",
      "运行 Store Adapter",
      target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
      "当前代码尚未提供 CloudBase Database Store Adapter；选择该决策前需要先实现并通过快照迁移验收。",
      { decision, kind }
    );
  }
  if (["MYSQL_ON_CLOUDBASE", "EXTERNAL_MYSQL"].includes(decision)) {
    if (kind === "mysql") {
      const proven = health.connected !== false && health.transactional === true && health.multiInstanceSafe === true &&
        Boolean(health.migrationVersion) && health.projectionMode === "core-relational" &&
        (target !== "production" || health.leastPrivilegeReady === true);
      if (proven) {
        return makeCheck("store_adapter_match", "运行 Store Adapter", "READY", "MySQL Adapter 与决策一致，事务、迁移和关系表同步证明齐全。", {
          decision,
          kind,
          migrationVersion: health.migrationVersion,
          revision: health.revision,
          projectionMode: health.projectionMode,
          leastPrivilegeReady: health.leastPrivilegeReady === true,
          privilegeScope: health.privilegeScope || "UNKNOWN",
        });
      }
      return makeCheck(
        "store_adapter_match",
        "运行 Store Adapter",
        target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
        "运行时已选择 MySQL，但尚缺事务、多实例一致性、迁移版本或核心关系表同步证明。",
        {
          decision,
          kind,
          connected: health.connected !== false,
          transactional: health.transactional === true,
          multiInstanceSafe: health.multiInstanceSafe === true,
          migrationVersion: health.migrationVersion || "",
          projectionMode: health.projectionMode || "",
          leastPrivilegeReady: health.leastPrivilegeReady === true,
          privilegeScope: health.privilegeScope || "UNKNOWN",
        }
      );
    }
    return makeCheck(
      "store_adapter_match",
      "运行 Store Adapter",
      target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
      "已选择 MySQL 生产 Store，但当前运行 Adapter 不是 mysql。",
      { decision, kind }
    );
  }
  return makeCheck(
    "store_adapter_match",
    "运行 Store Adapter",
    target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
    "生产 Store 决策未明确，无法校验当前运行 Adapter 是否匹配。",
    { decision, kind }
  );
}

function mysqlEnvCheck(decision, env, target) {
  if (!["MYSQL_ON_CLOUDBASE", "EXTERNAL_MYSQL"].includes(decision)) {
    return makeCheck("mysql_env", "MySQL 变量", "READY", "当前 Store 决策不要求 MySQL 变量。", { decision });
  }
  if (mysqlEnvReady(env)) {
    return makeCheck("mysql_env", "MySQL 变量", "READY", "已配置 MySQL 地址、账号、密码和数据库名。", {
      required: envRows(env, ["MYSQL_ADDRESS", "MYSQL_HOST", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"]),
    });
  }
  return makeCheck(
    "mysql_env",
    "MySQL 变量",
    target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
    "MySQL Store 决策需要补齐 MYSQL_ADDRESS 或 MYSQL_HOST、MYSQL_USERNAME、MYSQL_PASSWORD、MYSQL_DATABASE。",
    { required: envRows(env, ["MYSQL_ADDRESS", "MYSQL_HOST", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"]) }
  );
}

function continuityCheck(env, target) {
  const backupPlan = present(env, "ROOT_CLOUDBASE_STORE_BACKUP_PLAN");
  const rollbackPlan = present(env, "ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN");
  const proof = present(env, "ROOT_CLOUDBASE_STORE_PROOF");
  if (backupPlan && rollbackPlan && (target !== "production" || proof)) {
    return makeCheck("continuity", "备份与回滚", "READY", "已配置 Store 备份、回滚和生产证明引用。", {
      backupPlan,
      rollbackPlan,
      proof,
    });
  }
  return makeCheck(
    "continuity",
    "备份与回滚",
    target === "production" ? "BLOCKED" : "NEEDS_REVIEW",
    "需要配置 ROOT_CLOUDBASE_STORE_BACKUP_PLAN、ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN，生产发布还需要 ROOT_CLOUDBASE_STORE_PROOF。",
    { backupPlan, rollbackPlan, proof }
  );
}

function buildCloudbaseStoreReadiness(options = {}) {
  const env = options.env || process.env;
  const target = normalizeTarget(options.target);
  const decision = normalizeDecision(env.ROOT_CLOUDBASE_STORE_DECISION || env.ROOT_PRODUCTION_STORE_DECISION);
  const storeAdapter = options.storeAdapter || { kind: "memory" };
  const checks = [
    decisionCheck(decision, target),
    cloudbaseEnvCheck(env, target),
    storeAdapterCheck(decision, storeAdapter, target),
    mysqlEnvCheck(decision, env, target),
    continuityCheck(env, target),
  ];
  const summary = summarize(checks);
  const status = statusFromChecks(checks);
  const blockers = checks.filter((check) => check.status === "BLOCKED").map((check) => `${check.label}: ${check.message}`);
  const warnings = checks.filter((check) => check.status === "NEEDS_REVIEW").map((check) => `${check.label}: ${check.message}`);
  const nextActions = [];
  if (decision === "UNDECIDED") nextActions.push("确认生产 Store 决策并配置 ROOT_CLOUDBASE_STORE_DECISION。");
  if (summary.blockerCount || summary.warningCount) {
    nextActions.push("补齐 CloudBase 环境、Store 变量、备份/回滚计划后重新生成发布证据包。");
  } else {
    nextActions.push("CloudBase Store 决策证据已就绪，发布前继续核对真实快照和签字记录。");
  }
  return {
    status,
    target,
    selectedDecision: decision,
    selectedDecisionLabel: decisionLabel(decision),
    currentStoreAdapterKind: storeAdapter.kind || "memory",
    summary: {
      ...summary,
      mysqlEnvReady: mysqlEnvReady(env),
      cloudbaseEnvReady: Boolean(firstPresent(env, ["ROOT_CLOUDBASE_ENV_ID", "CLOUDBASE_ENV_ID", "TCB_ENV_ID"])) &&
        Boolean(firstPresent(env, ["ROOT_CLOUDBASE_REGION", "TENCENTCLOUD_REGION"])),
      continuityReady: present(env, "ROOT_CLOUDBASE_STORE_BACKUP_PLAN") &&
        present(env, "ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN") &&
        (target !== "production" || present(env, "ROOT_CLOUDBASE_STORE_PROOF")),
    },
    env: [
      ...envRows(env, [
        "ROOT_CLOUDBASE_STORE_DECISION",
        "ROOT_CLOUDBASE_ENV_ID",
        "CLOUDBASE_ENV_ID",
        "TCB_ENV_ID",
        "ROOT_CLOUDBASE_REGION",
        "TENCENTCLOUD_REGION",
        "ROOT_CLOUDBASE_STORE_BACKUP_PLAN",
        "ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN",
        "ROOT_CLOUDBASE_STORE_PROOF",
      ]),
      ...envRows(env, ["MYSQL_ADDRESS", "MYSQL_HOST", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"]),
    ],
    checks,
    blockers,
    warnings,
    nextActions,
  };
}

module.exports = {
  buildCloudbaseStoreReadiness,
  normalizeDecision,
};
