function safeAssetUrl(value) {
  const url = String(value || "").trim();
  return /^(https:\/\/|cloud:\/\/|\/api\/v1\/public\/content\/assets\/)/.test(url) ? url : "";
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

function presentHome(data = {}) {
  if (!Array.isArray(data.items)) return [];
  return data.items.filter((item) => {
    return /^[A-Za-z0-9_-]{3,80}$/.test(String(item.contentId || ""))
      && [2, 3].includes(Array.isArray(item.lines) ? item.lines.length : 0)
      && Boolean(safeAssetUrl(item.coverAssetUrl))
      && String(item.detailPath || "").startsWith("/subpkg/content/pages/detail/index?");
  }).map((item) => ({ ...item, coverAssetUrl: safeAssetUrl(item.coverAssetUrl) }));
}

function presentDetail(data = {}) {
  const item = data.item;
  if (!item || !/^[A-Za-z0-9_-]{3,80}$/.test(String(item.contentId || ""))) return null;
  const assets = (Array.isArray(item.assets) ? item.assets : []).map((asset) => ({
    assetId: String(asset.assetId || ""),
    imageUrl: safeAssetUrl(asset.imageUrl),
    hotspots: (Array.isArray(asset.hotspots) ? asset.hotspots : []).filter((hotspot) => {
      return hotspot && hotspot.action
        && [hotspot.x, hotspot.y, hotspot.width, hotspot.height].every((value) => Number.isFinite(Number(value)));
    }),
  })).filter((asset) => asset.assetId && asset.imageUrl);
  return {
    ...item,
    assets,
    detailImages: (Array.isArray(item.detailImages) ? item.detailImages : []).map(safeAssetUrl).filter(Boolean),
  };
}

module.exports = { presentDetail, presentHome, presentWelcome, safeAssetUrl };
