const { createV1RuntimeAlertDelivery } = require("./v1RuntimeAlertDelivery");
const { runtimeAlertDeliveryMode } = require("./v1RuntimeAlertPayloadAdapter");
const {
  isMysqlV1RuntimeAlertDeliveryAuthorityAdapter,
} = require("./mysqlV1RuntimeAlertDeliveryAuthorityAdapter");

const GATE_STATE = "OPEN";
const MAXIMUM_RECOVERY_LIMIT = 100;
const PERSISTENCE_METHODS = Object.freeze([
  "claimNext",
  "completeDelivered",
  "failBeforeProvider",
  "inspect",
  "markProviderStarted",
  "markUnknown",
  "recoverStale",
]);

function assemblyError(code, status = 503) {
  const error = new Error("V1 runtime alert delivery production assembly is unavailable");
  error.name = "V1RuntimeAlertDeliveryProductionAssemblyError";
  error.code = code;
  error.status = status;
  return error;
}

function configurationError() {
  return assemblyError("V1_RUNTIME_ALERT_DELIVERY_PRODUCTION_ASSEMBLY_INVALID");
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

function gates() {
  return Object.freeze({
    receiverEvidenceGate: GATE_STATE,
    syntheticAcknowledgementGate: GATE_STATE,
  });
}

function createV1RuntimeAlertDeliveryProductionAssembly(options = {}) {
  const validKeys = exactKeys(options, ["env", "persistence"]);
  if (!validKeys || !plainRecord(options.env) || !options.persistence
    || !isMysqlV1RuntimeAlertDeliveryAuthorityAdapter(options.persistence)
    || PERSISTENCE_METHODS.some(
      (method) => typeof options.persistence[method] !== "function"
    )) throw configurationError();
  const { env, persistence } = options;
  const mode = runtimeAlertDeliveryMode(env);
  if (persistence.mode !== mode
    || persistence.registrationRequired !== (mode !== "DISABLED")) throw configurationError();

  const runner = mode === "CONTROLLED"
    ? null
    : createV1RuntimeAlertDelivery({
      env,
      persistence,
      provider: null,
    });

  function assemblyInspection() {
    return Object.freeze({
      databaseAuthorityAdapterReady: true,
      registrarTransactionAuthorityRequired:
        persistence.authority.registrarTransactionAuthorityRequired,
      workerPoolAuthorityRequired: persistence.authority.workerPoolAuthorityRequired,
      inspectorPoolAuthorityRequired: persistence.authority.inspectorPoolAuthorityRequired,
      providerAdapterReady: false,
      runnerReady: runner !== null,
      realReceiverEvidencePresent: false,
    });
  }

  async function inspect() {
    if (runner) {
      const inspection = await runner.inspect();
      return Object.freeze({
        ...inspection,
        productionAssembly: assemblyInspection(),
        gates: gates(),
      });
    }
    return Object.freeze({
      mode,
      enabled: true,
      dryRun: false,
      status: "V1_RUNTIME_ALERT_DELIVERY_PROVIDER_ADAPTER_UNAVAILABLE",
      gates: gates(),
      persistence: await persistence.inspect(),
      productionAssembly: assemblyInspection(),
    });
  }

  async function runDue(input = {}) {
    if (!runner) {
      throw assemblyError("V1_RUNTIME_ALERT_DELIVERY_PROVIDER_ADAPTER_UNAVAILABLE");
    }
    return runner.runDue(input);
  }

  async function recoverStale(input = {}) {
    if (runner) return runner.recoverStale(input);
    if (!exactKeys(input, ["limit"])
      || !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > MAXIMUM_RECOVERY_LIMIT) {
      throw assemblyError("V1_RUNTIME_ALERT_DELIVERY_INPUT_INVALID", 400);
    }
    const recovery = await persistence.recoverStale(input);
    return Object.freeze({ ...recovery, gates: gates() });
  }

  return Object.freeze({ inspect, recoverStale, runDue });
}

module.exports = { createV1RuntimeAlertDeliveryProductionAssembly };
