const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const NodeModule = require("node:module");

const {
  createMysqlV1RuntimeControlLedger,
} = require("../src/mysqlV1RuntimeControlLedger");

const DATABASE = "myroot_test";
const ENVIRONMENT = "v1-test";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const RESULT_A = "c".repeat(64);
const RESULT_B = "d".repeat(64);
const SCHEDULED_AT = "2026-07-17T08:00:00.000Z";
const CLAIM_KEYS = [
  "outcome", "cycleId", "environmentId", "scheduleId", "scheduledAt",
  "inputDigest", "status", "leaseOwner", "leaseExpiresAt", "leaseGeneration",
  "claimedAt", "completedAt", "resultDigest", "blockerCount", "errorCode",
].sort();
const CYCLE_KEYS = CLAIM_KEYS.filter((key) => key !== "outcome");

function ledgerFactoryWithAcquireTimeout(milliseconds) {
  const filename = require.resolve("../src/mysqlV1RuntimeControlLedger");
  const original = fs.readFileSync(filename, "utf8");
  const source = original.replace(
    "const CONNECTION_ACQUIRE_TIMEOUT_MILLISECONDS = 10_000;",
    `const CONNECTION_ACQUIRE_TIMEOUT_MILLISECONDS = ${milliseconds};`
  );
  assert.notEqual(source, original, "test seam must replace the fixed production deadline");
  const compiled = new NodeModule(filename, module);
  compiled.filename = filename;
  compiled.paths = NodeModule._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports.createMysqlV1RuntimeControlLedger;
}

function cloneMap(map) {
  return new Map([...map].map(([key, value]) => [key, { ...value }]));
}

class ResultSetHeader {
  constructor() {
    this.fieldCount = 0;
    this.affectedRows = 0;
    this.insertId = 0;
    this.info = "";
    this.serverStatus = 2;
    this.warningStatus = 0;
  }
}

function fakePool(options = {}) {
  const state = {
    now: options.now || SCHEDULED_AT,
    cycles: new Map(),
    alerts: new Map(),
    calls: [],
    destroyed: 0,
    released: 0,
    inserts: 0,
    commitModes: [...(options.commitModes || [])],
    lastReleasedTimeZone: null,
  };

  function nowDate() { return new Date(state.now); }
  function active(connection) {
    return connection.transaction || { cycles: state.cycles, alerts: state.alerts };
  }
  function selected(rows) { return [rows.map((row) => ({ ...row })), []]; }
  function packet(count = 0) { return [{ affectedRows: count }, []]; }
  function procedureRows(rows) {
    return [[rows.map((row) => ({ ...row })), new ResultSetHeader()], []];
  }
  function procedureRow(row) { return procedureRows([row]); }
  function tag(sql) {
    const match = String(sql).match(/v1_runtime_ledger:([a-z_]+)/);
    return match ? match[1] : "";
  }

  function connection() {
    const current = {
      transaction: null,
      sessionTimeZone: "+08:00",
      async beginTransaction() {
        state.calls.push(["BEGIN", []]);
        this.transaction = { cycles: cloneMap(state.cycles), alerts: cloneMap(state.alerts) };
      },
      async commit() {
        state.calls.push(["COMMIT", []]);
        const mode = state.commitModes.shift() || "NORMAL";
        if (mode !== "THROW_BEFORE_APPLY") {
          state.cycles = this.transaction.cycles;
          state.alerts = this.transaction.alerts;
        }
        this.transaction = null;
        if (mode !== "NORMAL") {
          const error = new Error("commit acknowledgement unavailable");
          error.code = "PROTOCOL_CONNECTION_LOST";
          error.fatal = true;
          throw error;
        }
      },
      async rollback() {
        state.calls.push(["ROLLBACK", []]);
        this.transaction = null;
      },
      async execute(sql, values = []) {
        const normalized = String(sql).replace(/\s+/g, " ").trim();
        state.calls.push([normalized, [...values]]);
        if (normalized === "SELECT DATABASE() AS database_name") {
          return selected([{ database_name: options.database || DATABASE }]);
        }
        if (normalized === "SELECT DATABASE() AS database_name, CURRENT_USER() AS authenticated_account") {
          return selected([{
            database_name: options.database || DATABASE,
            authenticated_account: options.currentUser || "myroot_runtime_registrar@%",
          }]);
        }
        if (normalized === "SET time_zone = ?") {
          if (values[0] === "+08:00" && options.restoreTimeZoneMode === "THROW") {
            throw new Error("session time zone restore failed");
          }
          this.sessionTimeZone = values[0];
          return packet();
        }
        if (normalized === "SELECT @@session.time_zone AS session_time_zone") {
          return selected([{
            session_time_zone: options.restoreTimeZoneMode === "MISMATCH"
              ? "+00:00"
              : this.sessionTimeZone,
          }]);
        }
        if (normalized === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") return packet();
        const data = active(this);
        switch (tag(sql)) {
          case "read_cycle_by_schedule_procedure": {
            const [environmentId, scheduleId] = values;
            return procedureRows([...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId && row.schedule_id === scheduleId
            )).map((row) => ({ ...row, db_now: state.now })));
          }
          case "read_cycle_by_id_procedure": {
            const [environmentId, cycleId] = values;
            const row = data.cycles.get(cycleId);
            return procedureRows(row && row.environment_id === environmentId
              ? [{ ...row, db_now: state.now }]
              : []);
          }
          case "read_alert_procedure": {
            const [environmentId, cycleId, dedupeDigest] = values;
            const row = data.alerts.get(`${cycleId}:${dedupeDigest}`);
            return procedureRows(row && row.environment_id === environmentId ? [row] : []);
          }
          case "claim_cycle_procedure": {
            const [
              environmentId, cycleId, scheduleId, scheduledAt, inputDigest,
              leaseOwner, leaseSeconds, claimDigest,
            ] = values;
            const existing = [...data.cycles.values()].find((row) => (
              row.environment_id === environmentId && row.schedule_id === scheduleId
            ));
            if (existing) {
              return procedureRow({ operation_outcome: "REPLAY", ...existing, db_now: state.now });
            }
            state.inserts += 1;
            const row = {
              runtime_cycle_id: cycleId,
              environment_id: environmentId,
              schedule_id: scheduleId,
              scheduled_at: scheduledAt,
              input_digest: inputDigest,
              status: "RUNNING",
              lease_owner: leaseOwner,
              lease_expires_at: new Date(nowDate().getTime() + leaseSeconds * 1000).toISOString(),
              lease_generation: 1,
              claim_digest: claimDigest,
              finalization_digest: null,
              result_digest: null,
              blocker_count: 0,
              error_code: null,
              claimed_at: state.now,
              completed_at: null,
              created_at: state.now,
              updated_at: state.now,
            };
            data.cycles.set(cycleId, row);
            return procedureRow({ operation_outcome: "CLAIMED", ...row, db_now: state.now });
          }
          case "renew_cycle_procedure": {
            const [environmentId, cycleId, leaseOwner, leaseGeneration, leaseSeconds] = values;
            const row = data.cycles.get(cycleId);
            if (!row || row.environment_id !== environmentId || row.status !== "RUNNING"
              || row.lease_owner !== leaseOwner || row.lease_generation !== leaseGeneration
              || Date.parse(row.lease_expires_at) <= nowDate().getTime()) {
              throw Object.assign(new Error("V1_RUNTIME_LEDGER_LEASE_FENCED"), { errno: 1644 });
            }
            Object.assign(row, {
              lease_expires_at: new Date(nowDate().getTime() + leaseSeconds * 1000).toISOString(),
              lease_generation: leaseGeneration + 1,
              updated_at: state.now,
            });
            return procedureRow({ operation_outcome: "RENEWED", ...row, db_now: state.now });
          }
          case "finalize_cycle_procedure": {
            const [
              environmentId, cycleId, leaseOwner, leaseGeneration, status,
              finalizationDigest, resultDigest, blockerCount, errorCode,
            ] = values;
            const row = data.cycles.get(cycleId);
            if (!row || row.environment_id !== environmentId || row.status !== "RUNNING"
              || row.lease_owner !== leaseOwner || row.lease_generation !== leaseGeneration
              || Date.parse(row.lease_expires_at) <= nowDate().getTime()) {
              throw Object.assign(new Error("V1_RUNTIME_LEDGER_LEASE_FENCED"), { errno: 1644 });
            }
            Object.assign(row, {
              status,
              lease_owner: null,
              lease_expires_at: null,
              finalization_digest: finalizationDigest,
              result_digest: resultDigest,
              blocker_count: blockerCount,
              error_code: errorCode,
              completed_at: state.now,
              updated_at: state.now,
            });
            return procedureRow({ operation_outcome: "FINALIZED", ...row, db_now: state.now });
          }
          case "prepare_alert_procedure": {
            const [environmentId, alertId, cycleId, alertCode, severity, dedupeDigest] = values;
            const cycle = data.cycles.get(cycleId);
            if (!cycle || cycle.environment_id !== environmentId || cycle.status === "RUNNING") {
              throw Object.assign(new Error("V1_RUNTIME_LEDGER_CONFLICT"), { errno: 1644 });
            }
            const key = `${cycleId}:${dedupeDigest}`;
            const existing = data.alerts.get(key);
            if (existing) return procedureRow({ operation_outcome: "REPLAY", ...existing });
            const alert = {
              runtime_alert_id: alertId,
              runtime_cycle_id: cycleId,
              environment_id: environmentId,
              schedule_id: cycle.schedule_id,
              input_digest: cycle.input_digest,
              alert_code: alertCode,
              severity,
              dedupe_digest: dedupeDigest,
              observed_at: state.now,
              created_at: state.now,
            };
            data.alerts.set(key, alert);
            return procedureRow({ operation_outcome: "RECORDED", ...alert });
          }
          case "lock_stale_procedure": {
            const [environmentId, limit] = values;
            return procedureRows([...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId
              && row.status === "RUNNING"
              && Date.parse(row.lease_expires_at) <= nowDate().getTime()
            )).sort((left, right) => (
              left.lease_expires_at.localeCompare(right.lease_expires_at)
              || left.runtime_cycle_id.localeCompare(right.runtime_cycle_id)
            )).slice(0, limit).map((row) => ({ ...row, db_now: state.now })));
          }
          case "recover_stale_procedure": {
            const [
              environmentId, cycleId, generation, finalizationDigest,
              resultDigest, alertId, dedupeDigest,
            ] = values;
            const cycle = data.cycles.get(cycleId);
            if (!cycle || cycle.environment_id !== environmentId || cycle.status !== "RUNNING"
              || cycle.lease_generation !== generation
              || Date.parse(cycle.lease_expires_at) > nowDate().getTime()) {
              throw Object.assign(new Error("V1_RUNTIME_LEDGER_LEASE_FENCED"), { errno: 1644 });
            }
            Object.assign(cycle, {
              status: "REVIEW_REQUIRED",
              lease_owner: null,
              lease_expires_at: null,
              lease_generation: generation + 1,
              finalization_digest: finalizationDigest,
              result_digest: resultDigest,
              blocker_count: 1,
              error_code: "V1_RUNTIME_CYCLE_STALE",
              completed_at: state.now,
              updated_at: state.now,
            });
            const key = `${cycleId}:${dedupeDigest}`;
            const existing = data.alerts.get(key);
            const alert = existing || {
              runtime_alert_id: alertId,
              runtime_cycle_id: cycleId,
              environment_id: environmentId,
              schedule_id: cycle.schedule_id,
              input_digest: cycle.input_digest,
              alert_code: "V1_RUNTIME_CYCLE_STALE",
              severity: "BLOCKER",
              dedupe_digest: dedupeDigest,
              observed_at: state.now,
              created_at: state.now,
            };
            if (!existing) data.alerts.set(key, alert);
            return procedureRow({
              operation_outcome: existing ? "REPLAY" : "RECORDED",
              ...cycle,
              ...alert,
            });
          }
          case "inspect_procedure": {
            const [environmentId] = values;
            const cycles = [...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId
            ));
            const safe = cycles.filter((row) => row.status === "SUCCEEDED").sort((left, right) => (
              right.completed_at.localeCompare(left.completed_at)
              || right.runtime_cycle_id.localeCompare(left.runtime_cycle_id)
            ))[0] || null;
            const terminal = cycles.filter((row) => row.status !== "RUNNING").sort((left, right) => (
              right.completed_at.localeCompare(left.completed_at)
              || right.scheduled_at.localeCompare(left.scheduled_at)
              || right.runtime_cycle_id.localeCompare(left.runtime_cycle_id)
            ))[0] || null;
            const alerts = [...data.alerts.values()].filter((row) => {
              if (row.environment_id !== environmentId) return false;
              const alertedCycle = data.cycles.get(row.runtime_cycle_id);
              if (!alertedCycle || alertedCycle.status === "RUNNING" || !alertedCycle.completed_at) {
                return false;
              }
              return !cycles.some((candidate) => (
                candidate.status === "SUCCEEDED"
                && candidate.completed_at > alertedCycle.completed_at
              ));
            });
            const reviewRequiredCount = cycles.filter((row) => (
              row.status === "REVIEW_REQUIRED"
              && !cycles.some((candidate) => (
                candidate.status === "SUCCEEDED"
                && candidate.completed_at > row.completed_at
              ))
            )).length;
            return procedureRow({
              latest_safe_cycle_id: safe ? safe.runtime_cycle_id : null,
              latest_safe_completed_at: safe ? safe.completed_at : null,
              latest_terminal_cycle_id: terminal ? terminal.runtime_cycle_id : null,
              latest_terminal_status: terminal ? terminal.status : null,
              latest_terminal_completed_at: terminal ? terminal.completed_at : null,
              total_count: alerts.length,
              blocker_count: alerts.filter((row) => row.severity === "BLOCKER").length,
              warning_count: alerts.filter((row) => row.severity === "WARNING").length,
              latest_observed_at: alerts.length
                ? alerts.map((row) => row.observed_at).sort().at(-1)
                : null,
              review_required_count: reviewRequiredCount,
              db_now: state.now,
            });
          }
          case "select_cycle_by_schedule": {
            const [environmentId, scheduleId] = values;
            return selected([...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId && row.schedule_id === scheduleId
            )).map((row) => ({ ...row, db_now: state.now })));
          }
          case "select_cycle_by_id": {
            const [environmentId, cycleId] = values;
            const row = data.cycles.get(cycleId);
            return selected(row && row.environment_id === environmentId
              ? [{ ...row, db_now: state.now }]
              : []);
          }
          case "insert_cycle": {
            const [
              cycleId, environmentId, scheduleId, scheduledAt, inputDigest,
              leaseOwner, leaseSeconds, claimDigest,
            ] = values;
            const duplicate = [...data.cycles.values()].some((row) => (
              row.environment_id === environmentId && row.schedule_id === scheduleId
            ));
            if (duplicate) {
              const error = new Error("duplicate");
              error.code = "ER_DUP_ENTRY";
              throw error;
            }
            state.inserts += 1;
            data.cycles.set(cycleId, {
              runtime_cycle_id: cycleId,
              environment_id: environmentId,
              schedule_id: scheduleId,
              scheduled_at: scheduledAt,
              input_digest: inputDigest,
              status: "RUNNING",
              lease_owner: leaseOwner,
              lease_expires_at: new Date(nowDate().getTime() + leaseSeconds * 1000).toISOString(),
              lease_generation: 1,
              claim_digest: claimDigest,
              finalization_digest: null,
              result_digest: null,
              blocker_count: 0,
              error_code: null,
              claimed_at: state.now,
              completed_at: null,
              created_at: state.now,
              updated_at: state.now,
            });
            return packet(1);
          }
          case "renew_cycle": {
            const [leaseSeconds, environmentId, cycleId, leaseOwner, leaseGeneration] = values;
            const row = data.cycles.get(cycleId);
            if (!row || row.environment_id !== environmentId || row.status !== "RUNNING"
              || row.lease_owner !== leaseOwner || row.lease_generation !== leaseGeneration
              || Date.parse(row.lease_expires_at) <= nowDate().getTime()) return packet(0);
            Object.assign(row, {
              lease_expires_at: new Date(nowDate().getTime() + leaseSeconds * 1000).toISOString(),
              lease_generation: leaseGeneration + 1,
              updated_at: state.now,
            });
            return packet(1);
          }
          case "finalize_cycle": {
            const [
              status, finalizationDigest, resultDigest, blockerCount, errorCode,
              environmentId, cycleId, leaseOwner, leaseGeneration,
            ] = values;
            const row = data.cycles.get(cycleId);
            if (!row || row.environment_id !== environmentId || row.status !== "RUNNING"
              || row.lease_owner !== leaseOwner || row.lease_generation !== leaseGeneration
              || Date.parse(row.lease_expires_at) <= nowDate().getTime()) return packet(0);
            Object.assign(row, {
              status,
              lease_owner: null,
              lease_expires_at: null,
              finalization_digest: finalizationDigest,
              result_digest: resultDigest,
              blocker_count: blockerCount,
              error_code: errorCode,
              completed_at: state.now,
              updated_at: state.now,
            });
            return packet(1);
          }
          case "select_alert": {
            const [cycleId, dedupeDigest] = values;
            const row = data.alerts.get(`${cycleId}:${dedupeDigest}`);
            return selected(row ? [row] : []);
          }
          case "insert_alert": {
            const [
              alertId, cycleId, environmentId, scheduleId, inputDigest,
              alertCode, severity, dedupeDigest,
            ] = values;
            const key = `${cycleId}:${dedupeDigest}`;
            if (data.alerts.has(key)) {
              const error = new Error("duplicate");
              error.code = "ER_DUP_ENTRY";
              throw error;
            }
            data.alerts.set(key, {
              runtime_alert_id: alertId,
              runtime_cycle_id: cycleId,
              environment_id: environmentId,
              schedule_id: scheduleId,
              input_digest: inputDigest,
              alert_code: alertCode,
              severity,
              dedupe_digest: dedupeDigest,
              observed_at: state.now,
              created_at: state.now,
            });
            return packet(1);
          }
          case "lock_stale_cycles": {
            const [environmentId] = values;
            const limitMatch = normalized.match(/ LIMIT ([0-9]+) FOR UPDATE SKIP LOCKED$/);
            assert.ok(limitMatch, "stale recovery limit must be a validated integer literal");
            const limit = Number(limitMatch[1]);
            return selected([...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId
              && row.status === "RUNNING"
              && Date.parse(row.lease_expires_at) <= nowDate().getTime()
            )).sort((left, right) => (
              left.lease_expires_at.localeCompare(right.lease_expires_at)
              || left.runtime_cycle_id.localeCompare(right.runtime_cycle_id)
            )).slice(0, limit).map((row) => ({ ...row, db_now: state.now })));
          }
          case "recover_stale_cycle": {
            const [finalizationDigest, resultDigest, environmentId, cycleId, generation] = values;
            const row = data.cycles.get(cycleId);
            if (!row || row.environment_id !== environmentId || row.status !== "RUNNING"
              || row.lease_generation !== generation
              || Date.parse(row.lease_expires_at) > nowDate().getTime()) return packet(0);
            Object.assign(row, {
              status: "REVIEW_REQUIRED",
              lease_owner: null,
              lease_expires_at: null,
              lease_generation: generation + 1,
              finalization_digest: finalizationDigest,
              result_digest: resultDigest,
              blocker_count: 1,
              error_code: "V1_RUNTIME_CYCLE_STALE",
              completed_at: state.now,
              updated_at: state.now,
            });
            return packet(1);
          }
          case "inspect_latest_safe": {
            const [environmentId] = values;
            const rows = [...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId && row.status === "SUCCEEDED"
            )).sort((left, right) => (
              right.completed_at.localeCompare(left.completed_at)
              || right.runtime_cycle_id.localeCompare(left.runtime_cycle_id)
            ));
            return selected(rows.slice(0, 1).map((row) => ({ ...row, db_now: state.now })));
          }
          case "inspect_latest_terminal": {
            const [environmentId] = values;
            const rows = [...data.cycles.values()].filter((row) => (
              row.environment_id === environmentId && row.status !== "RUNNING"
            )).sort((left, right) => (
              right.completed_at.localeCompare(left.completed_at)
              || right.scheduled_at.localeCompare(left.scheduled_at)
              || right.runtime_cycle_id.localeCompare(left.runtime_cycle_id)
            ));
            return selected(rows.slice(0, 1).map((row) => ({ ...row, db_now: state.now })));
          }
          case "inspect_alerts": {
            const alerts = [...data.alerts.values()].filter((row) => {
              if (row.environment_id !== values[0]) return false;
              const alertedCycle = data.cycles.get(row.runtime_cycle_id);
              if (!alertedCycle || alertedCycle.status === "RUNNING" || !alertedCycle.completed_at) {
                return false;
              }
              return ![...data.cycles.values()].some((cycle) => (
                cycle.environment_id === row.environment_id
                && cycle.status === "SUCCEEDED"
                && cycle.completed_at > alertedCycle.completed_at
              ));
            });
            return selected([{
              total_count: alerts.length,
              blocker_count: alerts.filter((row) => row.severity === "BLOCKER").length,
              warning_count: alerts.filter((row) => row.severity === "WARNING").length,
              latest_observed_at: alerts.length
                ? alerts.map((row) => row.observed_at).sort().at(-1)
                : null,
            }]);
          }
          case "inspect_review": {
            const count = [...data.cycles.values()].filter((row) => (
              row.environment_id === values[0]
              && row.status === "REVIEW_REQUIRED"
              && ![...data.cycles.values()].some((cycle) => (
                cycle.environment_id === row.environment_id
                && cycle.status === "SUCCEEDED"
                && cycle.completed_at > row.completed_at
              ))
            )).length;
            return selected([{ review_required_count: count, db_now: state.now }]);
          }
          default:
            throw new Error(`unexpected SQL: ${normalized}`);
        }
      },
      release() {
        state.released += 1;
        state.lastReleasedTimeZone = this.sessionTimeZone;
      },
      destroy() { state.destroyed += 1; },
    };
    return current;
  }

  return {
    state,
    pool: { async getConnection() { return connection(); } },
    setNow(value) { state.now = value; },
    queueCommit(mode) { state.commitModes.push(mode); },
  };
}

function ledger(fake) {
  return createMysqlV1RuntimeControlLedger({
    pool: fake.pool,
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
}

function ledgerWithRuntimeAlertDelivery(fake, runtimeAlertDelivery) {
  return createMysqlV1RuntimeControlLedger({
    pool: fake.pool,
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
    runtimeAlertDelivery,
  });
}

function claimInput(overrides = {}) {
  return {
    scheduleId: "schedule-20260717T0800Z",
    scheduledAt: SCHEDULED_AT,
    inputDigest: DIGEST_A,
    leaseOwner: "runtime-owner-a",
    leaseSeconds: 60,
    ...overrides,
  };
}

test("factory exposes the frozen exact Interface and rejects drifted configuration", () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(Object.keys(adapter), [
    "inspect", "claimCycle", "renewCycle", "finalizeCycle", "recordAlert", "recoverStale",
  ]);
  assert.throws(
    () => createMysqlV1RuntimeControlLedger({ pool: fake.pool, env: {} }),
    (error) => error.code === "V1_RUNTIME_LEDGER_CONFIGURATION_INVALID"
  );
});

test("connection acquisition fails closed at a fixed deadline and destroys a late connection", async () => {
  const createLedger = ledgerFactoryWithAcquireTimeout(5);
  let resolveLate;
  let destroyed = 0;
  const adapter = createLedger({
    pool: {
      getConnection() {
        return new Promise((resolve) => { resolveLate = resolve; });
      },
    },
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });

  await assert.rejects(
    () => adapter.claimCycle(claimInput()),
    (error) => error.code === "V1_RUNTIME_LEDGER_PERSISTENCE_FAILED"
  );
  resolveLate({ destroy() { destroyed += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destroyed, 1);
});

test("lease renewal uses the reserved heartbeat pool while other ledger work uses the general pool", async () => {
  const fake = fakePool();
  let heartbeatAcquisitions = 0;
  const adapter = createMysqlV1RuntimeControlLedger({
    pool: fake.pool,
    heartbeatPool: {
      getConnection() {
        heartbeatAcquisitions += 1;
        return fake.pool.getConnection();
      },
    },
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
  const claimed = await adapter.claimCycle(claimInput());
  assert.equal(heartbeatAcquisitions, 0);
  const renewed = await adapter.renewCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    leaseSeconds: 60,
  });
  assert.equal(heartbeatAcquisitions, 1);
  assert.equal(renewed.leaseGeneration, 2);
});

test("inspection uses only the reserved Inspector pool", async () => {
  const fake = fakePool();
  let inspectorAcquisitions = 0;
  const adapter = createMysqlV1RuntimeControlLedger({
    pool: fake.pool,
    inspectorPool: {
      getConnection() {
        inspectorAcquisitions += 1;
        return fake.pool.getConnection();
      },
    },
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
  await adapter.claimCycle(claimInput());
  assert.equal(inspectorAcquisitions, 0);
  await adapter.inspect({ maximumAgeSeconds: 60 });
  assert.equal(inspectorAcquisitions, 1);
});

test("protected role pools verify distinct CURRENT_USER identities before Ledger calls", async () => {
  const registrar = fakePool({ currentUser: "myroot_runtime_registrar@%" });
  const inspector = fakePool({ currentUser: "myroot_runtime_inspector@%" });
  const adapter = createMysqlV1RuntimeControlLedger({
    pool: registrar.pool,
    inspectorPool: inspector.pool,
    registrarCurrentUser: "myroot_runtime_registrar@%",
    inspectorCurrentUser: "myroot_runtime_inspector@%",
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
  await adapter.claimCycle(claimInput());
  await adapter.inspect();
  assert.equal(
    registrar.state.calls[0][0],
    "SELECT DATABASE() AS database_name, CURRENT_USER() AS authenticated_account"
  );
  assert.equal(
    inspector.state.calls[0][0],
    "SELECT DATABASE() AS database_name, CURRENT_USER() AS authenticated_account"
  );

  const mismatchedInspector = fakePool({ currentUser: "myroot_runtime_registrar@%" });
  const mismatched = createMysqlV1RuntimeControlLedger({
    pool: registrar.pool,
    inspectorPool: mismatchedInspector.pool,
    registrarCurrentUser: "myroot_runtime_registrar@%",
    inspectorCurrentUser: "myroot_runtime_inspector@%",
    env: {
      MYSQL_DATABASE: DATABASE,
      MYROOT_V1_RUNTIME_ENVIRONMENT_ID: ENVIRONMENT,
    },
  });
  await assert.rejects(
    () => mismatched.inspect(),
    (error) => error.code === "V1_RUNTIME_LEDGER_TARGET_DATABASE_MISMATCH"
  );
  assert.equal(mismatchedInspector.state.destroyed, 1);
});

test("every acquired connection verifies target database before session or business SQL", async () => {
  const fake = fakePool({ database: "wrong_database" });
  const adapter = ledger(fake);
  await assert.rejects(
    () => adapter.claimCycle(claimInput()),
    (error) => error.code === "V1_RUNTIME_LEDGER_TARGET_DATABASE_MISMATCH"
  );
  assert.equal(fake.state.calls.length, 1);
  assert.equal(fake.state.calls[0][0], "SELECT DATABASE() AS database_name");
  assert.equal(fake.state.destroyed, 1);
  assert.equal(fake.state.released, 0);
});

test("successful ledger work restores the shared pool session time zone before release", async () => {
  const fake = fakePool();
  await ledger(fake).claimCycle(claimInput());
  assert.equal(fake.state.released, 1);
  assert.equal(fake.state.destroyed, 0);
  assert.equal(fake.state.lastReleasedTimeZone, "+08:00");
  assert.deepEqual(fake.state.calls.slice(-2), [
    ["SET time_zone = ?", ["+08:00"]],
    ["SELECT @@session.time_zone AS session_time_zone", []],
  ]);
});

test("failed or unverified session restoration destroys the connection", async () => {
  for (const restoreTimeZoneMode of ["THROW", "MISMATCH"]) {
    const fake = fakePool({ restoreTimeZoneMode });
    const claimed = await ledger(fake).claimCycle(claimInput());
    assert.equal(claimed.status, "RUNNING");
    assert.equal(fake.state.released, 0);
    assert.equal(fake.state.destroyed, 1);
  }
});

test("claim is deterministic, replay-safe, and conflicts on schedule identity drift", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const claimed = await adapter.claimCycle(claimInput());
  assert.deepEqual(Object.keys(claimed).sort(), CLAIM_KEYS);
  assert.equal(claimed.outcome, "CLAIMED");
  assert.equal(claimed.status, "RUNNING");
  assert.equal(claimed.leaseGeneration, 1);
  assert.equal(Object.isFrozen(claimed), true);
  const replay = await adapter.claimCycle(claimInput({ leaseOwner: "runtime-owner-b" }));
  assert.equal(replay.outcome, "REPLAY");
  assert.equal(replay.cycleId, claimed.cycleId);
  assert.equal(replay.leaseOwner, "runtime-owner-a");
  assert.equal(fake.state.inserts, 1);
  await assert.rejects(
    () => adapter.claimCycle(claimInput({ inputDigest: DIGEST_B })),
    (error) => error.code === "V1_RUNTIME_LEDGER_CONFLICT"
  );
  await assert.rejects(
    () => adapter.claimCycle(claimInput({ scheduledAt: "2026-07-17T08:01:00.000Z" })),
    (error) => error.code === "V1_RUNTIME_LEDGER_CONFLICT"
  );
});

test("lease generation and database time fence finalization; exact terminal replay converges", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const claimed = await adapter.claimCycle(claimInput());
  await assert.rejects(
    () => adapter.finalizeCycle({
      cycleId: claimed.cycleId,
      leaseOwner: claimed.leaseOwner,
      leaseGeneration: 2,
      status: "SUCCEEDED",
      resultDigest: RESULT_A,
      blockerCount: 0,
      errorCode: null,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_LEASE_FENCED"
  );
  const completed = await adapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: 1,
    status: "SUCCEEDED",
    resultDigest: RESULT_A,
    blockerCount: 0,
    errorCode: null,
  });
  assert.deepEqual(Object.keys(completed).sort(), CYCLE_KEYS);
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.leaseOwner, null);
  const replay = await adapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: 1,
    status: "SUCCEEDED",
    resultDigest: RESULT_A,
    blockerCount: 0,
    errorCode: null,
  });
  assert.deepEqual(replay, completed);
  await assert.rejects(
    () => adapter.finalizeCycle({
      cycleId: claimed.cycleId,
      leaseOwner: claimed.leaseOwner,
      leaseGeneration: 1,
      status: "FAILED_PRECONDITION",
      resultDigest: RESULT_B,
      blockerCount: 1,
      errorCode: "DEPENDENCY_NOT_READY",
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_CONFLICT"
  );
});

test("renew uses database-time owner and generation CAS, then finalization requires the new fence", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const claimed = await adapter.claimCycle(claimInput({ leaseSeconds: 10 }));
  fake.setNow("2026-07-17T08:00:05.000Z");
  const renewed = await adapter.renewCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    leaseSeconds: 60,
  });
  assert.deepEqual(Object.keys(renewed).sort(), CYCLE_KEYS);
  assert.equal(renewed.status, "RUNNING");
  assert.equal(renewed.leaseGeneration, 2);
  assert.equal(renewed.leaseExpiresAt, "2026-07-17T08:01:05.000Z");
  assert.equal(Object.isFrozen(renewed), true);

  await assert.rejects(
    () => adapter.renewCycle({
      cycleId: claimed.cycleId,
      leaseOwner: claimed.leaseOwner,
      leaseGeneration: claimed.leaseGeneration,
      leaseSeconds: 60,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_LEASE_FENCED"
  );
  await assert.rejects(
    () => adapter.finalizeCycle({
      cycleId: claimed.cycleId,
      leaseOwner: claimed.leaseOwner,
      leaseGeneration: claimed.leaseGeneration,
      status: "SUCCEEDED",
      resultDigest: RESULT_A,
      blockerCount: 0,
      errorCode: null,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_LEASE_FENCED"
  );
  const terminal = await adapter.finalizeCycle({
    cycleId: renewed.cycleId,
    leaseOwner: renewed.leaseOwner,
    leaseGeneration: renewed.leaseGeneration,
    status: "SUCCEEDED",
    resultDigest: RESULT_A,
    blockerCount: 0,
    errorCode: null,
  });
  assert.equal(terminal.status, "SUCCEEDED");
  assert.equal(terminal.leaseGeneration, 2);
});

test("renew refuses expired or foreign leases without mutation", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const claimed = await adapter.claimCycle(claimInput({ leaseSeconds: 1 }));
  await assert.rejects(
    () => adapter.renewCycle({
      cycleId: claimed.cycleId,
      leaseOwner: "runtime-owner-b",
      leaseGeneration: claimed.leaseGeneration,
      leaseSeconds: 60,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_LEASE_FENCED"
  );
  fake.setNow("2026-07-17T08:00:02.000Z");
  await assert.rejects(
    () => adapter.renewCycle({
      cycleId: claimed.cycleId,
      leaseOwner: claimed.leaseOwner,
      leaseGeneration: claimed.leaseGeneration,
      leaseSeconds: 60,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_LEASE_FENCED"
  );
  assert.equal(fake.state.cycles.get(claimed.cycleId).lease_generation, 1);
});

test("alert evidence is append-only and deterministic per cycle, code, and severity", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const claimed = await adapter.claimCycle(claimInput());
  await assert.rejects(
    () => adapter.recordAlert({
      cycleId: claimed.cycleId,
      alertCode: "CONTROL_PLANE_UNAVAILABLE",
      severity: "BLOCKER",
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_CONFLICT"
  );
  await adapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    status: "FAILED_PRECONDITION",
    resultDigest: RESULT_A,
    blockerCount: 1,
    errorCode: "CONTROL_PLANE_UNAVAILABLE",
  });
  const recorded = await adapter.recordAlert({
    cycleId: claimed.cycleId,
    alertCode: "CONTROL_PLANE_UNAVAILABLE",
    severity: "BLOCKER",
  });
  assert.deepEqual(Object.keys(recorded).sort(), [
    "outcome", "alertId", "cycleId", "environmentId", "scheduleId",
    "inputDigest", "alertCode", "severity", "observedAt",
  ].sort());
  assert.equal(recorded.outcome, "RECORDED");
  const replay = await adapter.recordAlert({
    cycleId: claimed.cycleId,
    alertCode: "CONTROL_PLANE_UNAVAILABLE",
    severity: "BLOCKER",
  });
  assert.equal(replay.outcome, "REPLAY");
  assert.equal(replay.alertId, recorded.alertId);
  assert.equal(fake.state.alerts.size, 1);
});

test("alert and required delivery registration share one transaction with fail-closed replay", async () => {
  const registrations = [];
  const runtimeAlertDelivery = Object.freeze({
    registrationRequired: true,
    async registerAlertInTransaction(connection, input) {
      assert.equal(typeof connection.execute, "function");
      registrations.push(input);
      return Object.freeze({ outcome: registrations.length === 1 ? "REGISTERED" : "REPLAY" });
    },
  });
  const fake = fakePool();
  const adapter = ledgerWithRuntimeAlertDelivery(fake, runtimeAlertDelivery);
  const claimed = await adapter.claimCycle(claimInput());
  await adapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    status: "FAILED_PRECONDITION",
    resultDigest: RESULT_A,
    blockerCount: 1,
    errorCode: "CONTROL_PLANE_UNAVAILABLE",
  });
  fake.queueCommit("APPLY_THEN_THROW");
  await assert.rejects(
    () => adapter.recordAlert({
      cycleId: claimed.cycleId,
      alertCode: "CONTROL_PLANE_UNAVAILABLE",
      severity: "BLOCKER",
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_COMMIT_OUTCOME_UNKNOWN"
  );
  assert.equal(fake.state.alerts.size, 1, "atomic commit persisted the alert");
  const replay = await adapter.recordAlert({
    cycleId: claimed.cycleId,
    alertCode: "CONTROL_PLANE_UNAVAILABLE",
    severity: "BLOCKER",
  });
  assert.equal(replay.outcome, "REPLAY");
  assert.equal(registrations.length, 2, "caller replay re-verifies the required registration");
  assert.deepEqual(Object.keys(registrations[0]).sort(), [
    "runtimeAlertId", "environmentId", "alertCode", "severity", "observedAt",
  ].sort());
});

test("delivery registration failure rolls back a new alert and cannot be silently lost", async () => {
  const fake = fakePool();
  const adapter = ledgerWithRuntimeAlertDelivery(fake, Object.freeze({
    registrationRequired: true,
    async registerAlertInTransaction() {
      throw new Error("private receiver configuration failure");
    },
  }));
  const claimed = await adapter.claimCycle(claimInput());
  await adapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    status: "FAILED_PRECONDITION",
    resultDigest: RESULT_A,
    blockerCount: 1,
    errorCode: "CONTROL_PLANE_UNAVAILABLE",
  });
  await assert.rejects(
    () => adapter.recordAlert({
      cycleId: claimed.cycleId,
      alertCode: "CONTROL_PLANE_UNAVAILABLE",
      severity: "BLOCKER",
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_PERSISTENCE_FAILED"
      && !String(error.message).includes("private receiver")
  );
  assert.equal(fake.state.alerts.size, 0);
  assert.equal(fake.state.calls.some(([sql]) => sql === "ROLLBACK"), true);
});

test("delayed alert repair is covered by a success after the failed cycle, not its write time", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const failedClaim = await adapter.claimCycle(claimInput({
    scheduleId: "schedule-failed",
    scheduledAt: "2026-07-17T08:00:00.000Z",
  }));
  await adapter.finalizeCycle({
    cycleId: failedClaim.cycleId,
    leaseOwner: failedClaim.leaseOwner,
    leaseGeneration: failedClaim.leaseGeneration,
    status: "FAILED_PRECONDITION",
    resultDigest: RESULT_A,
    blockerCount: 1,
    errorCode: "DEPENDENCY_NOT_READY",
  });
  fake.setNow("2026-07-17T08:01:00.000Z");
  const successClaim = await adapter.claimCycle(claimInput({
    scheduleId: "schedule-succeeded",
    scheduledAt: "2026-07-17T08:01:00.000Z",
  }));
  await adapter.finalizeCycle({
    cycleId: successClaim.cycleId,
    leaseOwner: successClaim.leaseOwner,
    leaseGeneration: successClaim.leaseGeneration,
    status: "SUCCEEDED",
    resultDigest: RESULT_B,
    blockerCount: 0,
    errorCode: null,
  });
  fake.setNow("2026-07-17T08:02:00.000Z");
  await adapter.recordAlert({
    cycleId: failedClaim.cycleId,
    alertCode: "DEPENDENCY_NOT_READY",
    severity: "BLOCKER",
  });
  const inspection = await adapter.inspect({ maximumAgeSeconds: 120 });
  assert.equal(inspection.attestation.state, "SAFE");
  assert.equal(inspection.attestation.cycleId, successClaim.cycleId);
  assert.equal(inspection.openAlerts.totalCount, 0);
});

test("stale recovery fails closed to REVIEW_REQUIRED, appends one blocker, and never reruns", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const claimed = await adapter.claimCycle(claimInput({ leaseSeconds: 1 }));
  fake.setNow("2026-07-17T08:00:02.000Z");
  const recovered = await adapter.recoverStale({ limit: 10 });
  assert.deepEqual(recovered, {
    environmentId: ENVIRONMENT,
    reviewRequiredCount: 1,
    cycleIds: [claimed.cycleId],
    alertCount: 1,
  });
  assert.equal(Object.isFrozen(recovered.cycleIds), true);
  const replay = await adapter.claimCycle(claimInput({ leaseSeconds: 1 }));
  assert.equal(replay.outcome, "REPLAY");
  assert.equal(replay.status, "REVIEW_REQUIRED");
  assert.equal(replay.leaseGeneration, 2);
  assert.equal(replay.errorCode, "V1_RUNTIME_CYCLE_STALE");
  assert.deepEqual(await adapter.recoverStale({ limit: 10 }), {
    environmentId: ENVIRONMENT,
    reviewRequiredCount: 0,
    cycleIds: [],
    alertCount: 0,
  });
  assert.equal(fake.state.inserts, 1);
  assert.equal(fake.state.alerts.size, 1);
});

test("commit ACK loss converges by fresh readback; absent durable mutation stays unknown", async () => {
  const applied = fakePool({ commitModes: ["APPLY_THEN_THROW"] });
  const appliedAdapter = ledger(applied);
  const claimed = await appliedAdapter.claimCycle(claimInput());
  assert.equal(claimed.outcome, "CLAIMED");
  assert.equal(applied.state.inserts, 1);
  assert.equal(applied.state.destroyed, 1);

  const absent = fakePool({ commitModes: ["THROW_BEFORE_APPLY"] });
  const absentAdapter = ledger(absent);
  await assert.rejects(
    () => absentAdapter.claimCycle(claimInput()),
    (error) => error.code === "V1_RUNTIME_LEDGER_COMMIT_OUTCOME_UNKNOWN"
  );
  assert.equal(absent.state.inserts, 1, "mutation must not be replayed after ambiguous commit");
  assert.equal(absent.state.cycles.size, 0);
  assert.equal(absent.state.destroyed, 1);
});

test("finalize, alert, and stale recovery also converge only through fresh ACK readback", async () => {
  const finalizeFake = fakePool();
  const finalizeAdapter = ledger(finalizeFake);
  const claimed = await finalizeAdapter.claimCycle(claimInput());
  finalizeFake.queueCommit("APPLY_THEN_THROW");
  const completed = await finalizeAdapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    status: "SUCCEEDED",
    resultDigest: RESULT_A,
    blockerCount: 0,
    errorCode: null,
  });
  assert.equal(completed.status, "SUCCEEDED");
  finalizeFake.queueCommit("APPLY_THEN_THROW");
  const alert = await finalizeAdapter.recordAlert({
    cycleId: claimed.cycleId,
    alertCode: "POST_RUN_WARNING",
    severity: "WARNING",
  });
  assert.equal(alert.outcome, "RECORDED");
  assert.equal(finalizeFake.state.alerts.size, 1);

  const recoveryFake = fakePool();
  const recoveryAdapter = ledger(recoveryFake);
  const stale = await recoveryAdapter.claimCycle(claimInput({ leaseSeconds: 1 }));
  recoveryFake.setNow("2026-07-17T08:00:02.000Z");
  recoveryFake.queueCommit("APPLY_THEN_THROW");
  const recovered = await recoveryAdapter.recoverStale({ limit: 1 });
  assert.deepEqual(recovered.cycleIds, [stale.cycleId]);
  assert.equal(recovered.alertCount, 1);
  assert.equal(recoveryFake.state.cycles.get(stale.cycleId).status, "REVIEW_REQUIRED");
});

test("renew ACK loss converges only on the exact next generation and never replays mutation", async () => {
  const applied = fakePool();
  const appliedAdapter = ledger(applied);
  const appliedClaim = await appliedAdapter.claimCycle(claimInput());
  applied.queueCommit("APPLY_THEN_THROW");
  const renewed = await appliedAdapter.renewCycle({
    cycleId: appliedClaim.cycleId,
    leaseOwner: appliedClaim.leaseOwner,
    leaseGeneration: appliedClaim.leaseGeneration,
    leaseSeconds: 60,
  });
  assert.equal(renewed.leaseGeneration, 2);
  assert.equal(applied.state.cycles.get(appliedClaim.cycleId).lease_generation, 2);

  const absent = fakePool();
  const absentAdapter = ledger(absent);
  const absentClaim = await absentAdapter.claimCycle(claimInput());
  absent.queueCommit("THROW_BEFORE_APPLY");
  await assert.rejects(
    () => absentAdapter.renewCycle({
      cycleId: absentClaim.cycleId,
      leaseOwner: absentClaim.leaseOwner,
      leaseGeneration: absentClaim.leaseGeneration,
      leaseSeconds: 60,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_COMMIT_OUTCOME_UNKNOWN"
  );
  assert.equal(absent.state.cycles.get(absentClaim.cycleId).lease_generation, 1);
  const renewMutations = absent.state.calls.filter(([sql]) => sql.includes("v1_runtime_ledger:renew_cycle"));
  assert.equal(renewMutations.length, 1, "ambiguous commit must never replay the renew mutation");
});

test("inspect reports missing, safe, stale, and blocked attestation from stable aggregates", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const missing = await adapter.inspect({ maximumAgeSeconds: 60 });
  assert.equal(missing.attestation.state, "MISSING");
  assert.equal(missing.openAlerts.totalCount, 0);

  const claimed = await adapter.claimCycle(claimInput());
  await adapter.finalizeCycle({
    cycleId: claimed.cycleId,
    leaseOwner: claimed.leaseOwner,
    leaseGeneration: claimed.leaseGeneration,
    status: "SUCCEEDED",
    resultDigest: RESULT_A,
    blockerCount: 0,
    errorCode: null,
  });
  const safe = await adapter.inspect({ maximumAgeSeconds: 60 });
  assert.equal(safe.attestation.state, "SAFE");
  assert.equal(safe.attestation.ageSeconds, 0);
  fake.setNow("2026-07-17T08:02:00.000Z");
  assert.equal((await adapter.inspect({ maximumAgeSeconds: 60 })).attestation.state, "STALE");
  await adapter.recordAlert({
    cycleId: claimed.cycleId,
    alertCode: "MANUAL_REVIEW_REQUIRED",
    severity: "BLOCKER",
  });
  const stale = await adapter.claimCycle(claimInput({
    scheduleId: "schedule-20260717T0802Z",
    scheduledAt: "2026-07-17T08:02:00.000Z",
    inputDigest: DIGEST_B,
    leaseSeconds: 1,
  }));
  assert.equal(stale.status, "RUNNING");
  fake.setNow("2026-07-17T08:02:02.000Z");
  assert.equal((await adapter.recoverStale({ limit: 10 })).reviewRequiredCount, 1);
  const blocked = await adapter.inspect({ maximumAgeSeconds: 60 });
  assert.equal(blocked.attestation.state, "BLOCKED");
  assert.deepEqual(blocked.openAlerts, {
    totalCount: 2,
    blockerCount: 2,
    warningCount: 0,
    latestObservedAt: "2026-07-17T08:02:02.000Z",
  });
  assert.equal(blocked.reviewRequiredCount, 1);

  fake.setNow("2026-07-17T08:03:00.000Z");
  const succeeding = await adapter.claimCycle(claimInput({
    scheduleId: "schedule-20260717T0803Z",
    scheduledAt: "2026-07-17T08:03:00.000Z",
    inputDigest: DIGEST_B,
  }));
  await adapter.finalizeCycle({
    cycleId: succeeding.cycleId,
    leaseOwner: succeeding.leaseOwner,
    leaseGeneration: succeeding.leaseGeneration,
    status: "SUCCEEDED",
    resultDigest: RESULT_B,
    blockerCount: 0,
    errorCode: null,
  });
  const recovered = await adapter.inspect({ maximumAgeSeconds: 60 });
  assert.equal(recovered.attestation.state, "SAFE");
  assert.deepEqual(recovered.openAlerts, {
    totalCount: 0,
    blockerCount: 0,
    warningCount: 0,
    latestObservedAt: null,
  });
  assert.equal(recovered.reviewRequiredCount, 0);
});

test("latest terminal status fails closed while later success recovers without mutable clears", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  async function terminal(scheduleId, scheduledAt, status, resultDigest, blockerCount, errorCode) {
    fake.setNow(scheduledAt);
    const claimed = await adapter.claimCycle(claimInput({ scheduleId, scheduledAt }));
    return adapter.finalizeCycle({
      cycleId: claimed.cycleId,
      leaseOwner: claimed.leaseOwner,
      leaseGeneration: claimed.leaseGeneration,
      status,
      resultDigest,
      blockerCount,
      errorCode,
    });
  }

  const firstSuccess = await terminal(
    "terminal-success-1",
    "2026-07-17T08:00:00.000Z",
    "SUCCEEDED",
    RESULT_A,
    0,
    null
  );
  await terminal(
    "terminal-failed",
    "2026-07-17T08:01:00.000Z",
    "FAILED_PRECONDITION",
    RESULT_B,
    1,
    "DEPENDENCY_NOT_READY"
  );
  const failed = await adapter.inspect({ maximumAgeSeconds: 120 });
  assert.equal(failed.attestation.state, "BLOCKED");
  assert.equal(failed.attestation.cycleId, firstSuccess.cycleId);
  assert.equal(failed.attestation.latestTerminalStatus, "FAILED_PRECONDITION");
  assert.equal(failed.openAlerts.totalCount, 0, "terminal failure must block without alert write");

  const succeeding = await terminal(
    "terminal-success-2",
    "2026-07-17T08:02:00.000Z",
    "SUCCEEDED",
    RESULT_A,
    0,
    null
  );
  const safe = await adapter.inspect({ maximumAgeSeconds: 120 });
  assert.equal(safe.attestation.state, "SAFE");
  assert.equal(safe.attestation.cycleId, succeeding.cycleId);
  assert.equal(safe.attestation.latestTerminalStatus, "SUCCEEDED");

  await terminal(
    "terminal-busy",
    "2026-07-17T08:03:00.000Z",
    "SKIPPED_BUSY",
    RESULT_B,
    0,
    "RUNTIME_COORDINATION_BUSY"
  );
  const busy = await adapter.inspect({ maximumAgeSeconds: 120 });
  assert.equal(busy.attestation.state, "BUSY");
  assert.equal(busy.attestation.cycleId, succeeding.cycleId);
  assert.equal(busy.attestation.ageSeconds, 60);
  assert.equal(busy.attestation.latestTerminalStatus, "SKIPPED_BUSY");

  const warningCycle = await terminal(
    "terminal-success-warning",
    "2026-07-17T08:04:00.000Z",
    "SUCCEEDED",
    RESULT_A,
    0,
    null
  );
  await adapter.recordAlert({
    cycleId: warningCycle.cycleId,
    alertCode: "DELIVERY_LAG_WARNING",
    severity: "WARNING",
  });
  const warning = await adapter.inspect({ maximumAgeSeconds: 120 });
  assert.equal(warning.attestation.state, "WARNING");
  assert.equal(warning.openAlerts.warningCount, 1);

  await terminal(
    "terminal-success-3",
    "2026-07-17T08:05:00.000Z",
    "SUCCEEDED",
    RESULT_B,
    0,
    null
  );
  const recovered = await adapter.inspect({ maximumAgeSeconds: 120 });
  assert.equal(recovered.attestation.state, "SAFE");
  assert.equal(recovered.openAlerts.warningCount, 0);
});

test("exact input records reject extra fields and never echo supplied values in errors", async () => {
  const fake = fakePool();
  const adapter = ledger(fake);
  const sensitive = "do-not-echo-this-value";
  await assert.rejects(
    () => adapter.claimCycle({ ...claimInput(), freeText: sensitive }),
    (error) => error.code === "V1_RUNTIME_LEDGER_INPUT_INVALID"
      && !error.message.includes(sensitive)
  );
  await assert.rejects(
    () => adapter.renewCycle({
      cycleId: DIGEST_A,
      leaseOwner: "runtime-owner-a",
      leaseGeneration: 1,
      leaseSeconds: 60,
      freeText: sensitive,
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_INPUT_INVALID"
      && !error.message.includes(sensitive)
  );
  await assert.rejects(
    () => adapter.recordAlert({
      cycleId: DIGEST_A,
      alertCode: "not stable",
      severity: "BLOCKER",
    }),
    (error) => error.code === "V1_RUNTIME_LEDGER_INPUT_INVALID"
  );
});
