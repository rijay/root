const domain = require("./domain");

const DRILL_SCOPE = "LOCAL_SIMULATION";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function projection(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value ? value[field] : undefined]));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addCheck(checks, id, passed, detail) {
  checks.push({ id, status: passed ? "PASS" : "FAIL", detail });
}

async function importSamples(store, sourceType, text, asOf, context = {}) {
  return (await domain.runExternalAdapter(store, {
    sourceType,
    adapterKind: "MANUAL_SAMPLE",
    mode: "IMPORT",
    text,
  }, context, asOf)).data;
}

function rollback(store, run, requestId, operatorId, reason) {
  return domain.rollbackExternalAdapterRun(store, {
    runId: run.run_id,
    requestId,
    confirmRisk: true,
    operatorId,
    reason,
  }).data;
}

async function runProductionRollbackDrill(options = {}) {
  const store = options.store || domain.createStore();
  const asOf = options.asOf || "2026-07-13";
  const operatorId = options.operatorId || "local-rollback-drill";
  const checks = [];

  const baselineOrderNo = "YZROLLBACK_BASE_001";
  await importSamples(store, "YOUZAN_ORDER", [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    `${baselineOrderNo},基线收货人,18800000001,ROOT回滚演练商品,199,已支付,已发货,基线地址`,
  ].join("\n"), asOf);
  const baselineOrder = store.youzanOrders.find((item) => item.youzan_order_no === baselineOrderNo);
  const baselineFulfillment = store.orderFulfillments.find((item) => item.order_id === baselineOrder.order_id);
  const orderFields = ["receiver_name", "receiver_phone", "product_name", "amount", "order_status", "delivery_status", "raw_address_text"];
  const fulfillmentFields = ["delivery_status", "carrier", "tracking_no", "last_event_text"];
  const orderBefore = projection(clone(baselineOrder), orderFields);
  const fulfillmentBefore = projection(clone(baselineFulfillment), fulfillmentFields);

  const orderUpdate = await importSamples(store, "YOUZAN_ORDER", [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    `${baselineOrderNo},错误收货人,18800000001,错误商品,299,已关闭,已发货,错误地址`,
  ].join("\n"), asOf);
  const orderRollback = rollback(store, orderUpdate.run, "rollback-drill-order", operatorId, "恢复订单字段快照");
  const orderAfter = projection(store.youzanOrders.find((item) => item.youzan_order_no === baselineOrderNo), orderFields);
  addCheck(checks, "order_snapshot_restore", orderRollback.summary.status === "ROLLED_BACK" && same(orderAfter, orderBefore), orderAfter);

  const fulfillmentUpdate = await importSamples(store, "FULFILLMENT", [
    "有赞订单号,物流状态,快递公司,运单号,最新物流节点",
    `${baselineOrderNo},已签收,顺丰速运,SF-ROLLBACK-001,错误签收`,
  ].join("\n"), asOf);
  const fulfillmentRollback = rollback(store, fulfillmentUpdate.run, "rollback-drill-fulfillment", operatorId, "恢复物流字段快照");
  const fulfillmentAfter = projection(store.orderFulfillments.find((item) => item.order_id === baselineOrder.order_id), fulfillmentFields);
  const orderDeliveryAfter = store.youzanOrders.find((item) => item.youzan_order_no === baselineOrderNo).delivery_status;
  addCheck(
    checks,
    "fulfillment_snapshot_restore",
    fulfillmentRollback.summary.status === "ROLLED_BACK" && same(fulfillmentAfter, fulfillmentBefore) && orderDeliveryAfter === orderBefore.delivery_status,
    { fulfillment: fulfillmentAfter, orderDeliveryStatus: orderDeliveryAfter }
  );

  await importSamples(store, "YOUZAN_CUSTOMER", [
    "有赞客户ID,unionid,手机号,昵称",
    "YZROLLBACK_CUSTOMER_001,union_rollback_001,18800000002,基线客户",
  ].join("\n"), asOf);
  const customerBefore = projection(clone(store.youzanCustomers.find((item) => item.youzan_yz_uid === "YZROLLBACK_CUSTOMER_001")), ["unionid", "phone", "nickname"]);
  const customerUpdate = await importSamples(store, "YOUZAN_CUSTOMER", [
    "有赞客户ID,unionid,手机号,昵称",
    "YZROLLBACK_CUSTOMER_001,union_rollback_001,18800000002,错误客户",
  ].join("\n"), asOf);
  const customerRollback = rollback(store, customerUpdate.run, "rollback-drill-customer", operatorId, "恢复客户字段快照");
  const customerAfter = projection(store.youzanCustomers.find((item) => item.youzan_yz_uid === "YZROLLBACK_CUSTOMER_001"), ["unionid", "phone", "nickname"]);
  addCheck(checks, "customer_snapshot_restore", customerRollback.summary.status === "ROLLED_BACK" && same(customerAfter, customerBefore), customerAfter);

  await importSamples(store, "WECHAT_LEAD", [
    "外部联系人ID,企微备注,来源渠道,活动名称,添加状态,运营备注",
    "wm_rollback_001,基线备注,线下路演,基线活动,ADDED,基线运营备注",
  ].join("\n"), asOf);
  const leadFields = ["wechat_remark_name", "source_channel", "offline_event_name", "corp_wechat_status", "operator_note"];
  const leadBefore = projection(clone(store.leadProfiles.find((item) => item.external_contact_id === "wm_rollback_001")), leadFields);
  const leadUpdate = await importSamples(store, "WECHAT_LEAD", [
    "外部联系人ID,企微备注,来源渠道,活动名称,添加状态,运营备注",
    "wm_rollback_001,错误备注,错误渠道,错误活动,REMOVED,错误运营备注",
  ].join("\n"), asOf);
  const leadRollback = rollback(store, leadUpdate.run, "rollback-drill-lead", operatorId, "恢复企微线索字段快照");
  const leadAfter = projection(store.leadProfiles.find((item) => item.external_contact_id === "wm_rollback_001"), leadFields);
  addCheck(checks, "lead_snapshot_restore", leadRollback.summary.status === "ROLLED_BACK" && same(leadAfter, leadBefore), leadAfter);

  const createdOrderNo = "YZROLLBACK_NEW_001";
  const createdImport = await importSamples(store, "YOUZAN_ORDER", [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    `${createdOrderNo},新增回滚用户,18800000003,ROOT回滚演练商品,199,已支付,已发货,新增地址`,
  ].join("\n"), asOf);
  const createdOrderId = store.youzanOrders.find((item) => item.youzan_order_no === createdOrderNo).order_id;
  const createdRollback = rollback(store, createdImport.run, "rollback-drill-created", operatorId, "删除本次导入的新记录");
  const createdRemoved = !store.youzanOrders.some((item) => item.youzan_order_no === createdOrderNo)
    && !store.orderFulfillments.some((item) => item.order_id === createdOrderId);
  addCheck(checks, "created_records_removed", createdRollback.summary.status === "ROLLED_BACK" && createdRemoved, { createdRemoved });

  const cursorOrderNo = "YZROLLBACK_CURSOR_001";
  const cursorContext = {
    env: {
      YOUZAN_ACCESS_TOKEN: "synthetic-token",
      YOUZAN_ORDER_LIST_URL: "https://youzan.invalid/orders",
    },
    adapterImplementations: {
      YOUZAN_OPEN: () => ({
        samples: [{
          有赞订单号: cursorOrderNo,
          收货人: "游标回滚用户",
          收货手机号: "18800000004",
          商品名称: "ROOT回滚演练商品",
          实付金额: "199",
          订单状态: "已支付",
          物流状态: "已发货",
          收货地址: "游标地址",
        }],
        externalCount: 1,
        nextCursor: "cursor-drill-001",
        hasMore: false,
      }),
    },
  };
  const cursorImport = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "IMPORT",
    limit: 1,
  }, cursorContext, asOf)).data;
  const cursorRollback = rollback(store, cursorImport.run, "rollback-drill-cursor", operatorId, "恢复增量游标");
  const cursor = store.externalAdapterCursors.find((item) => item.adapter_key === "YOUZAN_ORDER:YOUZAN_OPEN");
  addCheck(
    checks,
    "cursor_restore",
    cursorRollback.cursor.status === "ROLLED_BACK" && cursor.cursor_value === "" && cursor.last_successful_run_id === "",
    { cursorValue: cursor.cursor_value, lastSuccessfulRunId: cursor.last_successful_run_id }
  );

  let repeatedRollbackCode = null;
  try {
    rollback(store, createdImport.run, "rollback-drill-created-repeat", operatorId, "重复回滚应被拒绝");
  } catch (error) {
    repeatedRollbackCode = error.code;
  }
  addCheck(checks, "repeat_rollback_rejected", repeatedRollbackCode === 409, { code: repeatedRollbackCode });

  let realAdapterFailureRecorded = false;
  try {
    await domain.runExternalAdapter(store, {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "YOUZAN_OPEN",
      mode: "PREVIEW",
      limit: 1,
    }, { env: {} }, asOf);
  } catch (error) {
    const failedRun = store.externalAdapterRuns.find((item) => item.adapter_kind === "YOUZAN_OPEN" && item.status === "FAILED");
    realAdapterFailureRecorded = Boolean(failedRun && failedRun.retry_status === "MANUAL_REVIEW");
  }
  const orderCountBeforeFallback = store.youzanOrders.length;
  const fallbackPreview = (await domain.runExternalAdapter(store, {
    sourceType: "YOUZAN_ORDER",
    adapterKind: "MANUAL_SAMPLE",
    mode: "PREVIEW",
    text: [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROLLBACK_FALLBACK_001,人工回退用户,18800000005,ROOT回滚演练商品,199,已支付,已发货,回退地址",
    ].join("\n"),
  }, { env: {} }, asOf)).data;
  addCheck(
    checks,
    "manual_sample_fallback",
    realAdapterFailureRecorded && fallbackPreview.success === true && fallbackPreview.mode === "PREVIEW" && store.youzanOrders.length === orderCountBeforeFallback,
    { realAdapterFailureRecorded, previewMode: fallbackPreview.mode, productionRowsChanged: store.youzanOrders.length !== orderCountBeforeFallback }
  );

  const rollbackAudits = store.auditLogs.filter((item) => item.action === "EXTERNAL_ADAPTER_RUN_ROLLBACK");
  addCheck(checks, "rollback_audit_complete", rollbackAudits.length === 6 && rollbackAudits.every((item) => item.operator_id === operatorId), {
    auditCount: rollbackAudits.length,
    operatorIds: Array.from(new Set(rollbackAudits.map((item) => item.operator_id))),
  });

  const failedChecks = checks.filter((item) => item.status !== "PASS");
  return {
    title: "myRoot production rollback drill",
    scope: DRILL_SCOPE,
    status: failedChecks.length ? "FAIL" : "PASS",
    generatedAt: new Date().toISOString(),
    syntheticDataOnly: true,
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length,
      rollbackAuditCount: rollbackAudits.length,
    },
    manualFallbacks: [
      "停用真实 Adapter，保留 MANUAL_SAMPLE 预览与人工导入。",
      "订单、客户、物流和企微线索恢复后台手工处理。",
      "已发送优惠券或已写入的外部标签不得自动重放；转运营人工核对与补偿。",
      "生产流量、数据库快照和 Cloud Function 回滚仍需在正式候选演练中单独验证。",
    ],
  };
}

module.exports = {
  DRILL_SCOPE,
  runProductionRollbackDrill,
};
