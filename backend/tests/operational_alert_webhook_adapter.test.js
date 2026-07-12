const assert = require("node:assert/strict");
const test = require("node:test");
const adapter = require("../src/operationalAlertWebhookAdapter");

function alertFixture() {
  return {
    label: "生命周期结算失败",
    message: "队列存在 1 条失败记录",
    severity: "danger",
    nextAction: "进入 Admin 检查失败原因",
    ownerRole: "运营主管",
    ownerName: "ROOT Ops",
    routeKey: "ops:settlement",
  };
}

test("WeWork robot payload uses the native markdown contract", () => {
  const generic = adapter.buildWebhookPayload({}, alertFixture(), {}, {
    now: "2026-07-11T20:00:00+08:00",
    requestId: "alert-1",
  }, { channel: "WEWORK", template: "ROOT_OPERATIONAL_ALERT" });
  const payload = adapter.buildWeworkRobotPayload(generic);

  assert.equal(payload.msgtype, "markdown");
  assert.match(payload.markdown.content, /myRoot 运营告警/);
  assert.match(payload.markdown.content, /ROOT Ops/);
  assert.equal(adapter.isWeworkRobotUrl("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=masked"), true);
  assert.equal(adapter.isWeworkRobotUrl("https://hooks.example.com/root"), false);
});

test("WeWork robot delivery requires HTTP success and errcode zero", async () => {
  const calls = [];
  const delivered = await adapter.sendOperationalAlertWebhook({}, alertFixture(), {
    now: "2026-07-11T20:00:00+08:00",
    env: {
      ROOT_OPERATIONAL_ALERT_WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=masked",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL: "WEWORK",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" }) };
    },
  });
  const failed = await adapter.sendOperationalAlertWebhook({}, alertFixture(), {
    env: {
      ROOT_OPERATIONAL_ALERT_WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=masked",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL: "WEWORK",
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errcode: 93000, errmsg: "invalid webhook" }),
    }),
  });

  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.externalRef, "HTTP 200 / errcode 0");
  assert.equal(JSON.parse(calls[0].init.body).msgtype, "markdown");
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error, /errcode 93000/);
});
