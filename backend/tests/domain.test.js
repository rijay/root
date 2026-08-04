const test = require("node:test");
const assert = require("node:assert/strict");

const domain = require("../src/domain");
const { sessionTokenDigest } = require("../src/credentialProtection");

test("production phone login requires WeChat server credentials", async () => {
  const store = domain.createStore();
  await assert.rejects(
    () => domain.loginWithWechat(store, { wxCode: "wx_code", phoneCode: "phone_code" }),
    /服务端未配置微信登录密钥/
  );
});

test("phone login stores optional WeChat display profile", () => {
  const store = domain.createStore();
  const first = domain.login(store, {
    phone: "13800000001",
    nickname: "Root小路",
    avatarUrl: "https://thirdwx.qlogo.cn/avatar.png",
  }).data.user;

  assert.equal(first.nickname, "Root小路");
  assert.equal(first.avatarUrl, "https://thirdwx.qlogo.cn/avatar.png");

  const fallback = domain.login(store, { phone: "13800000002", nickname: "微信用户", avatarUrl: "file://local" }).data.user;
  assert.equal(fallback.nickname, "ROOT体验官");
  assert.equal(fallback.avatarUrl, "");

  const updated = domain.login(store, {
    phone: "13800000001",
    nickname: "Root体验同学",
    avatarUrl: "https://thirdwx.qlogo.cn/new-avatar.png",
  }).data.user;
  assert.equal(updated.nickname, "Root体验同学");
  assert.equal(updated.avatarUrl, "https://thirdwx.qlogo.cn/new-avatar.png");
});

test("phone login issues a persisted session with explicit expiry", () => {
  const store = domain.createStore();
  const login = domain.login(store, { phone: "13800000001" }).data;

  assert.match(login.token, /^root_/);
  assert.match(login.session.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].token, undefined);
  assert.equal(store.sessions[0].token_hash, sessionTokenDigest(login.token));
  assert.equal(domain.getUserState(store, login.token).data.user.phone, "138****0001");

  store.sessions[0].expires_at = "2000-01-01T00:00:00+08:00";
  assert.throws(() => domain.getUserState(store, login.token), /登录已过期/);
  assert.equal(Boolean(store.sessions[0].revoked_at), true);
  assert.equal(store.tokens[sessionTokenDigest(login.token)], undefined);
});

test("cloudbase identity probe reports masked header status without raw identities", () => {
  const rawOpenid = "openid_probe_1234567890";
  const rawUnionid = "unionid_probe_abcdef1234";
  const ready = domain.getCloudbaseIdentityProbe({
    headers: {
      "x-wx-openid": rawOpenid,
      "x-wx-unionid": rawUnionid,
      "x-root-app-code": "root_member_center",
    },
    trustedWechatIdentity: {
      openid: rawOpenid,
      unionid: rawUnionid,
      appCode: "ROOT_MEMBER_CENTER",
      source: "CLOUDBASE",
    },
  }).data;
  const pending = domain.getCloudbaseIdentityProbe({
    headers: { "x-wx-openid": "openid_only_probe_1234" },
    trustedWechatIdentity: {
      openid: "openid_only_probe_1234",
      unionid: "",
      appCode: "MYROOT",
      source: "CLOUDBASE",
    },
  }).data;
  const rawHeaderOnly = domain.getCloudbaseIdentityProbe({
    headers: { "x-wx-openid": "untrusted_openid_probe" },
  }).data;
  const blocked = domain.getCloudbaseIdentityProbe({ headers: {} }).data;

  assert.equal(ready.status, "READY");
  assert.equal(ready.appCode, "ROOT_MEMBER_CENTER");
  assert.equal(ready.readyForUnionPrimaryKey, true);
  assert.equal(ready.openidPresent, true);
  assert.equal(ready.unionidPresent, true);
  assert.notEqual(ready.openidPreview, rawOpenid);
  assert.notEqual(ready.unionidPreview, rawUnionid);
  assert.equal(JSON.stringify(ready).includes(rawOpenid), false);
  assert.equal(JSON.stringify(ready).includes(rawUnionid), false);
  assert.ok(ready.checks.some((item) => item.id === "privacy_guard" && item.status === "PASS"));
  assert.equal(pending.status, "UNIONID_PENDING");
  assert.equal(pending.readyForUnionPrimaryKey, false);
  assert.equal(rawHeaderOnly.status, "BLOCKED");
  assert.equal(rawHeaderOnly.openidPresent, false);
  assert.equal(rawHeaderOnly.rawOpenidHeaderObserved, true);
  assert.ok(rawHeaderOnly.checks.some((item) => item.id === "trusted_identity" && item.status === "BLOCKER"));
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.checks.some((item) => item.id === "trusted_identity" && item.status === "BLOCKER"));
});

test("openid login creates root identity without requiring an order or phone", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "myroot_openid_without_phone",
    appCode: "MYROOT",
    sourceChannel: "ROADSHOW_QR",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const state = domain.getUserState(store, login.data.token).data;

  assert.equal(login.data.user.rootUserId, login.data.user.userId);
  assert.equal(login.data.user.phone, "");
  assert.equal(login.data.user.unionidStatus, "PENDING");
  assert.equal(login.data.nextRoute, "/pages/register/index");
  assert.equal(login.data.sessionOutcome, "NEW_USER");
  assert.equal(store.rootUsers.length, 1);
  assert.equal(store.wechatIdentities.length, 1);
  assert.equal(store.wechatIdentities[0].openid, "myroot_openid_without_phone");
  assert.equal(store.wechatIdentities[0].app_code, "MYROOT");
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "ROOT_USER_CREATED"), true);
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "WECHAT_LOGIN"), true);
  assert.equal(state.route, "/pages/register/index");
  assert.equal(state.sessionOutcome, "PROFILE_REQUIRED");
});

test("same openid can attach phone evidence without creating a second root user", async () => {
  const store = domain.createStore();
  const first = await domain.loginWithWechat(store, {
    openid: "myroot_openid_attach_phone",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const second = domain.login(store, {
    openid: "myroot_openid_attach_phone",
    appCode: "MYROOT",
    phone: "13800006666",
  }).data;

  assert.equal(second.user.userId, first.data.user.userId);
  assert.equal(store.rootUsers.length, 1);
  assert.equal(store.wechatIdentities.length, 1);
  assert.equal(store.userContactMethods.length, 1);
  assert.equal(store.userContactMethods[0].root_user_id, first.data.user.rootUserId);
  assert.equal(store.userContactMethods[0].phone_masked, "138****6666");
});
