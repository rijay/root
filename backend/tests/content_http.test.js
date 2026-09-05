const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createJsonFileStore } = require("../src/store");

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function testObjectStorageAdapter() {
  return {
    async putObject({ objectKey, body }) {
      assert.equal(Buffer.isBuffer(body), true);
      return { provider: "TEST", externalRef: `https://assets.root.test/${objectKey}` };
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function json(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

async function command(baseUrl, path, token, requestId, body) {
  return json(baseUrl, path, {
    method: "POST",
    headers: {
      "X-Admin-Token": token,
      "X-Request-Id": requestId,
      "X-Idempotency-Key": `${requestId}-intent`,
    },
    body: JSON.stringify(body),
  });
}

test("Content HTTP Interface saves, previews and publishes without exposing drafts publicly", async (t) => {
  const server = createApp({
    objectStorageAdapter: testObjectStorageAdapter(),
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        operator: { token: "content-operator-secret", role: "operator" },
        admin: { token: "content-admin-secret", role: "admin" },
      }),
      ROOT_CONTENT_WEBVIEW_HOSTS: JSON.stringify(["www.root.com"]),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const upload = async (scope, name, requestId) => (await command(
    baseUrl,
    "/api/v1/admin/content/assets",
    "content-operator-secret",
    requestId,
    { scope, name, mimeType: "image/png", dataBase64: PNG_1X1 },
  )).body.data.asset;
  const welcome1 = await upload("welcome-1", "welcome-1.png", "content-upload-w1");
  const welcome2 = await upload("welcome-2", "welcome-2.png", "content-upload-w2");
  const detailAsset = await upload("shared-detail", "detail.png", "content-upload-detail");
  const homeAsset = await upload("home-carousel", "home.png", "content-upload-home");

  await command(baseUrl, "/api/v1/admin/content/welcome/draft", "content-operator-secret", "content-w1", { slot: 1, copy: "欢迎加入 Root Member Club", assetId: welcome1.assetId });
  await command(baseUrl, "/api/v1/admin/content/welcome/draft", "content-operator-secret", "content-w2", { slot: 2, copy: "平衡不是控制，而是理解。", assetId: welcome2.assetId });
  const detail = await command(baseUrl, "/api/v1/admin/content/shared-details/draft", "content-operator-secret", "content-detail", {
    title: "Root Foundation",
    assets: [{ assetId: detailAsset.assetId, order: 1, hotspots: [] }],
  });
  assert.equal(detail.status, 200);
  await command(baseUrl, "/api/v1/admin/content/home-carousel/draft", "content-operator-secret", "content-home", {
    order: 1,
    internalName: "首屏品牌内容",
    kicker: "ROOT WITH YOU",
    copy: "把每天的选择，\n还给身体自己的节奏",
    assetId: homeAsset.assetId,
    lineCount: 2,
    fontSize: "LARGE",
    alignment: "CENTER",
    sharedDetailVersionId: detail.body.data.version.versionId,
    scheduleRange: ["2026-08-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"],
  });

  assert.equal((await json(baseUrl, "/api/v1/public/content/home")).body.data.items.length, 0);
  const release = await json(baseUrl, "/api/v1/admin/release-record", { headers: { "X-Admin-Token": "content-admin-secret" } });
  const candidate = release.body.data.contentRelease.candidateVersion;
  assert.equal(release.body.data.contentRelease.blockerCount, 0);

  await command(baseUrl, "/api/v1/admin/content-release/preview-complete", "content-admin-secret", "content-preview", { version: candidate });
  const published = await command(baseUrl, "/api/v1/admin/content-release/publish", "content-admin-secret", "content-publish", {
    version: candidate,
    confirmed: true,
    confirmationText: "确认发布内容",
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.data.publishedCount, 4);

  const home = await json(baseUrl, "/api/v1/public/content/home");
  assert.equal(home.body.data.items.length, 1);
  assert.equal(home.body.data.items[0].kicker, "ROOT WITH YOU");
  const welcome = await json(baseUrl, "/api/v1/public/content/welcome");
  assert.equal(welcome.body.data.screens.length, 2);
  assert.equal(server.store.auditLogs.some((entry) => entry.action === "CONTENT_RELEASE_PUBLISH"), true);

  assert.match(home.body.data.items[0].coverAssetUrl, /^https:\/\/assets\.root\.test\/content-assets\//);
  assert.equal(server.store.contentAssets.every((asset) => !asset.data_base64), true);
});

test("content drafts and authorized assets survive a persistent Store Adapter reload", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-content-store-"));
  const storePath = path.join(tempDir, "store.json");
  try {
    const firstStore = createJsonFileStore(storePath, { seedSampleData: false });
    const server = createApp({
      storeAdapter: firstStore,
      objectStorageAdapter: testObjectStorageAdapter(),
      env: { ROOT_ADMIN_TOKENS: JSON.stringify({ operator: { token: "persistent-content-secret", role: "operator" } }) },
    });
    const baseUrl = await listen(server);
    const uploaded = await command(baseUrl, "/api/v1/admin/content/assets", "persistent-content-secret", "persistent-content-upload", {
      scope: "welcome-1",
      name: "welcome.png",
      mimeType: "image/png",
      dataBase64: PNG_1X1,
    });
    assert.equal(uploaded.status, 200);
    const saved = await command(baseUrl, "/api/v1/admin/content/welcome/draft", "persistent-content-secret", "persistent-content-save", {
      slot: 1,
      copy: "欢迎加入 Root Member Club",
      assetId: uploaded.body.data.asset.assetId,
    });
    assert.equal(saved.status, 200);
    await new Promise((resolve) => server.close(resolve));

    const reloaded = createJsonFileStore(storePath, { seedSampleData: false });
    assert.equal(reloaded.data.contentAssets.length, 1);
    assert.equal(reloaded.data.contentAssets[0].data_base64, undefined);
    assert.match(reloaded.data.contentAssets[0].storage_external_ref, /^https:\/\/assets\.root\.test\//);
    assert.equal(reloaded.data.contentVersions.length, 1);
    assert.equal(reloaded.data.contentVersions[0].content.copy, "欢迎加入 Root Member Club");
    assert.equal(reloaded.validateSnapshot().valid, true);
  } finally {
    assert.equal(tempDir.startsWith(`${os.tmpdir()}${path.sep}`), true);
    fs.rmSync(tempDir, { recursive: true });
  }
});
