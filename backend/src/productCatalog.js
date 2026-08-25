const { nowISO } = require("./dates");
const { createId } = require("./seed");

const DEFAULT_CAMPAIGN_ID = "ROOT_PRODUCTS_V060";
const MEMBER_CENTER_APP_ID = "wxfb75c0b432670215";
const OFFICIAL_PRODUCTS = Object.freeze([
  Object.freeze({
    youzan_product_id: "4749049439",
    title: "ROOT 低敏畅享·每日衡养益生元饮料 RT-PrB-01",
    subtitle: "温和清畅，敏肠之选",
    summary: "为日常饮用场景设计的温和型益生元饮料。",
    description: "商品信息来自 Root 会员中心快照。规格、价格、库存、优惠及适用说明以会员中心实时展示为准。",
    image_url: "",
    price_text: "会员中心实时价格",
    status: "ACTIVE",
    badge: "低敏畅享",
    youzan_app_id: MEMBER_CENTER_APP_ID,
    youzan_path: "packages/goods/detail/index?alias=36ep2dcgnia7nf0&shopAutoEnter=1",
  }),
  Object.freeze({
    youzan_product_id: "4875324599",
    title: "ROOT 双链速畅·深彻赋活益生元饮料 RT-PrB-02",
    subtitle: "长短链协同，畅然速调",
    summary: "长短链协同配方的日常益生元饮料。",
    description: "商品信息来自 Root 会员中心快照。规格、价格、库存、优惠及适用说明以会员中心实时展示为准。",
    image_url: "",
    price_text: "会员中心实时价格",
    status: "ACTIVE",
    badge: "双链速畅",
    youzan_app_id: MEMBER_CENTER_APP_ID,
    youzan_path: "packages/goods/detail/index?alias=3f2cc448cksvnmk&shopAutoEnter=1",
  }),
]);
const OFFICIAL_RELATIONS = Object.freeze([
  Object.freeze({
    campaign_product_relation_id: "cpr_root_rtpbr01",
    campaign_id: DEFAULT_CAMPAIGN_ID,
    youzan_product_id: "4749049439",
    display_order: 10,
    badge: "低敏畅享",
  }),
  Object.freeze({
    campaign_product_relation_id: "cpr_root_rtpbr02",
    campaign_id: DEFAULT_CAMPAIGN_ID,
    youzan_product_id: "4875324599",
    display_order: 20,
    badge: "双链速畅",
  }),
]);

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

function officialProducts(data) {
  const persisted = new Map(ensureList(data, "youzanProducts")
    .filter((item) => item && item.youzan_product_id)
    .map((item) => [item.youzan_product_id, item]));
  const current = OFFICIAL_PRODUCTS.map((official) => {
    const dynamic = persisted.get(official.youzan_product_id) || {};
    persisted.delete(official.youzan_product_id);
    return {
      ...official,
      ...dynamic,
      title: official.title,
      subtitle: official.subtitle,
      summary: official.summary,
      description: official.description,
      badge: official.badge,
      youzan_app_id: official.youzan_app_id,
      youzan_path: official.youzan_path,
    };
  });
  return [...current, ...persisted.values()];
}

function officialRelations(data) {
  const persisted = ensureList(data, "campaignProductRelations")
    .filter((item) => item && item.youzan_product_id && item.campaign_id);
  const keyed = new Map(persisted.map((item) => [`${item.campaign_id}:${item.youzan_product_id}`, item]));
  OFFICIAL_RELATIONS.forEach((official) => keyed.set(
    `${official.campaign_id}:${official.youzan_product_id}`,
    { ...keyed.get(`${official.campaign_id}:${official.youzan_product_id}`), ...official },
  ));
  return [...keyed.values()];
}

function relationForProduct(data, productId, campaignId = DEFAULT_CAMPAIGN_ID) {
  return officialRelations(data).find((item) => (
    item.youzan_product_id === productId && item.campaign_id === campaignId
  )) || null;
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

function liveSku(item = {}) {
  const amount = Number(item.price);
  const status = String(item.stockStatus || "").trim();
  return {
    skuId: String(item.skuId || "").trim().slice(0, 80),
    skuName: text(item.skuName, "默认规格").slice(0, 80),
    price: Number.isFinite(amount) && amount >= 0 ? amount : null,
    priceText: text(item.priceText, "会员中心实时价格").slice(0, 40),
    stockStatus: ["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"].includes(status) ? status : "UNKNOWN",
  };
}

function publicProduct(data, product, context = {}) {
  const relation = relationForProduct(data, product.youzan_product_id, context.campaignId);
  const liveSnapshots = context.liveProductSnapshots instanceof Map
    ? context.liveProductSnapshots
    : new Map((Array.isArray(context.liveProductSnapshots) ? context.liveProductSnapshots : [])
      .filter((item) => item && item.productId)
      .map((item) => [String(item.productId), item]));
  const live = liveSnapshots.get(product.youzan_product_id) || null;
  const persistedSkus = ensureList(data, "youzanSkus")
    .filter((item) => item.youzan_product_id === product.youzan_product_id)
    .map((item) => ({
      skuId: item.youzan_sku_id,
      skuName: item.sku_name || "默认规格",
      price: item.price === undefined ? null : item.price,
      priceText: item.price_text || "会员中心实时价格",
      stockStatus: item.stock_status || "UNKNOWN",
    }));
  const skus = live && Array.isArray(live.skus) ? live.skus.map(liveSku) : persistedSkus;
  return {
    productId: product.youzan_product_id,
    youzanProductId: product.youzan_product_id,
    title: product.title,
    subtitle: product.subtitle || "",
    summary: product.summary || "",
    description: product.description || "",
    imageUrl: (live && live.imageUrl) || product.image_url || "",
    status: product.status,
    badge: (relation && relation.badge) || product.badge || "",
    priceText: (live && live.priceText) || product.price_text || "会员中心实时价格",
    skuCount: skus.length,
    skus,
    campaignId: relation ? relation.campaign_id : "",
    displayOrder: relation ? Number(relation.display_order || 0) : 9999,
    syncedAt: (live && live.syncedAt) || product.synced_at || product.updated_at || "",
    updatedAt: product.updated_at || "",
    youzan: jumpTarget(product, context),
  };
}

function listProducts(data, context = {}) {
  const campaignId = context.campaignId || DEFAULT_CAMPAIGN_ID;
  const products = officialProducts(data)
    .filter((item) => item.status === "ACTIVE")
    .map((item) => publicProduct(data, item, { ...context, campaignId }))
    .filter((item) => item.campaignId === campaignId)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.title.localeCompare(right.title, "zh-Hans-CN"));
  return {
    campaignId,
    products,
    syncedAt: products.reduce((latest, item) => item.syncedAt > latest ? item.syncedAt : latest, ""),
  };
}

function getProduct(data, productId, context = {}) {
  const product = officialProducts(data).find((item) => (
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
  MEMBER_CENTER_APP_ID,
  OFFICIAL_PRODUCTS,
  OFFICIAL_RELATIONS,
  getProduct,
  listProducts,
  recordJump,
});
