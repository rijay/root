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
  "/subpkg/content/pages/brand-foundation/index",
  "/subpkg/content/pages/phgg-reference/index",
  "/subpkg/content/pages/detail/index",
  "/subpkg/campaign/pages/root-with-you/index",
  "/subpkg/health/pages/assessment/index",
  "/subpkg/profile/pages/about/index",
  "/subpkg/profile/pages/support/index",
  "/pages/legal/index",
]);
const ROUTE_QUERY_KEYS = Object.freeze({
  "/pages/product-detail/index": new Set(["productId"]),
  "/pages/products/index": new Set(["productId"]),
  "/subpkg/content/pages/detail/index": new Set(["contentId"]),
  "/subpkg/activity/pages/detail/index": new Set(["sessionId"]),
  "/subpkg/health/pages/assessment/index": new Set(["assessmentType"]),
  "/pages/legal/index": new Set(["type"]),
});
const ROUTE_SHARE_TARGETS = Object.freeze({
  "/subpkg/campaign/pages/root-with-you/index": Object.freeze({
    route: "/subpkg/health/pages/assessment/index",
    options: Object.freeze({ assessmentType: "GUT_REGULARITY" }),
  }),
});

function normalizeRoute(value) {
  const route = String(value || "").split("?")[0];
  if (!route) return "";
  return route.startsWith("/") ? route : `/${route}`;
}

function safeQueryValue(key, value) {
  const text = String(value || "").trim();
  if (key === "type") return ["agreement", "privacy"].includes(text) ? text : "";
  if (key === "assessmentType") return text === "GUT_REGULARITY" ? text : "";
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
  if (/^\/subpkg\/[A-Za-z0-9_./-]{1,220}\.(?:jpe?g|png|webp)$/.test(imageUrl)) return imageUrl;
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

function showShareMenu(menus) {
  if (typeof wx === "undefined" || typeof wx.showShareMenu !== "function") return false;
  const page = typeof getCurrentPages === "function" ? getCurrentPages().slice(-1)[0] : null;
  const pageType = normalizeRoute(page && page.route) || "UNKNOWN";
  wx.showShareMenu({
    withShareTicket: false,
    menus,
    success() {
      track("share_menu_setup", { pageType, result: "SUCCESS", failureReason: "" });
    },
    fail(error) {
      const errorText = String(error && error.errMsg || "");
      track("share_menu_setup", {
        pageType,
        result: "FAILED",
        failureReason: errorText.includes("auth deny") ? "AUTH_DENIED" : "SHOW_SHARE_MENU_FAILED",
      });
    },
  });
  return true;
}

function showFriendShareMenu() {
  return showShareMenu(["shareAppMessage"]);
}

function showTimelineShareMenu() {
  return showShareMenu(["shareAppMessage", "shareTimeline"]);
}

function pageShareResponse(page, candidate = {}) {
  const route = normalizeRoute(page && page.route);
  const configuredTarget = ROUTE_SHARE_TARGETS[route];
  const targetRoute = configuredTarget ? configuredTarget.route : route;
  const options = configuredTarget
    ? configuredTarget.options
    : page && (page.__rootShareOptions || page.options) || {};
  const card = buildShareCard(targetRoute, options, candidate);
  trackShare(route, card.mappingType);
  const { mappingType, ...publicCard } = card;
  return publicCard;
}

function defaultOnShareAppMessage() {
  return pageShareResponse(this);
}

function installGlobalSharePolicy(runtime = globalThis) {
  const originalPage = runtime && runtime.Page;
  if (typeof originalPage !== "function" || originalPage.__rootSharePolicyInstalled) return false;
  function RootPage(definition = {}) {
    const originalOnLoad = definition.onLoad;
    const originalOnShow = definition.onShow;
    const originalShare = definition.onShareAppMessage;
    const originalTimelineShare = definition.onShareTimeline;
    function syncShareMenu(page) {
      const route = normalizeRoute(page && page.route);
      if (route !== "/pages/welcome/index") {
        if (typeof originalTimelineShare === "function") showTimelineShareMenu();
        else showFriendShareMenu();
      } else if (wx.hideShareMenu) {
        wx.hideShareMenu();
      }
    }
    const wrapped = {
      ...definition,
      onLoad(options = {}) {
        this.__rootShareOptions = { ...options };
        const result = typeof originalOnLoad === "function" ? originalOnLoad.call(this, options) : undefined;
        syncShareMenu(this);
        return result;
      },
      onShow(...args) {
        const result = typeof originalOnShow === "function" ? originalOnShow.apply(this, args) : undefined;
        syncShareMenu(this);
        return result;
      },
      onShareAppMessage(event) {
        const candidate = typeof originalShare === "function" && originalShare !== defaultOnShareAppMessage
          ? originalShare.call(this, event) || {}
          : {};
        return pageShareResponse(this, candidate);
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
  ROUTE_SHARE_TARGETS,
  buildShareCard,
  defaultOnShareAppMessage,
  installGlobalSharePolicy,
  normalizeRoute,
  publicPath,
  showFriendShareMenu,
  showTimelineShareMenu,
};
