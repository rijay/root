const { nowISO } = require("./dates");
const { createId } = require("./seed");

const DEFAULT_CAMPAIGN_ID = "ROOT_PRODUCTS_V060";

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function businessError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function relationForProduct(data, productId, campaignId = DEFAULT_CAMPAIGN_ID) {
  const relations = ensureList(data, "campaignProductRelations")
    .filter((item) => item.youzan_product_id === productId);
  return relations.find((item) => item.campaign_id === campaignId) || relations[0] || null;
}

function jumpTarget(product, context = {}) {
  const env = context.env || {};
  const path = text(product.youzan_path || env.ROOT_MEMBER_CENTER_PRODUCT_PATH);
  return {
    appId: text(env.ROOT_MEMBER_CENTER_APPID || product.youzan_app_id),
    path: /^#小程序:\/\//.test(path) ? "" : path,
    shortLink: /^#小程序:\/\//.test(path) ? path : "",
    envVersion: text(env.ROOT_MEMBER_CENTER_ENV_VERSION, "release"),
    extraData: { from: "myroot_product", productId: product.youzan_product_id },
  };
}

function publicProduct(data, product, context = {}) {
  const relation = relationForProduct(data, product.youzan_product_id, context.campaignId);
  const skus = ensureList(data, "youzanSkus")
    .filter((item) => item.youzan_product_id === product.youzan_product_id)
    .map((item) => ({
      skuId: item.youzan_sku_id,
      skuName: item.sku_name || "默认规格",
      price: item.price === undefined ? null : item.price,
      priceText: item.price_text || "会员中心实时价格",
      stockStatus: item.stock_status || "UNKNOWN",
    }));
  return {
    productId: product.youzan_product_id,
    youzanProductId: product.youzan_product_id,
    title: product.title,
    subtitle: product.subtitle || "",
    summary: product.summary || "",
    description: product.description || "",
    imageUrl: product.image_url || "",
    status: product.status,
    badge: (relation && relation.badge) || product.badge || "",
    priceText: product.price_text || "会员中心实时价格",
    skuCount: skus.length,
    skus,
    campaignId: relation ? relation.campaign_id : "",
    displayOrder: relation ? Number(relation.display_order || 0) : 9999,
    syncedAt: product.synced_at || product.updated_at || "",
    updatedAt: product.updated_at || "",
    youzan: jumpTarget(product, context),
  };
}

function listProducts(data, context = {}) {
  const products = ensureList(data, "youzanProducts")
    .filter((item) => item.status === "ACTIVE")
    .map((item) => publicProduct(data, item, context))
    .sort((left, right) => left.displayOrder - right.displayOrder || left.title.localeCompare(right.title, "zh-Hans-CN"));
  return {
    campaignId: context.campaignId || DEFAULT_CAMPAIGN_ID,
    products,
    syncedAt: products.reduce((latest, item) => item.syncedAt > latest ? item.syncedAt : latest, ""),
  };
}

function getProduct(data, productId, context = {}) {
  const product = ensureList(data, "youzanProducts").find((item) => (
    item.youzan_product_id === text(productId) && item.status === "ACTIVE"
  ));
  if (!product) throw businessError(6404, "商品不存在或已下架", 404);
  return publicProduct(data, product, context);
}

function recordJump(data, rootUserId, input = {}, context = {}) {
  const product = getProduct(data, input.productId || input.product_id, context);
  const occurredAt = context.now || nowISO();
  const row = {
    product_jump_log_id: createId("pjl"),
    root_user_id: rootUserId,
    youzan_product_id: product.productId,
    campaign_id: product.campaignId || DEFAULT_CAMPAIGN_ID,
    jump_target: product.youzan,
    source_channel: text(input.sourceChannel || input.source_channel, "MINIPROGRAM_PRODUCT").slice(0, 64),
    metadata: {},
    occurred_at: occurredAt,
  };
  ensureList(data, "productJumpLogs").push(row);
  return { product, jumpTarget: product.youzan, jumpLogId: row.product_jump_log_id, occurredAt };
}

module.exports = Object.freeze({
  DEFAULT_CAMPAIGN_ID,
  getProduct,
  listProducts,
  recordJump,
});
