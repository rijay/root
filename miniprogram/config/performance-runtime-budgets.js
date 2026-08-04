// WeChat Mini Program runtime does not bundle JSON required from JavaScript.
// Keep these values aligned with performance-budgets.json; the performance
// budget contract test fails when the two representations drift.
module.exports = Object.freeze({
  network: Object.freeze({
    maxConcurrentRequests: 4,
    readTimeoutMs: 8000,
    writeTimeoutMs: 12000,
    sameReadDedupeWindowMs: 300,
    publicReadP75Ms: 600,
    publicReadP95Ms: 1200,
    protectedReadP75Ms: 800,
    protectedReadP95Ms: 1500,
    writeP75Ms: 1000,
    writeP95Ms: 2000,
  }),
  collection: Object.freeze({
    candidateSampleRate: 1,
    releaseOrdinarySampleRate: 0.1,
    criticalSampleRate: 1,
    releaseUploadEnabledByDefault: false,
    maxBatchEvents: 20,
    maxQueuedEvents: 200,
    maxBatchBytes: 32768,
    maxEventsPerMinute: 120,
  }),
});
