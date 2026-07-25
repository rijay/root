const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MIGRATION = path.join(
  __dirname,
  "../db/migrations/064_v1_runtime_control_ledger_database_authority.sql"
);
const LEDGER_IMPLEMENTATION = path.join(__dirname, "../src/mysqlV1RuntimeControlLedger.js");

const EXPECTED_PROCEDURES = Object.freeze([
  "v1_runtime_control_ledger_read_cycle_by_schedule",
  "v1_runtime_control_ledger_read_cycle_by_id",
  "v1_runtime_control_ledger_read_alert",
  "v1_runtime_control_ledger_claim_cycle",
  "v1_runtime_control_ledger_renew_cycle",
  "v1_runtime_control_ledger_finalize_cycle",
  "v1_runtime_control_ledger_prepare_alert",
  "v1_runtime_control_ledger_lock_stale_cycles",
  "v1_runtime_control_ledger_recover_stale_cycle_prepare_alert",
  "v1_runtime_control_ledger_inspect_snapshot",
]);

function procedureBlocks(sql) {
  return sql
    .split(/\nDROP PROCEDURE IF EXISTS /)
    .slice(1)
    .map((block) => `DROP PROCEDURE IF EXISTS ${block}`);
}

function procedureName(block) {
  const match = block.match(/CREATE PROCEDURE\s+([a-z0-9_]+)\s*\(/i);
  return match ? match[1] : null;
}

const sql = fs.readFileSync(MIGRATION, "utf8");
const procedures = procedureBlocks(sql);

test("migration 064 freezes the exact narrow Control Ledger procedure Interface", () => {
  assert.deepEqual(procedures.map(procedureName), EXPECTED_PROCEDURES);
  assert.equal(new Set(procedures.map(procedureName)).size, EXPECTED_PROCEDURES.length);
  for (const procedure of procedures) {
    assert.match(procedure, /SQL SECURITY DEFINER/i);
    assert.doesNotMatch(procedure, /\b(?:START\s+TRANSACTION|COMMIT|ROLLBACK|SET\s+AUTOCOMMIT)\b/i);
    assert.doesNotMatch(procedure, /\b(?:PREPARE|EXECUTE\s+IMMEDIATE)\b/i);
    assert.match(procedure, /CREATE PROCEDURE\s+[a-z0-9_]+\s*\(\s*IN p_environment_id\b/i);
  }
});

test("read and inspection procedures cannot mutate base tables", () => {
  const readNames = new Set([
    "v1_runtime_control_ledger_read_cycle_by_schedule",
    "v1_runtime_control_ledger_read_cycle_by_id",
    "v1_runtime_control_ledger_read_alert",
    "v1_runtime_control_ledger_inspect_snapshot",
  ]);
  for (const procedure of procedures) {
    if (!readNames.has(procedureName(procedure))) continue;
    assert.match(procedure, /READS SQL DATA/i);
    assert.doesNotMatch(procedure, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
  }
});

test("mutation procedures retain database-time fencing and stable failure codes", () => {
  const byName = new Map(procedures.map((block) => [procedureName(block), block]));
  for (const name of [
    "v1_runtime_control_ledger_claim_cycle",
    "v1_runtime_control_ledger_renew_cycle",
    "v1_runtime_control_ledger_finalize_cycle",
    "v1_runtime_control_ledger_prepare_alert",
    "v1_runtime_control_ledger_recover_stale_cycle_prepare_alert",
  ]) {
    assert.match(byName.get(name), /MODIFIES SQL DATA/i);
    assert.match(byName.get(name), /CURRENT_TIMESTAMP\(3\)/i);
  }
  assert.match(byName.get("v1_runtime_control_ledger_renew_cycle"), /lease_generation = p_lease_generation/i);
  assert.match(byName.get("v1_runtime_control_ledger_finalize_cycle"), /finalization_digest/i);
  assert.match(byName.get("v1_runtime_control_ledger_lock_stale_cycles"), /FOR UPDATE SKIP LOCKED/i);
  assert.match(
    byName.get("v1_runtime_control_ledger_recover_stale_cycle_prepare_alert"),
    /V1_RUNTIME_CYCLE_STALE/i
  );
});

test("alert preparation stays compatible with one caller-owned transaction", () => {
  for (const name of [
    "v1_runtime_control_ledger_prepare_alert",
    "v1_runtime_control_ledger_recover_stale_cycle_prepare_alert",
  ]) {
    const procedure = procedures.find((block) => procedureName(block) === name);
    assert.match(procedure, /FROM v1_runtime_cycle/i);
    assert.match(procedure, /(?:INSERT INTO|FROM) v1_runtime_alert/i);
    assert.doesNotMatch(procedure, /v1_runtime_alert_delivery/i);
  }
});

test("inspection returns one aggregate result set without receiver material", () => {
  const inspection = procedures.find((block) => (
    procedureName(block) === "v1_runtime_control_ledger_inspect_snapshot"
  ));
  assert.match(inspection, /latest_safe_cycle_id/i);
  assert.match(inspection, /latest_terminal_status/i);
  assert.match(inspection, /review_required_count/i);
  assert.match(inspection, /CURRENT_TIMESTAMP\(3\) AS db_now/i);
  assert.doesNotMatch(inspection, /receiver|endpoint|secret|phone|session/i);
});

test("runtime Ledger crosses only procedure seams for cycle and alert tables", () => {
  const implementation = fs.readFileSync(LEDGER_IMPLEMENTATION, "utf8");
  assert.doesNotMatch(
    implementation,
    /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+v1_runtime_(?:cycle|alert)\b/i
  );
  for (const name of EXPECTED_PROCEDURES) {
    assert.match(implementation, new RegExp(`\\b${name}\\b`));
  }
  assert.match(implementation, /readMysqlProcedureResultRows/);
  assert.match(implementation, /readMysqlProcedureResultRow/);
});
