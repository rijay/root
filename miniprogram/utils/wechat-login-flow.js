const DEFAULT_WECHAT_LOGIN_TIMEOUT = 10000;

function ensureLoginAgreement(agreed) {
  if (agreed) return Promise.resolve(true);
  return new Promise((resolve) => {
    wx.showModal({
      title: "登录 ROOT",
      content: "继续即表示你已阅读并同意《用户协议》和《隐私政策》。健康相关信息会在后续单独征得同意。",
      confirmText: "同意并进入",
      cancelText: "暂不登录",
      success(result) {
        resolve(Boolean(result && result.confirm));
      },
      fail() {
        resolve(false);
      },
    });
  });
}

function getWechatLoginCode(timeout = DEFAULT_WECHAT_LOGIN_TIMEOUT) {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout,
      success(result) {
        const code = String((result && result.code) || "").trim();
        if (!code) {
          reject(new Error("微信身份凭证未返回，请重新登录"));
          return;
        }
        resolve(code);
      },
      fail(error) {
        reject(error || new Error("微信身份凭证获取失败"));
      },
    });
  });
}

async function authenticateWechat({ request, phoneCode = "", onStage = () => {} } = {}) {
  if (typeof request !== "function") throw new Error("登录请求未配置");
  onStage("正在连接微信…");
  const wxCode = await getWechatLoginCode();
  onStage("正在验证会员身份…");
  return request({
    url: "/api/v1/auth/login",
    method: "POST",
    timeout: 45000,
    data: {
      appCode: "MYROOT",
      wxCode,
      phoneCode: String(phoneCode || ""),
      flowVersion: "FORMAL_LAUNCH_V1",
      sourceChannel: "MYROOT_PHONE_LOGIN",
    },
  });
}

function showLoginFailure(message) {
  const detail = String(message || "登录失败，请重试").trim().slice(0, 80);
  wx.showModal({
    title: "登录未完成",
    content: `${detail}\n\n请关闭提示后，再次点击“手机号快捷登录”重新授权。`,
    confirmText: "知道了",
    cancelText: "稍后再试",
  });
}

module.exports = {
  DEFAULT_WECHAT_LOGIN_TIMEOUT,
  authenticateWechat,
  ensureLoginAgreement,
  getWechatLoginCode,
  showLoginFailure,
};
