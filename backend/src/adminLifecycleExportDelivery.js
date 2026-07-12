const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { nowISO } = require("./dates");
const { createCloudbaseObjectStorageAdapter, normalizeProvider } = require("./cloudbaseObjectStorageAdapter");

const DELIVERY_CHANNEL = {
  NONE: "NONE",
  INTERNAL_LINK: "INTERNAL_LINK",
  WEBHOOK: "WEBHOOK",
  OBJECT_STORAGE: "OBJECT_STORAGE",
};

const DELIVERY_STATUS = {
  NOT_REQUESTED: "NOT_REQUESTED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  READY: "READY",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  RETRY_SCHEDULED: "RETRY_SCHEDULED",
  DEAD_LETTER: "DEAD_LETTER",
  SKIPPED: "SKIPPED",
};

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function booleanText(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["true", "1", "yes", "y"].includes(normalized);
}

function normalizeBoolean(options, camelKey, snakeKey, fallback = false) {
  if (Object.prototype.hasOwnProperty.call(options, camelKey)) return booleanText(options[camelKey], false);
  if (Object.prototype.hasOwnProperty.call(options, snakeKey)) return booleanText(options[snakeKey], false);
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function envValue(context = {}, name) {
  return (context.env && context.env[name]) || process.env[name] || "";
}

function normalizeChannel(value) {
  const normalized = text(value).toUpperCase();
  if (["INTERNAL", "LINK", "INTERNAL_DOWNLOAD", "INTERNAL_LINK"].includes(normalized)) return DELIVERY_CHANNEL.INTERNAL_LINK;
  if (["WEBHOOK", "HTTP"].includes(normalized)) return DELIVERY_CHANNEL.WEBHOOK;
  if (["OBJECT", "OBJECT_STORAGE", "COS", "STORAGE"].includes(normalized)) return DELIVERY_CHANNEL.OBJECT_STORAGE;
  return DELIVERY_CHANNEL.NONE;
}

function maskUrl(value) {
  const urlText = text(value);
  if (!urlText) return "";
  if (urlText.startsWith("/")) return urlText.split("?")[0];
  try {
    const url = new URL(urlText);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return urlText.length > 12 ? `${urlText.slice(0, 12)}...` : urlText;
  }
}

function publicBaseUrl(context = {}) {
  return text(
    context.publicBaseUrl ||
      context.baseUrl ||
      envValue(context, "ROOT_PUBLIC_BASE_URL") ||
      envValue(context, "ROOT_JOB_BASE_URL"),
  ).replace(/\/$/, "");
}

function internalDownloadPath(record) {
  return `/api/v1/admin/lifecycle-user-exports/${record.export_id}/download`;
}

function signedDownloadPath(record) {
  return `/api/v1/lifecycle-user-exports/${record.export_id}/signed-download`;
}

function internalDownloadUrl(record, context = {}) {
  const baseUrl = publicBaseUrl(context);
  const path = internalDownloadPath(record);
  return baseUrl ? `${baseUrl}${path}` : path;
}

function objectStorageTarget(options = {}, context = {}) {
  const baseUrl = text(options.objectBaseUrl || envValue(context, "ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL")).replace(/\/$/, "");
  const bucket = text(options.objectBucket || envValue(context, "ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET"));
  const prefix = text(options.objectPrefix || envValue(context, "ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX"), "lifecycle-user-exports").replace(/^\/+|\/+$/g, "");
  const dir = text(options.objectDir || options.object_dir || envValue(context, "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR"));
  const provider = normalizeProvider(options.objectProvider || options.object_provider || envValue(context, "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER"));
  const envId = text(options.objectEnvId || options.object_env_id || envValue(context, "ROOT_CLOUDBASE_ENV_ID"));
  return { baseUrl, bucket, prefix, dir, provider, envId };
}

function signedDownloadSecret(context = {}) {
  return text(context.signedDownloadSecret || envValue(context, "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET"));
}

function signedDownloadTtlSeconds(options = {}, context = {}) {
  return clampNumber(
    options.signedDownloadTtlSeconds ||
      options.signed_download_ttl_seconds ||
      envValue(context, "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS"),
    86400,
    60,
    7 * 24 * 60 * 60,
  );
}

function signedDownloadEnabled(options = {}, context = {}) {
  return normalizeBoolean(
    options,
    "signedDownload",
    "signed_download",
    booleanText(envValue(context, "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED"), false),
  );
}

function webhookChannel(options = {}, context = {}) {
  return text(
    options.webhookChannel ||
      options.webhook_channel ||
      options.deliveryWebhookChannel ||
      options.delivery_webhook_channel ||
      envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL"),
  ).toUpperCase();
}

function webhookTemplate(options = {}, context = {}) {
  return text(
    options.webhookTemplate ||
      options.webhook_template ||
      options.deliveryWebhookTemplate ||
      options.delivery_webhook_template ||
      envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE"),
  );
}

function deliveryTimeoutMs(options = {}, context = {}) {
  return clampNumber(
    options.deliveryTimeoutMs ||
      options.delivery_timeout_ms ||
      options.webhookTimeoutMs ||
      options.webhook_timeout_ms ||
      envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS"),
    5000,
    1000,
    30000,
  );
}

function resolveDeliveryOptions(body = {}, context = {}) {
  const configuredChannel = body.deliveryChannel || body.delivery_channel || envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL");
  const channel = normalizeChannel(configuredChannel);
  const webhookUrl = text(body.webhookUrl || body.webhook_url || envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL"));
  const target = text(body.deliveryTarget || body.delivery_target || envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_TARGET"));
  const enabled = normalizeBoolean(
    body,
    "deliveryEnabled",
    "delivery_enabled",
    booleanText(envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_ENABLED"), false) || channel !== DELIVERY_CHANNEL.NONE || Boolean(webhookUrl),
  );
  return {
    enabled,
    channel: enabled ? (channel === DELIVERY_CHANNEL.NONE && webhookUrl ? DELIVERY_CHANNEL.WEBHOOK : channel) : DELIVERY_CHANNEL.NONE,
    target,
    targetPreview: maskUrl(target || webhookUrl),
    webhookUrl,
    webhookUrlPreview: maskUrl(webhookUrl),
    webhookSecret: text(body.webhookSecret || body.webhook_secret || envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_SECRET")),
    webhookChannel: webhookChannel(body, context),
    webhookTemplate: webhookTemplate(body, context),
    timeoutMs: deliveryTimeoutMs(body, context),
    includeCsv: normalizeBoolean(body, "deliveryIncludeCsv", "delivery_include_csv", booleanText(envValue(context, "ROOT_LIFECYCLE_EXPORT_DELIVERY_INCLUDE_CSV"), false)),
    object: objectStorageTarget(body, context),
    signedDownload: signedDownloadEnabled(body, context),
    signedDownloadTtlSeconds: signedDownloadTtlSeconds(body, context),
  };
}

function initialDeliveryState(options = {}, record = {}) {
  if (!options.enabled || options.channel === DELIVERY_CHANNEL.NONE) {
    return {
      delivery_requested: false,
      delivery_channel: DELIVERY_CHANNEL.NONE,
      delivery_status: DELIVERY_STATUS.NOT_REQUESTED,
      delivery_target_json: {},
      delivery_external_ref: "",
      delivery_error: "",
      delivery_delivered_at: "",
      delivery_request_id: "",
      delivery_attempt_count: 0,
    };
  }
  return {
    delivery_requested: true,
    delivery_channel: options.channel,
    delivery_status: record.approval_required ? DELIVERY_STATUS.PENDING_APPROVAL : DELIVERY_STATUS.READY,
    delivery_target_json: deliveryTargetPayload(options),
    delivery_external_ref: "",
    delivery_error: "",
    delivery_delivered_at: "",
    delivery_request_id: "",
    delivery_attempt_count: 0,
  };
}

function deliveryTargetPayload(options = {}) {
  return {
    channel: options.channel || DELIVERY_CHANNEL.NONE,
    target: options.target || "",
    targetPreview: options.targetPreview || "",
    webhookUrlPreview: options.webhookUrlPreview || "",
    webhookChannel: options.webhookChannel || "",
    webhookTemplate: options.webhookTemplate || "",
    timeoutMs: options.timeoutMs || 0,
    includeCsv: Boolean(options.includeCsv),
    signedDownload: Boolean(options.signedDownload),
    signedDownloadTtlSeconds: options.signedDownloadTtlSeconds || 0,
    objectBaseUrl: options.object ? options.object.baseUrl : "",
    objectBucket: options.object ? options.object.bucket : "",
    objectPrefix: options.object ? options.object.prefix : "",
    objectProvider: options.object ? options.object.provider : "",
    objectEnvId: options.object ? options.object.envId : "",
    objectDirConfigured: Boolean(options.object && options.object.dir),
  };
}

function applyApprovalDecision(record, decision) {
  if (!record || !record.delivery_requested) return;
  if (decision === "APPROVED" && record.delivery_status === DELIVERY_STATUS.PENDING_APPROVAL) {
    record.delivery_status = DELIVERY_STATUS.READY;
    record.delivery_error = "";
  }
  if (decision === "REJECTED" && record.delivery_status === DELIVERY_STATUS.PENDING_APPROVAL) {
    record.delivery_status = DELIVERY_STATUS.SKIPPED;
    record.delivery_error = "approval rejected";
  }
}

function signatureForBody(body, secret) {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function signedDownloadPayload(record, expires) {
  return [
    "ROOT_LIFECYCLE_USER_EXPORT_DOWNLOAD",
    record.export_id || "",
    record.filename || "",
    String(expires || ""),
  ].join("\n");
}

function signedDownloadSignature(record, expires, secret) {
  return signatureForBody(signedDownloadPayload(record, expires), secret);
}

function nowEpochSeconds(context = {}) {
  const nowText = text(context.now);
  const millis = nowText ? Date.parse(nowText) : Date.now();
  return Math.floor((Number.isFinite(millis) ? millis : Date.now()) / 1000);
}

function signedDownloadLink(record, options = {}, context = {}) {
  const secret = signedDownloadSecret(context);
  if (!secret) return null;
  const expires = nowEpochSeconds(context) + signedDownloadTtlSeconds(options, context);
  const signature = signedDownloadSignature(record, expires, secret);
  const path = signedDownloadPath(record);
  const query = `expires=${encodeURIComponent(String(expires))}&signature=${encodeURIComponent(signature)}`;
  const baseUrl = publicBaseUrl(context);
  return {
    url: baseUrl ? `${baseUrl}${path}?${query}` : `${path}?${query}`,
    path,
    expires,
  };
}

function signedDownloadUrl(record, options = {}, context = {}) {
  const link = signedDownloadLink(record, options, context);
  return link ? link.url : "";
}

function verifySignedDownload(record, query = {}, context = {}) {
  const secret = signedDownloadSecret(context);
  if (!secret) return { ok: false, code: "SECRET_MISSING", message: "signed download secret required" };
  const expires = Number(query.expires || query.exp || 0);
  const signature = text(query.signature || query.sig);
  if (!Number.isFinite(expires) || expires <= 0 || !signature) {
    return { ok: false, code: "MISSING_SIGNATURE", message: "signed download expires and signature required" };
  }
  if (expires < nowEpochSeconds(context)) {
    return { ok: false, code: "EXPIRED", message: "signed download expired" };
  }
  const expected = signedDownloadSignature(record, expires, secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  const matched = expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  return matched
    ? { ok: true, code: "OK", expires, signature }
    : { ok: false, code: "INVALID_SIGNATURE", message: "signed download signature invalid" };
}

async function postWithTimeout(fetchImpl, url, init, timeoutMs = 5000) {
  if (typeof AbortController !== "function") return fetchImpl(url, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildDeliveryPayload(record, options = {}, context = {}) {
  const summary = record.summary_json || {};
  const signedLink = options.signedDownload ? signedDownloadLink(record, options, context) : null;
  const payload = {
    event: "ROOT_LIFECYCLE_USER_EXPORT_READY",
    generatedAt: text(context.now) || nowISO(),
    requestId: text(context.requestId || options.requestId),
    export: {
      exportId: record.export_id,
      filename: record.filename,
      contentType: record.content_type,
      sensitivity: summary.sensitivity || "UNKNOWN",
      approvalRequired: Boolean(record.approval_required),
      approvalStatus: record.approval_status || "",
      exportedCount: summary.exportedCount || 0,
      total: summary.total || 0,
      bytes: summary.bytes || 0,
      expiresAt: record.expires_at || "",
      downloadPath: internalDownloadPath(record),
      downloadUrl: internalDownloadUrl(record, context),
      signedDownloadUrl: signedLink ? signedLink.url : "",
      signedDownloadPath: signedLink ? signedLink.path : "",
      signedDownloadExpiresAt: signedLink ? new Date(signedLink.expires * 1000).toISOString() : "",
    },
    delivery: {
      channel: options.channel,
      target: options.target || "",
      targetPreview: options.targetPreview || "",
      webhookChannel: options.webhookChannel || "",
      webhookTemplate: options.webhookTemplate || "",
      includeCsv: Boolean(options.includeCsv),
      signedDownload: Boolean(options.signedDownload),
    },
  };
  if (options.includeCsv) payload.csvText = record.csv_text || "";
  return payload;
}

function deliverInternalLink(record, options = {}, context = {}) {
  if (options.signedDownload) {
    const url = signedDownloadUrl(record, options, context);
    if (!url) {
      return {
        status: DELIVERY_STATUS.FAILED,
        externalRef: "",
        error: "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET required",
        deliveryTarget: deliveryTargetPayload(options),
      };
    }
    return {
      status: DELIVERY_STATUS.DELIVERED,
      externalRef: url,
      error: "",
      deliveryTarget: { ...deliveryTargetPayload(options), signedDownload: true },
    };
  }
  return {
    status: DELIVERY_STATUS.DELIVERED,
    externalRef: internalDownloadUrl(record, context),
    error: "",
    deliveryTarget: deliveryTargetPayload(options),
  };
}

function sanitizeObjectPathSegment(value) {
  return text(value, "object").replace(/\\/g, "/").split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9._=-]/g, "_"))
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function objectKeyForRecord(record, target = {}) {
  const prefix = sanitizeObjectPathSegment(target.prefix || "lifecycle-user-exports");
  const exportId = sanitizeObjectPathSegment(record.export_id || "export");
  const filename = sanitizeObjectPathSegment(record.filename || "export.csv");
  return `${prefix}/${exportId}/${filename}`;
}

function objectExternalRef(objectKey, target = {}) {
  if (target.baseUrl) return `${target.baseUrl.replace(/\/$/, "")}/${objectKey}`;
  if (target.bucket) return `object://${target.bucket}/${objectKey}`;
  if (target.provider === "CLOUDBASE" && target.envId) return `cloudbase://${target.envId}/${objectKey}`;
  return objectKey;
}

function objectPathForKey(target = {}, objectKey) {
  const root = path.resolve(target.dir);
  const outputPath = path.resolve(root, objectKey);
  if (!outputPath.startsWith(`${root}${path.sep}`)) throw new Error("object key escapes object dir");
  return outputPath;
}

async function removeIfExists(outputPath) {
  try {
    await fs.access(outputPath);
  } catch {
    return false;
  }
  await fs.rm(outputPath, { force: true });
  return true;
}

function filesystemObjectStorageAdapter(target = {}) {
  if (!target.dir) return null;
  return {
    async putObject({ objectKey, body, contentType, metadata }) {
      const outputPath = objectPathForKey(target, objectKey);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, body || "", "utf8");
      await fs.writeFile(`${outputPath}.metadata.json`, JSON.stringify({
        contentType,
        metadata,
        writtenAt: nowISO(),
      }, null, 2));
      return {
        externalRef: objectExternalRef(objectKey, target),
        objectKey,
      };
    },
    async deleteObject({ objectKey }) {
      const outputPath = objectPathForKey(target, objectKey);
      const deletedObject = await removeIfExists(outputPath);
      const deletedMetadata = await removeIfExists(`${outputPath}.metadata.json`);
      return {
        externalRef: objectExternalRef(objectKey, target),
        objectKey,
        deleted: deletedObject || deletedMetadata,
      };
    },
  };
}

function resolveObjectStorageAdapter(options = {}, context = {}) {
  if (context.objectStorageAdapter) return context.objectStorageAdapter;
  const target = options.object || {};
  return filesystemObjectStorageAdapter(target) || createCloudbaseObjectStorageAdapter(target, context);
}

function objectStorageAdapterLabel(target = {}) {
  if (target.dir) return "FILESYSTEM";
  if (target.provider === "CLOUDBASE") return "CLOUDBASE";
  return "CUSTOM";
}

async function putObject(adapter, payload) {
  if (typeof adapter === "function") return adapter(payload);
  if (adapter && typeof adapter.putObject === "function") return adapter.putObject(payload);
  throw new Error("object storage adapter must expose putObject");
}

async function deleteObject(adapter, payload) {
  if (adapter && typeof adapter.deleteObject === "function") return adapter.deleteObject(payload);
  throw new Error("object storage adapter must expose deleteObject");
}

async function deliverObjectStorageManifest(record, options = {}, context = {}) {
  const target = options.object || {};
  const adapter = resolveObjectStorageAdapter(options, context);
  if (!adapter) {
    return {
      status: DELIVERY_STATUS.SKIPPED,
      externalRef: "",
      error: "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER, ROOT_LIFECYCLE_EXPORT_OBJECT_DIR or objectStorageAdapter required",
      deliveryTarget: deliveryTargetPayload(options),
    };
  }
  const objectKey = objectKeyForRecord(record, target);
  const result = await putObject(adapter, {
    objectKey,
    body: record.csv_text || "",
    contentType: record.content_type || "text/csv; charset=utf-8",
    metadata: buildDeliveryPayload(record, { ...options, includeCsv: false }, context),
  });
  return {
    status: DELIVERY_STATUS.DELIVERED,
    externalRef: result && result.externalRef ? result.externalRef : objectExternalRef(objectKey, target),
    error: "",
    deliveryTarget: {
      ...deliveryTargetPayload(options),
      objectKey,
      objectFileId: result && result.fileId ? result.fileId : "",
      adapter: objectStorageAdapterLabel(target),
    },
  };
}

async function deliverWebhook(record, options = {}, context = {}) {
  if (!options.webhookUrl) {
    return {
      status: DELIVERY_STATUS.FAILED,
      externalRef: "",
      error: "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL required",
      deliveryTarget: deliveryTargetPayload(options),
    };
  }
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { status: DELIVERY_STATUS.FAILED, externalRef: "", error: "fetch unavailable", deliveryTarget: deliveryTargetPayload(options) };
  }
  const payload = buildDeliveryPayload(record, options, context);
  if (options.signedDownload && !payload.export.signedDownloadUrl) {
    return {
      status: DELIVERY_STATUS.FAILED,
      externalRef: "",
      error: "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET required",
      deliveryTarget: deliveryTargetPayload(options),
    };
  }
  const body = JSON.stringify(payload);
  const signature = signatureForBody(body, options.webhookSecret);
  const headers = {
    "Content-Type": "application/json",
    "X-Root-Export-Event": "ROOT_LIFECYCLE_USER_EXPORT_READY",
    "X-Root-Export-Channel": DELIVERY_CHANNEL.WEBHOOK,
    "X-Root-Export-Id": record.export_id || "",
    "X-Root-Export-Request-Id": text(context.requestId || options.requestId),
  };
  if (signature) headers["X-Root-Export-Signature"] = signature;
  if (options.webhookChannel) headers["X-Root-Export-Webhook-Channel"] = options.webhookChannel;
  if (options.webhookTemplate) headers["X-Root-Export-Webhook-Template"] = options.webhookTemplate;
  if (options.signedDownload) headers["X-Root-Export-Signed-Download"] = "true";
  try {
    const response = await postWithTimeout(fetchImpl, options.webhookUrl, {
      method: "POST",
      headers,
      body,
    }, options.timeoutMs || 5000);
    const status = response && response.status ? Number(response.status) : 0;
    const ok = !response || response.ok !== false;
    const responsePreview = response && typeof response.text === "function"
      ? String(await response.text()).slice(0, 160)
      : "";
    const deliveryTarget = {
      ...deliveryTargetPayload(options),
      webhookStatusCode: status,
      webhookSigned: Boolean(signature),
      webhookResponsePreview: responsePreview,
      signedDownloadUrlPreview: payload.export.signedDownloadUrl ? maskUrl(payload.export.signedDownloadUrl) : "",
    };
    return {
      status: ok ? DELIVERY_STATUS.DELIVERED : DELIVERY_STATUS.FAILED,
      externalRef: status ? `HTTP ${status}` : "",
      error: ok ? "" : `HTTP ${status || "FAILED"}`,
      deliveryTarget,
    };
  } catch (error) {
    return {
      status: DELIVERY_STATUS.FAILED,
      externalRef: "",
      error: error && error.name === "AbortError" ? "webhook timeout" : error.message || "webhook failed",
      deliveryTarget: deliveryTargetPayload(options),
    };
  }
}

async function deliverLifecycleExportRecord(record, body = {}, context = {}) {
  const options = resolveDeliveryOptions({ deliveryEnabled: true, ...body }, context);
  if (options.channel === DELIVERY_CHANNEL.NONE) {
    return {
      status: DELIVERY_STATUS.SKIPPED,
      externalRef: "",
      error: "delivery channel not configured",
      deliveryTarget: deliveryTargetPayload(options),
    };
  }
  if (options.channel === DELIVERY_CHANNEL.INTERNAL_LINK) return deliverInternalLink(record, options, context);
  if (options.channel === DELIVERY_CHANNEL.OBJECT_STORAGE) return deliverObjectStorageManifest(record, options, context);
  if (options.channel === DELIVERY_CHANNEL.WEBHOOK) return deliverWebhook(record, options, context);
  return {
    status: DELIVERY_STATUS.FAILED,
    externalRef: "",
    error: `unsupported delivery channel: ${options.channel}`,
    deliveryTarget: deliveryTargetPayload(options),
  };
}

async function deleteLifecycleExportObject(record, body = {}, context = {}) {
  const targetJson = record && record.delivery_target_json ? record.delivery_target_json : {};
  const objectKey = text(body.objectKey || body.object_key || targetJson.objectKey);
  if (!objectKey) {
    return {
      status: "SKIPPED",
      objectKey: "",
      externalRef: "",
      error: "objectKey not recorded",
      adapter: "",
      deleted: false,
    };
  }
  const options = resolveDeliveryOptions({
    deliveryEnabled: true,
    deliveryChannel: DELIVERY_CHANNEL.OBJECT_STORAGE,
    objectBaseUrl: targetJson.objectBaseUrl || "",
    objectBucket: targetJson.objectBucket || "",
    objectPrefix: targetJson.objectPrefix || "",
    objectProvider: targetJson.objectProvider || "",
    objectEnvId: targetJson.objectEnvId || "",
    ...body,
  }, context);
  const target = options.object || {};
  const adapter = resolveObjectStorageAdapter(options, context);
  if (!adapter || typeof adapter.deleteObject !== "function") {
    return {
      status: "SKIPPED",
      objectKey,
      externalRef: objectExternalRef(objectKey, target),
      error: "object storage delete adapter required",
      adapter: objectStorageAdapterLabel(target),
      deleted: false,
    };
  }
  try {
    const externalRef = text(
      body.objectFileId ||
      body.object_file_id ||
      targetJson.objectFileId ||
      record.delivery_external_ref,
    );
    const result = await deleteObject(adapter, {
      objectKey,
      externalRef,
      fileId: externalRef,
      metadata: buildDeliveryPayload(record, { ...options, includeCsv: false }, context),
    });
    return {
      status: "DELETED",
      objectKey,
      externalRef: result && result.externalRef ? result.externalRef : objectExternalRef(objectKey, target),
      error: "",
      adapter: objectStorageAdapterLabel(target),
      deleted: Boolean(result && result.deleted),
    };
  } catch (error) {
    return {
      status: "FAILED",
      objectKey,
      externalRef: objectExternalRef(objectKey, target),
      error: error.message || "object delete failed",
      adapter: objectStorageAdapterLabel(target),
      deleted: false,
    };
  }
}

module.exports = {
  DELIVERY_CHANNEL,
  DELIVERY_STATUS,
  applyApprovalDecision,
  buildDeliveryPayload,
  deleteLifecycleExportObject,
  deliverLifecycleExportRecord,
  initialDeliveryState,
  objectKeyForRecord,
  resolveDeliveryOptions,
  signatureForBody,
  signedDownloadPath,
  signedDownloadUrl,
  verifySignedDownload,
};
