const detectedEnvVersion = typeof __wxConfig !== "undefined" && __wxConfig.envVersion ? __wxConfig.envVersion : "develop";
const envVersion = ["develop", "trial", "release"].includes(detectedEnvVersion) ? detectedEnvVersion : "develop";

const productionCloudServiceName = "myroot-api";
const internalTestCloudServiceName = "myroot-api";

const internalTestCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: internalTestCloudServiceName,
};

const productionCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: productionCloudServiceName,
};

const configs = {
  develop: internalTestCloudContainerConfig,
  trial: internalTestCloudContainerConfig,
  release: productionCloudContainerConfig,
};

module.exports = {
  envVersion,
  ...(configs[envVersion] || configs.develop),
  youzanAppId: "",
  youzanProductPath: "",
  rootMemberCenterAppId: "wxfb75c0b432670215",
  rootMemberCenterOrdersShortLink: "#小程序://ROOT会员中心/vTORPdF67tiEwCb",
  rootMemberCenterCouponsShortLink: "#小程序://ROOT会员中心/vTORPdF67tiEwCb",
  wecomCustomerService: Object.freeze({
    corpId: "ww4c7f2598188d97db",
    url: "https://work.weixin.qq.com/kfid/kfc9a886fb6a493c66b",
  }),
};
