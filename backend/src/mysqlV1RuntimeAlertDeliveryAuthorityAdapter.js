const {
  createMysqlV1RuntimeAlertDeliveryAdapter,
} = require("./mysqlV1RuntimeAlertDeliveryAdapter");
const {
  createV1RuntimeAlertPayloadAdapter,
  runtimeAlertDeliveryMode,
} = require("./v1RuntimeAlertPayloadAdapter");

const AUTHORITY_SQL = `
  /* v1_runtime_alert_delivery:connection_authority */
  SELECT DATABASE() AS database_name, CURRENT_USER() AS authenticated_account
`;
const AUTHORITY_ADAPTERS = new WeakSet();

function authorityError(code) {
  const error = new Error("V1 runtime alert delivery authority is unavailable");
  error.name = "MysqlV1RuntimeAlertDeliveryAuthorityError";
  error.code = code;
  error.status = 503;
  error.isV1RuntimeAlertDeliveryPersistenceError = true;
  return error;
}

function configurationError() {
  return authorityError("V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_CONFIGURATION_INVALID");
}

function mismatchError() {
  return authorityError("V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_MISMATCH");
}

function persistenceError() {
  return authorityError("V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_PROBE_FAILED");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function databaseName(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_$-]{0,63}$/.test(value);
}

function currentUser(value) {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 288
    && value.includes("@")
    && /^[\x21-\x7e]+$/.test(value);
}

function selectedRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows) || rows.length !== 1 || !plainRecord(rows[0])) {
    throw persistenceError();
  }
  return rows[0];
}

function destroy(connection) {
  try { connection.destroy(); } catch {}
}

async function assertConnectionAuthority(connection, expected) {
  if (!connection || typeof connection.execute !== "function"
    || typeof connection.destroy !== "function") throw configurationError();
  try {
    const row = selectedRows(await connection.execute(AUTHORITY_SQL));
    if (row.database_name !== expected.database
      || row.authenticated_account !== expected.currentUser) throw mismatchError();
  } catch (error) {
    if (error && error.name === "MysqlV1RuntimeAlertDeliveryAuthorityError") throw error;
    throw persistenceError();
  }
}

function authorityPool(pool, expected) {
  return Object.freeze({
    async getConnection() {
      let connection;
      try {
        connection = await pool.getConnection();
        await assertConnectionAuthority(connection, expected);
        return connection;
      } catch (error) {
        if (connection) destroy(connection);
        throw error && error.name === "MysqlV1RuntimeAlertDeliveryAuthorityError"
          ? error : persistenceError();
      }
    },
  });
}

function unavailablePool() {
  return Object.freeze({
    async getConnection() { throw configurationError(); },
  });
}

function authorityInspection(mode) {
  return Object.freeze({
    mode,
    registrarTransactionAuthorityRequired: mode !== "DISABLED",
    workerPoolAuthorityRequired: mode === "CONTROLLED",
    inspectorPoolAuthorityRequired: mode !== "DISABLED",
    distinctRuntimePrincipalsRequired: mode !== "DISABLED",
  });
}

function createMysqlV1RuntimeAlertDeliveryAuthorityAdapter(options = {}) {
  if (!plainRecord(options) || !plainRecord(options.env)) throw configurationError();
  const mode = runtimeAlertDeliveryMode(options.env);
  const expectedKeys = mode === "DISABLED"
    ? ["env"]
    : mode === "DRY_RUN"
      ? ["env", "registrarCurrentUser", "inspectorCurrentUser", "inspectorPool"]
      : [
        "env", "registrarCurrentUser", "workerCurrentUser", "inspectorCurrentUser",
        "workerPool", "inspectorPool",
      ];
  if (!exactKeys(options, expectedKeys)) throw configurationError();
  const database = options.env.MYSQL_DATABASE;
  if (!databaseName(database)) throw configurationError();

  if (mode === "DISABLED") {
    const disabled = createMysqlV1RuntimeAlertDeliveryAdapter({
      pool: unavailablePool(),
      env: options.env,
    });
    const adapter = Object.freeze({
      ...disabled,
      authority: authorityInspection(mode),
    });
    AUTHORITY_ADAPTERS.add(adapter);
    return adapter;
  }

  if (!currentUser(options.registrarCurrentUser)
    || !currentUser(options.inspectorCurrentUser)
    || options.registrarCurrentUser === options.inspectorCurrentUser
    || !options.inspectorPool
    || typeof options.inspectorPool.getConnection !== "function") {
    throw configurationError();
  }
  if (mode === "CONTROLLED" && (
    !currentUser(options.workerCurrentUser)
    || options.workerCurrentUser === options.registrarCurrentUser
    || options.workerCurrentUser === options.inspectorCurrentUser
    || !options.workerPool
    || typeof options.workerPool.getConnection !== "function"
    || options.workerPool === options.inspectorPool
  )) throw configurationError();

  const payloadAdapter = createV1RuntimeAlertPayloadAdapter(options.env);
  const registrar = createMysqlV1RuntimeAlertDeliveryAdapter({
    pool: unavailablePool(),
    env: options.env,
    payloadAdapter,
  });
  const inspector = createMysqlV1RuntimeAlertDeliveryAdapter({
    pool: authorityPool(options.inspectorPool, {
      database,
      currentUser: options.inspectorCurrentUser,
    }),
    env: options.env,
    payloadAdapter,
  });
  const worker = mode === "CONTROLLED"
    ? createMysqlV1RuntimeAlertDeliveryAdapter({
      pool: authorityPool(options.workerPool, {
        database,
        currentUser: options.workerCurrentUser,
      }),
      env: options.env,
      payloadAdapter,
    })
    : registrar;

  async function registerAlertInTransaction(connection, input) {
    await assertConnectionAuthority(connection, {
      database,
      currentUser: options.registrarCurrentUser,
    });
    try {
      return await registrar.registerAlertInTransaction(connection, input);
    } catch (error) {
      if (error && (
        error.isV1RuntimeAlertDeliveryPersistenceError
        || error.name === "MysqlV1RuntimeAlertDeliveryAuthorityError"
      )) throw error;
      throw persistenceError();
    }
  }

  const adapter = Object.freeze({
    mode,
    registrationRequired: true,
    payloadAdapter,
    registerAlertInTransaction,
    claimNext: worker.claimNext,
    markProviderStarted: worker.markProviderStarted,
    completeDelivered: worker.completeDelivered,
    failBeforeProvider: worker.failBeforeProvider,
    markUnknown: worker.markUnknown,
    recoverStale: worker.recoverStale,
    inspect: inspector.inspect,
    authority: authorityInspection(mode),
  });
  AUTHORITY_ADAPTERS.add(adapter);
  return adapter;
}

function isMysqlV1RuntimeAlertDeliveryAuthorityAdapter(value) {
  return Boolean(value && AUTHORITY_ADAPTERS.has(value));
}

module.exports = {
  createMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
  isMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
};
