const {
  BUNDLED_HOME_FIRST_FRAME,
  appendConfiguredHomeBanners,
  configuredHomeBannerAction,
  configuredHomeBannerPresentation,
} = require("../config/home-banner-actions");

function safeAssetUrl(value) {
  const url = String(value || "").trim();
  return /^(https:\/\/|cloud:\/\/|\/api\/v1\/public\/content\/assets\/)/.test(url) ? url : "";
}

function safeHomeAssetUrl(value) {
  const remote = safeAssetUrl(value);
  if (remote) return remote;
  const url = String(value || "").trim();
  return /^\/static\/[A-Za-z0-9_./-]{1,180}\.(?:jpe?g|png|webp)$/.test(url) ? url : "";
}

function presentWelcome(data = {}) {
  if (!Array.isArray(data.screens) || data.screens.length !== 2) return null;
  const screens = data.screens
    .map((screen) => ({
      slot: Number(screen.slot),
      copy: String(screen.copy || "").trim(),
      assetUrl: safeAssetUrl(screen.assetUrl),
      assetState: "AUTHORIZED",
    }))
    .sort((left, right) => left.slot - right.slot);
  return screens.every((screen, index) => screen.slot === index + 1 && screen.copy && screen.assetUrl) ? screens : null;
}

function presentHomeAction(item = {}) {
  if (!item.action) {
    const detailPath = String(item.detailPath || "").trim();
    return detailPath.startsWith("/subpkg/content/pages/detail/index?")
      ? { type: "MINIPROGRAM_PAGE", path: detailPath }
      : null;
  }
  if (item.action.type === "PRODUCTS") {
    const productId = String(item.action.productId || "").trim();
    if (productId && !/^\d{6,24}$/.test(productId)) return null;
    return { type: "PRODUCTS", productId, source: "home_banner" };
  }
  if (item.action.type === "MINIPROGRAM_PAGE") {
    const path = String(item.action.path || "").trim();
    if (!path.startsWith("/") || /(?:token|answers|openid|unionid)=/i.test(path)) return null;
    return { type: "MINIPROGRAM_PAGE", path };
  }
  return null;
}

function presentHome(data = {}) {
  const backendItems = (Array.isArray(data.items) ? data.items : []).map((item, index, items) => {
    if (items.length >= 3 && index === 2 && !Number(item && (item.slot || item.order || item.sortOrder))) {
      return { ...item, slot: 3 };
    }
    return item;
  });
  const items = appendConfiguredHomeBanners(backendItems);
  return items.map((item) => {
    const configuredAction = configuredHomeBannerAction(item);
    const presentation = configuredHomeBannerPresentation(item);
    const source = {
      ...item,
      ...(presentation || {}),
      ...(configuredAction ? { action: configuredAction } : {}),
    };
    return { source, action: presentHomeAction(source) };
  }).filter(({ source, action }) => {
    const lineCount = Array.isArray(source.lines) ? source.lines.length : 0;
    const textCopyValid = [2, 3].includes(lineCount)
      || (source.copyVariant === "foundation-single" && lineCount === 1);
    const assetCopyValid = source.copyMode === "asset" && Array.isArray(source.lines) && source.lines.length === 0;
    return /^[A-Za-z0-9_-]{3,80}$/.test(String(source.contentId || ""))
      && (textCopyValid || assetCopyValid)
      && Boolean(safeHomeAssetUrl(source.coverAssetUrl))
      && Boolean(action);
  }).map(({ source, action }) => ({
    ...source,
    coverAssetUrl: safeHomeAssetUrl(source.coverAssetUrl),
    action,
  }));
}

function initialHome() {
  return presentHome(BUNDLED_HOME_FIRST_FRAME);
}

function presentDetail(data = {}) {
  const item = data.item;
  if (!item || !/^[A-Za-z0-9_-]{3,80}$/.test(String(item.contentId || ""))) return null;
  const assets = (Array.isArray(item.assets) ? item.assets : []).map((asset) => {
    const width = Number(asset.width);
    const height = Number(asset.height);
    const dimensionsValid = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
    const displayHeightRpx = dimensionsValid ? Math.round(750 * height / width) : 0;
    return {
      assetId: String(asset.assetId || ""),
      imageUrl: safeAssetUrl(asset.imageUrl),
      width: dimensionsValid ? width : 0,
      height: dimensionsValid ? height : 0,
      displayHeightRpx,
      displayStyle: displayHeightRpx ? `height: ${displayHeightRpx}rpx;` : "",
      displayMode: displayHeightRpx ? "aspectFill" : "widthFix",
      hotspots: (Array.isArray(asset.hotspots) ? asset.hotspots : []).filter((hotspot) => {
        return hotspot && hotspot.action
          && [hotspot.x, hotspot.y, hotspot.width, hotspot.height].every((value) => Number.isFinite(Number(value)));
      }),
    };
  }).filter((asset) => asset.assetId && asset.imageUrl);
  return {
    ...item,
    assets,
    detailImages: (Array.isArray(item.detailImages) ? item.detailImages : []).map(safeAssetUrl).filter(Boolean),
  };
}

module.exports = { initialHome, presentDetail, presentHome, presentHomeAction, presentWelcome, safeAssetUrl, safeHomeAssetUrl };
