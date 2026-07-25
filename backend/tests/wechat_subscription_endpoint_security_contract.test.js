const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

test("domain delegates subscription sends and cannot rebuild configurable credential URLs", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/domain.js"), "utf8");
  assert.match(source, /wechatSubscribeMessageAdapter\.send\(/);
  assert.doesNotMatch(source, /ROOT_WECHAT_SUBSCRIBE_SEND_URL/);
  assert.doesNotMatch(source, /message\/subscribe\/send[^\n]{0,160}access_token/);
});

test("subscription Adapter validates before token acquisition and at the network seam", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/wechatSubscribeMessageAdapter.js"), "utf8");
  const endpointIndex = source.indexOf("resolveWechatSubscribeSendUrl(env)");
  const tokenIndex = source.indexOf("await resolveAccessToken(config)");
  const credentialValidationIndex = source.indexOf("assertWechatSubscribeCredentialTarget(credentialTarget, env)");
  const fetchIndex = source.indexOf("await fetchJson(credentialTarget");
  assert.ok(endpointIndex >= 0 && endpointIndex < tokenIndex);
  assert.ok(tokenIndex < credentialValidationIndex && credentialValidationIndex < fetchIndex);
});

test("server startup invokes the subscription endpoint configuration guard", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/server.js"), "utf8");
  assert.match(source, /assertWechatSubscriptionSendConfiguration\(process\.env\)/);
});
