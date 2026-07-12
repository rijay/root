function text(value) {
  return String(value || "").trim();
}

function normalizeProvider(value) {
  const normalized = text(value).toUpperCase();
  return ["CLOUDBASE", "TCB", "CLOUD_BASE"].includes(normalized) ? "CLOUDBASE" : "";
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

function createCloudbaseObjectStorageAdapter(target = {}, context = {}) {
  if (normalizeProvider(target.provider) !== "CLOUDBASE") return null;
  const env = context.env || process.env;
  const envId = text(target.envId || env.ROOT_CLOUDBASE_ENV_ID || env.CLOUDBASE_ENV_ID || env.TCB_ENV_ID);
  if (!envId) throw new Error("ROOT_CLOUDBASE_ENV_ID is required for CloudBase object storage");

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
      if (failed) {
        const itemError = new Error(failed.message || "CloudBase object delete failed");
        itemError.code = failed.code;
        throw itemError;
      }
      return {
        externalRef: targetFileId,
        fileId: targetFileId,
        objectKey,
        deleted: rows.length ? rows.every((row) => !row || !row.code || row.code === "SUCCESS") : true,
      };
    },
  };
}

module.exports = {
  createCloudbaseObjectStorageAdapter,
  normalizeProvider,
};
