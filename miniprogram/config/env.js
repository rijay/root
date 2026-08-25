const detectedEnvVersion = typeof __wxConfig !== "undefined" && __wxConfig.envVersion ? __wxConfig.envVersion : "develop";
const envVersion = ["develop", "trial", "release"].includes(detectedEnvVersion) ? detectedEnvVersion : "develop";

const productionCloudServiceName = "myroot-api";
const internalTestCloudServiceName = "myroot-api";
const SERVER_ASSESSMENT_STORAGE = "SERVER";
const LOCAL_DEVICE_ASSESSMENT_RETENTION_DAYS = 180;

const developmentCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: internalTestCloudServiceName,
  localV060CompatMode: true,
  healthAssessmentStorageMode: SERVER_ASSESSMENT_STORAGE,
};

const productionLikeCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: productionCloudServiceName,
  localV060CompatMode: false,
  healthAssessmentStorageMode: SERVER_ASSESSMENT_STORAGE,
};

const configs = {
  develop: developmentCloudContainerConfig,
  trial: productionLikeCloudContainerConfig,
  release: productionLikeCloudContainerConfig,
};

module.exports = {
  envVersion,
  ...(configs[envVersion] || configs.develop),
  healthAssessmentRetentionDays: LOCAL_DEVICE_ASSESSMENT_RETENTION_DAYS,
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
