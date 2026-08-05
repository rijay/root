const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createCloudbaseObjectStorageAdapter,
  normalizeProvider,
  normalizeTransport,
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

test("CloudBase object storage adapter preserves binary image bodies", async () => {
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  let observed;
  const adapter = createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE", envId: "myroot-prod" }, {
    cloudbaseAppFactory: () => ({
      async uploadFile({ fileContent }) {
        observed = fileContent;
        return { fileID: "cloud://myroot-prod.bucket/content-assets/test.png" };
      },
      async deleteFile() { return { fileList: [] }; },
    }),
  });

  await adapter.putObject({ objectKey: "content-assets/test.png", body: expected, contentType: "image/png" });
  assert.deepEqual(observed, expected);
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
  assert.equal(normalizeTransport("http-api"), "HTTP");
  assert.equal(createCloudbaseObjectStorageAdapter({ provider: "S3" }), null);
});

test("CloudBase HTTP object storage adapter signs, uploads, and deletes exactly one returned object", async () => {
  const calls = [];
  const objectKey = "release-probes/2026-07-12/object-probe.json";
  const fileId = `cloud://myroot-prod.bucket/${objectKey}`;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/storages/get-objects-upload-info")) {
      return new Response(JSON.stringify([{
        objectId: objectKey,
        uploadUrl: "https://myroot-prod.cos.ap-shanghai.myqcloud.com/signed-object",
        authorization: "q-sign-algorithm=sha1&q-ak=temporary",
        token: "temporary-session-token",
        cloudObjectMeta: "temporary-object-meta",
        cloudObjectId: fileId,
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://myroot-prod.cos.ap-shanghai.myqcloud.com/signed-object") {
      return new Response("", { status: 200 });
    }
    if (url.endsWith("/v1/storages/delete-objects")) {
      return new Response(JSON.stringify([{ cloudObjectId: fileId }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  const adapter = createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      ROOT_CLOUDBASE_STORAGE_TRANSPORT: "HTTP",
      CLOUDBASE_APIKEY: "server-api-key-with-admin-storage-permission",
    },
    fetchImpl,
  });

  const uploaded = await adapter.putObject({
    objectKey,
    body: "probe-body",
    contentType: "application/json; charset=utf-8",
  });
  const deleted = await adapter.deleteObject({
    objectKey,
    externalRef: uploaded.externalRef,
  });

  assert.equal(uploaded.fileId, fileId);
  assert.equal(deleted.deleted, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.headers.Authorization, "Bearer server-api-key-with-admin-storage-permission");
  assert.deepEqual(JSON.parse(calls[0].init.body), [{ objectId: objectKey }]);
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["X-Cos-Security-Token"], "temporary-session-token");
  assert.equal(calls[1].init.body.toString("utf8"), "probe-body");
  assert.deepEqual(JSON.parse(calls[2].init.body), [{ cloudObjectId: fileId }]);
});

test("CloudBase HTTP object storage adapter requires server credentials and fails closed on storage errors", async () => {
  assert.throws(() => createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      ROOT_CLOUDBASE_STORAGE_TRANSPORT: "HTTP",
    },
  }), /CLOUDBASE_APIKEY is required/);

  const uploadDenied = createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      CLOUDBASE_APIKEY: "server-api-key-with-admin-storage-permission",
    },
    fetchImpl: async () => new Response(JSON.stringify([{
      code: "STORAGE_EXCEED_AUTHORITY",
      message: "denied",
    }]), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(() => uploadDenied.putObject({ objectKey: "blocked.json", body: "x" }), (error) => {
    assert.equal(error.code, "STORAGE_EXCEED_AUTHORITY");
    return true;
  });

  const deleteMismatch = createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      CLOUDBASE_APIKEY: "server-api-key-with-admin-storage-permission",
    },
    fetchImpl: async () => new Response(JSON.stringify([{
      cloudObjectId: "cloud://myroot-prod.bucket/a-different-object.json",
    }]), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(() => deleteMismatch.deleteObject({
    objectKey: "probe.json",
    externalRef: "cloud://myroot-prod.bucket/probe.json",
  }), /did not confirm the requested fileID/);
});

test("CloudBase HTTP object storage adapter preserves the exact fileID when upload completion is ambiguous", async () => {
  const objectKey = "release-probes/2026-07-12/ambiguous.json";
  const fileId = `cloud://myroot-prod.bucket/${objectKey}`;
  let callCount = 0;
  const adapter = createCloudbaseObjectStorageAdapter({ provider: "CLOUDBASE" }, {
    env: {
      ROOT_CLOUDBASE_ENV_ID: "myroot-prod",
      CLOUDBASE_APIKEY: "server-api-key-with-admin-storage-permission",
    },
    fetchImpl: async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify([{
          objectId: objectKey,
          uploadUrl: "https://myroot-prod.cos.ap-shanghai.myqcloud.com/ambiguous",
          authorization: "q-sign-algorithm=sha1&q-ak=temporary",
          token: "temporary-session-token",
          cloudObjectMeta: "temporary-object-meta",
          cloudObjectId: fileId,
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("upstream timeout", { status: 504 });
    },
  });

  await assert.rejects(() => adapter.putObject({ objectKey, body: "probe" }), (error) => {
    assert.equal(error.code, "CLOUDBASE_UPLOAD_FAILED");
    assert.equal(error.fileId, fileId);
    assert.equal(error.externalRef, fileId);
    assert.equal(error.uploadMayHaveSucceeded, true);
    return true;
  });
});
