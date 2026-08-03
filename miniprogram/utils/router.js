const { FORMAL_TABS, REGISTERED_FORMAL_ROUTES } = require("../config/formal-launch-routes");
const { request, getToken } = require("./request");

const stateRoutes = Object.freeze({
  GUEST: "/pages/home/index",
  UNREGISTERED: "/pages/register/index",
  REGISTERED_IDLE: "/pages/home/index",
  CHECKIN_ACTIVE: "/pages/home/index",
  CHECKIN_COMPLETED: "/pages/home/index",
  CHECKIN_FAILED: "/pages/home/index",
  DAILY_USER: "/pages/home/index",
});

const publicRoutes = new Set([
  "/pages/home/index",
  "/pages/activities/index",
  "/pages/login/index",
  "/pages/legal/index",
  "/pages/profile/index",
  "/subpkg/activity/pages/detail/index",
  "/subpkg/profile/pages/about/index",
  "/subpkg/profile/pages/support/index",
]);
const protectedRoutes = new Set([
  "/pages/health/index",
  "/pages/register/index",
  "/pages/health-consent/index",
  "/subpkg/activity/pages/enrollments/index",
]);
const registeredRoutes = new Set(REGISTERED_FORMAL_ROUTES.map((route) => `/${route}`));
const tabRoutes = Object.freeze(FORMAL_TABS.map((tab) => `/${tab.pagePath}`));

function normalize(route) {
  if (!route) return "";
  return route.startsWith("/") ? route : `/${route}`;
}

function assertRegistered(route) {
  const pathOnly = normalize(route).split("?")[0];
  if (!registeredRoutes.has(pathOnly)) {
    const error = new Error("页面暂不可用");
    error.code = "FORMAL_ROUTE_NOT_REGISTERED";
    throw error;
  }
  return pathOnly;
}

function navigate(method, route) {
  const url = normalize(route);
  const pathOnly = assertRegistered(url);
  if (tabRoutes.includes(pathOnly)) {
    wx.switchTab({ url: pathOnly });
    return;
  }
  wx[method]({ url });
}

function go(route) {
  navigate("redirectTo", route);
}

function open(route) {
  navigate("navigateTo", route);
}

async function fetchState() {
  if (!getToken()) return { user: { state: "GUEST" }, route: stateRoutes.GUEST };
  return request({ url: "/api/v1/user/state", method: "GET", scope: "session-state" });
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
  const pathOnly = assertRegistered(route);
  if (publicRoutes.has(pathOnly)) return true;
  if (!protectedRoutes.has(pathOnly)) return false;
  if (!getToken()) {
    open(`/pages/login/index?intent=${encodeURIComponent(pathOnly)}`);
    return false;
  }
  return true;
}

module.exports = {
  assertRegistered,
  decideHomeRoute,
  fetchState,
  go,
  open,
  publicRoutes,
  routeGuard,
  stateRoutes,
  tabRoutes,
};
