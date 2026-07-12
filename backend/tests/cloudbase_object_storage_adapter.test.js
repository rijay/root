const assert = require("node:assert/strict");
const test = require("node:test");
const lifecycleExportDelivery = require("../src/adminLifecycleExportDelivery");
const {
  createCloudbaseObjectStorageAdapter,
  normalizeProvider,
} = require("../src/cloudbaseObjectStorageAdapter");

test("CloudBase object storage adapter uploads and removes export objects", async () => {
  const calls = [];
  const app = {
    async uploadFile({ cloudPath, fileContent }) {
      calls.push({ action: "upload", cloudPath, body: fileContent.toString("utf8") });
      return { fileID: `cloud://myroot-prod.bucket/${cloudPath}` };
    },
    async deleteFile({ fileList }) {
      calls.push({ action: "remove", fileList });
      return { fileList: fileList.map((fileID) => ({ fileID, code: "SUCCESS" })) };
    },
  };
  const context = {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      ROOT_CLOUDBASE_REGION: "ap-shanghai",
    },
    cloudbaseAppFactory(config) {
      assert.deepEqual(config, { env: "myroot-prod", region: "ap-shanghai" });
      return app;
    },
  };
  const adapter = createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, context);
  const uploaded = await adapter.putObject({
    objectKey: "lifecycle-user-exports/export_1/users.csv",
    body: "user_id\nroot_1",
    contentType: "text/csv; charset=utf-8",
    metadata: {
      export: {
        exportId: "export_1",
        filename: "users.csv",
        sensitivity: "MASKED",
        expiresAt: "2026-07-18T00:00:00+08:00",
      },
    },
  });
  const deleted = await adapter.deleteObject({
    objectKey: "lifecycle-user-exports/export_1/users.csv",
    externalRef: uploaded.externalRef,
  });

  assert.equal(uploaded.externalRef, "cloud://myroot-prod.bucket/lifecycle-user-exports/export_1/users.csv");
  assert.equal(deleted.deleted, true);
  assert.equal(calls[0].action, "upload");
  assert.equal(calls[0].body, "user_id\nroot_1");
  assert.deepEqual(calls[1].fileList, [uploaded.externalRef]);
});

test("lifecycle export delivery selects CloudBase and records cleanup metadata", async () => {
  const removed = [];
  const context = {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER: "CLOUDBASE",
      ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX: "release-exports",
    },
    cloudbaseAppFactory() {
      return {
        async uploadFile({ cloudPath }) {
          return { fileID: `cloud://myroot-prod.bucket/${cloudPath}` };
        },
        async deleteFile({ fileList }) {
          removed.push(...fileList);
          return { fileList: fileList.map((fileID) => ({ fileID, code: "SUCCESS" })) };
        },
      };
    },
  };
  const record = {
    export_id: "export_cloudbase_1",
    filename: "root-users.csv",
    content_type: "text/csv; charset=utf-8",
    csv_text: "user_id\nroot_1",
    sensitivity: "MASKED",
    expires_at: "2026-07-18T00:00:00+08:00",
  };
  const delivered = await lifecycleExportDelivery.deliverLifecycleExportRecord(record, {
    deliveryChannel: "OBJECT_STORAGE",
  }, context);
  record.delivery_target_json = delivered.deliveryTarget;
  const deleted = await lifecycleExportDelivery.deleteLifecycleExportObject(record, {}, context);

  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.deliveryTarget.adapter, "CLOUDBASE");
  assert.equal(delivered.deliveryTarget.objectProvider, "CLOUDBASE");
  assert.equal(delivered.deliveryTarget.objectEnvId, "myroot-prod");
  assert.match(delivered.deliveryTarget.objectKey, /^release-exports\/export_cloudbase_1\//);
  assert.equal(delivered.deliveryTarget.objectFileId, `cloud://myroot-prod.bucket/${delivered.deliveryTarget.objectKey}`);
  assert.equal(deleted.status, "DELETED");
  assert.deepEqual(removed, [delivered.deliveryTarget.objectFileId]);
});

test("CloudBase object storage adapter fails closed on SDK errors", async () => {
  const adapter = createCloudbaseObjectStorageAdapter({ provider: "TCB", envId: "myroot-prod" }, {
    cloudbaseAppFactory: () => ({
      uploadFile: async () => ({ code: "STORAGE_DENIED", message: "denied" }),
      deleteFile: async () => ({ fileList: [] }),
    }),
  });

  await assert.rejects(() => adapter.putObject({ objectKey: "blocked.csv", body: "x" }), (error) => {
    assert.equal(error.code, "STORAGE_DENIED");
    assert.equal(error.message, "denied");
    return true;
  });
  await assert.rejects(
    () => adapter.deleteObject({ objectKey: "blocked.csv" }),
    /CloudBase fileID is required/,
  );
  assert.equal(normalizeProvider("cloud_base"), "CLOUDBASE");
  assert.equal(createCloudbaseObjectStorageAdapter({ provider: "S3" }), null);
});
