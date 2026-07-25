const assert = require("node:assert/strict");
const test = require("node:test");

const { stampVerifiedWechatUnionId } = require("../src/wechatIdentityAuthority");
const {
  VERIFIED_UNIONID_RESOLUTION,
  listVerifiedWechatUnionIdAuthorities,
  resolveVerifiedWechatUnionIdOwnership,
} = require("../src/wechatUnionIdAuthority");
const { upsertYouzanCustomer } = require("../src/youzanCustomerMirror");
const { buildLifecycleWorkbench } = require("../src/adminLifecyclePresenter");
const { importExternalSamples } = require("../src/externalAdapterSamples");
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

function customerData(identities = []) {
  return {
    rootUsers: [
      { root_user_id: "root_authority_1" },
      { root_user_id: "root_authority_2" },
    ],
    users: [{
      user_id: "legacy_user_1",
      root_user_id: "root_authority_1",
      unionid: "legacy_unionid_must_not_authorize",
    }],
    wechatIdentities: identities,
    youzanCustomers: [],
    youzanOrders: [],
    userLifecycleEvents: [],
  };
}

test("Youzan customer mirror never treats legacy or UNVERIFIED UnionID as ownership", () => {
  const historical = verifiedIdentity();
  Object.assign(historical, {
    unionid_status: "PENDING",
    unionid_trust_status: "UNVERIFIED",
    unionid_provenance_source: "",
    unionid_verified_at: "",
    unionid_provenance_canonical_version: "",
    unionid_provenance_digest: "",
    unionid_provenance_digest_scheme: "",
    unionid_provenance_key_id: "",
  });
  const data = customerData([historical]);

  const historicalResult = upsertYouzanCustomer(data, {
    youzanYzUid: "yz_historical_unverified",
    unionid: historical.unionid,
  }, { env: ACTIVE_ENV });
  const legacyResult = upsertYouzanCustomer(data, {
    youzanYzUid: "yz_legacy_raw",
    unionid: "legacy_unionid_must_not_authorize",
  }, { env: ACTIVE_ENV });

  assert.equal(historicalResult.linked, false);
  assert.equal(legacyResult.linked, false);
  assert.equal(data.youzanCustomers.some((item) => item.root_user_id), false);
});

test("Youzan customer mirror uses verified unambiguous ownership and rejects tampered or ambiguous proof", () => {
  const verified = verifiedIdentity();
  const verifiedData = customerData([verified]);
  const linked = upsertYouzanCustomer(verifiedData, {
    youzanYzUid: "yz_verified",
    unionid: verified.unionid,
  }, { env: ACTIVE_ENV });
  assert.equal(linked.rootUserId, "root_authority_1");

  const tampered = { ...verified, unionid: "tampered_unionid" };
  const tamperedResult = upsertYouzanCustomer(customerData([tampered]), {
    youzanYzUid: "yz_tampered",
    unionid: tampered.unionid,
  }, { env: ACTIVE_ENV });
  assert.equal(tamperedResult.linked, false);

  const secondRoot = verifiedIdentity({
    wechat_identity_id: "wxi_authority_2",
    root_user_id: "root_authority_2",
    openid: "openid_authority_2",
  });
  const ambiguousResult = upsertYouzanCustomer(customerData([verified, secondRoot]), {
    youzanYzUid: "yz_ambiguous",
    unionid: verified.unionid,
  }, { env: ACTIVE_ENV });
  assert.equal(ambiguousResult.linked, false);
});

test("admin lifecycle presentation labels only verified keyed UnionID as LINKED", () => {
  const verified = verifiedIdentity();
  const historical = verifiedIdentity({
    wechat_identity_id: "wxi_admin_historical",
    root_user_id: "root_authority_2",
    openid: "openid_admin_historical",
    unionid: "unionid_admin_historical",
  });
  Object.assign(historical, {
    unionid_status: "PENDING",
    unionid_trust_status: "UNVERIFIED",
    unionid_provenance_source: "",
    unionid_verified_at: "",
    unionid_provenance_canonical_version: "",
    unionid_provenance_digest: "",
    unionid_provenance_digest_scheme: "",
    unionid_provenance_key_id: "",
  });
  const data = {
    users: [
      { user_id: "legacy_user_1", root_user_id: "root_authority_1", nickname: "Verified" },
      { user_id: "legacy_user_2", root_user_id: "root_authority_2", nickname: "Historical" },
    ],
    rootUsers: [
      { root_user_id: "root_authority_1" },
      { root_user_id: "root_authority_2" },
    ],
    wechatIdentities: [verified, historical],
  };

  const workbench = buildLifecycleWorkbench(data, {}, { env: ACTIVE_ENV });
  const byRoot = new Map(workbench.users.map((row) => [row.rootUserId, row]));
  assert.equal(workbench.metrics.unionidLinked, 1);
  assert.equal(workbench.metrics.pendingUnionid, 1);
  assert.equal(byRoot.get("root_authority_1").unionidStatus, "LINKED");
  assert.equal(byRoot.get("root_authority_2").unionidStatus, "PENDING");
  assert.equal(byRoot.get("root_authority_2").unionid, "");
});

test("WeWork lead import cannot elevate an unknown external identifier into internal user ownership", () => {
  const data = {
    users: [{ user_id: "usr_real_1", phone: "13800000000" }],
    identityLinks: [],
    leadProfiles: [],
    operationTasks: [],
  };
  const imported = importExternalSamples(data, "WECHAT_LEAD", [{
    userId: "raw_unionid_or_external_identifier",
    externalContactId: "wo_external_1",
    remarkName: "External lead",
  }], "2026-07-18");

  assert.equal(imported.importedCount, 1);
  assert.equal(data.leadProfiles[0].user_id, "");
  assert.equal(data.operationTasks[0].task_type, "LEAD_NEEDS_MATCHING");
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
