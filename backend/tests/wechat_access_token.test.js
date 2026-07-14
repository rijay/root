const assert = require("node:assert/strict");
const test = require("node:test");
const {
  clearWechatAccessTokenCache,
  resolveWechatAccessToken,
} = require("../src/wechatAccessToken");

const CREDENTIAL = {
  appid: "wx7727a02565aed1c2",
  secret: "test-app-secret-never-send",
};

test("WeChat token Module uses the stable POST contract without query credentials", async (t) => {
  clearWechatAccessTokenCache();
  t.after(clearWechatAccessTokenCache);
  const calls = [];

  const token = await resolveWechatAccessToken(CREDENTIAL, {
    nowMs: Date.UTC(2026, 6, 14, 0, 0, 0),
    fetchJson: async (url, options) => {
      calls.push({ url: String(url), options });
      return { access_token: "stable-access-token", expires_in: 7200 };
    },
  });

  assert.equal(token, "stable-access-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.weixin.qq.com/cgi-bin/stable_token");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    grant_type: "client_credential",
    appid: CREDENTIAL.appid,
    secret: CREDENTIAL.secret,
    force_refresh: false,
  });
});

test("WeChat token Module coalesces concurrent requests and reuses a fresh token", async (t) => {
  clearWechatAccessTokenCache();
  t.after(clearWechatAccessTokenCache);
  let callCount = 0;
  let releaseRequest;
  const pendingResponse = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const options = {
    nowMs: Date.UTC(2026, 6, 14, 1, 0, 0),
    fetchJson: async () => {
      callCount += 1;
      await pendingResponse;
      return { access_token: "shared-stable-token", expires_in: 7200 };
    },
  };

  const first = resolveWechatAccessToken(CREDENTIAL, options);
  const second = resolveWechatAccessToken(CREDENTIAL, options);
  await Promise.resolve();
  assert.equal(callCount, 1);
  releaseRequest();
  assert.deepEqual(await Promise.all([first, second]), ["shared-stable-token", "shared-stable-token"]);

  const cached = await resolveWechatAccessToken(CREDENTIAL, {
    ...options,
    nowMs: options.nowMs + 60 * 1000,
  });
  assert.equal(cached, "shared-stable-token");
  assert.equal(callCount, 1);
});

test("WeChat token Module isolates cache entries across AppSecret rotation", async (t) => {
  clearWechatAccessTokenCache();
  t.after(clearWechatAccessTokenCache);
  const requestedSecrets = [];
  const fetchJson = async (url, options) => {
    const body = JSON.parse(options.body);
    requestedSecrets.push(body.secret);
    return { access_token: `token-${requestedSecrets.length}`, expires_in: 7200 };
  };

  const beforeRotation = await resolveWechatAccessToken(CREDENTIAL, { fetchJson, nowMs: 1000 });
  const afterRotation = await resolveWechatAccessToken({
    ...CREDENTIAL,
    secret: "rotated-test-app-secret-never-send",
  }, { fetchJson, nowMs: 2000 });

  assert.equal(beforeRotation, "token-1");
  assert.equal(afterRotation, "token-2");
  assert.equal(requestedSecrets.length, 2);
});

test("WeChat token Module rejects missing credentials and malformed success payloads safely", async (t) => {
  clearWechatAccessTokenCache();
  t.after(clearWechatAccessTokenCache);

  await assert.rejects(
    () => resolveWechatAccessToken({ appid: CREDENTIAL.appid }),
    (error) => error.code === 1006 && /缺少 AppID 或 AppSecret/.test(error.message)
  );
  await assert.rejects(
    () => resolveWechatAccessToken(CREDENTIAL, {
      fetchJson: async () => ({ expires_in: 7200, secret: CREDENTIAL.secret }),
    }),
    (error) => {
      assert.equal(error.code, 1006);
      assert.match(error.message, /缺少 access_token/);
      assert.doesNotMatch(error.message, new RegExp(CREDENTIAL.secret));
      return true;
    }
  );
});
