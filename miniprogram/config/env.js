const detectedEnvVersion = typeof __wxConfig !== "undefined" && __wxConfig.envVersion ? __wxConfig.envVersion : "develop";
const envVersion = ["develop", "trial", "release"].includes(detectedEnvVersion) ? detectedEnvVersion : "develop";

const productionApiBaseUrl = "https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com";
const productionCloudServiceName = "myroot-api";
const internalTestCloudServiceName = "myroot-api";

const internalTestCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  apiBaseUrl: productionApiBaseUrl,
  cloudEnvId: "myroot-prod-d5gl3gzg7115f149a",
  cloudServiceName: internalTestCloudServiceName,
};

const productionCloudContainerConfig = {
  requestAdapter: "cloudContainer",
  apiBaseUrl: productionApiBaseUrl,
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
};
