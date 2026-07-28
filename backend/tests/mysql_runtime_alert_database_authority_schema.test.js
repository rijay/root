const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MIGRATION_PATH = path.join(
  __dirname,
  "../db/migrations/063_v1_runtime_alert_database_authority_stage.sql"
);

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseDelimitedSql(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sql || "").split(/\r?\n/)) {
    const directive = line.trim().match(/^DELIMITER\s+(\S+)$/i);
    if (directive) {
      assert.equal(buffer.trim(), "", "DELIMITER cannot change inside a statement");
      delimiter = directive[1];
      continue;
    }
    if (line.trim().startsWith("--")) continue;
    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const end = buffer.lastIndexOf(delimiter);
      const statement = buffer.slice(0, end).trim();
      if (statement) statements.push(statement);
      buffer = buffer.slice(end + delimiter.length);
    }
  }
  assert.equal(buffer.trim(), "", "unterminated SQL statement");
  assert.equal(delimiter, ";", "migration must restore the default delimiter");
  return statements;
}

function procedureName(statement) {
  const match = statement.match(/^CREATE\s+PROCEDURE\s+([a-z0-9_]+)/i);
  return match ? match[1] : null;
}

const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const statements = parseDelimitedSql(sql);
const procedures = statements.filter((statement) => procedureName(statement));
const drops = statements.filter((statement) => /^DROP\s+PROCEDURE\s+IF\s+EXISTS\b/i.test(statement));

test("063 is a DELIMITER-aware authority stage with one authority table", () => {
  assert.match(sql, /AUTHORITY_STAGE/i);
  assert.match(sql, /DELIMITER \$\$/i);
  assert.match(sql, /DELIMITER ;/i);
  assert.equal(
    statements.filter((statement) => /^CREATE\s+TABLE\b/i.test(statement)).length,
    1
  );
  const table = compact(statements[0]);
  assert.match(table, /^CREATE TABLE IF NOT EXISTS v1_runtime_alert_registration_authority/i);
  assert.match(table, /PRIMARY KEY \(environment_id\)/i);
  assert.match(table, /authority_generation >= 1/i);
  assert.match(table, /registration_mode IN \('DRY_RUN', 'CONTROLLED'\)/i);
  assert.match(table, /status IN \('ACTIVE', 'DISABLED'\)/i);
  assert.match(table, /receiver_binding_authority_version = 'runtime-alert-receiver-authority:v1'/i);
});

test("authority starts empty and environment provisioning is outside migration", () => {
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+v1_runtime_alert_registration_authority/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:USER|ROLE)\b/i);
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)\b/i);
  assert.doesNotMatch(sql, /CREATE\s+TRIGGER\b/i);
});

test("all write routines are narrow SQL SECURITY DEFINER procedures without transaction control", () => {
  const expected = [
    "v1_runtime_alert_delivery_register_dry_run",
    "v1_runtime_alert_delivery_register_controlled",
    "v1_runtime_alert_delivery_claim",
    "v1_runtime_alert_delivery_mark_provider_started",
    "v1_runtime_alert_delivery_complete_delivered",
    "v1_runtime_alert_delivery_fail_before_provider_retry",
    "v1_runtime_alert_delivery_fail_before_provider_dead",
    "v1_runtime_alert_delivery_mark_unknown",
    "v1_runtime_alert_delivery_recover_started_unknown",
    "v1_runtime_alert_delivery_recover_claim_retry",
    "v1_runtime_alert_delivery_recover_claim_dead",
    "v1_runtime_alert_delivery_inspect",
  ];
  assert.deepEqual(procedures.map(procedureName), expected);
  assert.deepEqual(
    drops.map((statement) => statement.match(
      /^DROP\s+PROCEDURE\s+IF\s+EXISTS\s+([a-z0-9_]+)/i
    )[1]),
    expected,
    "each versioned routine must be replay-convergent before its CREATE"
  );
  for (const procedure of procedures) {
    assert.match(procedure, /SQL SECURITY DEFINER/i);
    assert.doesNotMatch(
      procedure,
      /\b(?:START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|SET\s+AUTOCOMMIT)\b/i
    );
  }
  for (const procedure of procedures.slice(0, -1)) {
    assert.match(procedure, /MODIFIES SQL DATA/i);
    assert.match(procedure, /\bBEGIN\b/i);
    assert.match(procedure, /\bEND\s*$/i);
    assert.match(procedure, /SET v_affected_rows = ROW_COUNT\(\)/i);
    assert.match(procedure, /SELECT v_affected_rows AS affected_rows/i);
    assert.equal(
      (procedure.match(/SELECT v_affected_rows AS affected_rows/gi) || []).length,
      1
    );
  }
  assert.match(procedures.at(-1), /READS SQL DATA/i);
});

test("mode-specific registration derives receiver binding from ACTIVE database authority", () => {
  const registrations = procedures.slice(0, 2).map(compact);
  for (const registration of registrations) {
    assert.doesNotMatch(registration, /IN p_registration_mode/i);
    assert.doesNotMatch(registration, /IN p_receiver_binding_(?:authority_version|ref|digest)/i);
    assert.match(registration, /INSERT INTO v1_runtime_alert_delivery/i);
    assert.match(registration, /SELECT .* authority\.registration_mode/i);
    assert.match(registration, /authority\.receiver_binding_authority_version/i);
    assert.match(registration, /authority\.receiver_binding_ref/i);
    assert.match(registration, /authority\.receiver_binding_digest/i);
    assert.match(registration, /FROM v1_runtime_alert_registration_authority AS authority/i);
    assert.match(registration, /runtime_alert\.environment_id = p_environment_id/i);
    assert.match(registration, /authority\.environment_id = p_environment_id/i);
    assert.match(registration, /authority\.status = 'ACTIVE'/i);
    assert.match(registration, /SET v_affected_rows = ROW_COUNT\(\)/i);
    assert.match(registration, /IF v_affected_rows <> 1 THEN SIGNAL SQLSTATE '45000'/i);
  }
  assert.match(registrations[0], /authority\.registration_mode = 'DRY_RUN'/i);
  assert.match(registrations[1], /authority\.registration_mode = 'CONTROLLED'/i);
});

test("worker procedures preserve state, lease, generation and provider fences", () => {
  const byName = new Map(procedures.map((procedure) => [
    procedureName(procedure),
    compact(procedure),
  ]));
  const claim = byName.get("v1_runtime_alert_delivery_claim");
  assert.match(claim, /registration_mode = 'CONTROLLED'/i);
  assert.match(claim, /status IN \('PENDING', 'RETRY_WAIT'\)/i);
  assert.match(claim, /available_at <= CURRENT_TIMESTAMP\(3\)/i);
  assert.match(claim, /attempt_count < maximum_attempts/i);

  const start = byName.get("v1_runtime_alert_delivery_mark_provider_started");
  assert.match(start, /status = 'CLAIMED'/i);
  assert.match(start, /lease_owner = p_lease_owner/i);
  assert.match(start, /lease_generation = p_lease_generation/i);
  assert.match(start, /lease_expires_at > CURRENT_TIMESTAMP\(3\)/i);

  const complete = byName.get("v1_runtime_alert_delivery_complete_delivered");
  assert.match(complete, /status = 'STARTED'/i);
  assert.match(complete, /receipt_digest = p_receipt_digest/i);
  assert.match(complete, /lease_expires_at > CURRENT_TIMESTAMP\(3\)/i);

  const retry = byName.get("v1_runtime_alert_delivery_fail_before_provider_retry");
  assert.match(retry, /provider_started_at IS NULL/i);
  assert.match(retry, /attempt_count < maximum_attempts/i);

  const unknown = byName.get("v1_runtime_alert_delivery_mark_unknown");
  assert.match(unknown, /status = 'STARTED'/i);
  assert.match(unknown, /provider_started_at IS NOT NULL/i);

  const recoverStarted = byName.get(
    "v1_runtime_alert_delivery_recover_started_unknown"
  );
  assert.match(recoverStarted, /lease_expires_at <= CURRENT_TIMESTAMP\(3\)/i);
  assert.match(recoverStarted, /stable_error_code = 'PROVIDER_ACK_UNKNOWN'/i);

  const recoverRetry = byName.get(
    "v1_runtime_alert_delivery_recover_claim_retry"
  );
  assert.match(recoverRetry, /attempt_count < maximum_attempts/i);

  const recoverDead = byName.get(
    "v1_runtime_alert_delivery_recover_claim_dead"
  );
  assert.match(recoverDead, /attempt_count >= maximum_attempts/i);

  for (const [name, procedure] of byName) {
    if (name.endsWith("_inspect")) continue;
    assert.match(procedure, /IF v_affected_rows <> 1 THEN SIGNAL SQLSTATE '45000'/i);
    assert.match(procedure, /SELECT v_affected_rows AS affected_rows/i);
  }
});

test("inspector is an aggregate-only read Interface", () => {
  const inspector = compact(procedures.at(-1));
  assert.match(inspector, /READS SQL DATA SELECT COUNT\(\*\) AS total_count/i);
  assert.match(inspector, /WHERE environment_id = p_environment_id/i);
  assert.doesNotMatch(inspector, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
});
