const { FORMAL_TABS, REGISTERED_FORMAL_ROUTES, WELCOME_ROUTE } = require("../config/formal-launch-routes");
const { setPendingProductFocus } = require("./product-navigation");

const HOME_ROUTE = "/pages/home/index";
const WELCOME_PATH = `/${WELCOME_ROUTE}`;
const REGISTERED_ROUTES = new Set(REGISTERED_FORMAL_ROUTES.map((route) => `/${route}`));
const TAB_ROUTES = new Set(FORMAL_TABS.map((tab) => `/${tab.pagePath}`));
const LAUNCHING_BYPASS_ROUTES = new Set([
  "/pages/login/index",
  "/pages/register/index",
  "/pages/health-consent/index",
  "/pages/channel-error/index",
  "/subpkg/health/pages/assessment/index",
  "/subpkg/health/pages/result/index",
  "/subpkg/health/pages/history/index",
  "/subpkg/health/pages/compare/index",
  "/subpkg/activity/pages/enrollments/index",
  "/subpkg/profile/pages/privacy-account/index",
]);
const QUERY_KEYS = Object.freeze({
  "/pages/products/index": ["productId", "product_id", "source"],
  "/pages/product-detail/index": ["productId", "product_id", "source"],
  "/pages/login/index": ["intent"],
  "/pages/register/index": ["mode", "intent"],
  "/pages/legal/index": ["type"],
  "/pages/health-consent/index": ["mode"],
  "/pages/channel-error/index": ["reason"],
  "/subpkg/campaign/pages/root-with-you/index": ["q"],
  "/subpkg/content/pages/detail/index": ["contentId"],
  "/subpkg/health/pages/assessment/index": ["assessmentType", "assessment_type", "assessmentId", "assessment_id"],
  "/subpkg/health/pages/result/index": ["assessmentId", "assessment_id"],
  "/subpkg/health/pages/history/index": ["assessmentType", "assessment_type"],
  "/subpkg/health/pages/compare/index": ["leftAssessmentId", "rightAssessmentId"],
  "/subpkg/activity/pages/detail/index": ["sessionId", "activityId", "source"],
  "/subpkg/profile/pages/support/index": ["type"],
});

function normalizeRoute(value) {
  const route = String(value || "").split("?")[0].trim();
  if (!route) return "";
  return route.startsWith("/") ? route : `/${route}`;
}

function safeValue(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text || text.length > 240 || /[\r\n\t]/.test(text)) return "";
  return text;
}

function sanitizeOptions(route, source = {}) {
  const keys = QUERY_KEYS[route] || [];
  return keys.reduce((result, key) => {
    const value = safeValue(source[key]);
    if (!value) return result;
    if (key === "q") {
      const normalized = value.toUpperCase();
      if (/^[A-Z0-9]{4,16}$/.test(normalized)) result[key] = normalized;
      return result;
    }
    result[key] = value;
    return result;
  }, {});
}

function serializeTarget(target = {}) {
  const route = normalizeRoute(target.route);
  const options = sanitizeOptions(route, target.options || {});
  const query = Object.entries(options)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${route}?${query}` : route;
}

function resolveEntryTarget(showOptions = {}, pages = []) {
  const current = pages.length ? pages[pages.length - 1] : null;
  const pageRoute = normalizeRoute(current && current.route);
  const optionRoute = normalizeRoute(showOptions.path);
  const forceOptionRoute = showOptions.__rootChannelEntry === true;
  const route = forceOptionRoute && optionRoute && optionRoute !== WELCOME_PATH
    ? optionRoute
    : pageRoute && pageRoute !== WELCOME_PATH
    ? pageRoute
    : optionRoute && optionRoute !== WELCOME_PATH
      ? optionRoute
      : HOME_ROUTE;
  const registeredRoute = REGISTERED_ROUTES.has(route) && route !== WELCOME_PATH ? route : HOME_ROUTE;
  const sourceOptions = pageRoute === registeredRoute
    ? (current && (current.options || current.__rootShareOptions)) || {}
    : showOptions.query || {};
  return {
    route: registeredRoute,
    options: sanitizeOptions(registeredRoute, sourceOptions),
  };
}

function prepareLaunchingEntry(app, showOptions = {}, pages = []) {
  const currentRoute = normalizeRoute(pages.length && pages[pages.length - 1].route);
  const target = resolveEntryTarget(showOptions, pages);
  const state = app && app.globalData;
  if (state && state.launchingHandledThisSession) {
    return {
      relaunch: false,
      navigateDirect: false,
      target: state.launchingTarget || target,
      reason: "SESSION_ALREADY_HANDLED",
    };
  }

  const targetRoute = normalizeRoute(target.route);
  const bypass = LAUNCHING_BYPASS_ROUTES.has(currentRoute) || LAUNCHING_BYPASS_ROUTES.has(targetRoute);
  if (state) state.launchingHandledThisSession = true;
  if (bypass) {
    return {
      relaunch: false,
      navigateDirect: currentRoute === WELCOME_PATH && targetRoute !== WELCOME_PATH,
      target,
      reason: "PROTECTED_ROUTE_BYPASS",
    };
  }

  if (state) state.launchingTarget = target;
  return {
    relaunch: currentRoute !== WELCOME_PATH,
    navigateDirect: false,
    target,
    reason: currentRoute === WELCOME_PATH ? "LAUNCHING_ALREADY_VISIBLE" : "FIRST_SESSION_ENTRY",
  };
}

function consumeLaunchingTarget(app) {
  const target = app && app.globalData && app.globalData.launchingTarget;
  if (app && app.globalData) delete app.globalData.launchingTarget;
  return target && REGISTERED_ROUTES.has(normalizeRoute(target.route))
    ? { route: normalizeRoute(target.route), options: sanitizeOptions(normalizeRoute(target.route), target.options || {}) }
    : { route: HOME_ROUTE, options: {} };
}

function navigateToLaunchingTarget(target = {}) {
  const route = normalizeRoute(target.route) || HOME_ROUTE;
  const options = sanitizeOptions(route, target.options || {});
  if (route === "/pages/products/index") {
    setPendingProductFocus(options.productId || options.product_id || "", options.source || "launching_restore");
  }
  if (TAB_ROUTES.has(route)) {
    wx.switchTab({ url: route, fail: () => wx.switchTab({ url: HOME_ROUTE }) });
    return;
  }
  wx.redirectTo({ url: serializeTarget({ route, options }), fail: () => wx.switchTab({ url: HOME_ROUTE }) });
}

module.exports = Object.freeze({
  HOME_ROUTE,
  LAUNCHING_BYPASS_ROUTES,
  consumeLaunchingTarget,
  navigateToLaunchingTarget,
  normalizeRoute,
  prepareLaunchingEntry,
  resolveEntryTarget,
  sanitizeOptions,
  serializeTarget,
});
