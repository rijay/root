const assert = require("node:assert/strict");
const test = require("node:test");

const { stampVerifiedWechatUnionId } = require("../src/wechatIdentityAuthority");
const {
  VERIFIED_UNIONID_RESOLUTION,
  listVerifiedWechatUnionIdAuthorities,
  resolveVerifiedWechatUnionIdOwnership,
} = require("../src/wechatUnionIdAuthority");
const domain = require("../src/domain");

const ACTIVE_ENV = Object.freeze({
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "unionid-authority-current-secret-with-strong-entropy-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "unionid-authority-current-v2",
});

function verifiedIdentity(overrides = {}, env = ACTIVE_ENV) {
  return stampVerifiedWechatUnionId({
    wechat_identity_id: overrides.wechat_identity_id || "wxi_authority_1",
    root_user_id: overrides.root_user_id || "root_authority_1",
    app_code: overrides.app_code || "MYROOT",
    openid: overrides.openid || "openid_authority_1",
    unionid: overrides.unionid || "unionid_authority_1",
  }, {
    source: "CLOUDBASE",
    verifiedAt: "2026-07-18T00:00:00.000Z",
  }, { env });
}

test("UnionID Authority accepts only keyed VERIFIED provenance", () => {
  const verified = verifiedIdentity();
  const historical = {
    ...verified,
    wechat_identity_id: "wxi_historical",
    openid: "openid_historical",
    unionid_trust_status: "UNVERIFIED",
    unionid_status: "PENDING",
    unionid_provenance_source: "",
    unionid_verified_at: "",
    unionid_provenance_canonical_version: "",
    unionid_provenance_digest: "",
    unionid_provenance_digest_scheme: "",
    unionid_provenance_key_id: "",
  };
  const tampered = { ...verified, wechat_identity_id: "wxi_tampered", unionid: "unionid_tampered" };

  assert.deepEqual(
    listVerifiedWechatUnionIdAuthorities([historical, tampered, verified], { env: ACTIVE_ENV })
      .map((item) => item.identity.wechat_identity_id),
    ["wxi_authority_1"]
  );
  assert.equal(
    resolveVerifiedWechatUnionIdOwnership([historical, tampered], "unionid_authority_1", { env: ACTIVE_ENV }).status,
    VERIFIED_UNIONID_RESOLUTION.NOT_VERIFIED
  );
});

test("UnionID Authority rejects unknown and retired provenance keys", () => {
  const previousEnv = {
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "unionid-authority-previous-secret-with-strong-entropy-2025",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "unionid-authority-previous-v1",
  };
  const stored = verifiedIdentity({}, previousEnv);
  const unknown = resolveVerifiedWechatUnionIdOwnership([stored], stored.unionid, { env: ACTIVE_ENV });
  const retired = resolveVerifiedWechatUnionIdOwnership([stored], stored.unionid, {
    env: {
      ...ACTIVE_ENV,
      ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
        REQUEST_DIGEST: [previousEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID],
        COMMAND_RESULT: [],
        INBOX_CONTENT: [],
        NOTIFICATION_RECEIPT: [],
      }),
    },
  });

  assert.equal(unknown.status, VERIFIED_UNIONID_RESOLUTION.NOT_VERIFIED);
  assert.equal(retired.status, VERIFIED_UNIONID_RESOLUTION.NOT_VERIFIED);
});

test("UnionID Authority fails closed when verified provenance points to multiple roots", () => {
  const first = verifiedIdentity();
  const second = verifiedIdentity({
    wechat_identity_id: "wxi_authority_2",
    root_user_id: "root_authority_2",
    openid: "openid_authority_2",
  });
  const result = resolveVerifiedWechatUnionIdOwnership([first, second], first.unionid, { env: ACTIVE_ENV });

  assert.equal(result.status, VERIFIED_UNIONID_RESOLUTION.AMBIGUOUS);
  assert.equal(result.rootUserId, "");
  assert.deepEqual(result.rootUserIds, ["root_authority_1", "root_authority_2"]);
});

test("user state ignores legacy LINKED flags and exposes LINKED only for unambiguous keyed provenance", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, { appCode: "MYROOT" }, {
    env: { ...ACTIVE_ENV, NODE_ENV: "production", ROOT_WECHAT_APP_CODE: "MYROOT" },
    trustedWechatIdentity: {
      source: "CLOUDBASE",
      appCode: "MYROOT",
      openid: "openid_user_state_1",
      unionid: "unionid_user_state_1",
    },
  });
  const user = store.users.find((item) => item.user_id === login.data.user.userId);
  const identity = store.wechatIdentities.find((item) => item.root_user_id === login.data.user.rootUserId);

  assert.equal(login.data.user.unionidStatus, "LINKED");
  assert.equal(domain.getUserState(store, login.data.token, { env: ACTIVE_ENV }).data.identity.unionidStatus, "LINKED");

  identity.unionid = "tampered_user_state_unionid";
  user.unionid = "legacy_raw_unionid";
  user.unionid_status = "LINKED";
  const tampered = domain.getUserState(store, login.data.token, { env: ACTIVE_ENV }).data;
  assert.equal(tampered.user.unionidStatus, "PENDING");
  assert.equal(tampered.identity.unionidStatus, "PENDING");
  assert.equal(JSON.stringify(tampered).includes("legacy_raw_unionid"), false);
  assert.equal(JSON.stringify(tampered).includes("tampered_user_state_unionid"), false);
});
