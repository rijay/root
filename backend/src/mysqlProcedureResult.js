const ERROR_MESSAGE = "MySQL procedure result rejected";

function procedureResultError(code) {
  const error = new Error(ERROR_MESSAGE);
  error.code = code;
  return error;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function resultSetHeader(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && value.constructor
    && value.constructor.name === "ResultSetHeader"
    && value.fieldCount === 0
    && nonnegativeSafeInteger(value.affectedRows)
    && nonnegativeSafeInteger(value.insertId)
    && typeof value.info === "string"
    && nonnegativeSafeInteger(value.serverStatus)
    && nonnegativeSafeInteger(value.warningStatus);
}

function cloneResultRow(row) {
  if (!plainRecord(row)
    || Object.keys(row).length === 0
    || Object.getOwnPropertySymbols(row).length !== 0) {
    throw procedureResultError("MYSQL_PROCEDURE_RESULT_ROW_INVALID");
  }
  return Object.freeze({ ...row });
}

function readMysqlProcedureResultRows(packet) {
  if (!Array.isArray(packet) || packet.length !== 2) {
    throw procedureResultError("MYSQL_PROCEDURE_RESULT_PACKET_INVALID");
  }
  const [businessResultSet, completionHeader] = packet;
  if (!Array.isArray(businessResultSet) || !resultSetHeader(completionHeader)) {
    throw procedureResultError("MYSQL_PROCEDURE_RESULT_PACKET_INVALID");
  }
  return Object.freeze(businessResultSet.map(cloneResultRow));
}

function readMysqlProcedureResultRow(packet) {
  const businessResultSet = readMysqlProcedureResultRows(packet);
  if (businessResultSet.length !== 1) {
    throw procedureResultError("MYSQL_PROCEDURE_RESULT_ROW_COUNT_INVALID");
  }
  return businessResultSet[0];
}

function readMysqlProcedureAffectedRows(packet) {
  const row = readMysqlProcedureResultRow(packet);
  if (!Object.prototype.hasOwnProperty.call(row, "affected_rows")
    || !nonnegativeSafeInteger(row.affected_rows)) {
    throw procedureResultError("MYSQL_PROCEDURE_AFFECTED_ROWS_INVALID");
  }
  return row.affected_rows;
}

module.exports = {
  readMysqlProcedureAffectedRows,
  readMysqlProcedureResultRow,
  readMysqlProcedureResultRows,
};
