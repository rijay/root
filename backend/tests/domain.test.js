const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const domain = require("../src/domain");
const campaign = require("../src/campaign");
const { validateSnapshot } = require("../src/store");
const lifecycleExportDelivery = require("../src/adminLifecycleExportDelivery");
const alertWebhookAdapter = require("../src/operationalAlertWebhookAdapter");
const cloudbaseStoreReadiness = require("../src/cloudbaseStoreReadiness");
const manualReviewExplanation = require("../src/manualReviewExplanation");
const rootMemberCenterReadiness = require("../src/rootMemberCenterReadiness");
const { sessionTokenDigest } = require("../src/credentialProtection");

const verifiedWechatEnv = Object.freeze({
  NODE_ENV: "production",
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "domain-wechat-authority-test-key-with-strong-entropy-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "domain-wechat-authority-test-v1",
});

async function trustedWechatLogin(store, { openid, unionid, appCode = "MYROOT" }) {
  return domain.loginWithWechat(store, { appCode }, {
    env: { ...verifiedWechatEnv, ROOT_WECHAT_APP_CODE: appCode },
    trustedWechatIdentity: { source: "CLOUDBASE", appCode, openid, unionid },
  });
}

function readyMysqlAdapter() {
  return {
    kind: "mysql",
    getStoreHealth() {
      return {
        connected: true,
        transactional: true,
        multiInstanceSafe: true,
        migrationVersion: "002_core_relational.sql",
        revision: 7,
        projectionMode: "core-relational",
        leastPrivilegeReady: true,
        privilegeScope: "SCHEMA",
      };
    },
  };
}

function register(store, phone = "13800000001") {
  const login = domain.login(store, { phone }).data;
  domain.submitFormalProfile(store, login.token, {
    nickname: "Root用户",
    birthDate: "1990-01-01",
    gender: "MALE",
  });
  return login.token;
}

test("external adapter samples import orders and fulfillment updates", () => {
  const store = domain.createStore();
  const orderImport = domain.importExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    samples: [
      {
        有赞订单号: "YZROOT202605160001",
        收货人: "林小样",
        收货手机号: "13800001111",
        商品名称: "ROOT 7日试饮装",
        实付金额: "199",
        订单状态: "已支付",
        物流状态: "已发货",
        支付时间: "2026-05-16T10:00:00+08:00",
        收货地址: "上海市样例地址",
      },
    ],
  }, "2026-05-16").data;
  const fulfillmentImport = domain.importExternalSamples(store, {
    sourceType: "FULFILLMENT",
    samples: [
      {
        有赞订单号: "YZROOT202605160001",
        快递公司: "SF",
        运单号: "SFROOT0516001",
        物流状态: "已签收",
        签收时间: "2026-05-18T11:20:00+08:00",
        最新物流节点: "本人签收",
      },
    ],
  }, "2026-05-18").data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160001");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(orderImport.importedCount, 1);
  assert.equal(fulfillmentImport.importedCount, 1);
  assert.equal(order.receiver_phone, "13800001111");
  assert.equal(order.order_status, "PAID");
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(fulfillment.tracking_no, "SFROOT0516001");
});

test("external adapter samples validate and import wechat leads", () => {
  const store = domain.createStore();
  const preview = domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    samples: [{ 收货人: "缺少订单号" }],
  }).data;
  const imported = domain.importExternalSamples(store, {
    sourceType: "WECHAT_LEAD",
    samples: [
      {
        外部联系人ID: "wm_external_sample_001",
        企业微信备注名: "林小样-ROOT试饮",
        来源活动: "线下沙龙",
        当前添加状态: "ADDED",
        运营备注: "已发送入组规则",
      },
    ],
  }, "2026-05-16").data;

  assert.equal(preview.errorCount, 1);
  assert.equal(preview.rows[0].importable, false);
  assert.equal(imported.importedCount, 1);
  assert.equal(store.leadProfiles[0].external_contact_id, "wm_external_sample_001");
  assert.equal(store.operationTasks[0].task_type, "LEAD_NEEDS_MATCHING");
});

test("external adapter samples accept CSV and spreadsheet text", () => {
  const store = domain.createStore();
  const orderCsv = [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZROOT202605160088,周表格,13800008888,ROOT 7日试饮装,199,已支付,已发货,上海市表格地址",
  ].join("\n");
  const fulfillmentTsv = [
    "有赞订单号\t快递公司\t运单号\t物流状态\t签收时间\t最新物流节点",
    "YZROOT202605160088\tSF\tSFROOT0888\t已签收\t2026-05-18T10:00:00+08:00\t本人签收",
  ].join("\n");

  const orderImport = domain.importExternalSamples(store, { sourceType: "YOUZAN_ORDER", text: orderCsv }, "2026-05-16").data;
  const fulfillmentImport = domain.importExternalSamples(store, { sourceType: "FULFILLMENT", text: fulfillmentTsv }, "2026-05-18").data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160088");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(orderImport.importedCount, 1);
  assert.equal(fulfillmentImport.importedCount, 1);
  assert.equal(order.receiver_phone, "13800008888");
  assert.equal(order.amount, 199);
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(fulfillment.last_event_text, "本人签收");
});

test("real Youzan order and logistics CSV headers auto match WeChat phone users", () => {
  const store = domain.createStore();
  const login = domain.login(store, { phone: "13800018888" }).data;
  const userId = login.user.userId;
  const orderCsv = [
    "订单号,订单状态,买家付款时间,订单实付金额,全部商品名称,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址,买家手机号",
    "YZROOT202605270188,待发货,2026-05-27T10:05:00+08:00,199,ROOT 7日试饮装,林样本,13800018888,样本路1号,13900018888",
  ].join("\n");
  const logisticsCsv = [
    "快递公司,获取时间,电子面单号,订单号,运输状态,计费重量(KG),费用(元),快递运费(元),快递保费(元),快递耗材费(元),运费账户总支出(元),结算状态,收件人姓名,收件人联系方式,订单类型",
    "顺丰速运,2026-05-28T12:00:00+08:00,SF202605270188,YZROOT202605270188,已签收,1,12,12,0,0,12,已结算,林样本,13800018888,普通订单",
  ].join("\n");

  const orderImport = domain.importExternalSamples(store, { sourceType: "YOUZAN_ORDER", text: orderCsv }, "2026-05-27").data;
  const fulfillmentImport = domain.importExternalSamples(store, { sourceType: "FULFILLMENT", text: logisticsCsv }, "2026-05-28").data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605270188");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(orderImport.importedCount, 1);
  assert.equal(fulfillmentImport.importedCount, 1);
  assert.equal(order.user_id, userId);
  assert.equal(order.match_source, "AUTO_WECHAT_PHONE");
  assert.equal(order.receiver_phone, "13800018888");
  assert.equal(order.order_status, "PAID");
  assert.equal(fulfillment.tracking_no, "SF202605270188");
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(store.operationTasks.some((task) => task.task_type === "DELIVERED_NOT_STARTED" && task.user_id === userId), true);
});

test("manual external platform Adapter imports through the shared sample Interface", async () => {
  const store = domain.createStore();
  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160099,赵Adapter,13800009999,ROOT 7日试饮装,199,已支付,已发货,上海市Adapter地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16")).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160099");

  assert.equal(imported.success, true);
  assert.equal(imported.adapterKind, "MANUAL_SAMPLE");
  assert.equal(imported.mode, "IMPORT");
  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.review.mode, "ADAPTER_IMPORT");
  assert.equal(imported.run.imported_count, 1);
  assert.equal(store.externalAdapterRuns[0].run_id, imported.run.run_id);
  assert.equal(order.receiver_phone, "13800009999");

  await assert.rejects(
    () => domain.runExternalAdapter(store, { sourceType: "YOUZAN_ORDER", adapterKind: "YOUZAN_OPEN" }, { env: {} }, "2026-05-16"),
    /未配置/
  );
  assert.equal(store.externalAdapterRuns[0].status, "FAILED");
  assert.match(store.externalAdapterRuns[0].error_message, /未配置/);
  assert.equal(store.externalAdapterRuns[0].retry_status, "MANUAL_REVIEW");
  assert.equal(store.externalAdapterRuns[0].retry_attempt, 1);
  assert.equal(store.externalAdapterRuns[0].next_retry_at, "");
});

test("manual external platform Adapter import can be rolled back by run id", async () => {
  const store = domain.createStore();
  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160188,赵回滚,13800018888,ROOT 7日试饮装,199,已支付,已发货,上海市回滚地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16")).data;
  const importedOrder = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160188");

  const rollback = domain.rollbackExternalAdapterRun(store, {
    runId: imported.run.run_id,
    requestId: "adapter-rollback-domain-1",
    confirmRisk: true,
    operatorId: "ops-adapter",
    reason: "测试回滚 Adapter 导入",
  }).data;

  assert.equal(imported.run.rollback_targets.length, 2);
  assert.equal(rollback.summary.status, "ROLLED_BACK");
  assert.equal(rollback.summary.rolledBack, 2);
  assert.equal(store.youzanOrders.some((item) => item.youzan_order_no === "YZROOT202605160188"), false);
  assert.equal(store.orderFulfillments.some((item) => item.order_id === importedOrder.order_id), false);
  assert.equal(store.externalAdapterRuns[0].rollback_status, "ROLLED_BACK");
  assert.equal(store.auditLogs[0].action, "EXTERNAL_ADAPTER_RUN_ROLLBACK");
  assert.equal(store.auditLogs[0].target_id, imported.run.run_id);
});

test("manual external platform Adapter rollback restores existing record snapshots", async () => {
  const store = domain.createStore();
  await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160288,旧收货人,13800028888,ROOT 7日试饮装,199,已支付,已发货,上海市旧地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16");
  const orderUpdate = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160288,错误收货人,13800028888,ROOT 7日试饮装,299,已关闭,已发货,上海市错误地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16")).data;

  assert.equal(orderUpdate.run.rollback_targets.length, 1);
  assert.equal(orderUpdate.run.rollback_targets[0].metadata.beforeSnapshot.receiver_name, "旧收货人");
  assert.equal(store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160288").receiver_name, "错误收货人");

  const orderRollback = domain.rollbackExternalAdapterRun(store, {
    runId: orderUpdate.run.run_id,
    requestId: "adapter-rollback-order-snapshot-1",
    confirmRisk: true,
    operatorId: "ops-adapter",
    reason: "恢复订单旧字段",
  }).data;
  const restoredOrder = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160288");
  assert.equal(orderRollback.summary.status, "ROLLED_BACK");
  assert.equal(restoredOrder.receiver_name, "旧收货人");
  assert.equal(restoredOrder.amount, 199);
  assert.equal(restoredOrder.order_status, "PAID");
  assert.equal(restoredOrder.raw_address_text, "上海市旧地址");

  const fulfillmentUpdate = (await domain.runExternalAdapter(store, {
    sourceType: "FULFILLMENT",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞订单号,物流状态,快递公司,运单号,最新物流节点",
      "YZROOT202605160288,已签收,顺丰速运,SF288,已签收",
    ].join("\n"),
  }, { env: {} }, "2026-05-17")).data;
  assert.equal(fulfillmentUpdate.run.rollback_targets.length, 2);
  assert.equal(store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160288").delivery_status, "DELIVERED");
  assert.equal(store.orderFulfillments.find((item) => item.order_id === restoredOrder.order_id).delivery_status, "DELIVERED");

  domain.rollbackExternalAdapterRun(store, {
    runId: fulfillmentUpdate.run.run_id,
    requestId: "adapter-rollback-fulfillment-snapshot-1",
    confirmRisk: true,
    operatorId: "ops-adapter",
    reason: "恢复物流旧字段",
  });
  assert.equal(store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160288").delivery_status, "SHIPPED");
  assert.equal(store.orderFulfillments.find((item) => item.order_id === restoredOrder.order_id).delivery_status, "SHIPPED");
  assert.equal(store.orderFulfillments.find((item) => item.order_id === restoredOrder.order_id).carrier, "");

  await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_CUSTOMER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞客户ID,unionid,手机号,昵称",
      "YZCUSTOMER_SNAPSHOT_001,union_snapshot_001,13800029999,旧客户",
    ].join("\n"),
  }, { env: {} }, "2026-05-16");
  const customerUpdate = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_CUSTOMER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "有赞客户ID,unionid,手机号,昵称",
      "YZCUSTOMER_SNAPSHOT_001,union_snapshot_001,13800029999,错误客户",
    ].join("\n"),
  }, { env: {} }, "2026-05-16")).data;
  domain.rollbackExternalAdapterRun(store, {
    runId: customerUpdate.run.run_id,
    requestId: "adapter-rollback-customer-snapshot-1",
    confirmRisk: true,
    operatorId: "ops-adapter",
    reason: "恢复客户旧字段",
  });
  assert.equal(store.youzanCustomers.find((item) => item.youzan_yz_uid === "YZCUSTOMER_SNAPSHOT_001").nickname, "旧客户");

  await domain.runExternalAdapter(store, {
    sourceType: "WECHAT_LEAD",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "外部联系人ID,企微备注,来源渠道,活动名称,添加状态,运营备注",
      "wm_snapshot_001,旧企微备注,线下路演,老活动,ADDED,旧备注",
    ].join("\n"),
  }, { env: {} }, "2026-05-16");
  const leadUpdate = (await domain.runExternalAdapter(store, {
    sourceType: "WECHAT_LEAD",
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text: [
      "外部联系人ID,企微备注,来源渠道,活动名称,添加状态,运营备注",
      "wm_snapshot_001,错误企微备注,线上误导入,错活动,REMOVED,错误备注",
    ].join("\n"),
  }, { env: {} }, "2026-05-16")).data;
  domain.rollbackExternalAdapterRun(store, {
    runId: leadUpdate.run.run_id,
    requestId: "adapter-rollback-lead-snapshot-1",
    confirmRisk: true,
    operatorId: "ops-adapter",
    reason: "恢复企微线索旧字段",
  });
  const restoredLead = store.leadProfiles.find((item) => item.external_contact_id === "wm_snapshot_001");
  assert.equal(restoredLead.wechat_remark_name, "旧企微备注");
  assert.equal(restoredLead.source_channel, "线下路演");
  assert.equal(restoredLead.operator_note, "旧备注");
});

test("real external platform Adapter Implementation can advance cursor after import", async () => {
  const store = domain.createStore();
  const context = {
    env: { YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
    adapterImplementations: {
      YOUZAN_OPEN: ({ cursor, limit }) => ({
        samples: [
          {
            有赞订单号: "YZROOT202605160199",
            收货人: "钱增量",
            收货手机号: "13800019999",
            商品名称: "ROOT 7日试饮装",
            实付金额: "199",
            订单状态: "已支付",
            物流状态: "已发货",
            收货地址: "上海市增量地址",
          },
        ],
        externalCount: limit,
        nextCursor: cursor ? `${cursor}-next` : "cursor-001",
        hasMore: false,
      }),
    },
  };
  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const catalog = domain.getExternalAdapters(store, context).data;

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.adapter_kind, "YOUZAN_OPEN");
  assert.equal(imported.run.cursor_after, "cursor-001");
  assert.equal(imported.cursor.cursor_value, "cursor-001");
  assert.equal(catalog.cursors[0].cursor_value, "cursor-001");
  assert.equal(catalog.catalog.realAdapters.find((item) => item.adapterKind === "YOUZAN_OPEN").status, "READY");

  const rollback = domain.rollbackExternalAdapterRun(store, {
    runId: imported.run.run_id,
    requestId: "adapter-rollback-cursor-1",
    confirmRisk: true,
    operatorId: "ops-adapter",
    reason: "测试回滚真实 Adapter 游标",
  }).data;
  assert.equal(rollback.cursor.status, "ROLLED_BACK");
  assert.equal(store.externalAdapterCursors[0].cursor_value, "");
  assert.equal(store.externalAdapterCursors[0].last_successful_run_id, "");
});

test("real external platform Adapter failures record retry strategy and lineage", async () => {
  const store = domain.createStore();
  let calls = 0;
  const context = {
    env: { YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
    adapterImplementations: {
      YOUZAN_OPEN: () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("有赞上游 502");
          error.code = 502;
          throw error;
        }
        return {
          samples: [
            {
              有赞订单号: "YZROOT202605160255",
              收货人: "重试用户",
              收货手机号: "13800025555",
              商品名称: "ROOT 7日试饮装",
              实付金额: "199",
              订单状态: "已支付",
              物流状态: "已发货",
              收货地址: "上海市重试地址",
            },
          ],
          externalCount: 1,
          nextCursor: "retry-cursor-001",
          hasMore: false,
        };
      },
    },
  };

  await assert.rejects(
    () => domain.runExternalAdapter(store, {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "YOUZAN_OPEN",
      mode: "PREVIEW",
      limit: 1,
    }, context, "2026-05-16"),
    /有赞上游 502/
  );
  const failedRun = store.externalAdapterRuns[0];

  assert.equal(failedRun.status, "FAILED");
  assert.equal(failedRun.retry_status, "RETRYABLE");
  assert.equal(failedRun.retry_attempt, 1);
  assert.match(failedRun.next_retry_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(failedRun.retry_source_run_id, "");
  assert.match(failedRun.retry_reason, /有赞上游 502/);

  const retried = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "PREVIEW",
    limit: 1,
    retrySourceRunId: failedRun.run_id,
  }, context, "2026-05-16")).data;

  assert.equal(retried.run.status, "COMPLETED");
  assert.equal(retried.run.retry_status, "RETRY_SUCCEEDED");
  assert.equal(retried.run.retry_attempt, 2);
  assert.equal(retried.run.retry_source_run_id, failedRun.run_id);
  assert.equal(retried.run.next_retry_at, "");
  assert.equal(retried.result.importableCount, 1);
});

test("adapter retry scheduler previews and executes due retryable runs", async () => {
  const store = domain.createStore();
  let calls = 0;
  const context = {
    env: { YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
    adapterImplementations: {
      YOUZAN_OPEN: () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("有赞临时限流 429");
          error.code = 429;
          throw error;
        }
        return {
          samples: [
            {
              有赞订单号: "YZROOT202605160333",
              收货人: "自动重试用户",
              收货手机号: "13800033333",
              商品名称: "ROOT 7日试饮装",
              实付金额: "199",
              订单状态: "已支付",
              物流状态: "已发货",
              收货地址: "上海市自动重试地址",
            },
          ],
          externalCount: 1,
          nextCursor: "retry-scheduler-cursor",
          hasMore: false,
        };
      },
    },
  };

  await assert.rejects(
    () => domain.runExternalAdapter(store, {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "YOUZAN_OPEN",
      mode: "PREVIEW",
      limit: 1,
    }, context, "2026-05-16"),
    /有赞临时限流 429/
  );
  const failedRun = store.externalAdapterRuns[0];
  failedRun.next_retry_at = "2026-05-16T10:00:00+08:00";

  const preview = (await domain.runDueExternalAdapterRetries(store, {
    dryRun: true,
    now: "2026-05-16T10:06:00+08:00",
  }, context)).data;

  assert.equal(preview.dryRun, true);
  assert.equal(preview.selectedCount, 1);
  assert.equal(preview.executedCount, 0);
  assert.equal(preview.candidates[0].run_id, failedRun.run_id);

  const executed = (await domain.runDueExternalAdapterRetries(store, {
    dryRun: false,
    now: "2026-05-16T10:06:00+08:00",
  }, context)).data;

  assert.equal(executed.dryRun, false);
  assert.equal(executed.executedCount, 1);
  assert.equal(executed.successCount, 1);
  assert.equal(executed.failedCount, 0);
  assert.equal(executed.results[0].sourceRun.run_id, failedRun.run_id);
  assert.equal(executed.results[0].run.retry_status, "RETRY_SUCCEEDED");
  assert.equal(executed.results[0].run.retry_source_run_id, failedRun.run_id);

  const after = (await domain.runDueExternalAdapterRetries(store, {
    dryRun: true,
    now: "2026-05-16T10:07:00+08:00",
  }, context)).data;

  assert.equal(after.selectedCount, 0);
  assert.ok(after.skipped.some((item) => item.reason === "CHILD_RETRY_EXISTS" && item.run.run_id === failedRun.run_id));
});

test("built-in Youzan HTTP Adapter maps configurable response and advances cursor", async () => {
  const store = domain.createStore();
  const calls = [];
  const context = {
    env: {
      YOUZAN_CLIENT_ID: "client",
      YOUZAN_CLIENT_SECRET: "secret",
      YOUZAN_ACCESS_TOKEN: "token",
      YOUZAN_ORDER_LIST_URL: "https://youzan.example/open/orders",
      YOUZAN_ORDER_LIST_DATA_PATH: "data.items",
      YOUZAN_ORDER_LIST_CURSOR_PATH: "data.nextCursor",
      YOUZAN_ORDER_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            items: [
              {
                tid: "YZROOT202605160299",
                receiver_name: "孙HTTP",
                receiver_tel: "13800029999",
                orders: [{ title: "ROOT 7日试饮装", item_id: "ROOT-PREBIOTIC-TRIAL" }],
                pay_amount: "199",
                status: "已支付",
                shipping_status: "已发货",
                address: "上海市HTTP地址",
              },
            ],
            nextCursor: "youzan-cursor-002",
            hasMore: true,
          },
        }),
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605160299");

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "youzan-cursor-002");
  assert.equal(imported.run.has_more, true);
  assert.equal(imported.cursor.cursor_value, "youzan-cursor-002");
  assert.equal(order.receiver_phone, "13800029999");
  assert.equal(calls[0].url, "https://youzan.example/open/orders?access_token=token");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("admin order increment sync previews, imports, commits cursor, and audits", async () => {
  const store = domain.createStore();
  const context = {
    env: {
      YOUZAN_CLIENT_ID: "client",
      YOUZAN_CLIENT_SECRET: "secret",
      YOUZAN_ACCESS_TOKEN: "token",
      YOUZAN_ORDER_LIST_URL: "https://youzan.example/open/orders",
    },
    adapterImplementations: {
      YOUZAN_OPEN: ({ cursor, limit }) => ({
        samples: [
          {
            youzanOrderNo: cursor ? "YZ_INCREMENT_002" : "YZ_INCREMENT_001",
            receiverPhone: cursor ? "13800088102" : "13800088101",
            receiverName: "增量用户",
            productName: "ROOT 7日试饮装",
            amount: "199",
            orderStatus: "PAID",
            deliveryStatus: "SHIPPED",
            rawAddressText: "上海市增量同步地址",
          },
        ].slice(0, limit || 1),
        externalCount: 1,
        nextCursor: cursor ? "order-cursor-002" : "order-cursor-001",
        hasMore: true,
      }),
    },
  };

  const preview = (await domain.previewAdminOrderIncrementSync(store, {
    limit: 1,
  }, context)).data;
  assert.equal(preview.summary.adapterKind, "YOUZAN_OPEN");
  assert.equal(preview.summary.importableCount, 1);
  assert.equal(preview.summary.importedCount, 0);
  assert.equal(preview.summary.cursorAfter, "order-cursor-001");
  assert.equal(store.youzanOrders.some((order) => order.youzan_order_no === "YZ_INCREMENT_001"), false);

  const executed = (await domain.executeAdminOrderIncrementSync(store, {
    limit: 1,
    requestId: "order-increment-1",
    confirmRisk: true,
    operatorId: "ops-order",
    reason: "有赞订单增量同步测试",
  }, context)).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZ_INCREMENT_001");
  const cursor = store.externalAdapterCursors.find((item) => item.adapter_key === "YOUZAN_ORDER:YOUZAN_OPEN");

  assert.equal(executed.summary.importedCount, 1);
  assert.equal(order.receiver_phone, "13800088101");
  assert.equal(cursor.cursor_value, "order-cursor-001");
  assert.equal(executed.audit.action, "YOUZAN_ORDER_INCREMENT_SYNC");
  assert.equal(executed.audit.target_id, "order-increment-1");
});

test("Youzan customer mirror links customer and order by unionid", async () => {
  const store = domain.createStore();
  const login = await trustedWechatLogin(store, {
    openid: "youzan_customer_union_openid",
    unionid: "youzan_customer_unionid",
    appCode: "MYROOT",
  });

  const customerImport = domain.importExternalSamples(store, {
    sourceType: "YOUZAN_CUSTOMER",
    samples: [
      {
        有赞客户ID: "yz_customer_union_001",
        unionid: "youzan_customer_unionid",
        手机号: "13900018888",
        昵称: "有赞客户样本",
      },
    ],
  }, "2026-05-18", { env: verifiedWechatEnv }).data;
  const orderImport = domain.importExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    samples: [
      {
        有赞订单号: "YZROOT202605180188",
        有赞客户ID: "yz_customer_union_001",
        unionid: "youzan_customer_unionid",
        收货人: "有赞订单样本",
        收货手机号: "13900018888",
        商品名称: "ROOT 7日试饮装",
        实付金额: "199",
        订单状态: "已支付",
        物流状态: "已签收",
        收货地址: "上海市客户补链地址",
      },
    ],
  }, "2026-05-18", { env: verifiedWechatEnv }).data;
  const customer = store.youzanCustomers.find((item) => item.youzan_yz_uid === "yz_customer_union_001");
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605180188");
  const customerMirror = domain.listAdminYouzanCustomers(store, { keyword: "yz_customer_union_001" }).data.customers[0];

  assert.equal(customerImport.importedCount, 1);
  assert.equal(orderImport.importedCount, 1);
  assert.equal(customer.root_user_id, login.data.user.rootUserId);
  assert.equal(customer.match_source, "UNIONID");
  assert.equal(order.youzan_yz_uid, "yz_customer_union_001");
  assert.equal(order.user_id, login.data.user.userId);
  assert.equal(order.match_source, "AUTO_YOUZAN_CUSTOMER");
  assert.equal(customerMirror.linkStatus, "LINKED");
  assert.equal(customerMirror.orderSummary.totalOrders, 1);
  assert.equal(customerMirror.orderSummary.boundOrders, 1);
  assert.equal(customerMirror.orderSummary.latestOrderNo, "YZROOT202605180188");
  assert.equal(store.userLifecycleEvents.some((event) => event.event_type === "YOUZAN_CUSTOMER_LINKED"), true);
});

test("built-in Youzan customer Adapter imports customers and advances cursor", async () => {
  const store = domain.createStore();
  const login = await trustedWechatLogin(store, {
    openid: "youzan_customer_adapter_openid",
    unionid: "youzan_customer_adapter_unionid",
    appCode: "MYROOT",
  });
  const calls = [];
  const context = {
    env: {
      ...verifiedWechatEnv,
      NODE_ENV: "test",
      YOUZAN_CUSTOMER_LIST_URL: "https://youzan.example/customers",
      YOUZAN_CUSTOMER_ACCESS_TOKEN: "customer-token",
      YOUZAN_CUSTOMER_LIST_DATA_PATH: "data.customers",
      YOUZAN_CUSTOMER_LIST_CURSOR_PATH: "data.nextCursor",
      YOUZAN_CUSTOMER_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              customers: [
                {
                  yz_uid: "yz_customer_http_001",
                  unionid: "youzan_customer_adapter_unionid",
                  mobile: "13800048888",
                  nickname: "HTTP客户",
                },
              ],
              nextCursor: "customer-cursor-002",
              hasMore: false,
            },
          };
        },
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_CUSTOMER",
    adapterKind: "YOUZAN_CUSTOMER",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-18")).data;
  const customer = store.youzanCustomers.find((item) => item.youzan_yz_uid === "yz_customer_http_001");

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "customer-cursor-002");
  assert.equal(imported.cursor.cursor_value, "customer-cursor-002");
  assert.equal(customer.root_user_id, login.data.user.rootUserId);
  assert.equal(customer.nickname, "HTTP客户");
  assert.equal(calls[0].url, "https://youzan.example/customers?access_token=customer-token");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("built-in fulfillment HTTP Adapter updates delivery status and advances cursor", async () => {
  const store = domain.createStore();
  const calls = [];
  const context = {
    env: {
      ROOT_FULFILLMENT_SECRET: "fulfillment-secret",
      ROOT_FULFILLMENT_LIST_URL: "https://fulfillment.example/events",
      ROOT_FULFILLMENT_LIST_DATA_PATH: "data.events",
      ROOT_FULFILLMENT_LIST_CURSOR_PATH: "data.nextCursor",
      ROOT_FULFILLMENT_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            events: [
              {
                order_no: "YZROOT202604260002",
                express_company: "SF",
                waybill_no: "SFHTTP0002",
                logistics_status: "已签收",
                signed_at: "2026-05-16T12:30:00+08:00",
                latest_trace: "本人签收",
              },
            ],
            nextCursor: "fulfillment-cursor-002",
            hasMore: false,
          },
        }),
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "FULFILLMENT",
    adapterKind: "FULFILLMENT_PUSH",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202604260002");
  const fulfillment = store.orderFulfillments.find((item) => item.order_id === order.order_id);

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "fulfillment-cursor-002");
  assert.equal(imported.cursor.cursor_value, "fulfillment-cursor-002");
  assert.equal(fulfillment.delivery_status, "DELIVERED");
  assert.equal(fulfillment.tracking_no, "SFHTTP0002");
  assert.equal(calls[0].url, "https://fulfillment.example/events");
  assert.equal(calls[0].init.headers["X-Root-Fulfillment-Secret"], "fulfillment-secret");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("built-in WeWork contact HTTP Adapter imports leads and advances cursor", async () => {
  const store = domain.createStore();
  const calls = [];
  const context = {
    env: {
      WEWORK_CORP_ID: "corp-root",
      WEWORK_CONTACT_SECRET: "contact-secret",
      WEWORK_ACCESS_TOKEN: "access-token",
      WEWORK_CONTACT_LIST_URL: "https://wework.example/external-contacts",
      WEWORK_CONTACT_LIST_DATA_PATH: "data.contacts",
      WEWORK_CONTACT_LIST_CURSOR_PATH: "data.nextCursor",
      WEWORK_CONTACT_LIST_HAS_MORE_PATH: "data.hasMore",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            contacts: [
              {
                external_userid: "wm_http_001",
                remark: "周企微-ROOT试饮",
                mobile: "13800038888",
                source: "线下沙龙",
                activity_name: "五月试饮会",
                status: "ADDED",
                note: "已发送入组规则",
              },
            ],
            nextCursor: "wework-cursor-002",
            hasMore: false,
          },
        }),
      };
    },
  };

  const imported = (await domain.runExternalAdapter(store, {
    sourceType: "WECHAT_LEAD",
    adapterKind: "WEWORK_CONTACT",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16")).data;
  const lead = store.leadProfiles.find((item) => item.external_contact_id === "wm_http_001");

  assert.equal(imported.result.importedCount, 1);
  assert.equal(imported.run.cursor_after, "wework-cursor-002");
  assert.equal(imported.cursor.cursor_value, "wework-cursor-002");
  assert.equal(lead.wechat_remark_name, "周企微-ROOT试饮");
  assert.equal(lead.receiver_phone, "13800038888");
  assert.equal(lead.source_channel, "线下沙龙");
  assert.equal(calls[0].url, "https://wework.example/external-contacts?access_token=access-token");
  assert.equal(JSON.parse(calls[0].init.body).page_size, 1);
});

test("cloudbase store readiness classifies production store decisions", () => {
  const missing = cloudbaseStoreReadiness.buildCloudbaseStoreReadiness({
    env: {},
    target: "production",
    storeAdapter: { kind: "memory" },
  });
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.selectedDecision, "UNDECIDED");

  const ready = cloudbaseStoreReadiness.buildCloudbaseStoreReadiness({
    target: "production",
    storeAdapter: readyMysqlAdapter(),
    env: {
      ROOT_CLOUDBASE_STORE_DECISION: "MYSQL_ON_CLOUDBASE",
      ROOT_CLOUDBASE_ENV_ID: "root-prod-env",
      ROOT_CLOUDBASE_REGION: "ap-shanghai",
      ROOT_CLOUDBASE_STORE_BACKUP_PLAN: "每日快照 + 发布前手工快照",
      ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN: "按发布前快照回滚",
      ROOT_CLOUDBASE_STORE_PROOF: "release-proof-001",
      MYSQL_ADDRESS: "10.0.0.10:3306",
      MYSQL_USERNAME: "root",
      MYSQL_PASSWORD: "secret",
      MYSQL_DATABASE: "root_checkin",
    },
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.selectedDecision, "MYSQL_ON_CLOUDBASE");
  assert.equal(ready.summary.mysqlEnvReady, true);
  assert.equal(ready.summary.continuityReady, true);

  const unprovenMysql = cloudbaseStoreReadiness.buildCloudbaseStoreReadiness({
    target: "production",
    storeAdapter: { kind: "mysql" },
    env: {
      ROOT_CLOUDBASE_STORE_DECISION: "MYSQL_ON_CLOUDBASE",
      ROOT_CLOUDBASE_ENV_ID: "root-prod-env",
      ROOT_CLOUDBASE_REGION: "ap-shanghai",
      ROOT_CLOUDBASE_STORE_BACKUP_PLAN: "每日快照",
      ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN: "按快照回滚",
      ROOT_CLOUDBASE_STORE_PROOF: "release-proof-unproven",
      MYSQL_ADDRESS: "10.0.0.10:3306",
      MYSQL_USERNAME: "root",
      MYSQL_PASSWORD: "secret",
      MYSQL_DATABASE: "root_checkin",
    },
  });
  assert.equal(unprovenMysql.status, "BLOCKED");
  assert.ok(unprovenMysql.blockers.some((item) => item.includes("事务")));

  const unsupported = cloudbaseStoreReadiness.buildCloudbaseStoreReadiness({
    target: "production",
    storeAdapter: { kind: "memory" },
    env: {
      ROOT_CLOUDBASE_STORE_DECISION: "CLOUDBASE_DATABASE",
      ROOT_CLOUDBASE_ENV_ID: "root-prod-env",
      ROOT_CLOUDBASE_REGION: "ap-shanghai",
      ROOT_CLOUDBASE_STORE_BACKUP_PLAN: "CloudBase 导出",
      ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN: "CloudBase 导入",
      ROOT_CLOUDBASE_STORE_PROOF: "release-proof-002",
    },
  });
  assert.equal(unsupported.status, "BLOCKED");
  assert.ok(unsupported.blockers.some((item) => item.includes("CloudBase Database Store Adapter")));
});

test("root member center readiness gates myRoot purchase jumps", () => {
  const rootMemberCenterShortLink = "#小程序://ROOT会员中心/lnQOjYsk8gZoABH";
  const store = domain.createStore();
  const blocked = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data: store,
    env: {},
    target: "production",
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.summary.activeProductCount, 1);
  assert.equal(blocked.summary.missingAppIdCount, 1);
  assert.equal(blocked.summary.missingPathCount, 0);

  const configuredWithoutProof = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data: domain.createStore(),
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
    target: "production",
  });
  assert.equal(configuredWithoutProof.status, "BLOCKED");
  assert.equal(configuredWithoutProof.summary.missingProofCount, 1);

  const readyStore = domain.createStore();
  const jumpProof = domain.recordRootMemberCenterJumpProof(readyStore, {
    target: "production",
    productId: "ROOT_PREBIOTIC_TRIAL",
    status: "VERIFIED",
    appId: "wx_root_member_center",
    path: rootMemberCenterShortLink,
    evidenceRef: "https://root.example.com/proofs/jump?token=secret-token",
    note: "体验版跳转通过 openid=raw-openid unionid=raw-unionid 13800000000",
    requestId: "root-member-center-jump-proof-1",
    operatorId: "release-engineer",
  }).data;
  const repeatedJumpProof = domain.recordRootMemberCenterJumpProof(readyStore, {
    target: "production",
    productId: "ROOT_PREBIOTIC_TRIAL",
    status: "VERIFIED",
    appId: "wx_root_member_center",
    path: rootMemberCenterShortLink,
    requestId: "root-member-center-jump-proof-1",
  }).data;
  const jumpProofs = domain.listRootMemberCenterJumpProofs(readyStore, { target: "production" }).data.latest;
  const ready = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data: readyStore,
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
    target: "production",
    proofs: jumpProofs,
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.appIdSource, "ROOT_MEMBER_CENTER_APPID");
  assert.equal(ready.summary.readyProductCount, 1);
  assert.equal(ready.summary.verifiedProofCount, 1);
  assert.equal(ready.products[0].pathSource, "PRODUCT");
  assert.equal(ready.products[0].proofStatus, "VERIFIED");
  assert.equal(jumpProof.proof.evidenceRef, "https://root.example.com/proofs/jump");
  assert.equal(JSON.stringify(jumpProof).includes("secret-token"), false);
  assert.equal(JSON.stringify(jumpProof).includes("raw-openid"), false);
  assert.equal(repeatedJumpProof.idempotent, true);
  assert.equal(readyStore.auditLogs[0].action, "ROOT_MEMBER_CENTER_JUMP_PROOF_RECORD");
  assert.equal(validateSnapshot(readyStore, { seedSampleData: true }).valid, true);

  const conflictStore = domain.createStore();
  conflictStore.youzanProducts[0].youzan_app_id = "wx_other_member_center";
  domain.recordRootMemberCenterJumpProof(conflictStore, {
    target: "production",
    productId: "ROOT_PREBIOTIC_TRIAL",
    status: "VERIFIED",
    appId: "wx_root_member_center",
    path: rootMemberCenterShortLink,
    evidenceRef: "https://root.example.com/proofs/conflict",
    requestId: "root-member-center-jump-proof-conflict",
  });
  const conflict = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data: conflictStore,
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
    target: "production",
    proofs: domain.listRootMemberCenterJumpProofs(conflictStore, { target: "production" }).data.latest,
  });
  assert.equal(conflict.status, "NEEDS_REVIEW");
  assert.ok(conflict.warnings.some((item) => item.includes("appId 一致性")));

  const rejectedStore = domain.createStore();
  domain.recordRootMemberCenterJumpProof(rejectedStore, {
    target: "production",
    productId: "ROOT_PREBIOTIC_TRIAL",
    status: "REJECTED",
    appId: "wx_root_member_center",
    path: rootMemberCenterShortLink,
    note: "体验版无法跳转",
    requestId: "root-member-center-jump-proof-rejected",
  });
  const rejected = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data: rejectedStore,
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
    target: "production",
    proofs: domain.listRootMemberCenterJumpProofs(rejectedStore, { target: "production" }).data.latest,
  });
  assert.equal(rejected.status, "BLOCKED");
  assert.equal(rejected.summary.rejectedProofCount, 1);

  const missingPathStore = domain.createStore();
  missingPathStore.youzanProducts[0].youzan_path = "";
  const missingPath = rootMemberCenterReadiness.buildRootMemberCenterReadiness({
    data: missingPathStore,
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
    target: "production",
  });
  assert.equal(missingPath.status, "BLOCKED");
  assert.equal(missingPath.summary.missingPathCount, 1);
});

test("external adapter sample reviews track coverage and unknown status values", () => {
  const store = domain.createStore();
  const result = domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "有赞订单号,收货手机号,订单状态,物流状态",
      "YZROOT202605160077,13800007777,已支付,派送失败",
    ].join("\n"),
  }).data;
  const review = result.review;

  assert.equal(result.importableCount, 0);
  assert.equal(review.decision_status, "NEEDS_MAPPING");
  assert.equal(review.field_coverage.youzanOrderNo.rate, 100);
  assert.equal(review.field_coverage.rawAddressText.rate, 0);
  assert.equal(review.unknown_status_values[0].field, "deliveryStatus");
  assert.equal(review.unknown_status_values[0].value, "派送失败");
  assert.equal(review.rows[0].index, 1);
  assert.equal(review.rows[0].raw.物流状态, "派送失败");
  assert.match(review.rows[0].mapped.youzanOrderNo, /已脱敏/);
  assert.equal(review.rows[0].errors[0], "deliveryStatus 未知：派送失败");
  assert.equal(store.externalSampleReviews[0].review_id, review.review_id);
  const lookup = domain.listExternalSampleReviews(store, { reviewId: review.review_id }).data;
  assert.equal(lookup.review.review_id, review.review_id);
  assert.equal(lookup.reviews.length, 1);
  assert.equal(lookup.reviews[0].field_coverage.youzanOrderNo.rate, 100);
  assert.equal(lookup.review.rows[0].raw.订单状态, "已支付");
});

test("external status mappings resolve unknown sample values", () => {
  const store = domain.createStore();
  const text = [
    "有赞订单号,收货手机号,订单状态,物流状态",
    "YZROOT202605160078,13800007778,已支付,派送失败",
  ].join("\n");
  const before = domain.previewExternalSamples(store, { sourceType: "YOUZAN_ORDER", text }).data;
  const mapping = domain.upsertExternalStatusMapping(store, {
    sourceType: "YOUZAN_ORDER",
    field: "deliveryStatus",
    rawValue: "派送失败",
    canonicalValue: "EXCEPTION",
  }).data.mapping;
  const after = domain.previewExternalSamples(store, { sourceType: "YOUZAN_ORDER", text }).data;

  assert.equal(before.review.decision_status, "NEEDS_MAPPING");
  assert.equal(mapping.canonical_value, "EXCEPTION");
  assert.equal(after.rows[0].mapped.deliveryStatus, "EXCEPTION");
  assert.equal(after.importableCount, 1);
  assert.equal(after.review.decision_status, "NEEDS_REVIEW");
});

test("admin order matching searches candidates and previews a clean match", () => {
  const store = domain.createStore();
  const token = register(store, "13800000001");
  const userId = domain.getUserState(store, token).data.user.userId;

  const search = domain.searchAdminOrderMatching(store, { q: "13800000001" }).data;
  const preview = domain.previewAdminOrderMatch(store, { orderId: "ord_root_001", userId }).data;
  const confirmed = domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId }, "2026-04-28").data;

  assert.equal(search.orders.some((order) => order.youzanOrderNo === "YZROOT202604260001"), true);
  assert.equal(search.users.some((user) => user.userId === userId), true);
  assert.equal(preview.risks.length, 0);
  assert.equal(preview.canConfirm, true);
  assert.equal(confirmed.order.userId, userId);
  assert.equal(confirmed.order.matchSource, "ADMIN_MANUAL_MATCH");
  assert.equal(confirmed.task.task_type, "DELIVERED_NOT_STARTED");
});

test("admin order matching requires risk confirmation for phone mismatch", () => {
  const store = domain.createStore();
  const token = register(store, "13800000003");
  const userId = domain.getUserState(store, token).data.user.userId;

  const preview = domain.previewAdminOrderMatch(store, { orderId: "ord_root_001", userId }).data;

  assert.equal(preview.risks.some((item) => item.type === "PHONE_MISMATCH"), true);
  assert.equal(preview.requiresSecondConfirm, true);
  assert.throws(() => domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId }), /请先确认风险提示/);

  const confirmed = domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId, confirmRisks: true }, "2026-04-28").data;
  assert.equal(confirmed.success, true);
  assert.equal(confirmed.order.userId, userId);
});

test("admin order matching protects order rebind with note", () => {
  const store = domain.createStore();
  const firstToken = register(store, "13800000001");
  const firstUserId = domain.getUserState(store, firstToken).data.user.userId;
  domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId: firstUserId }, "2026-04-28");

  const secondToken = register(store, "13800000003");
  const secondUserId = domain.getUserState(store, secondToken).data.user.userId;
  const preview = domain.previewAdminOrderMatch(store, { orderId: "ord_root_001", userId: secondUserId }).data;

  assert.equal(preview.canConfirm, false);
  assert.equal(preview.risks.some((item) => item.type === "ORDER_BOUND_TO_OTHER_USER"), true);
  assert.throws(
    () => domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId: secondUserId, confirmRisks: true }),
    /确认改绑必须/
  );

  const confirmed = domain.confirmAdminOrderMatch(store, {
    orderId: "ord_root_001",
    userId: secondUserId,
    confirmRisks: true,
    confirmRebind: true,
    note: "用户提供新手机号凭证",
  }, "2026-04-28").data;
  assert.equal(confirmed.order.userId, secondUserId);
  assert.equal(store.youzanOrders.find((order) => order.order_id === "ord_root_001").user_id, secondUserId);
});

test("admin order matching creates exception task after matching abnormal fulfillment", () => {
  const store = domain.createStore();
  const token = register(store, "13800000999");
  const userId = domain.getUserState(store, token).data.user.userId;
  domain.syncManualOrder(store, {
    youzanOrderNo: "YZROOT202605240999",
    receiverName: "异常用户",
    receiverPhone: "13800000999",
    amount: 199,
    deliveryStatus: "EXCEPTION",
  });

  const preview = domain.previewAdminOrderMatch(store, { youzanOrderNo: "YZROOT202605240999", userId }).data;
  const confirmed = domain.confirmAdminOrderMatch(store, {
    youzanOrderNo: "YZROOT202605240999",
    userId,
    confirmRisks: true,
  }, "2026-05-24").data;

  assert.equal(preview.risks.some((item) => item.type === "FULFILLMENT_EXCEPTION"), true);
  assert.equal(confirmed.task.task_type, "FULFILLMENT_EXCEPTION");
});

test("manual corrections require risk confirmation and write audit logs", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");
  const userId = domain.getUserState(store, token).data.user.userId;
  const preview = domain.previewCorrection(store, {
    action: "BIND_ORDER_USER",
    orderId: "ord_root_001",
    userId,
  }).data;

  assert.equal(preview.risks.some((item) => item.type === "PHONE_MISMATCH"), true);
  assert.throws(
    () => domain.applyCorrection(store, { action: "BIND_ORDER_USER", orderId: "ord_root_001", userId }),
    /高风险修正必须填写原因/
  );
  assert.throws(
    () => domain.applyCorrection(store, { action: "BIND_ORDER_USER", orderId: "ord_root_001", userId, reason: "用户提供截图" }),
    /二次确认/
  );

  const applied = domain.applyCorrection(store, {
    action: "BIND_ORDER_USER",
    orderId: "ord_root_001",
    userId,
    reason: "用户提供订单截图",
    confirmRisk: true,
    operatorId: "ops-a",
  }, {}, "2026-05-28").data;
  const audit = domain.listAuditLogs(store, { targetType: "ORDER", targetId: "ord_root_001" }).data.auditLogs[0];

  assert.equal(applied.success, true);
  assert.equal(store.youzanOrders.find((order) => order.order_id === "ord_root_001").user_id, userId);
  assert.equal(store.youzanOrders.find((order) => order.order_id === "ord_root_001").match_source, "MANUAL_CORRECTION");
  assert.equal(audit.action, "BIND_ORDER_USER");
  assert.equal(audit.operator_id, "ops-a");
  assert.equal(audit.reason, "用户提供订单截图");
});

test("manual corrections can update fulfillment, unbind order, and ignore conflict tasks", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");
  const userId = domain.getUserState(store, token).data.user.userId;
  domain.confirmAdminOrderMatch(store, { orderId: "ord_root_002", userId }, "2026-05-28");

  const delivered = domain.applyCorrection(store, {
    action: "UPDATE_FULFILLMENT_STATUS",
    orderId: "ord_root_002",
    deliveryStatus: "DELIVERED",
    reason: "物流后台显示已签收",
    operatorId: "ops-a",
  }, {}, "2026-05-28").data;
  assert.equal(delivered.result.fulfillment.delivery_status, "DELIVERED");
  assert.equal(store.operationTasks.some((task) => task.task_type === "DELIVERED_NOT_STARTED" && task.order_id === "ord_root_002"), true);

  assert.throws(
    () => domain.applyCorrection(store, { action: "UNBIND_ORDER_USER", orderId: "ord_root_002", reason: "误绑" }),
    /二次确认/
  );
  domain.applyCorrection(store, {
    action: "UNBIND_ORDER_USER",
    orderId: "ord_root_002",
    reason: "误绑订单",
    confirmRisk: true,
    operatorId: "ops-a",
  });
  assert.equal(store.youzanOrders.find((order) => order.order_id === "ord_root_002").user_id, "");

  domain.syncManualOrder(store, {
    youzanOrderNo: "YZROOT202605280222",
    receiverPhone: "13800000002",
    receiverName: "冲突用户",
    amount: 199,
  });
  const conflict = store.operationTasks.find((task) => task.task_type === "ORDER_PHONE_MATCH_CONFLICT");
  assert.ok(conflict);
  const ignored = domain.applyCorrection(store, {
    action: "IGNORE_CONFLICT",
    taskId: conflict.task_id,
    reason: "已人工确认无需处理",
    operatorId: "ops-b",
  }).data;

  assert.equal(ignored.result.task.status, "SKIPPED");
  assert.equal(domain.listAuditLogs(store, {}).data.auditLogs.length >= 3, true);
});

test("consultations create user-visible follow-up status without legacy task progress", () => {
  const store = domain.createStore();
  const token = register(store, "13800000886");

  const recorded = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-19",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-19", consultationType: "PRODUCT", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-followup-product",
  }).data;
  const repeated = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-19",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-19", consultationType: "PRODUCT", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-followup-product",
  }).data;
  assert.throws(() => domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "ORDER", scene: "ORDER_PAGE" },
    idempotencyKey: "domain-consultation-followup-product",
  }), {
    code: 40901,
    status: 409,
  });
  const pendingView = domain.getUserConsultations(store, token).data;

  assert.equal(recorded.created, true);
  assert.equal(recorded.task.task_type, "CONSULTATION_FOLLOW");
  assert.equal(repeated.created, false);
  assert.equal(pendingView.summary.pendingCount, 1);
  assert.equal(pendingView.consultations[0].consultationTypeLabel, "产品使用");
  assert.equal(pendingView.consultations[0].status, "PENDING");
  assert.equal(store.taskEvents.length, 0);
  assert.equal(store.operationTasks.filter((task) => task.task_type === "CONSULTATION_FOLLOW").length, 1);
  assert.equal(Object.hasOwn(store, "taskProgressSnapshots"), false);

  domain.completeOperationTask(store, recorded.task.task_id, { result: "WEWORK_CONTACTED", note: "已通过企微联系" });
  const doneView = domain.getUserConsultations(store, token).data;
  const lifecycle = domain.getAdminLifecycleWorkbench(store).data;

  assert.equal(doneView.summary.pendingCount, 0);
  assert.equal(doneView.summary.handledCount, 1);
  assert.equal(doneView.consultations[0].status, "DONE");
  assert.equal(doneView.consultations[0].statusCopy, "已通过企微联系");
  assert.equal(lifecycle.users.some((row) => row.consultationSummary.handledCount === 1), true);
});

test("WeWork touch planning queues follow-up tasks and reactivates after contact linkage", async () => {
  const store = domain.createStore();
  const token = register(store, "13800000888");

  const recorded = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-wework-touch-consultation",
  }).data;
  const taskId = recorded.task.task_id;
  const blockedPlan = domain.planWeWorkTouches(store, {
    dryRun: false,
    taskTypes: ["CONSULTATION_FOLLOW"],
    adapterMode: "MANUAL",
    requestId: "domain-wework-touch-blocked-1",
    now: "2026-06-20T10:00:00.000Z",
  }).data;

  assert.equal(blockedPlan.createdCount, 1);
  assert.equal(blockedPlan.blockedCount, 1);
  assert.equal(blockedPlan.jobs[0].status, "BLOCKED");
  assert.equal(blockedPlan.candidates[0].blockedReason, "缺少企业微信外部联系人 ID");

  store.leadProfiles.push({
    lead_id: "lead_wework_touch_001",
    user_id: recorded.task.user_id,
    external_contact_id: "wm_touch_001",
    wechat_remark_name: "ROOT自动触达用户",
    receiver_phone: "",
    source_channel: "WEWORK",
    offline_event_name: "",
    corp_wechat_status: "ADDED",
    operator_note: "",
    created_at: "2026-06-20T10:01:00.000Z",
    updated_at: "2026-06-20T10:01:00.000Z",
  });

  const reactivatedPlan = domain.planWeWorkTouches(store, {
    dryRun: false,
    taskTypes: ["CONSULTATION_FOLLOW"],
    adapterMode: "MANUAL",
    requestId: "domain-wework-touch-reactivate-1",
    now: "2026-06-20T10:05:00.000Z",
  }).data;
  const run = await domain.runDueWeWorkTouches(store, {
    dryRun: false,
    taskTypes: ["CONSULTATION_FOLLOW"],
    adapterMode: "MANUAL",
    batchSize: 5,
    requestId: "domain-wework-touch-run-1",
    now: "2026-06-20T10:06:00.000Z",
  });
  const jobs = domain.listWeWorkTouchJobs(store, { taskId }).data.jobs;
  const doneView = domain.getUserConsultations(store, token).data;

  assert.equal(reactivatedPlan.createdCount, 0);
  assert.equal(reactivatedPlan.reactivatedCount, 1);
  assert.equal(reactivatedPlan.jobs[0].status, "PENDING");
  assert.equal(reactivatedPlan.jobs[0].externalContactId, "wm_touch_001");
  assert.equal(run.data.successCount, 1);
  assert.equal(run.data.results[0].job.status, "DELIVERED");
  assert.equal(run.data.results[0].task.status, "DONE");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "DELIVERED");
  assert.equal(jobs[0].attemptCount, 1);
  assert.equal(doneView.summary.pendingCount, 0);
  assert.equal(doneView.summary.handledCount, 1);
  assert.equal(store.auditLogs.some((log) => log.action === "WEWORK_TOUCH_PLAN"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "WEWORK_TOUCH_RUN" && log.target_id === jobs[0].touchJobId), true);
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation WeWork writeback records contact evidence and closes follow task", async () => {
  const store = domain.createStore();
  const token = register(store, "13800000887");
  const calls = [];

  const recorded = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-wework-writeback",
  }).data;
  store.leadProfiles.push({
    lead_id: "lead_consultation_writeback_001",
    user_id: recorded.task.user_id,
    external_contact_id: "wm_consultation_001",
    wechat_remark_name: "ROOT测试用户",
    receiver_phone: "",
    source_channel: "WEWORK",
    offline_event_name: "路演",
    corp_wechat_status: "ADDED",
    rule_sent_at: "",
    operator_note: "",
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
  });

  const writeback = await domain.recordConsultationWeworkWriteback(store, {
    taskId: recorded.task.task_id,
    adapterMode: "WEWORK_CONTACT_WRITEBACK",
    note: "已通过企微确认身体反馈 token=secret-token",
    requestId: "domain-consultation-wework-writeback-1",
    operatorId: "ops-consultation",
  }, {
    env: {
      WEWORK_CONTACT_WRITEBACK_URL: "https://wework.example/writeback",
      WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN: "wework-writeback-token",
      WEWORK_CONTACT_WRITEBACK_RESULT_REF_PATH: "data.followupId",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ errcode: 0, data: { followupId: "fw_001", message: "ok" } }),
      };
    },
  });
  const repeated = await domain.recordConsultationWeworkWriteback(store, {
    taskId: recorded.task.task_id,
    requestId: "domain-consultation-wework-writeback-1",
  });
  const doneView = domain.getUserConsultations(store, token).data;
  const writebacks = domain.listConsultationWeworkWritebacks(store, { userId: recorded.task.user_id }).data;

  assert.equal(writeback.data.success, true);
  assert.equal(writeback.data.writeback.status, "DELIVERED");
  assert.equal(writeback.data.writeback.externalContactId, "wm_consultation_001");
  assert.equal(writeback.data.writeback.externalRef, "fw_001");
  assert.equal(writeback.data.task.status, "DONE");
  assert.equal(repeated.data.idempotent, true);
  assert.equal(doneView.summary.handledCount, 1);
  assert.equal(doneView.consultations[0].statusCopy, "已通过企微确认身体反馈 token=***");
  assert.equal(writebacks.writebacks.length, 1);
  assert.equal(JSON.stringify(store.consultationWeworkWritebacks[0]).includes("secret-token"), false);
  assert.equal(store.auditLogs.some((log) => log.action === "CONSULTATION_WEWORK_WRITEBACK"), true);
  assert.equal(calls[0].url, "https://wework.example/writeback?access_token=wework-writeback-token");
  const requestBody = JSON.parse(calls[0].init.body);
  assert.equal(requestBody.taskId, recorded.task.task_id);
  assert.equal(requestBody.externalContactId, "wm_consultation_001");
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation advisor assignment records owner and supports automatic routing", () => {
  const store = domain.createStore();
  const token = register(store, "13800000889");

  const first = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "ORDER", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-assignment-1",
  }).data;
  const manual = domain.recordConsultationAdvisorAssignment(store, {
    taskId: first.task.task_id,
    advisorId: "advisor-a",
    advisorName: "顾问A",
    requestId: "domain-consultation-advisor-assignment-manual",
    operatorId: "ops-consultation",
  }).data;
  const repeated = domain.recordConsultationAdvisorAssignment(store, {
    taskId: first.task.task_id,
    requestId: "domain-consultation-advisor-assignment-manual",
  }).data;

  const second = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-21",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-21", consultationType: "PRODUCT", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-assignment-2",
  }).data;
  const automatic = domain.recordConsultationAdvisorAssignment(store, {
    taskId: second.task.task_id,
    assignmentMode: "AUTO",
    advisors: "advisor-a:顾问A,advisor-b:顾问B",
    requestId: "domain-consultation-advisor-assignment-auto",
    operatorId: "ops-consultation",
  }).data;
  const view = domain.getUserConsultations(store, token).data;
  const assignments = domain.listConsultationAdvisorAssignments(store, { userId: first.task.user_id }).data;

  assert.equal(manual.assignment.advisorId, "advisor-a");
  assert.equal(manual.task.metadata.assignedAdvisorName, "顾问A");
  assert.equal(repeated.idempotent, true);
  assert.equal(automatic.assignment.assignmentMode, "AUTO");
  assert.equal(automatic.assignment.advisorId, "advisor-b");
  assert.equal(view.consultations.find((item) => item.consultationId === second.item.consultationId).assignedAdvisorName, "顾问B");
  assert.equal(assignments.assignments.length, 2);
  assert.equal(store.auditLogs.some((log) => log.action === "CONSULTATION_ADVISOR_ASSIGN"), true);
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation advisor workbench groups workload by advisor and SLA", () => {
  const store = domain.createStore();
  const firstToken = register(store, "13800000891");
  const secondToken = register(store, "13800000892");

  const first = domain.recordUserConsultation(store, firstToken, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "ORDER", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-workbench-1",
  }).data;
  store.operationTasks.find((task) => task.task_id === first.task.task_id).created_at = "2026-01-01T08:00:00+08:00";
  domain.recordConsultationAdvisorAssignment(store, {
    taskId: first.task.task_id,
    advisorId: "advisor-a",
    advisorName: "顾问A",
    requestId: "domain-consultation-workbench-advisor-a",
    operatorId: "ops-consultation",
  });

  const second = domain.recordUserConsultation(store, secondToken, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "PRODUCT", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-workbench-2",
  }).data;
  store.operationTasks.find((task) => task.task_id === second.task.task_id).created_at = "2026-01-01T10:00:00+08:00";

  const workbench = domain.getConsultationAdvisorWorkbench(store, {
    slaMinutes: 120,
    now: "2026-01-01T11:30:00+08:00",
  }, {
    env: { ROOT_CONSULTATION_ADVISORS: "advisor-a:顾问A,advisor-b:顾问B" },
  }).data;
  const unassigned = domain.getConsultationAdvisorWorkbench(store, {
    advisorStatus: "UNASSIGNED",
    slaMinutes: 120,
    now: "2026-01-01T11:30:00+08:00",
  }).data;

  assert.equal(workbench.summary.openCount, 2);
  assert.equal(workbench.summary.overdueCount, 1);
  assert.equal(workbench.summary.dueSoonCount, 1);
  assert.equal(workbench.summary.unassignedCount, 1);
  assert.equal(workbench.summary.advisorCount, 2);
  assert.equal(workbench.summary.activeAdvisorCount, 1);
  assert.equal(workbench.summary.idleAdvisorCount, 1);
  assert.equal(workbench.advisors.find((item) => item.advisorId === "advisor-a").status, "ATTENTION");
  assert.equal(workbench.advisors.find((item) => item.advisorId === "advisor-b").status, "IDLE");
  assert.equal(workbench.advisors.find((item) => item.advisorRole === "UNASSIGNED").status, "WATCH");
  assert.equal(unassigned.items.length, 1);
  assert.equal(unassigned.advisors.length, 1);
  assert.equal(unassigned.advisors[0].advisorRole, "UNASSIGNED");
  assert.equal(unassigned.items[0].taskId, second.task.task_id);
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation SLA marks overdue follow tasks and feeds operational alerts", async () => {
  const store = domain.createStore();
  const token = register(store, "13800000890");

  const recorded = domain.recordUserConsultation(store, token, {
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-sla-overdue",
  }).data;
  store.operationTasks.find((task) => task.task_id === recorded.task.task_id).created_at = "2026-01-01T08:00:00+08:00";
  domain.recordConsultationAdvisorAssignment(store, {
    taskId: recorded.task.task_id,
    advisorId: "advisor-sla",
    advisorName: "SLA顾问",
    requestId: "domain-consultation-sla-advisor",
    operatorId: "ops-consultation",
  });

  const sla = domain.getConsultationSla(store, {
    rootUserId: recorded.item.rootUserId,
    slaMinutes: 120,
    now: "2026-01-01T11:30:00+08:00",
  }).data;
  const escalation = domain.getConsultationSlaEscalations(store, {
    rootUserId: recorded.item.rootUserId,
    slaMinutes: 120,
    now: "2026-01-01T11:30:00+08:00",
  }).data;
  const view = domain.getUserConsultations(store, token).data;
  const analytics = domain.getAdminOperationalAnalytics(store, { campaignId: "ROOT_7D_RESET" }).data;
  const job = await domain.runAdminOperationalAlertJob(store, {
    campaignId: "ROOT_7D_RESET",
    dryRun: false,
    requestId: "domain-consultation-sla-alert-job",
    operatorId: "ops-consultation",
  });
  const notification = store.operationalAlertNotifications.find((item) => item.alert_key === `consultation_sla_overdue_${recorded.task.task_id}`);
  const escalationNotification = store.operationalAlertNotifications.find((item) => String(item.alert_key || "").startsWith(`consultation_sla_escalation_${recorded.task.task_id}_`));

  assert.equal(sla.summary.overdueCount, 1);
  assert.equal(sla.items[0].status, "OVERDUE");
  assert.equal(sla.items[0].assignedAdvisorName, "SLA顾问");
  assert.equal(sla.items[0].overdueMinutes, 90);
  assert.equal(escalation.summary.escalatedCount, 1);
  assert.equal(escalation.items[0].escalationLevel, 2);
  assert.equal(escalation.items[0].escalationOwnerRole, "运营");
  assert.equal(escalation.items[0].nextEscalationLabel, "负责人升级");
  assert.equal(view.consultations[0].slaStatus, "OVERDUE");
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_consultation_sla_overdue"));
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_consultation_sla_escalation"));
  assert.ok(analytics.alerts.some((item) => item.key === `consultation_sla_overdue_${recorded.task.task_id}` && item.assignedAdvisorName === "SLA顾问"));
  assert.ok(analytics.alerts.some((item) => item.key.startsWith(`consultation_sla_escalation_${recorded.task.task_id}_`) && item.escalationLevel >= 2));
  assert.ok(job.data.alerts.some((item) => item.consultationTaskId === recorded.task.task_id));
  assert.ok(job.data.alerts.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION" && item.escalationOwnerRole));
  assert.ok(notification);
  assert.ok(escalationNotification);
  assert.equal(notification.owner_role, "运营");
  assert.equal(notification.payload_json.alert.assignedAdvisorName, "SLA顾问");
  assert.equal(escalationNotification.owner_role, "运营主管");
  assert.ok(escalationNotification.payload_json.alert.escalationLevel >= 2);
  assert.equal(validateSnapshot(store).valid, true);
});

test("production phone login requires WeChat server credentials", async () => {
  const store = domain.createStore();
  await assert.rejects(
    () => domain.loginWithWechat(store, { wxCode: "wx_code", phoneCode: "phone_code" }),
    /服务端未配置微信登录密钥/
  );
});

test("phone login stores optional WeChat display profile", () => {
  const store = domain.createStore();
  const first = domain.login(store, {
    phone: "13800000001",
    nickname: "Root小路",
    avatarUrl: "https://thirdwx.qlogo.cn/avatar.png",
  }).data.user;

  assert.equal(first.nickname, "Root小路");
  assert.equal(first.avatarUrl, "https://thirdwx.qlogo.cn/avatar.png");

  const fallback = domain.login(store, { phone: "13800000002", nickname: "微信用户", avatarUrl: "file://local" }).data.user;
  assert.equal(fallback.nickname, "ROOT体验官");
  assert.equal(fallback.avatarUrl, "");

  const updated = domain.login(store, {
    phone: "13800000001",
    nickname: "Root体验同学",
    avatarUrl: "https://thirdwx.qlogo.cn/new-avatar.png",
  }).data.user;
  assert.equal(updated.nickname, "Root体验同学");
  assert.equal(updated.avatarUrl, "https://thirdwx.qlogo.cn/new-avatar.png");
});

test("phone login issues a persisted session with explicit expiry", () => {
  const store = domain.createStore();
  const login = domain.login(store, { phone: "13800000001" }).data;

  assert.match(login.token, /^root_/);
  assert.match(login.session.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].token, undefined);
  assert.equal(store.sessions[0].token_hash, sessionTokenDigest(login.token));
  assert.equal(domain.getUserState(store, login.token).data.user.phone, "138****0001");

  store.sessions[0].expires_at = "2000-01-01T00:00:00+08:00";
  assert.throws(() => domain.getUserState(store, login.token), /登录已过期/);
  assert.equal(Boolean(store.sessions[0].revoked_at), true);
  assert.equal(store.tokens[sessionTokenDigest(login.token)], undefined);
});

test("user can update display profile after phone login", () => {
  const store = domain.createStore();
  const login = domain.login(store, { phone: "13800000001" }).data;

  const updated = domain.updateDisplayProfile(store, login.token, {
    nickname: "Root记录官",
    avatarUrl: "cloud://prod-d3grtjkva76c93e00.avatars/root-avatar.jpg",
  }).data.user;

  assert.equal(updated.nickname, "Root记录官");
  assert.equal(updated.avatarUrl, "cloud://prod-d3grtjkva76c93e00.avatars/root-avatar.jpg");
  assert.throws(
    () => domain.updateDisplayProfile(store, login.token, { nickname: "微信用户", avatarUrl: "file://tmp/avatar.jpg" }),
    /请填写昵称或选择头像/
  );
});

test("cloudbase identity probe reports masked header status without raw identities", () => {
  const rawOpenid = "openid_probe_1234567890";
  const rawUnionid = "unionid_probe_abcdef1234";
  const ready = domain.getCloudbaseIdentityProbe({
    headers: {
      "x-wx-openid": rawOpenid,
      "x-wx-unionid": rawUnionid,
      "x-root-app-code": "root_member_center",
    },
    trustedWechatIdentity: {
      openid: rawOpenid,
      unionid: rawUnionid,
      appCode: "ROOT_MEMBER_CENTER",
      source: "CLOUDBASE",
    },
  }).data;
  const pending = domain.getCloudbaseIdentityProbe({
    headers: { "x-wx-openid": "openid_only_probe_1234" },
    trustedWechatIdentity: {
      openid: "openid_only_probe_1234",
      unionid: "",
      appCode: "MYROOT",
      source: "CLOUDBASE",
    },
  }).data;
  const rawHeaderOnly = domain.getCloudbaseIdentityProbe({
    headers: { "x-wx-openid": "untrusted_openid_probe" },
  }).data;
  const blocked = domain.getCloudbaseIdentityProbe({ headers: {} }).data;

  assert.equal(ready.status, "READY");
  assert.equal(ready.appCode, "ROOT_MEMBER_CENTER");
  assert.equal(ready.readyForUnionPrimaryKey, true);
  assert.equal(ready.openidPresent, true);
  assert.equal(ready.unionidPresent, true);
  assert.notEqual(ready.openidPreview, rawOpenid);
  assert.notEqual(ready.unionidPreview, rawUnionid);
  assert.equal(JSON.stringify(ready).includes(rawOpenid), false);
  assert.equal(JSON.stringify(ready).includes(rawUnionid), false);
  assert.ok(ready.checks.some((item) => item.id === "privacy_guard" && item.status === "PASS"));
  assert.equal(pending.status, "UNIONID_PENDING");
  assert.equal(pending.readyForUnionPrimaryKey, false);
  assert.equal(rawHeaderOnly.status, "BLOCKED");
  assert.equal(rawHeaderOnly.openidPresent, false);
  assert.equal(rawHeaderOnly.rawOpenidHeaderObserved, true);
  assert.ok(rawHeaderOnly.checks.some((item) => item.id === "trusted_identity" && item.status === "BLOCKER"));
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.checks.some((item) => item.id === "trusted_identity" && item.status === "BLOCKER"));
});

test("openid login creates root identity without requiring an order or phone", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "myroot_openid_without_phone",
    appCode: "MYROOT",
    sourceChannel: "ROADSHOW_QR",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const state = domain.getUserState(store, login.data.token).data;

  assert.equal(login.data.user.rootUserId, login.data.user.userId);
  assert.equal(login.data.user.phone, "");
  assert.equal(login.data.user.unionidStatus, "PENDING");
  assert.equal(login.data.nextRoute, "/pages/register/index");
  assert.equal(login.data.sessionOutcome, "NEW_USER");
  assert.equal(store.rootUsers.length, 1);
  assert.equal(store.wechatIdentities.length, 1);
  assert.equal(store.wechatIdentities[0].openid, "myroot_openid_without_phone");
  assert.equal(store.wechatIdentities[0].app_code, "MYROOT");
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "ROOT_USER_CREATED"), true);
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "WECHAT_LOGIN"), true);
  assert.equal(state.route, "/pages/register/index");
  assert.equal(state.sessionOutcome, "PROFILE_REQUIRED");
});

test("same openid can attach phone evidence without creating a second root user", async () => {
  const store = domain.createStore();
  const first = await domain.loginWithWechat(store, {
    openid: "myroot_openid_attach_phone",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const second = domain.login(store, {
    openid: "myroot_openid_attach_phone",
    appCode: "MYROOT",
    phone: "13800006666",
  }).data;

  assert.equal(second.user.userId, first.data.user.userId);
  assert.equal(store.rootUsers.length, 1);
  assert.equal(store.wechatIdentities.length, 1);
  assert.equal(store.userContactMethods.length, 1);
  assert.equal(store.userContactMethods[0].root_user_id, first.data.user.rootUserId);
  assert.equal(store.userContactMethods[0].phone_masked, "138****6666");
});

test("product mirror lists display products without requiring order binding", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "product_view_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  const products = domain.listProducts(store, login.data.token, {}, {
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
  }).data;
  const detail = domain.getProduct(store, login.data.token, "ROOT_PREBIOTIC_TRIAL", {
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
  }).data.product;

  assert.equal(products.products.length, 1);
  assert.equal(products.products[0].productId, "ROOT_PREBIOTIC_TRIAL");
  assert.equal(products.products[0].youzan.appId, "wx_root_member_center");
  assert.equal(products.products[0].youzan.shortLink, "#小程序://ROOT会员中心/lnQOjYsk8gZoABH");
  assert.equal(detail.title, "ROOT 益生菌试饮装");
  assert.equal(store.youzanOrders.some((order) => order.user_id === login.data.user.userId), false);
});

test("product mirror records jump and lifecycle event", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "product_jump_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  const jumped = domain.recordProductJump(store, login.data.token, {
    productId: "ROOT_PREBIOTIC_TRIAL",
    sourceChannel: "MINIPROGRAM_PRODUCT_TEST",
  }, {
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
  }).data;

  assert.equal(jumped.product.productId, "ROOT_PREBIOTIC_TRIAL");
  assert.equal(jumped.jumpTarget.appId, "wx_root_member_center");
  assert.equal(jumped.jumpTarget.shortLink, "#小程序://ROOT会员中心/lnQOjYsk8gZoABH");
  assert.equal(store.productJumpLogs.length, 1);
  assert.equal(store.productJumpLogs[0].root_user_id, login.data.user.rootUserId);
  assert.equal(store.productJumpLogs[0].youzan_product_id, "ROOT_PREBIOTIC_TRIAL");
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "PRODUCT_JUMP"), true);
});

test("admin can upsert product mirror snapshot manually", () => {
  const store = domain.createStore();
  const result = domain.upsertProduct(store, {
    youzanProductId: "ROOT_BUNDLE_14D",
    title: "ROOT 14 日补给套装",
    summary: "用于 14 天运营任务的商品展示快照",
    priceText: "¥399",
    campaignId: "ROOT_14D",
    displayOrder: 3,
    youzanAppId: "wx_root_member_center",
    youzanPath: "pages/product/detail?id=ROOT_BUNDLE_14D",
    skus: [
      { skuId: "ROOT_BUNDLE_14D_STANDARD", skuName: "标准装", price: 399, stockStatus: "UNKNOWN" },
    ],
  }, {
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
  }).data;
  const products = domain.listProducts(store, domain.login(store, { phone: "13800007777" }).data.token, { campaignId: "ROOT_14D" }, {
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
  }).data.products;

  assert.equal(result.product.productId, "ROOT_BUNDLE_14D");
  assert.equal(result.product.skus[0].skuName, "标准装");
  assert.equal(products.length, 1);
  assert.equal(products[0].productId, "ROOT_BUNDLE_14D");
});

test("admin can preview and execute Youzan product sync through configurable Adapter", async () => {
  const store = domain.createStore();
  let requestCount = 0;
  let requestedUrl = null;
  let requestedInit = null;
  const fetchImpl = async (url, init) => {
    requestCount += 1;
    requestedUrl = url;
    requestedInit = init;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            items: [
              {
                goods_id: "ROOT_SYNC_PRODUCT",
                goods_name: "ROOT 同步商品",
                selling_point: "自动同步样本",
                pic_url: "https://img.example/root-sync.png",
                price_text: "¥299",
                path: "pages/goods/detail?id=ROOT_SYNC_PRODUCT",
                sku_list: [
                  { sku_id: "ROOT_SYNC_PRODUCT_STANDARD", sku_name: "标准装", price: 299, stock_status: "NORMAL" },
                ],
              },
            ],
            next_cursor: "cursor-next",
            has_more: false,
          },
        };
      },
    };
  };
  const context = {
    fetchImpl,
    env: {
      ROOT_MEMBER_CENTER_APPID: "wx_root_member_center",
      YOUZAN_PRODUCT_LIST_URL: "https://youzan.example.test/products/list",
      YOUZAN_PRODUCT_ACCESS_TOKEN: "youzan-token",
      YOUZAN_PRODUCT_LIST_METHOD: "POST",
    },
  };

  const preview = await domain.previewAdminProductSync(store, {
    campaignId: "ROOT_SYNC_CAMPAIGN",
    limit: 25,
  }, context);

  assert.equal(preview.data.adapterMode, "YOUZAN_PRODUCT");
  assert.equal(preview.data.total, 1);
  assert.equal(preview.data.rows[0].productId, "ROOT_SYNC_PRODUCT");
  assert.equal(preview.data.rows[0].importable, true);
  assert.equal(store.youzanProducts.some((product) => product.youzan_product_id === "ROOT_SYNC_PRODUCT"), false);
  assert.equal(requestedUrl.searchParams.get("access_token"), "youzan-token");
  assert.equal(JSON.parse(requestedInit.body).page_size, 25);

  const executed = await domain.executeAdminProductSync(store, {
    campaignId: "ROOT_SYNC_CAMPAIGN",
    limit: 25,
    requestId: "domain-product-sync-1",
    confirmRisk: true,
    reason: "domain test product sync",
  }, context);
  const products = domain.listProducts(store, domain.login(store, { phone: "13800008877" }).data.token, { campaignId: "ROOT_SYNC_CAMPAIGN" }, {
    env: { ROOT_MEMBER_CENTER_APPID: "wx_root_member_center" },
  }).data.products;

  assert.equal(executed.data.importedCount, 1);
  assert.equal(executed.data.products[0].productId, "ROOT_SYNC_PRODUCT");
  assert.equal(products.length, 1);
  assert.equal(products[0].youzan.appId, "wx_root_member_center");
  assert.equal(products[0].skus[0].skuId, "ROOT_SYNC_PRODUCT_STANDARD");
  assert.equal(store.auditLogs.find((log) => log.action === "YOUZAN_PRODUCT_SYNC").target_id, "domain-product-sync-1");
  assert.equal(requestCount, 2);
});


test("order after-sales sync mirrors refund status without legacy task or reward side effects", () => {
  const store = domain.createStore();
  register(store, "13800000892");
  const user = store.users.find((item) => item.phone === "13800000892");
  const order = domain.syncManualOrder(store, {
    userId: user.user_id,
    youzanOrderNo: "YZ_AFTER_SALES_001",
    receiverPhone: "13800000892",
    receiverName: "售后同步用户",
    amount: 199,
    deliveryStatus: "DELIVERED",
  }).data.order;
  store.refundWorkItems.push({
    refund_work_item_id: "rwi_after_sales_001",
    session_id: "session_after_sales_001",
    user_id: user.user_id,
    order_id: order.orderId,
    youzan_order_no: order.youzanOrderNo,
    amount: 199,
    status: "PENDING",
    created_at: "2026-06-20T10:00:00.000Z",
    paid_at: "",
    note: "",
  });

  const requested = domain.upsertOrderAfterSalesRecord(store, {
    youzanOrderNo: "YZ_AFTER_SALES_001",
    afterSalesNo: "AS_ROOT_001",
    rawStatus: "WAIT_SELLER_AGREE",
    refundAmount: 199,
    reason: "用户申请退款",
    requestId: "domain-after-sales-requested-1",
  }).data;
  const refunded = domain.upsertOrderAfterSalesRecord(store, {
    youzanOrderNo: "YZ_AFTER_SALES_001",
    afterSalesNo: "AS_ROOT_001",
    rawStatus: "REFUND_SUCCESS",
    refundAmount: 199,
    reason: "有赞退款成功",
    requestId: "domain-after-sales-refunded-1",
  }).data;
  const records = domain.listOrderAfterSalesRecords(store, { youzanOrderNo: "YZ_AFTER_SALES_001" }).data.records;

  assert.equal(requested.created, true);
  assert.equal(requested.record.status, "REQUESTED");
  assert.equal(Object.hasOwn(requested, "followTask"), false);
  assert.equal(refunded.created, false);
  assert.equal(refunded.record.status, "REFUNDED");
  assert.equal(refunded.order.refund_status, "REFUNDED");
  assert.equal(refunded.refundWorkItem.status, "PAID");
  assert.equal(Object.hasOwn(refunded, "rewardRecovery"), false);
  assert.equal(records.length, 1);
  assert.equal(store.operationTasks.some((task) => task.task_type === "ORDER_AFTER_SALES_FOLLOW"), false);
  assert.equal(store.auditLogs.some((log) => log.action === "ORDER_AFTER_SALES_UPSERT"), true);
  assert.equal(validateSnapshot(store).valid, true);
});

test("manual review explanation template validation blocks unsafe user copy", () => {
  const valid = manualReviewExplanation.listManualReviewExplanationTemplates({
    manualReviewExplanationTemplates: {
      FREE_ORDER_REVIEW: {
        title: "免单复核",
        pendingReason: "核对 {{reason}} 与免单库存",
        evidenceRequired: ["打卡记录", "订单证据"],
        operatorGuidance: "先核库存，再核订单。",
      },
    },
  });
  const unsafe = manualReviewExplanation.validateManualReviewExplanationTemplates({
    manualReviewExplanationTemplates: {
      FREE_ORDER_REVIEW: {
        pendingReason: "用户 unionid 为 {{operatorId}} 时进入复核",
        evidenceRequired: ["订单证据"],
      },
    },
  });
  const invalidJson = manualReviewExplanation.validateManualReviewExplanationTemplates({
    manualReviewExplanationTemplates: "{bad json",
  });

  assert.equal(valid.status, "READY");
  assert.equal(valid.templates.find((item) => item.templateKey === "FREE_ORDER_REVIEW").configured, true);
  assert.equal(valid.templates.find((item) => item.templateKey === "FREE_ORDER_REVIEW").pendingReason, "核对 免单机会需要运营确认 与免单库存");
  assert.equal(unsafe.status, "BLOCKED");
  assert.equal(unsafe.errors.some((item) => item.field === "pendingReason" && item.message.includes("敏感")), true);
  assert.equal(unsafe.errors.some((item) => item.field === "pendingReason" && item.message.includes("内部占位符")), true);
  assert.equal(invalidJson.status, "BLOCKED");
  assert.equal(invalidJson.errors[0].field, "JSON");
});
