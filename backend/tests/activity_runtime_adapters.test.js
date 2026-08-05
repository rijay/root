const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createEnvironmentActivityPublicationAuthorizationAdapter,
} = require("../src/activityPublicationAuthorizationAdapter");
const { createDataBackedActivityAssetAdapter } = require("../src/activityAssetAdapter");

const APPROVAL = Object.freeze({
  activityVersionId: "activity_v1",
  activityId: "activity",
  principalOperatorId: "admin",
  publishOwnerSignerRef: "admin",
  controlledApprovalRef: "APPROVAL_001",
  contentAuthorizationDigest: "1".repeat(64),
  uedAcceptanceDigest: "2".repeat(64),
  photographyAuthorizationDigest: "3".repeat(64),
  artifactProvenanceDigest: "4".repeat(64),
});

function authorizationRequest(overrides = {}) {
  return {
    operation: "ACTIVITY_PUBLISH",
    activity: { activityVersionId: "activity_v1", activityId: "activity" },
    principal: { operatorId: "admin", role: "admin", tokenConfigured: true },
    evidence: {
      controlledApprovalRef: APPROVAL.controlledApprovalRef,
      contentAuthorizationDigest: APPROVAL.contentAuthorizationDigest,
      uedAcceptanceDigest: APPROVAL.uedAcceptanceDigest,
      photographyAuthorizationDigest: APPROVAL.photographyAuthorizationDigest,
      artifactProvenanceDigest: APPROVAL.artifactProvenanceDigest,
    },
    requestId: "request_001",
    ...overrides,
  };
}

test("environment publication Adapter authorizes only an exact approved activity and principal", () => {
  const adapter = createEnvironmentActivityPublicationAuthorizationAdapter({
    ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON: JSON.stringify([APPROVAL]),
  }, { now: () => "2026-08-05T13:00:00.000Z" });
  const decision = adapter.authorizeActivityPublication(authorizationRequest());
  assert.equal(decision.authorized, true);
  assert.equal(decision.adapterId, "ROOT_ACTIVITY_APPROVAL_LEDGER_V1");
  assert.equal(decision.publishOwnerSignerRef, "admin");
  assert.equal(decision.verifiedAt, "2026-08-05T13:00:00.000Z");
  assert.equal(adapter.authorizeActivityPublication(authorizationRequest({
    principal: { operatorId: "another-admin", role: "admin", tokenConfigured: true },
  })).authorized, false);
  assert.equal(adapter.authorizeActivityPublication(authorizationRequest({
    evidence: { ...authorizationRequest().evidence, artifactProvenanceDigest: "5".repeat(64) },
  })).authorized, false);
});

test("environment publication Adapter emits a command-safe verification instant by default", () => {
  const before = Date.now();
  const adapter = createEnvironmentActivityPublicationAuthorizationAdapter({
    ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON: JSON.stringify([APPROVAL]),
  });
  const decision = adapter.authorizeActivityPublication(authorizationRequest());
  const verifiedAt = Date.parse(decision.verifiedAt);
  assert.ok(Number.isFinite(verifiedAt));
  assert.ok(verifiedAt <= before);
  assert.ok(before - verifiedAt < 5_000);
});

test("environment publication Adapter rejects malformed configuration at startup", () => {
  assert.throws(
    () => createEnvironmentActivityPublicationAuthorizationAdapter({
      ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON: "not-json",
    }),
    /must be valid JSON/
  );
  assert.throws(
    () => createEnvironmentActivityPublicationAuthorizationAdapter({
      ROOT_ACTIVITY_PUBLICATION_APPROVALS_JSON: JSON.stringify([{ ...APPROVAL, publishOwnerSignerRef: "other" }]),
    }),
    /signer must match principal/
  );
});

test("activity asset Adapter exposes only authorized content assets", () => {
  const data = {
    contentAssets: [
      {
        content_asset_id: "asset_001",
        state: "AUTHORIZED",
        storage_external_ref: "cloud://root-prod.bucket/content-assets/asset_001.jpg",
      },
      {
        content_asset_id: "asset_blocked",
        state: "BLOCKED",
        storage_external_ref: "https://example.com/blocked.jpg",
      },
    ],
  };
  const adapter = createDataBackedActivityAssetAdapter({ dataProvider: () => data });
  assert.deepEqual(adapter.resolvePublicAsset({ assetRef: "asset_001" }), {
    url: "cloud://root-prod.bucket/content-assets/asset_001.jpg",
  });
  assert.equal(adapter.resolvePublicAsset({ assetRef: "asset_blocked" }), null);
  assert.equal(adapter.resolvePublicAsset({ assetRef: "missing" }), null);
});
