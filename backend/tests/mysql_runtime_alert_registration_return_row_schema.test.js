const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(path.join(
  __dirname,
  "../db/migrations/065_v1_runtime_alert_registration_return_row.sql"
), "utf8");

function procedureBlocks(sql) {
  return sql.split(/\nDROP PROCEDURE IF EXISTS /).slice(1)
    .map((block) => `DROP PROCEDURE IF EXISTS ${block}`);
}

function name(block) {
  return block.match(/CREATE PROCEDURE\s+([a-z0-9_]+)\s*\(/i)?.[1] || null;
}

const procedures = procedureBlocks(migration);

test("065 replaces exactly the two mode-specific registration procedures", () => {
  assert.deepEqual(procedures.map(name), [
    "v1_runtime_alert_delivery_register_dry_run",
    "v1_runtime_alert_delivery_register_controlled",
  ]);
  for (const procedure of procedures) {
    assert.match(procedure, /SQL SECURITY DEFINER/i);
    assert.match(procedure, /MODIFIES SQL DATA/i);
    assert.doesNotMatch(procedure, /\b(?:START\s+TRANSACTION|COMMIT|ROLLBACK|SET\s+AUTOCOMMIT)\b/i);
    assert.doesNotMatch(procedure, /\b(?:PREPARE|EXECUTE\s+IMMEDIATE)\b/i);
  }
});

test("registration locks, inserts once, and returns one persisted business row", () => {
  for (const procedure of procedures) {
    assert.match(procedure, /WHERE runtime_alert_id = p_runtime_alert_id\s+LIMIT 1\s+FOR UPDATE/i);
    assert.match(procedure, /IF v_existing_delivery_id IS NULL THEN\s+INSERT INTO v1_runtime_alert_delivery/i);
    assert.match(procedure, /SET v_outcome = 'REGISTERED'/i);
    assert.match(procedure, /SELECT v_outcome AS operation_outcome,[\s\S]*FROM v1_runtime_alert_delivery/i);
    assert.match(procedure, /MESSAGE_TEXT = 'V1_RUNTIME_ALERT_REGISTRATION_AUTHORITY_REJECTED'/i);
  }
});

test("mode is derived only from the matching ACTIVE authority row", () => {
  const dryRun = procedures[0];
  const controlled = procedures[1];
  for (const procedure of procedures) {
    assert.match(procedure, /FROM v1_runtime_alert_registration_authority AS authority/i);
    assert.match(procedure, /authority.status = 'ACTIVE'/i);
    assert.match(procedure, /INNER JOIN v1_runtime_alert AS runtime_alert/i);
  }
  assert.match(dryRun, /authority.registration_mode = 'DRY_RUN'/i);
  assert.doesNotMatch(dryRun, /authority.registration_mode = 'CONTROLLED'/i);
  assert.match(controlled, /authority.registration_mode = 'CONTROLLED'/i);
  assert.doesNotMatch(controlled, /authority.registration_mode = 'DRY_RUN'/i);
});
