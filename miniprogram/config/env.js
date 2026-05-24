const envVersion = typeof __wxConfig !== "undefined" && __wxConfig.envVersion ? __wxConfig.envVersion : "develop";

const productionApiBaseUrl = "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com";
const cloudEnvId = "prod-d3grtjkva76c93e00";
const cloudServiceName = "express-x7te";

const configs = {
  develop: {
    requestAdapter: "wxRequest",
    apiBaseUrl: "http://127.0.0.1:8787",
  },
  trial: {
    requestAdapter: "cloudContainer",
    apiBaseUrl: productionApiBaseUrl,
    cloudEnvId,
    cloudServiceName,
  },
  release: {
    requestAdapter: "cloudContainer",
    apiBaseUrl: productionApiBaseUrl,
    cloudEnvId,
    cloudServiceName,
  },
};

module.exports = {
  envVersion,
  ...(configs[envVersion] || configs.develop),
  youzanAppId: "wx1234567890abcdef",
  youzanProductPath: "pages/product/detail?id=ROOT_PREBIOTIC",
};
