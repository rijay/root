const { nowISO } = require("./dates");
const { createId } = require("./seed");

const DEFAULT_CAMPAIGN_ID = "ROOT_ROADSHOW_DEFAULT";

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

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

function isMiniProgramShortLink(value) {
  return /^#小程序:\/\//.test(text(value));
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStatus(value) {
  const status = text(value || "ACTIVE").toUpperCase();
  return ["ACTIVE", "HIDDEN", "SOLD_OUT", "ARCHIVED"].includes(status) ? status : "ACTIVE";
}

function normalizeProductId(input = {}) {
  return text(input.youzanProductId || input.youzan_product_id || input.productId || input.product_id);
}

function normalizeSkuId(productId, input = {}, index = 0) {
  return text(input.youzanSkuId || input.youzan_sku_id || input.skuId || input.sku_id, `${productId}_SKU_${index + 1}`);
}

function normalizeSku(productId, input = {}, index = 0, dateText = nowISO()) {
  return {
    youzan_sku_id: normalizeSkuId(productId, input, index),
    youzan_product_id: productId,
    sku_name: text(input.skuName || input.sku_name || input.name, "默认规格"),
    price: numberOrNull(input.price),
    price_text: text(input.priceText || input.price_text),
    stock_status: text(input.stockStatus || input.stock_status || "UNKNOWN").toUpperCase(),
    raw_payload: objectValue(input.rawPayload || input.raw_payload),
    created_at: input.createdAt || input.created_at || dateText,
    updated_at: dateText,
  };
}

function resolveYouzanAppId(product = {}, context = {}) {
  const env = context.env || {};
  return text(
    env.ROOT_MEMBER_CENTER_APPID ||
      env.ROOT_YOUZAN_APP_ID ||
      env.YOUZAN_MINIPROGRAM_APPID ||
      env.YOUZAN_MINI_APP_ID ||
      env.YOUZAN_APP_ID ||
      product.youzan_app_id
  );
}

function resolveYouzanPath(product = {}, context = {}) {
  const env = context.env || {};
  return text(
    product.youzan_path ||
      env.ROOT_MEMBER_CENTER_PRODUCT_PATH ||
      env.ROOT_YOUZAN_PRODUCT_PATH ||
      env.YOUZAN_PRODUCT_PATH ||
      env.YOUZAN_MINIPROGRAM_PRODUCT_PATH
  );
}

function buildYouzanJumpTarget(product = {}, context = {}) {
  const env = context.env || {};
  const path = resolveYouzanPath(product, context);
  return {
    appId: resolveYouzanAppId(product, context),
    path,
    shortLink: isMiniProgramShortLink(path) ? path : "",
    envVersion: text(env.ROOT_MEMBER_CENTER_ENV_VERSION || env.ROOT_YOUZAN_ENV_VERSION || env.YOUZAN_ENV_VERSION, "release"),
    extraData: {
      from: "myroot_product",
      youzanProductId: product.youzan_product_id || "",
    },
  };
}

function relationMatches(relation, campaignId) {
  if (!campaignId) return true;
  return relation.campaign_id === campaignId;
}

function relationForProduct(data, productId, campaignId) {
  return ensureList(data, "campaignProductRelations")
    .filter((relation) => relation.youzan_product_id === productId && relationMatches(relation, campaignId))
    .sort((left, right) => (left.display_order || 0) - (right.display_order || 0))[0] || null;
}

function priceTextForProduct(product, skus) {
  if (product.price_text) return product.price_text;
  const prices = skus.map((sku) => numberOrNull(sku.price)).filter((value) => value !== null);
  if (!prices.length) return "价格以 Root 会员中心为准";
  const min = Math.min(...prices);
  return `¥${min.toFixed(2).replace(/\.00$/, "")}`;
}

function toDisplayProductPayload(data, product, relation = null, context = {}) {
  const skus = ensureList(data, "youzanSkus")
    .filter((sku) => sku.youzan_product_id === product.youzan_product_id)
    .map((sku) => ({
      skuId: sku.youzan_sku_id,
      skuName: sku.sku_name,
      price: sku.price,
      priceText: sku.price_text || (sku.price === null || sku.price === undefined ? "价格以 Root 会员中心为准" : `¥${Number(sku.price).toFixed(2).replace(/\.00$/, "")}`),
      stockStatus: sku.stock_status || "UNKNOWN",
    }));
  return {
    productId: product.youzan_product_id,
    youzanProductId: product.youzan_product_id,
    title: product.title,
    subtitle: product.subtitle || "",
    summary: product.summary || "",
    description: product.description || "",
    imageUrl: product.image_url || "",
    status: product.status || "ACTIVE",
    badge: (relation && relation.badge) || product.badge || "",
    priceText: priceTextForProduct(product, skus),
    skuCount: skus.length,
    skus,
    campaignId: relation ? relation.campaign_id : "",
    displayOrder: relation ? relation.display_order : 0,
    syncedAt: product.synced_at || product.updated_at || product.created_at || "",
    updatedAt: product.updated_at || "",
    youzan: buildYouzanJumpTarget(product, context),
  };
}

function listDisplayProducts(data, campaignId = DEFAULT_CAMPAIGN_ID, context = {}) {
  const products = ensureList(data, "youzanProducts")
    .filter((product) => product.status === "ACTIVE")
    .map((product) => ({
      product,
      relation: relationForProduct(data, product.youzan_product_id, campaignId),
    }))
    .filter((entry) => !campaignId || entry.relation || !ensureList(data, "campaignProductRelations").some((relation) => relationMatches(relation, campaignId)))
    .sort((left, right) => {
      const leftOrder = left.relation ? left.relation.display_order || 0 : 9999;
      const rightOrder = right.relation ? right.relation.display_order || 0 : 9999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.product.title || "").localeCompare(String(right.product.title || ""), "zh-Hans-CN");
    });

  return {
    campaignId,
    products: products.map(({ product, relation }) => toDisplayProductPayload(data, product, relation, context)),
    syncedAt: products.reduce((latest, entry) => {
      const value = entry.product.synced_at || entry.product.updated_at || "";
      return value > latest ? value : latest;
    }, ""),
  };
}

function getDisplayProduct(data, productId, context = {}) {
  const normalizedId = text(productId);
  const product = ensureList(data, "youzanProducts").find((item) => item.youzan_product_id === normalizedId && item.status !== "ARCHIVED");
  if (!product) throw businessError(404, "商品不存在或已下架", 404);
  const relation = relationForProduct(data, product.youzan_product_id, "");
  return toDisplayProductPayload(data, product, relation, context);
}

function upsertDisplayProduct(data, input = {}, context = {}) {
  const now = nowISO();
  const productId = normalizeProductId(input);
  if (!productId) throw businessError(2001, "请填写有赞商品ID");
  const products = ensureList(data, "youzanProducts");
  const existing = products.find((item) => item.youzan_product_id === productId);
  const product = {
    youzan_product_id: productId,
    title: text(input.title || input.name, existing && existing.title),
    subtitle: text(input.subtitle, existing && existing.subtitle),
    summary: text(input.summary, existing && existing.summary),
    description: text(input.description, existing && existing.description),
    image_url: text(input.imageUrl || input.image_url, existing && existing.image_url),
    price_text: text(input.priceText || input.price_text, existing && existing.price_text),
    status: normalizeStatus(input.status || (existing && existing.status)),
    badge: text(input.badge, existing && existing.badge),
    youzan_app_id: text(input.youzanAppId || input.youzan_app_id, existing && existing.youzan_app_id),
    youzan_path: text(input.youzanPath || input.youzan_path, existing && existing.youzan_path),
    raw_payload: objectValue(input.rawPayload || input.raw_payload || (existing && existing.raw_payload)),
    created_at: existing ? existing.created_at : now,
    updated_at: now,
    synced_at: input.syncedAt || input.synced_at || now,
  };
  if (!product.title) throw businessError(2002, "请填写商品名称");
  if (existing) Object.assign(existing, product);
  else products.push(product);

  const skus = ensureList(data, "youzanSkus");
  if (Array.isArray(input.skus)) {
    for (let index = skus.length - 1; index >= 0; index -= 1) {
      if (skus[index].youzan_product_id === productId) skus.splice(index, 1);
    }
    input.skus.forEach((sku, index) => skus.push(normalizeSku(productId, sku, index, now)));
  }

  const campaignId = text(input.campaignId || input.campaign_id, DEFAULT_CAMPAIGN_ID);
  const relationInput = input.relation || {};
  const relations = ensureList(data, "campaignProductRelations");
  let relation = relations.find((item) => item.campaign_id === campaignId && item.youzan_product_id === productId);
  if (!relation) {
    relation = {
      campaign_product_relation_id: createId("cpr"),
      campaign_id: campaignId,
      youzan_product_id: productId,
      created_at: now,
    };
    relations.push(relation);
  }
  Object.assign(relation, {
    display_order: Number(relationInput.displayOrder || relationInput.display_order || input.displayOrder || input.display_order || relation.display_order || 10),
    badge: text(relationInput.badge || input.badge, relation.badge),
    updated_at: now,
  });

  return {
    product: toDisplayProductPayload(data, existing || product, relation, context),
    relation,
  };
}

function recordProductJump(data, rootUserId, productId, context = {}) {
  const product = ensureList(data, "youzanProducts").find((item) => item.youzan_product_id === productId && item.status === "ACTIVE");
  if (!product) throw businessError(404, "商品不存在或已下架", 404);
  const relation = relationForProduct(data, product.youzan_product_id, context.campaignId || DEFAULT_CAMPAIGN_ID);
  const jumpTarget = buildYouzanJumpTarget(product, context);
  const log = {
    product_jump_log_id: createId("pjl"),
    root_user_id: rootUserId,
    youzan_product_id: product.youzan_product_id,
    campaign_id: relation ? relation.campaign_id : text(context.campaignId, DEFAULT_CAMPAIGN_ID),
    jump_target: jumpTarget,
    source_channel: text(context.sourceChannel, "MINIPROGRAM_PRODUCT"),
    metadata: objectValue(context.metadata),
    occurred_at: nowISO(),
  };
  ensureList(data, "productJumpLogs").push(log);
  return {
    product: toDisplayProductPayload(data, product, relation, context),
    jumpTarget,
    jumpLogId: log.product_jump_log_id,
    occurredAt: log.occurred_at,
  };
}

module.exports = {
  DEFAULT_CAMPAIGN_ID,
  buildYouzanJumpTarget,
  getDisplayProduct,
  listDisplayProducts,
  recordProductJump,
  toDisplayProductPayload,
  upsertDisplayProduct,
};
