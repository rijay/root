function text(value) {
  return String(value || "").trim();
}

function normalizeProvider(value) {
  const normalized = text(value).toUpperCase();
  return ["CLOUDBASE", "TCB", "CLOUD_BASE"].includes(normalized) ? "CLOUDBASE" : "";
}

function normalizeTransport(value) {
  const normalized = text(value).toUpperCase().replace(/-/g, "_");
  if (["HTTP", "HTTP_API"].includes(normalized)) return "HTTP";
  if (["SDK", "NODE_SDK"].includes(normalized)) return "NODE_SDK";
  return "";
}

function defaultAppFactory(config) {
  const cloudbase = require("@cloudbase/node-sdk");
  return cloudbase.init(config);
}

function resultError(result, fallback) {
  if (!result || !result.code || result.code === "SUCCESS") return null;
  const error = new Error(result.message || fallback);
  error.code = result.code;
  return error;
}

function cloudbaseError(code, message, fallback) {
  const error = new Error(text(message) || fallback);
  if (code) error.code = code;
  return error;
}

function withUploadReference(error, fileId, objectKey) {
  error.externalRef = fileId;
  error.fileId = fileId;
  error.objectKey = objectKey;
  error.uploadMayHaveSucceeded = true;
  return error;
}

function timeoutValue(value, fallback = 15000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1000, Math.min(30000, Math.floor(numeric)));
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createNodeSdkAdapter(envId, env, context) {
  const appFactory = context.cloudbaseAppFactory || defaultAppFactory;
  let app;
  function cloudbaseApp() {
    if (app) return app;
    app = appFactory({ env: envId, ...(env.ROOT_CLOUDBASE_REGION ? { region: env.ROOT_CLOUDBASE_REGION } : {}) });
    if (!app || typeof app.uploadFile !== "function" || typeof app.deleteFile !== "function") {
      throw new Error("CloudBase Node SDK storage Interface is unavailable");
    }
    return app;
  }

  return {
    async putObject({ objectKey, body }) {
      const result = await cloudbaseApp().uploadFile({
        cloudPath: objectKey,
        fileContent: Buffer.from(String(body || ""), "utf8"),
      });
      const error = resultError(result, "CloudBase object upload failed");
      if (error) throw error;
      const fileId = text(result && (result.fileID || result.fileId));
      if (!fileId) throw new Error("CloudBase object upload did not return fileID");
      return {
        externalRef: fileId,
        fileId,
        objectKey,
        uploadConfirmed: true,
      };
    },

    async deleteObject({ objectKey, externalRef, fileId }) {
      const targetFileId = text(fileId || externalRef);
      if (!targetFileId.startsWith("cloud://")) {
        throw new Error("CloudBase fileID is required for object delete");
      }
      const result = await cloudbaseApp().deleteFile({ fileList: [targetFileId] });
      const error = resultError(result, "CloudBase object delete failed");
      if (error) throw error;
      const rows = Array.isArray(result && result.fileList) ? result.fileList : [];
      const failed = rows.find((row) => row && row.code && row.code !== "SUCCESS");
      if (failed) throw cloudbaseError(failed.code, failed.message, "CloudBase object delete failed");
      return {
        externalRef: targetFileId,
        fileId: targetFileId,
        objectKey,
        deleted: rows.length ? rows.every((row) => !row || !row.code || row.code === "SUCCESS") : true,
      };
    },
  };
}

function createHttpAdapter(envId, env, target, context) {
  const accessToken = text(
    target.accessToken ||
    target.apiKey ||
    env.ROOT_CLOUDBASE_API_KEY ||
    env.CLOUDBASE_APIKEY,
  );
  if (!accessToken) {
    throw new Error("CLOUDBASE_APIKEY is required for CloudBase HTTP object storage");
  }
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable for CloudBase HTTP object storage");
  const baseUrl = text(target.apiBaseUrl || env.ROOT_CLOUDBASE_STORAGE_API_BASE_URL) ||
    `https://${envId}.api.tcloudbasegateway.com`;
  const timeoutMs = timeoutValue(target.timeoutMs || env.ROOT_CLOUDBASE_STORAGE_TIMEOUT_MS);

  async function post(path, payload) {
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, timeoutMs);
    const body = await responseBody(response);
    if (!response.ok) {
      throw cloudbaseError(body && body.code, body && body.message, `CloudBase storage HTTP ${response.status}`);
    }
    if (!Array.isArray(body)) throw new Error("CloudBase storage HTTP response must be an array");
    return body;
  }

  return {
    async putObject({ objectKey, body, contentType }) {
      const rows = await post("/v1/storages/get-objects-upload-info", [{ objectId: objectKey }]);
      const upload = rows[0] || {};
      if (upload.code) throw cloudbaseError(upload.code, upload.message, "CloudBase upload authorization failed");
      const uploadUrl = text(upload.uploadUrl);
      const authorization = text(upload.authorization);
      const token = text(upload.token);
      const cloudObjectMeta = text(upload.cloudObjectMeta);
      const fileId = text(upload.cloudObjectId);
      if (!uploadUrl || !authorization || !token || !cloudObjectMeta || !fileId.startsWith("cloud://")) {
        throw new Error("CloudBase upload authorization response is incomplete");
      }
      const parsedUploadUrl = new URL(uploadUrl);
      if (parsedUploadUrl.protocol !== "https:") throw new Error("CloudBase upload URL must use HTTPS");
      let uploadResponse;
      try {
        uploadResponse = await fetchWithTimeout(fetchImpl, uploadUrl, {
          method: "PUT",
          headers: {
            Authorization: authorization,
            "X-Cos-Security-Token": token,
            "X-Cos-Meta-Fileid": cloudObjectMeta,
            ...(contentType ? { "Content-Type": contentType } : {}),
          },
          body: Buffer.from(String(body || ""), "utf8"),
        }, timeoutMs);
      } catch (error) {
        throw withUploadReference(error, fileId, objectKey);
      }
      if (!uploadResponse.ok) {
        throw withUploadReference(
          cloudbaseError("CLOUDBASE_UPLOAD_FAILED", "", `CloudBase object upload failed with HTTP ${uploadResponse.status}`),
          fileId,
          objectKey,
        );
      }
      return {
        externalRef: fileId,
        fileId,
        objectKey,
        uploadConfirmed: true,
      };
    },

    async deleteObject({ objectKey, externalRef, fileId }) {
      const targetFileId = text(fileId || externalRef);
      if (!targetFileId.startsWith("cloud://")) {
        throw new Error("CloudBase fileID is required for object delete");
      }
      const rows = await post("/v1/storages/delete-objects", [{ cloudObjectId: targetFileId }]);
      const removed = rows[0] || {};
      if (removed.code === "OBJECT_NOT_EXIST") {
        return {
          externalRef: targetFileId,
          fileId: targetFileId,
          objectKey,
          deleted: true,
          alreadyMissing: true,
        };
      }
      if (removed.code) throw cloudbaseError(removed.code, removed.message, "CloudBase object delete failed");
      if (text(removed.cloudObjectId) !== targetFileId) {
        throw new Error("CloudBase object delete did not confirm the requested fileID");
      }
      return {
        externalRef: targetFileId,
        fileId: targetFileId,
        objectKey,
        deleted: true,
      };
    },
  };
}

function createCloudbaseObjectStorageAdapter(target = {}, context = {}) {
  if (normalizeProvider(target.provider) !== "CLOUDBASE") return null;
  const env = context.env || process.env;
  const envId = text(target.envId || env.ROOT_CLOUDBASE_ENV_ID || env.CLOUDBASE_ENV_ID || env.TCB_ENV_ID);
  if (!envId) throw new Error("ROOT_CLOUDBASE_ENV_ID is required for CloudBase object storage");

  const transport = normalizeTransport(target.transport || env.ROOT_CLOUDBASE_STORAGE_TRANSPORT);
  const accessToken = text(target.accessToken || target.apiKey || env.ROOT_CLOUDBASE_API_KEY || env.CLOUDBASE_APIKEY);
  const sdkRuntimeCredentialPresent = Boolean(
    context.cloudbaseAppFactory ||
    env.TCB_CONTEXT_KEYS ||
    (env.TENCENTCLOUD_SECRETID && env.TENCENTCLOUD_SECRETKEY),
  );
  if (transport === "NODE_SDK" || (!transport && !accessToken && sdkRuntimeCredentialPresent)) {
    return createNodeSdkAdapter(envId, env, context);
  }
  return createHttpAdapter(envId, env, target, context);
}

module.exports = {
  createCloudbaseObjectStorageAdapter,
  normalizeProvider,
  normalizeTransport,
};
