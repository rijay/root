const { execFileSync } = require("node:child_process");

const LOCAL_YOUZAN_KEYCHAIN_ACCOUNT = "youzan-root-store";
const LOCAL_YOUZAN_KEYCHAIN_SERVICE = "com.myroot.v070.youzan-access-token";

function readLocalYouzanAccessToken(options = {}) {
  const execute = options.execFileSync || execFileSync;
  try {
    const value = execute("/usr/bin/security", [
      "find-generic-password",
      "-a",
      LOCAL_YOUZAN_KEYCHAIN_ACCOUNT,
      "-s",
      LOCAL_YOUZAN_KEYCHAIN_SERVICE,
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

module.exports = Object.freeze({
  LOCAL_YOUZAN_KEYCHAIN_ACCOUNT,
  LOCAL_YOUZAN_KEYCHAIN_SERVICE,
  readLocalYouzanAccessToken,
});
