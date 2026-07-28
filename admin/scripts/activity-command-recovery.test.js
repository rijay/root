import test from "node:test";
import assert from "node:assert/strict";
import {
  activityCommandKey,
  createPendingActivityCommandRegistry,
} from "../src/modules/activities/pendingActivityCommands.js";

function memoryStorage({ failWrites = false } = {}) {
  const records = new Map();
  return {
    getItem(key) { return records.get(key) || null; },
    setItem(key, value) {
      if (failWrites) throw new Error("storage unavailable");
      records.set(key, value);
    },
  };
}

function sharedLockManager() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, callback) {
      const result = tail.then(callback, callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

function channelHub() {
  const channels = [];
  return {
    create() {
      const listeners = new Set();
      const channel = {
        addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
        postMessage(data) {
          channels.filter((candidate) => candidate !== channel)
            .forEach((candidate) => candidate.listeners.forEach((listener) => listener({ data })));
        },
        listeners,
      };
      channels.push(channel);
      return channel;
    },
  };
}

test("two registries interleaving their first claim get one idempotency key", async () => {
  let sequence = 0;
  const storage = memoryStorage();
  const lockManager = sharedLockManager();
  const hub = channelHub();
  const options = {
    storage,
    lockManager,
    now: () => 1000,
    createIdempotencyKey: () => `intent-${++sequence}`,
  };
  const first = createPendingActivityCommandRegistry({ ...options, channel: hub.create() });
  const second = createPendingActivityCommandRegistry({ ...options, channel: hub.create() });
  const key = activityCommandKey("publish", { activityVersionId: "av_1", digest: "a".repeat(64) });
  const [left, right] = await Promise.all([
    first.claim(key, { operation: "publish", payload: { activityVersionId: "av_1" } }),
    second.claim(key, { operation: "publish", payload: { activityVersionId: "av_1" } }),
  ]);
  assert.equal(left.idempotencyKey, "intent-1");
  assert.equal(right.idempotencyKey, "intent-1");
  assert.equal(sequence, 1);
});

test("clear in one registry is immediately visible to the other and leaves a revisioned tombstone", async () => {
  let sequence = 0;
  const storage = memoryStorage();
  const lockManager = sharedLockManager();
  const hub = channelHub();
  const options = { storage, lockManager, now: () => 2000, createIdempotencyKey: () => `intent-${++sequence}` };
  const first = createPendingActivityCommandRegistry({ ...options, channel: hub.create() });
  const second = createPendingActivityCommandRegistry({ ...options, channel: hub.create() });
  const seen = [];
  second.subscribe((event) => seen.push(event));
  const key = activityCommandKey("archive", { activityVersionId: "av_2", reason: "duplicate" });
  await first.claim(key, { operation: "archive", payload: { activityVersionId: "av_2" } });
  await first.clear(key, "authority-confirmed");
  assert.equal(second.peek(key), null);
  assert.ok(seen.some((event) => event.type === "clear" && event.commandKey === key));
  const document = JSON.parse(storage.getItem("ROOT_ADMIN_ACTIVITY_PENDING_COMMANDS_V3"));
  assert.equal(document.tombstones[key].reason, "authority-confirmed");
  assert.equal(document.tombstones[key].revision, document.revision);
});

test("replace after an operator void produces a new intent under the same serialized command", async () => {
  let sequence = 0;
  const registry = createPendingActivityCommandRegistry({
    storage: memoryStorage(),
    lockManager: sharedLockManager(),
    channel: null,
    now: () => 3000,
    createIdempotencyKey: () => `intent-${++sequence}`,
  });
  const payload = { sessionId: "session_1", nextStatus: "OPEN" };
  const key = activityCommandKey("session-state", payload);
  const first = await registry.claim(key, { operation: "session-state", payload });
  const second = await registry.replace(key, { operation: "session-state", payload }, "operator-voided");
  assert.equal(first.idempotencyKey, "intent-1");
  assert.equal(second.idempotencyKey, "intent-2");
});

test("registry fails closed when cross-tab locking or durable writes are unavailable", async () => {
  const key = activityCommandKey("publish", { activityVersionId: "av_3" });
  const noLock = createPendingActivityCommandRegistry({ storage: memoryStorage(), lockManager: null, channel: null });
  await assert.rejects(noLock.claim(key), /ACTIVITY_COMMAND_CROSS_TAB_LOCK_REQUIRED/);

  const noStorage = createPendingActivityCommandRegistry({ lockManager: sharedLockManager(), channel: null });
  await assert.rejects(noStorage.claim(key), /ACTIVITY_COMMAND_PERSISTENT_STORAGE_REQUIRED/);

  const writeFailure = createPendingActivityCommandRegistry({
    storage: memoryStorage({ failWrites: true }),
    lockManager: sharedLockManager(),
    channel: null,
  });
  await assert.rejects(writeFailure.claim(key), /storage unavailable/);

  const corruptStorage = memoryStorage();
  corruptStorage.setItem("ROOT_ADMIN_ACTIVITY_PENDING_COMMANDS_V3", "{broken");
  const corrupt = createPendingActivityCommandRegistry({
    storage: corruptStorage,
    lockManager: sharedLockManager(),
    channel: null,
  });
  await assert.rejects(corrupt.claim(key), /ACTIVITY_COMMAND_STORAGE_CORRUPT/);
});
