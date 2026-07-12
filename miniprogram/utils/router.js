const { request, getToken } = require("./request");

const stateRoutes = {
  GUEST: "/pages/home/index",
  UNREGISTERED: "/pages/register/index",
  REGISTERED_IDLE: "/pages/home/index",
  CHECKIN_ACTIVE: "/pages/home/index",
  CHECKIN_COMPLETED: "/pages/home/index",
  CHECKIN_FAILED: "/pages/home/index",
  DAILY_USER: "/pages/home/index",
};

const routePermissions = {
  "/pages/home/index": ["GUEST", "UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/pages/login/index": ["GUEST"],
  "/pages/register/index": ["UNREGISTERED"],
  "/pages/health-consent/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/pages/activity/index": ["REGISTERED_IDLE"],
  "/pages/order/match": ["REGISTERED_IDLE"],
  "/pages/products/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/pages/product-detail/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/pages/tasks/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/pages/rewards/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/task/pages/checkin/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE"],
  "/subpkg/task/pages/questionnaire/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/task/pages/progress/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/checkin/pages/today/index": ["CHECKIN_ACTIVE"],
  "/subpkg/checkin/pages/history/index": ["CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/checkin/pages/result/index": ["CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/checkin/pages/share-poster/index": ["CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "DAILY_USER"],
  "/subpkg/checkin/pages/questionnaire/index": ["CHECKIN_ACTIVE", "CHECKIN_COMPLETED"],
  "/subpkg/refund/pages/apply/index": ["CHECKIN_COMPLETED"],
  "/subpkg/refund/pages/status/index": ["CHECKIN_COMPLETED", "DAILY_USER"],
  "/subpkg/profile/pages/tags/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/profile/pages/orders/index": ["REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/profile/pages/review/index": ["REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/profile/pages/about/index": ["GUEST", "UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/subpkg/profile/pages/support/index": ["GUEST", "UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
  "/pages/profile/index": ["UNREGISTERED", "REGISTERED_IDLE", "CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED", "DAILY_USER"],
};

const tabRoutes = ["/pages/home/index", "/pages/products/index", "/pages/tasks/index", "/pages/rewards/index"];

function normalize(route) {
  if (!route) return "";
  return route.startsWith("/") ? route : `/${route}`;
}

function go(route) {
  const url = normalize(route);
  if (tabRoutes.includes(url)) {
    wx.switchTab({ url });
    return;
  }
  wx.redirectTo({ url });
}

async function fetchState() {
  if (!getToken()) {
    return { user: { state: "GUEST" }, route: stateRoutes.GUEST };
  }
  return request({ url: "/api/v1/user/state" });
}

async function decideHomeRoute() {
  try {
    const state = await fetchState();
    go(state.route || stateRoutes[state.user.state] || stateRoutes.GUEST);
    return state;
  } catch (error) {
    go(stateRoutes.GUEST);
    return { user: { state: "GUEST" }, route: stateRoutes.GUEST };
  }
}

async function routeGuard(route) {
  const currentRoute = normalize(route);
  try {
    const state = await fetchState();
    const userState = state.user.state;
    const allowed = routePermissions[currentRoute] || [];
    if (!allowed.includes(userState)) {
      go(state.route || stateRoutes[userState] || stateRoutes.GUEST);
      return false;
    }
    return true;
  } catch (error) {
    if (currentRoute !== stateRoutes.GUEST) go(stateRoutes.GUEST);
    return currentRoute === stateRoutes.GUEST;
  }
}

module.exports = {
  decideHomeRoute,
  fetchState,
  go,
  routeGuard,
  routePermissions,
  stateRoutes,
};
