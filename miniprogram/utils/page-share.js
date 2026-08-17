const { track } = require("./analytics");

const GENERIC_TITLE = "ROOT｜身体，自有其序";
const GENERIC_PATH = "/pages/home/index";
const PUBLIC_ROUTES = new Set([
  "/pages/home/index",
  "/pages/products/index",
  "/pages/product-detail/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/subpkg/activity/pages/detail/index",
  "/subpkg/profile/pages/about/index",
  "/subpkg/profile/pages/support/index",
  "/pages/legal/index",
]);
const ROUTE_QUERY_KEYS = Object.freeze({
  "/pages/product-detail/index": new Set(["productId"]),
  "/pages/products/index": new Set(["productId"]),
  "/subpkg/activity/pages/detail/index": new Set(["sessionId"]),
  "/pages/legal/index": new Set(["type"]),
});

function normalizeRoute(value) {
  const route = String(value || "").split("?")[0];
  if (!route) return "";
  return route.startsWith("/") ? route : `/${route}`;
}

function safeQueryValue(key, value) {
  const text = String(value || "").trim();
  if (key === "type") return ["agreement", "privacy"].includes(text) ? text : "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : "";
}

function publicPath(route, options = {}) {
  const allowed = ROUTE_QUERY_KEYS[route];
  if (!allowed) return route;
  const query = [...allowed].map((key) => [key, safeQueryValue(key, options[key])])
    .filter(([, value]) => value);
  return query.length
    ? `${route}?${query.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`
    : route;
}

function safeTitle(candidate) {
  const title = String(candidate || "").replace(/[\r\n\t]/g, " ").trim();
  return title ? title.slice(0, 80) : GENERIC_TITLE;
}

function safeImageUrl(candidate) {
  const imageUrl = String(candidate || "").trim();
  if (/^\/static\/[A-Za-z0-9_./-]{1,180}$/.test(imageUrl)) return imageUrl;
  if (/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_?&=./%-]{1,300}$/.test(imageUrl)) return imageUrl;
  return "";
}

function buildShareCard(routeValue, options = {}, candidate = {}) {
  const route = normalizeRoute(routeValue);
  if (!PUBLIC_ROUTES.has(route)) {
    return { title: GENERIC_TITLE, path: GENERIC_PATH, mappingType: "SENSITIVE_TO_HOME" };
  }
  const imageUrl = safeImageUrl(candidate.imageUrl);
  return {
    title: safeTitle(candidate.title),
    path: publicPath(route, options),
    ...(imageUrl ? { imageUrl } : {}),
    mappingType: "PUBLIC_CURRENT_PAGE",
  };
}

function trackShare(route, mappingType) {
  track("page_share", {
    pageType: normalizeRoute(route).slice(0, 96),
    mappingType,
  });
}

function installGlobalSharePolicy(runtime = globalThis) {
  const originalPage = runtime && runtime.Page;
  if (typeof originalPage !== "function" || originalPage.__rootSharePolicyInstalled) return false;
  function RootPage(definition = {}) {
    const originalOnLoad = definition.onLoad;
    const originalShare = definition.onShareAppMessage;
    const wrapped = {
      ...definition,
      onLoad(options = {}) {
        this.__rootShareOptions = { ...options };
        const route = normalizeRoute(this.route);
        if (route !== "/pages/launching/index" && wx.showShareMenu) {
          wx.showShareMenu({ menus: ["shareAppMessage"] });
        } else if (route === "/pages/launching/index" && wx.hideShareMenu) {
          wx.hideShareMenu();
        }
        if (typeof originalOnLoad === "function") return originalOnLoad.call(this, options);
        return undefined;
      },
      onShareAppMessage(event) {
        const route = normalizeRoute(this.route);
        const candidate = typeof originalShare === "function"
          ? originalShare.call(this, event) || {}
          : {};
        const card = buildShareCard(route, this.__rootShareOptions || this.options || {}, candidate);
        trackShare(route, card.mappingType);
        const { mappingType, ...publicCard } = card;
        return publicCard;
      },
    };
    return originalPage(wrapped);
  }
  RootPage.__rootSharePolicyInstalled = true;
  RootPage.__rootOriginalPage = originalPage;
  runtime.Page = RootPage;
  return true;
}

module.exports = {
  GENERIC_PATH,
  GENERIC_TITLE,
  PUBLIC_ROUTES,
  buildShareCard,
  installGlobalSharePolicy,
  normalizeRoute,
  publicPath,
};
