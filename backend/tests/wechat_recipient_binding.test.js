const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeStoreData } = require("../src/store");
const {
  validateRecipientBindingCollection,
} = require("../src/wechatRecipientBinding");

const VERIFIED_BINDING = Object.freeze({
  recipient_binding_status: "VERIFIED",
  recipient_wechat_identity_id: "wxi_binding_test_1",
  recipient_app_code: "MYROOT",
  recipient_binding_canonical_version: "canonical-json:v1",
  recipient_binding_digest: "a".repeat(64),
  recipient_binding_digest_scheme: "hmac-sha256:v1",
  recipient_binding_key_id: "recipient-binding-test-v1",
});

function grant(status, binding = {}) {
  return {
    notification_subscription_grant_id: `nsg_${status.toLowerCase()}`,
    status,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:01:00.000Z",
    ...binding,
  };
}

test("historical grants without recipient provenance are fenced for review at every lifecycle phase", () => {
  for (const historicalStatus of ["AVAILABLE", "RESERVED", "CONSUMED", "INVALIDATED"]) {
    const normalized = normalizeStoreData({
      notificationSubscriptionGrants: [grant(historicalStatus)],
    }, { seedSampleData: false });
    const [item] = normalized.notificationSubscriptionGrants;
    assert.equal(item.status, "REVIEW_REQUIRED");
    assert.equal(item.recipient_binding_status, "UNVERIFIED");
    assert.equal(item.release_reason, "RECIPIENT_BINDING_UNVERIFIED");
    assert.equal(item.review_required_at, "2026-07-18T00:01:00.000Z");
    assert.equal(validateRecipientBindingCollection([item]).valid, true);
  }
});

test("UNVERIFIED is review-only while VERIFIED binding survives all lifecycle statuses", () => {
  const unverifiedTerminal = grant("CONSUMED", {
    recipient_binding_status: "UNVERIFIED",
  });
  assert.deepEqual(validateRecipientBindingCollection([unverifiedTerminal]), {
    valid: false,
    errors: ["unverified recipient must require review: nsg_consumed"],
  });

  for (const status of ["AVAILABLE", "RESERVED", "CONSUMED", "INVALIDATED", "REVIEW_REQUIRED"]) {
    const verified = grant(status, VERIFIED_BINDING);
    assert.equal(validateRecipientBindingCollection([verified]).valid, true);
    assert.deepEqual(
      Object.fromEntries(Object.keys(VERIFIED_BINDING).map((key) => [key, verified[key]])),
      VERIFIED_BINDING
    );
  }
});
