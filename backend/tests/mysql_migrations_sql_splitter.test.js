const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { splitSqlStatements } = require("../src/mysqlMigrations");

test("ordinary migrations retain statement ordering while comments are removed", () => {
  const statements = splitSqlStatements(`
    -- migration rationale
    CREATE TABLE sample (id INT PRIMARY KEY);
    # operational note
    INSERT INTO sample (id) VALUES (1); /* trailing note */
  `);
  assert.deepEqual(statements, [
    "CREATE TABLE sample (id INT PRIMARY KEY)",
    "INSERT INTO sample (id) VALUES (1)",
  ]);
});

test("semicolons inside SQL strings, identifiers, and comments never split", () => {
  const statements = splitSqlStatements(`
    INSERT INTO \`table;name\` (value) VALUES ('one;two', "three;four");
    -- ignored ; delimiter
    SELECT 'it''s;stable', "a\\\";b";
  `);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /`table;name`/);
  assert.match(statements[0], /'one;two'/);
  assert.match(statements[1], /'it''s;stable'/);
});

test("DELIMITER directives keep compound routines and triggers atomic", () => {
  const statements = splitSqlStatements(`
    DELIMITER $$
    CREATE PROCEDURE sp_guard(IN p_id INT)
    SQL SECURITY DEFINER
    BEGIN
      UPDATE guarded SET revision = revision + 1 WHERE id = p_id;
      IF ROW_COUNT() <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'GUARD;FENCED';
      END IF;
    END$$
    CREATE TRIGGER trg_guard
    BEFORE DELETE ON guarded
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DELETE_FORBIDDEN'$$
    DELIMITER ;
    SELECT 1;
  `);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /^CREATE PROCEDURE sp_guard/);
  assert.match(statements[0], /UPDATE guarded[\s\S]*SIGNAL SQLSTATE/);
  assert.match(statements[1], /^CREATE TRIGGER trg_guard/);
  assert.equal(statements[2], "SELECT 1");
});

test("malformed migration SQL fails before any statement can be executed", () => {
  assert.throws(
    () => splitSqlStatements("DELIMITER\nSELECT 1"),
    { code: "MYSQL_MIGRATION_SQL_DELIMITER_INVALID" }
  );
  assert.throws(
    () => splitSqlStatements("SELECT 'unterminated"),
    { code: "MYSQL_MIGRATION_SQL_QUOTE_UNTERMINATED" }
  );
  assert.throws(
    () => splitSqlStatements("SELECT 1 /* unterminated"),
    { code: "MYSQL_MIGRATION_SQL_COMMENT_UNTERMINATED" }
  );
});

test("production runtime authority migrations preserve explicit DEFINER security declarations", () => {
  const migrations = path.join(__dirname, "../db/migrations");
  const expectedProcedureCounts = new Map([
    ["063_v1_runtime_alert_database_authority_stage.sql", 12],
    ["064_v1_runtime_control_ledger_database_authority.sql", 10],
    ["065_v1_runtime_alert_registration_return_row.sql", 2],
  ]);
  for (const [file, expectedCount] of expectedProcedureCounts) {
    const statements = splitSqlStatements(fs.readFileSync(path.join(migrations, file), "utf8"));
    const procedures = statements.filter((statement) => /^CREATE PROCEDURE\b/i.test(statement));
    assert.equal(procedures.length, expectedCount, file);
    for (const procedure of procedures) {
      assert.match(procedure, /\bSQL SECURITY DEFINER\b/i, file);
      assert.doesNotMatch(procedure, /\bSQL SECURITY INVOKER\b/i, file);
    }
  }
});
