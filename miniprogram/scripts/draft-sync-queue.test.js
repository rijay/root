const assert = require("node:assert/strict");

const { createDraftSyncQueue } = require("../utils/draft-sync-queue");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const saved = [];
  const queue = createDraftSyncQueue({
    async save(job) {
      saved.push(job);
      if (job.revision === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      return { revision: job.revision };
    },
  });

  queue.enqueue({ answers: { Q1: "A" }, revision: 1 });
  await firstStarted.promise;
  queue.enqueue({ answers: { Q1: "B" }, revision: 2 });
  queue.enqueue({ answers: { Q1: "C" }, revision: 3 });
  releaseFirst.resolve();
  const latest = await queue.flush();
  assert.deepEqual(saved.map((job) => job.revision), [1, 3]);
  assert.equal(latest.revision, 3);
  assert.deepEqual(queue.getState(), {
    syncing: false,
    pending: false,
    failed: false,
    latestRevision: 3,
  });

  let attempts = 0;
  const retryQueue = createDraftSyncQueue({
    async save(job) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return { revision: job.revision, safetyTriggered: false };
    },
  });
  retryQueue.enqueue({ answers: { safety: false }, revision: 4 });
  await assert.rejects(retryQueue.flush(), /temporary failure/);
  assert.equal(retryQueue.getState().pending, true);
  assert.equal(retryQueue.getState().failed, true);
  const retried = await retryQueue.retry();
  assert.equal(retried.revision, 4);
  assert.equal(retryQueue.getState().failed, false);

  console.log("draft sync queue tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
