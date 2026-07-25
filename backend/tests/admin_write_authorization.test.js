const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const {
  ADMIN_COMMANDS,
  ADMIN_CAPABILITIES,
  capabilityForAdminCommand,
} = require("../src/adminAccessControl");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return response.json();
}

function seedAdminWrites(data) {
  data.users.push({
    user_id: "usr_admin_auth_guard",
    root_user_id: "usr_admin_auth_guard",
    phone: "",
    nickname: "权限测试用户",
    state: "REGISTERED",
  });
  data.operationTasks.push(
    {
      task_id: "tsk_admin_complete_guard",
      task_type: "FEEDBACK_FOLLOW",
      user_id: "usr_admin_auth_guard",
      order_id: "",
      task_date: "2026-07-15",
      status: "OPEN",
      reason: "需要运营跟进",
      metadata: {},
      created_at: "2026-07-15T08:00:00.000Z",
      completed_at: "",
      result: "",
      note: "",
    },
    {
      task_id: "tsk_admin_resolve_guard",
      task_type: "MANUAL_REVIEW_REQUIRED",
      user_id: "usr_admin_auth_guard",
      order_id: "",
      task_date: "2026-07-15",
      status: "OPEN",
      reason: "需要人工确认",
      metadata: {},
      created_at: "2026-07-15T08:00:00.000Z",
      completed_at: "",
      result: "",
      note: "",
    }
  );
  data.refundWorkItems.push({
    refund_work_item_id: "rwi_admin_approve_guard",
    session_id: "ses_admin_auth_guard",
    user_id: "usr_admin_auth_guard",
    order_id: "ord_admin_auth_guard",
    youzan_order_no: "YZ_ADMIN_AUTH_GUARD",
    amount: 199,
    status: "PENDING",
    created_at: "2026-07-15T08:00:00.000Z",
    paid_at: "",
    note: "",
  });
  data.couponEvents.push({
    coupon_id: "cpn_admin_use_guard",
    user_id: "usr_admin_auth_guard",
    session_id: "ses_admin_auth_guard",
    order_id: "ord_admin_auth_guard",
    coupon_type: "DAY6_REPURCHASE",
    experiment_group: "DAY6_COUPON",
    status: "CLAIMED",
    title: "权限测试优惠券",
    description: "",
    discount_text: "测试",
    code: "AUTH-GUARD",
    issued_at: "2026-07-15T08:00:00.000Z",
    claimed_at: "2026-07-15T08:00:00.000Z",
    used_at: "",
    expires_at: "2026-07-31",
    repurchase_clicked_at: "",
    created_at: "2026-07-15T08:00:00.000Z",
  });
}

test("Authorization Module maps protected admin commands to precise capabilities", () => {
  assert.equal(capabilityForAdminCommand(ADMIN_COMMANDS.TASK_COMPLETE), ADMIN_CAPABILITIES.REVIEW_RESOLVE);
  assert.equal(capabilityForAdminCommand(ADMIN_COMMANDS.TASK_RESOLVE), ADMIN_CAPABILITIES.REVIEW_RESOLVE);
  assert.equal(capabilityForAdminCommand(ADMIN_COMMANDS.REFUND_APPROVE), ADMIN_CAPABILITIES.REFUND_APPROVE);
  assert.equal(capabilityForAdminCommand(ADMIN_COMMANDS.COUPON_USE), ADMIN_CAPABILITIES.COUPON_USE);
});

test("production and cloud runtimes cannot disable configured Admin authentication", async (t) => {
  const cases = [
    {
      name: "production ignores ROOT_REQUIRE_ADMIN_TOKEN=false",
      env: {
        NODE_ENV: "production",
        ROOT_REQUIRE_ADMIN_TOKEN: "false",
      },
    },
    {
      name: "production ignores ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS=true",
      env: {
        NODE_ENV: "production",
        ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS: "true",
      },
    },
    {
      name: "cloud ignores ROOT_REQUIRE_ADMIN_TOKEN=false",
      env: {
        TCB_ENV: "myroot-cloud",
        ROOT_REQUIRE_ADMIN_TOKEN: "false",
      },
    },
    {
      name: "cloud ignores ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS=true",
      env: {
        TCB_ENV: "myroot-cloud",
        ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS: "true",
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async (t) => {
      const server = createApp({ env: testCase.env });
      seedAdminWrites(server.store);
      const baseUrl = await listen(server);
      t.after(() => server.close());

      const identityResult = await request(baseUrl, "/api/v1/admin/me");
      assert.equal(identityResult.code, 40101);

      const writeResult = await request(baseUrl, "/api/v1/admin/tasks/tsk_admin_complete_guard/complete", {
        method: "POST",
        headers: { "X-Request-Id": `fail-close-${testCase.name}` },
        body: JSON.stringify({ status: "DONE", note: "must remain unauthorized" }),
      });
      assert.equal(writeResult.code, 40101);
      assert.equal(
        server.store.operationTasks.find((item) => item.task_id === "tsk_admin_complete_guard").status,
        "OPEN"
      );
    });
  }
});

test("four admin write command families enforce capability, request id, idempotency and audit", async (t) => {
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        operator: { token: "operator-secret", role: "operator" },
        finance: { token: "finance-secret", role: "finance" },
      }),
    },
  });
  seedAdminWrites(server.store);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const viewer = { "X-Admin-Token": "viewer-secret" };
  const operator = { "X-Admin-Token": "operator-secret" };
  const finance = { "X-Admin-Token": "finance-secret" };
  const commands = [
    {
      path: "/api/v1/admin/tasks/tsk_admin_complete_guard/complete",
      authorizedHeaders: operator,
      requestId: "admin-task-complete-1",
      body: { status: "DONE", note: "运营已完成", operatorId: "spoofed-operator" },
      current: () => server.store.operationTasks.find((item) => item.task_id === "tsk_admin_complete_guard").status,
      before: "OPEN",
      after: "DONE",
      action: "OPERATION_TASK_COMPLETE",
      operatorId: "operator",
    },
    {
      path: "/api/v1/admin/tasks/tsk_admin_resolve_guard/resolve",
      authorizedHeaders: operator,
      requestId: "admin-task-resolve-1",
      body: { action: "REJECT", note: "证据不足", operatorId: "spoofed-operator" },
      current: () => server.store.operationTasks.find((item) => item.task_id === "tsk_admin_resolve_guard").status,
      before: "OPEN",
      after: "DONE",
      action: "OPERATION_TASK_RESOLVE",
      operatorId: "operator",
    },
    {
      path: "/api/v1/admin/refunds/rwi_admin_approve_guard/approve",
      authorizedHeaders: finance,
      requestId: "admin-refund-approve-1",
      body: { reason: "财务复核通过", operatorId: "spoofed-operator" },
      current: () => server.store.refundWorkItems.find((item) => item.refund_work_item_id === "rwi_admin_approve_guard").status,
      before: "PENDING",
      after: "PAID",
      action: "REFUND_APPROVE",
      operatorId: "finance",
    },
    {
      path: "/api/v1/admin/coupons/cpn_admin_use_guard/use",
      authorizedHeaders: operator,
      requestId: "admin-coupon-use-1",
      body: { reason: "门店已核销", operatorId: "spoofed-operator" },
      current: () => server.store.couponEvents.find((item) => item.coupon_id === "cpn_admin_use_guard").status,
      before: "CLAIMED",
      after: "USED",
      action: "COUPON_USE",
      operatorId: "operator",
    },
  ];

  for (const command of commands) {
    const denied = await request(baseUrl, command.path, {
      method: "POST",
      headers: { ...viewer, "X-Request-Id": `viewer-${command.requestId}` },
      body: JSON.stringify(command.body),
    });
    assert.equal(denied.code, 40301);
    assert.equal(command.current(), command.before);

    const missingRequestId = await request(baseUrl, command.path, {
      method: "POST",
      headers: command.authorizedHeaders,
      body: JSON.stringify(command.body),
    });
    assert.equal(missingRequestId.code, 400);
    assert.equal(command.current(), command.before);

    const authorized = await request(baseUrl, command.path, {
      method: "POST",
      headers: { ...command.authorizedHeaders, "X-Request-Id": command.requestId },
      body: JSON.stringify(command.body),
    });
    const repeated = await request(baseUrl, command.path, {
      method: "POST",
      headers: { ...command.authorizedHeaders, "X-Request-Id": command.requestId },
      body: JSON.stringify(command.body),
    });

    assert.equal(authorized.code, 0);
    assert.equal(command.current(), command.after);
    assert.equal(repeated.data.audit.audit_log_id, authorized.data.audit.audit_log_id);
    const matchingAudits = server.store.auditLogs.filter((item) => item.action === command.action);
    assert.equal(matchingAudits.length, 1);
    assert.equal(matchingAudits[0].operator_id, command.operatorId);
    assert.equal(matchingAudits[0].metadata.requestId, command.requestId);
  }

  const operatorRefundDenied = await request(baseUrl, "/api/v1/admin/refunds/rwi_admin_approve_guard/approve", {
    method: "POST",
    headers: { ...operator, "X-Request-Id": "operator-refund-denied" },
    body: JSON.stringify({ reason: "运营不可审批退款" }),
  });
  assert.equal(operatorRefundDenied.code, 40301);
});
