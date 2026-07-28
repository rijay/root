const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const mysql = require("mysql2/promise");
const {
  applyMysqlMigrations,
  listMigrationFiles,
} = require("../src/mysqlMigrations");
const {
  assertDisposableSnapshotServer,
} = require("../src/mysqlSchemaSnapshot");
const {
  createMysqlSettlementSourceInvalidationResolveAdapter,
} = require("../src/settlementSourceInvalidationResolveAdapter");
const {
  MYSQL_SCOPE_PAGE_SIZE,
  createMysqlSettlementSourceInvalidationReadAdapter,
} = require("../src/settlementSourceInvalidationReadAdapter");

const ENABLED = process.env.SETTLEMENT_SOURCE_AUTHORITY_MYSQL_INTEGRATION_ENABLED === "true";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DATABASE_PREFIX = "myroot_settlement_source_authority_it_";
const FORBIDDEN_DATABASE_TOKENS = /(?:^|_)(?:prod(?:uction)?|live|candidate|release|staging|uat)(?:_|$)/i;
const EXPECTED_LAST_MIGRATION = "066_v1_runtime_alert_delivery_severity_slo_authority.sql";
const EXPECTED_MIGRATION_COUNT = 66;

const ACQUIRE_AUTHORITY_SQL = `/* settlement_source_authority_integration:authority */
INSERT INTO settlement_source_authority (
  root_user_id, campaign_id, created_at, updated_at
) VALUES (?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE root_user_id = VALUES(root_user_id)`;

function integrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertLocalHost(host) {
  if (!LOCAL_HOSTS.has(String(host || "").toLowerCase())) {
    throw integrationError("SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN");
  }
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(String(identifier || ""))) {
    throw integrationError("SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_DATABASE_NAME_INVALID");
  }
  return `\`${identifier}\``;
}

function assertDisposableDatabaseName(database) {
  const value = String(database || "");
  if (!value.startsWith(DATABASE_PREFIX)
    || !/^myroot_settlement_source_authority_it_[0-9]+_[0-9a-f]{16}$/.test(value)
    || FORBIDDEN_DATABASE_TOKENS.test(value)) {
    throw integrationError("SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_DATABASE_NOT_DISPOSABLE");
  }
  quoteIdentifier(value);
  return value;
}

function integrationConfig(env = process.env) {
  const host = String(env.SCHEMA_SNAPSHOT_MYSQL_HOST || "127.0.0.1");
  assertLocalHost(host);
  const port = Number(env.SCHEMA_SNAPSHOT_MYSQL_PORT || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw integrationError("SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_PORT_INVALID");
  }
  return Object.freeze({
    host,
    port,
    user: String(env.SCHEMA_SNAPSHOT_MYSQL_USER || "root"),
    password: String(env.SCHEMA_SNAPSHOT_MYSQL_PASSWORD || ""),
    charset: "utf8mb4",
    timezone: "+08:00",
  });
}

function createDatabaseName() {
  return assertDisposableDatabaseName(
    `${DATABASE_PREFIX}${process.pid}_${crypto.randomBytes(8).toString("hex")}`
  );
}

function createRuntimePool(serverConfig, database) {
  return mysql.createPool({
    ...serverConfig,
    database,
    connectionLimit: 6,
    waitForConnections: true,
    queueLimit: 0,
    namedPlaceholders: false,
    dateStrings: true,
  });
}

async function closePool(pool, cleanupErrors) {
  if (!pool) return;
  try {
    await pool.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
}

async function closeConnection(connection, cleanupErrors) {
  if (!connection) return;
  try {
    await connection.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
}

function indexColumns(rows, indexName) {
  return rows
    .filter((row) => row.INDEX_NAME === indexName)
    .sort((left, right) => Number(left.SEQ_IN_INDEX) - Number(right.SEQ_IN_INDEX))
    .map((row) => row.COLUMN_NAME);
}

async function assertMigration62Structure(pool, database) {
  const [indexRows] = await pool.execute(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME IN (
         'settlement_source_authority',
         'settlement_source_resolution_audit',
         'manual_review_item'
       )`,
    [database]
  );
  const authorityIndexes = indexRows.filter((row) => (
    row.TABLE_NAME === "settlement_source_authority"
  ));
  assert.deepEqual(indexColumns(authorityIndexes, "PRIMARY"), [
    "root_user_id",
    "campaign_id",
  ]);

  const auditIndexes = indexRows.filter((row) => (
    row.TABLE_NAME === "settlement_source_resolution_audit"
  ));
  assert.deepEqual(indexColumns(
    auditIndexes,
    "uk_settlement_source_resolution_candidate"
  ), ["manual_review_item_id"]);
  assert.deepEqual(indexColumns(
    auditIndexes,
    "uk_settlement_source_resolution_request"
  ), ["request_id"]);
  assert.equal(
    Number(auditIndexes.find((row) => (
      row.INDEX_NAME === "uk_settlement_source_resolution_candidate"
    )).NON_UNIQUE),
    0
  );
  assert.equal(
    Number(auditIndexes.find((row) => (
      row.INDEX_NAME === "uk_settlement_source_resolution_request"
    )).NON_UNIQUE),
    0
  );
  assert.deepEqual(indexColumns(
    auditIndexes,
    "idx_settlement_source_resolution_scope"
  ), [
    "root_user_id",
    "campaign_id",
    "created_at",
    "settlement_source_resolution_audit_id",
  ]);

  const reviewIndexes = indexRows.filter((row) => row.TABLE_NAME === "manual_review_item");
  assert.deepEqual(indexColumns(reviewIndexes, "idx_manual_review_source_scope"), [
    "source_type",
    "root_user_id",
    "campaign_id",
    "created_at",
    "manual_review_item_id",
  ]);

  const [foreignKeyRows] = await pool.execute(
    `SELECT CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION,
            REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'settlement_source_resolution_audit'
       AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
    [database]
  );
  assert.deepEqual(foreignKeyRows.map((row) => ({
    constraint: row.CONSTRAINT_NAME,
    column: row.COLUMN_NAME,
    referencedTable: row.REFERENCED_TABLE_NAME,
    referencedColumn: row.REFERENCED_COLUMN_NAME,
  })), [
    {
      constraint: "fk_settlement_source_resolution_authority",
      column: "root_user_id",
      referencedTable: "settlement_source_authority",
      referencedColumn: "root_user_id",
    },
    {
      constraint: "fk_settlement_source_resolution_authority",
      column: "campaign_id",
      referencedTable: "settlement_source_authority",
      referencedColumn: "campaign_id",
    },
    {
      constraint: "fk_settlement_source_resolution_candidate",
      column: "manual_review_item_id",
      referencedTable: "manual_review_item",
      referencedColumn: "manual_review_item_id",
    },
  ]);
}

async function assertAuthorityLockWait(poolA, poolB) {
  const connectionA = await poolA.getConnection();
  const connectionB = await poolB.getConnection();
  try {
    await connectionA.query("SET SESSION innodb_lock_wait_timeout = 1");
    await connectionB.query("SET SESSION innodb_lock_wait_timeout = 1");
    await connectionA.beginTransaction();
    await connectionA.execute(ACQUIRE_AUTHORITY_SQL, [
      "root-lock-it",
      "campaign-lock-it",
    ]);

    await connectionB.beginTransaction();
    await assert.rejects(
      () => connectionB.execute(ACQUIRE_AUTHORITY_SQL, [
        "root-lock-it",
        "campaign-lock-it",
      ]),
      (error) => Number(error && error.errno) === 1205
        || (error && error.code) === "ER_LOCK_WAIT_TIMEOUT"
    );
    await connectionB.rollback();
    await connectionA.commit();
  } finally {
    try { await connectionA.rollback(); } catch {}
    try { await connectionB.rollback(); } catch {}
    connectionA.release();
    connectionB.release();
  }

  const [rows] = await poolA.execute(
    `SELECT COUNT(*) AS authority_count
     FROM settlement_source_authority
     WHERE root_user_id = ? AND campaign_id = ?`,
    ["root-lock-it", "campaign-lock-it"]
  );
  assert.equal(Number(rows[0].authority_count), 1);
}

async function seedCandidate(pool, candidateId, rootUserId, campaignId) {
  await pool.execute(ACQUIRE_AUTHORITY_SQL, [rootUserId, campaignId]);
  await pool.execute(
    `INSERT INTO manual_review_item (
       manual_review_item_id, root_user_id, campaign_id, review_type,
       source_type, source_id, reason, status, priority, metadata,
       idempotency_key, operator_id, resolved_at, resolution,
       created_at, updated_at
     ) VALUES (
       ?, ?, ?, 'SETTLEMENT_STOP_CANDIDATE',
       'TASK_SOURCE_INVALIDATION', ?, 'SOURCE_CANCELED', 'OPEN', 'HIGH', JSON_OBJECT(),
       ?, NULL, NULL, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
     )`,
    [
      candidateId,
      rootUserId,
      campaignId,
      `source-${candidateId}`,
      `idempotency-${candidateId}`,
    ]
  );
}

function createCandidateReadAdapter(connection) {
  return Object.freeze({
    async readCandidateForUpdate(_snapshot, input) {
      await connection.execute(ACQUIRE_AUTHORITY_SQL, [
        input.rootUserId,
        input.campaignId,
      ]);
      const [rows] = await connection.execute(
        `SELECT manual_review_item_id, root_user_id, campaign_id, review_type,
                source_type, status, operator_id, resolution, metadata,
                resolved_at, updated_at
         FROM manual_review_item
         WHERE manual_review_item_id = ?
           AND root_user_id = ?
           AND campaign_id = ?
           AND source_type = 'TASK_SOURCE_INVALIDATION'
         LIMIT 2
         FOR UPDATE`,
        [input.candidateId, input.rootUserId, input.campaignId]
      );
      if (rows.length === 0) return null;
      assert.equal(rows.length, 1);
      const row = rows[0];
      return {
        ...row,
        metadata: typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata,
      };
    },
  });
}

async function resolveInTransaction(pool, input) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const adapter = createMysqlSettlementSourceInvalidationResolveAdapter(
      connection,
      createCandidateReadAdapter(connection)
    );
    const result = await adapter.resolve({}, input);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

function resolutionInput(candidateId, rootUserId, campaignId, requestId) {
  return Object.freeze({
    candidateId,
    rootUserId,
    campaignId,
    requestId,
    operatorId: "operator-settlement-it",
    resolution: "STOP_CONFIRMED",
    resolutionNote: "integration resolution",
    publicNote: null,
  });
}

async function readCandidateState(pool, candidateIds) {
  const placeholders = candidateIds.map(() => "?").join(", ");
  const [rows] = await pool.execute(
    `SELECT manual_review_item_id, status, operator_id, resolution,
            metadata, resolved_at, updated_at
     FROM manual_review_item
     WHERE manual_review_item_id IN (${placeholders})
     ORDER BY manual_review_item_id`,
    candidateIds
  );
  return rows.map((row) => ({
    ...row,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
  }));
}

function digest(domain, ...parts) {
  const hash = crypto.createHash("sha256").update(`${domain}\0`, "utf8");
  for (const part of parts) {
    hash.update(String(part), "utf8").update("\0", "utf8");
  }
  return hash.digest("hex");
}

function sourceInvalidationId(assignmentId, sourceEventId) {
  const value = crypto.createHash("sha256")
    .update(
      `myroot:task-source-invalidation:v1:${assignmentId}\0${sourceEventId}`,
      "utf8"
    )
    .digest("hex");
  return `task_invalid_${value.slice(0, 51)}`;
}

function sourceCandidateId(invalidationId, ruleId, ruleVersion) {
  return `mri_${digest(
    "myroot:settlement-source-invalidation-candidate:v1",
    invalidationId,
    ruleId,
    ruleVersion
  ).slice(0, 28)}`;
}

async function seedPaginationCandidate(
  pool,
  fixture,
  rootUserId,
  enrollmentId,
  ordinal
) {
  const suffix = String(ordinal).padStart(3, "0");
  const rootSuffix = rootUserId === fixture.targetRootUserId ? "target" : "side";
  const assignmentId = `assign-page-${rootSuffix}-${suffix}`;
  const sourceEventId = `cancel-page-${rootSuffix}-${suffix}`;
  const confirmedEventId = `confirm-page-${rootSuffix}-${suffix}`;
  const taskDefinitionVersion = `task-page-v-${suffix}`;
  const invalidationId = sourceInvalidationId(assignmentId, sourceEventId);
  const candidateId = sourceCandidateId(
    invalidationId,
    fixture.ruleId,
    fixture.ruleVersion
  );
  const metadata = {
    contractVersion: 1,
    handlerVersion: "settlement-source-invalidation-v1",
    candidateKind: "STOP_OR_CANCEL",
    decision: "STOP_AUTOMATIC_SETTLEMENT",
    appendOnly: true,
    taskSourceInvalidationEventId: invalidationId,
    taskActivityAssignmentId: assignmentId,
    rootUserId,
    campaignId: fixture.campaignId,
    taskDefinitionId: fixture.taskDefinitionId,
    taskDefinitionVersion,
    activityEnrollmentId: enrollmentId,
    activitySessionId: fixture.activitySessionId,
    sourceConfirmedEventId: confirmedEventId,
    sourceEventId,
    sourceEventType: "activity.enrollment.canceled.v1",
    sourceCancellationReasonCode: "USER_CANCELED",
    reasonCode: "SOURCE_CANCELED",
    sourceInvalidatedAt: fixture.invalidatedAt,
    campaignRuleVersionId: fixture.ruleId,
    ruleVersion: fixture.ruleVersion,
    originalSettlementRecordId: null,
    originalSettlementStatus: null,
    originalSettlementEvaluatedAt: null,
  };

  await pool.execute(
    `INSERT INTO task_activity_assignment (
       task_activity_assignment_id, root_user_id, task_definition_id,
       task_definition_version, activity_enrollment_id, activity_session_id,
       initial_status, source_confirmed_event_id, source_confirmed_event_type,
       source_confirmed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', ?,
       'activity.enrollment.confirmed.v1', ?, ?, ?)`,
    [
      assignmentId,
      rootUserId,
      fixture.taskDefinitionId,
      taskDefinitionVersion,
      enrollmentId,
      fixture.activitySessionId,
      confirmedEventId,
      fixture.confirmedAt,
      fixture.confirmedAt,
      fixture.confirmedAt,
    ]
  );
  await pool.execute(
    `INSERT INTO task_source_invalidation_event (
       task_source_invalidation_event_id, task_activity_assignment_id,
       source_event_id, source_event_type, reason_code, occurred_at, created_at
     ) VALUES (?, ?, ?, 'activity.enrollment.canceled.v1', 'USER_CANCELED', ?, ?)`,
    [
      invalidationId,
      assignmentId,
      sourceEventId,
      fixture.invalidatedAt,
      fixture.invalidatedAt,
    ]
  );
  await pool.execute(
    `INSERT INTO manual_review_item (
       manual_review_item_id, root_user_id, campaign_id, review_type,
       source_type, source_id, reason, status, priority, metadata,
       idempotency_key, operator_id, resolved_at, resolution,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'SETTLEMENT_STOP_CANDIDATE',
       'TASK_SOURCE_INVALIDATION', ?, 'TASK_SOURCE_INVALIDATED', 'OPEN', 'HIGH', ?,
       ?, NULL, NULL, NULL, ?, ?)`,
    [
      candidateId,
      rootUserId,
      fixture.campaignId,
      invalidationId,
      JSON.stringify(metadata),
      [
        "task-source-invalidation",
        invalidationId,
        "rule",
        fixture.ruleId,
        fixture.ruleVersion,
      ].join(":"),
      fixture.invalidatedAt,
      fixture.invalidatedAt,
    ]
  );
  return candidateId;
}

async function seedPaginationEvidence(pool) {
  const fixture = Object.freeze({
    targetRootUserId: "root-page-target",
    sideRootUserId: "root-page-side",
    campaignId: "campaign-page-it",
    taskDefinitionId: "task-page-it",
    ruleId: "rule-page-it",
    ruleVersion: 1,
    activityVersionId: "activity-version-page-it",
    activitySessionId: "activity-session-page-it",
    targetEnrollmentId: "enrollment-page-target",
    sideEnrollmentId: "enrollment-page-side",
    confirmedAt: "2026-08-01 08:00:00.000",
    invalidatedAt: "2026-08-02 08:00:00.000",
  });
  await pool.execute(
    `INSERT INTO activity_definition_version (
       activity_version_id, activity_id, version, status, title, summary,
       detail_version, city, venue_summary, activity_type, hero_asset_ref,
       privacy_notice_ref, photography_notice_ref, content_approval_ref,
       contact_owner_signer_ref, source, visibility, created_at, updated_at
     ) VALUES (?, 'activity-page-it', 1, 'DRAFT', 'Pagination integration',
       'Disposable evidence chain', 'detail-page-v1', 'Shanghai',
       'Disposable venue', 'HEALTH', 'asset:page-it', 'privacy:page-it',
       'photography:page-it', 'content:page-it', 'signer:page-it',
       'OPS_BACKEND', 'MEMBER', ?, ?)`,
    [fixture.activityVersionId, fixture.confirmedAt, fixture.confirmedAt]
  );
  await pool.execute(
    `INSERT INTO activity_session (
       activity_session_id, activity_version_id, status, approval_mode, capacity,
       registration_open_at, registration_close_at, cancel_close_at,
       review_deadline, session_start_at, session_end_at, allow_reapply,
       created_at, updated_at
     ) VALUES (?, ?, 'OPEN', 'AUTO', 200,
       '2026-07-01 00:00:00.000', '2026-07-20 00:00:00.000',
       '2026-07-25 00:00:00.000', NULL, '2026-08-10 00:00:00.000',
       '2026-08-10 02:00:00.000', 1, ?, ?)`,
    [
      fixture.activitySessionId,
      fixture.activityVersionId,
      fixture.confirmedAt,
      fixture.confirmedAt,
    ]
  );
  await pool.execute(
    `INSERT INTO task_definition (
       task_definition_id, campaign_id, task_type, title, required,
       display_order, status, created_at, updated_at
     ) VALUES (?, ?, 'ACTIVITY', 'Pagination task', 1, 10, 'ACTIVE', ?, ?)`,
    [
      fixture.taskDefinitionId,
      fixture.campaignId,
      fixture.confirmedAt,
      fixture.confirmedAt,
    ]
  );
  await pool.execute(
    `INSERT INTO campaign_rule_version (
       campaign_rule_version_id, campaign_id, version, status,
       conditions_json, rewards_json, published_at, created_at, updated_at
     ) VALUES (?, ?, ?, 'PUBLISHED', JSON_OBJECT(), JSON_OBJECT(),
       '2026-07-01 00:00:00.000', '2026-07-01 00:00:00.000',
       '2026-07-01 00:00:00.000')`,
    [fixture.ruleId, fixture.campaignId, fixture.ruleVersion]
  );

  for (const rootUserId of [fixture.targetRootUserId, fixture.sideRootUserId]) {
    await pool.execute(
      `INSERT INTO root_user (
         root_user_id, lifecycle_status, source_channel, unionid_status,
         created_at, updated_at
       ) VALUES (?, 'ACTIVE', 'MYSQL_INTEGRATION', 'MISSING', ?, ?)`,
      [rootUserId, fixture.confirmedAt, fixture.confirmedAt]
    );
  }
  for (const [rootUserId, enrollmentId] of [
    [fixture.targetRootUserId, fixture.targetEnrollmentId],
    [fixture.sideRootUserId, fixture.sideEnrollmentId],
  ]) {
    await pool.execute(
      `INSERT INTO activity_enrollment (
         activity_enrollment_id, activity_session_id, root_user_id, status,
         reason_code, attempt_generation, created_at, updated_at
       ) VALUES (?, ?, ?, 'CONFIRMED', NULL, 1, ?, ?)`,
      [
        enrollmentId,
        fixture.activitySessionId,
        rootUserId,
        fixture.confirmedAt,
        fixture.confirmedAt,
      ]
    );
  }

  const targetCandidateIds = [];
  for (let ordinal = 0; ordinal < 130; ordinal += 1) {
    targetCandidateIds.push(await seedPaginationCandidate(
      pool,
      fixture,
      fixture.targetRootUserId,
      fixture.targetEnrollmentId,
      ordinal
    ));
  }
  const sideCandidateId = await seedPaginationCandidate(
    pool,
    fixture,
    fixture.sideRootUserId,
    fixture.sideEnrollmentId,
    0
  );
  return Object.freeze({
    ...fixture,
    targetCandidateIds: Object.freeze(targetCandidateIds),
    sideCandidateId,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return Object.freeze({ promise, resolve, reject });
}

async function waitForCondition(check, description, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 2_000);
  const pollMs = Number(options.pollMs || 20);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw integrationError(
    `SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_WAIT_TIMEOUT:${description}`
  );
}

async function waitForAuthorityLockWait(pool, database) {
  return waitForCondition(async () => {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS wait_count
       FROM performance_schema.data_lock_waits AS waits
       INNER JOIN performance_schema.data_locks AS requested_lock
         ON requested_lock.ENGINE = waits.ENGINE
        AND requested_lock.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
       WHERE requested_lock.OBJECT_SCHEMA = ?
         AND requested_lock.OBJECT_NAME = 'settlement_source_authority'`,
      [database]
    );
    return Number(rows[0] && rows[0].wait_count) > 0;
  }, "observable settlement_source_authority lock wait");
}

function createPausedRecordingConnection(connection) {
  const firstPage = deferred();
  const releaseFirstPage = deferred();
  const sqlCalls = [];
  const pageSizes = [];
  let paused = false;
  return Object.freeze({
    connection: Object.freeze({
      async execute(sql, parameters) {
        const text = String(sql);
        sqlCalls.push(text);
        const result = await connection.execute(sql, parameters);
        if (text.includes("settlement_source_invalidation_read:scope_first")
          || text.includes("settlement_source_invalidation_read:scope_next")) {
          pageSizes.push(Array.isArray(result && result[0]) ? result[0].length : -1);
        }
        if (!paused && text.includes("settlement_source_invalidation_read:scope_first")) {
          paused = true;
          firstPage.resolve();
          await releaseFirstPage.promise;
        }
        return result;
      },
    }),
    firstPage: firstPage.promise,
    release() {
      releaseFirstPage.resolve();
    },
    sqlCalls,
    pageSizes,
  });
}

async function assertReaderPaginationAndAuthorityLock(poolA, poolB, database) {
  assert.equal(MYSQL_SCOPE_PAGE_SIZE, 64);
  const fixture = await seedPaginationEvidence(poolA);
  const readerConnection = await poolA.getConnection();
  const writerConnection = await poolB.getConnection();
  const paused = createPausedRecordingConnection(readerConnection);
  let writerPromise = null;
  let readerCommitted = false;
  try {
    await readerConnection.beginTransaction();
    await writerConnection.query("SET SESSION innodb_lock_wait_timeout = 10");
    const adapter = createMysqlSettlementSourceInvalidationReadAdapter(paused.connection);
    const snapshot = {
      manualReviewItems: [],
      campaignRuleVersions: [{
        campaign_rule_version_id: fixture.ruleId,
        campaign_id: fixture.campaignId,
        version: fixture.ruleVersion,
        status: "PUBLISHED",
        published_at: "2026-07-01 00:00:00.000",
      }],
      settlementRecords: [],
    };
    const hydrationPromise = adapter.hydrateRequestState(snapshot, [{
      rootUserId: fixture.targetRootUserId,
      campaignId: fixture.campaignId,
    }]);
    await paused.firstPage;

    await writerConnection.beginTransaction();
    let writerSettled = false;
    writerPromise = writerConnection.execute(ACQUIRE_AUTHORITY_SQL, [
      fixture.targetRootUserId,
      fixture.campaignId,
    ]).then((result) => {
      writerSettled = true;
      return result;
    }, (error) => {
      writerSettled = true;
      throw error;
    });
    assert.equal(await waitForAuthorityLockWait(poolA, database), true);
    assert.equal(
      writerSettled,
      false,
      "the same-scope Writer must wait while the Reader owns authority"
    );

    paused.release();
    const hydrated = await hydrationPromise;
    assert.equal(hydrated.loadedScopeCount, 1);
    assert.equal(hydrated.candidateCount, 130);
    assert.equal(hydrated.data.manualReviewItems.length, 130);
    assert.equal(writerSettled, false, "the Writer must remain blocked before Reader commit");

    const loadedIds = hydrated.data.manualReviewItems.map((row) => (
      row.manual_review_item_id
    ));
    assert.equal(new Set(loadedIds).size, 130);
    assert.deepEqual(loadedIds, [...loadedIds].sort());
    assert.deepEqual(
      [...loadedIds].sort(),
      [...fixture.targetCandidateIds].sort()
    );
    assert.equal(loadedIds.includes(fixture.sideCandidateId), false);
    assert.ok(hydrated.data.manualReviewItems.every((row) => (
      row.root_user_id === fixture.targetRootUserId
      && row.campaign_id === fixture.campaignId
    )));

    const firstPageCalls = paused.sqlCalls.filter((sql) => (
      sql.includes("settlement_source_invalidation_read:scope_first")
    ));
    const nextPageCalls = paused.sqlCalls.filter((sql) => (
      sql.includes("settlement_source_invalidation_read:scope_next")
    ));
    assert.equal(firstPageCalls.length, 1);
    assert.equal(nextPageCalls.length, 2);
    assert.equal(firstPageCalls.length + nextPageCalls.length, 3);
    assert.deepEqual(paused.pageSizes, [64, 64, 2]);

    const prepared = adapter.prepareSnapshotForPersistence(hydrated.data);
    assert.deepEqual(prepared.manualReviewItems, []);
    await readerConnection.commit();
    readerCommitted = true;
    await writerPromise;
    await writerConnection.rollback();
  } finally {
    paused.release();
    if (!readerCommitted) {
      try { await readerConnection.rollback(); } catch {}
    }
    if (writerPromise) {
      try { await writerPromise; } catch {}
    }
    try { await writerConnection.rollback(); } catch {}
    readerConnection.release();
    writerConnection.release();
  }
}

async function assertResolutionSemantics(poolA, poolB) {
  const sameCandidateId = "mri_resolve_same_000000000001";
  const sameInput = resolutionInput(
    sameCandidateId,
    "root-resolve-same",
    "campaign-resolve-same",
    "request-resolve-same"
  );
  await seedCandidate(
    poolA,
    sameCandidateId,
    sameInput.rootUserId,
    sameInput.campaignId
  );

  const sameRequestResults = await Promise.all([
    resolveInTransaction(poolA, sameInput),
    resolveInTransaction(poolB, sameInput),
  ]);
  assert.deepEqual(
    sameRequestResults.map((result) => result.replayed).sort(),
    [false, true]
  );
  assert.equal(sameRequestResults[0].audit.auditId, sameRequestResults[1].audit.auditId);
  const [sameAuditRows] = await poolA.execute(
    `SELECT COUNT(*) AS audit_count
     FROM settlement_source_resolution_audit
     WHERE manual_review_item_id = ? AND request_id = ?`,
    [sameCandidateId, sameInput.requestId]
  );
  assert.equal(Number(sameAuditRows[0].audit_count), 1);

  const leftCandidateId = "mri_resolve_left_000000000001";
  const rightCandidateId = "mri_resolve_right_00000000001";
  const sharedRequestId = "request-resolve-conflict";
  const leftInput = resolutionInput(
    leftCandidateId,
    "root-resolve-left",
    "campaign-resolve-left",
    sharedRequestId
  );
  const rightInput = resolutionInput(
    rightCandidateId,
    "root-resolve-right",
    "campaign-resolve-right",
    sharedRequestId
  );
  await seedCandidate(poolA, leftCandidateId, leftInput.rootUserId, leftInput.campaignId);
  await seedCandidate(poolA, rightCandidateId, rightInput.rootUserId, rightInput.campaignId);

  const conflictingResults = await Promise.allSettled([
    resolveInTransaction(poolA, leftInput),
    resolveInTransaction(poolB, rightInput),
  ]);
  const fulfilled = conflictingResults.filter((result) => result.status === "fulfilled");
  const rejected = conflictingResults.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok([
    "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT",
    "SETTLEMENT_SOURCE_RESOLUTION_PERSISTENCE_FAILED",
    "ER_LOCK_DEADLOCK",
  ].includes(rejected[0].reason && rejected[0].reason.code));

  const [conflictAuditRows] = await poolA.execute(
    `SELECT manual_review_item_id, request_id
     FROM settlement_source_resolution_audit
     WHERE request_id = ?`,
    [sharedRequestId]
  );
  assert.equal(conflictAuditRows.length, 1);
  const winnerId = conflictAuditRows[0].manual_review_item_id;
  const loserId = winnerId === leftCandidateId ? rightCandidateId : leftCandidateId;
  const states = await readCandidateState(poolA, [leftCandidateId, rightCandidateId]);
  const winner = states.find((row) => row.manual_review_item_id === winnerId);
  const loser = states.find((row) => row.manual_review_item_id === loserId);
  assert.equal(winner.status, "RESOLVED");
  assert.equal(winner.operator_id, "operator-settlement-it");
  assert.equal(winner.resolution, "STOP_CONFIRMED");
  assert.equal(winner.metadata.resolutionNote, "integration resolution");
  assert.equal(loser.status, "OPEN");
  assert.equal(loser.operator_id, null);
  assert.equal(loser.resolution, null);
  assert.equal(loser.resolved_at, null);
  assert.deepEqual(loser.metadata, {});

  const loserInput = loserId === leftCandidateId ? leftInput : rightInput;
  await assert.rejects(
    () => resolveInTransaction(poolA, loserInput),
    { code: "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT" }
  );
  const [loserAfterRetry] = await readCandidateState(poolA, [loserId]);
  assert.equal(loserAfterRetry.status, "OPEN");
  assert.deepEqual(loserAfterRetry.metadata, {});

  await assert.rejects(
    () => poolA.execute(
      `INSERT INTO settlement_source_resolution_audit (
         settlement_source_resolution_audit_id, manual_review_item_id,
         root_user_id, campaign_id, request_id, operator_id, resolution,
         resolution_note, public_note, before_status, after_status,
         candidate_resolved_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'OPEN', 'RESOLVED',
                 CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
      [
        "f".repeat(64),
        "mri_missing_candidate_00000001",
        sameInput.rootUserId,
        sameInput.campaignId,
        "request-missing-candidate",
        "operator-settlement-it",
        "STOP_CONFIRMED",
        "missing candidate must fail",
      ]
    ),
    (error) => Number(error && error.errno) === 1452
      || (error && error.code) === "ER_NO_REFERENCED_ROW_2"
  );

  await assert.rejects(
    () => poolA.execute(
      `INSERT INTO settlement_source_resolution_audit (
         settlement_source_resolution_audit_id, manual_review_item_id,
         root_user_id, campaign_id, request_id, operator_id, resolution,
         resolution_note, public_note, before_status, after_status,
         candidate_resolved_at, created_at
       ) SELECT ?, manual_review_item_id, root_user_id, campaign_id, ?,
                operator_id, resolution,
                JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.resolutionNote')),
                NULL, 'OPEN', 'RESOLVED', resolved_at, resolved_at
         FROM manual_review_item
        WHERE manual_review_item_id = ?`,
      ["e".repeat(64), "request-duplicate-candidate", sameCandidateId]
    ),
    (error) => Number(error && error.errno) === 1062
      || (error && error.code) === "ER_DUP_ENTRY"
  );
}

test("integration guards reject remote hosts and production-style databases", () => {
  assert.throws(
    () => integrationConfig({ SCHEMA_SNAPSHOT_MYSQL_HOST: "mysql.production.internal" }),
    { code: "SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_NON_LOCAL_HOST_FORBIDDEN" }
  );
  assert.throws(
    () => integrationConfig({
      SCHEMA_SNAPSHOT_MYSQL_HOST: "127.0.0.1",
      SCHEMA_SNAPSHOT_MYSQL_PORT: "not-a-port",
    }),
    { code: "SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_PORT_INVALID" }
  );
  for (const database of [
    "myroot_prod",
    "myroot_settlement_source_authority_it_prod_deadbeefdeadbeef",
    "myroot_settlement_source_authority_it_1_not-hex",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseName(database),
      { code: "SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_DATABASE_NOT_DISPOSABLE" }
    );
  }
  assert.match(
    createDatabaseName(),
    /^myroot_settlement_source_authority_it_[0-9]+_[0-9a-f]{16}$/
  );
});

test("real MySQL enforces migration 062 authority locks and resolution atomicity", {
  skip: ENABLED
    ? false
    : "set SETTLEMENT_SOURCE_AUTHORITY_MYSQL_INTEGRATION_ENABLED=true on isolated localhost MySQL 8",
  timeout: 120_000,
}, async () => {
  const serverConfig = integrationConfig();
  const database = createDatabaseName();
  const migrationFiles = listMigrationFiles();
  assert.equal(migrationFiles.length, EXPECTED_MIGRATION_COUNT);
  assert.equal(migrationFiles[0], "001_store_snapshot.sql");
  assert.equal(migrationFiles.at(-1), EXPECTED_LAST_MIGRATION);
  assert.deepEqual(
    migrationFiles.map((file) => file.slice(0, 3)),
    Array.from(
      { length: EXPECTED_MIGRATION_COUNT },
      (_, index) => String(index + 1).padStart(3, "0")
    )
  );

  let serverConnection;
  let poolA;
  let poolB;
  let databaseCreated = false;
  let primaryError = null;
  const cleanupErrors = [];
  try {
    serverConnection = await mysql.createConnection(serverConfig);
    await assertDisposableSnapshotServer(serverConnection);
    await serverConnection.query(
      `CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`
    );
    databaseCreated = true;
    poolA = createRuntimePool(serverConfig, database);
    poolB = createRuntimePool(serverConfig, database);

    const migrationState = await applyMysqlMigrations(poolA, {
      database,
      migrationLockTimeoutSeconds: 10,
    });
    assert.equal(migrationState.versions.length, EXPECTED_MIGRATION_COUNT);
    assert.equal(migrationState.latestVersion, EXPECTED_LAST_MIGRATION);

    await assertMigration62Structure(poolA, database);
    await assertAuthorityLockWait(poolA, poolB);
    await assertResolutionSemantics(poolA, poolB);
    await assertReaderPaginationAndAuthorityLock(poolA, poolB, database);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closePool(poolB, cleanupErrors);
    await closePool(poolA, cleanupErrors);
    if (databaseCreated && serverConnection) {
      try {
        assertDisposableDatabaseName(database);
        await serverConnection.query(`DROP DATABASE ${quoteIdentifier(database)}`);
        databaseCreated = false;
        await assertDisposableSnapshotServer(serverConnection);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    await closeConnection(serverConnection, cleanupErrors);
    if (databaseCreated) {
      cleanupErrors.push(
        integrationError("SETTLEMENT_SOURCE_AUTHORITY_INTEGRATION_DATABASE_CLEANUP_FAILED")
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
        "MySQL integration cleanup failed"
      );
    }
  }
});
