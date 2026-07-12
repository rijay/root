const { nowISO } = require("./dates");
const auditLog = require("./auditLog");
const productMirror = require("./productMirror");
const { createYouzanProductImplementation } = require("./youzanProductAdapter");

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function bool(value) {
  if (value === true) return true;
  const textValue = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "confirmed"].includes(textValue);
}

function manualProductsFromBody(body = {}) {
  const value = body.products || body.items || body.samples;
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Array.isArray(value.products) ? value.products : [value];
  return [];
}

async function fetchProducts(body = {}, context = {}) {
  const manualProducts = manualProductsFromBody(body);
  if (manualProducts.length) {
    return {
      products: manualProducts,
      externalCount: manualProducts.length,
      nextCursor: "",
      hasMore: false,
      adapterMode: "MANUAL",
    };
  }
  const env = context.env || process.env;
  const adapter = context.productSyncAdapter || createYouzanProductImplementation({ fetchImpl: context.fetchImpl });
  const result = await adapter({
    env,
    fetchImpl: context.fetchImpl,
    cursor: body.cursor || body.cursor_before || "",
    limit: Number(body.limit || body.pageSize || body.page_size || 50),
    body,
  });
  return {
    products: result.products || [],
    externalCount: result.externalCount || 0,
    nextCursor: result.nextCursor || result.next_cursor || "",
    hasMore: Boolean(result.hasMore || result.has_more),
    adapterMode: "YOUZAN_PRODUCT",
  };
}

function previewRows(products = []) {
  return products.map((product, index) => ({
    index: index + 1,
    productId: product.youzanProductId || product.youzan_product_id || product.productId || product.product_id || "",
    title: product.title || product.name || "",
    status: product.status || "ACTIVE",
    skuCount: Array.isArray(product.skus) ? product.skus.length : 0,
    importable: Boolean(product.youzanProductId || product.youzan_product_id || product.productId || product.product_id) && Boolean(product.title || product.name),
  }));
}

async function previewProductSync(data, body = {}, context = {}) {
  const fetched = await fetchProducts(body, context);
  const rows = previewRows(fetched.products);
  return {
    adapterMode: fetched.adapterMode,
    campaignId: text(body.campaignId || body.campaign_id, productMirror.DEFAULT_CAMPAIGN_ID),
    total: rows.length,
    importableCount: rows.filter((row) => row.importable).length,
    errorCount: rows.filter((row) => !row.importable).length,
    cursorAfter: fetched.nextCursor,
    hasMore: fetched.hasMore,
    rows,
    products: fetched.products,
  };
}

async function executeProductSync(data, body = {}, context = {}) {
  const requestId = text(body.requestId || body.request_id);
  if (!requestId) throw businessError(8201, "商品同步必须提供 request_id");
  if (!bool(body.confirmRisk || body.confirm_risk || body.confirmed)) {
    throw businessError(8202, "商品同步需要二次确认");
  }
  const preview = await previewProductSync(data, body, context);
  if (preview.errorCount) throw businessError(8203, "商品同步存在不可导入记录，请先预览修正");
  const now = nowISO();
  const campaignId = preview.campaignId;
  const synced = preview.products.map((product, index) => {
    const result = productMirror.upsertDisplayProduct(data, {
      ...product,
      campaignId,
      displayOrder: product.displayOrder || product.display_order || (index + 1) * 10,
      syncedAt: now,
    }, context);
    return result.product;
  });
  const audit = auditLog.appendAuditLog(data, {
    action: "YOUZAN_PRODUCT_SYNC",
    targetType: "YOUZAN_PRODUCT_SYNC",
    targetId: requestId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "同步有赞商品",
    before: null,
    after: {
      campaignId,
      productIds: synced.map((product) => product.productId),
      importedCount: synced.length,
      cursorAfter: preview.cursorAfter,
      hasMore: preview.hasMore,
    },
    metadata: {
      requestId,
      adapterMode: preview.adapterMode,
    },
  });
  return {
    requestId,
    campaignId,
    importedCount: synced.length,
    products: synced,
    cursorAfter: preview.cursorAfter,
    hasMore: preview.hasMore,
    audit,
  };
}

module.exports = {
  executeProductSync,
  fetchProducts,
  previewProductSync,
};
