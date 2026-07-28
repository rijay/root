const crypto = require("node:crypto");
const { createClientError } = require("./clientError");

const COMMAND_IDEMPOTENCY_STATUS = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
});

function commandError(code, message, status) {
  return Number(status) >= 400 && Number(status) < 500
    ? createClientError(code, message, status)
    : Object.assign(new Error(message), { code, status });
}

function stableSerialize(value, stack = new Set(), arrayEntry = false) {
  if (value === null) return "null";
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return arrayEntry ? "null" : undefined;
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw commandError(40002, "请求内容包含无法计算摘要的数值", 400);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") throw commandError(40002, "请求内容包含无法计算摘要的 BigInt", 400);
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (stack.has(value)) throw commandError(40002, "请求内容存在循环引用，无法计算摘要", 400);

  stack.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => stableSerialize(item, stack, true)).join(",")}]`;
  } else if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, stableSerialize(value[key], stack, false)])
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}:${item}`);
    serialized = `{${entries.join(",")}}`;
  } else {
    throw commandError(40002, "请求内容无法计算摘要", 400);
  }
  stack.delete(value);
  return serialized;
}

function digestCommandRequest(request) {
  const serialized = stableSerialize(request === undefined ? null : request);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function text(value) {
  return String(value || "").trim();
}

function normalizeDescriptor(input = {}) {
  const commandName = text(input.commandName || input.command_name);
  const actorId = text(input.actorId || input.actor_id);
  const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
  if (!commandName || !actorId || !idempotencyKey) {
    throw commandError(40001, "commandName、actorId 和 idempotencyKey 均为必填", 400);
  }
  if (commandName.length > 96 || actorId.length > 128 || idempotencyKey.length > 191) {
    throw commandError(40001, "命令幂等范围字段长度超限", 400);
  }

  const suppliedDigest = text(input.requestDigest || input.request_digest).toLowerCase();
  if (suppliedDigest && !/^[a-f0-9]{64}$/.test(suppliedDigest)) {
    throw commandError(40002, "requestDigest 必须是 SHA-256 十六进制摘要", 400);
  }
  const calculatedDigest = input.request === undefined ? "" : digestCommandRequest(input.request);
  if (suppliedDigest && calculatedDigest && suppliedDigest !== calculatedDigest) {
    throw commandError(40002, "requestDigest 与请求内容不一致", 400);
  }

  return {
    commandName,
    actorId,
    idempotencyKey,
    requestDigest: suppliedDigest || calculatedDigest || digestCommandRequest(null),
  };
}

function ensureRecords(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw commandError(40001, "幂等记录容器必须是对象", 400);
  }
  if (!Array.isArray(data.commandIdempotencyRecords)) data.commandIdempotencyRecords = [];
  return data.commandIdempotencyRecords;
}

function scopeMatches(record, descriptor) {
  return record.commandName === descriptor.commandName
    && record.actorId === descriptor.actorId
    && record.idempotencyKey === descriptor.idempotencyKey;
}

function recordIdFor(descriptor) {
  const scope = `${descriptor.commandName}\u0000${descriptor.actorId}\u0000${descriptor.idempotencyKey}`;
  return `cmdidem_${crypto.createHash("sha256").update(scope).digest("hex").slice(0, 24)}`;
}

function nowFrom(context = {}) {
  const value = typeof context.now === "function" ? context.now() : new Date().toISOString();
  return String(value || new Date().toISOString());
}

function cloneJsonValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function replaceObjectContents(target, snapshot) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, cloneJsonValue(snapshot));
}

function publicRecord(record) {
  return cloneJsonValue({
    recordId: record.recordId,
    commandName: record.commandName,
    actorId: record.actorId,
    idempotencyKey: record.idempotencyKey,
    requestDigest: record.requestDigest,
    status: record.status,
    attempts: record.attempts,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    failedAt: record.failedAt,
    error: record.error,
  });
}

function resultBinding(record) {
  return stableSerialize({
    recordId: record.recordId,
    commandName: record.commandName,
    actorId: record.actorId,
    idempotencyKey: record.idempotencyKey,
    requestDigest: record.requestDigest,
  });
}

function decodeStoredResult(record, context = {}) {
  const codec = context.resultCodec;
  if (!codec) return cloneJsonValue(record.result);
  if (typeof codec.decode !== "function") {
    throw commandError(50303, "command result codec Interface 无效", 503);
  }
  return codec.decode(record.result, { binding: resultBinding(record) });
}

function encodeStoredResult(result, context = {}) {
  const codec = context.resultCodec;
  if (!codec) return cloneJsonValue(result);
  if (typeof codec.encode !== "function") {
    throw commandError(50303, "command result codec Interface 无效", 503);
  }
  return codec.encode(result, { binding: resultBinding(context.record) });
}

function outcome(record, replayed, context = {}) {
  return {
    result: decodeStoredResult(record, context),
    replayed,
    record: publicRecord(record),
  };
}

function safeError(error) {
  const candidateCode = error && error.code !== undefined ? String(error.code) : "COMMAND_FAILED";
  const code = /^[A-Z0-9_-]{1,64}$/.test(candidateCode) || /^\d{3,8}$/.test(candidateCode)
    ? candidateCode
    : "COMMAND_FAILED";
  return {
    code,
    message: "command failed",
  };
}

function beginAttempt(record, context) {
  const now = nowFrom(context);
  record.status = COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS;
  record.attempts += 1;
  record.startedAt = now;
  record.updatedAt = now;
  record.completedAt = "";
  record.failedAt = "";
  record.result = null;
  record.error = null;
}

function completeAttempt(record, result, context) {
  const storedResult = encodeStoredResult(result, { ...context, record });
  const now = nowFrom(context);
  record.status = COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED;
  record.result = storedResult;
  record.error = null;
  record.updatedAt = now;
  record.completedAt = now;
  record.failedAt = "";
  return outcome(record, false, context);
}

function failAttempt(record, error, context) {
  const now = nowFrom(context);
  record.status = COMMAND_IDEMPOTENCY_STATUS.FAILED;
  record.result = null;
  record.error = safeError(error);
  record.updatedAt = now;
  record.completedAt = "";
  record.failedAt = now;
}

function rollbackBusinessMutation(data, snapshot, record, error, context) {
  failAttempt(record, error, context);
  const failedRecord = cloneJsonValue(record);
  replaceObjectContents(data, snapshot);
  const records = ensureRecords(data);
  const existingIndex = records.findIndex((candidate) => candidate.recordId === failedRecord.recordId);
  if (existingIndex >= 0) records[existingIndex] = failedRecord;
  else records.push(failedRecord);
}

function executeIdempotentCommand(data, input, action, context = {}) {
  if (typeof action !== "function") throw commandError(40001, "command action 必须是函数", 400);
  const descriptor = normalizeDescriptor(input);
  const records = ensureRecords(data);
  let record = records.find((item) => scopeMatches(item, descriptor));

  if (record && record.requestDigest !== descriptor.requestDigest) {
    throw commandError(40901, "相同命令幂等键对应了不同请求", 409);
  }
  if (record && record.status === COMMAND_IDEMPOTENCY_STATUS.SUCCEEDED) return outcome(record, true, context);
  if (record && record.status === COMMAND_IDEMPOTENCY_STATUS.IN_PROGRESS) {
    throw commandError(40902, "相同命令正在执行中", 409);
  }

  const businessSnapshot = cloneJsonValue(data);

  if (!record) {
    const createdAt = nowFrom(context);
    record = {
      recordId: recordIdFor(descriptor),
      ...descriptor,
      status: COMMAND_IDEMPOTENCY_STATUS.FAILED,
      attempts: 0,
      createdAt,
      startedAt: "",
      updatedAt: createdAt,
      completedAt: "",
      failedAt: "",
      result: null,
      error: null,
    };
    records.push(record);
  }

  beginAttempt(record, context);
  let result;
  try {
    result = action();
  } catch (error) {
    rollbackBusinessMutation(data, businessSnapshot, record, error, context);
    throw error;
  }

  if (result && typeof result.then === "function") {
    return Promise.resolve(result).then(
      (value) => {
        try {
          return completeAttempt(record, value, context);
        } catch (error) {
          rollbackBusinessMutation(data, businessSnapshot, record, error, context);
          throw error;
        }
      },
      (error) => {
        rollbackBusinessMutation(data, businessSnapshot, record, error, context);
        throw error;
      }
    );
  }

  try {
    return completeAttempt(record, result, context);
  } catch (error) {
    rollbackBusinessMutation(data, businessSnapshot, record, error, context);
    throw error;
  }
}

module.exports = {
  COMMAND_IDEMPOTENCY_STATUS,
  commandIdempotencyError: commandError,
  commandRecordIdFor: recordIdFor,
  commandResultBinding: resultBinding,
  decodeStoredCommandResult: decodeStoredResult,
  digestCommandRequest,
  encodeStoredCommandResult: encodeStoredResult,
  executeIdempotentCommand,
  normalizeCommandDescriptor: normalizeDescriptor,
  publicCommandRecord: publicRecord,
  safeCommandError: safeError,
};
