const assert = require("node:assert/strict");
const {
  DEFAULT_WECHAT_LOGIN_TIMEOUT,
  authenticateWechat,
  ensureLoginAgreement,
  getWechatLoginCode,
  showLoginFailure,
} = require("../utils/wechat-login-flow");

async function run() {
  let modalOptions = null;
  global.wx = {
    showModal(options) {
      modalOptions = options;
      options.success({ confirm: true });
    },
  };
  assert.equal(await ensureLoginAgreement(false), true);
  assert.equal(modalOptions.confirmText, "同意并进入");
  assert.match(modalOptions.content, /用户协议/);
  assert.equal(await ensureLoginAgreement(true), true);

  const stages = [];
  let requestOptions = null;
  global.wx.login = (options) => {
    assert.equal(options.timeout, DEFAULT_WECHAT_LOGIN_TIMEOUT);
    options.success({ code: "temporary-code" });
  };
  const result = await authenticateWechat({
    request: async (options) => {
      requestOptions = options;
      return { token: "token", nextRoute: "/pages/home/index" };
    },
    onStage(stage) { stages.push(stage); },
  });
  assert.equal(result.token, "token");
  assert.deepEqual(stages, ["正在连接微信…", "正在验证会员身份…"]);
  assert.equal(requestOptions.url, "/api/v1/auth/login");
  assert.equal(requestOptions.timeout, 45000);
  assert.equal(requestOptions.data.wxCode, "temporary-code");

  global.wx.login = (options) => options.success({ code: "" });
  await assert.rejects(() => getWechatLoginCode(), /身份凭证未返回/);

  let retried = false;
  global.wx.showModal = (options) => {
    modalOptions = options;
    options.success({ confirm: true });
  };
  showLoginFailure("服务响应较慢，请稍后重试", () => { retried = true; });
  assert.equal(modalOptions.title, "登录未完成");
  assert.equal(retried, true);

  delete global.wx;
  console.log("wechat login flow scenarios: 8/8 PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
