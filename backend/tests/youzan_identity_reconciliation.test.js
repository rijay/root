const assert = require("node:assert/strict");
const test = require("node:test");
const { createYouzanIdentityImplementation } = require("../src/youzanIdentityResolver");
const { candidateIdentities, reconcileYouzanIdentities } = require("../src/youzanIdentityReconciliation");
const { stampVerifiedWechatUnionId } = require("../src/wechatIdentityAuthority");

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function readyEnv(overrides = {}) {
  return {
    YOUZAN_USER_QUERY_URL: "https://open.youzanyun.com/api/youzan.users.info.query/1.0.1",
    YOUZAN_USER_QUERY_ACCESS_TOKEN: "token-must-not-leak",
    ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED: "true",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "youzan-unionid-authority-test-key-with-strong-entropy-2026",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "youzan-unionid-authority-v1",
    ...overrides,
  };
}

function candidateData() {
  return {
    users: [{ user_id: "usr_root_1", root_user_id: "root_1", phone: "13800000000" }],
    rootUsers: [{ root_user_id: "root_1" }],
    wechatIdentities: [stampVerifiedWechatUnionId({
      wechat_identity_id: "wxi_1",
      root_user_id: "root_1",
      app_code: "MYROOT",
      openid: "openid-private",
      unionid: "union-private-001",
    }, { source: "CLOUDBASE", verifiedAt: "2026-07-11T00:00:00.000Z" }, { env: readyEnv() })],
    youzanCustomers: [],
    youzanIdentityReconciliations: [],
    youzanOrders: [],
    orderFulfillments: [],
    operationTasks: [],
    userLifecycleEvents: [],
    auditLogs: [],
  };
}

test("Youzan identity resolver sends UnionID query and accepts multiple yz_open_id values", async () => {
  let requestedUrl = "";
  let requestedBody = null;
  const implementation = createYouzanIdentityImplementation({
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedBody = JSON.parse(init.body);
      return response({
        code: 200,
        success: true,
        data: {
          user_list: [
            { primitive_info: { yz_open_id: "yz_1", nick_name: "ROOT A" }, mobile_info: { mobile: "13800000000" } },
            { primitive_info: { yz_open_id: "yz_2" } },
            { primitive_info: { yz_open_id: "yz_1" } },
            { primitive_info: { yz_open_id: "yz_wrong" }, platform_info: { union_id: "other-union" } },
          ],
        },
      });
    },
  });

  const result = await implementation({ unionid: "union-private-001", env: readyEnv() });

  assert.equal(new URL(requestedUrl).searchParams.get("access_token"), "token-must-not-leak");
  assert.equal(requestedBody.weixin_union_id, "union-private-001");
  assert.deepEqual(requestedBody.result_type_list, [0, 1, 2, 9]);
  assert.equal(result.status, "RESOLVED");
  assert.deepEqual(result.identities.map((item) => item.youzanYzUid), ["yz_1", "yz_2"]);
  assert.equal(result.externalCount, 4);
  assert.equal(result.rejectedCount, 1);
});

test("Youzan identity resolver rejects gateway business errors returned with HTTP 200", async () => {
  const implementation = createYouzanIdentityImplementation({
    fetchImpl: async () => response({ gw_err_resp: { err_code: 4101, err_msg: "rate limit" } }),
  });

  await assert.rejects(
    () => implementation({ unionid: "union-private-001", env: readyEnv() }),
    (error) => error.code === 4101 && /rate limit/.test(error.message)
  );
});

test("Youzan identity reconciliation defaults to dry-run without external calls or writes", async () => {
  const data = candidateData();
  let called = false;
  const result = await reconcileYouzanIdentities(data, {}, {
    env: readyEnv({ ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED: "false" }),
    identityImplementation: async () => {
      called = true;
      return { status: "RESOLVED", identities: [] };
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.config.ready, false);
  assert.equal(called, false);
  assert.deepEqual(data.youzanIdentityReconciliations, []);
  assert.deepEqual(data.auditLogs, []);
});

test("historical UNVERIFIED UnionID cannot enter reconciliation or bind customers and orders", async () => {
  const data = candidateData();
  Object.assign(data.wechatIdentities[0], {
    unionid_status: "PENDING",
    unionid_trust_status: "UNVERIFIED",
    unionid_provenance_source: "",
    unionid_verified_at: "",
    unionid_provenance_canonical_version: "",
    unionid_provenance_digest: "",
    unionid_provenance_digest_scheme: "",
    unionid_provenance_key_id: "",
  });
  data.youzanOrders.push({
    order_id: "ord_historical_unverified",
    user_id: "",
    youzan_order_no: "YZ-HISTORICAL-UNVERIFIED",
    youzan_yz_uid: "yz_historical_unverified",
    order_status: "PAID",
    delivery_status: "SHIPPED",
  });
  let called = false;

  const result = await reconcileYouzanIdentities(data, { execute: true }, {
    env: readyEnv(),
    identityImplementation: async () => {
      called = true;
      return { status: "RESOLVED", identities: [{ youzanYzUid: "yz_historical_unverified" }] };
    },
  });

  assert.equal(result.candidateCount, 0);
  assert.equal(result.executedCount, 0);
  assert.equal(called, false);
  assert.equal(data.youzanCustomers.length, 0);
  assert.equal(data.youzanOrders[0].user_id, "");
});

test("tampered and unknown-key UnionID provenance cannot enter reconciliation", async () => {
  const tampered = candidateData();
  tampered.wechatIdentities[0].unionid = "unionid-tampered-after-stamp";
  const unknownKey = candidateData();
  const wrongEnv = readyEnv({
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "youzan-unionid-authority-other-key-with-strong-entropy-2026",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "youzan-unionid-authority-other-v2",
  });
  let called = false;

  for (const [data, env] of [[tampered, readyEnv()], [unknownKey, wrongEnv]]) {
    const result = await reconcileYouzanIdentities(data, { execute: true }, {
      env,
      identityImplementation: async () => {
        called = true;
        return { status: "RESOLVED", identities: [{ youzanYzUid: "must_not_link" }] };
      },
    });
    assert.equal(result.candidateCount, 0);
    assert.equal(result.executedCount, 0);
    assert.equal(data.youzanCustomers.length, 0);
  }
  assert.equal(called, false);
});

test("Youzan identity reconciliation links unbound orders and preserves conflicting ownership", async () => {
  const data = candidateData();
  data.users.push({ user_id: "usr_other", root_user_id: "root_other" });
  data.youzanOrders.push(
    {
      order_id: "ord_unbound",
      user_id: "",
      youzan_order_no: "YZ-UNBOUND",
      youzan_yz_uid: "yz_1",
      order_status: "PAID",
      delivery_status: "SHIPPED",
    },
    {
      order_id: "ord_conflict",
      user_id: "usr_other",
      youzan_order_no: "YZ-CONFLICT",
      youzan_yz_uid: "yz_2",
      order_status: "PAID",
      delivery_status: "DELIVERED",
    }
  );

  const result = await reconcileYouzanIdentities(data, {
    execute: true,
    requestId: "yz-reconcile-001",
    operatorId: "job",
    now: "2026-07-11T12:00:00+08:00",
  }, {
    env: readyEnv(),
    identityImplementation: async () => ({
      status: "RESOLVED",
      identities: [
        { youzanYzUid: "yz_1", phone: "13800000000", nickname: "ROOT A" },
        { youzanYzUid: "yz_2", phone: "13800000000", nickname: "ROOT A2" },
      ],
    }),
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.successCount, 1);
  assert.equal(result.results[0].identityCount, 2);
  assert.equal(result.results[0].linkedOrderCount, 1);
  assert.equal(result.results[0].conflictOrderCount, 1);
  assert.ok(Date.parse(result.results[0].nextRetryAt) > Date.parse("2026-07-18T11:59:00+08:00"));
  assert.equal(data.youzanOrders[0].user_id, "usr_root_1");
  assert.equal(data.youzanOrders[0].match_source, "AUTO_YOUZAN_UNIONID");
  assert.equal(data.youzanOrders[1].user_id, "usr_other");
  assert.equal(data.youzanCustomers.length, 2);
  assert.ok(data.youzanCustomers.every((item) => item.root_user_id === "root_1"));
  assert.equal(data.operationTasks.filter((item) => item.task_type === "ORDER_IDENTITY_MATCH_CONFLICT").length, 1);
  assert.equal(data.youzanIdentityReconciliations.length, 1);
  assert.notEqual(data.youzanIdentityReconciliations[0].unionid_fingerprint, "union-private-001");

  const auditJson = JSON.stringify(data.auditLogs);
  assert.equal(auditJson.includes("union-private-001"), false);
  assert.equal(auditJson.includes("13800000000"), false);
  assert.equal(auditJson.includes("token-must-not-leak"), false);

  assert.equal(candidateIdentities(data, { now: "2026-07-18T11:59:00+08:00", env: readyEnv() }).length, 0);
  assert.equal(candidateIdentities(data, { now: "2026-07-18T12:01:00+08:00", env: readyEnv() }).length, 1);
});

test("Youzan identity reconciliation quarantines duplicate Root ownership before external lookup", async () => {
  const data = candidateData();
  data.users.push({ user_id: "usr_root_2", root_user_id: "root_2" });
  data.rootUsers.push({ root_user_id: "root_2" });
  data.wechatIdentities.push(stampVerifiedWechatUnionId({
    wechat_identity_id: "wxi_2",
    root_user_id: "root_2",
    app_code: "MYROOT",
    openid: "openid-private-2",
    unionid: "union-private-001",
  }, { source: "CLOUDBASE", verifiedAt: "2026-07-11T00:00:00.000Z" }, { env: readyEnv() }));
  data.youzanOrders.push({
    order_id: "ord_duplicate_identity",
    user_id: "",
    youzan_order_no: "YZ-DUPLICATE-IDENTITY",
    youzan_yz_uid: "yz_duplicate",
    order_status: "PAID",
    delivery_status: "SHIPPED",
  });
  let called = false;

  const result = await reconcileYouzanIdentities(data, {
    execute: true,
    batchSize: 5,
    requestId: "yz-reconcile-duplicate",
    now: "2026-07-11T13:00:00+08:00",
  }, {
    env: readyEnv(),
    identityImplementation: async () => {
      called = true;
      return { status: "RESOLVED", identities: [{ youzanYzUid: "yz_duplicate" }] };
    },
  });

  assert.equal(called, false);
  assert.equal(result.executedCount, 2);
  assert.equal(result.reviewCount, 2);
  assert.equal(result.successCount, 0);
  assert.equal(data.youzanOrders[0].user_id, "");
  assert.equal(data.youzanCustomers.length, 0);
  assert.equal(data.youzanIdentityReconciliations.length, 2);
  assert.ok(data.youzanIdentityReconciliations.every((item) => item.error_code === "DUPLICATE_ROOT_UNIONID"));
  assert.equal(data.operationTasks.filter((item) => item.task_type === "YOUZAN_IDENTITY_REVIEW_REQUIRED").length, 1);
  assert.equal(candidateIdentities(data, { now: "2026-07-12T14:00:00+08:00", env: readyEnv() }).length, 0);

  data.wechatIdentities = data.wechatIdentities.filter((item) => item.root_user_id !== "root_2");
  assert.equal(candidateIdentities(data, { now: "2026-07-11T13:01:00+08:00", env: readyEnv() }).length, 1);

  const recovered = await reconcileYouzanIdentities(data, {
    execute: true,
    batchSize: 1,
    requestId: "yz-reconcile-duplicate-recovered",
    now: "2026-07-11T13:02:00+08:00",
  }, {
    env: readyEnv(),
    identityImplementation: async () => {
      called = true;
      return { status: "RESOLVED", identities: [{ youzanYzUid: "yz_duplicate" }] };
    },
  });

  assert.equal(called, true);
  assert.equal(recovered.successCount, 1);
  assert.equal(data.youzanOrders[0].user_id, "usr_root_1");
  assert.equal(data.operationTasks.find((item) => item.task_type === "YOUZAN_IDENTITY_REVIEW_REQUIRED").status, "DONE");
});

test("Youzan identity reconciliation never overwrites an existing yz_open_id owner", async () => {
  const data = candidateData();
  data.youzanCustomers.push({
    youzan_yz_uid: "yz_owner_conflict",
    root_user_id: "root_other",
    unionid: "",
    phone: "",
    nickname: "",
    match_source: "MANUAL",
  });
  data.youzanOrders.push({
    order_id: "ord_owner_conflict",
    user_id: "",
    youzan_order_no: "YZ-OWNER-CONFLICT",
    youzan_yz_uid: "yz_owner_conflict",
    order_status: "PAID",
    delivery_status: "SHIPPED",
  });

  const result = await reconcileYouzanIdentities(data, {
    execute: true,
    requestId: "yz-reconcile-owner-conflict",
    now: "2026-07-11T14:00:00+08:00",
  }, {
    env: readyEnv(),
    identityImplementation: async () => ({
      status: "RESOLVED",
      identities: [{ youzanYzUid: "yz_owner_conflict", phone: "13800000000" }],
    }),
  });

  assert.equal(result.reviewCount, 1);
  assert.equal(result.results[0].identityConflictCount, 1);
  assert.equal(result.results[0].errorCode, "YZ_OPEN_ID_OWNER_CONFLICT");
  assert.equal(data.youzanCustomers[0].root_user_id, "root_other");
  assert.equal(data.youzanOrders[0].user_id, "");
  assert.equal(data.operationTasks.filter((item) => item.task_type === "YOUZAN_IDENTITY_REVIEW_REQUIRED").length, 1);
  assert.equal(JSON.stringify(data.operationTasks).includes("yz_owner_conflict"), false);
  assert.equal(JSON.stringify(data.auditLogs).includes("union-private-001"), false);
});

test("Youzan identity reconciliation stops before lookup when the Root user bridge is missing", async () => {
  const data = candidateData();
  data.users = [];
  let called = false;

  const result = await reconcileYouzanIdentities(data, {
    execute: true,
    requestId: "yz-reconcile-missing-user",
    now: "2026-07-11T15:00:00+08:00",
  }, {
    env: readyEnv(),
    identityImplementation: async () => {
      called = true;
      return { status: "RESOLVED", identities: [{ youzanYzUid: "yz_missing_user" }] };
    },
  });

  assert.equal(called, false);
  assert.equal(result.reviewCount, 1);
  assert.equal(result.results[0].errorCode, "ROOT_USER_BRIDGE_MISSING");
  assert.equal(data.operationTasks[0].task_type, "YOUZAN_IDENTITY_REVIEW_REQUIRED");
});
