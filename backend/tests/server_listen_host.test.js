const assert = require("node:assert/strict");
const test = require("node:test");
const { listenHostFromEnv } = require("../src/server");

test("server defaults to the cloud-compatible wildcard host", () => {
  assert.equal(listenHostFromEnv({}), "0.0.0.0");
});

test("local miniprogram development can bind only to loopback", () => {
  assert.equal(listenHostFromEnv({ ROOT_LISTEN_HOST: "127.0.0.1" }), "127.0.0.1");
});

test("unexpected listen hosts fail closed", () => {
  assert.throws(
    () => listenHostFromEnv({ ROOT_LISTEN_HOST: "192.168.1.10" }),
    { code: "LISTEN_HOST_INVALID" },
  );
});
