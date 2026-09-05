const { execFileSync } = require("node:child_process");

const LOCAL_HEALTH_ADVICE_KEYCHAIN_ACCOUNT = "myroot-v070-local-dev";
const LOCAL_HEALTH_ADVICE_KEYCHAIN_SERVICE = "com.myroot.v070.cloudbase-ai";

function readLocalHealthAdviceApiKey(options = {}) {
  const execute = options.execFileSync || execFileSync;
  try {
    const value = execute("/usr/bin/security", [
      "find-generic-password",
      "-a",
      LOCAL_HEALTH_ADVICE_KEYCHAIN_ACCOUNT,
      "-s",
      LOCAL_HEALTH_ADVICE_KEYCHAIN_SERVICE,
      "-w",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return String(value || "").trim();
  } catch (error) {
    return "";
  }
}

module.exports = {
  LOCAL_HEALTH_ADVICE_KEYCHAIN_ACCOUNT,
  LOCAL_HEALTH_ADVICE_KEYCHAIN_SERVICE,
  readLocalHealthAdviceApiKey,
};
