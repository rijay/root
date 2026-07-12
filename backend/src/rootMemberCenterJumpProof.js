const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

function ensureRootMemberCenterJumpProofs(data) {
  if (!Array.isArray(data.rootMemberCenterJumpProofs)) data.rootMemberCenterJumpProofs = [];
  return data.rootMemberCenterJumpProofs;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTarget(value) {
  return value === "production" ? "production" : "gray";
}

function normalizeStatus(value) {
  const status = text(value).toUpperCase();
  if (["VERIFIED", "REJECTED"].includes(status)) return status;
  return "";
}

function redact(value) {
  return text(value)
    .replace(/(token|secret|password|access_token|key|openid|unionid|phone|mobile)=([^&\s]+)/gi, "$1=***")
    .replace(/(openid|unionid|phone|mobile)\s*[:：]\s*([A-Za-z0-9_-]+)/gi, "$1=***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***")
    .replace(/\b1[3-9]\d{9}\b/g, "1**********");
}

function sanitizeEvidenceRef(value) {
  const raw = redact(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    return raw.replace(/\?.*$/, "").replace(/#.*/, "");
  }
}

function normalizeProductId(value) {
  return text(value || "*");
}

function ensureProductList(data) {
  return Array.isArray(data && data.youzanProducts) ? data.youzanProducts : [];
}

function productTitle(data, productId) {
  if (productId === "*") return "全部商品";
  const product = ensureProductList(data).find((item) => text(item.youzan_product_id) === productId);
  return text(product && product.title);
}

function proofSummary(record) {
  return {
    proofId: record.proof_id,
    target: record.target,
    productId: record.product_id,
    productTitle: record.product_title,
    status: record.status,
    appId: record.app_id,
    path: record.path,
    operatorId: record.operator_id,
    evidenceRef: record.evidence_ref,
    requestId: record.request_id,
    note: record.note,
    recordedAt: record.recorded_at,
  };
}

function listRootMemberCenterJumpProofs(data, query = {}) {
  const target = text(query.target);
  const productId = text(query.productId || query.product_id);
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  return ensureRootMemberCenterJumpProofs(data)
    .filter((record) => !target || record.target === target)
    .filter((record) => !productId || record.product_id === productId)
    .slice(0, limit)
    .map(proofSummary);
}

function latestRootMemberCenterJumpProofs(data, query = {}) {
  const target = normalizeTarget(query.target);
  const productId = text(query.productId || query.product_id);
  const latestByProduct = new Map();
  ensureRootMemberCenterJumpProofs(data)
    .filter((record) => record.target === target)
    .filter((record) => !productId || record.product_id === productId || record.product_id === "*")
    .forEach((record) => {
      if (!latestByProduct.has(record.product_id)) latestByProduct.set(record.product_id, proofSummary(record));
    });
  return Array.from(latestByProduct.values());
}

function createRootMemberCenterJumpProof(data, input = {}) {
  const requestId = text(input.requestId || input.request_id);
  if (!requestId) throw Object.assign(new Error("Root 会员中心跳转证明 request_id 必填"), { code: 400 });
  const existing = ensureRootMemberCenterJumpProofs(data).find((record) => record.request_id === requestId);
  if (existing) return { proof: proofSummary(existing), audit: null, idempotent: true };

  const status = normalizeStatus(input.status);
  if (!status) throw Object.assign(new Error("Root 会员中心跳转证明状态只能是 VERIFIED 或 REJECTED"), { code: 400 });
  const productId = normalizeProductId(input.productId || input.product_id);
  const appId = text(input.appId || input.app_id);
  const path = text(input.path);
  const evidenceRef = sanitizeEvidenceRef(input.evidenceRef || input.evidence_ref);
  if (status === "VERIFIED" && !evidenceRef) {
    throw Object.assign(new Error("VERIFIED 跳转证明必须填写证据引用"), { code: 400 });
  }
  if (!appId) throw Object.assign(new Error("Root 会员中心跳转证明必须填写 appId"), { code: 400 });
  if (!path) throw Object.assign(new Error("Root 会员中心跳转证明必须填写购买路径"), { code: 400 });

  const record = {
    proof_id: createId("rmc_jump"),
    target: normalizeTarget(input.target),
    product_id: productId,
    product_title: text(input.productTitle || input.product_title) || productTitle(data, productId),
    status,
    app_id: appId,
    path,
    operator_id: text(input.operatorId || input.operator_id, "system"),
    evidence_ref: evidenceRef,
    request_id: requestId,
    note: redact(input.note),
    recorded_at: nowISO(),
  };
  ensureRootMemberCenterJumpProofs(data).unshift(record);
  data.rootMemberCenterJumpProofs = ensureRootMemberCenterJumpProofs(data).slice(0, 500);
  const audit = auditLog.appendAuditLog(data, {
    action: "ROOT_MEMBER_CENTER_JUMP_PROOF_RECORD",
    targetType: "ROOT_MEMBER_CENTER_JUMP_PROOF",
    targetId: record.proof_id,
    operatorId: record.operator_id,
    reason: record.note,
    after: proofSummary(record),
    metadata: {
      requestId,
      target: record.target,
      productId: record.product_id,
      status: record.status,
    },
  });
  return { proof: proofSummary(record), audit };
}

module.exports = {
  createRootMemberCenterJumpProof,
  ensureRootMemberCenterJumpProofs,
  latestRootMemberCenterJumpProofs,
  listRootMemberCenterJumpProofs,
  proofSummary,
};
