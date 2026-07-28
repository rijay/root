const assert = require("node:assert/strict");
const test = require("node:test");

const { buildActivityTaskOutboxEnvelope } = require("../src/activityTaskEventOutbox");
const { getDefaultInboxHandlerRegistry } = require("../src/inboxHandlerRegistry");
const settlement = require("../src/settlement");

const CAMPAIGN_ID = "ROOT_7D_RESET";
const ROOT_USER_ID = "root-settlement-source-1";
const TASK_DEFINITION_ID = "task-source-settlement";
const TASK_DEFINITION_VERSION = "task-source-settlement-v1";
const T = Object.freeze({
  confirmed: "2026-08-01 10:00:00.000",
  canceled: "2026-08-02 10:00:00.000",
  rule: "2026-07-01 10:00:00.000",
  settled: "2026-08-01 12:00:00.000",
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return Object.freeze({ promise, resolve, reject });
}

function createAuthorityScheduler() {
  let owner = null;
  const waiters = [];
  const events = [];
  const waitSignals = new Map();
  async function acquire(nextOwner) {
    if (owner !== null) {
      events.push(`${nextOwner}:WAIT:${owner}`);
      const signal = waitSignals.get(nextOwner);
      if (signal) signal.resolve();
      const turn = deferred();
      waiters.push({ nextOwner, turn });
      await turn.promise;
    }
    owner = nextOwner;
    events.push(`${nextOwner}:ACQUIRED`);
  }
  function release(currentOwner) {
    assert.equal(owner, currentOwner);
    events.push(`${currentOwner}:RELEASED`);
    owner = null;
    const next = waiters.shift();
    if (next) next.turn.resolve();
  }
  function waitUntilWaiting(nextOwner) {
    if (events.some((event) => event.startsWith(`${nextOwner}:WAIT:`))) {
      return Promise.resolve();
    }
    const signal = deferred();
    waitSignals.set(nextOwner, signal);
    return signal.promise;
  }
  return { acquire, release, waitUntilWaiting, events };
}

function activityRegistration(eventType) {
  return getDefaultInboxHandlerRegistry().assertScope({
    consumerName: "activity-task-source-projection",
    handlerVersion: "activity-task-source-v1",
    sourceName: "myroot-api",
    eventType,
    schemaVersion: "1",
    aggregateType: "ACTIVITY_ENROLLMENT_TASK_SOURCE",
  });
}

function settlementRegistration() {
  return getDefaultInboxHandlerRegistry().assertScope({
    consumerName: "settlement-source-invalidation-projection",
    handlerVersion: "settlement-source-invalidation-v1",
    sourceName: "myroot-task-projection",
    eventType: "task.source_invalidated.v1",
    schemaVersion: "1",
    aggregateType: "TASK_SOURCE_INVALIDATION",
  });
}

function evidence(registration) {
  return {
    handlerVersion: registration.descriptor.handlerVersion,
    registrationDigest: registration.registrationDigest,
  };
}

function activityOutbox(kind) {
  return buildActivityTaskOutboxEnvelope({
    enrollmentEvent: {
      activity_enrollment_event_id: kind === "CONFIRMED"
        ? "activity-event-confirmed-settlement-1"
        : "activity-event-canceled-settlement-1",
      activity_enrollment_id: "activity-enrollment-settlement-1",
      activity_session_id: "activity-session-settlement-1",
      root_user_id: ROOT_USER_ID,
      event_sequence: kind === "CONFIRMED" ? 1 : 2,
      operation: kind === "CONFIRMED" ? "ENROLL" : "CANCEL",
      from_status: kind === "CONFIRMED" ? "PENDING" : "CONFIRMED",
      to_status: kind,
      reason_code: kind === "CONFIRMED" ? null : "USER_CANCELED",
      occurred_at: kind === "CONFIRMED" ? T.confirmed : T.canceled,
    },
    binding: {
      taskDefinitionId: TASK_DEFINITION_ID,
      taskDefinitionVersion: TASK_DEFINITION_VERSION,
    },
  }, { producerVersion: "1.0.0-test" });
}

function inboxEnvelope(row) {
  return {
    eventId: row.outbox_event_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    sourceName: row.source_name,
    partitionKey: row.partition_key,
    partitionPosition: row.partition_position,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: row.occurred_at,
    producerVersion: row.producer_version,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    dedupeKey: row.dedupe_key,
    payload: row.payload_json,
    payloadDigest: row.payload_digest,
  };
}

function createActivityPersistence() {
  const state = { assignments: [], invalidations: [] };
  async function executeStatement(statementId, parameters) {
    if (statementId === "activity_task_assignment.select_conflicts_for_update.v1") {
      return state.assignments.filter((row) => (
        row.task_activity_assignment_id === parameters.assignmentId
        || row.source_confirmed_event_id === parameters.sourceConfirmedEventId
      ));
    }
    if (statementId === "activity_task_assignment.insert.v1") {
      state.assignments.push({
        task_activity_assignment_id: parameters.assignmentId,
        root_user_id: parameters.rootUserId,
        task_definition_id: parameters.taskDefinitionId,
        task_definition_version: parameters.taskDefinitionVersion,
        activity_enrollment_id: parameters.activityEnrollmentId,
        activity_session_id: parameters.activitySessionId,
        initial_status: "AVAILABLE",
        source_confirmed_event_id: parameters.sourceConfirmedEventId,
        source_confirmed_event_type: parameters.sourceConfirmedEventType,
        source_confirmed_at: parameters.sourceConfirmedAt,
      });
      return { affectedRows: 1 };
    }
    if (statementId === "activity_task_assignment.select_for_invalidation.v1") {
      return state.assignments.filter((row) => (
        row.task_activity_assignment_id === parameters.assignmentId
      ));
    }
    if (statementId === "task_source_invalidation.select_conflicts_for_update.v1") {
      return state.invalidations.filter((row) => (
        row.task_source_invalidation_event_id === parameters.invalidationId
        || row.source_event_id === parameters.sourceEventId
      ));
    }
    if (statementId === "task_source_invalidation.insert.v1") {
      state.invalidations.push({
        task_source_invalidation_event_id: parameters.invalidationId,
        task_activity_assignment_id: parameters.assignmentId,
        source_event_id: parameters.sourceEventId,
        source_event_type: parameters.sourceEventType,
        reason_code: parameters.reasonCode,
        occurred_at: parameters.occurredAt,
      });
      return { affectedRows: 1 };
    }
    throw new Error(`unexpected Activity statement ${statementId}`);
  }
  return { state, executeStatement };
}

async function confirmedCanceledChain() {
  const persistence = createActivityPersistence();
  const confirmed = inboxEnvelope(activityOutbox("CONFIRMED"));
  const canceled = inboxEnvelope(activityOutbox("CANCELED"));
  const confirmedHandler = activityRegistration("activity.enrollment.confirmed.v1");
  const canceledHandler = activityRegistration("activity.enrollment.canceled.v1");
  await confirmedHandler.apply({
    envelope: confirmed,
    handlerEvidence: evidence(confirmedHandler),
    executeStatement: persistence.executeStatement,
    stageOutbox() { assert.fail("confirmed must not stage a successor"); },
  });
  let successor;
  await canceledHandler.apply({
    envelope: canceled,
    handlerEvidence: evidence(canceledHandler),
    executeStatement: persistence.executeStatement,
    stageOutbox(contractId, row) {
      assert.equal(contractId, "task.source_invalidated.v1");
      successor = row;
    },
  });
  assert.ok(successor);
  return { activityState: persistence.state, successor: inboxEnvelope(successor) };
}

function publishedRule(overrides = {}) {
  return {
    campaign_rule_version_id: "campaign-rule-source-v1",
    campaign_id: CAMPAIGN_ID,
    version: 1,
    status: "PUBLISHED",
    published_at: T.rule,
    conditions_json: [{
      condition_type: "TASK_COUNT",
      task_type: "CHECKIN",
      min_count: 1,
    }],
    rewards_json: [],
    ...overrides,
  };
}

function settlementRecord(overrides = {}) {
  return {
    settlement_record_id: "settlement-source-original-1",
    root_user_id: ROOT_USER_ID,
    campaign_id: CAMPAIGN_ID,
    rule_version: 1,
    campaign_rule_version_id: "campaign-rule-source-v1",
    status: "QUALIFIED",
    evaluated_at: T.settled,
    created_at: T.settled,
    result_json: { qualified: true },
    rewards_json: [{ reward_key: "original-reward" }],
    ...overrides,
  };
}

function createSettlementPersistence(activityState, overrides = {}) {
  const state = {
    assignments: activityState.assignments.map((row) => ({ ...row })),
    invalidations: activityState.invalidations.map((row) => ({ ...row })),
    rules: (overrides.rules || [publishedRule()]).map((row) => ({ ...row })),
    settlements: (overrides.settlements || []).map((row) => ({ ...row })),
    candidates: (overrides.candidates || []).map((row) => ({ ...row })),
    authorities: new Set(),
    calls: [],
    failAfterInsertOnce: Boolean(overrides.failAfterInsertOnce),
  };
  async function executeStatement(statementId, parameters) {
    state.calls.push(statementId);
    if (statementId === "settlement_source_authority.acquire.v1") {
      const key = `${parameters.rootUserId}\0${parameters.campaignId}`;
      const created = !state.authorities.has(key);
      state.authorities.add(key);
      return { affectedRows: created ? 1 : 0 };
    }
    if ([
      "settlement_source_task.select_for_update.v1",
      "settlement_source_task.verify.v1",
    ].includes(statementId)) {
      const assignment = state.assignments.find((row) => (
        row.task_activity_assignment_id === parameters.assignmentId
      ));
      const invalidation = state.invalidations.find((row) => (
        row.task_source_invalidation_event_id === parameters.invalidationId
      ));
      if (!assignment || !invalidation
        || invalidation.task_activity_assignment_id !== assignment.task_activity_assignment_id) return [];
      return [{
        ...assignment,
        campaign_id: CAMPAIGN_ID,
        ...invalidation,
        invalidation_assignment_id: invalidation.task_activity_assignment_id,
      }];
    }
    if (statementId === "settlement_source_candidate.select_for_update.v1") {
      return state.candidates.filter((row) => row.source_id === parameters.sourceId);
    }
    if (statementId === "settlement_source_record.select_latest_for_update.v1") {
      return state.settlements
        .filter((row) => row.root_user_id === parameters.rootUserId
          && row.campaign_id === parameters.campaignId)
        .sort((left, right) => String(right.evaluated_at).localeCompare(left.evaluated_at))
        .slice(0, 1);
    }
    if (statementId === "settlement_source_rule.select_by_settlement_for_update.v1") {
      return state.rules.filter((row) => (
        row.campaign_rule_version_id === parameters.campaignRuleVersionId
        && row.campaign_id === parameters.campaignId
        && row.version === parameters.ruleVersion
      ));
    }
    if (statementId === "settlement_source_rule.select_latest_published_for_update.v1") {
      return state.rules.filter((row) => (
        row.campaign_id === parameters.campaignId && row.status === "PUBLISHED"
      )).sort((left, right) => right.version - left.version).slice(0, 1);
    }
    if (statementId === "settlement_source_candidate.insert.v1") {
      state.candidates.push({
        manual_review_item_id: parameters.candidateId,
        root_user_id: parameters.rootUserId,
        campaign_id: parameters.campaignId,
        review_type: parameters.reviewType,
        source_type: "TASK_SOURCE_INVALIDATION",
        source_id: parameters.sourceId,
        reason: "TASK_SOURCE_INVALIDATED",
        status: "OPEN",
        priority: "HIGH",
        metadata: JSON.parse(parameters.metadataJson),
        idempotency_key: parameters.idempotencyKey,
        operator_id: null,
        resolved_at: null,
        resolution: null,
        created_at: parameters.createdAt,
        updated_at: parameters.updatedAt,
      });
      if (state.failAfterInsertOnce) {
        state.failAfterInsertOnce = false;
        throw new Error("insert acknowledgement unknown");
      }
      return { affectedRows: 1 };
    }
    if (statementId === "settlement_source_candidate.verify.v1") {
      return state.candidates.filter((row) => (
        row.manual_review_item_id === parameters.candidateId
      ));
    }
    throw new Error(`unexpected Settlement statement ${statementId}`);
  }
  return { state, executeStatement };
}

async function applySuccessor(successor, persistence) {
  const registration = settlementRegistration();
  return registration.apply({
    envelope: successor,
    handlerEvidence: evidence(registration),
    executeStatement: persistence.executeStatement,
    stageOutbox() { assert.fail("Settlement candidate must not stage another Outbox event"); },
  });
}

async function applySuccessorWithAuthority(successor, persistence, scheduler, hooks = {}) {
  const registration = settlementRegistration();
  let acquired = false;
  try {
    return await registration.apply({
      envelope: successor,
      handlerEvidence: evidence(registration),
      async executeStatement(statementId, parameters) {
        if (statementId === "settlement_source_authority.acquire.v1") {
          await scheduler.acquire("HANDLER");
          acquired = true;
          if (hooks.afterAcquire) await hooks.afterAcquire();
        }
        return persistence.executeStatement(statementId, parameters);
      },
      stageOutbox() { assert.fail("Settlement candidate must not stage another Outbox event"); },
    });
  } finally {
    if (acquired) scheduler.release("HANDLER");
  }
}

function settlementData(candidate, records = []) {
  return {
    campaignDefinitions: [{
      campaign_id: CAMPAIGN_ID,
      title: "Source invalidation campaign",
      status: "ACTIVE",
      start_at: "",
      end_at: "",
      config_json: {},
      created_at: T.rule,
      updated_at: T.rule,
    }],
    campaignRuleVersions: [publishedRule()],
    settlementRecords: records.map((row) => ({ ...row })),
    manualReviewItems: candidate ? [{ ...candidate }] : [],
    taskDefinitions: [{
      task_definition_id: TASK_DEFINITION_ID,
      campaign_id: CAMPAIGN_ID,
      task_type: "CHECKIN",
      title: "Task",
      description: "",
      required: true,
      display_order: 1,
      status: "ACTIVE",
      config_json: { targetCount: 1 },
    }],
    taskEvents: [{
      task_event_id: "task-event-source-completed-1",
      root_user_id: ROOT_USER_ID,
      campaign_id: CAMPAIGN_ID,
      task_definition_id: TASK_DEFINITION_ID,
      task_type: "CHECKIN",
      event_type: "CHECKIN_COMPLETED",
      task_date: "2026-08-01",
      status: "RECORDED",
      occurred_at: T.confirmed,
    }],
  };
}


test("Handler-first TOCTOU makes the overlapping Store writer observe STOP authority", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const scheduler = createAuthorityScheduler();
  const handlerAcquired = deferred();
  const allowHandler = deferred();

  const handlerPromise = applySuccessorWithAuthority(
    chain.successor,
    persistence,
    scheduler,
    {
      async afterAcquire() {
        handlerAcquired.resolve();
        await allowHandler.promise;
      },
    }
  );
  await handlerAcquired.promise;

  const storePromise = (async () => {
    await scheduler.acquire("STORE");
    try {
      const candidate = persistence.state.candidates[0];
      assert.ok(candidate);
      assert.throws(
        () => settlement.evaluateSettlement(
          settlementData(candidate),
          ROOT_USER_ID,
          CAMPAIGN_ID
        ),
        (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED" && error.status === 409
      );
    } finally {
      scheduler.release("STORE");
    }
  })();

  await scheduler.waitUntilWaiting("STORE");
  assert.deepEqual(scheduler.events, [
    "HANDLER:ACQUIRED",
    "STORE:WAIT:HANDLER",
  ]);
  allowHandler.resolve();
  await Promise.all([handlerPromise, storePromise]);

  assert.equal(persistence.state.candidates.length, 1);
  assert.equal(persistence.state.candidates[0].review_type, "SETTLEMENT_STOP_CANDIDATE");
  assert.equal(persistence.state.settlements.length, 0);
  assert.deepEqual(scheduler.events, [
    "HANDLER:ACQUIRED",
    "STORE:WAIT:HANDLER",
    "HANDLER:RELEASED",
    "STORE:ACQUIRED",
    "STORE:RELEASED",
  ]);
});

test("Store-first TOCTOU makes the overlapping invalidation Handler append RECALC", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const scheduler = createAuthorityScheduler();
  const storeAcquired = deferred();
  const allowStore = deferred();

  const storePromise = (async () => {
    await scheduler.acquire("STORE");
    try {
      storeAcquired.resolve();
      await allowStore.promise;
      const data = settlementData(null);
      const result = settlement.evaluateSettlement(data, ROOT_USER_ID, CAMPAIGN_ID);
      assert.equal(result.settlementRecord.status, "QUALIFIED");
      persistence.state.settlements.push(structuredClone(result.settlementRecord));
    } finally {
      scheduler.release("STORE");
    }
  })();
  await storeAcquired.promise;

  const handlerPromise = applySuccessorWithAuthority(
    chain.successor,
    persistence,
    scheduler
  );
  await scheduler.waitUntilWaiting("HANDLER");
  assert.deepEqual(scheduler.events, [
    "STORE:ACQUIRED",
    "HANDLER:WAIT:STORE",
  ]);
  allowStore.resolve();
  await Promise.all([storePromise, handlerPromise]);

  assert.equal(persistence.state.settlements.length, 1);
  assert.equal(persistence.state.settlements[0].status, "QUALIFIED");
  assert.equal(persistence.state.candidates.length, 1);
  assert.equal(persistence.state.candidates[0].review_type, "SETTLEMENT_RECALC_CANDIDATE");
  assert.equal(
    persistence.state.candidates[0].metadata.originalSettlementRecordId,
    persistence.state.settlements[0].settlement_record_id
  );
  assert.deepEqual(scheduler.events, [
    "STORE:ACQUIRED",
    "HANDLER:WAIT:STORE",
    "STORE:RELEASED",
    "HANDLER:ACQUIRED",
    "HANDLER:RELEASED",
  ]);
});

test("confirmed -> canceled -> source invalidated creates one frozen STOP candidate and blocks Settlement", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const first = await applySuccessor(chain.successor, persistence);
  const replay = await applySuccessor(chain.successor, persistence);
  assert.deepEqual(replay, first);
  assert.equal(persistence.state.candidates.length, 1);
  const candidate = persistence.state.candidates[0];
  assert.equal(candidate.review_type, "SETTLEMENT_STOP_CANDIDATE");
  assert.equal(candidate.metadata.candidateKind, "STOP_OR_CANCEL");
  assert.equal(candidate.metadata.ruleVersion, 1);
  assert.equal(candidate.metadata.campaignRuleVersionId, "campaign-rule-source-v1");
  assert.equal(candidate.metadata.originalSettlementRecordId, null);
  assert.equal(candidate.metadata.taskSourceInvalidationEventId, chain.successor.aggregateId);
  assert.throws(
    () => settlement.evaluateSettlement(
      settlementData(candidate),
      ROOT_USER_ID,
      CAMPAIGN_ID
    ),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED" && error.status === 409
  );
});

test("a settled source appends one recalculation candidate without changing the original settlement or reward", async () => {
  const chain = await confirmedCanceledChain();
  const original = settlementRecord();
  const before = structuredClone(original);
  const persistence = createSettlementPersistence(chain.activityState, {
    settlements: [original],
  });
  const applied = await applySuccessor(chain.successor, persistence);
  assert.deepEqual(persistence.state.settlements, [before]);
  assert.equal(persistence.state.candidates.length, 1);
  const candidate = persistence.state.candidates[0];
  assert.equal(candidate.review_type, "SETTLEMENT_RECALC_CANDIDATE");
  assert.equal(candidate.metadata.candidateKind, "ADJUSTMENT_OR_RECALCULATION");
  assert.equal(candidate.metadata.originalSettlementRecordId, original.settlement_record_id);
  assert.equal(candidate.metadata.originalSettlementStatus, "QUALIFIED");
  assert.equal(applied.result.originalSettlementRecordId, original.settlement_record_id);
  assert.throws(
    () => settlement.evaluateSettlement(
      settlementData(candidate, [original]),
      ROOT_USER_ID,
      CAMPAIGN_ID
    ),
    (error) => error.code === "SETTLEMENT_RECALCULATION_REQUIRED" && error.status === 409
  );
});

test("PENDING Settlement is treated as unsettled and produces a STOP candidate", async () => {
  const chain = await confirmedCanceledChain();
  const pending = settlementRecord({ status: "PENDING" });
  const persistence = createSettlementPersistence(chain.activityState, {
    settlements: [pending],
  });
  await applySuccessor(chain.successor, persistence);
  assert.equal(persistence.state.candidates[0].review_type, "SETTLEMENT_STOP_CANDIDATE");
  assert.equal(
    persistence.state.candidates[0].metadata.originalSettlementRecordId,
    pending.settlement_record_id
  );
});

test("resolving a STOP review never unlocks automatic Settlement", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const first = await applySuccessor(chain.successor, persistence);
  const candidate = persistence.state.candidates[0];
  candidate.status = "RESOLVED";
  candidate.operator_id = "operator-source-invalidation-1";
  candidate.resolved_at = "2026-08-03 10:00:00.000";
  candidate.resolution = "ACKNOWLEDGED";
  candidate.updated_at = candidate.resolved_at;
  candidate.metadata = {
    ...candidate.metadata,
    resolutionNote: "人工确认来源失效，仍需显式补偿事实才能继续结算",
  };

  const replay = await applySuccessor(chain.successor, persistence);
  assert.deepEqual(replay, first);
  assert.equal(persistence.state.candidates.length, 1);
  assert.throws(
    () => settlement.evaluateSettlement(
      settlementData(candidate),
      ROOT_USER_ID,
      CAMPAIGN_ID
    ),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATED" && error.status === 409
  );
});

test("insert acknowledgement failure converges by replay without a duplicate candidate", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState, {
    failAfterInsertOnce: true,
  });
  await assert.rejects(() => applySuccessor(chain.successor, persistence), /acknowledgement unknown/);
  assert.equal(persistence.state.candidates.length, 1);
  const recovered = await applySuccessor(chain.successor, persistence);
  assert.equal(recovered.result.candidateKind, "STOP_OR_CANCEL");
  assert.equal(persistence.state.candidates.length, 1);
});

test("missing source task fails closed, then the same invalidation succeeds after ordered source recovery", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const [assignment] = persistence.state.assignments.splice(0, 1);
  await assert.rejects(
    () => applySuccessor(chain.successor, persistence),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_FAILED"
  );
  assert.equal(persistence.state.candidates.length, 0);
  persistence.state.assignments.push(assignment);
  const recovered = await applySuccessor(chain.successor, persistence);
  assert.equal(recovered.result.taskSourceInvalidationEventId, chain.successor.aggregateId);
});

test("rule identity stays frozen across replay even when a newer rule is published", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const first = await applySuccessor(chain.successor, persistence);
  persistence.state.rules.push(publishedRule({
    campaign_rule_version_id: "campaign-rule-source-v2",
    version: 2,
    published_at: "2026-08-03 10:00:00.000",
  }));
  const replay = await applySuccessor(chain.successor, persistence);
  assert.equal(first.result.ruleVersion, 1);
  assert.equal(replay.result.ruleVersion, 1);
  assert.equal(persistence.state.candidates.length, 1);
});

test("unknown Settlement or candidate states and duplicate candidates fail closed", async () => {
  const chain = await confirmedCanceledChain();
  const illegalSettlement = createSettlementPersistence(chain.activityState, {
    settlements: [settlementRecord({ status: "COMPLETED" })],
  });
  await assert.rejects(
    () => applySuccessor(chain.successor, illegalSettlement),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_FAILED"
  );

  const baseline = createSettlementPersistence(chain.activityState);
  await applySuccessor(chain.successor, baseline);
  baseline.state.candidates[0].status = "UNKNOWN";
  await assert.rejects(
    () => applySuccessor(chain.successor, baseline),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_FAILED"
  );
  baseline.state.candidates[0].status = "OPEN";
  baseline.state.candidates.push(structuredClone(baseline.state.candidates[0]));
  await assert.rejects(
    () => applySuccessor(chain.successor, baseline),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_FAILED"
  );
});

test("registered verification reads back the source and candidate and rejects result drift", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const registration = settlementRegistration();
  const applied = await applySuccessor(chain.successor, persistence);
  assert.equal(await registration.verify({
    envelope: chain.successor,
    handlerEvidence: evidence(registration),
    result: applied.result,
    manifest: applied.manifest,
    executeStatement: persistence.executeStatement,
  }), true);
  assert.equal(await registration.verify({
    envelope: chain.successor,
    handlerEvidence: evidence(registration),
    result: { ...applied.result, ruleVersion: 999 },
    manifest: applied.manifest,
    executeStatement: persistence.executeStatement,
  }), false);
});

test("payload or source-fact drift is rejected before a second candidate can be written", async () => {
  const chain = await confirmedCanceledChain();
  const persistence = createSettlementPersistence(chain.activityState);
  const driftedEnvelope = {
    ...chain.successor,
    payload: { ...chain.successor.payload, rootUserId: "different-root" },
  };
  await assert.rejects(
    () => applySuccessor(driftedEnvelope, persistence),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_FAILED"
  );
  persistence.state.invalidations[0].reason_code = "SESSION_CANCELED";
  await assert.rejects(
    () => applySuccessor(chain.successor, persistence),
    (error) => error.code === "SETTLEMENT_SOURCE_INVALIDATION_FAILED"
  );
  assert.equal(persistence.state.candidates.length, 0);
});
