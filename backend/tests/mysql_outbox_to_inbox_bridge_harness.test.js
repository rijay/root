const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { assertResolvedInboxHandlerRegistration } = require("../src/inboxHandlerRegistry");

const ENABLED_ENV = Object.freeze({
  NODE_ENV: "test",
  MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED: "true",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "bridge-test-content-key-with-at-least-32-characters",
  ROOT_INBOX_CONTENT_KEY_ID: "bridge-test-key-v1",
});

function shareClaim(overrides = {}) {
  const taskEventId = overrides.taskEventId || "task-event-bridge-1";
  return {
    outboxEventId: overrides.outboxEventId || "outbox-bridge-1",
    leaseOwner: overrides.leaseOwner || "bridge-owner-1",
    leaseGeneration: overrides.leaseGeneration || 1,
    attemptCount: overrides.attemptCount || 1,
    maxAttempts: 5,
    retryPolicyVersion: "outbox-retry-v1",
    claimTransitionId: overrides.claimTransitionId || "bridge-claim-transition-1",
    payloadDigest: "a".repeat(64),
    envelope: {
      topic: overrides.topic || "task.events",
      eventType: "task.event.recorded.v1",
      schemaVersion: "1",
      sourceName: "myroot-api",
      partitionKey: `task_event:${taskEventId}`,
      partitionPosition: 1,
      aggregateType: "TASK_EVENT",
      aggregateId: taskEventId,
      aggregateVersion: 1,
      occurredAt: "2026-07-17 10:00:00.000",
      producerVersion: "0.5.13",
      correlationId: null,
      causationId: null,
      idempotencyKey: `task-event:${taskEventId}:v1`,
      dedupeKey: `task-event:${taskEventId}:v1`,
      payload: {
        taskEventId,
        taskType: overrides.taskType || "SHARE",
        eventType: overrides.completionEventType || "SHARE_COMPLETED",
      },
      payloadDigest: "a".repeat(64),
      releaseId: null,
    },
  };
}

function receipt(envelope, created) {
  return {
    created,
    receiptId: "inbox-bridge-1",
    receiptStatus: created ? "RECEIVED" : "SUCCEEDED",
    envelope,
    checkpoint: { gapStatus: "CLEAR" },
  };
}

function basicPool() {
  return {
    async getConnection() {
      return {
        async execute(sql) {
          if (String(sql).startsWith("SET SESSION")) return [[], []];
          if (String(sql).includes("blocked_successor_active")) {
            return [[{ successor_unavailable_active_count: 0 }], []];
          }
          throw new Error("database access was not expected");
        },
        release() {},
        destroy() {},
      };
    },
  };
}

function loadBridge(outbox, inbox, loadOptions = {}) {
  const outboxPath = require.resolve("../src/mysqlOutboxDispatcher");
  const inboxPath = require.resolve("../src/mysqlInboxCheckpoint");
  const bridgePath = require.resolve("../src/mysqlOutboxToInboxBridgeHarness");
  const outboxModule = require(outboxPath);
  const inboxModule = require(inboxPath);
  const realOutboxFactory = outboxModule.createMysqlOutboxDispatcher;
  const realInboxFactory = inboxModule.createMysqlInboxCheckpoint;
  const factoryCalls = [];
  outboxModule.createMysqlOutboxDispatcher = (factoryOptions) => {
    factoryCalls.push(["outbox", factoryOptions]);
    return {
      ...outbox,
      async claimRegistered(registration, input) {
        if (loadOptions.filterToShare !== false
          && registration.descriptor.eventType !== "task.event.recorded.v1") return [];
        return outbox.claimRegistered(registration, input);
      },
      async recoverExpiredRegistered(registration, input) {
        if (loadOptions.filterToShare !== false
          && registration.descriptor.eventType !== "task.event.recorded.v1") return [];
        return outbox.recoverExpiredRegistered(registration, input);
      },
    };
  };
  inboxModule.createMysqlInboxCheckpoint = (options) => {
    factoryCalls.push(["inbox", options]);
    return inbox;
  };
  delete require.cache[bridgePath];
  const loaded = require(bridgePath);
  outboxModule.createMysqlOutboxDispatcher = realOutboxFactory;
  inboxModule.createMysqlInboxCheckpoint = realInboxFactory;
  return { ...loaded, factoryCalls };
}

const EMPTY_SCOPE_INSPECT = Object.freeze({
  receipt_lag_count: 0,
  claimed_count: 0,
  outbox_scope_mismatch_count: 0,
  registration_mismatch_count: 0,
  terminal_without_receipt_count: 0,
  outbox_open_dead_letter_count: 0,
});

function inspectRows(sql, row) {
  const text = String(sql);
  if (text.includes("inspect_scope:")) {
    return [text.includes("TASK_SHARE_COMPLETED_V1") ? row : EMPTY_SCOPE_INSPECT];
  }
  if (text.includes("inspect_unsupported_active")) {
    return [{ unregistered_active_count: row.unregistered_active_count || 0 }];
  }
  if (text.includes("inspect_dead_letter_companion")) {
    return [{
      dead_letter_companion_mismatch_count:
        row.dead_letter_companion_mismatch_count || 0,
    }];
  }
  if (text.includes("blocked_successor_active")) {
    return [{
      successor_unavailable_active_count: row.successor_unavailable_active_count || 0,
    }];
  }
  throw new Error("unexpected inspect query");
}

test("the bridge has a closed Interface and exact-false kill switch prevents every claim", async () => {
  let claimCalls = 0;
  const loaded = loadBridge({
    async claimRegistered() { claimCalls += 1; return []; },
  }, {});
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(),
    env: { MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED: "TRUE" },
    workerId: "bridge-worker-1",
  });
  assert.deepEqual(Object.keys(bridge), ["runOnce", "recoverOnce", "inspect"]);
  assert.equal(loaded.factoryCalls.length, 0);
  await assert.rejects(
    () => bridge.runOnce({ limit: 1 }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_DISABLED"
  );
  await assert.rejects(
    () => bridge.recoverOnce({ limit: 1 }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_DISABLED"
  );
  assert.equal(claimCalls, 0);
  assert.throws(
    () => loaded.createMysqlOutboxToInboxBridgeHarness({
      pool: basicPool(),
      env: ENABLED_ENV,
      workerId: "bridge-worker-1",
      dispatcherFactory() {},
    }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_CONFIGURATION_INVALID"
  );
});

test("runOnce receives the exact SHARE fact durably before completing the same fenced Outbox claim", async () => {
  const calls = [];
  const claim = shareClaim();
  const outbox = {
    async claimRegistered(registration, input) {
      calls.push(["claim", registration, input]);
      assert.equal(assertResolvedInboxHandlerRegistration(registration), registration);
      return [claim];
    },
    async completeOwned(value) {
      calls.push(["complete", value]);
      assert.equal(value, claim);
      return { status: "SUCCEEDED", leaseGeneration: value.leaseGeneration };
    },
    async failOwned() { throw new Error("must not fail"); },
  };
  const inbox = {
    async receive(envelope) {
      calls.push(["receive", envelope]);
      assert.deepEqual(Object.keys(envelope).sort(), [
        "aggregateId", "aggregateType", "aggregateVersion", "causationId", "correlationId",
        "eventId", "eventType", "idempotencyKey", "occurredAt", "partitionKey",
        "partitionPosition", "payload", "payloadDigest", "producerVersion", "schemaVersion", "sourceName",
      ].sort());
      assert.equal(envelope.eventId, claim.outboxEventId);
      assert.equal(envelope.payload.taskType, "SHARE");
      return receipt(envelope, true);
    },
  };
  const loaded = loadBridge(outbox, inbox);
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-1",
  });
  assert.equal(loaded.factoryCalls.length, 2);
  assert.equal(Object.hasOwn(loaded.factoryCalls[0][1], "adapterFactory"), false);
  const result = await bridge.runOnce({ limit: 3 });
  assert.deepEqual(result, {
    enabled: true,
    claimedCount: 1,
    inboxCreatedCount: 1,
    inboxReplayedCount: 0,
    outboxCompletedCount: 1,
    retryScheduledCount: 0,
    deadLetteredCount: 0,
  });
  assert.deepEqual(calls.map((call) => call[0]), ["claim", "receive", "complete"]);
  assert.deepEqual(calls[0][2], { limit: 3 });
  assert.equal(Object.isFrozen(result), true);
  await assert.rejects(
    () => bridge.runOnce({ limit: 1, handlerId: "task-share-completion-projection-v1" }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_INPUT_INVALID"
  );
  assert.deepEqual(calls.map((call) => call[0]), ["claim", "receive", "complete"]);
});

test("unsupported CHECKIN or another topic is never received, completed, or failed even if an Adapter violates claim scope", async () => {
  for (const claim of [shareClaim({ taskType: "CHECKIN", completionEventType: "CHECKIN_COMPLETED" }), shareClaim({ topic: "notification.events" })]) {
    const calls = { receive: 0, complete: 0, fail: 0 };
    const loaded = loadBridge({
      async claimRegistered() { return [claim]; },
      async completeOwned() { calls.complete += 1; },
      async failOwned() { calls.fail += 1; },
    }, {
      async receive() { calls.receive += 1; },
    });
    const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
      pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-1",
    });
    await assert.rejects(
      () => bridge.runOnce({ limit: 1 }),
      (error) => error.code === "OUTBOX_INBOX_BRIDGE_SCOPE_MISMATCH"
    );
    assert.deepEqual(calls, { receive: 0, complete: 0, fail: 0 });
  }
});

test("claim fencing is validated before Inbox receive", async () => {
  const claim = shareClaim();
  delete claim.leaseOwner;
  const calls = { receive: 0, complete: 0, fail: 0 };
  const loaded = loadBridge({
    async claimRegistered() { return [claim]; },
    async completeOwned() { calls.complete += 1; },
    async failOwned() { calls.fail += 1; },
  }, {
    async receive() { calls.receive += 1; },
  });
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-fence-1",
  });
  await assert.rejects(
    () => bridge.runOnce({ limit: 1 }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_SCOPE_MISMATCH"
  );
  assert.deepEqual(calls, { receive: 0, complete: 0, fail: 0 });
});

test("Inbox failure uses the existing Outbox retry transition and preserves the fenced claim", async () => {
  const claim = shareClaim({ leaseGeneration: 7, claimTransitionId: "bridge-claim-transition-7" });
  let failedClaim;
  let failureInput;
  const loaded = loadBridge({
    async claimRegistered() { return [claim]; },
    async failOwned(value, input) {
      failedClaim = value;
      failureInput = input;
      return { status: "RETRY_PENDING", leaseGeneration: value.leaseGeneration };
    },
    async completeOwned() { throw new Error("must not complete"); },
  }, {
    async receive() {
      const error = new Error("private database detail");
      error.code = "INBOX_CORE_PERSISTENCE_FAILED";
      throw error;
    },
  });
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-1",
  });
  const result = await bridge.runOnce({ limit: 1 });
  assert.equal(failedClaim, claim);
  assert.equal(failedClaim.leaseGeneration, 7);
  assert.equal(failedClaim.claimTransitionId, "bridge-claim-transition-7");
  assert.deepEqual(failureInput, {
    reasonCode: "OUTBOX_DISPATCH_FAILED",
    retryable: true,
  });
  assert.equal(result.retryScheduledCount, 1);
  assert.equal(result.outboxCompletedCount, 0);
});

test("a mixed outcome batch processes every claimed SHARE fact without a silent skip", async () => {
  const first = shareClaim({ outboxEventId: "outbox-bridge-1", taskEventId: "task-event-bridge-1" });
  const second = shareClaim({
    outboxEventId: "outbox-bridge-2",
    taskEventId: "task-event-bridge-2",
    leaseGeneration: 2,
    claimTransitionId: "bridge-claim-transition-2",
  });
  const received = [];
  const completed = [];
  const failed = [];
  const loaded = loadBridge({
    async claimRegistered() { return [first, second]; },
    async failOwned(claim) {
      failed.push(claim.outboxEventId);
      return { status: "RETRY_PENDING" };
    },
    async completeOwned(claim) {
      completed.push(claim.outboxEventId);
      return { status: "SUCCEEDED" };
    },
  }, {
    async receive(envelope) {
      received.push(envelope.eventId);
      if (envelope.eventId === first.outboxEventId) throw Object.assign(new Error("retry"), {
        code: "INBOX_CORE_PERSISTENCE_FAILED",
      });
      return receipt(envelope, true);
    },
  });
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-1",
  });
  const result = await bridge.runOnce({ limit: 2 });
  assert.deepEqual(received, [first.outboxEventId, second.outboxEventId]);
  assert.deepEqual(failed, [first.outboxEventId]);
  assert.deepEqual(completed, [second.outboxEventId]);
  assert.equal(result.claimedCount, 2);
  assert.equal(result.retryScheduledCount, 1);
  assert.equal(result.outboxCompletedCount, 1);
});

test("Inbox commit followed by unknown Outbox ACK converges through the exact receipt on the next claim", async () => {
  let claimRound = 0;
  let completeRound = 0;
  const receivedEventIds = [];
  const outbox = {
    async claimRegistered() {
      claimRound += 1;
      return [shareClaim({
        leaseGeneration: claimRound,
        claimTransitionId: `bridge-claim-transition-${claimRound}`,
      })];
    },
    async completeOwned() {
      completeRound += 1;
      if (completeRound === 1) throw new Error("commit acknowledgement unknown");
      return { status: "SUCCEEDED" };
    },
    async failOwned() { throw new Error("must not fail after durable Inbox receive"); },
  };
  const inbox = {
    async receive(envelope) {
      receivedEventIds.push(envelope.eventId);
      return receipt(envelope, receivedEventIds.length === 1);
    },
  };
  const loaded = loadBridge(outbox, inbox);
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-1",
  });
  await assert.rejects(
    () => bridge.runOnce({ limit: 1 }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_PERSISTENCE_FAILED"
  );
  const converged = await bridge.runOnce({ limit: 1 });
  assert.deepEqual(receivedEventIds, ["outbox-bridge-1", "outbox-bridge-1"]);
  assert.equal(converged.inboxCreatedCount, 0);
  assert.equal(converged.inboxReplayedCount, 1);
  assert.equal(converged.outboxCompletedCount, 1);
});

test("recoverOnce is constrained by the same branded Registration and cannot accept caller scope", async () => {
  let receivedRegistration;
  const loaded = loadBridge({
    async recoverExpiredRegistered(registration, input) {
      receivedRegistration = registration;
      assert.deepEqual(input, { limit: 2 });
      return [
        { status: "RETRY_PENDING" },
        { status: "DEAD_LETTER" },
      ];
    },
  }, {});
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: basicPool(), env: ENABLED_ENV, workerId: "bridge-worker-1",
  });
  assert.deepEqual(await bridge.recoverOnce({ limit: 2 }), {
    enabled: true,
    recoveredCount: 2,
    retryPendingCount: 1,
    deadLetteredCount: 1,
  });
  assert.equal(assertResolvedInboxHandlerRegistration(receivedRegistration), receivedRegistration);
  await assert.rejects(
    () => bridge.recoverOnce({ limit: 1, topic: "task.events" }),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_INPUT_INVALID"
  );
});

test("inspect returns only aggregate lag, mismatch, and kill-switch evidence without payload output", async () => {
  const calls = [];
  const connection = {
    async execute(sql, values = []) {
      calls.push([String(sql), values]);
      if (String(sql).startsWith("SET SESSION")) return [{ affectedRows: 0 }, []];
      const row = {
        receipt_lag_count: "4",
        claimed_count: 1,
        outbox_scope_mismatch_count: 2,
        registration_mismatch_count: "3",
        terminal_without_receipt_count: 0,
        unregistered_active_count: "5",
        outbox_open_dead_letter_count: "6",
        dead_letter_companion_mismatch_count: "7",
      };
      return [inspectRows(sql, row), []];
    },
    async beginTransaction() { calls.push(["BEGIN", []]); },
    async rollback() { calls.push(["ROLLBACK", []]); },
    release() { calls.push(["RELEASE", []]); },
    destroy() { calls.push(["DESTROY", []]); },
  };
  const pool = { async getConnection() { return connection; } };
  const loaded = loadBridge({}, {});
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool,
    env: { MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED: "false" },
    workerId: "bridge-worker-1",
  });
  const result = await bridge.inspect();
  assert.deepEqual(result, {
    enabled: false,
    killSwitch: "CLOSED",
    lag: { receipt: 4, claimed: 1 },
    mismatch: {
      outboxScope: 2,
      inboxRegistration: 3,
      terminalWithoutReceipt: 0,
      unregisteredActive: 5,
      successorUnavailableActive: 0,
      outboxOpenDeadLetter: 6,
      deadLetterCompanion: 7,
    },
    readiness: { ready: false, reasonCode: "BRIDGE_DISABLED" },
  });
  const inspectCall = calls.find((call) => call[0].includes("outbox_inbox_bridge:inspect_scope"));
  assert.ok(inspectCall);
  assert.equal(inspectCall[0].includes("SELECT o.payload_json"), false);
  assert.equal(inspectCall[0].includes("SELECT mismatch.payload_json"), false);
  const unsupportedCall = calls.find((call) => call[0].includes("inspect_unsupported_active"));
  const companionCall = calls.find((call) => call[0].includes("inspect_dead_letter_companion"));
  assert.match(unsupportedCall[0], /FROM outbox_event AS unsupported/);
  assert.match(unsupportedCall[0], /unsupported\.status IN \('PENDING', 'RETRY_PENDING', 'CLAIMED'\)/);
  assert.match(unsupportedCall[0], /unsupported\.`topic` = \?/);
  assert.match(inspectCall[0], /outbox_open_dead_letter_count/);
  assert.match(companionCall[0], /dead_letter_companion_mismatch_count/);
  assert.match(companionCall[0], /FROM event_dead_letter AS dead/);
  assert.match(companionCall[0], /dead\.direction = 'OUTBOX'/);
  assert.match(companionCall[0], /dead\.status = 'OPEN'/);
  assert.match(companionCall[0], /bridge_companion:source_anchor/);
  assert.match(companionCall[0], /bridge_companion:dead_claim_anchor/);
  assert.equal(JSON.stringify(result).includes("payload"), false);
  assert.equal(calls.some((call) => call[0] === "ROLLBACK"), true);
  assert.equal(calls.some((call) => call[0] === "RELEASE"), true);
});

test("companion SQL has independent source and self-claimed anchors for active, malformed and orphan rows", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/mysqlOutboxToInboxBridgeHarness.js"),
    "utf8"
  );
  const sourceAnchorStart = source.indexOf("/* bridge_companion:source_anchor */");
  const deadClaimStart = source.indexOf("/* bridge_companion:dead_claim_anchor */");
  const companionEnd = source.indexOf("AS dead_letter_companion_mismatch_count", deadClaimStart);
  assert.ok(sourceAnchorStart > 0 && deadClaimStart > sourceAnchorStart);
  assert.ok(companionEnd > deadClaimStart);

  const sourceAnchor = source.slice(sourceAnchorStart, deadClaimStart);
  assert.match(sourceAnchor, /dead_source\.status = 'DEAD_LETTER'/);
  assert.match(sourceAnchor, /NOT \(dead\.source_name <=> dead_source\.source_name\)/);
  assert.doesNotMatch(sourceAnchor, /AND dead\.source_name = 'myroot-api'/);
  assert.doesNotMatch(sourceAnchor, /AND dead\.event_type = 'task\.event\.recorded\.v1'/);

  const deadClaimAnchor = source.slice(deadClaimStart, companionEnd);
  assert.match(deadClaimAnchor, /dead\.source_name = 'myroot-api'/);
  assert.match(deadClaimAnchor, /dead\.event_type = 'task\.event\.recorded\.v1'/);
  assert.match(deadClaimAnchor, /dead\.partition_key LIKE 'task_event:%'/);
  assert.match(deadClaimAnchor, /COALESCE\(/);
  assert.match(deadClaimAnchor, /dead_source\.outbox_event_id IS NULL/);
  assert.match(deadClaimAnchor, /dead_source\.status <> 'DEAD_LETTER'/);
  assert.match(deadClaimAnchor, /dead_source\.outbox_event_id IS NULL/);
});

test("inspect destroys a connection whose transaction begin outcome is uncertain", async () => {
  const retire = [];
  const connection = {
    async execute() { return [{ affectedRows: 0 }, []]; },
    async beginTransaction() { throw new Error("begin acknowledgement unknown secret=must-not-leak"); },
    async rollback() { throw new Error("must not rollback a begin-unknown connection"); },
    release() { retire.push("release"); },
    destroy() { retire.push("destroy"); },
  };
  const loaded = loadBridge({}, {});
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: { async getConnection() { return connection; } },
    env: {},
    workerId: "bridge-worker-1",
  });
  await assert.rejects(
    () => bridge.inspect(),
    (error) => error.code === "OUTBOX_INBOX_BRIDGE_PERSISTENCE_FAILED"
      && !JSON.stringify(error).includes("must-not-leak")
  );
  assert.deepEqual(retire, ["destroy"]);
});

test("inspect marks an enabled bridge ready only when every static-scope mismatch is zero", async () => {
  const connection = {
    async execute(sql) {
      if (String(sql).startsWith("SET SESSION")) return [{ affectedRows: 0 }, []];
      const row = {
        receipt_lag_count: 7,
        claimed_count: 2,
        outbox_scope_mismatch_count: 0,
        registration_mismatch_count: 0,
        terminal_without_receipt_count: 0,
        unregistered_active_count: 0,
        outbox_open_dead_letter_count: 0,
        dead_letter_companion_mismatch_count: 0,
      };
      return [inspectRows(sql, row), []];
    },
    async beginTransaction() {},
    async rollback() {},
    release() {},
    destroy() {},
  };
  const loaded = loadBridge({}, {});
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: { async getConnection() { return connection; } },
    env: ENABLED_ENV,
    workerId: "bridge-worker-1",
  });
  const result = await bridge.inspect();
  assert.deepEqual(result.readiness, { ready: true, reasonCode: "BRIDGE_SCOPE_READY" });
  assert.equal(result.mismatch.unregisteredActive, 0);
  assert.equal(result.mismatch.successorUnavailableActive, 0);
  assert.equal(result.mismatch.outboxOpenDeadLetter, 0);
  assert.equal(result.mismatch.deadLetterCompanion, 0);
  assert.equal(result.lag.receipt, 7);
});

test("inspect blocks an enabled bridge for scoped open dead letters or companion drift", async () => {
  const rows = [{
    receipt_lag_count: 0,
    claimed_count: 0,
    outbox_scope_mismatch_count: 0,
    registration_mismatch_count: 0,
    terminal_without_receipt_count: 0,
    unregistered_active_count: 0,
    outbox_open_dead_letter_count: 2,
    dead_letter_companion_mismatch_count: 1,
  }];
  const connection = {
    async execute(sql) {
      if (String(sql).startsWith("SET SESSION")) return [{ affectedRows: 0 }, []];
      return [inspectRows(sql, rows[0]), []];
    },
    async beginTransaction() {},
    async rollback() {},
    release() {},
    destroy() {},
  };
  const loaded = loadBridge({}, {});
  const bridge = loaded.createMysqlOutboxToInboxBridgeHarness({
    pool: { async getConnection() { return connection; } },
    env: ENABLED_ENV,
    workerId: "bridge-worker-1",
  });
  const result = await bridge.inspect();
  assert.deepEqual(result.mismatch, {
    outboxScope: 0,
    inboxRegistration: 0,
    terminalWithoutReceipt: 0,
    unregisteredActive: 0,
    successorUnavailableActive: 0,
    outboxOpenDeadLetter: 2,
    deadLetterCompanion: 1,
  });
  assert.deepEqual(result.readiness, {
    ready: false,
    reasonCode: "BRIDGE_SCOPE_REVIEW_REQUIRED",
  });
});

test("bridge source contains no external Delivery Adapter, network call, timer, scheduler, or caller factory seam", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mysqlOutboxToInboxBridgeHarness.js"), "utf8");
  assert.doesNotMatch(source, /require\(["'](?:node:)?(?:http|https|net|tls|dgram|dns)["']\)/);
  assert.doesNotMatch(source, /\b(?:fetch|axios|setInterval|setTimeout|cron|scheduler)\b/);
  assert.doesNotMatch(source, /DeliveryAdapter|deliveryAdapter|dispatcherFactory|inboxFactory|adapterFactory/);
  assert.doesNotMatch(source, /process\.env\[[^\]]+\]\s*=/);
  assert.doesNotMatch(source, /assertSuccessorAvailable|OUTBOX_INBOX_BRIDGE_SUCCESSOR_UNAVAILABLE/);
});
