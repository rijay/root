const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const domain = require("../src/domain");
const { addDays } = require("../src/dates");
const { validateSnapshot } = require("../src/store");
const lifecycleExportDelivery = require("../src/adminLifecycleExportDelivery");
const alertWebhookAdapter = require("../src/operationalAlertWebhookAdapter");
const cloudbaseStoreReadiness = require("../src/cloudbaseStoreReadiness");
const manualReviewExplanation = require("../src/manualReviewExplanation");
const rootMemberCenterReadiness = require("../src/rootMemberCenterReadiness");

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
  domain.submitProfile(store, login.token, {
    joinReasons: ["health", "gut_flora"],
    gutHealthStatus: "normal",
    improvementMethods: ["diet", "probiotics"],
    stoolType: "type4",
  });
  return login.token;
}

function startMatchedCheckin(store, token, date = "2026-04-26") {
  domain.matchOrder(store, token, { phone: "13800000001" }, date);
  domain.startCheckin(store, token, { confirmReceived: true }, date);
}

function completeSevenDays(store, token, startDate = "2026-04-26") {
  for (let day = 1; day <= 7; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays(startDate, day - 1)
    );
  }
}

test("matches a delivered order without starting check-in automatically", () => {
  const store = domain.createStore();
  const token = register(store);
  const matched = domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26").data;

  assert.equal(matched.user.state, domain.STATES.REGISTERED_IDLE);
  assert.equal(matched.order.youzanOrderNo, "YZROOT202604260001");
  assert.equal(matched.order.deliveryStatus, "DELIVERED");
  assert.equal(matched.nextAction, "READY_TO_START");
  assert.equal(matched.canStartCheckin, true);
  assert.equal(matched.session, null);
  assert.equal(store.checkinSessions.length, 0);
  assert.equal(store.identityLinks[0].receiver_phone, "13800000001");
  const state = domain.getUserState(store, token).data;
  assert.equal(state.flowView, "READY_TO_START");
  assert.deepEqual(state.allowedActions, ["START_CHECKIN"]);
});

test("starts check-in only after a matched order is delivered", () => {
  const store = domain.createStore();
  const token = register(store);
  domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26");

  const started = domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26").data;

  assert.equal(started.user.state, domain.STATES.CHECKIN_ACTIVE);
  assert.equal(started.session.orderId, "ord_root_001");
  assert.equal(started.session.startDate, "2026-04-26");
});

test("matched shipped order waits for delivery before starting check-in", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");
  const matched = domain.matchOrder(store, token, { phone: "13800000002" }, "2026-04-26").data;

  assert.equal(matched.user.state, domain.STATES.REGISTERED_IDLE);
  assert.equal(matched.order.deliveryStatus, "SHIPPED");
  assert.equal(matched.nextAction, "WAITING_DELIVERY");
  assert.equal(matched.canStartCheckin, false);
  assert.equal(domain.getUserState(store, token).data.flowView, "WAITING_DELIVERY");
  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /物流送达后才能开始打卡/);
});

test("order already bound to another user enters conflict path", () => {
  const store = domain.createStore();
  const token = register(store, "13800000003");

  assert.throws(() => domain.matchOrder(store, token, { phone: "13800000099" }, "2026-04-26"), /订单已被其他用户绑定/);
  assert.equal(store.operationTasks.length, 1);
  assert.equal(store.operationTasks[0].task_type, "MANUAL_REVIEW_REQUIRED");
  assert.equal(domain.getUserState(store, token).data.flowView, "MANUAL_REVIEW_REQUIRED");
  assert.equal(store.checkinSessions.length, 0);
});

test("start check-in requires a matched order", () => {
  const store = domain.createStore();
  const token = register(store, "13800000888");

  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /请先匹配/);
  assert.equal(store.operationTasks[0].task_type, "MANUAL_REVIEW_REQUIRED");
  assert.equal(domain.getUserState(store, token).data.flowView, "MANUAL_REVIEW_REQUIRED");
});

test("delivered fulfillment creates ready-to-start task once", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");
  domain.matchOrder(store, token, { phone: "13800000002" }, "2026-04-26");

  const updated = domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27").data;
  const repeated = domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27").data;
  const ready = domain.getReadyToStartUsers(store, "2026-04-27").data.users;

  assert.equal(updated.task.task_type, "DELIVERED_NOT_STARTED");
  assert.equal(repeated.task.task_id, updated.task.task_id);
  assert.equal(store.operationTasks.length, 1);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].order.orderId, "ord_root_002");
  assert.equal(domain.getUserState(store, token).data.flowView, "READY_TO_START");
});

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

test("orders imported before login bind only when the authorized phone has one clear order", () => {
  const store = domain.createStore();
  domain.importExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "订单号,订单状态,订单实付金额,全部商品名称,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址",
      "YZROOT202605270199,待发货,199,ROOT 7日试饮装,赵样本,13800019999,样本地址",
    ].join("\n"),
  }, "2026-05-27");

  const login = domain.login(store, { phone: "13800019999" }).data;
  const order = store.youzanOrders.find((item) => item.youzan_order_no === "YZROOT202605270199");

  assert.equal(order.user_id, login.user.userId);
  assert.equal(order.match_source, "AUTO_WECHAT_PHONE");

  domain.importExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "订单号,订单状态,订单实付金额,全部商品名称,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址",
      "YZROOT202605270201,待发货,199,ROOT 7日试饮装,钱样本,13800020000,样本地址A",
      "YZROOT202605270202,待发货,199,ROOT 7日试饮装,钱样本,13800020000,样本地址B",
    ].join("\n"),
  }, "2026-05-27");
  const conflictLogin = domain.login(store, { phone: "13800020000" }).data;
  const conflictOrders = store.youzanOrders.filter((item) => item.receiver_phone === "13800020000");

  assert.equal(conflictOrders.every((item) => !item.user_id), true);
  assert.equal(conflictLogin.autoMatch.status, "CONFLICT");
  assert.equal(store.operationTasks.some((task) => task.task_type === "ORDER_PHONE_MATCH_CONFLICT"), true);
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

test("built-in Youzan coupon Adapter sends reward grant and records external reference", async () => {
  const store = domain.createStore();
  const calls = [];
  const login = await domain.loginWithWechat(store, {
    openid: "youzan_coupon_adapter_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `youzan-coupon-adapter-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "youzan-coupon-adapter-day8",
  });
  domain.evaluateUserSettlement(store, login.data.token, {});

  const deliveryJobId = store.rewardDeliveryJobs[0].reward_delivery_job_id;
  const couponGrant = store.rewardGrants.find((grant) => grant.reward_type === "YOUZAN_COUPON");
  couponGrant.payload_json = { couponId: "ROOT_COUPON_7D", yzUid: "yz_user_001" };
  const delivered = (await domain.executeAdminRewardDelivery(store, {
    deliveryJobIds: [deliveryJobId],
    confirmRisk: true,
    requestId: "youzan-coupon-delivery-1",
    operatorId: "ops-coupon",
    reason: "内置有赞券 Adapter 测试",
  }, {
    env: {
      YOUZAN_COUPON_SEND_URL: "https://youzan.example/open/coupon/send",
      YOUZAN_COUPON_ACCESS_TOKEN: "coupon-token",
      YOUZAN_COUPON_RESULT_REF_PATH: "data.couponNo",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            status: "SUCCESS",
            couponNo: "YZ_COUPON_HTTP_001",
            message: "发放成功",
          },
        }),
      };
    },
  })).data;
  const requestBody = JSON.parse(calls[0].init.body);

  assert.equal(delivered.summary.delivered, 1);
  assert.equal(store.rewardDeliveryJobs[0].status, "DELIVERED");
  assert.equal(couponGrant.status, "DELIVERED");
  assert.equal(couponGrant.external_ref, "YZ_COUPON_HTTP_001");
  assert.equal(calls[0].url, "https://youzan.example/open/coupon/send?access_token=coupon-token");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(requestBody.couponId, "ROOT_COUPON_7D");
  assert.equal(requestBody.yzUid, "yz_user_001");
  assert.equal(requestBody.rewardGrantId, couponGrant.reward_grant_id);
});

test("built-in Youzan coupon status Adapter updates reward external status", async () => {
  const store = domain.createStore();
  const calls = [];
  const login = await domain.loginWithWechat(store, {
    openid: "youzan_coupon_status_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `youzan-coupon-status-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "youzan-coupon-status-day8",
  });
  domain.evaluateUserSettlement(store, login.data.token, {});

  const deliveryJobId = store.rewardDeliveryJobs[0].reward_delivery_job_id;
  const couponGrant = store.rewardGrants.find((grant) => grant.reward_type === "YOUZAN_COUPON");
  await domain.executeAdminRewardDelivery(store, {
    deliveryJobIds: [deliveryJobId],
    confirmRisk: true,
    requestId: "youzan-coupon-status-delivery-1",
    externalRef: "YZ_COUPON_STATUS_001",
  });

  const queried = (await domain.queryAdminRewardDeliveryStatus(store, {
    deliveryJobIds: [deliveryJobId],
    requestId: "youzan-coupon-status-query-1",
    operatorId: "ops-coupon",
    reason: "查询有赞券核销状态",
  }, {
    env: {
      YOUZAN_COUPON_STATUS_URL: "https://youzan.example/open/coupon/status",
      YOUZAN_COUPON_STATUS_ACCESS_TOKEN: "status-token",
      YOUZAN_COUPON_STATUS_PATH: "data.useStatus",
      YOUZAN_COUPON_STATUS_REF_PATH: "data.couponNo",
      YOUZAN_COUPON_STATUS_USED_AT_PATH: "data.usedAt",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            useStatus: "USED",
            couponNo: "YZ_COUPON_STATUS_001",
            usedAt: "2026-06-28T12:30:00+08:00",
            message: "已核销",
          },
        }),
      };
    },
  })).data;

  assert.equal(queried.summary.updated, 1);
  assert.equal(queried.summary.byStatus.USED, 1);
  assert.equal(couponGrant.status, "USED");
  assert.equal(couponGrant.external_status, "USED");
  assert.equal(couponGrant.used_at, "2026-06-28T12:30:00+08:00");
  assert.equal(store.rewardDeliveryJobs[0].status, "DELIVERED");
  assert.equal(Boolean(store.rewardDeliveryJobs[0].status_checked_at), true);
  const statusUrl = new URL(calls[0].url);
  assert.equal(statusUrl.origin + statusUrl.pathname, "https://youzan.example/open/coupon/status");
  assert.equal(statusUrl.searchParams.get("access_token"), "status-token");
  assert.equal(statusUrl.searchParams.get("rewardGrantId"), couponGrant.reward_grant_id);
  assert.equal(statusUrl.searchParams.get("deliveryJobId"), deliveryJobId);
  assert.equal(statusUrl.searchParams.get("externalRef"), "YZ_COUPON_STATUS_001");
  assert.equal(statusUrl.searchParams.get("coupon_no"), "YZ_COUPON_STATUS_001");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(store.auditLogs.some((log) => log.action === "REWARD_DELIVERY_STATUS_QUERY" && log.target_id === deliveryJobId), true);
});

test("built-in WeWork tag Adapter applies tag by linked external contact", async () => {
  const store = domain.createStore();
  const calls = [];
  const login = await domain.loginWithWechat(store, {
    openid: "wework_tag_adapter_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const rootUserId = login.data.user.rootUserId;
  if (!Array.isArray(store.leadProfiles)) store.leadProfiles = [];
  store.leadProfiles.push({
    lead_id: "lead_wework_tag_001",
    user_id: rootUserId,
    external_contact_id: "wm_tag_user_001",
    wechat_remark_name: "ROOT企微标签用户",
    receiver_phone: "",
    source_channel: "ROADSHOW_QR",
    offline_event_name: "",
    corp_wechat_status: "ADDED",
    operator_note: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  store.rewardGrants.push({
    reward_grant_id: "rgr_wework_tag_001",
    root_user_id: rootUserId,
    campaign_id: "default_root_membership",
    settlement_record_id: "",
    reward_type: "TAG",
    reward_key: "wework_21d",
    title: "企微21天标签",
    description: "",
    status: "PENDING_DELIVERY",
    payload_json: { tagId: "tag_root_21d" },
    idempotency_key: "wework-tag-001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  store.rewardDeliveryJobs.push({
    reward_delivery_job_id: "rdj_wework_tag_001",
    reward_grant_id: "rgr_wework_tag_001",
    adapter_type: "WEWORK_TAG",
    status: "PENDING",
    attempt_count: 0,
    last_error: "",
    next_retry_at: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const workbench = domain.getAdminConfigWorkbench(store).data;
  const workbenchGrant = workbench.rewardGrants.find((item) => item.rewardGrantId === "rgr_wework_tag_001");
  const workbenchJob = workbench.deliveryJobs.find((item) => item.deliveryJobId === "rdj_wework_tag_001");

  assert.equal(workbenchGrant.weworkTagHint.externalContactId, "wm_tag_user_001");
  assert.equal(workbenchGrant.weworkTagHint.tagId, "tag_root_21d");
  assert.equal(workbenchGrant.weworkTagHint.tagName, "企微21天标签");
  assert.equal(workbenchJob.weworkTagHint.externalContactId, "wm_tag_user_001");
  assert.equal(workbenchJob.weworkTagHint.tagId, "tag_root_21d");

  const delivered = (await domain.executeAdminRewardDelivery(store, {
    deliveryJobIds: ["rdj_wework_tag_001"],
    confirmRisk: true,
    requestId: "wework-tag-delivery-1",
    operatorId: "ops-wework",
    reason: "发放企微标签",
  }, {
    env: {
      WEWORK_TAG_APPLY_URL: "https://wework.example/tag/apply",
      WEWORK_TAG_ACCESS_TOKEN: "wework-tag-token",
      WEWORK_TAG_RESULT_REF_PATH: "data.applyId",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            errcode: 0,
            applyId: "WW_TAG_JOB_001",
            message: "标签写入成功",
          },
        }),
      };
    },
  })).data;
  const requestBody = JSON.parse(calls[0].init.body);
  const tagGrant = store.rewardGrants.find((grant) => grant.reward_grant_id === "rgr_wework_tag_001");

  assert.equal(delivered.summary.delivered, 1);
  assert.equal(tagGrant.status, "DELIVERED");
  assert.equal(tagGrant.external_ref, "WW_TAG_JOB_001");
  assert.equal(store.rewardDeliveryJobs[0].status, "DELIVERED");
  assert.equal(calls[0].url, "https://wework.example/tag/apply?access_token=wework-tag-token");
  assert.equal(requestBody.external_userid, "wm_tag_user_001");
  assert.equal(requestBody.tag_id, "tag_root_21d");
  assert.equal(requestBody.rewardGrantId, "rgr_wework_tag_001");
});

test("Youzan customer mirror links customer and order by unionid", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "youzan_customer_union_openid",
    unionid: "youzan_customer_unionid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

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
  }, "2026-05-18").data;
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
  }, "2026-05-18").data;
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
  const login = await domain.loginWithWechat(store, {
    openid: "youzan_customer_adapter_openid",
    unionid: "youzan_customer_adapter_unionid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const calls = [];
  const context = {
    env: {
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

test("adapter calibration reports config, runs, and cursors by source", async () => {
  const store = domain.createStore();
  const missing = domain.getAdapterCalibration(store, { env: {} }).data;

  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.sources.find((item) => item.adapterKind === "YOUZAN_OPEN").checks.some((check) => check.id === "configuration" && check.status === "BLOCKER"), true);

  const context = {
    env: { YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
    adapterImplementations: {
      YOUZAN_OPEN: () => ({
        samples: [
          {
            有赞订单号: "YZROOT202605160399",
            收货人: "校准用户",
            收货手机号: "13800039999",
            商品名称: "ROOT 7日试饮装",
            实付金额: "199",
            订单状态: "已支付",
            物流状态: "已发货",
            收货地址: "上海市校准地址",
          },
        ],
        nextCursor: "calibration-cursor-001",
      }),
    },
  };
  await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, context, "2026-05-16");
  const calibration = domain.getAdapterCalibration(store, {
    ...context,
    env: { ...context.env, YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
  }).data;
  const youzan = calibration.sources.find((item) => item.adapterKind === "YOUZAN_OPEN");

  assert.equal(youzan.checks.find((check) => check.id === "latest_run").status, "PASS");
  assert.equal(youzan.checks.find((check) => check.id === "cursor").status, "PASS");
  assert.equal(youzan.env.required.every((item) => item.present), true);
});

test("action adapter calibration gates external reward and WeWork actions", () => {
  const store = domain.createStore();
  const missing = domain.getActionAdapterCalibration(store, { env: {}, target: "production" }).data;
  const gray = domain.getActionAdapterCalibration(store, { env: {}, target: "gray" }).data;

  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.actions.length, 4);
  assert.equal(missing.summary.totalActionCount, 4);
  assert.ok(missing.actions.some((item) => item.id === "YOUZAN_COUPON_SEND"));
  assert.ok(missing.actions.every((item) => item.checks.some((check) => check.id === "live_evidence")));
  assert.equal(gray.status, "NEEDS_REVIEW");

  store.rewardDeliveryJobs.push({
    reward_delivery_job_id: "rdj_action_coupon_ready",
    request_id: "action-coupon-ready",
    reward_grant_id: "grant_action_coupon_ready",
    adapter_type: "YOUZAN_COUPON",
    status: "DELIVERED",
    external_ref: "coupon-real-001",
    external_result_json: { lastStatus: "USED", lastStatusCheckedAt: "2026-06-20T09:35:00+08:00" },
    delivered_at: "2026-06-20T09:30:00+08:00",
    status_checked_at: "2026-06-20T09:35:00+08:00",
    created_at: "2026-06-20T09:28:00+08:00",
    updated_at: "2026-06-20T09:35:00+08:00",
  });
  store.rewardDeliveryJobs.push({
    reward_delivery_job_id: "rdj_action_wework_tag_ready",
    request_id: "action-wework-tag-ready",
    reward_grant_id: "grant_action_wework_tag_ready",
    adapter_type: "WEWORK_TAG",
    status: "DELIVERED",
    external_ref: "wework-tag-real-001",
    external_result_json: { tagId: "tag-root-active" },
    delivered_at: "2026-06-20T09:40:00+08:00",
    created_at: "2026-06-20T09:38:00+08:00",
    updated_at: "2026-06-20T09:40:00+08:00",
  });
  store.consultationWeworkWritebacks.push({
    writeback_id: "wwb_action_ready",
    request_id: "action-wework-writeback-ready",
    adapter_type: "WEWORK_CONTACT_WRITEBACK",
    status: "DELIVERED",
    external_ref: "wework-writeback-real-001",
    delivered_at: "2026-06-20T09:45:00+08:00",
    created_at: "2026-06-20T09:44:00+08:00",
  });

  const env = {
    YOUZAN_COUPON_SEND_URL: "https://youzan.example.com/coupon/send",
    YOUZAN_COUPON_STATUS_URL: "https://youzan.example.com/coupon/status",
    YOUZAN_ACCESS_TOKEN: "youzan-token",
    WEWORK_TAG_APPLY_URL: "https://wework.example.com/tag",
    WEWORK_CONTACT_WRITEBACK_URL: "https://wework.example.com/writeback",
    WEWORK_CORP_ID: "ww-root",
    WEWORK_ACCESS_TOKEN: "wework-token",
  };
  const ready = domain.getActionAdapterCalibration(store, { target: "production", env }).data;
  const release = domain.getReleaseRecord(store, { target: "production", env }).data;

  assert.equal(ready.status, "READY");
  assert.equal(ready.summary.readyActionCount, 4);
  assert.ok(ready.actions.every((item) => item.checks.every((check) => check.status === "PASS")));
  assert.equal(release.evidence.actionAdapterCalibration.status, "READY");
  assert.equal(release.evidence.actionAdapterCalibration.actions.length, 4);
});

test("release record gathers readiness, calibration, runs, and rollback evidence", async () => {
  const store = domain.createStore();
  const missing = domain.getReleaseRecord(store, { env: {} }).data;

  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.decision.recommendation, "暂缓发布，先处理阻塞项");
  assert.ok(missing.checklist.mustFixBeforeRelease.length > 0);
  assert.equal(missing.mustFixBeforeRelease.length, missing.checklist.mustFixBeforeRelease.length);
  assert.ok(missing.mustConfirmForGray.some((item) => item.includes("运营预警")));
  assert.ok(missing.evidence.launchReadiness.blockers.length > 0);
  assert.equal(missing.evidence.productionEnvMatrix.status, "BLOCKED");
  assert.ok(missing.evidence.productionEnvMatrix.missingEnv.some((item) => item.name === "ROOT_JOB_BASE_URL"));
  assert.equal(missing.evidence.externalChannelReadiness.status, "NEEDS_REVIEW");
  assert.ok(missing.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH" && item.status === "NEEDS_REVIEW"));
  assert.ok(missing.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_OVERDUE" && item.status === "NEEDS_REVIEW"));
  assert.ok(missing.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION" && item.status === "NEEDS_REVIEW"));
  assert.ok(["BLOCKED", "NEEDS_REVIEW", "READY"].includes(missing.evidence.adminTransitionReadiness.status));
  assert.equal(missing.evidence.adminTransitionReadiness.summary.requiredModuleCount, 6);
  assert.equal(missing.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "PENDING");
  assert.equal(missing.evidence.productionCutoverReadiness.status, "BLOCKED");
  assert.equal(missing.evidence.productionCutoverReadiness.summary.requiredProofCount, 10);
  assert.ok(missing.evidence.productionCutoverReadiness.blockers.some((item) => item.includes("微信开放平台")));
  assert.equal(missing.evidence.actionAdapterCalibration.status, "BLOCKED");
  assert.equal(missing.evidence.actionAdapterCalibration.actions.length, 4);
  assert.equal(missing.evidence.legacyDataMigration.status, "READY");
  assert.equal(missing.evidence.legacyDataMigration.summary.legacySessionCount, 0);
  assert.equal(missing.evidence.productionEvidenceIntake.items.length, 10);
  assert.equal(missing.evidence.productionEvidenceIntake.status, "BLOCKED");
  assert.ok(missing.evidence.productionEvidenceIntake.items.some((item) => item.backlogId === "T-009" && item.id === "cloudbase_store_production"));
  assert.equal(missing.evidence.cloudbaseStoreReadiness.status, "BLOCKED");
  assert.equal(missing.evidence.cloudbaseStoreReadiness.selectedDecision, "UNDECIDED");
  assert.ok(missing.evidence.cloudbaseStoreReadiness.blockers.some((item) => item.includes("CloudBase Store 决策")));
  assert.equal(missing.evidence.rootMemberCenterReadiness.status, "BLOCKED");
  assert.equal(missing.evidence.rootMemberCenterReadiness.summary.missingAppIdCount, 1);
  assert.ok(missing.evidence.rootMemberCenterReadiness.blockers.some((item) => item.includes("Root 会员中心 appId")));
  assert.ok(missing.evidence.env.some((item) => item.name === "ROOT_OPERATIONAL_ALERT_WEBHOOK_URL"));
  assert.equal(missing.signoffs.length, 3);
  assert.ok(missing.rollback.some((item) => item.includes("MANUAL_SAMPLE")));

  const cutoverProof = domain.recordProductionCutoverProof(store, {
    target: "gray",
    itemId: "cloudbase_unionid",
    status: "VERIFIED",
    evidenceRef: "https://root.example.com/probe?token=secret-token",
    note: "CloudBase unionid 脱敏探针通过 token=secret-token",
    requestId: "release-record-cutover-proof-1",
    operatorId: "release-engineer",
  }).data;
  const repeatedCutoverProof = domain.recordProductionCutoverProof(store, {
    target: "gray",
    itemId: "cloudbase_unionid",
    status: "VERIFIED",
    requestId: "release-record-cutover-proof-1",
    operatorId: "release-engineer",
  }).data;
  const proofRecord = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;
  const proofItem = proofRecord.evidence.productionCutoverReadiness.items
    .find((item) => item.id === "cloudbase_unionid");
  assert.equal(cutoverProof.proof.status, "VERIFIED");
  assert.equal(repeatedCutoverProof.idempotent, true);
  assert.equal(proofItem.proofSource, "RECORD");
  assert.equal(proofItem.proofRecord.evidenceRef, "https://root.example.com/probe");
  assert.equal(JSON.stringify(proofItem).includes("secret-token"), false);
  assert.equal(store.auditLogs[0].action, "PRODUCTION_CUTOVER_PROOF_RECORD");
  assert.equal(require("../src/store").validateSnapshot(store, { seedSampleData: true }).valid, true);

  const adminLegacyDecision = domain.recordAdminLegacyDeprecationDecision(store, {
    target: "gray",
    status: "APPROVED",
    evidenceRef: "https://root.example.com/admin-legacy/proof?token=secret-token",
    rollbackRef: "https://root.example.com/admin-legacy/rollback?token=secret-token",
    note: "旧后台下线批准 openid=raw-openid",
    requestId: "release-record-admin-legacy-deprecation-1",
    operatorId: "release-engineer",
  }).data;
  const repeatedAdminLegacyDecision = domain.recordAdminLegacyDeprecationDecision(store, {
    target: "gray",
    status: "APPROVED",
    requestId: "release-record-admin-legacy-deprecation-1",
    operatorId: "release-engineer",
  }).data;
  const adminDecisionRecord = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;
  assert.equal(adminLegacyDecision.decision.status, "APPROVED");
  assert.equal(adminLegacyDecision.decision.evidenceRef, "https://root.example.com/admin-legacy/proof");
  assert.equal(repeatedAdminLegacyDecision.idempotent, true);
  assert.equal(adminDecisionRecord.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "APPROVED");
  assert.equal(adminDecisionRecord.evidence.adminTransitionReadiness.summary.deprecationSource, "RECORD");
  assert.equal(adminDecisionRecord.evidence.productionEvidenceIntake.items.find((item) => item.backlogId === "T-008").status, "READY");
  assert.equal(JSON.stringify(adminDecisionRecord.evidence.adminTransitionReadiness.legacyDeprecationDecision).includes("secret-token"), false);

  domain.upsertAdminOperationalAlertRule(store, {
    alertRuleId: "op_alert_lifecycle_export_delivery_dead_letter",
    ownerRole: "运营主管",
    ownerName: "Root Ops Lead",
    ownerContact: "wecom:root-ops-lead",
    routeKey: "ops:lifecycle-export-delivery",
    requestId: "release-record-export-alert-owner",
    operatorId: "release-record-test",
  });
  const ownerRecord = domain.getReleaseRecord(store, {
    env: {
      ROOT_OPERATIONAL_ALERT_WEBHOOK_URL: "https://hooks.example.com/release-alert",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET: "release-alert-secret",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL: "WEWORK",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE: "release_alert",
    },
    target: "gray",
  }).data;
  const exportOwnerRoute = ownerRecord.evidence.externalChannelReadiness.alertOwnerRoutes
    .find((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_dead_letter");

  assert.equal(exportOwnerRoute.status, "READY");
  assert.equal(exportOwnerRoute.ownerName, "Root Ops Lead");
  assert.ok(ownerRecord.checklist.finalChecks.some((item) => item.includes("外部预警")));
  assert.ok(ownerRecord.checklist.finalChecks.some((item) => item.includes("真实动作 Adapter")));
  assert.ok(ownerRecord.checklist.finalChecks.some((item) => item.includes("Element Plus Admin")));
  assert.ok(ownerRecord.checklist.finalChecks.some((item) => item.includes("生产切换证明")));

  await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "PREVIEW",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160499,发布记录,13800049999,ROOT 7日试饮装,199,已支付,已发货,上海市发布地址",
    ].join("\n"),
  }, { env: {} }, "2026-05-16");
  const record = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;

  assert.equal(record.target, "gray");
  assert.equal(record.evidence.recentAdapterRuns[0].adapterKind, "MANUAL_SAMPLE");
  assert.equal(record.evidence.recentAdapterRuns[0].status, "COMPLETED");
  assert.ok(record.checklist.finalChecks.some((item) => item.includes("production-env")));
  assert.ok(record.checklist.finalChecks.some((item) => item.includes("ROOT_PUBLIC_BASE_URL")));
  assert.ok(record.evidence.adminTransitionReadiness.moduleCoverage.some((item) => item.key === "release" && item.status === "READY"));
  assert.equal(record.evidence.productionCutoverReadiness.status, "NEEDS_REVIEW");
  assert.equal(record.evidence.actionAdapterCalibration.status, "NEEDS_REVIEW");
  assert.equal(record.evidence.rootMemberCenterReadiness.status, "NEEDS_REVIEW");
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

test("legacy data migration assessment classifies old check-in history for release", () => {
  const store = domain.createStore();
  store.users.push({
    user_id: "legacy_user_1",
    root_user_id: "legacy_user_1",
    phone: "13800070001",
    state: "CHECKIN_COMPLETED",
    created_at: "2026-04-01T08:00:00+08:00",
  });
  store.checkinSessions.push({
    session_id: "legacy_session_1",
    user_id: "legacy_user_1",
    order_id: "ord_legacy_1",
    start_date: "2026-04-01",
    end_date: "2026-04-07",
    status: "COMPLETED",
    created_at: "2026-04-01T08:00:00+08:00",
  });
  store.checkinRecords.push({
    record_id: "legacy_record_1",
    session_id: "legacy_session_1",
    user_id: "legacy_user_1",
    day_index: 1,
    checkin_date: "2026-04-01",
  });
  store.couponEvents.push({
    coupon_id: "legacy_coupon_1",
    session_id: "legacy_session_1",
    user_id: "legacy_user_1",
    status: "CLAIMED",
  });

  const record = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;
  const evidence = domain.getReleaseEvidencePack(store, { env: {}, target: "gray", strict: true }).data;
  const migration = record.evidence.legacyDataMigration;

  assert.equal(migration.status, "NEEDS_REVIEW");
  assert.equal(migration.summary.legacySessionCount, 1);
  assert.equal(migration.summary.unbridgedFactCount, 1);
  assert.equal(migration.summary.bridgeCandidateCount, 1);
  assert.equal(migration.sessions[0].decision, "CAN_BRIDGE_TASK_EVENTS");
  assert.ok(record.mustConfirmForGray.some((item) => item.includes("旧 7 日试饮历史数据")));
  assert.equal(evidence.validation.status, "PASS");
  assert.equal(evidence.pack.summary.legacyDataMigrationStatus, "NEEDS_REVIEW");
  assert.equal(evidence.pack.evidence.legacyDataMigration.summary.legacySessionCount, 1);

  const productionWithoutDecision = domain.getReleaseRecord(store, { env: {}, target: "production" }).data;
  assert.equal(productionWithoutDecision.evidence.legacyDataMigration.status, "BLOCKED");
  assert.ok(productionWithoutDecision.evidence.legacyDataMigration.blockers.some((item) => item.includes("APPROVED 决策")));

  const decision = domain.recordLegacyDataMigrationDecision(store, {
    target: "production",
    policy: "READ_ONLY_ARCHIVE",
    status: "APPROVED",
    snapshotRef: "https://root.example.com/snapshots/legacy?token=secret-token",
    evidenceRef: "https://root.example.com/evidence/legacy?openid=raw-openid",
    note: "生产只读归档，手机号 13800000000",
    requestId: "legacy-migration-decision-1",
    operatorId: "release-engineer",
  }).data;
  const repeatedDecision = domain.recordLegacyDataMigrationDecision(store, {
    target: "production",
    policy: "READ_ONLY_ARCHIVE",
    status: "APPROVED",
    requestId: "legacy-migration-decision-1",
  }).data;
  const approvedProduction = domain.getReleaseRecord(store, { env: {}, target: "production" }).data;
  assert.equal(decision.decision.status, "APPROVED");
  assert.equal(decision.decision.snapshotRef, "https://root.example.com/snapshots/legacy");
  assert.equal(decision.decision.evidenceRef, "https://root.example.com/evidence/legacy");
  assert.equal(JSON.stringify(decision).includes("secret-token"), false);
  assert.equal(JSON.stringify(decision).includes("raw-openid"), false);
  assert.equal(JSON.stringify(decision).includes("13800000000"), false);
  assert.equal(repeatedDecision.idempotent, true);
  assert.equal(approvedProduction.evidence.legacyDataMigration.status, "BLOCKED");
  assert.equal(approvedProduction.evidence.legacyDataMigration.decision.policy, "READ_ONLY_ARCHIVE");
  assert.ok(approvedProduction.evidence.legacyDataMigration.blockers.some((item) => item.includes("ARCHIVE_CONFIRMED")));
  assert.equal(store.auditLogs[0].action, "LEGACY_DATA_MIGRATION_DECISION_RECORD");

  const execution = domain.recordLegacyDataMigrationExecution(store, {
    target: "production",
    action: "ARCHIVE_CONFIRMED",
    status: "VERIFIED",
    evidenceRef: "https://root.example.com/evidence/legacy-execution?token=secret-token",
    note: "旧数据只读归档执行完成 openid=raw-openid 13800000000",
    affectedSessionCount: 1,
    affectedFactCount: 2,
    requestId: "legacy-migration-execution-1",
    operatorId: "release-engineer",
  }).data;
  const repeatedExecution = domain.recordLegacyDataMigrationExecution(store, {
    target: "production",
    action: "ARCHIVE_CONFIRMED",
    status: "VERIFIED",
    requestId: "legacy-migration-execution-1",
  }).data;
  const executedProduction = domain.getReleaseRecord(store, { env: {}, target: "production" }).data;
  assert.equal(execution.execution.status, "VERIFIED");
  assert.equal(execution.execution.action, "ARCHIVE_CONFIRMED");
  assert.equal(execution.execution.snapshotRef, "https://root.example.com/snapshots/legacy");
  assert.equal(execution.execution.evidenceRef, "https://root.example.com/evidence/legacy-execution");
  assert.equal(execution.execution.affectedSessionCount, 1);
  assert.equal(JSON.stringify(execution).includes("secret-token"), false);
  assert.equal(JSON.stringify(execution).includes("raw-openid"), false);
  assert.equal(JSON.stringify(execution).includes("13800000000"), false);
  assert.equal(repeatedExecution.idempotent, true);
  assert.equal(executedProduction.evidence.legacyDataMigration.status, "READY");
  assert.equal(executedProduction.evidence.legacyDataMigration.execution.status, "VERIFIED");
  assert.equal(store.auditLogs[0].action, "LEGACY_DATA_MIGRATION_EXECUTION_RECORD");
  assert.equal(validateSnapshot(store, { seedSampleData: true }).valid, true);

  domain.recordLegacyDataMigrationDecision(store, {
    target: "production",
    policy: "READ_ONLY_ARCHIVE",
    status: "REJECTED",
    snapshotRef: "https://root.example.com/snapshots/rejected",
    evidenceRef: "https://root.example.com/evidence/rejected",
    note: "等待运营复核",
    requestId: "legacy-migration-decision-rejected",
  });
  const rejectedProduction = domain.getReleaseRecord(store, { env: {}, target: "production" }).data;
  assert.equal(rejectedProduction.evidence.legacyDataMigration.status, "BLOCKED");
  assert.equal(rejectedProduction.evidence.legacyDataMigration.decision.status, "REJECTED");

  store.checkinSessions.push({
    session_id: "legacy_missing_user_session",
    user_id: "missing_legacy_user",
    order_id: "",
    start_date: "2026-04-08",
    end_date: "2026-04-14",
    status: "COMPLETED",
  });
  const blocked = domain.getReleaseRecord(store, { env: {}, target: "gray" }).data;
  assert.equal(blocked.evidence.legacyDataMigration.status, "BLOCKED");
  assert.ok(blocked.mustFixBeforeRelease.some((item) => item.includes("missing_legacy_user") || item.includes("legacy_missing_user_session")));
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
  const dashboard = domain.adminDashboard(store).data;

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
  assert.equal(dashboard.externalSampleReviews[0].decision_status, "NEEDS_MAPPING");
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
  const dashboard = domain.adminDashboard(store).data;

  assert.equal(before.review.decision_status, "NEEDS_MAPPING");
  assert.equal(mapping.canonical_value, "EXCEPTION");
  assert.equal(after.rows[0].mapped.deliveryStatus, "EXCEPTION");
  assert.equal(after.importableCount, 1);
  assert.equal(after.review.decision_status, "NEEDS_REVIEW");
  assert.equal(dashboard.externalStatusMappings[0].raw_value, "派送失败");
});

test("external adapter readiness requires three clean samples per source", () => {
  const store = domain.createStore();
  domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160101,张样本,13800010101,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址1号",
    ].join("\n"),
  });
  const firstReadiness = domain.adminDashboard(store).data.externalAdapterReadiness;
  assert.equal(firstReadiness.status, "BLOCKED");
  assert.equal(firstReadiness.sources.find((item) => item.sourceType === "YOUZAN_ORDER").blockingReasons[0].code, "INSUFFICIENT_SAMPLES");

  domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_ORDER",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOT202605160101,张样本,13800010101,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址1号",
      "YZROOT202605160102,李样本,13800010102,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址2号",
      "YZROOT202605160103,王样本,13800010103,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址3号",
    ].join("\n"),
  });
  domain.previewExternalSamples(store, {
    sourceType: "FULFILLMENT",
    text: [
      "有赞订单号,快递公司,运单号,物流状态,签收时间,最新物流节点",
      "YZROOT202605160101,SF,SFROOT101,已签收,2026-05-18T10:00:00+08:00,本人签收",
      "YZROOT202605160102,SF,SFROOT102,已签收,2026-05-18T11:00:00+08:00,门店代收",
      "YZROOT202605160103,SF,SFROOT103,已签收,2026-05-18T12:00:00+08:00,本人签收",
    ].join("\n"),
  });
  domain.previewExternalSamples(store, {
    sourceType: "YOUZAN_CUSTOMER",
    text: [
      "有赞客户ID,unionid,手机号,昵称",
      "yz_root_101,union_root_101,13800010101,张样本",
      "yz_root_102,union_root_102,13800010102,李样本",
      "yz_root_103,union_root_103,13800010103,王样本",
    ].join("\n"),
  });
  domain.previewExternalSamples(store, {
    sourceType: "WECHAT_LEAD",
    text: [
      "外部联系人ID,企业微信备注名,来源活动,当前添加状态,收货手机号,运营备注",
      "wm_root_101,张样本-ROOT,线下沙龙,ADDED,13800010101,已发送规则",
      "wm_root_102,李样本-ROOT,线下沙龙,ADDED,13800010102,已发送规则",
      "wm_root_103,王样本-ROOT,线下沙龙,ADDED,13800010103,已发送规则",
    ].join("\n"),
  });
  const readiness = domain.adminLaunchReadiness(store, {
    target: "production",
    storeAdapter: readyMysqlAdapter(),
    env: {
      WECHAT_APPID: "wx-root",
      WECHAT_APPSECRET: "secret",
      ROOT_PUBLIC_BASE_URL: "https://api.root.test",
      ROOT_ADMIN_TOKEN: "admin-secret",
    },
  }).data;

  assert.equal(readiness.adapterReadiness.status, "READY");
  assert.equal(readiness.summary.blockers, 0);
  assert.ok(readiness.checks.filter((item) => item.id.startsWith("sample_")).every((item) => item.status === "PASS"));
});

test("launch readiness separates gray trial warnings from production blockers", () => {
  const store = domain.createStore();
  const production = domain.adminLaunchReadiness(store, { target: "production", storeAdapter: { kind: "memory" }, env: {} }).data;
  const gray = domain.adminLaunchReadiness(store, { target: "gray", storeAdapter: { kind: "json-file" }, env: {} }).data;
  const sqliteProduction = domain.adminLaunchReadiness(store, {
    target: "production",
    storeAdapter: { kind: "sqlite", filePath: "/tmp/root-checkin.sqlite" },
    env: {
      WECHAT_APPID: "wx-root",
      WECHAT_APPSECRET: "secret",
      ROOT_PUBLIC_BASE_URL: "https://root.example.com",
      ROOT_ADMIN_TOKEN: "admin-secret",
    },
  }).data;
  const mysqlProduction = domain.adminLaunchReadiness(store, {
    target: "production",
    storeAdapter: readyMysqlAdapter(),
    env: {
      WECHAT_APPID: "wx-root",
      WECHAT_APPSECRET: "secret",
      ROOT_PUBLIC_BASE_URL: "https://root.example.com",
      ROOT_ADMIN_TOKEN: "admin-secret",
    },
  }).data;
  const multiTokenProduction = domain.adminLaunchReadiness(store, {
    target: "production",
    storeAdapter: readyMysqlAdapter(),
    env: {
      WECHAT_APPID: "wx-root",
      WECHAT_APPSECRET: "secret",
      ROOT_PUBLIC_BASE_URL: "https://root.example.com",
      ROOT_ADMIN_TOKENS: JSON.stringify({ ops: { token: "ops-secret", role: "operator" } }),
    },
  }).data;

  assert.equal(production.status, "BLOCKED");
  assert.ok(production.checks.some((item) => item.id === "store_adapter" && item.status === "BLOCKER"));
  assert.ok(production.checks.some((item) => item.id === "wechat_credentials" && item.status === "BLOCKER"));
  assert.equal(gray.status, "NEEDS_REVIEW");
  assert.equal(gray.summary.blockers, 0);
  assert.ok(gray.checks.some((item) => item.id === "store_adapter" && item.status === "PASS"));
  assert.ok(sqliteProduction.checks.some((item) => item.id === "store_adapter" && item.status === "BLOCKER"));
  assert.ok(mysqlProduction.checks.some((item) => item.id === "store_adapter" && item.status === "PASS"));
  assert.ok(multiTokenProduction.checks.some((item) => item.id === "admin_access" && item.status === "PASS"));
});

test("manual review can be resolved into a started check-in", () => {
  const store = domain.createStore();
  const token = register(store, "13800000888");
  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /请先匹配/);

  const task = store.operationTasks[0];
  const resolved = domain.resolveManualReview(store, task.task_id, { action: "ALLOW_START" }, "2026-04-26").data;

  assert.equal(resolved.task.result, "ALLOWED_START");
  assert.equal(resolved.user.state, domain.STATES.CHECKIN_ACTIVE);
  assert.equal(resolved.session.orderId, null);
});

test("matched order can complete seven days and create a pending refund application", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);
  completeSevenDays(store, token);

  assert.throws(() => domain.applyRefund(store, token), /Day8 收尾问卷/);
  const questionnaireResult = domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "maybe", needsContact: false },
    idempotencyKey: "day8-refund",
  }).data;

  const state = domain.getUserState(store, token).data.user;
  const refund = domain.applyRefund(store, token).data.refundWorkItem;

  assert.equal(questionnaireResult.refundWorkItem.status, "PENDING");
  assert.equal(state.state, domain.STATES.CHECKIN_COMPLETED);
  assert.equal(refund.status, "PENDING");
  assert.equal(refund.amount, 199);
});

test("Day4 questionnaire pending does not block Day5 check-in", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  for (let day = 1; day <= 4; day += 1) {
    const result = domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays("2026-04-26", day - 1)
    ).data;
    if (day === 4) assert.equal(result.nextAction, "DAY4_QUESTIONNAIRE");
  }
  assert.equal(domain.getUserState(store, token).data.flowView, "DAY4_PENDING");

  const day5 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 5, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "day 5" },
    "2026-04-30"
  ).data;

  assert.equal(day5.record.day_index, 5);
  assert.equal(store.operationTasks.some((task) => task.task_type === "DAY4_QUESTIONNAIRE_PENDING"), true);

  domain.submitQuestionnaire(store, token, {
    type: "DAY4_MIDPOINT",
    answers: { stoolChange: "better", comfortScore: 4, needsContact: false },
    idempotencyKey: "day4-ok",
  });

  assert.equal(store.operationTasks.some((task) => task.task_type === "DAY4_QUESTIONNAIRE_PENDING" && task.status === "OPEN"), false);
});

test("daily audit fails a session after three missed days", () => {
  const store = domain.createStore();
  const token = register(store);
  domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26");
  domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26");

  domain.runDailyAudit(store, "2026-04-27");
  domain.runDailyAudit(store, "2026-04-28");
  domain.runDailyAudit(store, "2026-04-29");

  const state = domain.getUserState(store, token).data.user;
  assert.equal(state.state, domain.STATES.CHECKIN_FAILED);
});

test("daily audit creates a summary and does not reopen handled tasks on the same date", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  const firstAudit = domain.runDailyAudit(store, "2026-04-27").data;
  const missedTask = store.operationTasks.find((task) => task.task_type === "MISSED_CHECKIN");

  assert.equal(firstAudit.summary.date, "2026-04-27");
  assert.equal(firstAudit.summary.dueToday, 1);
  assert.equal(firstAudit.summary.missedToday, 1);
  assert.equal(firstAudit.tasks.length, 1);
  assert.equal(store.checkinSessions[0].miss_count, 1);
  assert.equal(missedTask.status, "OPEN");

  const skipped = domain.completeOperationTask(store, missedTask.task_id, { status: "SKIPPED", note: "已电话确认" }).data.task;
  const repeatedAudit = domain.runDailyAudit(store, "2026-04-27").data;

  assert.equal(skipped.status, "SKIPPED");
  assert.equal(store.checkinSessions[0].miss_count, 1);
  assert.equal(repeatedAudit.tasks.length, 0);
  assert.equal(store.operationTasks.filter((task) => task.task_type === "MISSED_CHECKIN").length, 1);
  assert.equal(store.operationTasks.some((task) => task.task_type === "MISSED_CHECKIN" && task.status === "OPEN"), false);
});

test("daily audit adds questionnaire and refund work items to operations summary", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);
  completeSevenDays(store, token);
  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "yes", needsContact: false },
    idempotencyKey: "day8-audit",
  });

  const audit = domain.runDailyAudit(store, "2026-05-03").data;
  const dashboard = domain.adminDashboard(store).data;

  assert.equal(audit.summary.refundPending, 1);
  assert.equal(audit.summary.day4Pending, 1);
  assert.equal(store.operationTasks.some((task) => task.task_type === "REFUND_PENDING"), true);
  assert.equal(dashboard.summary.date, "2026-05-03");
  assert.equal(dashboard.operationTasks.some((task) => task.taskType === "REFUND_PENDING" && task.user), true);
});

test("admin ops dashboard summarizes operator metrics and prioritized tasks", () => {
  const store = domain.createStore();
  const manualToken = register(store, "13800000888");
  assert.throws(() => domain.startCheckin(store, manualToken, { confirmReceived: true }, "2026-04-26"), /请先匹配/);

  const readyToken = register(store, "13800000002");
  domain.matchOrder(store, readyToken, { phone: "13800000002" }, "2026-04-26");
  domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27");

  const feedbackToken = register(store, "13800000001");
  startMatchedCheckin(store, feedbackToken);
  domain.submitCheckin(
    store,
    feedbackToken,
    { dayIndex: 1, tookProduct: true, hadStool: true, stoolType: "type7", feedback: "今天不太舒服" },
    "2026-04-26"
  );
  domain.syncManualOrder(store, {
    youzanOrderNo: "YZROOT202605240001",
    receiverName: "待匹配用户",
    receiverPhone: "13800009991",
    productName: "ROOT 7日试饮装",
    amount: 199,
    orderStatus: "PAID",
    deliveryStatus: "SHIPPED",
  });

  const dashboard = domain.adminDashboard(store).data.opsDashboard;
  const metrics = Object.fromEntries(dashboard.metrics.map((item) => [item.key, item.value]));

  assert.equal(metrics.pendingOrders, 1);
  assert.equal(metrics.readyToStart, 1);
  assert.equal(metrics.riskFeedbacks, 1);
  assert.equal(dashboard.priorityTasks[0].taskType, "MANUAL_REVIEW_REQUIRED");
  assert.equal(dashboard.priorityTasks[0].label, "需要人工确认");
  assert.equal(dashboard.pendingOrders[0].youzanOrderNo, "YZROOT202605240001");
  assert.equal(dashboard.readyToStartUsers[0].order.orderId, "ord_root_002");
  assert.equal(dashboard.riskFeedbacks[0].title, "Day1 打卡反馈");
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

test("admin user rows expose operator status and blockage summary", () => {
  const store = domain.createStore();
  const token = register(store, "13800000001");
  const userId = domain.getUserState(store, token).data.user.userId;
  domain.confirmAdminOrderMatch(store, { orderId: "ord_root_001", userId }, "2026-04-28");

  const dashboard = domain.adminDashboard(store).data;
  const row = dashboard.opsUsers.find((item) => item.userId === userId);
  const detail = domain.getAdminUserDetail(store, userId).data;

  assert.equal(row.currentBlockage, "已送达未开始");
  assert.equal(row.nextAction, "提醒用户进入小程序开始记录");
  assert.equal(row.orderStatusLabel, "已签收");
  assert.equal(row.totalRecords, 0);
  assert.equal(row.openTaskCount >= 1, true);
  assert.equal(detail.opsSummary.currentBlockage, "已送达未开始");
  assert.equal(detail.opsSummary.latestOrderNo, "YZROOT202604260001");
});

test("admin user detail aggregates feedback and can create follow tasks", () => {
  const store = domain.createStore();
  const token = register(store);
  const userId = domain.getUserState(store, token).data.user.userId;
  startMatchedCheckin(store, token);
  domain.submitCheckin(
    store,
    token,
    { dayIndex: 1, tookProduct: true, hadStool: true, stoolType: "type6", feedback: "今天有点不适" },
    "2026-04-26"
  );

  const detail = domain.getAdminUserDetail(store, userId).data;
  const feedback = detail.feedbacks[0];

  assert.equal(detail.user.userId, userId);
  assert.equal(detail.orders.length, 1);
  assert.equal(detail.records.length, 1);
  assert.equal(detail.opsSummary.currentBlockage, "打卡进行中");
  assert.equal(detail.opsSummary.totalRecords, 1);
  assert.equal(feedback.sourceType, "CHECKIN_RECORD");
  assert.equal(feedback.severity, "HIGH");

  const follow = domain.createFeedbackFollowTask(store, userId, {
    sourceType: feedback.sourceType,
    sourceId: feedback.sourceId,
    reason: feedback.text,
  }, "2026-04-27").data;
  const repeated = domain.createFeedbackFollowTask(store, userId, {
    sourceType: feedback.sourceType,
    sourceId: feedback.sourceId,
    reason: feedback.text,
  }, "2026-04-27").data;
  const nextDetail = domain.getAdminUserDetail(store, userId).data;

  assert.equal(follow.task.taskType, "FEEDBACK_FOLLOW");
  assert.equal(follow.created, true);
  assert.equal(repeated.created, false);
  assert.equal(nextDetail.operationTasks.some((task) => task.taskType === "FEEDBACK_FOLLOW"), true);
});

test("consultation events create user-visible follow-up status", () => {
  const store = domain.createStore();
  const token = register(store, "13800000886");

  const recorded = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-19",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-19", consultationType: "REWARD", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-followup-reward",
  }).data;
  const repeated = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-19",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-19", consultationType: "REWARD", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-followup-reward",
  }).data;
  const pendingView = domain.getUserConsultations(store, token).data;

  assert.equal(recorded.created, true);
  assert.equal(recorded.followUp.created, true);
  assert.equal(recorded.followUp.task.task_type, "CONSULTATION_FOLLOW");
  assert.equal(repeated.created, false);
  assert.equal(repeated.followUp.created, false);
  assert.equal(pendingView.summary.pendingCount, 1);
  assert.equal(pendingView.consultations[0].consultationTypeLabel, "奖励与复核");
  assert.equal(pendingView.consultations[0].status, "PENDING");

  domain.completeOperationTask(store, recorded.followUp.task.task_id, { result: "WEWORK_CONTACTED", note: "已通过企微联系" });
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

  const recorded = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-wework-touch-consultation",
  }).data;
  const taskId = recorded.followUp.task.task_id;
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
    user_id: recorded.followUp.task.user_id,
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

  const recorded = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-wework-writeback",
  }).data;
  store.leadProfiles.push({
    lead_id: "lead_consultation_writeback_001",
    user_id: recorded.followUp.task.user_id,
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
    taskId: recorded.followUp.task.task_id,
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
    taskId: recorded.followUp.task.task_id,
    requestId: "domain-consultation-wework-writeback-1",
  });
  const doneView = domain.getUserConsultations(store, token).data;
  const writebacks = domain.listConsultationWeworkWritebacks(store, { userId: recorded.followUp.task.user_id }).data;

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
  assert.equal(requestBody.taskId, recorded.followUp.task.task_id);
  assert.equal(requestBody.externalContactId, "wm_consultation_001");
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation advisor assignment records owner and supports automatic routing", () => {
  const store = domain.createStore();
  const token = register(store, "13800000889");

  const first = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "ORDER", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-assignment-1",
  }).data;
  const manual = domain.recordConsultationAdvisorAssignment(store, {
    taskId: first.followUp.task.task_id,
    advisorId: "advisor-a",
    advisorName: "顾问A",
    requestId: "domain-consultation-advisor-assignment-manual",
    operatorId: "ops-consultation",
  }).data;
  const repeated = domain.recordConsultationAdvisorAssignment(store, {
    taskId: first.followUp.task.task_id,
    requestId: "domain-consultation-advisor-assignment-manual",
  }).data;

  const second = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-21",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-21", consultationType: "REWARD", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-assignment-2",
  }).data;
  const automatic = domain.recordConsultationAdvisorAssignment(store, {
    taskId: second.followUp.task.task_id,
    assignmentMode: "AUTO",
    advisors: "advisor-a:顾问A,advisor-b:顾问B",
    requestId: "domain-consultation-advisor-assignment-auto",
    operatorId: "ops-consultation",
  }).data;
  const view = domain.getUserConsultations(store, token).data;
  const assignments = domain.listConsultationAdvisorAssignments(store, { userId: first.followUp.task.user_id }).data;

  assert.equal(manual.assignment.advisorId, "advisor-a");
  assert.equal(manual.task.metadata.assignedAdvisorName, "顾问A");
  assert.equal(repeated.idempotent, true);
  assert.equal(automatic.assignment.assignmentMode, "AUTO");
  assert.equal(automatic.assignment.advisorId, "advisor-b");
  assert.equal(view.consultations.find((item) => item.consultationId === second.event.task_event_id).assignedAdvisorName, "顾问B");
  assert.equal(assignments.assignments.length, 2);
  assert.equal(store.auditLogs.some((log) => log.action === "CONSULTATION_ADVISOR_ASSIGN"), true);
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation advisor workbench groups workload by advisor and SLA", () => {
  const store = domain.createStore();
  const firstToken = register(store, "13800000891");
  const secondToken = register(store, "13800000892");

  const first = domain.recordUserTaskEvent(store, firstToken, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "ORDER", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-workbench-1",
  }).data;
  store.operationTasks.find((task) => task.task_id === first.followUp.task.task_id).created_at = "2026-01-01T08:00:00+08:00";
  domain.recordConsultationAdvisorAssignment(store, {
    taskId: first.followUp.task.task_id,
    advisorId: "advisor-a",
    advisorName: "顾问A",
    requestId: "domain-consultation-workbench-advisor-a",
    operatorId: "ops-consultation",
  });

  const second = domain.recordUserTaskEvent(store, secondToken, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "REWARD", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-advisor-workbench-2",
  }).data;
  store.operationTasks.find((task) => task.task_id === second.followUp.task.task_id).created_at = "2026-01-01T10:00:00+08:00";

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
  assert.equal(unassigned.items[0].taskId, second.followUp.task.task_id);
  assert.equal(validateSnapshot(store).valid, true);
});

test("consultation SLA marks overdue follow tasks and feeds operational alerts", async () => {
  const store = domain.createStore();
  const token = register(store, "13800000890");

  const recorded = domain.recordUserTaskEvent(store, token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-20",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
    idempotencyKey: "domain-consultation-sla-overdue",
  }).data;
  store.operationTasks.find((task) => task.task_id === recorded.followUp.task.task_id).created_at = "2026-01-01T08:00:00+08:00";
  domain.recordConsultationAdvisorAssignment(store, {
    taskId: recorded.followUp.task.task_id,
    advisorId: "advisor-sla",
    advisorName: "SLA顾问",
    requestId: "domain-consultation-sla-advisor",
    operatorId: "ops-consultation",
  });

  const sla = domain.getConsultationSla(store, {
    rootUserId: recorded.event.root_user_id,
    slaMinutes: 120,
    now: "2026-01-01T11:30:00+08:00",
  }).data;
  const escalation = domain.getConsultationSlaEscalations(store, {
    rootUserId: recorded.event.root_user_id,
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
  const notification = store.operationalAlertNotifications.find((item) => item.alert_key === `consultation_sla_overdue_${recorded.followUp.task.task_id}`);
  const escalationNotification = store.operationalAlertNotifications.find((item) => String(item.alert_key || "").startsWith(`consultation_sla_escalation_${recorded.followUp.task.task_id}_`));

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
  assert.ok(analytics.alerts.some((item) => item.key === `consultation_sla_overdue_${recorded.followUp.task.task_id}` && item.assignedAdvisorName === "SLA顾问"));
  assert.ok(analytics.alerts.some((item) => item.key.startsWith(`consultation_sla_escalation_${recorded.followUp.task.task_id}_`) && item.escalationLevel >= 2));
  assert.ok(job.data.alerts.some((item) => item.consultationTaskId === recorded.followUp.task.task_id));
  assert.ok(job.data.alerts.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION" && item.escalationOwnerRole));
  assert.ok(notification);
  assert.ok(escalationNotification);
  assert.equal(notification.owner_role, "运营");
  assert.equal(notification.payload_json.alert.assignedAdvisorName, "SLA顾问");
  assert.equal(escalationNotification.owner_role, "运营主管");
  assert.ok(escalationNotification.payload_json.alert.escalationLevel >= 2);
  assert.equal(validateSnapshot(store).valid, true);
});

test("Day6 coupon can be claimed without blocking Day7 or refund eligibility", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  for (let day = 1; day <= 5; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays("2026-04-26", day - 1)
    );
  }
  const beforeDay6 = domain.getCouponStatus(store, token).data;
  const day6 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 6, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "day 6" },
    "2026-05-01"
  ).data;
  const claimed = domain.claimCoupon(store, token, { couponId: day6.coupon.couponId }).data.coupon;
  const day7 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 7, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "day 7" },
    "2026-05-02"
  ).data;

  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "maybe", needsContact: false },
    idempotencyKey: "day8-coupon-refund",
  });
  const refund = domain.applyRefund(store, token).data.refundWorkItem;

  assert.equal(beforeDay6.coupon, null);
  assert.equal(day6.coupon.visible, true);
  assert.equal(day6.coupon.status, "ISSUED");
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(day7.nextAction, "DAY8_QUESTIONNAIRE");
  assert.equal(refund.status, "PENDING");
});

test("claimed unused coupons create operation tasks and can be marked used", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);

  for (let day = 1; day <= 6; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `day ${day}` },
      addDays("2026-04-26", day - 1)
    );
  }
  const couponStatus = domain.getCouponStatus(store, token).data.coupon;
  domain.claimCoupon(store, token, { couponId: couponStatus.couponId });
  const audit = domain.runDailyAudit(store, "2026-05-02").data;
  const task = store.operationTasks.find((item) => item.task_type === "COUPON_UNUSED");
  const used = domain.markCouponUsed(store, couponStatus.couponId).data.coupon;

  assert.equal(audit.summary.couponUnused, 1);
  assert.equal(task.status, "DONE");
  assert.equal(task.result, "COUPON_USED");
  assert.equal(used.status, "USED");
});

test("paid refund keeps completed users out of follow-up daily check-in", () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token);
  completeSevenDays(store, token);
  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "yes", needsContact: false },
    idempotencyKey: "day8-paid",
  });

  const refund = domain.applyRefund(store, token).data.refundWorkItem;
  domain.approveRefund(store, refund.refund_work_item_id);
  const state = domain.getUserState(store, token).data.user;

  assert.equal(state.state, domain.STATES.CHECKIN_COMPLETED);
  assert.throws(() => domain.continueAsDailyUser(store, token), /当前版本不支持继续打卡/);
  assert.throws(() => domain.submitDailyCheckin(
    store,
    token,
    { tookProduct: true, hadStool: true, stoolType: "type4", feedback: "继续记录" },
    "2026-05-03"
  ), /当前不是日常打卡用户/);
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
  assert.equal(store.sessions[0].token, login.token);
  assert.equal(domain.getUserState(store, login.token).data.user.phone, "138****0001");

  store.sessions[0].expires_at = "2000-01-01T00:00:00+08:00";
  assert.throws(() => domain.getUserState(store, login.token), /登录已过期/);
  assert.equal(Boolean(store.sessions[0].revoked_at), true);
  assert.equal(store.tokens[login.token], undefined);
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
  }).data;
  const pending = domain.getCloudbaseIdentityProbe({
    headers: { "x-wx-openid": "openid_only_probe_1234" },
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
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.checks.some((item) => item.id === "openid_header" && item.status === "BLOCKER"));
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
  assert.equal(login.data.features.myRootRebuildEnabled, true);
  assert.equal(store.rootUsers.length, 1);
  assert.equal(store.wechatIdentities.length, 1);
  assert.equal(store.wechatIdentities[0].openid, "myroot_openid_without_phone");
  assert.equal(store.wechatIdentities[0].app_code, "MYROOT");
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "ROOT_USER_CREATED"), true);
  assert.equal(store.userLifecycleEvents.some((item) => item.event_type === "WECHAT_LOGIN"), true);
  assert.equal(state.route, "/pages/register/index");
  assert.equal(state.flowView, "REGISTER_PROFILE");
});

test("rebuild feature flag can route unregistered users through the legacy home flow", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "legacy_route_openid",
    appCode: "MYROOT",
  }, {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    MYROOT_REBUILD_ENABLED: "false",
  });
  const state = domain.getUserState(store, login.data.token, { MYROOT_REBUILD_ENABLED: "false" }).data;

  assert.equal(login.data.nextRoute, "/pages/home/index");
  assert.equal(login.data.features.myRootRebuildEnabled, false);
  assert.equal(state.route, "/pages/home/index");
  assert.equal(state.features.myRootRebuildEnabled, false);
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

test("campaign tasks accept no-order check-in facts and compute idempotent progress", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "task_progress_no_order_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  const joined = domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" }).data;
  const first = domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "CHECKIN",
    taskDate: "2026-06-19",
    payload: { taskDate: "2026-06-19", stoolType: "type4" },
    idempotencyKey: "checkin:task_progress_no_order_openid:2026-06-19",
  }).data;
  const repeated = domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "CHECKIN",
    taskDate: "2026-06-19",
    payload: { taskDate: "2026-06-19", stoolType: "type4" },
    idempotencyKey: "checkin:task_progress_no_order_openid:2026-06-19",
  }).data;
  const progress = domain.getTaskProgress(store, login.data.token).data.progress;
  const checkinTask = progress.tasks.find((task) => task.taskType === "CHECKIN");

  assert.equal(joined.campaign.campaignId, "ROOT_7D_RESET");
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(store.youzanOrders.some((order) => order.user_id === login.data.user.userId), false);
  assert.equal(store.taskEvents.length, 1);
  assert.equal(checkinTask.completedCount, 1);
  assert.equal(checkinTask.targetCount, 7);
  assert.equal(checkinTask.status, "IN_PROGRESS");
  assert.equal(store.taskProgressSnapshots.length, 1);
});

test("campaign check-in task rejects new records after target count is done", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "task_progress_done_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 1; day <= 7; day += 1) {
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "CHECKIN",
      taskDate: addDays("2026-06-19", day - 1),
      payload: { taskDate: addDays("2026-06-19", day - 1), stoolType: "type4" },
      idempotencyKey: `checkin:task_progress_done_openid:${day}`,
    });
  }

  const repeatedDay7 = domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "CHECKIN",
    taskDate: "2026-06-25",
    payload: { taskDate: "2026-06-25", stoolType: "type4" },
    idempotencyKey: "checkin:task_progress_done_openid:7",
  }).data;
  assert.equal(repeatedDay7.created, false);
  assert.equal(domain.getTaskProgress(store, login.data.token).data.progress.tasks.find((task) => task.taskType === "CHECKIN").status, "DONE");
  assert.throws(() => domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "CHECKIN",
    taskDate: "2026-06-26",
    payload: { taskDate: "2026-06-26", stoolType: "type4" },
    idempotencyKey: "checkin:task_progress_done_openid:8",
  }), /每日任务已完成/);
  assert.equal(store.taskEvents.filter((event) => event.task_type === "CHECKIN").length, 7);
});

test("check-in reminder schedules next-day subscribe message with template version", async () => {
  const store = domain.createStore();
  const env = {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "tmpl_checkin_next_day",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-06-28-test",
    ROOT_CHECKIN_REMINDER_HOUR: "10",
  };
  const login = await domain.loginWithWechat(store, {
    openid: "checkin_reminder_join_openid",
    appCode: "MYROOT",
  }, env);

  const joined = domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" }, { env, date: "2026-06-28" }).data;
  const repeated = domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" }, { env, date: "2026-06-28" }).data;
  const template = domain.getCheckinReminderTemplate(store, login.data.token, { env }).data.template;

  assert.equal(joined.reminder.scheduled, true);
  assert.equal(repeated.reminder.scheduled, false);
  assert.equal(store.notificationJobs.length, 1);
  assert.equal(store.notificationJobs[0].reminder_date, "2026-06-29");
  assert.equal(store.notificationJobs[0].scheduled_at, "2026-06-29T10:00:00+08:00");
  assert.equal(store.notificationJobs[0].template_version, "v2026-06-28-test");
  assert.deepEqual(Object.keys(store.notificationJobs[0].data_json).sort(), ["thing1", "thing2", "thing3"]);
  assert.equal(store.notificationJobs[0].data_json.thing3.value, "ROOT 7 日身体重启计划");
  assert.equal(store.notificationJobs[0].data_json.thing2.value, "请完成今日打卡");
  assert.equal(store.notificationJobs[0].data_json.thing1.value, "ROOT 7日身体重启计划");
  assert.equal(template.templateId, "tmpl_checkin_next_day");
  assert.equal(template.version, "v2026-06-28-test");
});

test("check-in reminder configured template data maps tpl10850 fields safely", async () => {
  const store = domain.createStore();
  const env = {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "tmpl_checkin_next_day",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-06-28-tpl10850-test",
    ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON: JSON.stringify({
      thing3: { value: "{{campaignTitle}}" },
      thing2: { value: "{{actionText}}" },
      thing1: { value: "{{productName}}" },
    }),
  };
  const longTitle = "ROOT 这是一个超过二十个字符的打卡活动名称";
  domain.upsertCampaign(store, {
    campaignId: "ROOT_LONG_TITLE",
    title: longTitle,
    status: "ACTIVE",
  });
  const login = await domain.loginWithWechat(store, {
    openid: "checkin_reminder_template_data_openid",
    appCode: "MYROOT",
  }, env);

  domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_LONG_TITLE" }, { env, date: "2026-06-28" });

  assert.deepEqual(Object.keys(store.notificationJobs[0].data_json).sort(), ["thing1", "thing2", "thing3"]);
  assert.equal(store.notificationJobs[0].data_json.thing3.value, longTitle.slice(0, 20));
  assert.equal(store.notificationJobs[0].data_json.thing2.value, "请完成今日打卡");
  assert.equal(store.notificationJobs[0].data_json.thing1.value, "ROOT 7日身体重启计划");
});

test("check-in reminder job sends only after accepted subscription and skips completed day", async () => {
  const store = domain.createStore();
  const env = {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "tmpl_checkin_next_day",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-06-28-test",
    ROOT_CHECKIN_REMINDER_HOUR: "9",
  };
  const login = await domain.loginWithWechat(store, {
    openid: "checkin_reminder_send_openid",
    appCode: "MYROOT",
  }, env);

  domain.joinCampaign(store, login.data.token, {}, { env, date: "2026-06-28" });
  domain.recordCheckinReminderSubscription(store, login.data.token, {
    templateKey: "CHECKIN_REMINDER_NEXT_DAY",
    templateId: "tmpl_checkin_next_day",
    templateVersion: "v2026-06-28-test",
    result: "accept",
    subscribed: true,
    rawResult: { errMsg: "requestSubscribeMessage:ok", token: "must-not-persist" },
    trigger: "CAMPAIGN_JOIN",
  }, { env });
  assert.deepEqual(store.notificationSubscriptions[0].raw_result_json, {});

  const sentPayloads = [];
  const sent = await domain.runDueCheckinReminders(store, {
    dryRun: false,
    now: "2026-06-29T09:00:00+08:00",
  }, {
    env,
    sendSubscribeMessage: async (payload) => {
      sentPayloads.push(payload);
      return { errcode: 0, msgid: "mock_msg_1" };
    },
  });

  assert.equal(sent.data.results[0].status, "SENT");
  assert.equal(store.notificationJobs[0].status, "SENT");
  assert.equal(store.notificationDeliveries[0].status, "SENT");
  assert.equal(sentPayloads[0].touser, "checkin_reminder_send_openid");
  assert.equal(sentPayloads[0].template_id, "tmpl_checkin_next_day");
  assert.deepEqual(Object.keys(sentPayloads[0].data).sort(), ["thing1", "thing2", "thing3"]);
  assert.equal(sentPayloads[0].data.thing2.value, "请完成今日打卡");

  const secondLogin = await domain.loginWithWechat(store, {
    openid: "checkin_reminder_skip_openid",
    appCode: "MYROOT",
  }, env);
  domain.joinCampaign(store, secondLogin.data.token, {}, { env, date: "2026-06-28" });
  domain.recordCheckinReminderSubscription(store, secondLogin.data.token, {
    templateKey: "CHECKIN_REMINDER_NEXT_DAY",
    templateId: "tmpl_checkin_next_day",
    templateVersion: "v2026-06-28-test",
    result: "accept",
    subscribed: true,
  }, { env });
  domain.recordUserTaskEvent(store, secondLogin.data.token, {
    taskType: "CHECKIN",
    taskDate: "2026-06-29",
    payload: { taskDate: "2026-06-29", stoolType: "type4" },
    idempotencyKey: "checkin-reminder-skip-2026-06-29",
  }, { env, date: "2026-06-28" });

  const skipped = await domain.runDueCheckinReminders(store, {
    dryRun: false,
    now: "2026-06-29T09:00:00+08:00",
  }, {
    env,
    sendSubscribeMessage: async (payload) => {
      sentPayloads.push(payload);
      return { errcode: 0 };
    },
  });

  assert.ok(skipped.data.results.some((item) => item.status === "SKIPPED_ALREADY_CHECKED_IN"));
  assert.equal(sentPayloads.length, 1);
});

test("admin can configure a 14-day campaign task without changing the task Interface", async () => {
  const store = domain.createStore();
  const campaignResult = domain.upsertCampaign(store, {
    campaignId: "ROOT_14D_TEST",
    title: "ROOT 14 日体验计划",
    status: "ACTIVE",
    config: { durationDays: 14, allowNoOrderParticipation: true },
  }).data;
  const taskDefinition = domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_14d_checkin_test",
    campaignId: "ROOT_14D_TEST",
    taskType: "CHECKIN",
    title: "完成 14 天身体记录",
    required: true,
    config: { targetCount: 14, uniqueBy: "taskDate" },
  }).data.taskDefinition;
  const login = await domain.loginWithWechat(store, {
    openid: "task_progress_14d_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_14D_TEST" });
  domain.recordUserTaskEvent(store, login.data.token, {
    campaignId: "ROOT_14D_TEST",
    taskType: "CHECKIN",
    taskDate: "2026-06-19",
    payload: { taskDate: "2026-06-19" },
    idempotencyKey: "checkin:14d:1",
  });
  const progress = domain.getTaskProgress(store, login.data.token, { campaignId: "ROOT_14D_TEST" }).data.progress;
  const checkinTask = progress.tasks.find((task) => task.taskDefinitionId === "td_root_14d_checkin_test");

  assert.equal(campaignResult.campaign.campaignId, "ROOT_14D_TEST");
  assert.equal(taskDefinition.config_json.targetCount, 14);
  assert.equal(checkinTask.completedCount, 1);
  assert.equal(checkinTask.targetCount, 14);
  assert.equal(progress.summary.settlementReady, false);
});

test("legacy questionnaire and share events are bridged into task facts", async () => {
  const store = domain.createStore();
  const token = register(store);
  startMatchedCheckin(store, token, "2026-04-26");
  for (let day = 1; day <= 4; day += 1) {
    domain.submitCheckin(store, token, { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4" }, addDays("2026-04-26", day - 1));
  }
  domain.submitQuestionnaire(store, token, {
    type: "DAY4_MIDPOINT",
    answers: { stoolChange: "better", comfortScore: 4 },
  }, "2026-04-29");
  domain.trackEvent(store, token, {
    eventName: "share_complete",
    taskType: "SHARE",
    payload: { channel: "wechat" },
    idempotencyKey: "share:legacy-user:wechat",
  });
  const progress = domain.getTaskProgress(store, token).data.progress;
  const questionnaireTask = progress.tasks.find((task) => task.title === "完成中期问卷");
  const shareTask = progress.tasks.find((task) => task.taskType === "SHARE");

  assert.equal(store.taskEvents.filter((event) => event.task_type === "CHECKIN").length, 4);
  assert.equal(questionnaireTask.status, "DONE");
  assert.equal(shareTask.status, "DONE");
});

test("campaign questionnaire answers validate, persist and bridge into task facts", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "campaign_questionnaire_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  assert.throws(() => domain.submitQuestionnaireAnswer(store, login.data.token, {
    campaignId: "ROOT_7D_RESET",
    questionnaireType: "DAY4_MIDPOINT",
    answers: { stoolChange: "better" },
    idempotencyKey: "campaign-questionnaire-missing",
  }, "2026-06-22"), /问卷必填项未完成/);

  assert.throws(() => domain.submitQuestionnaireAnswer(store, login.data.token, {
    campaignId: "ROOT_7D_RESET",
    questionnaireType: "DAY4_MIDPOINT",
    taskDate: "2026-06-22",
    answers: { stoolChange: "worse", comfortScore: 3, needsContact: true },
    idempotencyKey: "campaign-questionnaire-branch-missing",
  }, "2026-06-22"), /问卷必填项未完成/);

  const submitted = domain.submitQuestionnaireAnswer(store, login.data.token, {
    campaignId: "ROOT_7D_RESET",
    questionnaireType: "DAY4_MIDPOINT",
    taskDate: "2026-06-22",
    answers: { stoolChange: "worse", comfortScore: 3, needsContact: true, contactReason: "排便变差", feedback: "希望顾问看一下" },
    idempotencyKey: "campaign-questionnaire-day4",
  }, "2026-06-22").data;
  const repeated = domain.submitQuestionnaireAnswer(store, login.data.token, {
    campaignId: "ROOT_7D_RESET",
    questionnaireType: "DAY4_MIDPOINT",
    taskDate: "2026-06-22",
    answers: { stoolChange: "better", comfortScore: 5 },
    idempotencyKey: "campaign-questionnaire-day4",
  }, "2026-06-22").data;
  const status = domain.getQuestionnaireAnswerStatus(store, login.data.token, { campaignId: "ROOT_7D_RESET" }).data;
  const progress = domain.getTaskProgress(store, login.data.token).data.progress;
  const questionnaireTask = progress.tasks.find((task) => task.title === "完成中期问卷");
  const lifecycle = domain.getAdminLifecycleWorkbench(store, { keyword: "campaign_questionnaire_openid" }).data.users[0];

  assert.equal(submitted.created, true);
  assert.equal(repeated.created, false);
  assert.equal(submitted.answer.questionnaireId, "DAY4_MIDPOINT");
  assert.equal(submitted.answer.needsFollow, true);
  assert.equal(status.DAY4_MIDPOINT, true);
  assert.equal(status.answers.length, 1);
  assert.equal(store.questionnaireAnswers.length, 1);
  assert.equal(store.questionnaireResponses.length, 0);
  assert.equal(store.taskEvents.filter((event) => event.task_type === "QUESTIONNAIRE").length, 1);
  assert.equal(questionnaireTask.status, "DONE");
  assert.equal(store.operationTasks.some((task) => task.task_type === "QUESTIONNAIRE_FOLLOW" && task.status === "OPEN"), true);
  assert.equal(lifecycle.questionnaireSummary.answerCount, 1);
  assert.equal(lifecycle.questionnaireSummary.latestNeedsFollow, true);
});

test("settlement evaluates default rewards for no-order task completion", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "settlement_no_order_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `settlement-default-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "settlement-default-day8",
  });

  const ready = domain.getSettlementStatus(store, login.data.token).data;
  const evaluated = domain.evaluateUserSettlement(store, login.data.token, { sourceChannel: "MINIPROGRAM_REWARD" }).data;
  const repeated = domain.evaluateUserSettlement(store, login.data.token, { sourceChannel: "MINIPROGRAM_REWARD" }).data;
  const status = domain.getSettlementStatus(store, login.data.token).data;

  assert.equal(ready.result.qualified, true);
  assert.equal(ready.latestSettlement, null);
  assert.equal(evaluated.settlementRecord.status, "QUALIFIED");
  assert.equal(repeated.settlementRecord.status, "QUALIFIED");
  assert.equal(store.settlementRecords.length, 2);
  assert.equal(store.rewardGrants.length, 2);
  assert.equal(store.rewardDeliveryJobs.length, 1);
  assert.equal(store.manualReviewItems.length, 1);
  assert.equal(store.rewardGrants.some((grant) => grant.reward_type === "YOUZAN_COUPON" && grant.status === "PENDING_DELIVERY"), true);
  assert.equal(store.rewardGrants.some((grant) => grant.reward_type === "FREE_ORDER_CHANCE" && grant.status === "PENDING_REVIEW"), true);
  assert.equal(status.rewardGrants.length, 2);
  assert.equal(status.manualReviews[0].status, "OPEN");
  assert.equal(status.manualReviews[0].slaHours, 24);
  assert.match(status.manualReviews[0].expectedResolutionAt, /\+08:00$/);
  assert.match(status.manualReviews[0].statusCopy, /免单机会需要确认/);
  assert.equal(status.manualReviews[0].explanationTitle, "免单机会复核");
  assert.equal(status.manualReviews[0].evidenceRequired.includes("Root 会员中心订单/支付证据"), true);
  assert.equal(status.manualReviews[0].operatorGuidance, "");
  assert.equal(store.youzanOrders.some((order) => order.user_id === login.data.user.userId), false);
});

test("admin publishes configurable settlement rules without changing the task Interface", async () => {
  const store = domain.createStore();
  domain.upsertCampaign(store, {
    campaignId: "ROOT_14D_SETTLEMENT",
    title: "ROOT 14 日活动",
    status: "ACTIVE",
    config: { durationDays: 14, allowNoOrderParticipation: true },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_14d_settlement_checkin",
    campaignId: "ROOT_14D_SETTLEMENT",
    taskType: "CHECKIN",
    title: "连续记录 14 天",
    required: true,
    config: { targetCount: 14, uniqueBy: "taskDate" },
  });
  const rule = domain.publishCampaignRuleVersion(store, {
    campaignId: "ROOT_14D_SETTLEMENT",
    version: 1,
    conditions: [
      { conditionType: "TASK_STREAK", taskType: "CHECKIN", minStreak: 14, label: "连续记录 14 天" },
    ],
    rewards: [
      { rewardType: "POINTS", rewardKey: "habit_points", title: "积分奖励", description: "完成后承诺积分" },
    ],
  }).data.ruleVersion;
  const login = await domain.loginWithWechat(store, {
    openid: "settlement_14d_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_14D_SETTLEMENT" });

  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-01", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_14D_SETTLEMENT",
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `settlement-14d-checkin-${day + 1}`,
    });
  }
  const preview = domain.previewAdminSettlement(store, {
    rootUserId: login.data.user.rootUserId,
    campaignId: "ROOT_14D_SETTLEMENT",
  }).data;

  for (let day = 7; day < 14; day += 1) {
    const taskDate = addDays("2026-06-01", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_14D_SETTLEMENT",
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `settlement-14d-checkin-${day + 1}`,
    });
  }
  const evaluated = domain.evaluateUserSettlement(store, login.data.token, { campaignId: "ROOT_14D_SETTLEMENT" }).data;

  assert.equal(rule.campaignId, "ROOT_14D_SETTLEMENT");
  assert.equal(preview.result.qualified, false);
  assert.equal(preview.result.missingConditions[0].missing, 7);
  assert.equal(evaluated.result.qualified, true);
  assert.equal(store.rewardGrants.length, 1);
  assert.equal(store.rewardGrants[0].reward_type, "POINTS");
  assert.equal(store.rewardGrants[0].status, "PROMISED");
  assert.equal(store.rewardDeliveryJobs.length, 0);
});

test("settlement rule tree supports OR conditions without breaking flat condition views", async () => {
  const store = domain.createStore();
  domain.upsertCampaign(store, {
    campaignId: "ROOT_OR_SETTLEMENT",
    title: "ROOT OR 结算活动",
    status: "ACTIVE",
    config: { allowNoOrderParticipation: true },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_or_checkin",
    campaignId: "ROOT_OR_SETTLEMENT",
    taskType: "CHECKIN",
    title: "任选打卡",
    required: false,
    config: { targetCount: 2, uniqueBy: "taskDate" },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_or_questionnaire",
    campaignId: "ROOT_OR_SETTLEMENT",
    taskType: "QUESTIONNAIRE",
    title: "任选问卷",
    required: false,
    config: { questionnaireType: "DAY8_SUMMARY", targetCount: 1 },
  });
  domain.publishCampaignRuleVersion(store, {
    campaignId: "ROOT_OR_SETTLEMENT",
    version: 1,
    conditions: {
      logic: "OR",
      label: "完成打卡或收尾问卷任一项",
      conditions: [
        { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 2, uniqueBy: "taskDate", label: "完成 2 次打卡" },
        { conditionType: "QUESTIONNAIRE_COMPLETED", questionnaireType: "DAY8_SUMMARY", label: "完成收尾问卷" },
      ],
    },
    rewards: [
      { rewardType: "POINTS", rewardKey: "or_points", title: "任选积分", description: "任一条件达成后承诺积分" },
    ],
  });
  const login = await domain.loginWithWechat(store, {
    openid: "settlement_or_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_OR_SETTLEMENT" });

  const before = domain.previewAdminSettlement(store, {
    rootUserId: login.data.user.rootUserId,
    campaignId: "ROOT_OR_SETTLEMENT",
  }).data;
  domain.submitQuestionnaireAnswer(store, login.data.token, {
    campaignId: "ROOT_OR_SETTLEMENT",
    questionnaireType: "DAY8_SUMMARY",
    taskDate: "2026-06-28",
    answers: { overallFeeling: "better", repurchaseIntent: "maybe", needsContact: false },
    idempotencyKey: "settlement-or-day8",
  }, "2026-06-28");
  const after = domain.previewAdminSettlement(store, {
    rootUserId: login.data.user.rootUserId,
    campaignId: "ROOT_OR_SETTLEMENT",
  }).data;
  const evaluated = domain.evaluateUserSettlement(store, login.data.token, { campaignId: "ROOT_OR_SETTLEMENT" }).data;

  assert.equal(before.result.qualified, false);
  assert.equal(before.result.conditionTree.logic, "OR");
  assert.equal(before.result.conditions.length, 1);
  assert.equal(before.result.missingConditions.length, 2);
  assert.equal(after.result.qualified, true);
  assert.equal(after.result.conditions[0].passed, true);
  assert.equal(after.result.missingConditions.length, 0);
  assert.equal(evaluated.settlementRecord.status, "QUALIFIED");
  assert.equal(store.rewardGrants[0].reward_type, "POINTS");
});

test("reward quota skips over-limit grants without changing settlement qualification", async () => {
  const store = domain.createStore();
  domain.upsertCampaign(store, {
    campaignId: "ROOT_QUOTA_SETTLEMENT",
    title: "ROOT 限量奖励活动",
    status: "ACTIVE",
    config: { allowNoOrderParticipation: true },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_quota_checkin",
    campaignId: "ROOT_QUOTA_SETTLEMENT",
    taskType: "CHECKIN",
    title: "限量奖励打卡",
    required: true,
    config: { targetCount: 1, uniqueBy: "taskDate" },
  });
  domain.publishCampaignRuleVersion(store, {
    campaignId: "ROOT_QUOTA_SETTLEMENT",
    version: 1,
    conditions: [
      { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
    ],
    rewards: [
      { rewardType: "POINTS", rewardKey: "quota_points", quotaKey: "roadshow_points_pool", stockLimit: 1, title: "限量积分" },
    ],
  });

  async function completeAndEvaluate(openid, taskDate) {
    const login = await domain.loginWithWechat(store, { openid, appCode: "MYROOT" }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
    domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_QUOTA_SETTLEMENT" });
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_QUOTA_SETTLEMENT",
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `${openid}-quota-checkin`,
    });
    return {
      login,
      evaluated: domain.evaluateUserSettlement(store, login.data.token, { campaignId: "ROOT_QUOTA_SETTLEMENT" }).data,
    };
  }

  const first = await completeAndEvaluate("quota_user_one_openid", "2026-06-20");
  const second = await completeAndEvaluate("quota_user_two_openid", "2026-06-21");
  const repeatedFirst = domain.evaluateUserSettlement(store, first.login.data.token, { campaignId: "ROOT_QUOTA_SETTLEMENT" }).data;

  assert.equal(first.evaluated.result.qualified, true);
  assert.equal(second.evaluated.result.qualified, true);
  assert.equal(first.evaluated.rewardResults[0].created, true);
  assert.equal(second.evaluated.rewardResults[0].skipped, true);
  assert.match(second.evaluated.rewardResults[0].skippedReason, /奖励库存已达上限/);
  assert.equal(repeatedFirst.rewardResults[0].created, false);
  assert.equal(repeatedFirst.rewardResults[0].grant.reward_grant_id, first.evaluated.rewardResults[0].grant.reward_grant_id);
  assert.equal(store.rewardInventoryPools.length, 1);
  assert.equal(store.rewardInventoryReservations.length, 1);
  assert.equal(store.rewardInventoryReservations[0].status, "RESERVED");
  assert.equal(store.rewardGrants.length, 1);
  assert.equal(store.rewardGrants[0].quota_key, "roadshow_points_pool");
  assert.equal(store.rewardGrants[0].quota_limit, 1);
  assert.equal(store.rewardGrants[0].inventory_reservation_id, store.rewardInventoryReservations[0].reward_inventory_reservation_id);
});

test("reward inventory reservation releases when manual review rejects a limited reward", async () => {
  const store = domain.createStore();
  domain.upsertCampaign(store, {
    campaignId: "ROOT_REVIEW_QUOTA",
    title: "ROOT 复核库存活动",
    status: "ACTIVE",
    config: { allowNoOrderParticipation: true },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_review_quota_checkin",
    campaignId: "ROOT_REVIEW_QUOTA",
    taskType: "CHECKIN",
    title: "完成复核库存打卡",
    required: true,
    config: { targetCount: 1, uniqueBy: "taskDate" },
  });
  domain.publishCampaignRuleVersion(store, {
    campaignId: "ROOT_REVIEW_QUOTA",
    version: 1,
    conditions: [
      { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
    ],
    rewards: [
      { rewardType: "FREE_ORDER_CHANCE", rewardKey: "quota_free_order", quotaKey: "free_order_pool", stockLimit: 1, title: "限量免单机会" },
    ],
  });

  async function completeAndEvaluate(openid, taskDate) {
    const login = await domain.loginWithWechat(store, { openid, appCode: "MYROOT" }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
    domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_REVIEW_QUOTA" });
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_REVIEW_QUOTA",
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `${openid}-review-quota-checkin`,
    });
    return {
      login,
      evaluated: domain.evaluateUserSettlement(store, login.data.token, { campaignId: "ROOT_REVIEW_QUOTA" }).data,
    };
  }

  const first = await completeAndEvaluate("review_quota_user_one_openid", "2026-06-20");
  const secondBeforeRelease = await completeAndEvaluate("review_quota_user_two_openid", "2026-06-21");
  const reviewId = store.manualReviewItems.find((item) => item.root_user_id === first.login.data.user.rootUserId).manual_review_item_id;
  domain.resolveAdminManualReview(store, reviewId, {
    decision: "REJECTED",
    reason: "库存释放测试拒绝",
    publicNote: "本次暂不发放免单机会。",
  });
  const secondAfterRelease = domain.evaluateUserSettlement(store, secondBeforeRelease.login.data.token, {
    campaignId: "ROOT_REVIEW_QUOTA",
  }).data;

  assert.equal(first.evaluated.rewardResults[0].created, true);
  assert.equal(secondBeforeRelease.evaluated.rewardResults[0].skipped, true);
  assert.equal(store.rewardInventoryReservations.filter((item) => item.status === "RELEASED").length, 1);
  assert.equal(secondAfterRelease.rewardResults[0].created, true);
  assert.equal(secondAfterRelease.rewardResults[0].grant.reward_type, "FREE_ORDER_CHANCE");
  assert.equal(store.rewardInventoryReservations.filter((item) => item.status === "RESERVED").length, 1);
});

test("refund approval recovers rewards and replenishes limited inventory", async () => {
  const store = domain.createStore();
  domain.upsertCampaign(store, {
    campaignId: "ROOT_RECOVERY_QUOTA",
    title: "ROOT 追回库存活动",
    status: "ACTIVE",
    config: { allowNoOrderParticipation: true },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_recovery_quota_checkin",
    campaignId: "ROOT_RECOVERY_QUOTA",
    taskType: "CHECKIN",
    title: "完成追回库存打卡",
    required: true,
    config: { targetCount: 1, uniqueBy: "taskDate" },
  });
  domain.publishCampaignRuleVersion(store, {
    campaignId: "ROOT_RECOVERY_QUOTA",
    version: 1,
    conditions: [
      { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
    ],
    rewards: [
      { rewardType: "FREE_ORDER_CHANCE", rewardKey: "recovery_free_order", quotaKey: "recovery_free_order_pool", stockLimit: 1, title: "追回测试免单机会" },
    ],
  });

  async function completeAndEvaluate(openid, taskDate) {
    const login = await domain.loginWithWechat(store, { openid, appCode: "MYROOT" }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
    domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_RECOVERY_QUOTA" });
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_RECOVERY_QUOTA",
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `${openid}-recovery-quota-checkin`,
    });
    return {
      login,
      evaluated: domain.evaluateUserSettlement(store, login.data.token, { campaignId: "ROOT_RECOVERY_QUOTA" }).data,
    };
  }

  const first = await completeAndEvaluate("recovery_quota_user_one_openid", "2026-06-20");
  const secondBeforeRecovery = await completeAndEvaluate("recovery_quota_user_two_openid", "2026-06-21");
  const firstGrant = first.evaluated.rewardResults[0].grant;
  const firstUser = store.users.find((item) => item.user_id === first.login.data.user.userId);
  firstUser.state = "CHECKIN_COMPLETED";
  store.refundWorkItems.push({
    refund_work_item_id: "rwi_reward_recovery_001",
    session_id: "session_reward_recovery_001",
    user_id: first.login.data.user.userId,
    order_id: store.youzanOrders[0].order_id,
    youzan_order_no: store.youzanOrders[0].youzan_order_no,
    amount: 199,
    status: "PENDING",
    created_at: "2026-06-20T10:00:00+08:00",
    paid_at: "",
    note: "",
  });

  const approved = domain.approveRefund(store, "rwi_reward_recovery_001").data;
  const recoveryRecords = domain.listRewardRecoveryRecords(store, {
    rootUserId: first.login.data.user.rootUserId,
    campaignId: "ROOT_RECOVERY_QUOTA",
  }).data.records;
  const secondAfterRecovery = domain.evaluateUserSettlement(store, secondBeforeRecovery.login.data.token, {
    campaignId: "ROOT_RECOVERY_QUOTA",
  }).data;

  assert.equal(first.evaluated.rewardResults[0].created, true);
  assert.equal(secondBeforeRecovery.evaluated.rewardResults[0].skipped, true);
  assert.equal(approved.rewardRecovery.createdCount, 1);
  assert.equal(approved.rewardRecovery.inventoryReleasedCount, 1);
  assert.equal(recoveryRecords.length, 1);
  assert.equal(recoveryRecords[0].status, "COMPLETED");
  assert.equal(store.rewardRecoveryRecords.length, 1);
  assert.equal(store.rewardRecoveryRecords[0].source_type, "REFUND_WORK_ITEM");
  assert.equal(store.rewardRecoveryRecords[0].reward_grant_id, firstGrant.reward_grant_id);
  assert.equal(store.rewardRecoveryRecords[0].status, "COMPLETED");
  assert.equal(store.rewardGrants.find((grant) => grant.reward_grant_id === firstGrant.reward_grant_id).status, "REVOKED");
  assert.equal(store.manualReviewItems.find((item) => item.source_id === firstGrant.reward_grant_id).resolution, "REVOKED");
  assert.equal(store.rewardInventoryReservations.filter((item) => item.status === "RELEASED").length, 1);
  assert.equal(secondAfterRecovery.rewardResults[0].created, true);
  assert.equal(secondAfterRecovery.rewardResults[0].grant.reward_type, "FREE_ORDER_CHANCE");
  assert.equal(store.rewardInventoryReservations.filter((item) => item.status === "RESERVED").length, 1);
});

test("order after-sales sync mirrors refund status and triggers reward recovery", () => {
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
  store.rewardGrants.push({
    reward_grant_id: "rgr_after_sales_001",
    root_user_id: user.root_user_id,
    campaign_id: "ROOT_7D_RESET",
    settlement_record_id: "stl_after_sales_001",
    order_id: order.orderId,
    reward_type: "COUPON",
    reward_key: "after_sales_coupon",
    quota_key: "",
    quota_limit: 0,
    inventory_reservation_id: "",
    title: "售后追回券",
    description: "",
    status: "PENDING_DELIVERY",
    external_status: "",
    external_ref: "",
    recovery_status: "",
    recovery_reason: "",
    recovery_record_id: "",
    recovered_at: "",
    payload_json: {},
    idempotency_key: "rgr-after-sales-001",
    created_at: "2026-06-20T10:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
  });
  store.rewardGrants.push({
    reward_grant_id: "rgr_after_sales_unrelated_001",
    root_user_id: user.root_user_id,
    campaign_id: "ROOT_7D_RESET",
    settlement_record_id: "stl_after_sales_unrelated_001",
    order_id: "ord_unrelated_after_sales_001",
    reward_type: "COUPON",
    reward_key: "after_sales_unrelated_coupon",
    quota_key: "",
    quota_limit: 0,
    inventory_reservation_id: "",
    title: "不相关奖励",
    description: "",
    status: "PENDING_DELIVERY",
    external_status: "",
    external_ref: "",
    recovery_status: "",
    recovery_reason: "",
    recovery_record_id: "",
    recovered_at: "",
    payload_json: {},
    idempotency_key: "rgr-after-sales-unrelated-001",
    created_at: "2026-06-20T10:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
  });
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
  assert.equal(requested.followTask.task_type, "ORDER_AFTER_SALES_FOLLOW");
  assert.equal(refunded.created, false);
  assert.equal(refunded.record.status, "REFUNDED");
  assert.equal(refunded.order.refund_status, "REFUNDED");
  assert.equal(refunded.refundWorkItem.status, "PAID");
  assert.equal(refunded.rewardRecovery.createdCount, 1);
  assert.equal(records.length, 1);
  assert.equal(store.rewardRecoveryRecords[0].source_type, "ORDER_AFTER_SALES");
  assert.equal(store.rewardGrants.find((grant) => grant.reward_grant_id === "rgr_after_sales_001").status, "REVOKED");
  assert.equal(store.rewardGrants.find((grant) => grant.reward_grant_id === "rgr_after_sales_unrelated_001").status, "PENDING_DELIVERY");
  assert.equal(store.auditLogs.some((log) => log.action === "ORDER_AFTER_SALES_UPSERT"), true);
  assert.equal(validateSnapshot(store).valid, true);
});

test("reward lottery and blacklist skip rewards without changing settlement qualification", async () => {
  const store = domain.createStore();
  domain.upsertCampaign(store, {
    campaignId: "ROOT_REWARD_ELIGIBILITY",
    title: "ROOT 奖励资格活动",
    status: "ACTIVE",
    config: { allowNoOrderParticipation: true },
  });
  domain.upsertTaskDefinition(store, {
    taskDefinitionId: "td_root_reward_eligibility_checkin",
    campaignId: "ROOT_REWARD_ELIGIBILITY",
    taskType: "CHECKIN",
    title: "完成奖励资格打卡",
    required: true,
    config: { targetCount: 1, uniqueBy: "taskDate" },
  });
  const login = await domain.loginWithWechat(store, {
    openid: "reward_eligibility_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  domain.publishCampaignRuleVersion(store, {
    campaignId: "ROOT_REWARD_ELIGIBILITY",
    version: 1,
    conditions: [
      { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
    ],
    rewards: [
      { rewardType: "FREE_ORDER_CHANCE", rewardKey: "lottery_free_order", chanceRate: 0, title: "0% 免单机会" },
      { rewardType: "POINTS", rewardKey: "blacklist_points", blockedRootUserIds: [login.data.user.rootUserId], title: "黑名单积分" },
    ],
  });
  domain.joinCampaign(store, login.data.token, { campaignId: "ROOT_REWARD_ELIGIBILITY" });
  domain.recordUserTaskEvent(store, login.data.token, {
    campaignId: "ROOT_REWARD_ELIGIBILITY",
    taskType: "CHECKIN",
    taskDate: "2026-06-20",
    payload: { taskDate: "2026-06-20" },
    idempotencyKey: "reward-eligibility-checkin",
  });

  const evaluated = domain.evaluateUserSettlement(store, login.data.token, { campaignId: "ROOT_REWARD_ELIGIBILITY" }).data;

  assert.equal(evaluated.result.qualified, true);
  assert.equal(evaluated.rewardResults.length, 2);
  assert.equal(evaluated.rewardResults.every((item) => item.skipped), true);
  assert.match(evaluated.rewardResults[0].skippedReason, /未抽中该奖励/);
  assert.match(evaluated.rewardResults[1].skippedReason, /黑名单/);
  assert.equal(store.rewardGrants.length, 0);
  assert.equal(store.rewardDeliveryJobs.length, 0);
  assert.equal(store.manualReviewItems.length, 0);
});

test("admin config workbench exposes settlement operations and resolves reward review", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "admin_config_review_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `admin-config-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "admin-config-day8",
  });
  domain.evaluateUserSettlement(store, login.data.token, {});

  const reviewTemplateEnv = {
    ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES: JSON.stringify({
      FREE_ORDER_REVIEW: {
        title: "运营免单解释",
        pendingReason: "核对 {{reason}} 与免单库存",
        evidenceRequired: ["打卡记录", "订单证据"],
        operatorGuidance: "先核库存，再核订单。",
        nextAction: "等待免单复核通知。",
      },
    }),
  };
  const before = domain.getAdminConfigWorkbench(store, { env: reviewTemplateEnv }).data;
  const reviewId = before.manualReviews[0].reviewItemId;
  const resolved = domain.resolveAdminManualReview(store, reviewId, {
    decision: "APPROVED",
    reason: "运营确认免单机会通过",
    publicNote: "运营已确认免单机会通过，后续会同步奖励发放状态。",
    operatorId: "ops-admin",
  }).data;
  const after = domain.getAdminConfigWorkbench(store, { env: reviewTemplateEnv }).data;
  const userStatus = domain.getSettlementStatus(store, login.data.token).data;

  assert.equal(before.metrics.openManualReviews, 1);
  assert.equal(before.manualReviewExplanationTemplates.status, "READY");
  assert.equal(before.manualReviewExplanationTemplates.templates.find((item) => item.templateKey === "FREE_ORDER_REVIEW").title, "运营免单解释");
  assert.equal(before.manualReviews[0].explanationTitle, "运营免单解释");
  assert.equal(before.manualReviews[0].pendingReason, "核对 免单机会需要运营确认 与免单库存");
  assert.deepEqual(before.manualReviews[0].evidenceRequired, ["打卡记录", "订单证据"]);
  assert.equal(before.manualReviews[0].operatorGuidance, "先核库存，再核订单。");
  assert.equal(before.rewardGrants.some((grant) => grant.status === "PENDING_REVIEW"), true);
  assert.equal(resolved.review.status, "RESOLVED");
  assert.equal(resolved.review.publicNote, "运营已确认免单机会通过，后续会同步奖励发放状态。");
  assert.equal(userStatus.manualReviews[0].statusCopy, "运营已确认免单机会通过，后续会同步奖励发放状态。");
  assert.equal(userStatus.manualReviews[0].operatorGuidance, "");
  assert.equal(after.metrics.openManualReviews, 0);
  assert.equal(after.rewardGrants.some((grant) => grant.status === "APPROVED"), true);
  assert.equal(store.auditLogs[0].action, "RESOLVE_MANUAL_REVIEW");
  assert.equal(store.auditLogs[0].operator_id, "ops-admin");
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

test("admin batch manual review resolves reward grants and writes request audit", async () => {
  const store = domain.createStore();
  const firstLogin = await domain.loginWithWechat(store, {
    openid: "admin_batch_review_first_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const secondLogin = await domain.loginWithWechat(store, {
    openid: "admin_batch_review_second_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  [firstLogin, secondLogin].forEach((login, userIndex) => {
    domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
    for (let day = 0; day < 7; day += 1) {
      const taskDate = addDays("2026-06-19", day);
      domain.recordUserTaskEvent(store, login.data.token, {
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `admin-batch-review-${userIndex}-checkin-${day + 1}`,
      });
    }
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: `admin-batch-review-${userIndex}-day8`,
    });
    domain.evaluateUserSettlement(store, login.data.token, {});
  });

  const reviewItemIds = store.manualReviewItems.map((item) => item.manual_review_item_id);

  assert.equal(reviewItemIds.length, 2);
  assert.throws(
    () => domain.resolveAdminManualReviewBatch(store, { reviewItemIds, requestId: "batch-review-no-confirm" }),
    /二次确认/
  );
  assert.throws(
    () => domain.resolveAdminManualReviewBatch(store, { reviewItemIds, confirmRisk: true }),
    /request_id/
  );

  const resolved = domain.resolveAdminManualReviewBatch(store, {
    reviewItemIds,
    decision: "APPROVED",
    confirmRisk: true,
    requestId: "batch-review-request-1",
    operatorId: "ops-review",
    reason: "路演批量复核",
  }).data;

  assert.equal(resolved.summary.total, 2);
  assert.equal(resolved.summary.resolved, 2);
  assert.equal(resolved.summary.approved, 2);
  assert.equal(store.manualReviewItems.every((item) => item.status === "RESOLVED"), true);
  assert.equal(store.rewardGrants.filter((grant) => grant.status === "APPROVED").length, 2);
  assert.equal(store.auditLogs[0].action, "BATCH_MANUAL_REVIEW_RESOLVE");
  assert.equal(store.auditLogs[0].target_id, "batch-review-request-1");
  assert.equal(store.auditLogs[0].metadata.requestId, "batch-review-request-1");
  assert.equal(store.auditLogs.filter((log) => log.action === "RESOLVE_MANUAL_REVIEW").length, 2);
});

test("admin reward delivery can fail, retry, and complete with audit", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "admin_reward_delivery_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, login.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, login.data.token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `admin-reward-delivery-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "admin-reward-delivery-day8",
  });
  domain.evaluateUserSettlement(store, login.data.token, {});

  const deliveryJobId = store.rewardDeliveryJobs[0].reward_delivery_job_id;
  const couponGrant = store.rewardGrants.find((grant) => grant.reward_type === "YOUZAN_COUPON");

  assert.equal(couponGrant.status, "PENDING_DELIVERY");
  await assert.rejects(
    () => domain.executeAdminRewardDelivery(store, { deliveryJobIds: [deliveryJobId], requestId: "reward-delivery-no-confirm" }),
    /二次确认/
  );
  await assert.rejects(
    () => domain.executeAdminRewardDelivery(store, { deliveryJobIds: [deliveryJobId], confirmRisk: true }),
    /request_id/
  );

  const failed = (await domain.executeAdminRewardDelivery(store, {
    deliveryJobIds: [deliveryJobId],
    outcome: "FAILED",
    confirmRisk: true,
    requestId: "reward-delivery-fail-1",
    operatorId: "ops-delivery",
    reason: "有赞权限未开",
    errorMessage: "有赞发券权限未配置",
  })).data;
  const delivered = (await domain.executeAdminRewardDelivery(store, {
    deliveryJobIds: [deliveryJobId],
    outcome: "DELIVERED",
    externalRef: "YZ_COUPON_001",
    confirmRisk: true,
    requestId: "reward-delivery-ok-1",
    operatorId: "ops-delivery",
    reason: "人工确认有赞券已发放",
  })).data;

  assert.equal(failed.summary.failed, 1);
  assert.equal(store.rewardDeliveryJobs[0].status, "DELIVERED");
  assert.equal(store.rewardDeliveryJobs[0].attempt_count, 2);
  assert.equal(store.rewardDeliveryJobs[0].last_error, "");
  assert.equal(couponGrant.status, "DELIVERED");
  assert.equal(couponGrant.external_ref, "YZ_COUPON_001");
  assert.equal(delivered.summary.delivered, 1);
  assert.equal(store.auditLogs[0].action, "REWARD_DELIVERY_BATCH_EXECUTE");
  assert.equal(store.auditLogs[0].target_id, "reward-delivery-ok-1");
  assert.equal(store.auditLogs.filter((log) => log.action === "REWARD_DELIVERY_EXECUTE").length, 2);
});

test("admin lifecycle workbench exposes identity, progress, settlement, and reward summary", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "admin_lifecycle_openid",
    unionid: "admin_lifecycle_unionid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const token = login.data.token;
  const rootUserId = login.data.user.rootUserId;

  domain.joinCampaign(store, token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `admin-lifecycle-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-22",
    payload: { questionnaireType: "DAY4_MIDPOINT" },
    idempotencyKey: "admin-lifecycle-day4",
  });
  domain.recordUserTaskEvent(store, token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "admin-lifecycle-day8",
  });
  domain.evaluateUserSettlement(store, token, {});

  const workbench = domain.getAdminLifecycleWorkbench(store, { keyword: "admin_lifecycle_unionid" }).data;
  const row = workbench.users[0];

  assert.equal(workbench.metrics.totalUsers, 1);
  assert.equal(workbench.metrics.unionidLinked, 1);
  assert.equal(row.rootUserId, rootUserId);
  assert.equal(row.unionidStatus, "LINKED");
  assert.equal(row.openidList[0], "MYROOT:admin_lifecycle_openid");
  assert.equal(row.taskSummary.settlementReady, true);
  assert.equal(row.latestSettlement.status, "QUALIFIED");
  assert.equal(row.rewardSummary.rewardCount, 2);
  assert.equal(row.rewardSummary.pendingRewardCount, 2);

  const filtered = domain.getAdminLifecycleWorkbench(store, {
    campaignId: "ROOT_7D_RESET",
    taskProgress: "SETTLEMENT_READY",
    settlementStatus: "QUALIFIED",
    rewardStatus: "PENDING",
    consultationStatus: "NONE",
    openTasks: "NO_OPEN_TASKS",
  }).data;
  const excluded = domain.getAdminLifecycleWorkbench(store, {
    campaignId: "ROOT_7D_RESET",
    consultationStatus: "PENDING",
  }).data;
  const csv = domain.exportAdminLifecycleUsersCsv(store, {
    campaignId: "ROOT_7D_RESET",
    taskProgress: "SETTLEMENT_READY",
    settlementStatus: "QUALIFIED",
    rewardStatus: "PENDING",
    consultationStatus: "NONE",
    openTasks: "NO_OPEN_TASKS",
  });
  const rawCsv = domain.exportAdminLifecycleUsersCsv(store, {
    campaignId: "ROOT_7D_RESET",
    taskProgress: "SETTLEMENT_READY",
    settlementStatus: "QUALIFIED",
    rewardStatus: "PENDING",
    consultationStatus: "NONE",
    openTasks: "NO_OPEN_TASKS",
    sensitivity: "RAW",
  }, { adminPrincipal: { role: "admin", tokenConfigured: true } });
  const operatorRawCsv = domain.exportAdminLifecycleUsersCsv(store, {
    campaignId: "ROOT_7D_RESET",
    taskProgress: "SETTLEMENT_READY",
    settlementStatus: "QUALIFIED",
    rewardStatus: "PENDING",
    consultationStatus: "NONE",
    openTasks: "NO_OPEN_TASKS",
    sensitivity: "RAW",
  }, { adminPrincipal: { role: "operator", tokenConfigured: true } });
  store.adminLifecycleUserExports.push({
    export_id: "lue_expired_domain",
    source: "LIFECYCLE_USERS",
    status: "COMPLETED",
    request_id: "expired-domain-export",
    operator_id: "ops-lifecycle",
    reason: "过期导出记录",
    filters_json: {},
    summary_json: { total: 0, exportedCount: 0, limit: 20, truncated: false, retentionDays: 1, bytes: 0 },
    filename: "expired.csv",
    content_type: "text/csv; charset=utf-8",
    csv_text: "",
    download_count: 0,
    created_at: "2026-06-01T10:00:00+08:00",
    expires_at: "2026-06-02T23:59:59+08:00",
    last_downloaded_at: "",
  });
  assert.throws(() => domain.runAdminLifecycleUserExportJob(store, {
    dryRun: false,
    filters: filtered.filters,
  }), /request_id 必填/);
  const exportDryRun = domain.runAdminLifecycleUserExportJob(store, {
    dryRun: true,
    filters: filtered.filters,
    retentionDays: 7,
  }).data;
  const scheduledExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 7,
    requestId: "domain-lifecycle-users-export-1",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期导出记录",
    now: "2026-06-20T10:00:00+08:00",
  }).data;
  const exportRecordsBeforeDownload = domain.listAdminLifecycleUserExports(store, {
    now: "2026-06-20T10:01:00+08:00",
  }).data;
  const exportDownload = domain.downloadAdminLifecycleUserExport(store, scheduledExport.exportRecord.exportId, {
    now: "2026-06-20T10:02:00+08:00",
  });
  const exportRecordsAfterDownload = domain.listAdminLifecycleUserExports(store, {
    now: "2026-06-20T10:03:00+08:00",
  }).data;
  const rawApprovalExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 7,
    sensitivity: "RAW",
    requestId: "domain-lifecycle-users-export-raw-approval",
    operatorId: "admin-lifecycle",
    reason: "Domain 生命周期原文字段导出",
    now: "2026-06-20T10:04:00+08:00",
  }, { adminPrincipal: { role: "admin", tokenConfigured: true } }).data;
  assert.throws(() => domain.downloadAdminLifecycleUserExport(store, rawApprovalExport.exportRecord.exportId, {
    now: "2026-06-20T10:05:00+08:00",
  }), /审批通过/);
  const approvedRawExport = domain.reviewAdminLifecycleUserExportApproval(store, {
    exportId: rawApprovalExport.exportRecord.exportId,
    decision: "APPROVED",
    operatorId: "finance-lifecycle",
    note: "审批原文字段导出",
    now: "2026-06-20T10:06:00+08:00",
  }).data;
  const rawExportDownload = domain.downloadAdminLifecycleUserExport(store, rawApprovalExport.exportRecord.exportId, {
    now: "2026-06-20T10:07:00+08:00",
  });
  const rejectedExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    approvalRequired: true,
    requestId: "domain-lifecycle-users-export-reject",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期待拒绝导出",
    now: "2026-06-20T10:08:00+08:00",
  }).data;
  const rejectedReview = domain.reviewAdminLifecycleUserExportApproval(store, {
    exportId: rejectedExport.exportRecord.exportId,
    decision: "REJECTED",
    operatorId: "finance-lifecycle",
    note: "拒绝下载",
    now: "2026-06-20T10:09:00+08:00",
  }).data;
  assert.throws(() => domain.downloadAdminLifecycleUserExport(store, rejectedExport.exportRecord.exportId, {
    now: "2026-06-20T10:10:00+08:00",
  }), /已拒绝/);
  const deliveryReadyExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 7,
    deliveryEnabled: true,
    deliveryChannel: "INTERNAL_LINK",
    requestId: "domain-lifecycle-users-export-delivery",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期外部交付导出",
    now: "2026-06-20T10:11:00+08:00",
  }).data;
  const deliveredReadyExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: deliveryReadyExport.exportRecord.exportId,
    deliveryChannel: "INTERNAL_LINK",
    requestId: "domain-lifecycle-users-export-delivery-send",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:12:00+08:00",
  }, { publicBaseUrl: "https://root.example.com" })).data;
  const signedReadyExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: deliveryReadyExport.exportRecord.exportId,
    deliveryChannel: "INTERNAL_LINK",
    signedDownload: true,
    signedDownloadTtlSeconds: 600,
    requestId: "domain-lifecycle-users-export-signed-delivery",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:12:20+08:00",
  }, {
    publicBaseUrl: "https://root.example.com",
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
  })).data;
  const signedUrl = new URL(signedReadyExport.delivery.externalRef);
  const signedDownload = domain.downloadSignedAdminLifecycleUserExport(store, deliveryReadyExport.exportRecord.exportId, Object.fromEntries(signedUrl.searchParams), {
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
    now: "2026-06-20T10:13:00+08:00",
  });
  assert.throws(() => domain.downloadSignedAdminLifecycleUserExport(store, deliveryReadyExport.exportRecord.exportId, {
    expires: signedUrl.searchParams.get("expires"),
    signature: "bad-signature",
  }, {
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
    now: "2026-06-20T10:13:10+08:00",
  }), /签名链接无效/);
  assert.throws(() => domain.downloadSignedAdminLifecycleUserExport(store, deliveryReadyExport.exportRecord.exportId, Object.fromEntries(signedUrl.searchParams), {
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
    now: "2026-06-20T10:30:00+08:00",
  }), /签名链接已过期/);
  const unsignedUrl = lifecycleExportDelivery.signedDownloadUrl(deliveryReadyExport.exportRecord, {}, {});
  const lifecycleExportWebhookCalls = [];
  const webhookReadyExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: deliveryReadyExport.exportRecord.exportId,
    deliveryChannel: "WEBHOOK",
    webhookUrl: "https://hooks.example.com/root-lifecycle-export",
    webhookSecret: "domain-webhook-secret",
    webhookChannel: "WEWORK",
    webhookTemplate: "lifecycle_export_ready",
    signedDownload: true,
    signedDownloadTtlSeconds: 900,
    requestId: "domain-lifecycle-users-export-webhook-delivery",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:13:20+08:00",
  }, {
    publicBaseUrl: "https://root.example.com",
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
    fetchImpl: async (url, init) => {
      lifecycleExportWebhookCalls.push({ url, init });
      return { ok: true, status: 202, text: async () => "accepted lifecycle export" };
    },
  })).data;
  const webhookPayload = JSON.parse(lifecycleExportWebhookCalls[0].init.body);
  const retryWebhookExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 7,
    requestId: "domain-lifecycle-users-export-webhook-retry",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期 Webhook 重试导出",
    now: "2026-06-20T10:13:30+08:00",
  }).data;
  const retryWebhookCalls = [];
  const retryScheduledExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: retryWebhookExport.exportRecord.exportId,
    deliveryChannel: "WEBHOOK",
    webhookUrl: "https://hooks.example.com/root-lifecycle-export-retry",
    webhookSecret: "domain-webhook-secret",
    webhookChannel: "WEWORK",
    webhookTemplate: "lifecycle_export_ready",
    signedDownload: true,
    deliveryRetryEnabled: true,
    deliveryMaxAttempts: 2,
    deliveryRetryDelaySeconds: 60,
    requestId: "domain-lifecycle-users-export-webhook-retry-first",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:14:00+08:00",
  }, {
    publicBaseUrl: "https://root.example.com",
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
    fetchImpl: async (url, init) => {
      retryWebhookCalls.push({ url, init });
      return { ok: false, status: 500, text: async () => "temporary upstream failure" };
    },
  })).data;
  const retryPreview = (await domain.runDueAdminLifecycleExportDeliveries(store, {
    dryRun: true,
    limit: 5,
    now: "2026-06-20T10:15:01+08:00",
  })).data;
  const deliveryHealthBeforeRetry = domain.getAdminLifecycleExportDeliveryHealth(store, {
    now: "2026-06-20T10:15:01+08:00",
  }).data;
  const retryExecuted = (await domain.runDueAdminLifecycleExportDeliveries(store, {
    dryRun: false,
    limit: 5,
    deliveryChannel: "WEBHOOK",
    webhookUrl: "https://hooks.example.com/root-lifecycle-export-retry",
    webhookSecret: "domain-webhook-secret",
    webhookChannel: "WEWORK",
    webhookTemplate: "lifecycle_export_ready",
    signedDownload: true,
    deliveryMaxAttempts: 2,
    deliveryRetryDelaySeconds: 60,
    requestId: "domain-lifecycle-users-export-webhook-retry-job",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:15:01+08:00",
  }, {
    publicBaseUrl: "https://root.example.com",
    env: { ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "domain-export-secret" },
    fetchImpl: async (url, init) => {
      retryWebhookCalls.push({ url, init });
      return { ok: true, status: 202, text: async () => "accepted lifecycle export retry" };
    },
  })).data;
  const deliveryHealthAfterRetry = domain.getAdminLifecycleExportDeliveryHealth(store, {
    now: "2026-06-20T10:15:02+08:00",
  }).data;
  const pendingDeliveryExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 7,
    approvalRequired: true,
    deliveryEnabled: true,
    deliveryChannel: "INTERNAL_LINK",
    requestId: "domain-lifecycle-users-export-delivery-pending",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期待审批交付导出",
    now: "2026-06-20T10:13:00+08:00",
  }).data;
  await assert.rejects(() => domain.deliverAdminLifecycleUserExport(store, {
    exportId: pendingDeliveryExport.exportRecord.exportId,
    deliveryChannel: "INTERNAL_LINK",
    requestId: "domain-lifecycle-users-export-delivery-before-approval",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:14:00+08:00",
  }), /审批通过/);
  const approvedPendingDelivery = domain.reviewAdminLifecycleUserExportApproval(store, {
    exportId: pendingDeliveryExport.exportRecord.exportId,
    decision: "APPROVED",
    operatorId: "finance-lifecycle",
    note: "审批交付",
    now: "2026-06-20T10:15:00+08:00",
  }).data;
  const deliveredApprovedExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: pendingDeliveryExport.exportRecord.exportId,
    deliveryChannel: "INTERNAL_LINK",
    requestId: "domain-lifecycle-users-export-delivery-after-approval",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:16:00+08:00",
  }, { publicBaseUrl: "https://root.example.com" })).data;
  const objectDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-lifecycle-object-domain-"));
  const objectStorageExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 7,
    requestId: "domain-lifecycle-users-export-object-storage",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期对象存储导出",
    now: "2026-06-20T10:17:00+08:00",
  }).data;
  const deliveredObjectExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: objectStorageExport.exportRecord.exportId,
    deliveryChannel: "OBJECT_STORAGE",
    objectDir,
    objectPrefix: "domain-lifecycle-exports",
    requestId: "domain-lifecycle-users-export-object-storage-send",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:18:00+08:00",
  })).data;
  const objectPath = path.join(objectDir, deliveredObjectExport.delivery.target.objectKey);
  const objectText = fs.readFileSync(objectPath, "utf8");
  const objectMetadata = JSON.parse(fs.readFileSync(`${objectPath}.metadata.json`, "utf8"));
  const expiredObjectStorageExport = domain.createAdminLifecycleUserExport(store, {
    dryRun: false,
    filters: filtered.filters,
    retentionDays: 1,
    requestId: "domain-lifecycle-users-export-object-expired",
    operatorId: "ops-lifecycle",
    reason: "Domain 生命周期过期对象导出",
    now: "2026-06-01T10:19:00+08:00",
  }).data;
  const deliveredExpiredObjectExport = (await domain.deliverAdminLifecycleUserExport(store, {
    exportId: expiredObjectStorageExport.exportRecord.exportId,
    deliveryChannel: "OBJECT_STORAGE",
    objectDir,
    objectPrefix: "domain-lifecycle-exports",
    requestId: "domain-lifecycle-users-export-object-expired-send",
    operatorId: "finance-lifecycle",
    now: "2026-06-01T10:20:00+08:00",
  })).data;
  const expiredObjectPath = path.join(objectDir, deliveredExpiredObjectExport.delivery.target.objectKey);
  const expiredObjectPreview = await domain.cleanupAdminLifecycleUserExports(store, {
    dryRun: true,
    limit: 10,
    objectDir,
    now: "2026-06-20T10:21:00+08:00",
  });
  const hiddenExpiredObjectExport = domain.listAdminLifecycleUserExports(store, {
    now: "2026-06-20T10:22:00+08:00",
    limit: 20,
  }).data;
  assert.throws(() => domain.downloadAdminLifecycleUserExport(store, expiredObjectStorageExport.exportRecord.exportId, {
    now: "2026-06-20T10:23:00+08:00",
  }), /不存在或已过期/);
  const expiredObjectCleanup = await domain.cleanupAdminLifecycleUserExports(store, {
    dryRun: false,
    limit: 10,
    objectDir,
    requestId: "domain-lifecycle-user-exports-cleanup-1",
    operatorId: "finance-lifecycle",
    now: "2026-06-20T10:24:00+08:00",
  });
  const savedPreset = domain.upsertAdminLifecycleFilterPreset(store, {
    operatorId: "ops-lifecycle",
    title: "可结算待发奖",
    filters: filtered.filters,
    requestId: "domain-lifecycle-filter-1",
  }).data;
  const updatedPreset = domain.upsertAdminLifecycleFilterPreset(store, {
    operatorId: "ops-lifecycle",
    presetId: savedPreset.preset.presetId,
    title: "路演可结算待发奖",
    scope: "TEAM",
    pinned: true,
    sortOrder: 10,
    filters: { ...filtered.filters, severity: "LOW" },
    requestId: "domain-lifecycle-filter-2",
  }).data;
  const personalPreset = domain.upsertAdminLifecycleFilterPreset(store, {
    operatorId: "ops-lifecycle",
    title: "个人待办筛选",
    scope: "PERSONAL",
    pinned: false,
    sortOrder: 80,
    filters: { openTasks: "HAS_OPEN_TASKS", limit: 20 },
    requestId: "domain-lifecycle-filter-3",
  }).data;
  const otherOperatorPresets = domain.listAdminLifecycleFilterPresets(store, { operatorId: "other-ops" }).data;
  const copiedPreset = domain.copyAdminLifecycleFilterPreset(store, {
    operatorId: "other-ops",
    sourcePresetId: savedPreset.preset.presetId,
    requestId: "domain-lifecycle-filter-copy-1",
  }).data;
  const otherOperatorPresetsAfterCopy = domain.listAdminLifecycleFilterPresets(store, { operatorId: "other-ops" }).data;
  assert.throws(() => domain.upsertAdminLifecycleFilterPreset(store, {
    operatorId: "other-ops",
    presetId: savedPreset.preset.presetId,
    title: "误改团队筛选",
    scope: "TEAM",
    filters: filtered.filters,
    requestId: "domain-lifecycle-filter-other-edit",
  }), /不能修改其他操作人的常用筛选/);
  assert.throws(() => domain.deleteAdminLifecycleFilterPreset(store, {
    operatorId: "other-ops",
    presetId: savedPreset.preset.presetId,
    requestId: "domain-lifecycle-filter-other-delete",
  }), /不能删除其他操作人的常用筛选/);
  assert.throws(() => domain.copyAdminLifecycleFilterPreset(store, {
    operatorId: "other-ops",
    sourcePresetId: personalPreset.preset.presetId,
    requestId: "domain-lifecycle-filter-other-copy-private",
  }), /常用筛选不存在或不可复制/);
  const deletedPreset = domain.deleteAdminLifecycleFilterPreset(store, {
    operatorId: "ops-lifecycle",
    presetId: savedPreset.preset.presetId,
    requestId: "domain-lifecycle-filter-delete-1",
  }).data;
  const presetsAfterDelete = domain.listAdminLifecycleFilterPresets(store, { operatorId: "ops-lifecycle" }).data;

  assert.equal(filtered.total, 1);
  assert.equal(filtered.users[0].taskProgressStatus, "SETTLEMENT_READY");
  assert.equal(filtered.users[0].settlementStatus, "QUALIFIED");
  assert.equal(filtered.users[0].rewardStatus, "PENDING");
  assert.equal(filtered.users[0].consultationStatus, "NONE");
  assert.equal(filtered.filters.rewardStatus, "PENDING");
  assert.equal(excluded.total, 0);
  assert.match(csv, /root_user_id,user_id,nickname,phone/);
  assert.doesNotMatch(csv, /admin_lifecycle_unionid/);
  assert.match(csv, /admi\.\.\.onid/);
  assert.match(rawCsv, /admin_lifecycle_unionid/);
  assert.doesNotMatch(operatorRawCsv, /admin_lifecycle_unionid/);
  assert.match(csv, /SETTLEMENT_READY/);
  assert.match(csv, /QUALIFIED/);
  assert.match(csv, /PENDING/);
  assert.equal(exportDryRun.dryRun, true);
  assert.equal(exportDryRun.summary.exportedCount, 1);
  assert.equal(exportDryRun.summary.sensitivity, "MASKED");
  assert.equal(scheduledExport.executed, true);
  assert.equal(scheduledExport.prunedExpiredCount, 1);
  assert.equal(scheduledExport.exportRecord.operatorId, "ops-lifecycle");
  assert.equal(scheduledExport.exportRecord.summary.exportedCount, 1);
  assert.equal(scheduledExport.exportRecord.summary.truncated, false);
  assert.equal(scheduledExport.exportRecord.summary.sensitivity, "MASKED");
  assert.deepEqual(scheduledExport.exportRecord.summary.sensitiveFields, ["phone", "verified_phone", "unionid", "openid_list"]);
  assert.equal(scheduledExport.exportRecord.approvalRequired, false);
  assert.equal(scheduledExport.exportRecord.approvalStatus, "NOT_REQUIRED");
  assert.equal(scheduledExport.exportRecord.delivery.status, "NOT_REQUESTED");
  assert.equal(scheduledExport.exportRecord.expiresAt, "2026-06-27T23:59:59+08:00");
  assert.equal(exportRecordsBeforeDownload.some((item) => item.exportId === "lue_expired_domain"), false);
  assert.equal(exportRecordsBeforeDownload[0].downloadCount, 0);
  assert.doesNotMatch(exportDownload.csvText, /admin_lifecycle_unionid/);
  assert.equal(exportDownload.record.sensitivity, "MASKED");
  assert.equal(exportDownload.record.downloadCount, 1);
  assert.equal(exportRecordsAfterDownload[0].downloadCount, 1);
  assert.equal(rawApprovalExport.exportRecord.summary.sensitivity, "RAW");
  assert.equal(rawApprovalExport.exportRecord.approvalRequired, true);
  assert.equal(rawApprovalExport.exportRecord.approvalStatus, "PENDING");
  assert.equal(approvedRawExport.approved, true);
  assert.equal(approvedRawExport.exportRecord.approvalStatus, "APPROVED");
  assert.match(rawExportDownload.csvText, /admin_lifecycle_unionid/);
  assert.equal(rejectedReview.rejected, true);
  assert.equal(rejectedReview.exportRecord.approvalStatus, "REJECTED");
  assert.equal(deliveryReadyExport.exportRecord.delivery.status, "READY");
  assert.equal(deliveredReadyExport.delivered, true);
  assert.equal(deliveredReadyExport.delivery.status, "DELIVERED");
  assert.match(deliveredReadyExport.delivery.externalRef, /https:\/\/root\.example\.com\/api\/v1\/admin\/lifecycle-user-exports\//);
  assert.equal(signedReadyExport.delivered, true);
  assert.equal(signedReadyExport.delivery.status, "DELIVERED");
  assert.match(signedReadyExport.delivery.externalRef, /\/api\/v1\/lifecycle-user-exports\/.+\/signed-download\?expires=/);
  assert.doesNotMatch(signedReadyExport.delivery.externalRef, /\/api\/v1\/admin\//);
  assert.equal(signedReadyExport.delivery.target.signedDownload, true);
  assert.match(signedDownload.csvText, /root_user_id,user_id,nickname,phone/);
  assert.equal(signedDownload.record.downloadCount, 1);
  assert.equal(unsignedUrl, "");
  assert.equal(webhookReadyExport.delivered, true);
  assert.equal(webhookReadyExport.delivery.status, "DELIVERED");
  assert.equal(webhookReadyExport.delivery.externalRef, "HTTP 202");
  assert.equal(webhookReadyExport.delivery.target.webhookChannel, "WEWORK");
  assert.equal(webhookReadyExport.delivery.target.webhookTemplate, "lifecycle_export_ready");
  assert.equal(webhookReadyExport.delivery.target.webhookStatusCode, 202);
  assert.equal(webhookReadyExport.delivery.target.webhookSigned, true);
  assert.equal(webhookReadyExport.delivery.target.signedDownload, true);
  assert.equal(webhookReadyExport.delivery.target.signedDownloadUrlPreview, "https://root.example.com/api/v1/lifecycle-user-exports/" + deliveryReadyExport.exportRecord.exportId + "/signed-download");
  assert.equal(webhookReadyExport.delivery.target.webhookResponsePreview, "accepted lifecycle export");
  assert.equal(lifecycleExportWebhookCalls.length, 1);
  assert.equal(lifecycleExportWebhookCalls[0].url, "https://hooks.example.com/root-lifecycle-export");
  assert.equal(lifecycleExportWebhookCalls[0].init.headers["X-Root-Export-Webhook-Channel"], "WEWORK");
  assert.equal(lifecycleExportWebhookCalls[0].init.headers["X-Root-Export-Webhook-Template"], "lifecycle_export_ready");
  assert.equal(lifecycleExportWebhookCalls[0].init.headers["X-Root-Export-Signed-Download"], "true");
  assert.equal(lifecycleExportWebhookCalls[0].init.headers["X-Root-Export-Signature"], lifecycleExportDelivery.signatureForBody(lifecycleExportWebhookCalls[0].init.body, "domain-webhook-secret"));
  assert.match(webhookPayload.export.signedDownloadUrl, /https:\/\/root\.example\.com\/api\/v1\/lifecycle-user-exports\/.+\/signed-download\?expires=/);
  assert.doesNotMatch(webhookPayload.export.signedDownloadUrl, /\/api\/v1\/admin\//);
  assert.equal(webhookPayload.delivery.webhookChannel, "WEWORK");
  assert.equal(webhookPayload.delivery.webhookTemplate, "lifecycle_export_ready");
  assert.equal(webhookPayload.delivery.signedDownload, true);
  assert.equal(Boolean(webhookPayload.csvText), false);
  assert.equal(retryScheduledExport.delivered, false);
  assert.equal(retryScheduledExport.delivery.status, "RETRY_SCHEDULED");
  assert.equal(retryScheduledExport.delivery.externalRef, "HTTP 500");
  assert.equal(retryScheduledExport.delivery.attemptCount, 1);
  assert.equal(retryScheduledExport.delivery.nextRetryAt, "2026-06-20T10:15:00+08:00");
  assert.equal(retryScheduledExport.delivery.maxAttempts, 2);
  assert.equal(retryPreview.selectedCount, 1);
  assert.equal(retryPreview.candidates[0].exportId, retryWebhookExport.exportRecord.exportId);
  assert.equal(deliveryHealthBeforeRetry.status, "WARNING");
  assert.equal(deliveryHealthBeforeRetry.summary.retryScheduledCount, 1);
  assert.equal(deliveryHealthBeforeRetry.summary.dueRetryCount, 1);
  assert.equal(deliveryHealthBeforeRetry.channels.some((item) => item.channel === "WEBHOOK" && item.dueRetry === 1), true);
  assert.equal(deliveryHealthBeforeRetry.failureReasons.some((item) => item.reason === "HTTP 500" && item.count === 1), true);
  assert.equal(retryExecuted.executed, true);
  assert.equal(retryExecuted.deliveredCount, 1);
  assert.equal(retryExecuted.results[0].status, "DELIVERED");
  assert.equal(deliveryHealthAfterRetry.status, "HEALTHY");
  assert.equal(deliveryHealthAfterRetry.summary.deliveredCount >= 2, true);
  assert.equal(deliveryHealthAfterRetry.summary.dueRetryCount, 0);
  assert.equal(deliveryHealthAfterRetry.channels.some((item) => item.channel === "WEBHOOK" && item.delivered >= 1 && item.dueRetry === 0), true);
  assert.equal(retryWebhookCalls.length, 2);
  assert.equal(pendingDeliveryExport.exportRecord.delivery.status, "PENDING_APPROVAL");
  assert.equal(approvedPendingDelivery.exportRecord.delivery.status, "READY");
  assert.equal(deliveredApprovedExport.delivery.status, "DELIVERED");
  assert.equal(deliveredObjectExport.delivery.status, "DELIVERED");
  assert.equal(deliveredObjectExport.delivery.target.adapter, "FILESYSTEM");
  assert.match(deliveredObjectExport.delivery.target.objectKey, /^domain-lifecycle-exports\//);
  assert.match(objectText, /root_user_id,user_id,nickname,phone/);
  assert.equal(objectMetadata.contentType, "text/csv; charset=utf-8");
  assert.equal(objectMetadata.metadata.export.exportId, objectStorageExport.exportRecord.exportId);
  assert.equal(fs.existsSync(expiredObjectPath), false);
  assert.equal(fs.existsSync(`${expiredObjectPath}.metadata.json`), false);
  assert.equal(expiredObjectPreview.data.dryRun, true);
  assert.equal(expiredObjectPreview.data.candidates.some((item) => item.exportId === expiredObjectStorageExport.exportRecord.exportId && item.delivery.objectKey), true);
  assert.equal(hiddenExpiredObjectExport.some((item) => item.exportId === expiredObjectStorageExport.exportRecord.exportId), false);
  assert.equal(expiredObjectCleanup.data.executed, true);
  assert.equal(expiredObjectCleanup.data.removedCount, 1);
  assert.equal(expiredObjectCleanup.data.objectDeletedCount, 1);
  assert.equal(store.adminLifecycleUserExports.some((item) => item.export_id === expiredObjectStorageExport.exportRecord.exportId), false);
  assert.equal(savedPreset.created, true);
  assert.equal(savedPreset.presets.length, 1);
  assert.equal(savedPreset.preset.filters.rewardStatus, "PENDING");
  assert.equal(updatedPreset.created, false);
  assert.equal(updatedPreset.preset.title, "路演可结算待发奖");
  assert.equal(updatedPreset.preset.filters.severity, "LOW");
  assert.equal(updatedPreset.preset.scope, "TEAM");
  assert.equal(updatedPreset.preset.pinned, true);
  assert.equal(updatedPreset.preset.sortOrder, 10);
  assert.equal(personalPreset.presets[0].presetId, savedPreset.preset.presetId);
  assert.equal(personalPreset.presets[1].presetId, personalPreset.preset.presetId);
  assert.equal(otherOperatorPresets.presets.length, 1);
  assert.equal(otherOperatorPresets.presets[0].scope, "TEAM");
  assert.equal(otherOperatorPresets.presets[0].canModify, false);
  assert.equal(copiedPreset.sourcePreset.presetId, savedPreset.preset.presetId);
  assert.equal(copiedPreset.preset.operatorId, "other-ops");
  assert.equal(copiedPreset.preset.scope, "PERSONAL");
  assert.equal(copiedPreset.preset.pinned, false);
  assert.equal(copiedPreset.preset.sortOrder, 100);
  assert.match(copiedPreset.preset.title, /副本/);
  assert.equal(copiedPreset.preset.filters.severity, "LOW");
  assert.equal(otherOperatorPresetsAfterCopy.presets.length, 2);
  assert.equal(otherOperatorPresetsAfterCopy.presets.some((item) => item.presetId === copiedPreset.preset.presetId && item.canModify === true), true);
  assert.equal(deletedPreset.deleted, true);
  assert.equal(presetsAfterDelete.presets.length, 1);
  assert.equal(presetsAfterDelete.presets[0].title, "个人待办筛选");
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_FILTER_PRESET_UPSERT"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_FILTER_PRESET_COPY"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_FILTER_PRESET_DELETE"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_RUN"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_DOWNLOAD"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_APPROVAL"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_DELIVERY"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_CLEANUP"), true);
});

test("admin operational analytics aggregates lifecycle funnel and bottlenecks", async () => {
  const store = domain.createStore();
  const login = domain.login(store, { phone: "13800088118" }).data;
  const token = login.token;
  const rootUserId = login.user.rootUserId;
  const analyticsUser = store.users.find((item) => item.user_id === login.user.userId);
  analyticsUser.created_at = "2026-06-19T08:55:00+08:00";
  analyticsUser.registered_at = "2026-06-19T08:55:00+08:00";
  const analyticsRootUser = store.rootUsers.find((item) => item.root_user_id === rootUserId);
  analyticsRootUser.created_at = "2026-06-19T08:55:00+08:00";
  analyticsRootUser.updated_at = "2026-06-19T08:55:00+08:00";

  store.leadProfiles.push({
    lead_id: "lead_analytics_linked_001",
    user_id: login.user.userId,
    root_user_id: rootUserId,
    external_contact_id: "wm_analytics_linked",
    source_channel: "线下路演",
    corp_wechat_status: "ADDED",
    created_at: "2026-06-19T09:00:00+08:00",
    updated_at: "2026-06-19T09:00:00+08:00",
  });
  store.leadProfiles.push({
    lead_id: "lead_analytics_unresolved_001",
    external_contact_id: "wm_analytics_unresolved",
    source_channel: "线下路演",
    corp_wechat_status: "ADDED",
    created_at: "2026-06-19T09:05:00+08:00",
    updated_at: "2026-06-19T09:05:00+08:00",
  });
  store.youzanOrders.push({
    order_id: "ord_analytics_001",
    user_id: login.user.userId,
    youzan_order_no: "YZ_ANALYTICS_001",
    receiver_phone: "13800088118",
    product_name: "ROOT 7日试饮装",
    order_status: "PAID",
    delivery_status: "DELIVERED",
    paid_at: "2026-06-19T10:00:00+08:00",
    matched_at: "2026-06-19T10:05:00+08:00",
    match_source: "AUTO_WECHAT_PHONE",
  });

  domain.joinCampaign(store, token, { campaignId: "ROOT_7D_RESET", sourceChannel: "ROADSHOW_QR" });
  const participantRecord = store.campaignParticipants.find((item) => item.root_user_id === rootUserId && item.campaign_id === "ROOT_7D_RESET");
  participantRecord.joined_at = "2026-06-19T09:10:00+08:00";
  participantRecord.created_at = "2026-06-19T09:10:00+08:00";
  participantRecord.updated_at = "2026-06-19T09:10:00+08:00";
  domain.recordProductJump(store, token, {
    campaignId: "ROOT_7D_RESET",
    productId: "ROOT_PREBIOTIC_TRIAL",
    sourceChannel: "MINIPROGRAM_PRODUCT",
  });
  const analyticsProductJump = store.productJumpLogs.at(-1);
  analyticsProductJump.occurred_at = "2026-06-19T09:20:00+08:00";
  analyticsProductJump.created_at = "2026-06-19T09:20:00+08:00";
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, token, {
      campaignId: "ROOT_7D_RESET",
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `analytics-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, token, {
    campaignId: "ROOT_7D_RESET",
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-22",
    payload: { questionnaireType: "DAY4_MIDPOINT" },
    idempotencyKey: "analytics-day4",
  });
  domain.recordUserTaskEvent(store, token, {
    campaignId: "ROOT_7D_RESET",
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "analytics-day8",
  });
  domain.evaluateUserSettlement(store, token, { campaignId: "ROOT_7D_RESET" });
  const couponJob = store.rewardDeliveryJobs.find((job) => job.adapter_type === "YOUZAN_COUPON");
  await domain.executeAdminRewardDelivery(store, {
    deliveryJobIds: [couponJob.reward_delivery_job_id],
    deliveryMode: "MANUAL",
    externalRef: "YZ_ANALYTICS_COUPON",
    requestId: "analytics-delivery-1",
    confirmRisk: true,
    operatorId: "ops-analytics",
    reason: "运营漏斗测试发券",
  });
  store.settlementRecords.forEach((item) => {
    item.evaluated_at = "2026-06-26T12:00:00+08:00";
    item.created_at = "2026-06-26T12:00:00+08:00";
  });
  store.rewardGrants.forEach((item) => {
    item.created_at = "2026-06-26T12:01:00+08:00";
    item.updated_at = "2026-06-26T12:02:00+08:00";
    if (item.delivered_at) item.delivered_at = "2026-06-26T12:02:00+08:00";
  });
  store.rewardDeliveryJobs.forEach((item) => {
    item.created_at = "2026-06-26T12:01:00+08:00";
    item.updated_at = "2026-06-26T12:02:00+08:00";
    if (item.delivered_at) item.delivered_at = "2026-06-26T12:02:00+08:00";
  });
  store.externalAdapterRuns.unshift({
    run_id: "adr_analytics_retry_exhausted",
    source_type: "YOUZAN_ORDER",
    adapter_kind: "YOUZAN_OPEN",
    mode: "IMPORT",
    status: "FAILED",
    total: 0,
    importable_count: 0,
    imported_count: 0,
    error_count: 0,
    warning_count: 0,
    external_count: 0,
    requested_limit: 50,
    cursor_before: "cursor-before-exhausted",
    cursor_after: "",
    has_more: false,
    review_id: "",
    rollback_status: "NOT_AVAILABLE",
    rollback_targets: [],
    rollback_notes: [],
    rollback_result: null,
    retry_status: "RETRYABLE",
    retry_attempt: 5,
    retry_source_run_id: "",
    retry_reason: "有赞上游持续 502",
    next_retry_at: "2026-06-19T11:00:00+08:00",
    error_code: "502",
    error_message: "有赞上游持续 502",
    started_at: "2026-06-19T10:00:00+08:00",
    finished_at: "2026-06-19T10:01:00+08:00",
  });
  store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_analytics_failed",
    source: "LIFECYCLE_FILTER",
    status: "COMPLETED_WITH_ERRORS",
    campaign_id: "ROOT_7D_RESET",
    request_id: "analytics-lifecycle-failed",
    operator_id: "ops-analytics",
    reason: "运营漏斗测试失败队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
    root_user_ids: [rootUserId],
    processed_root_user_ids: [rootUserId],
    failed_root_user_ids: [rootUserId],
    items_json: [{ rootUserId, status: "ERROR", message: "结算规则缺失", rewardCount: 0 }],
    last_run_json: { requestId: "analytics-lifecycle-failed-run", selectedCount: 1 },
    total_count: 1,
    run_count: 1,
    error_message: "结算规则缺失",
    created_at: "2026-06-19T10:10:00+08:00",
    updated_at: "2026-06-19T10:12:00+08:00",
    started_at: "2026-06-19T10:10:00+08:00",
    finished_at: "2026-06-19T10:12:00+08:00",
    cancelled_at: "",
  });
  store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_analytics_stalled",
    source: "LIFECYCLE_FILTER",
    status: "RUNNING",
    campaign_id: "ROOT_7D_RESET",
    request_id: "analytics-lifecycle-stalled",
    operator_id: "ops-analytics",
    reason: "运营漏斗测试卡住队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 2, selectedCount: 2, selectionLimit: 2, truncated: false, users: [] },
    root_user_ids: [rootUserId, "root_analytics_pending"],
    processed_root_user_ids: [rootUserId],
    failed_root_user_ids: [],
    items_json: [{ rootUserId, status: "SKIPPED", message: "已结算", rewardCount: 0 }],
    last_run_json: { requestId: "analytics-lifecycle-stalled-run", selectedCount: 1 },
    total_count: 2,
    run_count: 1,
    error_message: "",
    created_at: "2026-06-19T08:00:00+08:00",
    updated_at: "2026-06-19T08:10:00+08:00",
    started_at: "2026-06-19T08:00:00+08:00",
    finished_at: "",
    cancelled_at: "",
  });
  store.adminLifecycleUserExports.unshift({
    export_id: "lex_analytics_dead_letter",
    filename: "lifecycle_users_dead_letter.csv",
    created_at: "2026-06-19T09:00:00+08:00",
    expires_at: "2099-01-01T00:00:00+08:00",
    operator_id: "ops-analytics",
    request_id: "analytics-export-dead-letter",
    filters_json: { campaignId: "ROOT_7D_RESET" },
    summary_json: { exportedCount: 1, bytes: 128, sensitivity: "CONFIDENTIAL" },
    rows_json: [],
    delivery_requested: true,
    delivery_channel: "WEBHOOK",
    delivery_status: "DEAD_LETTER",
    delivery_target_json: { webhookUrlPreview: "https://hooks.example.com/lifecycle-export" },
    delivery_external_ref: "",
    delivery_error: "HTTP 500",
    delivery_dead_letter_reason: "max attempts reached: HTTP 500",
    delivery_delivered_at: "",
    delivery_last_attempt_at: "2026-06-19T09:03:00+08:00",
    delivery_request_id: "analytics-export-dead-letter",
    delivery_attempt_count: 3,
    delivery_max_attempts: 3,
    delivery_next_retry_at: "",
  });
  store.adminLifecycleUserExports.unshift({
    export_id: "lex_analytics_due_retry",
    filename: "lifecycle_users_due_retry.csv",
    created_at: "2026-06-19T09:10:00+08:00",
    expires_at: "2099-01-01T00:00:00+08:00",
    operator_id: "ops-analytics",
    request_id: "analytics-export-due-retry",
    filters_json: { campaignId: "ROOT_7D_RESET" },
    summary_json: { exportedCount: 1, bytes: 128, sensitivity: "CONFIDENTIAL" },
    rows_json: [],
    delivery_requested: true,
    delivery_channel: "WEBHOOK",
    delivery_status: "RETRY_SCHEDULED",
    delivery_target_json: { webhookUrlPreview: "https://hooks.example.com/lifecycle-export" },
    delivery_external_ref: "",
    delivery_error: "HTTP 502",
    delivery_dead_letter_reason: "",
    delivery_delivered_at: "",
    delivery_last_attempt_at: "2026-06-19T09:12:00+08:00",
    delivery_request_id: "analytics-export-due-retry",
    delivery_attempt_count: 1,
    delivery_max_attempts: 3,
    delivery_next_retry_at: "2020-01-01T00:00:00+08:00",
  });

  const analytics = domain.getAdminOperationalAnalytics(store, {
    campaignId: "ROOT_7D_RESET",
    dateFrom: "2026-06-19",
    dateTo: "2026-06-30",
  }).data;
  const stageByKey = Object.fromEntries(analytics.stages.map((item) => [item.key, item]));
  const bottleneckByKey = Object.fromEntries(analytics.bottlenecks.map((item) => [item.key, item]));
  const taskTypeByKey = Object.fromEntries(analytics.distributions.taskType.map((item) => [item.key, item]));
  const trendByDate = Object.fromEntries(analytics.trend.map((item) => [item.date, item]));
  const segmentByKey = Object.fromEntries(analytics.retentionSegments.map((item) => [item.key, item]));

  assert.equal(analytics.filters.campaignId, "ROOT_7D_RESET");
  assert.equal(stageByKey.wework_leads.count, 2);
  assert.equal(stageByKey.registered_users.count, 1);
  assert.equal(stageByKey.campaign_joined.count, 1);
  assert.equal(stageByKey.product_jump.count, 1);
  assert.equal(stageByKey.order_synced.count, 1);
  assert.equal(stageByKey.order_bound.count, 1);
  assert.equal(stageByKey.task_started.count, 1);
  assert.equal(stageByKey.settlement_ready.count, 1);
  assert.equal(stageByKey.settlement_qualified.count, 1);
  assert.equal(stageByKey.reward_granted.count, 1);
  assert.equal(stageByKey.reward_delivered.count, 1);
  assert.equal(bottleneckByKey.unresolved_leads.count, 1);
  assert.equal(taskTypeByKey.CHECKIN.count, 7);
  assert.equal(taskTypeByKey.QUESTIONNAIRE.count, 2);
  assert.equal(analytics.totals.rewards, 2);
  assert.ok(analytics.recentActivity.some((item) => item.type === "REWARD"));
  assert.ok(analytics.alerts.some((item) => item.key === "bottleneck_unresolved_leads"));
  const exhaustedAlert = analytics.alerts.find((item) => item.key === "adapter_retry_exhausted_adr_analytics_retry_exhausted");
  assert.ok(exhaustedAlert);
  assert.equal(exhaustedAlert.ownerRole, "研发");
  assert.equal(exhaustedAlert.sourceRunId, "adr_analytics_retry_exhausted");
  const failedJobAlert = analytics.alerts.find((item) => item.key === "lifecycle_settlement_job_failed_lsj_analytics_failed");
  const stalledJobAlert = analytics.alerts.find((item) => item.key === "lifecycle_settlement_job_stalled_lsj_analytics_stalled");
  assert.ok(failedJobAlert);
  assert.equal(failedJobAlert.lifecycleJobId, "lsj_analytics_failed");
  assert.equal(failedJobAlert.failedCount, 1);
  assert.ok(stalledJobAlert);
  assert.equal(stalledJobAlert.lifecycleJobStatus, "RUNNING");
  assert.equal(stalledJobAlert.pendingCount, 1);
  const deadExportAlert = analytics.alerts.find((item) => item.key === "lifecycle_export_delivery_health_dead_letter");
  const dueRetryExportAlert = analytics.alerts.find((item) => item.key === "lifecycle_export_delivery_health_due_retry");
  assert.ok(deadExportAlert);
  assert.equal(deadExportAlert.exportId, "lex_analytics_dead_letter");
  assert.equal(deadExportAlert.deliveryStatus, "DEAD_LETTER");
  assert.equal(deadExportAlert.deadLetterCount, 1);
  assert.ok(dueRetryExportAlert);
  assert.equal(dueRetryExportAlert.exportId, "lex_analytics_due_retry");
  assert.equal(dueRetryExportAlert.deliveryStatus, "RETRY_SCHEDULED");
  assert.equal(dueRetryExportAlert.dueRetryCount, 1);
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_unresolved_leads"));
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_adapter_retry_exhausted"));
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_settlement_job_failed"));
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_settlement_job_stalled"));
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_dead_letter"));
  assert.ok(analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_due_retry"));
  assert.equal(analytics.alertSummary.triggeredCount, analytics.alerts.length);
  assert.equal(analytics.refresh.defaultIntervalSeconds, 60);
  assert.equal(analytics.trend.length, 12);
  assert.equal(trendByDate["2026-06-19"].leads, 2);
  assert.equal(trendByDate["2026-06-19"].participants, 1);
  assert.equal(trendByDate["2026-06-19"].orders, 1);
  assert.equal(trendByDate["2026-06-19"].taskUsers, 1);
  assert.equal(segmentByKey["线下路演"].participantUsers, 1);
  assert.equal(segmentByKey["线下路演"].taskStartRate, 100);
  assert.equal(segmentByKey["线下路演"].settlementReadyRate, 100);
  assert.equal(segmentByKey["线下路演"].rewardDeliveredRate, 100);
  assert.equal(analytics.charts.funnelBars.length, analytics.stages.length);
  assert.ok(analytics.charts.trendSeries.some((item) => item.key === "participants" && item.total === 1));
  assert.ok(analytics.charts.segmentBars.some((item) => item.key === "线下路演" && item.taskStartRate === 100));
  const csv = domain.exportAdminOperationalAnalyticsCsv(store, {
    campaignId: "ROOT_7D_RESET",
    dateFrom: "2026-06-19",
    dateTo: "2026-06-30",
  });
  assert.match(csv, /section,key,label,date,count/);
  assert.match(csv, /stage,wework_leads,企微线索,,2/);
  assert.match(csv, /bottleneck,unresolved_leads,企微线索未补链,,1/);
  assert.match(csv, /trend,leads,企微线索,2026-06-19,2/);
  assert.match(csv, /segment,线下路演,线下路演,,1,100/);

  const alertJob = await domain.runAdminOperationalAlertJob(store, {
    campaignId: "ROOT_7D_RESET",
    dateFrom: "2026-06-19",
    dateTo: "2026-06-30",
    dryRun: false,
    requestId: "analytics-alert-job-1",
    operatorId: "ops-analytics",
  });
  assert.ok(alertJob.data.summary.deliveredCount >= 1);
  assert.ok(store.operationalAlertNotifications.some((item) => item.alert_key === "bottleneck_unresolved_leads"));
  const exhaustedNotification = store.operationalAlertNotifications.find((item) => item.alert_key === "adapter_retry_exhausted_adr_analytics_retry_exhausted");
  assert.ok(exhaustedNotification);
  assert.equal(exhaustedNotification.owner_role, "研发");
  assert.equal(exhaustedNotification.route_key, "ADAPTER_RETRY_EXHAUSTED:*");
  const failedJobNotification = store.operationalAlertNotifications.find((item) => item.alert_key === "lifecycle_settlement_job_failed_lsj_analytics_failed");
  const stalledJobNotification = store.operationalAlertNotifications.find((item) => item.alert_key === "lifecycle_settlement_job_stalled_lsj_analytics_stalled");
  const deadExportNotification = store.operationalAlertNotifications.find((item) => item.alert_key === "lifecycle_export_delivery_health_dead_letter");
  const dueRetryExportNotification = store.operationalAlertNotifications.find((item) => item.alert_key === "lifecycle_export_delivery_health_due_retry");
  assert.ok(failedJobNotification);
  assert.equal(failedJobNotification.owner_role, "运营主管");
  assert.ok(stalledJobNotification);
  assert.equal(stalledJobNotification.owner_role, "运营");
  assert.ok(deadExportNotification);
  assert.equal(deadExportNotification.owner_role, "运营主管");
  assert.equal(deadExportNotification.payload_json.alert.exportId, "lex_analytics_dead_letter");
  assert.ok(dueRetryExportNotification);
  assert.equal(dueRetryExportNotification.owner_role, "运营");
  assert.equal(dueRetryExportNotification.payload_json.alert.exportId, "lex_analytics_due_retry");

  const ruleUpdate = domain.upsertAdminOperationalAlertRule(store, {
    alertRuleId: "op_alert_unresolved_leads",
    title: "企微线索未补链",
    targetType: "BOTTLENECK",
    targetKey: "unresolved_leads",
    metricKey: "count",
    operator: ">",
    thresholdValue: 1,
    severity: "warning",
    channel: "IN_APP",
    ownerRole: "运营主管",
    ownerName: "Root Ops",
    ownerContact: "wecom:root-ops",
    routeKey: "ops:unresolved-leads",
    status: "ACTIVE",
    requestId: "analytics-alert-rule-1",
    operatorId: "ops-analytics",
  }).data;
  const updatedAnalytics = domain.getAdminOperationalAnalytics(store, {
    campaignId: "ROOT_7D_RESET",
    dateFrom: "2026-06-19",
    dateTo: "2026-06-30",
  }).data;
  assert.equal(ruleUpdate.rule.thresholdValue, 1);
  assert.equal(ruleUpdate.rule.ownerName, "Root Ops");
  assert.equal(ruleUpdate.rule.routeKey, "ops:unresolved-leads");
  assert.ok(!updatedAnalytics.alerts.some((item) => item.key === "bottleneck_unresolved_leads"));

  const webhookCalls = [];
  const webhookRule = domain.upsertAdminOperationalAlertRule(store, {
    alertRuleId: "analytics_webhook_lifecycle_failed",
    title: "生命周期结算失败外部推送",
    targetType: "LIFECYCLE_SETTLEMENT_JOB_FAILED",
    targetKey: "*",
    metricKey: "failedCount",
    operator: ">",
    thresholdValue: 0,
    severity: "danger",
    channel: "WEBHOOK",
    ownerRole: "运营主管",
    ownerName: "Root Ops Lead",
    ownerContact: "wecom:root-ops-lead",
    routeKey: "ops:lifecycle-settlement",
    status: "ACTIVE",
    requestId: "analytics-webhook-rule-1",
    operatorId: "ops-analytics",
  }).data;
  const webhookJob = await domain.runAdminOperationalAlertJob(store, {
    campaignId: "ROOT_7D_RESET",
    dryRun: false,
    requestId: "analytics-webhook-job-1",
    operatorId: "ops-analytics",
  }, {
    requestId: "analytics-webhook-job-1",
    env: {
      ROOT_OPERATIONAL_ALERT_WEBHOOK_URL: "https://hooks.example.com/root-alert",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET: "root-alert-secret",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL: "WEWORK",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE: "lifecycle_settlement_alert",
    },
    fetchImpl: async (url, init) => {
      webhookCalls.push({ url, init });
      return { ok: true, status: 202 };
    },
  });
  const webhookNotification = store.operationalAlertNotifications.find((item) => item.alert_rule_id === "analytics_webhook_lifecycle_failed");
  const webhookPayload = JSON.parse(webhookCalls[0].init.body);
  assert.equal(webhookRule.rule.channel, "WEBHOOK");
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].url, "https://hooks.example.com/root-alert");
  assert.equal(webhookCalls[0].init.headers["X-Root-Alert-Channel"], "WEWORK");
  assert.equal(webhookCalls[0].init.headers["X-Root-Alert-Template"], "lifecycle_settlement_alert");
  assert.equal(
    webhookCalls[0].init.headers["X-Root-Alert-Signature"],
    alertWebhookAdapter.signatureForBody(webhookCalls[0].init.body, "root-alert-secret"),
  );
  assert.equal(webhookPayload.alert.lifecycleJobId, "lsj_analytics_failed");
  assert.equal(webhookPayload.routing.ownerName, "Root Ops Lead");
  assert.equal(webhookJob.data.summary.deliveredCount >= 1, true);
  assert.ok(webhookNotification);
  assert.equal(webhookNotification.channel, "WEBHOOK");
  assert.equal(webhookNotification.status, "DELIVERED");
  assert.equal(webhookNotification.external_ref, "HTTP 202");
  assert.equal(webhookNotification.payload_json.webhook.channel, "WEWORK");
  assert.equal(webhookNotification.payload_json.webhook.signed, true);
  assert.equal(webhookNotification.payload_json.webhook.urlPreview, "https://hooks.example.com/root-alert");
});

test("admin batch settlement previews, requires confirmation, and writes request audit", async () => {
  const store = domain.createStore();
  const qualifiedLogin = await domain.loginWithWechat(store, {
    openid: "admin_batch_qualified_openid",
    unionid: "admin_batch_qualified_unionid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
  const partialLogin = await domain.loginWithWechat(store, {
    openid: "admin_batch_partial_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  domain.joinCampaign(store, qualifiedLogin.data.token, { sourceChannel: "ROADSHOW_QR" });
  domain.joinCampaign(store, partialLogin.data.token, { sourceChannel: "ROADSHOW_QR" });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = addDays("2026-06-19", day);
    domain.recordUserTaskEvent(store, qualifiedLogin.data.token, {
      taskType: "CHECKIN",
      taskDate,
      payload: { taskDate },
      idempotencyKey: `admin-batch-qualified-checkin-${day + 1}`,
    });
  }
  domain.recordUserTaskEvent(store, qualifiedLogin.data.token, {
    taskType: "QUESTIONNAIRE",
    taskDate: "2026-06-26",
    payload: { questionnaireType: "DAY8_SUMMARY" },
    idempotencyKey: "admin-batch-qualified-day8",
  });
  domain.recordUserTaskEvent(store, partialLogin.data.token, {
    taskType: "CHECKIN",
    taskDate: "2026-06-19",
    payload: { taskDate: "2026-06-19" },
    idempotencyKey: "admin-batch-partial-checkin-1",
  });

  const rootUserIds = [
    qualifiedLogin.data.user.rootUserId,
    partialLogin.data.user.rootUserId,
  ];
  const preview = domain.previewAdminSettlementBatch(store, { rootUserIds }).data;

  assert.equal(preview.summary.total, 2);
  assert.equal(preview.summary.qualified, 1);
  assert.equal(preview.summary.notQualified, 1);
  assert.throws(
    () => domain.executeAdminSettlementBatch(store, { rootUserIds, requestId: "batch-settlement-no-confirm" }),
    /二次确认/
  );
  assert.throws(
    () => domain.executeAdminSettlementBatch(store, { rootUserIds, confirmRisk: true }),
    /request_id/
  );

  const executed = domain.executeAdminSettlementBatch(store, {
    rootUserIds,
    confirmRisk: true,
    requestId: "batch-settlement-request-1",
    operatorId: "ops-batch",
    reason: "路演批量结算",
  }).data;

  assert.equal(executed.summary.executed, 1);
  assert.equal(executed.summary.skipped, 1);
  assert.equal(store.settlementRecords.length, 1);
  assert.equal(store.rewardGrants.length, 2);
  assert.equal(store.auditLogs[0].action, "BATCH_SETTLEMENT_EXECUTE");
  assert.equal(store.auditLogs[0].target_id, "batch-settlement-request-1");
  assert.equal(store.auditLogs[0].operator_id, "ops-batch");
  assert.equal(store.auditLogs[0].metadata.requestId, "batch-settlement-request-1");
});

test("admin lifecycle filtered batch settlement ignores page limit and writes batch audit", async () => {
  const store = domain.createStore();

  async function makeLifecycleUser(prefix, qualified) {
    const login = await domain.loginWithWechat(store, {
      openid: `${prefix}_openid`,
      unionid: `${prefix}_unionid`,
      appCode: "MYROOT",
    }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
    domain.joinCampaign(store, login.data.token, {
      campaignId: "ROOT_7D_RESET",
      sourceChannel: "ROADSHOW_QR",
    });
    const checkinDays = qualified ? 7 : 1;
    for (let day = 0; day < checkinDays; day += 1) {
      const taskDate = addDays("2026-06-19", day);
      domain.recordUserTaskEvent(store, login.data.token, {
        campaignId: "ROOT_7D_RESET",
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `${prefix}-checkin-${day + 1}`,
      });
    }
    if (qualified) {
      domain.recordUserTaskEvent(store, login.data.token, {
        campaignId: "ROOT_7D_RESET",
        taskType: "QUESTIONNAIRE",
        taskDate: "2026-06-22",
        payload: { questionnaireType: "DAY4_MIDPOINT" },
        idempotencyKey: `${prefix}-day4`,
      });
      domain.recordUserTaskEvent(store, login.data.token, {
        campaignId: "ROOT_7D_RESET",
        taskType: "QUESTIONNAIRE",
        taskDate: "2026-06-26",
        payload: { questionnaireType: "DAY8_SUMMARY" },
        idempotencyKey: `${prefix}-day8`,
      });
    }
    return login.data.user.rootUserId;
  }

  const firstRootUserId = await makeLifecycleUser("lifecycle_batch_first", true);
  const secondRootUserId = await makeLifecycleUser("lifecycle_batch_second", true);
  await makeLifecycleUser("lifecycle_batch_partial", false);

  const filters = {
    campaignId: "ROOT_7D_RESET",
    taskProgress: "SETTLEMENT_READY",
    settlementStatus: "SETTLEMENT_READY",
    limit: 1,
  };
  const preview = domain.previewAdminLifecycleSettlementBatch(store, {
    filters,
    selectionLimit: 10,
  }).data;

  assert.equal(preview.source, "LIFECYCLE_FILTER");
  assert.equal(preview.selection.total, 2);
  assert.equal(preview.selection.selectedCount, 2);
  assert.equal(preview.selection.filters.limit, 1);
  assert.deepEqual(new Set(preview.selection.rootUserIds), new Set([firstRootUserId, secondRootUserId]));
  assert.equal(preview.summary.qualified, 2);

  const executed = domain.executeAdminLifecycleSettlementBatch(store, {
    filters,
    selectionLimit: 10,
    confirmRisk: true,
    requestId: "lifecycle-filter-batch-1",
    operatorId: "ops-lifecycle-batch",
    reason: "生命周期筛选批量结算测试",
  }).data;

  assert.equal(executed.source, "LIFECYCLE_FILTER");
  assert.equal(executed.selection.selectedCount, 2);
  assert.equal(executed.summary.executed, 2);
  assert.equal(store.settlementRecords.length, 2);
  assert.equal(store.rewardGrants.length, 4);
  assert.equal(store.auditLogs[0].action, "BATCH_SETTLEMENT_EXECUTE");
  assert.equal(store.auditLogs[0].target_id, "lifecycle-filter-batch-1");
  assert.equal(store.auditLogs[0].operator_id, "ops-lifecycle-batch");
  assert.deepEqual(new Set(store.auditLogs[0].before.rootUserIds), new Set([firstRootUserId, secondRootUserId]));
});

test("admin lifecycle settlement job queues filtered selection, runs batches, cancels, and retries failures", async () => {
  const store = domain.createStore();

  async function makeLifecycleUser(prefix) {
    const login = await domain.loginWithWechat(store, {
      openid: `${prefix}_openid`,
      unionid: `${prefix}_unionid`,
      appCode: "MYROOT",
    }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
    domain.joinCampaign(store, login.data.token, {
      campaignId: "ROOT_7D_RESET",
      sourceChannel: "ROADSHOW_QR",
    });
    for (let day = 0; day < 7; day += 1) {
      const taskDate = addDays("2026-06-19", day);
      domain.recordUserTaskEvent(store, login.data.token, {
        campaignId: "ROOT_7D_RESET",
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `${prefix}-checkin-${day + 1}`,
      });
    }
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_7D_RESET",
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-22",
      payload: { questionnaireType: "DAY4_MIDPOINT" },
      idempotencyKey: `${prefix}-day4`,
    });
    domain.recordUserTaskEvent(store, login.data.token, {
      campaignId: "ROOT_7D_RESET",
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: `${prefix}-day8`,
    });
    return login.data.user.rootUserId;
  }

  const firstRootUserId = await makeLifecycleUser("lifecycle_job_first");
  const secondRootUserId = await makeLifecycleUser("lifecycle_job_second");
  assert.throws(
    () => domain.createAdminLifecycleSettlementJob(store, {
      filters: { campaignId: "ROOT_7D_RESET", taskProgress: "SETTLEMENT_READY" },
      requestId: "lifecycle-job-no-confirm",
    }),
    /二次确认/
  );

  const created = domain.createAdminLifecycleSettlementJob(store, {
    filters: {
      campaignId: "ROOT_7D_RESET",
      taskProgress: "SETTLEMENT_READY",
      settlementStatus: "SETTLEMENT_READY",
      limit: 1,
    },
    selectionLimit: 10,
    batchSize: 1,
    confirmRisk: true,
    requestId: "lifecycle-job-create-1",
    operatorId: "ops-lifecycle-job",
    reason: "生命周期筛选队列测试",
  }).data;
  const jobId = created.job.jobId;
  const listed = domain.listAdminLifecycleSettlementJobs(store, { campaignId: "ROOT_7D_RESET" }).data;

  assert.equal(created.job.status, "QUEUED");
  assert.equal(created.job.summary.selected, 2);
  assert.equal(created.job.summary.pending, 2);
  assert.equal(created.job.selection.selectedCount, 2);
  assert.equal(created.job.filters.limit, 1);
  assert.equal(listed.jobs[0].jobId, jobId);
  assert.deepEqual(new Set(created.job.rootUserIds), new Set([firstRootUserId, secondRootUserId]));

  const firstRun = domain.runAdminLifecycleSettlementJob(store, {
    jobId,
    batchSize: 1,
    requestId: "lifecycle-job-run-1",
    operatorId: "ops-lifecycle-job",
  }).data;
  const secondRun = domain.runAdminLifecycleSettlementJob(store, {
    jobId,
    batchSize: 1,
    requestId: "lifecycle-job-run-2",
    operatorId: "ops-lifecycle-job",
  }).data;

  assert.equal(firstRun.job.status, "RUNNING");
  assert.equal(firstRun.job.summary.processed, 1);
  assert.equal(firstRun.job.summary.pending, 1);
  assert.equal(secondRun.job.status, "COMPLETED");
  assert.equal(secondRun.job.summary.processed, 2);
  assert.equal(secondRun.job.summary.pending, 0);
  assert.equal(secondRun.job.summary.executed, 2);
  assert.equal(store.settlementRecords.length, 2);
  assert.equal(store.rewardGrants.length, 4);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_CREATE"), true);
  assert.equal(store.auditLogs.filter((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RUN").length >= 2, true);
  assert.equal(store.auditLogs.filter((log) => log.action === "BATCH_SETTLEMENT_EXECUTE").length, 2);

  const cancelCandidate = domain.createAdminLifecycleSettlementJob(store, {
    filters: {
      campaignId: "ROOT_7D_RESET",
      taskProgress: "SETTLEMENT_READY",
      settlementStatus: "SETTLEMENT_READY",
    },
    selectionLimit: 10,
    batchSize: 1,
    confirmRisk: true,
    requestId: "lifecycle-job-create-cancel",
    operatorId: "ops-lifecycle-job",
  }).data;
  const cancelled = domain.cancelAdminLifecycleSettlementJob(store, {
    jobId: cancelCandidate.job.jobId,
    requestId: "lifecycle-job-cancel-1",
    operatorId: "ops-lifecycle-job",
  }).data;
  assert.equal(cancelled.job.status, "CANCELLED");

  const retryRootUserId = await makeLifecycleUser("lifecycle_job_retry");
  const retryCandidate = domain.createAdminLifecycleSettlementJob(store, {
    filters: {
      campaignId: "ROOT_7D_RESET",
      keyword: "lifecycle_job_retry_unionid",
      taskProgress: "SETTLEMENT_READY",
      settlementStatus: "SETTLEMENT_READY",
    },
    selectionLimit: 10,
    batchSize: 1,
    confirmRisk: true,
    requestId: "lifecycle-job-create-retry",
    operatorId: "ops-lifecycle-job",
  }).data;
  const removedUserIndex = store.users.findIndex((user) => user.root_user_id === retryRootUserId || user.user_id === retryRootUserId);
  const [removedUser] = store.users.splice(removedUserIndex, 1);
  const failedRun = domain.runAdminLifecycleSettlementJob(store, {
    jobId: retryCandidate.job.jobId,
    requestId: "lifecycle-job-run-failed",
    operatorId: "ops-lifecycle-job",
  }).data;
  assert.equal(failedRun.job.status, "COMPLETED_WITH_ERRORS");
  assert.equal(failedRun.job.summary.failed, 1);

  store.users.push(removedUser);
  const retryReset = domain.retryFailedAdminLifecycleSettlementJob(store, {
    jobId: retryCandidate.job.jobId,
    requestId: "lifecycle-job-retry-failed",
    operatorId: "ops-lifecycle-job",
  }).data;
  const retryRun = domain.runAdminLifecycleSettlementJob(store, {
    jobId: retryCandidate.job.jobId,
    requestId: "lifecycle-job-run-after-retry",
    operatorId: "ops-lifecycle-job",
  }).data;

  assert.equal(retryReset.job.status, "QUEUED");
  assert.equal(retryReset.job.summary.failed, 0);
  assert.equal(retryRun.job.status, "COMPLETED");
  assert.equal(retryRun.job.summary.executed, 1);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_CANCEL"), true);
  assert.equal(store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RETRY_FAILED"), true);
});

test("admin lifecycle settlement scheduler plans and executes queued batches", async () => {
  const store = domain.createStore();

  async function makeLifecycleUser(prefix) {
    const login = await domain.loginWithWechat(store, {
      openid: `${prefix}_openid`,
      unionid: `${prefix}_unionid`,
      appCode: "MYROOT",
    }, { ROOT_ALLOW_OPENID_LOGIN: "true" });
    domain.joinCampaign(store, login.data.token, {
      campaignId: "ROOT_7D_RESET",
      sourceChannel: "ROADSHOW_QR",
    });
    for (let day = 0; day < 7; day += 1) {
      domain.recordUserTaskEvent(store, login.data.token, {
        campaignId: "ROOT_7D_RESET",
        taskType: "CHECKIN",
        taskDate: addDays("2026-06-19", day),
        idempotencyKey: `${prefix}-scheduler-checkin-${day + 1}`,
      });
    }
    for (const type of ["DAY4_MIDPOINT", "DAY8_SUMMARY"]) {
      domain.recordUserTaskEvent(store, login.data.token, {
        campaignId: "ROOT_7D_RESET",
        taskType: "QUESTIONNAIRE",
        taskDate: type === "DAY4_MIDPOINT" ? "2026-06-22" : "2026-06-26",
        payload: { questionnaireType: type },
        idempotencyKey: `${prefix}-${type}`,
      });
    }
    return login.data.user.rootUserId;
  }

  await makeLifecycleUser("lifecycle_scheduler_first");
  await makeLifecycleUser("lifecycle_scheduler_second");

  const created = domain.createAdminLifecycleSettlementJob(store, {
    filters: {
      campaignId: "ROOT_7D_RESET",
      taskProgress: "SETTLEMENT_READY",
      settlementStatus: "SETTLEMENT_READY",
    },
    selectionLimit: 10,
    batchSize: 1,
    confirmRisk: true,
    requestId: "lifecycle-scheduler-create-1",
    operatorId: "ops-lifecycle-scheduler",
  }).data;
  const plan = domain.planAdminLifecycleSettlementJobRuns(store, {
    campaignId: "ROOT_7D_RESET",
    dryRun: true,
    batchSize: 1,
    jobLimit: 1,
  }).data;
  const executed = await domain.runDueAdminLifecycleSettlementJobs(store, {
    campaignId: "ROOT_7D_RESET",
    dryRun: false,
    batchSize: 1,
    jobLimit: 1,
    requestId: "lifecycle-scheduler-run-1",
    operatorId: "ops-lifecycle-scheduler",
  });
  const second = await domain.runDueAdminLifecycleSettlementJobs(store, {
    campaignId: "ROOT_7D_RESET",
    dryRun: false,
    batchSize: 1,
    jobLimit: 1,
    requestId: "lifecycle-scheduler-run-2",
    operatorId: "ops-lifecycle-scheduler",
  });
  const empty = domain.planAdminLifecycleSettlementJobRuns(store, {
    campaignId: "ROOT_7D_RESET",
    dryRun: true,
  }).data;

  assert.equal(plan.selectedCount, 1);
  assert.equal(plan.candidates[0].jobId, created.job.jobId);
  assert.equal(plan.candidates[0].schedulerBatchSize, 1);
  assert.equal(executed.data.executedCount, 1);
  assert.equal(executed.data.successCount, 1);
  assert.equal(executed.data.results[0].job.status, "RUNNING");
  assert.match(executed.data.results[0].run.chunkRequestId, /lifecycle-scheduler-run-1/);
  assert.equal(second.data.results[0].job.status, "COMPLETED");
  assert.equal(second.data.results[0].job.summary.executed, 2);
  assert.equal(empty.selectedCount, 0);
  assert.equal(store.auditLogs.filter((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RUN").length, 2);
});

test("admin lifecycle settlement cleanup resets stale running jobs and cancels only when allowed", async () => {
  const store = domain.createStore();
  store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_cleanup_running",
    source: "LIFECYCLE_FILTER",
    status: "RUNNING",
    campaign_id: "ROOT_7D_RESET",
    request_id: "cleanup-running-create",
    operator_id: "ops-cleanup",
    reason: "清理测试运行中队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 2, selectedCount: 2, selectionLimit: 2, truncated: false, users: [] },
    root_user_ids: ["root_cleanup_done", "root_cleanup_pending"],
    processed_root_user_ids: ["root_cleanup_done"],
    failed_root_user_ids: [],
    items_json: [{ rootUserId: "root_cleanup_done", status: "SKIPPED", executed: false }],
    last_run_json: { requestId: "cleanup-running-last" },
    total_count: 2,
    run_count: 1,
    error_message: "",
    created_at: "2026-06-19T08:00:00+08:00",
    updated_at: "2026-06-19T08:10:00+08:00",
    started_at: "2026-06-19T08:00:00+08:00",
    finished_at: "",
    cancelled_at: "",
  });
  store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_cleanup_queued",
    source: "LIFECYCLE_FILTER",
    status: "QUEUED",
    campaign_id: "ROOT_7D_RESET",
    request_id: "cleanup-queued-create",
    operator_id: "ops-cleanup",
    reason: "清理测试排队队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
    root_user_ids: ["root_cleanup_queued"],
    processed_root_user_ids: [],
    failed_root_user_ids: [],
    items_json: [],
    last_run_json: null,
    total_count: 1,
    run_count: 0,
    error_message: "",
    created_at: "2026-06-18T08:00:00+08:00",
    updated_at: "2026-06-18T08:00:00+08:00",
    started_at: "",
    finished_at: "",
    cancelled_at: "",
  });

  const plan = domain.planAdminLifecycleSettlementJobCleanup(store, {
    now: "2026-06-19T12:00:00+08:00",
    staleMinutes: 120,
    cancelAfterMinutes: 1440,
    dryRun: true,
  }).data;
  const resetOnly = await domain.runAdminLifecycleSettlementJobCleanup(store, {
    now: "2026-06-19T12:00:00+08:00",
    staleMinutes: 120,
    cancelAfterMinutes: 1440,
    dryRun: false,
    requestId: "cleanup-reset-1",
    operatorId: "ops-cleanup",
  });
  const cancelAllowed = await domain.runAdminLifecycleSettlementJobCleanup(store, {
    now: "2026-06-19T14:30:00+08:00",
    staleMinutes: 120,
    cancelAfterMinutes: 120,
    allowCancel: true,
    dryRun: false,
    requestId: "cleanup-cancel-1",
    operatorId: "ops-cleanup",
  });
  const runningJob = store.adminLifecycleSettlementJobs.find((job) => job.job_id === "lsj_cleanup_running");
  const queuedJob = store.adminLifecycleSettlementJobs.find((job) => job.job_id === "lsj_cleanup_queued");

  assert.equal(plan.selectedCount, 2);
  assert.equal(plan.candidates.find((item) => item.jobId === "lsj_cleanup_running").cleanupAction, "RESET_TO_QUEUED");
  assert.equal(plan.candidates.find((item) => item.jobId === "lsj_cleanup_queued").cleanupAction, "ANNOTATE");
  assert.equal(resetOnly.data.resetCount, 1);
  assert.equal(resetOnly.data.cancelCount, 0);
  assert.equal(resetOnly.data.results.find((item) => item.job.jobId === "lsj_cleanup_running").job.status, "QUEUED");
  assert.equal(resetOnly.data.results.find((item) => item.job.jobId === "lsj_cleanup_running").job.cleanup.action, "RESET_TO_QUEUED");
  assert.equal(cancelAllowed.data.cancelCount, 2);
  assert.equal(runningJob.status, "CANCELLED");
  assert.equal(queuedJob.status, "CANCELLED");
  assert.equal(queuedJob.cleanup_json.action, "CANCEL");
  assert.equal(store.auditLogs.filter((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_TIMEOUT_CLEANUP").length, 4);
});

test("admin lifecycle settlement cleanup reads allowCancel default from environment", () => {
  const originalAllowCancel = process.env.ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL;
  process.env.ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL = "true";
  try {
    const store = domain.createStore();
    store.adminLifecycleSettlementJobs.unshift({
      job_id: "lsj_cleanup_env_queued",
      source: "LIFECYCLE_FILTER",
      status: "QUEUED",
      campaign_id: "ROOT_7D_RESET",
      request_id: "cleanup-env-create",
      operator_id: "ops-cleanup",
      reason: "环境变量清理测试队列",
      batch_size: 20,
      filters_json: { campaignId: "ROOT_7D_RESET" },
      selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
      root_user_ids: ["root_cleanup_env_pending"],
      processed_root_user_ids: [],
      failed_root_user_ids: [],
      items_json: [],
      last_run_json: null,
      total_count: 1,
      run_count: 0,
      error_message: "",
      created_at: "2026-06-18T08:00:00+08:00",
      updated_at: "2026-06-18T08:00:00+08:00",
      started_at: "",
      finished_at: "",
      cancelled_at: "",
    });
    const plan = domain.planAdminLifecycleSettlementJobCleanup(store, {
      now: "2026-06-19T12:00:00+08:00",
      staleMinutes: 120,
      cancelAfterMinutes: 120,
      dryRun: true,
    }).data;

    assert.equal(plan.allowCancel, true);
    assert.equal(plan.candidates.find((item) => item.jobId === "lsj_cleanup_env_queued").cleanupAction, "CANCEL");
  } finally {
    if (originalAllowCancel === undefined) delete process.env.ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL;
    else process.env.ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL = originalAllowCancel;
  }
});
