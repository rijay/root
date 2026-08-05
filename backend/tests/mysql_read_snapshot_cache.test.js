const assert = require("node:assert/strict");
const test = require("node:test");

const { createRevisionSnapshotCache } = require("../src/store");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("revision snapshot cache serves unchanged reads without loading the full payload", async () => {
  let payloadLoads = 0;
  const cache = createRevisionSnapshotCache({
    initialSnapshot: { values: ["cached"] },
    initialRevision: 7,
    probeRevision: async () => ({ revision: 7 }),
    loadSnapshot: async () => {
      payloadLoads += 1;
      return { revision: 7, payload_json: JSON.stringify({ values: ["database"] }) };
    },
  });

  const [first, second] = await Promise.all([cache.read(), cache.read()]);

  assert.deepEqual(first, { values: ["cached"] });
  assert.equal(first, second);
  assert.equal(payloadLoads, 0);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.values), true);
});

test("revision snapshot cache single-flights one payload reload for concurrent readers", async () => {
  const loading = deferred();
  let payloadLoads = 0;
  const cache = createRevisionSnapshotCache({
    initialSnapshot: { values: ["old"] },
    initialRevision: 3,
    probeRevision: async () => ({ revision: 4 }),
    loadSnapshot: async () => {
      payloadLoads += 1;
      await loading.promise;
      return { revision: 4, payload_json: JSON.stringify({ values: ["new"] }) };
    },
  });

  const reads = [cache.read(), cache.read(), cache.read()];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(payloadLoads, 1);
  loading.resolve();

  const snapshots = await Promise.all(reads);
  assert.equal(snapshots.every((snapshot) => snapshot === snapshots[0]), true);
  assert.deepEqual(snapshots[0], { values: ["new"] });
  assert.equal(cache.revision, 4);
});

test("a committed write advances the read cache before the next read", async () => {
  const cache = createRevisionSnapshotCache({
    initialSnapshot: { values: ["old"] },
    initialRevision: 10,
    probeRevision: async () => ({ revision: 11 }),
    loadSnapshot: async () => {
      throw new Error("the committed snapshot should already be cached");
    },
  });

  cache.update({ values: ["committed"] }, 11);
  assert.deepEqual(await cache.read(), { values: ["committed"] });
});
