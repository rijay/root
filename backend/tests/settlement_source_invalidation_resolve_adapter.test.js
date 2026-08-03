const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const {
  createEmptyData,
  createMemoryStore,
} = require("../src/store");
const {
  createMysqlSettlementSourceInvalidationResolveAdapter,
} = require("../src/settlementSourceInvalidationResolveAdapter");

const CANDIDATE_ID = "mri_0123456789abcdef0123456789ab";
const ROOT_USER_ID = "root-source-resolve-1";
const CAMPAIGN_ID = "ROOT_7D_RESET";
const REQUEST_ID = "settlement-source-resolve-request-1";
const OPERATOR_ID = "operator-source-resolve-1";
const RESOLVED_AT = "2026-08-05 10:00:00.000";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function candidate(overrides = {}) {
  return {
    manual_review_item_id: CANDIDATE_ID,
    root_user_id: ROOT_USER_ID,
    campaign_id: CAMPAIGN_ID,
    review_type: "SETTLEMENT_STOP_CANDIDATE",
    source_type: "TASK_SOURCE_INVALIDATION",
    source_id: "task_invalid_source_resolve_1",
    reason: "TASK_SOURCE_INVALIDATED",
    status: "OPEN",
    priority: "HIGH",
    metadata: {
      contractVersion: 1,
      handlerVersion: "settlement-source-invalidation-v1",
    },
    idempotency_key: "task-source-invalidation:resolve-test",
    operator_id: null,
    resolved_at: null,
    resolution: null,
    created_at: "2026-08-04 10:00:00.000",
    updated_at: "2026-08-04 10:00:00.000",
    ...overrides,
  };
}

function resolveInput(overrides = {}) {
  return {
    candidateId: CANDIDATE_ID,
    rootUserId: ROOT_USER_ID,
    campaignId: CAMPAIGN_ID,
    requestId: REQUEST_ID,
    operatorId: OPERATOR_ID,
    resolution: "STOP_CONFIRMED",
    resolutionNote: "来源取消事实已核对，保持自动结算阻断",
    publicNote: "活动报名已取消，本次奖励不会自动发放",
    ...overrides,
  };
}

function fakeResolveRuntime(options = {}) {
  const state = {
    candidate: candidate(options.candidate),
    audits: clone(options.audits || []),
    calls: [],
  };
  const readAdapter = {
    async readCandidateForUpdate(_snapshot, input) {
      state.calls.push({ kind: "candidate-read", input: clone(input) });
      const row = state.candidate;
      if (!row
        || row.manual_review_item_id !== input.candidateId
        || row.root_user_id !== input.rootUserId
        || row.campaign_id !== input.campaignId) return null;
      return clone(row);
    },
  };
  const connection = {
    async execute(sql, parameters = []) {
      const sqlText = String(sql);
      state.calls.push({ kind: "sql", sql: sqlText, parameters: clone(parameters) });
      if (sqlText.includes("settlement_source_invalidation_resolve:audit_for_update")) {
        return [clone(state.audits.filter((audit) => (
          audit.manual_review_item_id === parameters[0]
          || audit.request_id === parameters[1]
        ))), []];
      }
      if (sqlText.includes("settlement_source_invalidation_resolve:candidate")) {
        const hasPublicNote = sqlText.includes(":candidate_public");
        const candidateIdIndex = hasPublicNote ? 4 : 3;
        if (!state.candidate
          || state.candidate.status !== "OPEN"
          || state.candidate.manual_review_item_id !== parameters[candidateIdIndex]
          || state.candidate.root_user_id !== parameters[candidateIdIndex + 1]
          || state.candidate.campaign_id !== parameters[candidateIdIndex + 2]) {
          return [{ affectedRows: 0 }, []];
        }
        state.candidate.status = "RESOLVED";
        state.candidate.operator_id = parameters[0];
        state.candidate.resolution = parameters[1];
        state.candidate.metadata.resolutionNote = parameters[2];
        if (hasPublicNote) state.candidate.metadata.publicNote = parameters[3];
        else delete state.candidate.metadata.publicNote;
        state.candidate.resolved_at = RESOLVED_AT;
        state.candidate.updated_at = RESOLVED_AT;
        return [{ affectedRows: 1 }, []];
      }
      if (sqlText.includes("settlement_source_invalidation_resolve:audit_insert")) {
        state.audits.push({
          settlement_source_resolution_audit_id: parameters[0],
          manual_review_item_id: parameters[1],
          root_user_id: parameters[2],
          campaign_id: parameters[3],
          request_id: parameters[4],
          operator_id: parameters[5],
          resolution: parameters[6],
          resolution_note: parameters[7],
          public_note: parameters[8],
          before_status: "OPEN",
          after_status: "RESOLVED",
          candidate_resolved_at: parameters[9],
          created_at: parameters[10],
        });
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected resolve Adapter SQL: ${sqlText}`);
    },
  };
  return {
    state,
    adapter: createMysqlSettlementSourceInvalidationResolveAdapter(
      connection,
      readAdapter
    ),
  };
}

test("relational resolve appends one exact audit and never writes Settlement or reward authority", async () => {
  const runtime = fakeResolveRuntime();
  const beforeCandidate = clone(runtime.state.candidate);
  const result = await runtime.adapter.resolve({}, resolveInput());
  assert.equal(result.replayed, false);
  assert.equal(result.candidate.status, "RESOLVED");
  assert.equal(result.candidate.resolution, "STOP_CONFIRMED");
  assert.equal(result.audit.requestId, REQUEST_ID);
  assert.match(result.audit.auditId, /^[0-9a-f]{64}$/);
  assert.equal(runtime.state.audits.length, 1);
  assert.equal(runtime.state.audits[0].before_status, "OPEN");
  assert.equal(runtime.state.audits[0].after_status, "RESOLVED");
  assert.equal(beforeCandidate.source_id, runtime.state.candidate.source_id);
  const sql = runtime.state.calls
    .filter((call) => call.kind === "sql")
    .map((call) => call.sql)
    .join("\n");
  assert.doesNotMatch(sql, /\bsettlement_record\b/i);
  assert.doesNotMatch(sql, /\breward_(?:grant|inventory_reservation)\b/i);
  assert.match(sql, /UPDATE manual_review_item/);
  assert.match(sql, /INSERT INTO settlement_source_resolution_audit/);
});

test("relational resolve replays only the exact audited request and rejects drift", async () => {
  const runtime = fakeResolveRuntime();
  const first = await runtime.adapter.resolve({}, resolveInput());
  const replay = await runtime.adapter.resolve({}, resolveInput());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.audit.auditId, first.audit.auditId);
  assert.equal(runtime.state.audits.length, 1);

  await assert.rejects(
    runtime.adapter.resolve({}, resolveInput({
      requestId: "settlement-source-resolve-request-2",
    })),
    (error) => error.code === "SETTLEMENT_SOURCE_RESOLUTION_REQUEST_CONFLICT"
      && error.status === 409
  );
  await assert.rejects(
    runtime.adapter.resolve({}, resolveInput({
      resolutionNote: "试图改写已审计结论",
    })),
    (error) => error.code === "SETTLEMENT_SOURCE_RESOLUTION_STATE_CONFLICT"
      && error.status === 409
  );
});

test("dedicated decision must match the frozen candidate kind", async () => {
  const runtime = fakeResolveRuntime({
    candidate: { review_type: "SETTLEMENT_RECALC_CANDIDATE" },
  });
  await assert.rejects(
    runtime.adapter.resolve({}, resolveInput()),
    (error) => error.code === "SETTLEMENT_SOURCE_RESOLUTION_DECISION_INVALID"
      && error.status === 409
  );
  assert.equal(runtime.state.candidate.status, "OPEN");
  assert.equal(runtime.state.audits.length, 0);
});
