const TAB_ROUTES = new Set([
  "/pages/home/index",
  "/pages/products/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/pages/profile/index",
]);

function routeFromLaunchOptions(options = {}) {
  const path = String(options.path || "pages/home/index").split("?")[0];
  const route = path.startsWith("/") ? path : `/${path}`;
  const query = options.query && typeof options.query === "object" ? options.query : {};
  const excludedKeys = new Set([
    "channelId", "channel_id", "cid", "campaignId", "campaign_id", "campaign", "camp",
    "targetPage", "target_page", "target", "expiresAt", "expires_at", "exp",
    "keyId", "key_id", "kid", "signature", "sig", "scene", "token", "openid", "unionid",
  ]);
  const pairs = Object.entries(query)
    .filter(([key, value]) => !excludedKeys.has(key)
      && /^[A-Za-z0-9_]{1,48}$/.test(key)
      && /^[A-Za-z0-9_-]{1,80}$/.test(String(value || "")))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `${route}?${pairs.join("&")}` : route;
}

function pathOnly(route) {
  const path = String(route || "").split("?")[0];
  return path && !path.startsWith("/") ? `/${path}` : path;
}

function openEntryTarget(route, fallback = "/pages/home/index") {
  const target = String(route || fallback);
  const pathname = pathOnly(target);
  if (TAB_ROUTES.has(pathname)) {
    if (pathname === "/pages/products/index") {
      const match = target.match(/[?&]productId=([A-Za-z0-9_-]{1,64})/);
      if (match) require("./product-navigation").setPendingProductFocus(match[1], "channel_entry");
    }
    wx.switchTab({ url: pathname });
    return "SWITCH_TAB";
  }
  wx.redirectTo({ url: target });
  return "REDIRECT";
}

module.exports = {
  TAB_ROUTES,
  openEntryTarget,
  pathOnly,
  routeFromLaunchOptions,
};
