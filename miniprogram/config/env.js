const detectedEnvVersion = typeof __wxConfig !== "undefined" && __wxConfig.envVersion ? __wxConfig.envVersion : "release";
const envVersion = ["develop", "trial", "release"].includes(detectedEnvVersion) ? detectedEnvVersion : "release";

const productionApiBaseUrl = "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com";
const cloudEnvId = "prod-d3grtjkva76c93e00";
const cloudServiceName = "express-x7te";

const cloudContainerConfig = {
  requestAdapter: "cloudContainer",
  apiBaseUrl: productionApiBaseUrl,
  cloudEnvId,
  cloudServiceName,
};

const configs = {
  develop: cloudContainerConfig,
  trial: cloudContainerConfig,
  release: cloudContainerConfig,
};

module.exports = {
  envVersion,
  ...(configs[envVersion] || configs.release),
  youzanAppId: "wx1234567890abcdef",
  youzanProductPath: "pages/product/detail?id=ROOT_PREBIOTIC",
};
