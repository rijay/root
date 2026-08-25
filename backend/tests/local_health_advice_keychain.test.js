const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LOCAL_HEALTH_ADVICE_KEYCHAIN_ACCOUNT,
  LOCAL_HEALTH_ADVICE_KEYCHAIN_SERVICE,
  readLocalHealthAdviceApiKey,
} = require("../src/localHealthAdviceKeychain");

test("local health advice credential is read from the fixed macOS Keychain item without logging it", () => {
  let invocation;
  const apiKey = readLocalHealthAdviceApiKey({
    execFileSync(file, args, options) {
      invocation = { file, args, options };
      return " keychain-secret\n";
    },
  });

  assert.equal(apiKey, "keychain-secret");
  assert.equal(invocation.file, "/usr/bin/security");
  assert.deepEqual(invocation.args, [
    "find-generic-password",
    "-a",
    LOCAL_HEALTH_ADVICE_KEYCHAIN_ACCOUNT,
    "-s",
    LOCAL_HEALTH_ADVICE_KEYCHAIN_SERVICE,
    "-w",
  ]);
  assert.deepEqual(invocation.options.stdio, ["ignore", "pipe", "pipe"]);
});

test("local health advice credential lookup fails closed without exposing command errors", () => {
  const apiKey = readLocalHealthAdviceApiKey({
    execFileSync() {
      const error = new Error("sensitive command detail");
      error.stderr = "sensitive stderr";
      throw error;
    },
  });
  assert.equal(apiKey, "");
});
