const { atomicWriteFailure, isAtomicWriteError } = require("./atomicWriteError");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceObjectContents(target, snapshot) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, clone(snapshot));
}

function text(value) {
  return String(value || "").trim();
}

function findLegacyRecord(data, input = {}) {
  const records = data && Array.isArray(data.commandIdempotencyRecords)
    ? data.commandIdempotencyRecords
    : [];
  const commandName = text(input.commandName || input.command_name);
  const actorId = text(input.actorId || input.actor_id);
  const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
  return records.find((record) => text(record.commandName) === commandName
    && text(record.actorId) === actorId
    && text(record.idempotencyKey) === idempotencyKey) || null;
}

function commandSnapshotDigest(data) {
  return JSON.stringify(data && Array.isArray(data.commandIdempotencyRecords)
    ? data.commandIdempotencyRecords
    : []);
}

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createMysqlCommandRecovery(options = {}) {
  const data = options.data;
  const getAdapter = options.getAdapter;
  const checkpoint = options.checkpoint;
  const resume = options.resume;
  const writable = options.writable !== false;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || typeof getAdapter !== "function"
    || typeof checkpoint !== "function"
    || typeof resume !== "function") {
    throw recoveryError("COMMAND_RECOVERY_CONFIGURATION_INVALID", "command recovery configuration is invalid");
  }

  let active = false;

  async function execute(targetData, input, action) {
    if (!writable) {
      throw recoveryError("STORE_COMMAND_RECOVERY_READ_ONLY", "command recovery requires a writable request");
    }
    if (targetData !== data || typeof action !== "function") {
      throw recoveryError("COMMAND_RECOVERY_INPUT_INVALID", "command recovery input is invalid");
    }
    if (active) {
      throw recoveryError("STORE_COMMAND_RECOVERY_ALREADY_ACTIVE", "command recovery is already active");
    }

    active = true;
    try {
      const legacyRecord = findLegacyRecord(data, input);
      const decision = await getAdapter().claim(input, { legacyRecord });
      if (decision && decision.kind === "REPLAY") return decision.outcome;
      if (!decision || decision.kind !== "CLAIMED" || !decision.claim) {
        throw atomicWriteFailure(recoveryError(
          "COMMAND_RECOVERY_DECISION_INVALID",
          "command recovery decision is invalid"
        ));
      }

      let ownedClaim = decision.claim;
      try {
        await checkpoint();
        await resume();
        const lockedClaim = await getAdapter().lockOwnedAttempt(decision.claim);
        if (lockedClaim) ownedClaim = lockedClaim;
      } catch (error) {
        throw atomicWriteFailure(error);
      }

      const businessSnapshot = clone(data);
      const commandSnapshotBefore = commandSnapshotDigest(data);
      try {
        const result = await action();
        if (commandSnapshotDigest(data) !== commandSnapshotBefore) {
          throw atomicWriteFailure(recoveryError(
            "STORE_COMMAND_SNAPSHOT_DUAL_WRITE_FORBIDDEN",
            "relational command recovery forbids snapshot command dual write"
          ));
        }
        return await getAdapter().completeOwnedAttempt(ownedClaim, result);
      } catch (error) {
        replaceObjectContents(data, businessSnapshot);
        if (isAtomicWriteError(error)) throw error;
        try {
          await getAdapter().failOwnedAttempt(ownedClaim, error);
        } catch (failure) {
          throw atomicWriteFailure(failure);
        }
        throw error;
      }
    } finally {
      active = false;
    }
  }

  return Object.freeze({
    execute,
    isActive() {
      return active;
    },
  });
}

module.exports = {
  createMysqlCommandRecovery,
};
