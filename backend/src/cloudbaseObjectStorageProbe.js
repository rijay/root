const auditLog = require("./auditLog");
const { createCloudbaseObjectStorageAdapter } = require("./cloudbaseObjectStorageAdapter");
const { nowISO } = require("./dates");

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function pathSegment(value) {
  return text(value, "probe").replace(/[^a-zA-Z0-9._=-]/g, "_").slice(0, 120);
}

function errorPreview(error) {
  return text(error && error.message, "CloudBase object storage probe failed").slice(0, 180);
}

function resolveAdapter(context = {}) {
  if (context.objectStorageAdapter) return context.objectStorageAdapter;
  const env = context.env || process.env;
  return createCloudbaseObjectStorageAdapter({
    provider: "CLOUDBASE",
    envId: env.ROOT_CLOUDBASE_ENV_ID,
  }, context);
}

async function runCloudbaseObjectStorageProbe(data, input = {}, context = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("CloudBase object storage probe request_id required"), { code: 400 });

  const env = context.env || process.env;
  const runtimeMetadata = context.runtimeMetadata || {};
  const checkedAt = nowISO();
  const objectKey = `release-probes/${checkedAt.slice(0, 10)}/${pathSegment(requestId)}.json`;
  const adapter = resolveAdapter(context);
  if (!adapter || typeof adapter.putObject !== "function" || typeof adapter.deleteObject !== "function") {
    throw Object.assign(new Error("CloudBase object storage Adapter is unavailable"), { code: 503 });
  }

  let uploaded = null;
  let removed = null;
  let error = "";
  try {
    uploaded = await adapter.putObject({
      objectKey,
      body: JSON.stringify({
        probe: "myroot-cloudbase-object-storage",
        requestId,
        checkedAt,
        version: text(runtimeMetadata.version),
        releaseId: text(runtimeMetadata.releaseId),
      }),
      contentType: "application/json; charset=utf-8",
    });
    removed = await adapter.deleteObject({
      objectKey,
      externalRef: uploaded.externalRef,
      fileId: uploaded.fileId,
    });
    if (!removed || removed.deleted !== true) error = "CloudBase object delete was not confirmed";
  } catch (probeError) {
    error = errorPreview(probeError);
    const failureFileId = text(probeError && (probeError.fileId || probeError.externalRef));
    if (!uploaded && failureFileId.startsWith("cloud://")) {
      uploaded = {
        externalRef: failureFileId,
        fileId: failureFileId,
        objectKey,
        uploadConfirmed: false,
      };
      try {
        removed = await adapter.deleteObject({
          objectKey,
          externalRef: failureFileId,
          fileId: failureFileId,
        });
      } catch (cleanupError) {
        error = `${error}; cleanup: ${errorPreview(cleanupError)}`.slice(0, 180);
      }
    }
  }

  const status = uploaded && removed && removed.deleted === true && !error ? "VERIFIED" : "FAILED";
  const result = {
    status,
    provider: "CLOUDBASE",
    envId: text(env.ROOT_CLOUDBASE_ENV_ID),
    objectKey,
    uploadConfirmed: Boolean(uploaded && uploaded.fileId && uploaded.uploadConfirmed !== false),
    deleteConfirmed: Boolean(removed && removed.deleted === true),
    residualObjectPossible: Boolean(uploaded && (!removed || removed.deleted !== true)),
    externalRef: text(uploaded && uploaded.externalRef),
    version: text(runtimeMetadata.version),
    releaseId: text(runtimeMetadata.releaseId),
    requestId,
    checkedAt,
    error,
  };
  const audit = auditLog.appendAuditLog(data, {
    action: "CLOUDBASE_OBJECT_STORAGE_PROBE",
    targetType: "CLOUDBASE_OBJECT_STORAGE",
    targetId: objectKey,
    operatorId: text(input.operatorId || input.operator_id, "system"),
    reason: "生产发布前对象存储上传与删除验证",
    after: result,
    metadata: {
      requestId,
      status,
      releaseId: result.releaseId,
    },
  });
  return { probe: result, audit };
}

module.exports = {
  runCloudbaseObjectStorageProbe,
};
