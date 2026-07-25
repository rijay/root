const assert = require("node:assert/strict");
const {
  ACTIVITY_PENDING_COMMAND_STORAGE_KEY,
  activityCommandPayloadDigest,
  activityPendingCommandKey,
  createActivityPendingCommandRegistry,
} = require("../utils/activity-command-recovery");

function memoryStorage({ failWrites = false } = {}) {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) {
      if (failWrites) throw new Error("storage unavailable");
      values.set(key, value);
    },
  };
}

let sequence = 0;
const storage = memoryStorage();
const registry = createActivityPendingCommandRegistry({
  storage,
  now: () => 1720000000000,
  entropy: () => `entropy${++sequence}`,
});
const payload = { sessionId: "session_001" };
const first = registry.claim("CANCEL", "session_001", payload);
const retry = registry.claim("CANCEL", "session_001", payload);
assert.equal(first.idempotencyKey, retry.idempotencyKey);
assert.equal(first.payloadDigest, activityCommandPayloadDigest(payload));
assert.equal(first.commandKey, activityPendingCommandKey("CANCEL", "session_001", payload));
assert.equal(registry.listForSession("session_001").length, 1);

const changed = registry.claim("CANCEL", "session_001", { sessionId: "session_001", reason: "changed" });
assert.notEqual(changed.commandKey, first.commandKey);
assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
assert.equal(registry.clear(first), true);
assert.equal(registry.peek("CANCEL", "session_001", payload), null);
assert.ok(JSON.parse(storage.getItem(ACTIVITY_PENDING_COMMAND_STORAGE_KEY)).records);

assert.throws(() => createActivityPendingCommandRegistry({}).claim("ENROLL", "session_001", payload), /STORAGE_REQUIRED/);
assert.throws(() => createActivityPendingCommandRegistry({
  storage: memoryStorage({ failWrites: true }),
  now: () => 1720000000000,
  entropy: () => "abc123",
}).claim("ENROLL", "session_001", payload), /storage unavailable/);

const corruptStorage = memoryStorage();
corruptStorage.setItem(ACTIVITY_PENDING_COMMAND_STORAGE_KEY, "{broken");
assert.throws(() => createActivityPendingCommandRegistry({
  storage: corruptStorage,
  now: () => 1720000000000,
  entropy: () => "abc123",
}).claim("ENROLL", "session_001", payload), /STORAGE_CORRUPT/);

console.log("activity command recovery tests ok");
