const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createCommandRequestDigestCodec } = require("../src/commandRequestDigest");
const domain = require("../src/domain");
const { PROJECTIONS } = require("../src/mysqlProjection");
const { createMemoryStore } = require("../src/store");
const taskProgress = require("../src/taskProgress");
const {
  inspectTaskEventIdempotencyDeploymentCompatibility,
} = require("../src/taskEventIdempotencyDeploymentCompatibility");
const {
  TASK_EVENT_IDEMPOTENCY_OPERATION,
} = require("../src/taskEventIdempotency");

function input(rootUserId, overrides = {}) {
  const taskType = overrides.taskType || "SHARE";
  const taskDate = overrides.taskDate || "2026-07-18";
  const value = {
    rootUserId,
    taskType,
    taskDate,
    payload: overrides.payload || { taskDate, scene: "IDEMPOTENCY_SCOPE_TEST" },
    idempotencyKey: Object.prototype.hasOwnProperty.call(overrides, "idempotencyKey")
      ? overrides.idempotencyKey
      : "shared-client-key",
    sourceChannel: overrides.sourceChannel || "TEST",
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "occurredAt")) {
    value.occurredAt = overrides.occurredAt;
  }
  return value;
}

const PREVIOUS_DIGEST_ENV = Object.freeze({
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "task-event-previous-request-digest-secret-with-strong-entropy-2025",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "task-event-request-previous-v1",
});

const CURRENT_DIGEST_ENV = Object.freeze({
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "task-event-current-request-digest-secret-with-strong-entropy-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "task-event-request-current-v2",
  ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: JSON.stringify({
    "task-event-request-previous-v1": PREVIOUS_DIGEST_ENV.ROOT_COMMAND_REQUEST_DIGEST_KEY,
  }),
});

test("task event idempotency key rejects Unicode, whitespace normalization and overlength", () => {
  for (const idempotencyKey of ["任务键", " spaced-key ", "x".repeat(129)]) {
    const data = domain.createStore();
    assert.throws(
      () => taskProgress.recordTaskEvent(data, input("root-idempotency-invalid-key", {
        idempotencyKey,
      })),
      (error) => (
        error.code === "TASK_EVENT_IDEMPOTENCY_SCOPE_INVALID"
        && error.status === 400
      ),
      JSON.stringify(idempotencyKey)
    );
    assert.equal(data.taskEvents.length, 0);
  }
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { status: response.status, body: await response.json() };
}

async function login(baseUrl, suffix) {
  const response = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: `task_idempotency_${suffix}`, appCode: "MYROOT" }),
  });
  assert.equal(response.body.code, 0);
  return {
    authorization: { Authorization: `Bearer ${response.body.data.token}` },
    rootUserId: response.body.data.user.rootUserId,
  };
}

test("task event idempotency scope never returns another root user's event", () => {
  const data = domain.createStore();
  const first = taskProgress.recordTaskEvent(data, input("root-idempotency-a"));
  const second = taskProgress.recordTaskEvent(data, input("root-idempotency-b"));

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.event.task_event_id, second.event.task_event_id);
  assert.equal(first.event.root_user_id, "root-idempotency-a");
  assert.equal(second.event.root_user_id, "root-idempotency-b");
  assert.equal(data.taskEvents.length, 2);
  assert.equal(first.event.idempotency_operation, TASK_EVENT_IDEMPOTENCY_OPERATION);
  assert.match(first.event.request_digest, /^[a-f0-9]{64}$/);
});

test("same root, operation and key replays only an equal request digest", () => {
  const data = domain.createStore();
  const first = taskProgress.recordTaskEvent(data, input("root-idempotency-replay"));
  const replay = taskProgress.recordTaskEvent(data, input("root-idempotency-replay"));

  assert.equal(replay.created, false);
  assert.equal(replay.event.task_event_id, first.event.task_event_id);
  assert.throws(
    () => taskProgress.recordTaskEvent(data, input("root-idempotency-replay", {
      payload: { taskDate: "2026-07-18", scene: "CHANGED_REQUEST" },
    })),
    (error) => error.code === 40901 && error.status === 409
  );
  assert.throws(
    () => taskProgress.recordTaskEvent(data, input("root-idempotency-replay", {
      taskType: "CONSULTATION",
    })),
    (error) => error.code === 40901 && error.status === 409
  );
  assert.equal(data.taskEvents.length, 1);
});

test("legacy task events require known occurred-at provenance before digest upgrade", () => {
  const data = domain.createStore();
  const first = taskProgress.recordTaskEvent(data, input("root-idempotency-legacy"));
  delete first.event.idempotency_operation;
  delete first.event.request_canonical_version;
  delete first.event.request_digest;
  delete first.event.request_digest_scheme;
  delete first.event.request_digest_key_id;
  delete first.event.occurred_at_client_supplied;

  assert.throws(
    () => taskProgress.recordTaskEvent(data, input("root-idempotency-legacy")),
    (error) => (
      error.code === "TASK_EVENT_IDEMPOTENCY_PROVENANCE_UNKNOWN"
      && error.status === 503
    )
  );
  assert.equal(first.event.request_digest, undefined);

  first.event.occurred_at_client_supplied = false;
  const replay = taskProgress.recordTaskEvent(data, input("root-idempotency-legacy"));
  assert.equal(replay.created, false);
  assert.equal(replay.event.idempotency_operation, TASK_EVENT_IDEMPOTENCY_OPERATION);
  assert.match(replay.event.request_digest, /^[a-f0-9]{64}$/);

  delete replay.event.request_canonical_version;
  delete replay.event.request_digest;
  delete replay.event.request_digest_scheme;
  delete replay.event.request_digest_key_id;
  assert.throws(
    () => taskProgress.recordTaskEvent(data, input("root-idempotency-legacy", {
      payload: { taskDate: "2026-07-18", scene: "LEGACY_DRIFT" },
    })),
    (error) => error.code === 40901 && error.status === 409
  );
});

test("legacy client-supplied occurredAt never equals an omitted occurredAt replay", () => {
  const data = domain.createStore();
  const first = taskProgress.recordTaskEvent(data, input("root-idempotency-legacy-time", {
    idempotencyKey: "legacy-time-key",
    occurredAt: "2026-07-18T09:30:00+08:00",
  }));
  for (const field of [
    "request_canonical_version",
    "request_digest",
    "request_digest_scheme",
    "request_digest_key_id",
  ]) delete first.event[field];
  first.event.occurred_at_client_supplied = null;

  assert.throws(
    () => taskProgress.recordTaskEvent(data, input("root-idempotency-legacy-time", {
      idempotencyKey: "legacy-time-key",
    })),
    (error) => error.code === "TASK_EVENT_IDEMPOTENCY_PROVENANCE_UNKNOWN" && error.status === 503
  );
  assert.equal(first.event.request_digest, undefined);
});

test("previous task-event request digest verifies and rotates to the current key", () => {
  const data = domain.createStore();
  const request = input("root-idempotency-rotation", { idempotencyKey: "rotation-key" });
  const first = taskProgress.recordTaskEvent(data, request, {
    taskEventRequestDigestCodec: createCommandRequestDigestCodec(PREVIOUS_DIGEST_ENV),
  });
  assert.equal(first.event.request_digest_key_id, "task-event-request-previous-v1");

  const replay = taskProgress.recordTaskEvent(data, request, {
    taskEventRequestDigestCodec: createCommandRequestDigestCodec(CURRENT_DIGEST_ENV),
  });
  assert.equal(replay.created, false);
  assert.equal(replay.event.task_event_id, first.event.task_event_id);
  assert.equal(replay.event.request_digest_key_id, "task-event-request-current-v2");
});

test("snapshot validation permits cross-user key reuse and rejects scoped duplicates or partial digests", () => {
  const data = domain.createStore();
  const first = taskProgress.recordTaskEvent(data, input("root-snapshot-a"));
  taskProgress.recordTaskEvent(data, input("root-snapshot-b"));
  const adapter = createMemoryStore(data, { seedSampleData: false });
  assert.equal(adapter.validateSnapshot().valid, true);

  const duplicate = JSON.parse(JSON.stringify(first.event));
  duplicate.task_event_id = "tev_scoped_duplicate";
  adapter.data.taskEvents.push(duplicate);
  const duplicateResult = adapter.validateSnapshot();
  assert.equal(duplicateResult.valid, false);
  assert.equal(duplicateResult.errors.some((message) => message.includes("duplicate task event idempotency scope")), true);

  adapter.data.taskEvents.pop();
  first.event.request_digest_key_id = "";
  const partialResult = createMemoryStore(data, { seedSampleData: false }).validateSnapshot();
  assert.equal(partialResult.valid, false);
  assert.equal(partialResult.errors.some((message) => message.includes("task event idempotency digest invalid")), true);
});

test("task event MySQL projection and staged migrations carry scoped digest authority", () => {
  const projection = PROJECTIONS.find((candidate) => candidate.table === "task_event");
  for (const column of [
    "idempotency_operation",
    "request_canonical_version",
    "request_digest",
    "request_digest_scheme",
    "request_digest_key_id",
    "occurred_at_client_supplied",
  ]) {
    assert.equal(projection.columns.includes(column), true, column);
  }

  const migrationsDirectory = path.join(__dirname, "..", "db", "migrations");
  const stage = fs.readFileSync(path.join(migrationsDirectory, "046_task_event_idempotency_scope_stage.sql"), "utf8");
  const backfill = fs.readFileSync(path.join(migrationsDirectory, "047_task_event_idempotency_scope_backfill.sql"), "utf8");
  const enforce = fs.readFileSync(path.join(migrationsDirectory, "048_task_event_idempotency_scope_enforce.sql"), "utf8");
  assert.match(stage, /ADD COLUMN idempotency_operation VARCHAR\(64\)/i);
  assert.match(stage, /ADD COLUMN request_digest CHAR\(64\)/i);
  assert.match(
    stage,
    /ADD COLUMN occurred_at_client_supplied TINYINT\(1\) NULL/i
  );
  assert.doesNotMatch(stage, /occurred_at_client_supplied TINYINT\(1\) NOT NULL|DEFAULT 0/i);
  assert.match(backfill, /SET idempotency_operation = 'RECORD_TASK_EVENT:v1'/i);
  assert.match(enforce, /DROP INDEX uk_task_event_idempotency/i);
  assert.match(
    enforce,
    /MODIFY COLUMN idempotency_operation VARCHAR\(64\)[\s\S]*NOT NULL DEFAULT 'RECORD_TASK_EVENT:v1'/i
  );
  assert.match(
    enforce,
    /idempotency_key NOT REGEXP '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}\$'/i
  );
  assert.doesNotMatch(enforce, /SET\s+idempotency_key\s*=/i);
  for (const column of [
    "request_canonical_version",
    "request_digest",
    "request_digest_scheme",
    "request_digest_key_id",
  ]) {
    assert.equal(
      (enforce.match(new RegExp(`${column} IS NOT NULL`, "g")) || []).length,
      2,
      `${column} must fail closed in both preflight and CHECK`
    );
  }
  assert.match(
    enforce,
    /UNIQUE KEY uk_task_event_idempotency_scope \(\s*root_user_id,\s*idempotency_operation,\s*idempotency_key\s*\)/i
  );
  assert.match(enforce, /GROUP BY root_user_id, idempotency_operation, idempotency_key/i);
  assert.match(
    enforce,
    /occurred_at_client_supplied IS NOT NULL[\s\S]*occurred_at_client_supplied NOT IN \(0, 1\)/i
  );
  assert.match(
    enforce,
    /CONSTRAINT chk_task_event_occurred_at_provenance[\s\S]*occurred_at_client_supplied IS NULL[\s\S]*occurred_at_client_supplied IN \(0, 1\)/i
  );
  assert.match(
    enforce,
    /KEY idx_task_event_request_digest_crypto \(\s*request_digest_scheme,\s*request_digest_key_id,\s*task_event_id\s*\)/i
  );
});

test("deployment compatibility remains a hard blocker without drained-instance and rollback-artifact evidence", () => {
  const local = inspectTaskEventIdempotencyDeploymentCompatibility({
    environment: "local",
    legacyInstancesDrained: {
      status: "VERIFIED",
      evidenceRef: "local-only",
      signerRef: "local-test",
      verifiedAt: "2026-07-18T10:00:00+08:00",
    },
    rollbackArtifact: {
      status: "VERIFIED",
      artifactDigest: "a".repeat(64),
      evidenceRef: "local-only",
      signerRef: "local-test",
      verifiedAt: "2026-07-18T10:00:00+08:00",
      scopedLookupIncluded: true,
      stagedColumnsWriteCompatible: true,
    },
  });
  assert.equal(local.ready, false);
  assert.equal(local.hardBlocker, true);
  assert.equal(local.blockers.includes("LIVE_ENVIRONMENT_EVIDENCE_REQUIRED"), true);

  const missing = inspectTaskEventIdempotencyDeploymentCompatibility({ environment: "production" });
  assert.equal(missing.ready, false);
  assert.equal(missing.blockers.includes("LEGACY_INSTANCES_DRAIN_NOT_VERIFIED"), true);
  assert.equal(missing.blockers.includes("ROLLBACK_ARTIFACT_NOT_VERIFIED"), true);
});
