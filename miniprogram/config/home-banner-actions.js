const BRAND_FOUNDATION_PATH = "/subpkg/content/pages/brand-foundation/index";
const ROOT_WITH_YOU_PATH = "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY";
const ROOT_FOUNDATION_CONTENT_ID = "SHARED_DETAIL_C53C7360B016F4";
const ROOT_WITH_YOU_PUBLISHED_CONTENT_ID = "SHARED_DETAIL_DB47F77499F012";
const ROOT_WITH_YOU_CONTENT_ID = "ROOT_WITH_YOU_V060";
const ROOT_PRODUCTS_CONTENT_ID = "SHARED_DETAIL_6292953EB853D1";

const HOME_BANNER_ACTIONS_BY_SLOT = Object.freeze({
  1: Object.freeze({ type: "MINIPROGRAM_PAGE", path: BRAND_FOUNDATION_PATH }),
  2: Object.freeze({ type: "PRODUCTS" }),
  3: Object.freeze({ type: "MINIPROGRAM_PAGE", path: ROOT_WITH_YOU_PATH }),
});

const HOME_BANNER_ACTIONS_BY_CONTENT_ID = Object.freeze({
  cnt_home_foundation: HOME_BANNER_ACTIONS_BY_SLOT[1],
  [ROOT_FOUNDATION_CONTENT_ID]: HOME_BANNER_ACTIONS_BY_SLOT[1],
  [ROOT_PRODUCTS_CONTENT_ID]: HOME_BANNER_ACTIONS_BY_SLOT[2],
  [ROOT_WITH_YOU_PUBLISHED_CONTENT_ID]: HOME_BANNER_ACTIONS_BY_SLOT[3],
  [ROOT_WITH_YOU_CONTENT_ID]: Object.freeze({ type: "MINIPROGRAM_PAGE", path: ROOT_WITH_YOU_PATH }),
});

const HOME_BANNER_PRESENTATION_BY_CONTENT_ID = Object.freeze({
  cnt_home_foundation: Object.freeze({
    kicker: "",
    lines: Object.freeze(["立即探索"]),
    copyMode: "text",
    copyVariant: "foundation-single",
    coverAssetUrl: "/static/home/banner1.jpg",
  }),
  [ROOT_FOUNDATION_CONTENT_ID]: Object.freeze({
    kicker: "",
    lines: Object.freeze(["立即探索"]),
    copyMode: "text",
    copyVariant: "foundation-single",
    coverAssetUrl: "/static/home/banner1.jpg",
  }),
  [ROOT_PRODUCTS_CONTENT_ID]: Object.freeze({
    kicker: "ROOT PRODUCTS",
    lines: Object.freeze(["根据自身肠道状态", "选择专属养护方式"]),
    copyMode: "text",
    copyVariant: "default",
    coverAssetUrl: "/static/home/banner2.jpg",
  }),
  [ROOT_WITH_YOU_CONTENT_ID]: Object.freeze({
    copyMode: "text",
    copyVariant: "campaign-split",
    coverAssetUrl: "/static/campaign/root-with-you-home.jpg",
  }),
  [ROOT_WITH_YOU_PUBLISHED_CONTENT_ID]: Object.freeze({
    copyMode: "text",
    copyVariant: "campaign-split",
    coverAssetUrl: "/static/campaign/root-with-you-home.jpg",
  }),
});

const HOME_BANNER_PRESENTATION_BY_SLOT = Object.freeze({
  2: Object.freeze({
    kicker: "ROOT PRODUCTS",
    lines: Object.freeze(["根据自身肠道状态", "选择专属养护方式"]),
    copyMode: "text",
    copyVariant: "default",
    coverAssetUrl: "/static/home/banner2.jpg",
  }),
  3: Object.freeze({
    copyMode: "text",
    copyVariant: "campaign-split",
    coverAssetUrl: "/static/campaign/root-with-you-home.jpg",
  }),
});

const LOCAL_HOME_BANNERS = Object.freeze([
  Object.freeze({
    contentId: ROOT_WITH_YOU_CONTENT_ID,
    slot: 3,
    kicker: "ROOT WITH YOU",
    lines: Object.freeze(["ROOT陪伴计划", "快速了解你的肠道状态", "并领取5支益生元体验装"]),
    copyMode: "text",
    coverAssetUrl: "/static/campaign/root-with-you-home.jpg",
    assetState: "AUTHORIZED",
    action: HOME_BANNER_ACTIONS_BY_CONTENT_ID[ROOT_WITH_YOU_CONTENT_ID],
  }),
]);

const BUNDLED_HOME_FIRST_FRAME = Object.freeze({
  publicationState: "BUNDLED_FIRST_FRAME",
  items: Object.freeze([
    Object.freeze({
      contentId: ROOT_FOUNDATION_CONTENT_ID,
      slot: 1,
      kicker: "",
      lines: Object.freeze(["立即探索"]),
      copyMode: "text",
      copyVariant: "foundation-single",
      coverAssetUrl: "/static/home/banner1.jpg",
      assetState: "BUILTIN_FIRST_FRAME",
      action: HOME_BANNER_ACTIONS_BY_SLOT[1],
    }),
    Object.freeze({
      contentId: ROOT_PRODUCTS_CONTENT_ID,
      slot: 2,
      kicker: "ROOT PRODUCTS",
      lines: Object.freeze(["根据自身肠道状态", "选择专属养护方式"]),
      copyMode: "text",
      coverAssetUrl: "/static/home/banner2.jpg",
      assetState: "BUILTIN_FIRST_FRAME",
      action: HOME_BANNER_ACTIONS_BY_SLOT[2],
    }),
    Object.freeze({
      contentId: ROOT_WITH_YOU_PUBLISHED_CONTENT_ID,
      slot: 3,
      kicker: "ROOT WITH YOU",
      lines: Object.freeze(["ROOT陪伴计划", "快速了解你的肠道状态", "并领取5支益生元体验装"]),
      copyMode: "text",
      coverAssetUrl: "/static/campaign/root-with-you-home.jpg",
      assetState: "BUILTIN_FIRST_FRAME",
      action: HOME_BANNER_ACTIONS_BY_SLOT[3],
    }),
  ]),
});

function configuredHomeBannerAction(item = {}) {
  const contentId = String(item.contentId || "").trim();
  if (HOME_BANNER_ACTIONS_BY_CONTENT_ID[contentId]) return HOME_BANNER_ACTIONS_BY_CONTENT_ID[contentId];
  const slot = Number(item.slot || item.order || item.sortOrder || 0);
  if (HOME_BANNER_ACTIONS_BY_SLOT[slot]) return HOME_BANNER_ACTIONS_BY_SLOT[slot];
  if (item.action !== null && item.action !== undefined) return item.action;
  return null;
}

function configuredHomeBannerPresentation(item = {}) {
  const contentId = String(item.contentId || "").trim();
  if (HOME_BANNER_PRESENTATION_BY_CONTENT_ID[contentId]) return HOME_BANNER_PRESENTATION_BY_CONTENT_ID[contentId];
  const slot = Number(item.slot || item.order || item.sortOrder || 0);
  return HOME_BANNER_PRESENTATION_BY_SLOT[slot] || null;
}

function appendConfiguredHomeBanners(items = []) {
  const merged = Array.isArray(items) ? [...items] : [];
  const existing = new Set(merged.map((item) => String(item && item.contentId || "")));
  const existingSlots = new Set(merged.map((item) => Number(item && (item.slot || item.order || item.sortOrder) || 0)));
  LOCAL_HOME_BANNERS.forEach((item) => {
    if (!existing.has(item.contentId) && !existingSlots.has(Number(item.slot))) merged.push(item);
  });
  return merged;
}

module.exports = Object.freeze({
  BUNDLED_HOME_FIRST_FRAME,
  BRAND_FOUNDATION_PATH,
  HOME_BANNER_ACTIONS_BY_CONTENT_ID,
  HOME_BANNER_PRESENTATION_BY_CONTENT_ID,
  HOME_BANNER_PRESENTATION_BY_SLOT,
  HOME_BANNER_ACTIONS_BY_SLOT,
  LOCAL_HOME_BANNERS,
  ROOT_PRODUCTS_CONTENT_ID,
  ROOT_FOUNDATION_CONTENT_ID,
  ROOT_WITH_YOU_CONTENT_ID,
  ROOT_WITH_YOU_PUBLISHED_CONTENT_ID,
  ROOT_WITH_YOU_PATH,
  appendConfiguredHomeBanners,
  configuredHomeBannerAction,
  configuredHomeBannerPresentation,
});
