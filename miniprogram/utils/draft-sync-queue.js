function safely(callback, ...args) {
  if (typeof callback !== "function") return;
  try {
    callback(...args);
  } catch (_) {
    // UI callbacks must never break the persistence queue.
  }
}

function createDraftSyncQueue(options = {}) {
  if (typeof options.save !== "function") {
    throw new TypeError("createDraftSyncQueue requires a save function");
  }

  let syncing = false;
  let pendingJob = null;
  let failed = false;
  let failure = null;
  let latestRevision = 0;
  let latestResult = null;
  let runPromise = null;
  let destroyed = false;

  function getState() {
    return {
      syncing,
      pending: Boolean(pendingJob),
      failed,
      latestRevision,
    };
  }

  function emitState() {
    if (!destroyed) safely(options.onState, getState());
  }

  async function run() {
    while (pendingJob && !failed) {
      const job = pendingJob;
      pendingJob = null;
      syncing = true;
      emitState();
      try {
        latestResult = await options.save(job);
        if (!destroyed) safely(options.onSaved, latestResult, job);
      } catch (error) {
        failed = true;
        failure = error;
        if (!pendingJob) pendingJob = job;
        if (!destroyed) safely(options.onError, error, job);
      } finally {
        syncing = false;
        emitState();
      }
    }
  }

  function start() {
    if (runPromise || failed || !pendingJob) return;
    runPromise = run().finally(() => {
      runPromise = null;
      if (pendingJob && !failed) start();
    });
  }

  function enqueue(job = {}) {
    latestRevision = Math.max(latestRevision, Number(job.revision || 0));
    pendingJob = job;
    emitState();
    start();
    return getState();
  }

  async function flush() {
    while (runPromise) await runPromise;
    if (failed) throw failure;
    if (pendingJob) {
      start();
      while (runPromise) await runPromise;
      if (failed) throw failure;
    }
    return latestResult;
  }

  async function retry() {
    failed = false;
    failure = null;
    emitState();
    start();
    return flush();
  }

  function destroy() {
    destroyed = true;
  }

  return Object.freeze({
    destroy,
    enqueue,
    flush,
    getState,
    retry,
  });
}

module.exports = Object.freeze({ createDraftSyncQueue });
