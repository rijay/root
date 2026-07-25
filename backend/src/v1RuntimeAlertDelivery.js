const {
  createV1RuntimeAlertPayloadAdapter,
  runtimeAlertDeliveryMode,
} = require("./v1RuntimeAlertPayloadAdapter");

const GATE_STATE = "OPEN";
const MAXIMUM_BATCH_LIMIT = 100;
const MAXIMUM_LEASE_SECONDS = 3600;
const PERSISTENCE_METHODS = Object.freeze([
  "claimNext",
  "completeDelivered",
  "failBeforeProvider",
  "inspect",
  "markProviderStarted",
  "markUnknown",
  "recoverStale",
]);

function deliveryError(code) {
  const error = new Error("V1 runtime alert delivery operation failed");
  error.name = "V1RuntimeAlertDeliveryError";
  error.code = code;
  error.status = code.endsWith("_INPUT_INVALID") ? 400 : 503;
  return error;
}

function configurationError() {
  return deliveryError("V1_RUNTIME_ALERT_DELIVERY_CONFIGURATION_INVALID");
}

function inputError() {
  return deliveryError("V1_RUNTIME_ALERT_DELIVERY_INPUT_INVALID");
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

function opaqueAscii(value, maximumLength) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximumLength
    && /^[\x21-\x7e]+$/.test(value);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function stableCode(value, fallback) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
    ? value : fallback;
}

function gates() {
  return Object.freeze({
    receiverEvidenceGate: GATE_STATE,
    syntheticAcknowledgementGate: GATE_STATE,
  });
}

function claimFence(claim) {
  return Object.freeze({
    deliveryId: claim.deliveryId,
    leaseOwner: claim.leaseOwner,
    leaseGeneration: claim.leaseGeneration,
  });
}

function safeOutcome(delivery) {
  return Object.freeze({
    deliveryId: delivery.deliveryId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    errorCode: delivery.errorCode,
  });
}

function createV1RuntimeAlertDelivery(options = {}) {
  if (!exactKeys(options, ["env", "persistence", "provider"])
    && !exactKeys(options, ["env", "payloadAdapter", "persistence", "provider"])) {
    throw configurationError();
  }
  const { env, persistence, provider } = options;
  if (!plainRecord(env)
    || !persistence
    || PERSISTENCE_METHODS.some((method) => typeof persistence[method] !== "function")) {
    throw configurationError();
  }
  const mode = runtimeAlertDeliveryMode(env);
  if (persistence.mode !== mode
    || persistence.registrationRequired !== (mode !== "DISABLED")) throw configurationError();
  if (mode === "CONTROLLED" && (!provider || typeof provider.deliver !== "function")) {
    throw configurationError();
  }
  if (mode !== "CONTROLLED" && provider !== null) throw configurationError();
  const payloadAdapter = mode === "DISABLED"
    ? null
    : (options.payloadAdapter || persistence.payloadAdapter || createV1RuntimeAlertPayloadAdapter(env));
  if (mode !== "DISABLED" && (!payloadAdapter
    || typeof payloadAdapter.sign !== "function"
    || typeof payloadAdapter.verify !== "function"
    || typeof payloadAdapter.prepare !== "function"
    || typeof payloadAdapter.verifyBinding !== "function"
    || typeof payloadAdapter.digestReceipt !== "function")) throw configurationError();

  async function inspect() {
    const persistenceInspection = await persistence.inspect();
    return Object.freeze({
      mode,
      enabled: mode !== "DISABLED",
      dryRun: mode === "DRY_RUN",
      status: mode === "DISABLED"
        ? "V1_RUNTIME_ALERT_DELIVERY_DISABLED"
        : mode === "DRY_RUN"
          ? "V1_RUNTIME_ALERT_DELIVERY_DRY_RUN"
          : "V1_RUNTIME_ALERT_DELIVERY_CONTROLLED",
      gates: gates(),
      persistence: persistenceInspection,
    });
  }

  async function failBeforeProvider(claim, error, fallbackCode) {
    const retryable = Boolean(error && error.preProviderTransient === true);
    const errorCode = stableCode(error && error.code, fallbackCode);
    return persistence.failBeforeProvider({
      ...claimFence(claim),
      errorCode,
      retryable,
    });
  }

  async function outcomeUnknown(started, errorCode) {
    try {
      return await persistence.markUnknown({
        ...claimFence(started),
        errorCode,
      });
    } catch {
      return Object.freeze({
        deliveryId: started.deliveryId,
        status: "REVIEW_REQUIRED",
        attemptCount: started.attemptCount,
        errorCode,
      });
    }
  }

  async function runDue(input = {}) {
    if (!exactKeys(input, ["leaseOwner", "leaseSeconds", "limit"])
      || !opaqueAscii(input.leaseOwner, 128)
      || !boundedInteger(input.leaseSeconds, 1, MAXIMUM_LEASE_SECONDS)
      || !boundedInteger(input.limit, 1, MAXIMUM_BATCH_LIMIT)) throw inputError();
    if (mode === "DISABLED" || mode === "DRY_RUN") {
      return Object.freeze({
        mode,
        status: mode === "DISABLED"
          ? "V1_RUNTIME_ALERT_DELIVERY_DISABLED"
          : "V1_RUNTIME_ALERT_DELIVERY_DRY_RUN",
        claimedCount: 0,
        deliveredCount: 0,
        retryWaitCount: 0,
        deadLetterCount: 0,
        unknownCount: 0,
        reviewRequiredCount: 0,
        outcomes: Object.freeze([]),
        gates: gates(),
      });
    }
    const outcomes = [];
    let claimedCount = 0;
    for (let index = 0; index < input.limit; index += 1) {
      const claim = await persistence.claimNext({
        leaseOwner: input.leaseOwner,
        leaseSeconds: input.leaseSeconds,
      });
      if (!claim) break;
      claimedCount += 1;
      const storedSignature = Object.freeze({
        canonicalVersion: claim.payloadCanonicalVersion,
        digestScheme: claim.payloadDigestScheme,
        keyId: claim.payloadDigestKeyId,
        digest: claim.payloadDigest,
      });
      const storedBinding = Object.freeze({
        authorityVersion: claim.receiverBindingAuthorityVersion,
        registrationMode: claim.registrationMode,
        ref: claim.receiverBindingRef,
        digest: claim.receiverBindingDigest,
        digestScheme: claim.receiverBindingDigestScheme,
        keyId: claim.receiverBindingDigestKeyId,
      });
      let signed;
      try {
        if (!payloadAdapter.verifyBinding(storedBinding)) {
          const mismatch = new Error("receiver binding authority mismatch");
          mismatch.code = "RECEIVER_BINDING_AUTHORITY_MISMATCH";
          mismatch.preProviderTransient = false;
          throw mismatch;
        }
        signed = await payloadAdapter.prepare(storedSignature, claim.payload);
      } catch (error) {
        const failed = await failBeforeProvider(
          claim,
          error,
          "PAYLOAD_VERIFICATION_FAILED"
        );
        outcomes.push(safeOutcome(failed));
        continue;
      }

      let started;
      try {
        started = await persistence.markProviderStarted(claimFence(claim));
      } catch {
        outcomes.push(Object.freeze({
          deliveryId: claim.deliveryId,
          status: "REVIEW_REQUIRED",
          attemptCount: claim.attemptCount,
          errorCode: "PROVIDER_START_COMMIT_UNKNOWN",
        }));
        continue;
      }

      let acknowledgement;
      try {
        acknowledgement = await provider.deliver(Object.freeze({
          payload: started.payload,
          signature: Object.freeze({
            canonicalVersion: signed.canonicalVersion,
            digestScheme: signed.digestScheme,
            keyId: signed.keyId,
            value: signed.signature,
          }),
        }));
      } catch {
        outcomes.push(safeOutcome(await outcomeUnknown(
          started,
          "PROVIDER_OUTCOME_UNKNOWN"
        )));
        continue;
      }

      let receipt;
      try {
        if (!exactKeys(acknowledgement, ["receipt"])) throw inputError();
        receipt = payloadAdapter.digestReceipt(started.deliveryId, acknowledgement.receipt);
      } catch {
        outcomes.push(safeOutcome(await outcomeUnknown(
          started,
          "PROVIDER_ACK_INVALID"
        )));
        continue;
      }

      try {
        const delivered = await persistence.completeDelivered({
          ...claimFence(started),
          receiptDigest: receipt.digest,
          receiptDigestScheme: receipt.digestScheme,
          receiptDigestKeyId: receipt.keyId,
        });
        outcomes.push(safeOutcome(delivered));
      } catch {
        outcomes.push(safeOutcome(await outcomeUnknown(
          started,
          "PROVIDER_ACK_UNKNOWN"
        )));
      }
    }
    const count = (status) => outcomes.filter((item) => item.status === status).length;
    return Object.freeze({
      mode,
      status: "V1_RUNTIME_ALERT_DELIVERY_BATCH_COMPLETE",
      claimedCount,
      deliveredCount: count("DELIVERED"),
      retryWaitCount: count("RETRY_WAIT"),
      deadLetterCount: count("DEAD_LETTER"),
      unknownCount: count("UNKNOWN"),
      reviewRequiredCount: count("UNKNOWN") + count("DEAD_LETTER")
        + count("REVIEW_REQUIRED"),
      outcomes: Object.freeze(outcomes),
      gates: gates(),
    });
  }

  async function recoverStale(input = {}) {
    if (!exactKeys(input, ["limit"])
      || !boundedInteger(input.limit, 1, MAXIMUM_BATCH_LIMIT)) throw inputError();
    const recovery = await persistence.recoverStale(input);
    return Object.freeze({ ...recovery, gates: gates() });
  }

  return Object.freeze({ inspect, recoverStale, runDue });
}

module.exports = { createV1RuntimeAlertDelivery };
