const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  getDefaultMigrationContractRegistry,
} = require("../src/migrationContractRegistry");
const {
  createMysqlMigrationExecutionFoundation,
} = require("../src/mysqlMigrationExecutionFoundation");
const taskShareContract = require("../src/migrationContracts/taskShareSyntheticV1");

const NOW = "2026-07-17 12:00:00.000";
const ENABLED_ENV = Object.freeze({
  NODE_ENV: "test",
  MYROOT_MIGRATION_EXECUTION_FOUNDATION_ENABLED: "true",
  MYROOT_MIGRATION_EXECUTION_ENVIRONMENT: "LOCAL_ISOLATED",
});
const DISABLED_ENV = Object.freeze({ NODE_ENV: "test" });

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function registration() {
  return getDefaultMigrationContractRegistry().assertScope({
    contractId: "TASK_SHARE_SYNTHETIC_V1",
    targetSchemaVersion: "TASK_SHARE_MIGRATION_V1",
  });
}

function source(overrides = {}) {
  return {
    task_event_id: "tev-share-001",
    task_type: "SHARE",
    event_type: "SHARE_COMPLETED",
    status: "SUCCEEDED",
    occurred_at_wall_time: "2026-07-17 09:00:00.000",
    ...overrides,
  };
}

function openInput(overrides = {}) {
  return {
    migrationRunId: "migration-run-001",
    contractId: "TASK_SHARE_SYNTHETIC_V1",
    mode: "APPLY",
    requestId: "open-request-001",
    snapshotId: "snapshot-001",
    snapshotRevision: "revision-001",
    snapshotAt: "2026-07-17T02:00:00.000Z",
    targetSchemaVersion: "TASK_SHARE_MIGRATION_V1",
    replaySourceRunId: null,
    replaySourceResultDigest: null,
    replayThroughCursorValue: null,
    replayThroughTieBreaker: null,
    ...overrides,
  };
}

function batchInput(overrides = {}) {
  return {
    migrationRunId: "migration-run-001",
    leaseOwner: "migration-worker-001",
    leaseSeconds: 30,
    batchId: "batch-001",
    requestId: "batch-request-001",
    ...overrides,
  };
}

function verifyInput(overrides = {}) {
  return {
    migrationRunId: "migration-run-001",
    leaseOwner: "migration-verifier-001",
    leaseSeconds: 30,
    requestId: "verify-request-001",
    ...overrides,
  };
}

function contractRow(values) {
  const keys = [
    "contract_id", "contract_version", "registry_version", "registry_digest",
    "fact_type", "authoritative_source", "source_type", "source_query_id",
    "source_query_digest", "source_adapter_id", "source_adapter_digest",
    "target_type", "target_schema_version", "target_adapter_id",
    "target_adapter_digest", "parity_adapter_id", "parity_adapter_digest",
    "cursor_type", "inclusive", "maximum_batch_size", "allows_network",
    "allows_outbox", "contract_digest",
  ];
  return { ...Object.fromEntries(keys.map((key, index) => [key, values[index]])), status: "ACTIVE" };
}

function runRow(values) {
  const keys = [
    "migration_run_id", "registry_version", "registry_digest", "contract_id",
    "contract_version", "contract_digest", "migration_mode", "request_id",
    "snapshot_id", "snapshot_revision", "snapshot_at_wall_time",
    "source_query_id", "source_query_digest", "source_adapter_digest",
    "target_adapter_digest", "parity_adapter_digest", "target_schema_version",
    "cursor_type", "cursor_value", "cursor_tie_breaker",
    "last_contiguous_cursor_value", "last_contiguous_tie_breaker", "transition_id",
    "replay_source_run_id", "replay_source_result_digest",
    "replay_through_cursor_value", "replay_through_tie_breaker",
  ];
  return {
    ...Object.fromEntries(keys.map((key, index) => [key, values[index]])),
    status: "OPEN",
    inclusive: 0,
    lease_owner: null,
    lease_expires_at_wall_time: null,
    lease_generation: 0,
    processed_count: 0,
    migrated_count: 0,
    idempotent_count: 0,
    conflict_count: 0,
    quarantined_count: 0,
    review_required_count: 0,
    batch_count: 0,
    result_digest: null,
    last_error_code: null,
    opened_at_wall_time: NOW,
    verified_at_wall_time: null,
    completed_at_wall_time: null,
  };
}

function lineageRow(values) {
  const keys = [
    "migration_lineage_id", "base_lineage_identity", "lineage_identity",
    "lineage_event_type", "event_sequence", "migration_run_id", "contract_id",
    "contract_version", "fact_type", "source_type", "source_id", "target_type",
    "target_id", "source_checksum", "target_checksum", "snapshot_id",
    "snapshot_revision", "batch_id", "request_id", "cursor_type", "cursor_value",
    "tie_breaker", "target_schema_version", "status", "error_code", "replayed_at",
  ];
  return { ...Object.fromEntries(keys.map((key, index) => [key, values[index]])), reversed_at: null };
}

function targetRow(values) {
  const keys = [
    "target_record_id", "contract_id", "source_task_event_id",
    "target_schema_version", "task_type", "completion_event_type",
    "occurred_at_wall_time", "source_checksum", "target_checksum",
  ];
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function createPool(options = {}) {
  const state = {
    contract: options.contract ? clone(options.contract) : null,
    runs: clone(options.runs || {}),
    lineages: clone(options.lineages || []),
    targets: clone(options.targets || []),
    sources: clone(options.sources || [source()]),
  };
  const telemetry = {
    executes: [], begins: 0, commits: 0, rollbacks: 0, releases: 0, destroys: 0,
  };
  let connectionNumber = 0;
  let commitNumber = 0;

  function connection() {
    connectionNumber += 1;
    let tx = null;
    return {
      async beginTransaction() { telemetry.begins += 1; tx = clone(state); },
      async commit() {
        telemetry.commits += 1;
        commitNumber += 1;
        const mode = options.commitFailures && options.commitFailures[commitNumber];
        if (mode !== "BEFORE_APPLY_THROW" && tx) Object.assign(state, clone(tx));
        tx = null;
        if (mode) throw new Error("simulated commit acknowledgement loss");
      },
      async rollback() { telemetry.rollbacks += 1; tx = null; },
      release() { telemetry.releases += 1; },
      destroy() { telemetry.destroys += 1; },
      async execute(sql, values = []) {
        telemetry.executes.push({ sql, values: clone(values), connectionNumber });
        if (sql === "SET time_zone = ?") return [{ affectedRows: 0 }];
        const data = tx || state;
        if (sql.includes("migration-execution:contract-read")) {
          return [[data.contract ? clone(data.contract) : undefined].filter(Boolean)];
        }
        if (sql.includes("migration-execution:contract-insert")) {
          data.contract = contractRow(values);
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("migration-execution:run-find")) {
          const rows = Object.values(data.runs).filter((row) => (
            row.migration_run_id === values[0]
            || (row.contract_id === values[1] && row.request_id === values[2])
          ));
          return [clone(rows)];
        }
        if (sql.includes("migration-execution:run-insert")) {
          data.runs[values[0]] = runRow(values);
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("migration-execution:run-read")) {
          const row = data.runs[values[0]];
          return [[row ? { ...clone(row), db_now: NOW } : undefined].filter(Boolean)];
        }
        if (sql.includes("migration-execution:run-claim")) {
          const row = data.runs[values[3]];
          if (!row || !["OPEN", "PARITY_PENDING", "RUNNING"].includes(row.status)) {
            return [{ affectedRows: 0 }];
          }
          row.status = "RUNNING";
          row.lease_owner = values[0];
          row.lease_expires_at_wall_time = "2026-07-17 12:05:00.000";
          row.lease_generation += 1;
          row.transition_id = values[2];
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("migration-execution:task-share-source-read-v1")) {
          const snapshot = values[0];
          const lowerTime = values[1];
          const lowerId = values[4];
          const throughTime = values[5];
          const throughId = values[8];
          const limit = values[9];
          return [clone(data.sources.filter((row) => (
            row.occurred_at_wall_time <= snapshot
            && (lowerTime === null || row.occurred_at_wall_time > lowerTime
              || (row.occurred_at_wall_time === lowerTime && row.task_event_id > lowerId))
            && (throughTime === null || row.occurred_at_wall_time < throughTime
              || (row.occurred_at_wall_time === throughTime && row.task_event_id <= throughId))
          )).slice(0, limit))];
        }
        if (sql.includes("migration-execution:lineage-read")) {
          return [clone(data.lineages.filter((row) => row.lineage_identity === values[0]))];
        }
        if (sql.includes("migration-execution:task-share-target-read-v1")) {
          return [clone(data.targets.filter((row) => row.contract_id === values[0]
            && row.source_task_event_id === values[1]
            && row.target_schema_version === values[2]).slice(0, 2))];
        }
        if (sql.includes("migration-execution:task-share-target-insert-v1")) {
          data.targets.push(targetRow(values));
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("migration-execution:lineage-insert")) {
          data.lineages.push(lineageRow(values));
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("migration-execution:batch-finish")) {
          const row = data.runs[values[15]];
          if (!row || row.status !== "RUNNING" || row.lease_owner !== values[16]
            || row.lease_generation !== values[17] || row.transition_id !== values[18]) {
            return [{ affectedRows: 0 }];
          }
          row.status = values[0];
          row.cursor_value = values[1];
          row.cursor_tie_breaker = values[2];
          row.last_contiguous_cursor_value = values[3];
          row.last_contiguous_tie_breaker = values[4];
          row.lease_owner = null;
          row.lease_expires_at_wall_time = null;
          row.processed_count += values[5];
          row.migrated_count += values[6];
          row.idempotent_count += values[7];
          row.conflict_count += values[8];
          row.quarantined_count += values[9];
          row.review_required_count += values[10];
          row.batch_count += 1;
          row.result_digest = values[11];
          row.last_error_code = values[12];
          row.transition_id = values[13];
          if (row.status === "REVIEW_REQUIRED") row.completed_at_wall_time = NOW;
          return [{ affectedRows: 1 }];
        }
        if (sql.includes("migration-execution:dry-run-parity-read")) {
          const rows = data.lineages.filter((row) => row.migration_run_id === values[0]
            && ["MIGRATION", "FORWARD_REPLAY"].includes(row.lineage_event_type));
          return [[{ lineage_count: rows.length, mismatch_count: rows.filter((row) => row.status !== "DRY_RUN_VERIFIED").length }]];
        }
        if (sql.includes("migration-execution:task-share-parity-read-v1")) {
          const rows = data.lineages.filter((row) => row.migration_run_id === values[0]
            && ["MIGRATION", "FORWARD_REPLAY"].includes(row.lineage_event_type)
            && ["MIGRATED", "IDEMPOTENT", "FORWARD_REPLAYED"].includes(row.status));
          let mismatches = 0;
          for (const lineage of rows) {
            const target = data.targets.find((item) => item.target_record_id === lineage.target_id);
            if (!target || target.source_checksum !== lineage.source_checksum
              || target.target_checksum !== lineage.target_checksum) mismatches += 1;
          }
          return [[{ lineage_count: rows.length, target_count: rows.length - mismatches, mismatch_count: mismatches }]];
        }
        if (sql.includes("migration-execution:verify-finish")) {
          const row = data.runs[values[5]];
          if (!row || row.status !== "RUNNING" || row.lease_owner !== values[6]
            || row.lease_generation !== values[7] || row.transition_id !== values[8]) {
            return [{ affectedRows: 0 }];
          }
          row.status = values[0];
          row.lease_owner = null;
          row.lease_expires_at_wall_time = null;
          row.result_digest = values[1];
          row.last_error_code = values[2];
          row.transition_id = values[3];
          row.verified_at_wall_time = row.status === "VERIFIED" ? NOW : null;
          row.completed_at_wall_time = NOW;
          return [{ affectedRows: 1 }];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
  }
  return {
    pool: { async getConnection() { return connection(); } },
    state,
    telemetry,
  };
}

test("default is disabled and production cannot enable the Foundation", async () => {
  const fake = createPool();
  const disabled = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: DISABLED_ENV });
  await assert.rejects(() => disabled.openRun(openInput()), { code: "MIGRATION_EXECUTION_DISABLED" });
  assert.throws(() => createMysqlMigrationExecutionFoundation({
    pool: fake.pool,
    env: { ...ENABLED_ENV, NODE_ENV: "production" },
  }), { code: "MIGRATION_EXECUTION_CONFIGURATION_INVALID" });
  assert.equal(fake.telemetry.executes.length, 0);
});

test("Interface is deep, static, and contains no network or Adapter injection seam", () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  assert.deepEqual(Object.keys(foundation).sort(), [
    "forwardReplay", "inspect", "openRun", "runNextBatch", "verifyRun",
  ]);
  assert.throws(() => createMysqlMigrationExecutionFoundation({
    pool: fake.pool, env: ENABLED_ENV, sourceReader: () => {},
  }), { code: "MIGRATION_EXECUTION_CONFIGURATION_INVALID" });
  const implementation = fs.readFileSync(path.join(__dirname, "../src/mysqlMigrationExecutionFoundation.js"), "utf8");
  assert.doesNotMatch(implementation, /\bfetch\s*\(|\baxios\b|https?\.request|createServer\s*\(/);
  assert.match(
    taskShareContract.statements.sourceRead,
    /LEFT\(DATE_FORMAT\(occurred_at, '[^']+%f'\), 23\) AS occurred_at_wall_time/
  );
  assert.match(taskShareContract.statements.sourceRead, /BINARY task_event_id > BINARY \?/);
  assert.match(taskShareContract.statements.sourceRead, /ORDER BY occurred_at ASC, BINARY task_event_id ASC/);
  assert.match(
    taskShareContract.statements.targetRead,
    /LEFT\(DATE_FORMAT\(occurred_at, '[^']+%f'\), 23\) AS occurred_at_wall_time/
  );
  assert.match(implementation, /LEFT\(DATE_FORMAT\(snapshot_at, '[^']+%f'\), 23\)/);
  assert.throws(() => taskShareContract.normalizeSource(source({ task_event_id: "任务-001" })), {
    code: "MIGRATION_EXECUTION_SOURCE_DRIFT",
  });
});

test("APPLY persists item lineage, advances the exclusive composite cursor, and verifies parity", async () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  const opened = await foundation.openRun(openInput());
  assert.equal(opened.status, "OPEN");
  const batched = await foundation.runNextBatch(batchInput());
  assert.equal(batched.status, "PARITY_PENDING");
  assert.deepEqual(batched.cursor, {
    cursorType: "OCCURRED_AT_TASK_EVENT_ID_V1",
    cursorValue: "2026-07-17 09:00:00.000",
    tieBreaker: "tev-share-001",
    inclusive: false,
  });
  assert.equal(batched.counts.migrated, 1);
  assert.equal(fake.state.targets.length, 1);
  assert.equal(fake.state.lineages.length, 1);
  assert.equal(fake.state.lineages[0].source_id, "tev-share-001");
  assert.equal(fake.state.lineages[0].snapshot_revision, "revision-001");
  assert.equal(fake.state.lineages[0].batch_id, "batch-001");
  assert.equal(fake.state.lineages[0].request_id, "batch-request-001");
  assert.match(fake.state.lineages[0].source_checksum, /^[a-f0-9]{64}$/);
  assert.match(fake.state.lineages[0].target_checksum, /^[a-f0-9]{64}$/);
  const verified = await foundation.verifyRun(verifyInput());
  assert.equal(verified.status, "VERIFIED");
  assert.match(verified.resultDigest, /^[a-f0-9]{64}$/);
});

test("same source plus target schema is idempotent and never overwrites the target", async () => {
  const fake = createPool();
  let foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  await foundation.runNextBatch(batchInput());
  const firstTarget = clone(fake.state.targets[0]);
  await foundation.openRun(openInput({
    migrationRunId: "migration-run-002", requestId: "open-request-002",
  }));
  const retried = await foundation.runNextBatch(batchInput({
    migrationRunId: "migration-run-002", batchId: "batch-002", requestId: "batch-request-002",
  }));
  assert.equal(retried.counts.idempotent, 1);
  assert.equal(fake.state.targets.length, 1);
  assert.deepEqual(fake.state.targets[0], firstTarget);
  assert.equal(fake.state.lineages.length, 2);
  assert.equal(fake.state.lineages[1].lineage_event_type, "IDEMPOTENT_RETRY");
  assert.equal(fake.state.lineages[1].status, "IDEMPOTENT");
});

test("DRY_RUN followed by APPLY is recorded as APPLY_AFTER_DRY_RUN, not replay", async () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput({ mode: "DRY_RUN" }));
  const dry = await foundation.runNextBatch(batchInput());
  assert.equal(dry.status, "PARITY_PENDING");
  assert.equal(fake.state.targets.length, 0);
  assert.equal(fake.state.lineages[0].status, "DRY_RUN_VERIFIED");
  await foundation.openRun(openInput({
    migrationRunId: "migration-apply-after-dry-001",
    requestId: "open-apply-after-dry-001",
  }));
  const applied = await foundation.runNextBatch(batchInput({
    migrationRunId: "migration-apply-after-dry-001",
    batchId: "batch-apply-after-dry-001",
    requestId: "request-apply-after-dry-001",
  }));
  assert.equal(applied.counts.migrated, 1);
  assert.equal(fake.state.targets.length, 1);
  assert.equal(fake.state.lineages[1].lineage_event_type, "APPLY_AFTER_DRY_RUN");
  assert.equal(fake.state.lineages[1].status, "MIGRATED");
  assert.equal(fake.state.lineages[1].replayed_at, null);
});

test("a migrated base with a missing target is REVIEW_REQUIRED, not silently rebuilt", async () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  await foundation.runNextBatch(batchInput());
  assert.equal(fake.state.lineages[0].status, "MIGRATED");
  fake.state.targets.length = 0;
  await foundation.openRun(openInput({
    migrationRunId: "migration-missing-target-001",
    requestId: "open-missing-target-001",
  }));
  const result = await foundation.runNextBatch(batchInput({
    migrationRunId: "migration-missing-target-001",
    batchId: "batch-missing-target-001",
    requestId: "request-missing-target-001",
  }));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.cursor, null);
  assert.equal(result.lastErrorCode, "IDENTITY_DRIFT");
  assert.equal(fake.state.targets.length, 0);
  assert.equal(fake.state.lineages[1].status, "REVIEW_REQUIRED");
});

test("DRY_RUN detects one existing checksum mismatch and cannot self-verify it", async () => {
  const fake = createPool({ targets: [{
    target_record_id: "mtp_dry_conflict",
    contract_id: "TASK_SHARE_SYNTHETIC_V1",
    source_task_event_id: "tev-share-001",
    target_schema_version: "TASK_SHARE_MIGRATION_V1",
    task_type: "SHARE",
    completion_event_type: "SHARE_COMPLETED",
    occurred_at_wall_time: "2026-07-17 09:00:00.000",
    source_checksum: "c".repeat(64),
    target_checksum: "d".repeat(64),
  }] });
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput({ mode: "DRY_RUN" }));
  const result = await foundation.runNextBatch(batchInput());
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.counts.conflict, 1);
  const verification = await foundation.verifyRun(verifyInput());
  assert.equal(verification.status, "REVIEW_REQUIRED");
});

test("checksum conflict is append-only, does not overwrite, and does not advance checkpoint", async () => {
  const fake = createPool({ targets: [{
    target_record_id: "mtp_conflicting",
    contract_id: "TASK_SHARE_SYNTHETIC_V1",
    source_task_event_id: "tev-share-001",
    target_schema_version: "TASK_SHARE_MIGRATION_V1",
    task_type: "SHARE",
    completion_event_type: "SHARE_COMPLETED",
    occurred_at_wall_time: "2026-07-17 09:00:00.000",
    source_checksum: "a".repeat(64),
    target_checksum: "b".repeat(64),
  }] });
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  const result = await foundation.runNextBatch(batchInput());
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.cursor, null);
  assert.equal(result.counts.conflict, 1);
  assert.equal(result.lastErrorCode, "TARGET_CONFLICT");
  assert.equal(fake.state.targets.length, 1);
  assert.equal(fake.state.targets[0].target_checksum, "b".repeat(64));
  assert.equal(fake.state.lineages[0].status, "CONFLICT");
  assert.equal(fake.state.lineages[0].base_lineage_identity, fake.state.lineages[0].lineage_identity);
});

test("non-contiguous source ordering fails closed without advancing cursor", async () => {
  const fake = createPool({ sources: [
    source({ task_event_id: "tev-share-002", occurred_at_wall_time: "2026-07-17 09:01:00.000" }),
    source({ task_event_id: "tev-share-001", occurred_at_wall_time: "2026-07-17 09:00:00.000" }),
  ] });
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  const result = await foundation.runNextBatch(batchInput());
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.cursor.cursorValue, "2026-07-17 09:01:00.000");
  assert.equal(result.lastErrorCode, "SOURCE_DRIFT");
  assert.equal(fake.state.targets.length, 1);
  assert.equal(fake.state.lineages.length, 1);
});

test("FORWARD_REPLAY uses the same contract and records replay time without network", async () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  await foundation.runNextBatch(batchInput());
  const sourceRun = await foundation.verifyRun(verifyInput());
  fake.state.sources.push(source({
    task_event_id: "tev-share-002",
    occurred_at_wall_time: "2026-07-17 09:30:00.000",
  }));
  await foundation.openRun(openInput({
    migrationRunId: "migration-replay-001",
    mode: "FORWARD_REPLAY",
    requestId: "open-replay-request-001",
    snapshotId: "snapshot-replay-001",
    snapshotRevision: "revision-replay-001",
    snapshotAt: "2026-07-17T01:30:00.000Z",
    replaySourceRunId: "migration-run-001",
    replaySourceResultDigest: sourceRun.resultDigest,
    replayThroughCursorValue: "2026-07-17 09:30:00.000",
    replayThroughTieBreaker: "tev-share-002",
  }));
  const result = await foundation.forwardReplay(batchInput({
    migrationRunId: "migration-replay-001",
    batchId: "replay-batch-001",
    requestId: "replay-batch-request-001",
  }));
  assert.equal(result.status, "PARITY_PENDING");
  assert.equal(result.replaySource.migrationRunId, "migration-run-001");
  assert.equal(fake.state.lineages[1].status, "FORWARD_REPLAYED");
  assert.equal(fake.state.lineages[1].source_id, "tev-share-002");
  assert.equal(fake.state.lineages[1].replayed_at, NOW);
  assert.equal(fake.telemetry.executes.some(({ sql }) => (
    /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:outbox|inbox)|https?:\/\//i.test(sql)
  )), false);
});

test("FORWARD_REPLAY fails closed when the bound source result drifts after open", async () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  await foundation.runNextBatch(batchInput());
  const sourceRun = await foundation.verifyRun(verifyInput());
  fake.state.sources.push(source({
    task_event_id: "tev-share-002",
    occurred_at_wall_time: "2026-07-17 09:30:00.000",
  }));
  await foundation.openRun(openInput({
    migrationRunId: "migration-replay-drift-001",
    mode: "FORWARD_REPLAY",
    requestId: "open-replay-drift-001",
    snapshotId: "snapshot-replay-drift-001",
    snapshotRevision: "revision-replay-drift-001",
    snapshotAt: "2026-07-17T01:30:00.000Z",
    replaySourceRunId: "migration-run-001",
    replaySourceResultDigest: sourceRun.resultDigest,
    replayThroughCursorValue: "2026-07-17 09:30:00.000",
    replayThroughTieBreaker: "tev-share-002",
  }));
  fake.state.runs["migration-run-001"].result_digest = "f".repeat(64);
  await assert.rejects(() => foundation.forwardReplay(batchInput({
    migrationRunId: "migration-replay-drift-001",
    batchId: "replay-drift-batch-001",
    requestId: "replay-drift-request-001",
  })), { code: "MIGRATION_EXECUTION_IDENTITY_DRIFT" });
  assert.equal(fake.state.runs["migration-replay-drift-001"].status, "OPEN");
  assert.equal(fake.state.targets.length, 1);
});

test("commit ACK unknown destroys the old connection and converges through fresh readback", async () => {
  const fake = createPool({ commitFailures: { 2: "AFTER_APPLY_THROW" } });
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  const result = await foundation.runNextBatch(batchInput());
  assert.equal(result.status, "PARITY_PENDING");
  assert.ok(fake.telemetry.destroys >= 1);
  const batchConnections = fake.telemetry.executes
    .filter(({ sql }) => sql.includes("migration-execution:batch-finish")
      || sql.includes("migration-execution:run-read"))
    .map(({ connectionNumber }) => connectionNumber);
  assert.ok(new Set(batchConnections).size >= 2);
});

test("commit failure before durable apply returns ACK_UNKNOWN and does not claim success", async () => {
  const fake = createPool({ commitFailures: { 2: "BEFORE_APPLY_THROW" } });
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await foundation.openRun(openInput());
  await assert.rejects(() => foundation.runNextBatch(batchInput()), {
    code: "MIGRATION_EXECUTION_ACK_UNKNOWN",
  });
  assert.equal(fake.state.runs["migration-run-001"].status, "OPEN");
  assert.equal(fake.state.targets.length, 0);
});

test("registry, source and target identity drift all fail closed", async () => {
  for (const mutation of [
    (state) => { state.contract.registry_digest = "0".repeat(64); },
    (state) => { state.runs["migration-run-001"].source_query_digest = "1".repeat(64); },
    (state) => { state.runs["migration-run-001"].target_adapter_digest = "2".repeat(64); },
  ]) {
    const fake = createPool();
    const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
    await foundation.openRun(openInput());
    mutation(fake.state);
    await assert.rejects(() => foundation.inspect({ migrationRunId: "migration-run-001" }), {
      code: "MIGRATION_EXECUTION_IDENTITY_DRIFT",
    });
  }
});

test("input surface rejects extra fields, unsupported scopes, and wrong method mode", async () => {
  const fake = createPool();
  const foundation = createMysqlMigrationExecutionFoundation({ pool: fake.pool, env: ENABLED_ENV });
  await assert.rejects(() => foundation.openRun({ ...openInput(), sourceReader: "forged" }), {
    code: "MIGRATION_EXECUTION_INPUT_INVALID",
  });
  await foundation.openRun(openInput());
  await assert.rejects(() => foundation.forwardReplay(batchInput()), {
    code: "MIGRATION_EXECUTION_INPUT_INVALID",
  });
});
