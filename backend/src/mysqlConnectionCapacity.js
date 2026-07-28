function capacityError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeNonnegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw capacityError(code);
  return value;
}

function calculateV1MysqlConnectionCapacity(input = {}) {
  const mainPool = safeNonnegativeInteger(input.mainPool, "MYSQL_CAPACITY_MAIN_POOL_INVALID");
  const orchestrationPool = safeNonnegativeInteger(
    input.orchestrationPool,
    "MYSQL_CAPACITY_ORCHESTRATION_POOL_INVALID"
  );
  const registrarPool = safeNonnegativeInteger(
    input.registrarPool,
    "MYSQL_CAPACITY_REGISTRAR_POOL_INVALID"
  );
  const registrarHeartbeatPool = safeNonnegativeInteger(
    input.registrarHeartbeatPool,
    "MYSQL_CAPACITY_REGISTRAR_HEARTBEAT_POOL_INVALID"
  );
  const workerPool = safeNonnegativeInteger(input.workerPool, "MYSQL_CAPACITY_WORKER_POOL_INVALID");
  const inspectorPool = safeNonnegativeInteger(
    input.inspectorPool,
    "MYSQL_CAPACITY_INSPECTOR_POOL_INVALID"
  );
  const maximumInstances = safeNonnegativeInteger(
    input.maximumInstances,
    "MYSQL_CAPACITY_MAXIMUM_INSTANCES_INVALID"
  );
  const headroom = safeNonnegativeInteger(input.headroom, "MYSQL_CAPACITY_HEADROOM_INVALID");
  const perInstance = mainPool
    + orchestrationPool
    + registrarPool
    + registrarHeartbeatPool
    + workerPool
    + inspectorPool;
  const calculatedRequirement = perInstance * maximumInstances + headroom;
  if (!Number.isSafeInteger(perInstance) || !Number.isSafeInteger(calculatedRequirement)) {
    throw capacityError("MYSQL_CAPACITY_BUDGET_OVERFLOW");
  }
  return Object.freeze({
    mainPool,
    orchestrationPool,
    registrarPool,
    registrarHeartbeatPool,
    workerPool,
    inspectorPool,
    maximumInstances,
    headroom,
    perInstance,
    calculatedRequirement,
  });
}

module.exports = {
  calculateV1MysqlConnectionCapacity,
};
