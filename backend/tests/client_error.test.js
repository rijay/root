const test = require("node:test");
const assert = require("node:assert/strict");

const { clientErrorResponse, createClientError } = require("../src/clientError");

test("explicit client errors preserve approved messages", () => {
  assert.deepEqual(
    clientErrorResponse(createClientError(7001, "不支持的任务类型", 400), "request_safe"),
    {
      status: 400,
      payload: { code: 7001, message: "不支持的任务类型", data: null },
    }
  );
});

test("unexpected errors expose only a generic message and hashed correlation id", () => {
  const response = clientErrorResponse(
    new Error("phone=13800000000 bearer-secret"),
    "request_0123456789abcdef"
  );
  assert.deepEqual(response, {
    status: 500,
    payload: {
      code: 500,
      message: "请求处理失败，请稍后重试",
      data: { correlationId: "request_0123456789abcdef" },
    },
  });
  assert.equal(JSON.stringify(response).includes("13800000000"), false);
  assert.equal(JSON.stringify(response).includes("bearer-secret"), false);
});
