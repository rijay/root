const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");
const refundWorkItem = require("./refundWorkItem");

const DEFAULT_STATUS_MAP = {
  APPLY: "REQUESTED",
  APPLIED: "REQUESTED",
  REQUESTED: "REQUESTED",
  WAIT_SELLER_AGREE: "REQUESTED",
  WAIT_BUYER_RETURN_GOODS: "APPROVED",
  APPROVED: "APPROVED",
  AGREED: "APPROVED",
  REFUNDING: "REFUNDING",
  RETURNING: "REFUNDING",
  REFUND_SUCCESS: "REFUNDED",
  REFUND_SUCCEEDED: "REFUNDED",
  SUCCESS: "REFUNDED",
  REFUNDED: "REFUNDED",
  PARTIAL_REFUND: "PARTIAL_REFUND",
  PARTIAL_REFUNDED: "PARTIAL_REFUND",
  REJECTED: "REJECTED",
  REFUSED: "REJECTED",
  CLOSED: "CLOSED",
  CANCELED: "CLOSED",
  CANCELLED: "CLOSED",
};

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    throw businessError(400, `售后状态映射不是合法 JSON：${error.message}`, 400);
  }
}

function statusMapFor(body = {}, env = process.env) {
  return {
    ...DEFAULT_STATUS_MAP,
    ...Object.entries(parseJson(body.statusMap || body.status_map || env.ROOT_AFTER_SALES_STATUS_MAP, {}))
      .reduce((next, [key, value]) => {
        next[String(key).trim().toUpperCase()] = text(value).toUpperCase();
        return next;
      }, {}),
  };
}

function normalizeAfterSalesStatus(rawStatus, body = {}, env = process.env) {
  const raw = text(rawStatus, "REQUESTED").toUpperCase();
  return statusMapFor(body, env)[raw] || raw;
}

function findOrder(data, body = {}) {
  const orderId = text(body.orderId || body.order_id);
  const orderNo = text(body.youzanOrderNo || body.youzan_order_no || body.orderNo || body.order_no);
  return ensureList(data, "youzanOrders").find((order) => {
    return (orderId && order.order_id === orderId) || (orderNo && order.youzan_order_no === orderNo);
  }) || null;
}

function userForOrder(data, order) {
  if (!order || !order.user_id) return null;
  return ensureList(data, "users").find((user) => user.user_id === order.user_id) || null;
}

function rootUserIdFor(data, body = {}, order = null) {
  const direct = text(body.rootUserId || body.root_user_id);
  if (direct) return direct;
  const user = userForOrder(data, order);
  return text(user && user.root_user_id, order && order.user_id);
}

function afterSalesNoFor(body = {}, order = null) {
  return text(
    body.afterSalesNo || body.after_sales_no || body.refundNo || body.refund_no || body.serviceNo || body.service_no,
    [order && order.youzan_order_no, text(body.rawStatus || body.raw_status || body.status), text(body.occurredAt || body.occurred_at)].filter(Boolean).join(":"),
  );
}

function idempotencyKeyFor(body = {}, order = null, afterSalesNo = "") {
  return text(body.idempotencyKey || body.idempotency_key, [
    "order-after-sales",
    afterSalesNo,
    order && order.order_id,
    text(body.rawStatus || body.raw_status || body.status),
  ].filter(Boolean).join(":"));
}

function findExistingRecord(data, afterSalesNo, idempotencyKey) {
  return ensureList(data, "orderAfterSalesRecords").find((record) => {
    if (afterSalesNo && record.after_sales_no === afterSalesNo) return true;
    return idempotencyKey && record.idempotency_key === idempotencyKey;
  }) || null;
}

function toAfterSalesPayload(record) {
  if (!record) return null;
  return {
    orderAfterSalesRecordId: record.order_after_sales_record_id,
    orderId: record.order_id || "",
    youzanOrderNo: record.youzan_order_no || "",
    rootUserId: record.root_user_id || "",
    userId: record.user_id || "",
    afterSalesNo: record.after_sales_no || "",
    afterSalesType: record.after_sales_type || "",
    rawStatus: record.raw_status || "",
    status: record.status || "",
    refundStatus: record.refund_status || "",
    refundAmount: Number(record.refund_amount || 0),
    reason: record.reason || "",
    externalRef: record.external_ref || "",
    sourceType: record.source_type || "",
    sourceRunId: record.source_run_id || "",
    idempotencyKey: record.idempotency_key || "",
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    syncedAt: record.synced_at || "",
  };
}

function updateOrderMirror(order, record) {
  if (!order) return null;
  order.after_sales_status = record.status;
  order.after_sales_no = record.after_sales_no;
  order.refund_status = record.refund_status;
  order.refund_amount = record.refund_amount;
  order.after_sales_updated_at = record.updated_at;
  if (["REFUNDED", "PARTIAL_REFUND"].includes(record.status)) order.order_status = record.status;
  return order;
}

function syncRefundWorkItem(data, order, record) {
  if (!order || !["REFUNDED", "PARTIAL_REFUND"].includes(record.status)) return null;
  const item = ensureList(data, "refundWorkItems")
    .find((candidate) => candidate.order_id === order.order_id && candidate.status !== "PAID");
  if (!item) return null;
  return refundWorkItem.markRefundPaid(data, item.refund_work_item_id);
}

function upsertOrderAfterSalesRecord(data, body = {}, context = {}) {
  const env = context.env || process.env;
  const order = findOrder(data, body);
  if (!order && !text(body.youzanOrderNo || body.youzan_order_no || body.orderNo || body.order_no)) {
    throw businessError(400, "售后同步需要 orderId 或 youzanOrderNo", 400);
  }
  const afterSalesNo = afterSalesNoFor(body, order);
  if (!afterSalesNo) throw businessError(400, "售后单号或稳定幂等字段必填", 400);
  const rawStatus = text(body.rawStatus || body.raw_status || body.status, "REQUESTED").toUpperCase();
  const status = normalizeAfterSalesStatus(rawStatus, body, env);
  const idempotencyKey = idempotencyKeyFor(body, order, afterSalesNo);
  const existing = findExistingRecord(data, afterSalesNo, idempotencyKey);
  const before = clone(existing);
  const now = nowISO();
  const user = userForOrder(data, order);
  const base = existing || {
    order_after_sales_record_id: createId("oas"),
    created_at: now,
  };
  base.order_id = order ? order.order_id : text(body.orderId || body.order_id);
  base.youzan_order_no = order ? order.youzan_order_no : text(body.youzanOrderNo || body.youzan_order_no || body.orderNo || body.order_no);
  base.root_user_id = rootUserIdFor(data, body, order);
  base.user_id = order ? text(order.user_id) : text(body.userId || body.user_id);
  base.after_sales_no = afterSalesNo;
  base.after_sales_type = text(body.afterSalesType || body.after_sales_type || body.type, "REFUND").toUpperCase();
  base.raw_status = rawStatus;
  base.status = status;
  base.refund_status = status;
  base.refund_amount = numberValue(body.refundAmount || body.refund_amount || body.amount, 0);
  base.reason = text(body.reason || body.desc || body.description);
  base.external_ref = text(body.externalRef || body.external_ref);
  base.source_type = text(body.sourceType || body.source_type, "MANUAL").toUpperCase();
  base.source_run_id = text(body.sourceRunId || body.source_run_id);
  base.payload_json = {
    ...(base.payload_json || {}),
    raw: clone(body.rawPayload || body.raw_payload || body.raw || {}),
    receiverPhone: order ? order.receiver_phone || order.phone || "" : text(body.receiverPhone || body.receiver_phone),
    userFound: Boolean(user),
  };
  base.idempotency_key = idempotencyKey;
  base.updated_at = now;
  base.synced_at = text(body.syncedAt || body.synced_at, now);
  if (!existing) ensureList(data, "orderAfterSalesRecords").push(base);

  const updatedOrder = updateOrderMirror(order, base);
  const refundItem = syncRefundWorkItem(data, order, base);

  auditLog.appendAuditLog(data, {
    action: "ORDER_AFTER_SALES_UPSERT",
    targetType: "ORDER_AFTER_SALES",
    targetId: base.order_after_sales_record_id,
    operatorId: text(body.operatorId || body.operator_id || context.operatorId),
    reason: text(body.auditReason || body.audit_reason || body.reason, "同步订单售后状态"),
    before,
    after: clone(base),
    metadata: {
      requestId: text(body.requestId || body.request_id || context.requestId),
      orderId: base.order_id,
      status: base.status,
    },
  });

  return {
    record: toAfterSalesPayload(base),
    created: !existing,
    order: updatedOrder,
    refundWorkItem: refundItem,
  };
}

function syncOrderAfterSalesBatch(data, body = {}, context = {}) {
  const records = body.records || body.samples || body.items || [];
  if (!Array.isArray(records) || !records.length) throw businessError(400, "售后同步 records 不能为空", 400);
  const results = records.map((record) => upsertOrderAfterSalesRecord(data, {
    ...record,
    statusMap: body.statusMap || body.status_map,
    sourceType: body.sourceType || body.source_type || record.sourceType || record.source_type || "BATCH",
    sourceRunId: body.sourceRunId || body.source_run_id || record.sourceRunId || record.source_run_id,
    requestId: body.requestId || body.request_id || context.requestId,
    operatorId: body.operatorId || body.operator_id || context.operatorId,
  }, context));
  return {
    total: results.length,
    createdCount: results.filter((item) => item.created).length,
    records: results.map((item) => item.record),
    results,
  };
}

function listOrderAfterSalesRecords(data, query = {}) {
  const status = text(query.status).toUpperCase();
  const orderId = text(query.orderId || query.order_id);
  const orderNo = text(query.youzanOrderNo || query.youzan_order_no || query.orderNo || query.order_no);
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const limit = Math.max(1, Math.min(200, Number(query.limit || 50)));
  return ensureList(data, "orderAfterSalesRecords")
    .filter((record) => !status || record.status === status)
    .filter((record) => !orderId || record.order_id === orderId)
    .filter((record) => !orderNo || record.youzan_order_no === orderNo)
    .filter((record) => !rootUserId || record.root_user_id === rootUserId)
    .slice()
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
    .slice(0, limit)
    .map(toAfterSalesPayload);
}

module.exports = {
  listOrderAfterSalesRecords,
  normalizeAfterSalesStatus,
  syncOrderAfterSalesBatch,
  toAfterSalesPayload,
  upsertOrderAfterSalesRecord,
};
