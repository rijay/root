const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LOCAL_YOUZAN_KEYCHAIN_ACCOUNT,
  LOCAL_YOUZAN_KEYCHAIN_SERVICE,
  readLocalYouzanAccessToken,
} = require("../src/localYouzanKeychain");

test("local Youzan credential reader uses the dedicated Keychain item without a shell", () => {
  let received;
  const token = readLocalYouzanAccessToken({
    execFileSync(file, args, options) {
      received = { file, args, options };
      return " keychain-youzan-token \n";
    },
  });
  assert.equal(token, "keychain-youzan-token");
  assert.equal(received.file, "/usr/bin/security");
  assert.deepEqual(received.args, [
    "find-generic-password",
    "-a",
    LOCAL_YOUZAN_KEYCHAIN_ACCOUNT,
    "-s",
    LOCAL_YOUZAN_KEYCHAIN_SERVICE,
    "-w",
  ]);
  assert.deepEqual(received.options.stdio, ["ignore", "pipe", "pipe"]);
});

test("local Youzan credential reader fails closed when Keychain is unavailable", () => {
  const token = readLocalYouzanAccessToken({
    execFileSync() { throw new Error("missing"); },
  });
  assert.equal(token, "");
});
