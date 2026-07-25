const assert = require("node:assert/strict");
const test = require("node:test");

const {
  readMysqlProcedureAffectedRows,
  readMysqlProcedureResultRow,
  readMysqlProcedureResultRows,
} = require("../src/mysqlProcedureResult");

class ResultSetHeader {
  constructor(overrides = {}) {
    Object.assign(this, {
      fieldCount: 0,
      affectedRows: 0,
      insertId: 0,
      info: "",
      serverStatus: 2,
      warningStatus: 0,
    }, overrides);
  }
}

function packet(row, header = new ResultSetHeader()) {
  return [[row], header];
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, "MySQL procedure result rejected");
    assert.deepEqual(Object.keys(error), ["code"]);
    return true;
  });
}

test("reads one isolated business result row from the mysql2 CALL packet", () => {
  const source = { outcome: "CLAIMED", affected_rows: 1, lease_generation: 3 };
  const row = readMysqlProcedureResultRow(packet(source));

  assert.deepEqual(row, source);
  assert.equal(Object.isFrozen(row), true);
  assert.notEqual(row, source);
  source.outcome = "TAMPERED";
  assert.equal(row.outcome, "CLAIMED");
});

test("reads an immutable zero-or-more-row procedure result set", () => {
  assert.deepEqual(readMysqlProcedureResultRows([[], new ResultSetHeader()]), []);
  const rows = readMysqlProcedureResultRows([[
    { runtime_cycle_id: "a" },
    { runtime_cycle_id: "b" },
  ], new ResultSetHeader()]);
  assert.deepEqual(rows, [{ runtime_cycle_id: "a" }, { runtime_cycle_id: "b" }]);
  assert.equal(Object.isFrozen(rows), true);
  assert.equal(Object.isFrozen(rows[0]), true);
});

test("reads only the explicit affected_rows business field", () => {
  assert.equal(
    readMysqlProcedureAffectedRows(packet(
      { affected_rows: 0 },
      new ResultSetHeader({ affectedRows: 99 })
    )),
    0
  );
  assert.equal(
    readMysqlProcedureAffectedRows(packet({ affected_rows: Number.MAX_SAFE_INTEGER })),
    Number.MAX_SAFE_INTEGER
  );
});

test("rejects missing, duplicate, and multiple business result sets", () => {
  expectCode(
    () => readMysqlProcedureResultRow([[], new ResultSetHeader()]),
    "MYSQL_PROCEDURE_RESULT_ROW_COUNT_INVALID"
  );
  expectCode(
    () => readMysqlProcedureResultRow([[{ outcome: "A" }, { outcome: "B" }], new ResultSetHeader()]),
    "MYSQL_PROCEDURE_RESULT_ROW_COUNT_INVALID"
  );
  expectCode(
    () => readMysqlProcedureResultRow([
      [{ outcome: "A" }],
      [{ outcome: "B" }],
      new ResultSetHeader(),
    ]),
    "MYSQL_PROCEDURE_RESULT_PACKET_INVALID"
  );
});

test("rejects promise tuples, result-set-free CALLs, and unexpected packets", () => {
  const businessPacket = packet({ affected_rows: 1 });
  expectCode(
    () => readMysqlProcedureResultRow([businessPacket, []]),
    "MYSQL_PROCEDURE_RESULT_PACKET_INVALID"
  );
  expectCode(
    () => readMysqlProcedureResultRow(new ResultSetHeader()),
    "MYSQL_PROCEDURE_RESULT_PACKET_INVALID"
  );
  expectCode(
    () => readMysqlProcedureResultRow([[{ affected_rows: 1 }], { affectedRows: 0 }]),
    "MYSQL_PROCEDURE_RESULT_PACKET_INVALID"
  );
  expectCode(
    () => readMysqlProcedureResultRow([new ResultSetHeader(), [{ affected_rows: 1 }]]),
    "MYSQL_PROCEDURE_RESULT_PACKET_INVALID"
  );
});

test("rejects malformed ResultSetHeader completion packets", () => {
  for (const overrides of [
    { fieldCount: 1 },
    { affectedRows: -1 },
    { affectedRows: "1" },
    { insertId: Number.NaN },
    { info: null },
    { serverStatus: -1 },
    { warningStatus: 0.5 },
  ]) {
    expectCode(
      () => readMysqlProcedureResultRow(packet(
        { affected_rows: 1 },
        new ResultSetHeader(overrides)
      )),
      "MYSQL_PROCEDURE_RESULT_PACKET_INVALID"
    );
  }
});

test("rejects empty, array, and symbol-bearing business rows", () => {
  expectCode(
    () => readMysqlProcedureResultRow(packet({})),
    "MYSQL_PROCEDURE_RESULT_ROW_INVALID"
  );
  expectCode(
    () => readMysqlProcedureResultRow(packet(["not", "a", "row"])),
    "MYSQL_PROCEDURE_RESULT_ROW_INVALID"
  );
  const symbolRow = { affected_rows: 1 };
  symbolRow[Symbol("hidden")] = "unexpected";
  expectCode(
    () => readMysqlProcedureResultRow(packet(symbolRow)),
    "MYSQL_PROCEDURE_RESULT_ROW_INVALID"
  );
});

test("rejects missing or non-canonical affected_rows values", () => {
  for (const row of [
    { outcome: "NO_COUNT" },
    { affected_rows: "1" },
    { affected_rows: -1 },
    { affected_rows: 1.5 },
    { affected_rows: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    expectCode(
      () => readMysqlProcedureAffectedRows(packet(row)),
      "MYSQL_PROCEDURE_AFFECTED_ROWS_INVALID"
    );
  }
});

test("errors expose neither SQL, parameters, nor raw packets", () => {
  const secretSql = "CALL authority_proc('secret-parameter')";
  const rawPacket = [[{
    sql: secretSql,
    parameters: ["secret-parameter"],
  }, {
    sql: secretSql,
  }], new ResultSetHeader()];

  assert.throws(
    () => readMysqlProcedureResultRow(rawPacket),
    (error) => {
      const serialized = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
      assert.equal(serialized.includes("authority_proc"), false);
      assert.equal(serialized.includes("secret-parameter"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(error, "cause"), false);
      return true;
    }
  );
});
