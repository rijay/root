const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { syncCoreProjections } = require("../src/mysqlProjection");
const settlement = require("../src/settlement");
const {
  MYSQL_SCOPE_PAGE_SIZE,
  createMemorySettlementSourceInvalidationReadAdapter,
  createMysqlSettlementSourceInvalidationReadAdapter,
} = require("../src/settlementSourceInvalidationReadAdapter");
const { createEmptyData, createMysqlStore } = require("../src/store");

const ROOT_USER_ID = "root-source-read-1";
const CAMPAIGN_ID = "ROOT_7D_RESET";
const TASK_DEFINITION_ID = "task-source-read";
const TASK_DEFINITION_VERSION = "task-source-read-v1";
const ASSIGNMENT_ID = "activity_task_source_read_1";
const SOURCE_EVENT_ID = "activity-event-source-read-1";
const RULE_ID = "campaign-rule-source-read-v1";
const SETTLEMENT_ID = "settlement-source-read-pending";
const SCOPE = Object.freeze([Object.freeze({
  rootUserId: ROOT_USER_ID,
  campaignId: CAMPAIGN_ID,
})]);
const T = Object.freeze({
  rule: "2026-07-01 10:00:00.000",
  confirmed: "2026-08-01 10:00:00.000",
  settled: "2026-08-01 12:00:00.000",
  invalidated: "2026-08-02 10:00:00.000",
  resolved: "2026-08-03 10:00:00.000",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(domain, ...parts) {
  const hash = crypto.createHash("sha256").update(`${domain}\0`, "utf8");
  for (const part of parts) hash.update(String(part), "utf8").update("\0", "utf8");
  return hash.digest("hex");
}

function sourceInvalidationId(assignmentId = ASSIGNMENT_ID, sourceEventId = SOURCE_EVENT_ID) {
  const value = crypto.createHash("sha256")
    .update(
      `myroot:task-source-invalidation:v1:${assignmentId}\0${sourceEventId}`,
      "utf8"
    )
    .digest("hex");
  return `task_invalid_${value.slice(0, 51)}`;
}

function candidateId(invalidationId, ruleId = RULE_ID, ruleVersion = 1) {
  return `mri_${digest(
    "myroot:settlement-source-invalidation-candidate:v1",
    invalidationId,
    ruleId,
    ruleVersion
  ).slice(0, 28)}`;
}

function publishedRule(overrides = {}) {
  return {
    campaign_rule_version_id: RULE_ID,
    campaign_id: CAMPAIGN_ID,
    version: 1,
    status: "PUBLISHED",
    conditions_json: [{
      condition_type: "TASK_COUNT",
      task_type: "CHECKIN",
      min_count: 1,
    }],
    rewards_json: [],
    published_at: T.rule,
    created_at: T.rule,
    updated_at: T.rule,
    ...overrides,
  };
}

function pendingSettlement(overrides = {}) {
  return {
    settlement_record_id: SETTLEMENT_ID,
    root_user_id: ROOT_USER_ID,
    campaign_id: CAMPAIGN_ID,
    rule_version: 1,
    campaign_rule_version_id: RULE_ID,
    status: "PENDING",
    result_json: { qualified: false },
    rewards_json: [],
    evaluated_at: T.settled,
    created_at: T.settled,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const data = createEmptyData();
  data.campaignDefinitions = [{
    campaign_id: CAMPAIGN_ID,
    title: "Source read campaign",
    status: "ACTIVE",
    start_at: "",
    end_at: "",
    config_json: {},
    created_at: T.rule,
    updated_at: T.rule,
  }];
  data.campaignRuleVersions = [publishedRule()];
  data.settlementRecords = [pendingSettlement()];
  data.taskDefinitions = [{
    task_definition_id: TASK_DEFINITION_ID,
    campaign_id: CAMPAIGN_ID,
    task_type: "CHECKIN",
    title: "Source read task",
    description: "",
    required: true,
    display_order: 1,
    status: "ACTIVE",
    config_json: { targetCount: 1 },
    created_at: T.rule,
    updated_at: T.rule,
  }];
  data.taskEvents = [{
    task_event_id: "task-event-source-read-1",
    root_user_id: ROOT_USER_ID,
    campaign_id: CAMPAIGN_ID,
    task_definition_id: TASK_DEFINITION_ID,
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    task_date: "2026-08-01",
    payload_json: {},
    idempotency_key: "task-event-source-read-1",
    status: "RECORDED",
    source_channel: "TEST",
    occurred_at: T.confirmed,
    created_at: T.confirmed,
  }];
  return Object.assign(data, overrides);
}

function candidate(options = {}) {
  const assignmentId = options.assignmentId || ASSIGNMENT_ID;
  const sourceEventId = options.sourceEventId || SOURCE_EVENT_ID;
  const invalidationId = sourceInvalidationId(assignmentId, sourceEventId);
  const resolved = options.resolved !== false;
  const originalStatus = options.originalStatus || "PENDING";
  const originalEvaluatedAt = options.originalEvaluatedAt || T.settled;
  const recalculation = [
    "QUALIFIED",
    "UNQUALIFIED",
    "NOT_QUALIFIED",
    "ADJUSTED",
    "REVIEW_REQUIRED",
  ].includes(originalStatus);
  const metadata = {
    contractVersion: 1,
    handlerVersion: "settlement-source-invalidation-v1",
    candidateKind: recalculation
      ? "ADJUSTMENT_OR_RECALCULATION"
      : "STOP_OR_CANCEL",
    decision: recalculation
      ? "RECALCULATION_REQUIRED"
      : "STOP_AUTOMATIC_SETTLEMENT",
    appendOnly: true,
    taskSourceInvalidationEventId: invalidationId,
    taskActivityAssignmentId: assignmentId,
    rootUserId: ROOT_USER_ID,
    campaignId: CAMPAIGN_ID,
    taskDefinitionId: TASK_DEFINITION_ID,
    taskDefinitionVersion: TASK_DEFINITION_VERSION,
    activityEnrollmentId: "activity-enrollment-source-read-1",
    activitySessionId: "activity-session-source-read-1",
    sourceConfirmedEventId: "activity-event-confirmed-read-1",
    sourceEventId,
    sourceEventType: "activity.enrollment.canceled.v1",
    sourceCancellationReasonCode: "USER_CANCELED",
    reasonCode: "SOURCE_CANCELED",
    sourceInvalidatedAt: T.invalidated,
    campaignRuleVersionId: RULE_ID,
    ruleVersion: 1,
    originalSettlementRecordId: SETTLEMENT_ID,
    originalSettlementStatus: originalStatus,
    originalSettlementEvaluatedAt: originalEvaluatedAt,
    ...(resolved ? {
      resolutionNote: "来源已失效，保持结算阻断",
    } : {}),
  };
  return {
    manual_review_item_id: candidateId(invalidationId),
    root_user_id: ROOT_USER_ID,
    campaign_id: CAMPAIGN_ID,
    review_type: recalculation
      ? "SETTLEMENT_RECALC_CANDIDATE"
      : "SETTLEMENT_STOP_CANDIDATE",
    source_type: "TASK_SOURCE_INVALIDATION",
    source_id: invalidationId,
    reason: "TASK_SOURCE_INVALIDATED",
    status: resolved ? "RESOLVED" : "OPEN",
    priority: "HIGH",
    metadata,
    idempotency_key: [
      "task-source-invalidation",
      invalidationId,
      "rule",
      RULE_ID,
      1,
    ].join(":"),
    operator_id: resolved ? "operator-source-read-1" : null,
    resolved_at: resolved ? T.resolved : null,
    resolution: resolved ? "ACKNOWLEDGED" : null,
    created_at: T.invalidated,
    updated_at: resolved ? T.resolved : T.invalidated,
  };
}

function mysqlCandidate(options = {}) {
  const row = candidate(options);
  return {
    ...row,
    source_invalidation_id: row.metadata.taskSourceInvalidationEventId,
    source_assignment_id: row.metadata.taskActivityAssignmentId,
    source_event_id: row.metadata.sourceEventId,
    source_event_type: row.metadata.sourceEventType,
    source_reason_code: row.metadata.sourceCancellationReasonCode,
    source_occurred_at: row.metadata.sourceInvalidatedAt,
    source_root_user_id: row.metadata.rootUserId,
    source_task_definition_id: row.metadata.taskDefinitionId,
    source_task_definition_version: row.metadata.taskDefinitionVersion,
    source_activity_enrollment_id: row.metadata.activityEnrollmentId,
    source_activity_session_id: row.metadata.activitySessionId,
    source_initial_status: "AVAILABLE",
    source_confirmed_event_id: row.metadata.sourceConfirmedEventId,
    source_confirmed_event_type: "activity.enrollment.confirmed.v1",
    source_confirmed_at: T.confirmed,
    source_campaign_id: row.metadata.campaignId,
    rule_campaign_rule_version_id: row.metadata.campaignRuleVersionId,
    rule_campaign_id: row.metadata.campaignId,
    rule_version: row.metadata.ruleVersion,
    rule_status: "PUBLISHED",
    rule_published_at: options.rulePublishedAt || T.rule,
    settlement_record_id: row.metadata.originalSettlementRecordId,
    settlement_root_user_id: row.metadata.rootUserId,
    settlement_campaign_id: row.metadata.campaignId,
    settlement_rule_version: row.metadata.ruleVersion,
    settlement_campaign_rule_version_id: row.metadata.campaignRuleVersionId,
    settlement_status: row.metadata.originalSettlementStatus,
    settlement_evaluated_at: row.metadata.originalSettlementEvaluatedAt,
    settlement_created_at: options.settlementCreatedAt || T.settled,
  };
}

function mysqlReadAdapter(rows) {
  const calls = [];
  const orderedRows = clone(rows).sort((left, right) => (
    String(left.created_at).localeCompare(String(right.created_at))
      || String(left.manual_review_item_id).localeCompare(
        String(right.manual_review_item_id)
      )
  ));
  let offset = 0;
  const adapter = createMysqlSettlementSourceInvalidationReadAdapter({
    async execute(sql, parameters) {
      const sqlText = String(sql);
      calls.push({ sql: sqlText, parameters: clone(parameters) });
      if (sqlText.includes("settlement_source_invalidation_read:authority")) {
        return [{ affectedRows: 0 }, []];
      }
      if (sqlText.includes("settlement_source_invalidation_read:scope_first")) {
        offset = MYSQL_SCOPE_PAGE_SIZE;
        return [clone(orderedRows.slice(0, MYSQL_SCOPE_PAGE_SIZE)), []];
      }
      if (sqlText.includes("settlement_source_invalidation_read:scope_next")) {
        const page = orderedRows.slice(offset, offset + MYSQL_SCOPE_PAGE_SIZE);
        offset += MYSQL_SCOPE_PAGE_SIZE;
        return [clone(page), []];
      }
      if (sqlText.includes("settlement_source_invalidation_read:candidate_for_update")) {
        return [clone(orderedRows.filter((row) => (
          row.manual_review_item_id === parameters[1]
          && row.root_user_id === parameters[2]
          && row.campaign_id === parameters[3]
        ))), []];
      }
      throw new Error(`unexpected read Adapter SQL: ${sqlText}`);
    },
  });
  return { adapter, calls };
}

test("Memory Adapter validates a resolved STOP candidate and keeps it request-visible", async () => {
  const data = snapshot();
  data.settlementRecords[0].evaluated_at = "2026-08-01T12:00:00+08:00";
  data.settlementRecords[0].created_at = "2026-08-01T12:00:00+08:00";
  data.manualReviewItems = [candidate()];
  const adapter = createMemorySettlementSourceInvalidationReadAdapter(data);
  assert.deepEqual(Object.keys(adapter), [
    "hydrateRequestState",
    "assertCurrentScopesAvailable",
    "readCandidateForUpdate",
    "prepareSnapshotForPersistence",
  ]);
  const hydrated = await adapter.hydrateRequestState();
  assert.equal(hydrated.candidateCount, 1);
  assert.equal(hydrated.data.manualReviewItems[0].status, "RESOLVED");
  const prepared = adapter.prepareSnapshotForPersistence(hydrated.data);
  assert.equal(prepared.manualReviewItems.length, 1);
  assert.throws(
    () => settlement.evaluateSettlement(prepared, ROOT_USER_ID, CAMPAIGN_ID),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED" && error.status === 409
  );
});

test("MySQL Adapter hydrates exact relational evidence and strips it before snapshot persistence", async () => {
  const data = snapshot();
  const row = mysqlCandidate();
  const { adapter, calls } = mysqlReadAdapter([row]);
  assert.deepEqual(Object.keys(adapter), [
    "hydrateRequestState",
    "assertCurrentScopesAvailable",
    "readCandidateForUpdate",
    "prepareSnapshotForPersistence",
  ]);
  const hydrated = await adapter.hydrateRequestState(data, SCOPE);
  assert.equal(hydrated.candidateCount, 1);
  assert.deepEqual(hydrated.data.manualReviewItems, [candidate()]);
  assert.match(calls[0].sql, /settlement_source_invalidation_read:authority/);
  assert.deepEqual(calls[0].parameters, [ROOT_USER_ID, CAMPAIGN_ID]);
  assert.match(calls[1].sql, /candidate\.root_user_id = \?/);
  assert.match(calls[1].sql, /candidate\.campaign_id = \?/);
  assert.match(calls[1].sql, new RegExp(`LIMIT ${MYSQL_SCOPE_PAGE_SIZE}\\s+FOR SHARE`));
  assert.deepEqual(calls[1].parameters, [
    "TASK_SOURCE_INVALIDATION",
    ROOT_USER_ID,
    CAMPAIGN_ID,
  ]);
  const persisted = adapter.prepareSnapshotForPersistence(hydrated.data);
  assert.deepEqual(persisted.manualReviewItems, []);
  assert.deepEqual(data.manualReviewItems, []);
});

test("MySQL Adapter keyset-paginates one requested scope beyond a page without a global read", async () => {
  const rows = Array.from({ length: MYSQL_SCOPE_PAGE_SIZE + 1 }, (_, index) => (
    mysqlCandidate({
      assignmentId: `activity_task_source_page_${String(index).padStart(3, "0")}`,
      sourceEventId: `activity_event_source_page_${String(index).padStart(3, "0")}`,
    })
  ));
  const { adapter, calls } = mysqlReadAdapter(rows);
  const hydrated = await adapter.hydrateRequestState(snapshot(), SCOPE);
  assert.equal(hydrated.candidateCount, MYSQL_SCOPE_PAGE_SIZE + 1);
  assert.equal(hydrated.data.manualReviewItems.length, MYSQL_SCOPE_PAGE_SIZE + 1);
  const reads = calls.filter((call) => call.sql.includes(
    "settlement_source_invalidation_read:scope_"
  ));
  assert.equal(reads.length, 2);
  reads.forEach((call) => {
    assert.match(call.sql, /candidate\.root_user_id = \?/);
    assert.match(call.sql, /candidate\.campaign_id = \?/);
    assert.doesNotMatch(call.sql, /LIMIT 513/);
  });
  assert.deepEqual(reads[0].parameters, [
    "TASK_SOURCE_INVALIDATION",
    ROOT_USER_ID,
    CAMPAIGN_ID,
  ]);
  assert.equal(reads[1].parameters[0], "TASK_SOURCE_INVALIDATION");
  assert.equal(reads[1].parameters[1], ROOT_USER_ID);
  assert.equal(reads[1].parameters[2], CAMPAIGN_ID);
});

test("delayed invalidation handling permits a later Settlement only as a frozen RECALC candidate", async () => {
  const laterRule = "2026-08-03 09:00:00.000";
  const laterSettlement = "2026-08-04 10:00:00.000";
  const data = snapshot();
  data.campaignRuleVersions[0].published_at = laterRule;
  data.settlementRecords = [pendingSettlement({
    status: "QUALIFIED",
    evaluated_at: "2026-08-04T10:00:00+08:00",
    created_at: "2026-08-04T10:00:00+08:00",
  })];
  const row = mysqlCandidate({
    originalStatus: "QUALIFIED",
    originalEvaluatedAt: laterSettlement,
    rulePublishedAt: laterRule,
    settlementCreatedAt: laterSettlement,
    resolved: false,
  });
  const adapter = mysqlReadAdapter([row]).adapter;
  const hydrated = await adapter.hydrateRequestState(data, SCOPE);
  assert.equal(
    hydrated.data.manualReviewItems[0].review_type,
    "SETTLEMENT_RECALC_CANDIDATE"
  );
  const frozen = JSON.stringify({
    settlementRecords: hydrated.data.settlementRecords,
    rewardGrants: hydrated.data.rewardGrants,
  });
  assert.throws(
    () => settlement.evaluateSettlement(hydrated.data, ROOT_USER_ID, CAMPAIGN_ID),
    (error) => error.code === "SETTLEMENT_RECALCULATION_REQUIRED"
      && error.status === 409
  );
  assert.equal(JSON.stringify({
    settlementRecords: hydrated.data.settlementRecords,
    rewardGrants: hydrated.data.rewardGrants,
  }), frozen);
});

test("MySQL Adapter fails closed for duplicate, tampered, and unknown rows", async () => {
  const cases = [
    {
      name: "duplicate",
      rows: [mysqlCandidate(), mysqlCandidate()],
      code: "SETTLEMENT_SOURCE_INVALIDATION_READ_CURSOR_INVALID",
    },
    {
      name: "tampered source",
      rows: [{ ...mysqlCandidate(), source_root_user_id: "root-tampered" }],
      code: "SETTLEMENT_SOURCE_INVALIDATION_READ_STATE_INVALID",
    },
    {
      name: "unknown status",
      rows: [{ ...mysqlCandidate(), status: "UNKNOWN" }],
      code: "SETTLEMENT_SOURCE_INVALIDATION_READ_STATE_INVALID",
    },
  ];
  for (const entry of cases) {
    const { adapter } = mysqlReadAdapter(entry.rows);
    await assert.rejects(
      adapter.hydrateRequestState(snapshot(), SCOPE),
      (error) => error.code === entry.code,
      entry.name
    );
  }

  const illegalLaterSettlement = snapshot();
  illegalLaterSettlement.settlementRecords.push(pendingSettlement({
    settlement_record_id: "settlement-source-read-later",
    status: "QUALIFIED",
    evaluated_at: "2026-08-04 10:00:00.000",
    created_at: "2026-08-04 10:00:00.000",
  }));
  await assert.rejects(
    mysqlReadAdapter([mysqlCandidate()]).adapter.hydrateRequestState(
      illegalLaterSettlement,
      SCOPE
    ),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_READ_STATE_INVALID"
  );
});

test("snapshot authority conflicts and request-time candidate mutation fail closed", async () => {
  const data = snapshot();
  data.manualReviewItems = [candidate()];
  const authority = mysqlReadAdapter([mysqlCandidate()]).adapter;
  await assert.rejects(
    authority.hydrateRequestState(data, SCOPE),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT"
  );

  const collatedSource = snapshot();
  collatedSource.manualReviewItems = [{
    ...candidate(),
    source_type: "task_source_invalidation ",
  }];
  await assert.rejects(
    mysqlReadAdapter([mysqlCandidate()]).adapter.hydrateRequestState(
      collatedSource,
      SCOPE
    ),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT"
  );

  const collatedId = snapshot();
  collatedId.manualReviewItems = [{
    ...candidate(),
    manual_review_item_id: candidate().manual_review_item_id.toUpperCase(),
    source_type: "SETTLEMENT",
    source_id: "ordinary-source-id",
    idempotency_key: "ordinary-idempotency-key",
  }];
  await assert.rejects(
    mysqlReadAdapter([mysqlCandidate()]).adapter.hydrateRequestState(
      collatedId,
      SCOPE
    ),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_READ_DUPLICATE"
  );

  const adapter = mysqlReadAdapter([mysqlCandidate()]).adapter;
  const hydrated = await adapter.hydrateRequestState(snapshot(), SCOPE);
  hydrated.data.manualReviewItems[0].resolution = "MUTATED";
  assert.throws(
    () => adapter.prepareSnapshotForPersistence(hydrated.data),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_READ_AUTHORITY_CONFLICT"
  );
});

test("snapshot projection neither upserts nor deletes handler-owned manual review rows", async () => {
  const ordinary = {
    manual_review_item_id: "mri_snapshot_owned_1",
    root_user_id: ROOT_USER_ID,
    campaign_id: CAMPAIGN_ID,
    review_type: "REWARD_REVIEW",
    source_type: "SETTLEMENT",
    source_id: "settlement-ordinary-1",
    reason: "ordinary review",
    status: "OPEN",
    priority: "NORMAL",
    metadata: {},
    idempotency_key: "ordinary-review-1",
    operator_id: null,
    resolved_at: null,
    resolution: null,
    created_at: T.invalidated,
    updated_at: T.invalidated,
  };
  const calls = [];
  const collatedHandlerOwned = {
    ...candidate(),
    manual_review_item_id: "mri_collated_handler_owned_1",
    source_type: "task_source_invalidation ",
  };
  const connection = {
    async execute(sql, parameters = []) {
      calls.push({ kind: "execute", sql: String(sql), parameters: clone(parameters) });
      return [{ affectedRows: 1 }, []];
    },
    async query(sql) {
      calls.push({ kind: "query", sql: String(sql), parameters: [] });
      return [{ affectedRows: 1 }, []];
    },
  };
  await syncCoreProjections(connection, {
    manualReviewItems: [ordinary, candidate(), collatedHandlerOwned],
  }, { changedKeys: new Set(["manualReviewItems"]) });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /^INSERT INTO `manual_review_item`/);
  assert.ok(calls[0].parameters.includes(ordinary.manual_review_item_id));
  assert.equal(calls[0].parameters.includes(candidate().manual_review_item_id), false);
  assert.equal(calls[0].parameters.includes(collatedHandlerOwned.manual_review_item_id), false);
  assert.match(calls[1].sql, /`source_type` NOT IN \(\?\)/);
  assert.deepEqual(calls[1].parameters, [
    "TASK_SOURCE_INVALIDATION",
    ordinary.manual_review_item_id,
  ]);
});

function fakeMysqlStoreRuntime(initialSnapshot, relationalRows, options = {}) {
  const state = {
    snapshot: clone(initialSnapshot),
    relationalRows: clone(relationalRows),
    revision: 0,
    transaction: null,
    calls: [],
  };
  const connection = {
    async beginTransaction() {
      state.transaction = {
        snapshot: clone(state.snapshot),
        revision: state.revision,
      };
      state.calls.push("BEGIN");
    },
    async execute(sql, parameters = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("INSERT IGNORE INTO root_store_snapshot")) {
        return [{ affectedRows: 0 }, []];
      }
      if (compact.startsWith(
        "SELECT payload_json, updated_at, revision FROM root_store_snapshot"
      )) {
        const source = state.transaction || state;
        return [[{
          payload_json: JSON.stringify(source.snapshot),
          updated_at: T.resolved,
          revision: source.revision,
        }], []];
      }
      if (compact.includes("settlement_source_invalidation_read:authority")) {
        assert.deepEqual(parameters, [ROOT_USER_ID, CAMPAIGN_ID]);
        if (options.injectCandidateOnAuthority === true) {
          state.relationalRows = [mysqlCandidate({ resolved: false })];
          state.calls.push("CANDIDATE_COMMITTED_BEFORE_FINAL_READ");
        }
        state.calls.push("SOURCE_AUTHORITY_LOCK");
        return [{ affectedRows: 0 }, []];
      }
      if (compact.includes("settlement_source_invalidation_read:scope_first")) {
        assert.deepEqual(parameters, [
          "TASK_SOURCE_INVALIDATION",
          ROOT_USER_ID,
          CAMPAIGN_ID,
        ]);
        state.calls.push("SOURCE_INVALIDATION_READ");
        return [clone(state.relationalRows), []];
      }
      if (compact.includes("settlement_source_invalidation_read:scope_next")) {
        state.calls.push("SOURCE_INVALIDATION_READ_NEXT");
        return [[], []];
      }
      if (compact.startsWith("UPDATE root_store_snapshot SET")) {
        state.transaction.revision = Number(parameters[1]);
        state.transaction.snapshot = JSON.parse(parameters[2]);
        state.calls.push("SNAPSHOT_UPDATE");
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected fake Store SQL: ${compact}`);
    },
    async commit() {
      state.snapshot = clone(state.transaction.snapshot);
      state.revision = state.transaction.revision;
      state.transaction = null;
      state.calls.push("COMMIT");
    },
    async rollback() {
      state.transaction = null;
      state.calls.push("ROLLBACK");
    },
    release() {},
  };
  const pool = {
    async getConnection() { return connection; },
    async execute(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (!compact.startsWith(
        "SELECT payload_json, updated_at, revision FROM root_store_snapshot"
      )) throw new Error(`unexpected fake pool SQL: ${compact}`);
      return [[{
        payload_json: JSON.stringify(state.snapshot),
        updated_at: T.resolved,
        revision: state.revision,
      }], []];
    },
    async end() {},
  };
  return {
    state,
    dependencies: {
      mysql: { createPool: () => pool },
      async applyMysqlMigrations() {
        return { latestVersion: "060", versions: ["060"] };
      },
      async readMysqlPrivilegePolicy() {
        return { ready: true, enforced: true, scope: "test" };
      },
      async readMysqlPrivilegePolicyFromConnection() {
        return { ready: true, enforced: true, scope: "test" };
      },
      assertMysqlPrivilegePolicy() {},
      async syncCoreProjections() {
        return { tables: [], rows: {} };
      },
    },
  };
}

test("fake MySQL Store roundtrip hydrates the candidate for Settlement without persisting it in snapshot", async (t) => {
  const runtime = fakeMysqlStoreRuntime(snapshot(), [mysqlCandidate()]);
  const store = await createMysqlStore({
    host: "127.0.0.1",
    port: 3306,
    user: "root_test",
    password: "test-only",
    database: "root_checkin_source_read_test",
  }, {
    seedSampleData: false,
    env: {
      NODE_ENV: "test",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "source-read-result-key-with-strong-entropy-2026",
      ROOT_COMMAND_RESULT_KEY_ID: "source-read-result-v1",
    },
    dependencies: runtime.dependencies,
  });
  t.after(() => store.close());

  const firstCount = await store.runRequest({ write: false }, async (data, control) => {
    await control.settlementSourceInvalidationRead.loadScopes(SCOPE);
    assert.equal(data.manualReviewItems.length, 1);
    assert.throws(
      () => settlement.evaluateSettlement(data, ROOT_USER_ID, CAMPAIGN_ID),
      (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED" && error.status === 409
    );
    return data.manualReviewItems.length;
  });
  assert.equal(firstCount, 1);

  await store.runRequest({ write: true }, async (data) => {
    data.events.push({
      event_id: "snapshot-roundtrip-event-1",
      event_type: "ROUNDTRIP_TEST",
      occurred_at: T.resolved,
    });
  });
  assert.equal(runtime.state.snapshot.manualReviewItems.length, 0);

  const secondCount = await store.runRequest({ write: false }, async (data, control) => {
    await control.settlementSourceInvalidationRead.loadScopes(SCOPE);
    return data.manualReviewItems.filter((row) => (
      row.source_type === "TASK_SOURCE_INVALIDATION"
    )).length;
  });
  assert.equal(secondCount, 1);
  assert.ok(runtime.state.calls.filter((call) => (
    call === "SOURCE_INVALIDATION_READ"
  )).length >= 2);
});

test("Store final authority read blocks a Settlement mutation when a candidate appears before commit", async (t) => {
  const runtime = fakeMysqlStoreRuntime(snapshot(), [], {
    injectCandidateOnAuthority: true,
  });
  const store = await createMysqlStore({
    host: "127.0.0.1",
    port: 3306,
    user: "root_test",
    password: "test-only",
    database: "root_checkin_source_read_race_test",
  }, {
    seedSampleData: false,
    env: {
      NODE_ENV: "test",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "source-read-race-key-with-strong-entropy-2026",
      ROOT_COMMAND_RESULT_KEY_ID: "source-read-race-v1",
    },
    dependencies: runtime.dependencies,
  });
  t.after(() => store.close());
  runtime.state.calls.length = 0;

  await assert.rejects(
    store.runRequest({ write: true }, async (data) => {
      data.settlementRecords[0].status = "QUALIFIED";
      data.settlementRecords[0].result_json = { qualified: true };
    }),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED"
      && error.status === 409
  );
  assert.equal(runtime.state.snapshot.settlementRecords[0].status, "PENDING");
  assert.equal(runtime.state.calls.includes("SNAPSHOT_UPDATE"), false);
  assert.ok(
    runtime.state.calls.indexOf("SOURCE_AUTHORITY_LOCK")
      < runtime.state.calls.indexOf("SOURCE_INVALIDATION_READ")
  );
});

test("Store save path performs the same final authority read before snapshot persistence", async (t) => {
  const runtime = fakeMysqlStoreRuntime(snapshot(), [], {
    injectCandidateOnAuthority: true,
  });
  const store = await createMysqlStore({
    host: "127.0.0.1",
    port: 3306,
    user: "root_test",
    password: "test-only",
    database: "root_checkin_source_save_guard_test",
  }, {
    seedSampleData: false,
    env: {
      NODE_ENV: "test",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "source-save-race-key-with-strong-entropy-2026",
      ROOT_COMMAND_RESULT_KEY_ID: "source-save-race-v1",
    },
    dependencies: runtime.dependencies,
  });
  t.after(() => store.close());
  runtime.state.calls.length = 0;

  store.data.settlementRecords[0].status = "QUALIFIED";
  await assert.rejects(
    store.save(),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED"
  );
  assert.equal(runtime.state.snapshot.settlementRecords[0].status, "PENDING");
  assert.equal(runtime.state.calls.includes("SNAPSHOT_UPDATE"), false);
});
