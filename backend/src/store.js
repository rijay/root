const fs = require("node:fs");
const path = require("node:path");

const { createSeedData } = require("./seed");
const { minimizePersistedExternalEvidence } = require("./externalEvidenceSanitizer");

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_STORE_KEY = "root-checkin";
const MYSQL_SCHEMA_VERSION = 4;
const MYSQL_STORE_KEY = "root-checkin";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(target, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(target) ? target : clone(defaults);
  if (!defaults || typeof defaults !== "object") return target === undefined ? defaults : target;
  const next = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (next[key] === undefined) {
      next[key] = clone(value);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = mergeDefaults(next[key], value);
    }
  });
  return next;
}

function createEmptyData() {
  const data = createSeedData();
  data.youzanProducts = [];
  data.youzanSkus = [];
  data.campaignProductRelations = [];
  data.productJumpLogs = [];
  data.youzanCustomers = [];
  data.youzanIdentityReconciliations = [];
  data.campaignDefinitions = [];
  data.campaignParticipants = [];
  data.taskDefinitions = [];
  data.taskEvents = [];
  data.taskProgressSnapshots = [];
  data.notificationTemplates = [];
  data.notificationSubscriptions = [];
  data.notificationJobs = [];
  data.notificationDeliveries = [];
  data.questionnaireAnswers = [];
  data.campaignRuleVersions = [];
  data.settlementRecords = [];
  data.rewardInventoryPools = [];
  data.rewardInventoryReservations = [];
  data.rewardGrants = [];
  data.rewardRecoveryRecords = [];
  data.rewardDeliveryJobs = [];
  data.manualReviewItems = [];
  data.adminLifecycleFilterPresets = [];
  data.adminLifecycleSettlementJobs = [];
  data.adminLifecycleUserExports = [];
  data.operationalAlertRules = [];
  data.operationalAlertRuns = [];
  data.operationalAlertNotifications = [];
  data.releaseEvidenceArchives = [];
  data.releaseSignoffs = [];
  data.adminLegacyDeprecationDecisions = [];
  data.productionCutoverProofs = [];
  data.rootMemberCenterJumpProofs = [];
  data.legacyDataMigrationDecisions = [];
  data.legacyDataMigrationExecutions = [];
  data.consultationAdvisorAssignments = [];
  data.consultationWeworkWritebacks = [];
  data.weworkTouchJobs = [];
  data.orderAfterSalesRecords = [];
  data.youzanOrders = [];
  data.orderFulfillments = [];
  data.events = [];
  return data;
}

function defaultsForOptions(options = {}) {
  return options.seedSampleData ? createSeedData() : createEmptyData();
}

function normalizeStoreData(rawData, options = {}) {
  return minimizePersistedExternalEvidence(mergeDefaults(rawData || {}, defaultsForOptions(options)));
}

function validateSnapshot(snapshot, options = {}) {
  const errors = [];
  const warnings = [];
  const defaults = defaultsForOptions({ seedSampleData: false, ...options });

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      valid: false,
      errors: ["snapshot must be an object"],
      warnings,
      counts: {},
    };
  }

  Object.entries(defaults).forEach(([key, defaultValue]) => {
    const value = snapshot[key];
    if (value === undefined) {
      errors.push(`missing key: ${key}`);
      return;
    }
    if (Array.isArray(defaultValue) && !Array.isArray(value)) {
      errors.push(`key ${key} must be an array`);
      return;
    }
    if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`key ${key} must be an object`);
    }
  });

  const duplicateChecks = [
    ["users", "user_id"],
    ["rootUsers", "root_user_id"],
    ["wechatIdentities", "wechat_identity_id"],
    ["privacyConsentRecords", "privacy_consent_record_id"],
    ["youzanProducts", "youzan_product_id"],
    ["youzanSkus", "youzan_sku_id"],
    ["campaignProductRelations", "campaign_product_relation_id"],
    ["productJumpLogs", "product_jump_log_id"],
    ["campaignDefinitions", "campaign_id"],
    ["campaignParticipants", "campaign_participant_id"],
    ["taskDefinitions", "task_definition_id"],
    ["taskEvents", "task_event_id"],
    ["taskProgressSnapshots", "task_progress_snapshot_id"],
    ["notificationTemplates", "notification_template_id"],
    ["notificationSubscriptions", "notification_subscription_id"],
    ["notificationJobs", "notification_job_id"],
    ["notificationJobs", "idempotency_key"],
    ["notificationDeliveries", "notification_delivery_id"],
    ["campaignRuleVersions", "campaign_rule_version_id"],
    ["settlementRecords", "settlement_record_id"],
    ["rewardInventoryPools", "reward_inventory_pool_id"],
    ["rewardInventoryReservations", "reward_inventory_reservation_id"],
    ["rewardInventoryReservations", "idempotency_key"],
    ["rewardGrants", "reward_grant_id"],
    ["rewardRecoveryRecords", "reward_recovery_record_id"],
    ["rewardRecoveryRecords", "idempotency_key"],
    ["rewardDeliveryJobs", "reward_delivery_job_id"],
    ["manualReviewItems", "manual_review_item_id"],
    ["adminLifecycleFilterPresets", "preset_id"],
    ["adminLifecycleSettlementJobs", "job_id"],
    ["adminLifecycleUserExports", "export_id"],
    ["operationalAlertRules", "alert_rule_id"],
    ["operationalAlertRuns", "operational_alert_run_id"],
    ["operationalAlertNotifications", "operational_alert_notification_id"],
    ["releaseEvidenceArchives", "archive_id"],
    ["releaseEvidenceArchives", "request_id"],
    ["releaseSignoffs", "signoff_id"],
    ["releaseSignoffs", "request_id"],
    ["adminLegacyDeprecationDecisions", "decision_id"],
    ["adminLegacyDeprecationDecisions", "request_id"],
    ["productionCutoverProofs", "proof_id"],
    ["productionCutoverProofs", "request_id"],
    ["rootMemberCenterJumpProofs", "proof_id"],
    ["rootMemberCenterJumpProofs", "request_id"],
    ["legacyDataMigrationDecisions", "decision_id"],
    ["legacyDataMigrationDecisions", "request_id"],
    ["legacyDataMigrationExecutions", "execution_id"],
    ["legacyDataMigrationExecutions", "request_id"],
    ["youzanIdentityReconciliations", "reconciliation_id"],
    ["consultationAdvisorAssignments", "assignment_id"],
    ["consultationAdvisorAssignments", "request_id"],
    ["consultationWeworkWritebacks", "writeback_id"],
    ["consultationWeworkWritebacks", "request_id"],
    ["weworkTouchJobs", "wework_touch_job_id"],
    ["weworkTouchJobs", "idempotency_key"],
    ["orderAfterSalesRecords", "order_after_sales_record_id"],
    ["orderAfterSalesRecords", "after_sales_no"],
    ["orderAfterSalesRecords", "idempotency_key"],
    ["youzanOrders", "order_id"],
    ["youzanOrders", "youzan_order_no"],
    ["orderFulfillments", "fulfillment_id"],
    ["checkinSessions", "session_id"],
    ["operationTasks", "task_id"],
    ["userContactMethods", "contact_method_id"],
    ["userLifecycleEvents", "lifecycle_event_id"],
    ["importBatches", "batch_id"],
    ["auditLogs", "audit_id"],
  ];
  duplicateChecks.forEach(([listKey, idKey]) => {
    const list = snapshot[listKey];
    if (!Array.isArray(list)) return;
    const seen = new Set();
    list.forEach((item) => {
      const id = item && item[idKey];
      if (!id) return;
      if (seen.has(id)) errors.push(`duplicate ${listKey}.${idKey}: ${id}`);
      seen.add(id);
    });
  });

  const orderIds = new Set(Array.isArray(snapshot.youzanOrders) ? snapshot.youzanOrders.map((order) => order.order_id).filter(Boolean) : []);
  if (Array.isArray(snapshot.orderFulfillments)) {
    snapshot.orderFulfillments.forEach((fulfillment) => {
      if (fulfillment.order_id && !orderIds.has(fulfillment.order_id)) {
        warnings.push(`fulfillment references missing order: ${fulfillment.order_id}`);
      }
    });
  }
  if (Array.isArray(snapshot.orderAfterSalesRecords)) {
    snapshot.orderAfterSalesRecords.forEach((record) => {
      if (record.order_id && !orderIds.has(record.order_id)) {
        warnings.push(`after sales record references missing order: ${record.order_id}`);
      }
    });
  }

  const counts = Object.fromEntries(Object.keys(defaults)
    .filter((key) => Array.isArray(snapshot[key]))
    .map((key) => [key, snapshot[key].length]));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
  };
}

function replaceStoreData(target, nextData, options = {}) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, normalizeStoreData(clone(nextData || {}), options));
  return target;
}

function createMemoryStore(initialData, options = { seedSampleData: true }) {
  const data = normalizeStoreData(initialData || defaultsForOptions(options), options);
  const adapter = {
    kind: "memory",
    data,
    save() {},
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "memory",
        schemaVersion: null,
        lastSavedAt: "",
        persistent: false,
      };
    },
  };
  return adapter;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function createJsonFileStore(filePath, options = {}) {
  if (!filePath) throw new Error("JSON store path is required");
  const absolutePath = path.resolve(filePath);
  const data = normalizeStoreData(readJsonFile(absolutePath) || defaultsForOptions(options), options);
  let lastSavedAt = "";
  const adapter = {
    kind: "json-file",
    filePath: absolutePath,
    data,
    save() {
      writeJsonFile(absolutePath, data);
      lastSavedAt = new Date().toISOString();
    },
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      adapter.save();
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "json-file",
        filePath: absolutePath,
        schemaVersion: null,
        lastSavedAt,
        persistent: true,
      };
    },
  };
  adapter.save();
  return adapter;
}

function createSqliteStore(filePath, options = {}) {
  if (!filePath) throw new Error("SQLite store path is required");
  const { DatabaseSync } = require("node:sqlite");
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS root_store_snapshot (
      store_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT payload_json FROM root_store_snapshot WHERE store_key = ?").get(SQLITE_STORE_KEY);
  const data = normalizeStoreData(row ? JSON.parse(row.payload_json) : defaultsForOptions(options), options);
  let lastSavedAt = "";

  const adapter = {
    kind: "sqlite",
    filePath: absolutePath,
    data,
    save() {
      const payload = JSON.stringify(data);
      const updatedAt = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT INTO root_store_snapshot (store_key, schema_version, payload_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(store_key) DO UPDATE SET
            schema_version = excluded.schema_version,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(SQLITE_STORE_KEY, SQLITE_SCHEMA_VERSION, payload, updatedAt);
        db.exec("COMMIT");
        lastSavedAt = updatedAt;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      return adapter.save();
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    close() {
      db.close();
    },
    getStoreHealth() {
      return {
        kind: "sqlite",
        filePath: absolutePath,
        schemaVersion: SQLITE_SCHEMA_VERSION,
        lastSavedAt,
        persistent: true,
      };
    },
  };
  adapter.save();
  return adapter;
}

function parseMysqlAddress(address = "") {
  const [hostPart, portPart] = String(address || "").split(":");
  return {
    host: hostPart || "127.0.0.1",
    port: Number(portPart || 3306),
  };
}

function mysqlConfigFromEnv(env = process.env) {
  const address = parseMysqlAddress(env.MYSQL_ADDRESS || "");
  return {
    host: env.MYSQL_HOST || address.host,
    port: Number(env.MYSQL_PORT || address.port || 3306),
    user: env.MYSQL_USERNAME || env.MYSQL_USER || "root",
    password: env.MYSQL_PASSWORD || "",
    database: env.MYSQL_DATABASE || "root_checkin",
    connectionLimit: Math.max(1, Number(env.MYSQL_CONNECTION_LIMIT || 8)),
    connectTimeout: Math.max(1000, Number(env.MYSQL_CONNECT_TIMEOUT_MS || 10000)),
  };
}

function validateMysqlConfig(config = {}) {
  const required = ["host", "user", "password", "database"];
  const missing = required.filter((key) => !String(config[key] || "").trim());
  if (missing.length) throw new Error(`MySQL configuration missing: ${missing.join(", ")}`);
  if (!Number.isInteger(Number(config.port)) || Number(config.port) <= 0) throw new Error("MySQL port must be a positive integer");
  return config;
}

function parseMysqlPayload(value) {
  if (!value) return null;
  if (typeof value === "string") return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  if (typeof value === "object") return clone(value);
  return JSON.parse(String(value));
}

async function createMysqlStore(config = {}, options = {}) {
  const mysql = require("mysql2/promise");
  const { applyMysqlMigrations } = require("./mysqlMigrations");
  const { changedCollectionKeys, syncCoreProjections } = require("./mysqlProjection");
  const {
    assertMysqlPrivilegePolicy,
    readMysqlPrivilegePolicy,
    readMysqlPrivilegePolicyFromConnection,
  } = require("./mysqlPrivilegePolicy");
  const mergedConfig = validateMysqlConfig({
    ...mysqlConfigFromEnv(),
    ...config,
  });
  const database = mergedConfig.database;
  const pool = mysql.createPool({
    host: mergedConfig.host,
    port: Number(mergedConfig.port || 3306),
    user: mergedConfig.user,
    password: mergedConfig.password,
    database,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(mergedConfig.connectionLimit || 8)),
    queueLimit: 0,
    connectTimeout: Math.max(1000, Number(mergedConfig.connectTimeout || 10000)),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  const policyEnv = options.env || process.env;
  let privilegePolicy;
  let migrationState;
  try {
    privilegePolicy = await readMysqlPrivilegePolicy(pool, { database, env: policyEnv });
    assertMysqlPrivilegePolicy(privilegePolicy);
    migrationState = await applyMysqlMigrations(pool, { ...options, database });
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
  const initialData = normalizeStoreData(defaultsForOptions(options), options);
  const initialConnection = await pool.getConnection();
  try {
    await initialConnection.execute(
      `
        INSERT IGNORE INTO root_store_snapshot
          (store_key, schema_version, revision, payload_json, updated_at)
        VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP(3))
      `,
      [MYSQL_STORE_KEY, MYSQL_SCHEMA_VERSION, JSON.stringify(initialData)]
    );
  } finally {
    initialConnection.release();
  }

  const [rows] = await pool.execute(
    "SELECT payload_json, updated_at, revision FROM root_store_snapshot WHERE store_key = ?",
    [MYSQL_STORE_KEY]
  );
  const data = normalizeStoreData(rows[0] ? parseMysqlPayload(rows[0].payload_json) : initialData, options);
  let operationQueue = Promise.resolve();
  let lastSavedAt = rows[0] ? String(rows[0].updated_at || "") : "";
  let lastReadAt = new Date().toISOString();
  let lastError = "";
  let revision = Number(rows[0] && rows[0].revision || 0);
  let closing = false;
  let lastProjection = { tables: [], rows: {} };

  function enqueue(operation) {
    if (closing) return Promise.reject(new Error("MySQL Store is closing"));
    const next = operationQueue.then(operation, operation);
    operationQueue = next.catch(() => {});
    return next;
  }

  async function selectSnapshot(connection, lock = false) {
    const [snapshotRows] = await connection.execute(
      `SELECT payload_json, updated_at, revision FROM root_store_snapshot WHERE store_key = ?${lock ? " FOR UPDATE" : ""}`,
      [MYSQL_STORE_KEY]
    );
    if (!snapshotRows[0]) throw new Error("MySQL root_store_snapshot row is missing");
    return snapshotRows[0];
  }

  async function writeSnapshot(connection, snapshot, nextRevision) {
    await connection.execute(
      `
        UPDATE root_store_snapshot
        SET schema_version = ?, revision = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE store_key = ?
      `,
      [MYSQL_SCHEMA_VERSION, nextRevision, JSON.stringify(snapshot), MYSQL_STORE_KEY]
    );
  }

  async function persistSnapshot(snapshot, persistOptions = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await selectSnapshot(connection, true);
      const currentRevision = Number(row.revision || 0);
      if (persistOptions.expectedRevision !== undefined && currentRevision !== Number(persistOptions.expectedRevision)) {
        const error = new Error(`MySQL Store revision conflict: expected ${persistOptions.expectedRevision}, found ${currentRevision}`);
        error.code = "STORE_REVISION_CONFLICT";
        throw error;
      }
      const before = normalizeStoreData(parseMysqlPayload(row.payload_json), options);
      const normalized = normalizeStoreData(clone(snapshot), options);
      const changedKeys = changedCollectionKeys(before, normalized);
      const nextRevision = changedKeys.size ? currentRevision + 1 : currentRevision;
      if (changedKeys.size) await writeSnapshot(connection, normalized, nextRevision);
      lastProjection = await syncCoreProjections(connection, normalized, {
        force: persistOptions.forceProjection === true,
        changedKeys: persistOptions.forceProjection === true ? null : changedKeys,
      });
      await connection.commit();
      replaceStoreData(data, normalized, options);
      revision = nextRevision;
      lastReadAt = new Date().toISOString();
      if (changedKeys.size) lastSavedAt = lastReadAt;
      lastError = "";
      return { revision, projection: lastProjection };
    } catch (error) {
      await connection.rollback().catch(() => {});
      lastError = error.message;
      throw error;
    } finally {
      connection.release();
    }
  }

  async function projectLatestSnapshot() {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await selectSnapshot(connection, true);
      const raw = parseMysqlPayload(row.payload_json);
      const latest = normalizeStoreData(clone(raw), options);
      const normalizedKeys = changedCollectionKeys(raw, latest);
      const currentRevision = Number(row.revision || 0);
      const nextRevision = normalizedKeys.size ? currentRevision + 1 : currentRevision;
      if (normalizedKeys.size) await writeSnapshot(connection, latest, nextRevision);
      lastProjection = await syncCoreProjections(connection, latest, { force: true });
      await connection.commit();
      replaceStoreData(data, latest, options);
      revision = nextRevision;
      lastReadAt = new Date().toISOString();
      lastSavedAt = normalizedKeys.size ? lastReadAt : String(row.updated_at || lastSavedAt || "");
      lastError = "";
      return { revision, projection: lastProjection };
    } catch (error) {
      await connection.rollback().catch(() => {});
      lastError = error.message;
      throw error;
    } finally {
      connection.release();
    }
  }

  const adapter = {
    kind: "mysql",
    data,
    config: {
      host: mergedConfig.host,
      port: Number(mergedConfig.port || 3306),
      database,
      user: mergedConfig.user,
      connectionLimit: Math.max(1, Number(mergedConfig.connectionLimit || 8)),
    },
    save() {
      const snapshot = clone(data);
      const expectedRevision = revision;
      return enqueue(() => persistSnapshot(snapshot, { expectedRevision }));
    },
    importSnapshot(snapshot) {
      const normalized = normalizeStoreData(snapshot, options);
      return enqueue(() => persistSnapshot(normalized, { forceProjection: true }));
    },
    exportSnapshot() {
      return clone(data);
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "mysql",
        schemaVersion: MYSQL_SCHEMA_VERSION,
        migrationVersion: migrationState.latestVersion,
        migrationCount: migrationState.versions.length,
        revision,
        lastSavedAt,
        lastReadAt,
        lastError,
        persistent: true,
        connected: !lastError,
        transactional: true,
        multiInstanceSafe: true,
        projectionMode: "core-relational",
        projectionTables: lastProjection.tables,
        leastPrivilegeReady: privilegePolicy.ready === true,
        privilegeScope: privilegePolicy.scope,
        privilegePolicyEnforced: privilegePolicy.enforced === true,
        database,
        host: mergedConfig.host,
        port: Number(mergedConfig.port || 3306),
        connectionLimit: Math.max(1, Number(mergedConfig.connectionLimit || 8)),
      };
    },
    runRequest(requestOptions = {}, work) {
      return enqueue(async () => {
        const connection = await pool.getConnection();
        let before = null;
        let phase = "store";
        try {
          await connection.beginTransaction();
          const row = await selectSnapshot(connection, true);
          before = normalizeStoreData(parseMysqlPayload(row.payload_json), options);
          replaceStoreData(data, before, options);
          revision = Number(row.revision || 0);
          lastReadAt = new Date().toISOString();
          phase = "work";
          const result = await work(data);
          const shouldCommit = typeof requestOptions.shouldCommit === "function"
            ? requestOptions.shouldCommit()
            : requestOptions.write !== false;
          if (!shouldCommit) {
            await connection.rollback();
            replaceStoreData(data, before, options);
            lastError = "";
            return result;
          }
          const after = adapter.exportSnapshot();
          const changedKeys = changedCollectionKeys(before, after);
          phase = "store";
          if (!changedKeys.size) {
            await connection.commit();
            lastError = "";
            return result;
          }
          const nextRevision = revision + 1;
          await writeSnapshot(connection, after, nextRevision);
          lastProjection = await syncCoreProjections(connection, after, {
            changedKeys,
          });
          await connection.commit();
          revision = nextRevision;
          lastSavedAt = new Date().toISOString();
          lastError = "";
          return result;
        } catch (error) {
          const rollbackError = await connection.rollback().then(() => null, (failure) => failure);
          if (before) replaceStoreData(data, before, options);
          if (phase === "store" || rollbackError) lastError = (rollbackError || error).message;
          throw error;
        } finally {
          connection.release();
        }
      });
    },
    async checkHealth() {
      const connection = await pool.getConnection();
      try {
        await connection.query("SELECT 1 AS ok");
        privilegePolicy = await readMysqlPrivilegePolicyFromConnection(connection, { database, env: policyEnv });
        assertMysqlPrivilegePolicy(privilegePolicy);
        const [migrationRows] = await connection.query(
          "SELECT COUNT(*) AS migration_count, MAX(version) AS latest_version FROM schema_migrations"
        );
        const row = await selectSnapshot(connection, false);
        revision = Number(row.revision || 0);
        lastReadAt = new Date().toISOString();
        lastError = "";
        return {
          ok: true,
          revision,
          migrationVersion: migrationRows[0] && migrationRows[0].latest_version || "",
          migrationCount: Number(migrationRows[0] && migrationRows[0].migration_count || 0),
          leastPrivilegeReady: privilegePolicy.ready === true,
          privilegeScope: privilegePolicy.scope,
          privilegePolicyEnforced: privilegePolicy.enforced === true,
        };
      } catch (error) {
        lastError = error.message;
        return { ok: false, error: error.message };
      } finally {
        connection.release();
      }
    },
    async close() {
      await operationQueue;
      closing = true;
      await pool.end();
    },
  };
  await enqueue(projectLatestSnapshot);
  return adapter;
}

module.exports = {
  createJsonFileStore,
  createEmptyData,
  createMemoryStore,
  createMysqlStore,
  createSqliteStore,
  mysqlConfigFromEnv,
  normalizeStoreData,
  parseMysqlPayload,
  validateMysqlConfig,
  validateSnapshot,
};
