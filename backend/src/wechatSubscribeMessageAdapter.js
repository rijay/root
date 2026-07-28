const { fetchWechatJson } = require("./wechatHttp");
const { resolveWechatAccessToken } = require("./wechatAccessToken");
const {
  assertWechatSubscribeCredentialTarget,
  resolveWechatSubscribeSendUrl,
} = require("./wechatOpenApiEndpoint");

function configurationError() {
  const error = new Error("微信订阅消息发送配置缺失");
  error.code = "WECHAT_SUBSCRIBE_CONFIG_MISSING";
  error.deliveryOutcome = "NOT_SENT";
  return error;
}

function knownNotSent(error) {
  error.deliveryOutcome = "NOT_SENT";
  return error;
}

function assertWechatSubscriptionSendConfiguration(env = process.env) {
  const enabled = String(env.ROOT_CHECKIN_REMINDER_SEND_ENABLED || "").trim() === "true";
  if (!enabled) return Object.freeze({ enabled: false, endpoint: "" });
  const target = resolveWechatSubscribeSendUrl(env);
  return Object.freeze({ enabled: true, endpoint: `${target.origin}${target.pathname}` });
}

function createWechatSubscribeMessageAdapter({
  fetchJson = fetchWechatJson,
  resolveAccessToken = resolveWechatAccessToken,
} = {}) {
  if (typeof fetchJson !== "function" || typeof resolveAccessToken !== "function") {
    throw configurationError();
  }
  return Object.freeze({
    async send({ config = {}, env = process.env, payload } = {}) {
      let unsignedTarget;
      try {
        // Validate the credential destination before token acquisition. A bad
        // endpoint must never be able to cause a token request or network call.
        unsignedTarget = resolveWechatSubscribeSendUrl(env);
      } catch (error) {
        throw knownNotSent(error);
      }
      if (!config.appid || !config.secret) throw configurationError();

      let accessToken;
      try {
        accessToken = await resolveAccessToken(config);
      } catch (error) {
        throw knownNotSent(error);
      }

      const credentialTarget = new URL(unsignedTarget.href);
      credentialTarget.searchParams.set("access_token", accessToken);
      try {
        // Revalidate at the network seam after the credential-bearing URL is
        // assembled so future refactors cannot bypass the origin/path policy.
        assertWechatSubscribeCredentialTarget(credentialTarget, env);
      } catch (error) {
        throw knownNotSent(error);
      }

      try {
        return await fetchJson(credentialTarget, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        error.deliveryOutcome = error.externalCode === "43101"
          ? "NO_GRANT"
          : (error.externalCode ? "NOT_SENT" : "UNKNOWN");
        throw error;
      }
    },
  });
}

const wechatSubscribeMessageAdapter = createWechatSubscribeMessageAdapter();

module.exports = Object.freeze({
  assertWechatSubscriptionSendConfiguration,
  createWechatSubscribeMessageAdapter,
  wechatSubscribeMessageAdapter,
});
