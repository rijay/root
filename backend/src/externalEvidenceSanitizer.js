const SAFE_VALUE_KEYS = new Set([
  "amount",
  "carrier",
  "corpwechatstatus",
  "created",
  "createdat",
  "deliveredat",
  "deliverystatus",
  "hasmore",
  "inputtype",
  "mode",
  "orderstatus",
  "paidat",
  "payment",
  "productid",
  "productname",
  "shippedat",
  "sourcechannel",
  "sourcetype",
  "status",
  "title",
  "total",
  "updated",
  "updatedat",
]);

const SAFE_VALUE_KEY_PATTERN = /(^|_)(status|state|amount|price|payment|count|total|time|date|page|size|type|mode|carrier|source|channel|version|code)($|_)/i;
const SAFE_VALUE_KEY_CN_PATTERN = /(状态|金额|价格|时间|日期|商品|快递公司|物流公司|来源渠道|来源活动|活动名称|类型|模式|数量|页码)/;
const SENSITIVE_KEY_PATTERN = /(phone|mobile|tel|address|receiver|buyer|name|nick|union|openid|open_id|yz_uid|yz_open_id|uid|user_id|customer|contact|external|tracking|order|tid|secret|token|note|remark|payload|media|image|url)/i;

function normalizedKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function redactedString(value) {
  const length = Array.from(String(value || "")).length;
  return length ? `[已脱敏:${length}字符]` : "";
}

function safeToPersist(key) {
  const normalized = normalizedKey(key);
  if (SAFE_VALUE_KEYS.has(normalized)) return true;
  if (SAFE_VALUE_KEY_CN_PATTERN.test(String(key || ""))) return true;
  if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) return false;
  return SAFE_VALUE_KEY_PATTERN.test(String(key || ""));
}

function sanitizeValue(value, key = "", depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return "";
    return safeToPersist(key) ? normalized.slice(0, 160) : redactedString(normalized);
  }
  if (depth >= 6) return Array.isArray(value) ? `[数组:${value.length}]` : "[对象]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, key, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value).reduce((result, [childKey, childValue]) => {
      result[childKey] = sanitizeValue(childValue, childKey, depth + 1);
      return result;
    }, {});
  }
  return redactedString(String(value));
}

function sanitizeExternalReviewRecord(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return {};
  return sanitizeValue(record);
}

function externalPayloadFieldPaths(payload, options = {}) {
  const maxPaths = Math.max(1, Number(options.maxPaths) || 120);
  const paths = [];

  function visit(value, prefix, depth) {
    if (paths.length >= maxPaths || depth > 6 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      paths.push(`${prefix}[]`);
      if (value.length) visit(value[0], `${prefix}[]`, depth + 1);
      return;
    }
    if (typeof value !== "object") {
      if (prefix) paths.push(prefix);
      return;
    }
    Object.keys(value).sort().forEach((key) => {
      if (paths.length >= maxPaths) return;
      const path = prefix ? `${prefix}.${key}` : key;
      visit(value[key], path, depth + 1);
    });
  }

  visit(payload, "", 0);
  return Array.from(new Set(paths.filter(Boolean))).sort();
}

function normalizedFieldPathPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  if (Array.isArray(payload.field_paths) && Object.keys(payload).every((key) => key === "field_paths")) {
    return {
      field_paths: Array.from(new Set(payload.field_paths.map((item) => String(item || "").trim()).filter(Boolean))).sort(),
    };
  }
  return {
    field_paths: externalPayloadFieldPaths(payload),
  };
}

function minimizePersistedExternalEvidence(data = {}) {
  if (Array.isArray(data.externalSampleReviews)) {
    data.externalSampleReviews.forEach((review) => {
      if (!Array.isArray(review.rows)) return;
      review.rows.forEach((row) => {
        row.raw = sanitizeExternalReviewRecord(row.raw || {});
        row.mapped = sanitizeExternalReviewRecord(row.mapped || {});
      });
    });
  }
  if (Array.isArray(data.youzanCustomers)) {
    data.youzanCustomers.forEach((customer) => {
      const rawPayload = customer && customer.raw_payload;
      if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload) || !Object.keys(rawPayload).length) return;
      customer.raw_payload = normalizedFieldPathPayload(rawPayload);
    });
  }
  return data;
}

module.exports = {
  externalPayloadFieldPaths,
  minimizePersistedExternalEvidence,
  sanitizeExternalReviewRecord,
};
