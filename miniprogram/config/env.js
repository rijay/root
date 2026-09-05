const { detectRuntimeEnvVersion } = require("../utils/runtime-env-version");

const runtimeWx = typeof wx !== "undefined" ? wx : null;
const runtimeWxConfig = typeof __wxConfig !== "undefined" ? __wxConfig : null;
const envVersion = detectRuntimeEnvVersion(runtimeWx, runtimeWxConfig);

const productionCloudServiceName = "myroot-api";
const internalTestCloudServiceName = "myroot-api";
const LOCAL_DEVTOOLS_API_BASE_URL = "http://127.0.0.1:8787";

const developmentCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: internalTestCloudServiceName,
  localDevtoolsApiBaseUrl: LOCAL_DEVTOOLS_API_BASE_URL,
  analyticsEnabled: false,
};

const productionLikeCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: productionCloudServiceName,
  localDevtoolsApiBaseUrl: "",
  analyticsEnabled: true,
};

const configs = {
  develop: developmentCloudContainerConfig,
  trial: productionLikeCloudContainerConfig,
  release: productionLikeCloudContainerConfig,
};

module.exports = {
  envVersion,
  ...(configs[envVersion] || configs.develop),
  youzanAppId: "wxfb75c0b432670215",
  youzanProductPath: "",
  rootMemberCenterAppId: "wxfb75c0b432670215",
  rootMemberCenterOrdersShortLink: "#小程序://ROOT会员中心/vTORPdF67tiEwCb",
  rootMemberCenterCouponsShortLink: "#小程序://ROOT会员中心/vTORPdF67tiEwCb",
  rootGutTrialShortLink: "#小程序://ROOT会员商城/n3slzlsfIydORAd",
  wecomCustomerService: Object.freeze({
    corpId: "ww4c7f2598188d97db",
    url: "https://work.weixin.qq.com/kfid/kfc9a886fb6a493c66b",
  }),
};
