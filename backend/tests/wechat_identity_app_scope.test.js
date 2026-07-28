const assert = require("node:assert/strict");
const test = require("node:test");

const domain = require("../src/domain");
const { resolveWechatOpenidForApp } = require("../src/identity");

const localOpenidEnv = Object.freeze({
  NODE_ENV: "test",
  ROOT_ALLOW_OPENID_LOGIN: "true",
});
const requestDigestEnv = Object.freeze({
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "wechat-identity-authority-test-key-with-strong-entropy-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "wechat-identity-authority-test-v1",
});

async function localLogin(store, input) {
  return domain.loginWithWechat(store, input, localOpenidEnv);
}

async function trustedLogin(store, input, assertion) {
  return domain.loginWithWechat(store, input, {
    env: {
      NODE_ENV: "production",
      ROOT_WECHAT_APP_CODE: input.appCode || input.app_code || "MYROOT",
      ...requestDigestEnv,
    },
    trustedWechatIdentity: {
      source: "CLOUDBASE",
      appCode: input.appCode || input.app_code || "MYROOT",
      ...assertion,
    },
  });
}

test("the same openid string in different app codes creates distinct ROOT users", async () => {
  const store = domain.createStore();
  const myRoot = await localLogin(store, {
    openid: "same_openid_different_apps",
    appCode: "MYROOT",
  });
  const memberCenter = await localLogin(store, {
    openid: "same_openid_different_apps",
    appCode: "ROOT_MEMBER_CENTER",
  });

  assert.notEqual(myRoot.data.user.rootUserId, memberCenter.data.user.rootUserId);
  assert.equal(store.rootUsers.length, 2);
  assert.deepEqual(
    store.wechatIdentities.map((item) => [item.app_code, item.openid]).sort(),
    [
      ["MYROOT", "same_openid_different_apps"],
      ["ROOT_MEMBER_CENTER", "same_openid_different_apps"],
    ]
  );
});

test("a currently trusted unionid assertion can link identities across app codes", async () => {
  const store = domain.createStore();
  const myRoot = await trustedLogin(store, { appCode: "MYROOT" }, {
    openid: "myroot_openid_for_trusted_union",
    unionid: "trusted_cross_app_unionid",
  });
  const memberCenter = await trustedLogin(store, { appCode: "ROOT_MEMBER_CENTER" }, {
    openid: "member_center_openid_for_trusted_union",
    unionid: "trusted_cross_app_unionid",
  });

  assert.equal(myRoot.data.user.rootUserId, memberCenter.data.user.rootUserId);
  assert.equal(store.rootUsers.length, 1);
  assert.equal(store.wechatIdentities.length, 2);
  assert.equal(
    resolveWechatOpenidForApp(store, myRoot.data.user.rootUserId, "MYROOT"),
    "myroot_openid_for_trusted_union"
  );
  assert.equal(
    resolveWechatOpenidForApp(store, myRoot.data.user.rootUserId, "ROOT_MEMBER_CENTER"),
    "member_center_openid_for_trusted_union"
  );
});

test("an untrusted unionid claim cannot merge a second app identity", async () => {
  const store = domain.createStore();
  const myRoot = await localLogin(store, {
    openid: "myroot_untrusted_union_openid",
    unionid: "untrusted_cross_app_unionid",
    appCode: "MYROOT",
  });
  const memberCenter = await localLogin(store, {
    openid: "member_center_untrusted_union_openid",
    unionid: "untrusted_cross_app_unionid",
    appCode: "ROOT_MEMBER_CENTER",
  });

  assert.notEqual(myRoot.data.user.rootUserId, memberCenter.data.user.rootUserId);
  assert.equal(store.rootUsers.length, 2);
  const memberCenterIdentity = store.wechatIdentities.find((item) => item.app_code === "ROOT_MEMBER_CENTER");
  assert.equal(memberCenterIdentity.unionid, "");
  assert.equal(memberCenterIdentity.unionid_status, "PENDING");
});

test("a historical LINKED unionid without keyed provenance cannot own a trusted cross-app login", async () => {
  const store = domain.createStore();
  const poisoned = await localLogin(store, {
    openid: "historical_poison_openid",
    appCode: "MYROOT",
  });
  Object.assign(store.wechatIdentities[0], {
    unionid: "historical_poison_union",
    unionid_status: "LINKED",
    unionid_trust_status: "UNVERIFIED",
  });

  const trusted = await trustedLogin(store, { appCode: "ROOT_MEMBER_CENTER" }, {
    openid: "trusted_cross_app_after_poison",
    unionid: "historical_poison_union",
  });

  assert.notEqual(poisoned.data.user.rootUserId, trusted.data.user.rootUserId);
  assert.equal(store.wechatIdentities[0].unionid_trust_status, "UNVERIFIED");
  assert.equal(store.wechatIdentities[1].unionid_trust_status, "VERIFIED");
  assert.match(store.wechatIdentities[1].unionid_provenance_digest, /^[a-f0-9]{64}$/);
});

test("trusted conflicting identity facts fail closed instead of reassigning an app openid", async () => {
  const store = domain.createStore();
  const first = await trustedLogin(store, { appCode: "MYROOT" }, {
    openid: "conflict_app_openid",
    unionid: "trusted_union_owner_one",
  });
  const second = await trustedLogin(store, { appCode: "ROOT_MEMBER_CENTER" }, {
    openid: "conflict_member_openid",
    unionid: "trusted_union_owner_two",
  });
  assert.notEqual(first.data.user.rootUserId, second.data.user.rootUserId);

  await assert.rejects(
    () => trustedLogin(store, { appCode: "MYROOT" }, {
      openid: "conflict_app_openid",
      unionid: "trusted_union_owner_two",
    }),
    (error) => error.code === "WECHAT_IDENTITY_BINDING_CONFLICT" && error.status === 409
  );
  assert.equal(store.wechatIdentities.find((item) => item.openid === "conflict_app_openid").root_user_id, first.data.user.rootUserId);
});

test("app-scoped recipient resolution never falls back to a legacy openid", () => {
  const data = {
    users: [{
      user_id: "usr_legacy_only",
      root_user_id: "usr_legacy_only",
      app_code: "ROOT_MEMBER_CENTER",
      openid: "legacy_member_center_openid",
    }],
    wechatIdentities: [{
      wechat_identity_id: "wxi_member_only",
      root_user_id: "usr_legacy_only",
      app_code: "ROOT_MEMBER_CENTER",
      openid: "member_center_openid",
      last_seen_at: "2026-07-18T00:00:00.000Z",
    }, {
      wechat_identity_id: "wxi_missing_app_code",
      root_user_id: "usr_legacy_only",
      app_code: "",
      openid: "missing_scope_must_not_be_myroot",
      last_seen_at: "2026-07-19T00:00:00.000Z",
    }],
  };

  assert.equal(resolveWechatOpenidForApp(data, "usr_legacy_only", "MYROOT"), "");
  assert.equal(
    resolveWechatOpenidForApp(data, "usr_legacy_only", "ROOT_MEMBER_CENTER"),
    "member_center_openid"
  );
});

test("app-scoped recipient resolution fails closed when the root/app scope is ambiguous", () => {
  const data = {
    wechatIdentities: [{
      wechat_identity_id: "wxi_duplicate_1",
      root_user_id: "usr_duplicate",
      app_code: "MYROOT",
      openid: "duplicate_openid_1",
    }, {
      wechat_identity_id: "wxi_duplicate_2",
      root_user_id: "usr_duplicate",
      app_code: "MYROOT",
      openid: "duplicate_openid_2",
    }],
  };
  assert.throws(
    () => resolveWechatOpenidForApp(data, "usr_duplicate", "MYROOT"),
    (error) => error.code === "WECHAT_APP_IDENTITY_AMBIGUOUS"
  );
});
