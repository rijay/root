const WELCOME_ROUTE = "pages/welcome/index";
const WELCOME_STORAGE_KEY = "ROOT_WELCOME_SEEN_V1";

const FORMAL_TABS = Object.freeze([
  Object.freeze({ pagePath: "pages/home/index", text: "首页", icon: "/static/icons/tab-home.svg", activeIcon: "/static/icons/tab-home-active.svg" }),
  Object.freeze({ pagePath: "pages/health/index", text: "健康", icon: "/static/icons/tab-health.svg", activeIcon: "/static/icons/tab-health-active.svg" }),
  Object.freeze({ pagePath: "pages/activities/index", text: "活动", icon: "/static/icons/tab-activity.svg", activeIcon: "/static/icons/tab-activity-active.svg" }),
  Object.freeze({ pagePath: "pages/profile/index", text: "我的", icon: "/static/icons/tab-profile.svg", activeIcon: "/static/icons/tab-profile-active.svg" }),
]);

const MAIN_ROUTES = Object.freeze([
  WELCOME_ROUTE,
  ...FORMAL_TABS.map((tab) => tab.pagePath),
  "pages/login/index",
  "pages/register/index",
  "pages/legal/index",
  "pages/health-consent/index",
]);

const SUBPACKAGE_ROUTES = Object.freeze([
  "subpkg/content/pages/detail/index",
  "subpkg/health/pages/initial-assessment/index",
  "subpkg/activity/pages/detail/index",
  "subpkg/activity/pages/enrollments/index",
  "subpkg/profile/pages/about/index",
  "subpkg/profile/pages/support/index",
  "subpkg/profile/pages/privacy-account/index",
]);

const REGISTERED_FORMAL_ROUTES = Object.freeze([...MAIN_ROUTES, ...SUBPACKAGE_ROUTES]);

const FORBIDDEN_ROUTE_PREFIXES = Object.freeze([
  "pages/activity",
  "pages/order",
  "pages/product-detail",
  "pages/products",
  "pages/rewards",
  "pages/tasks",
  "subpkg/checkin",
  "subpkg/refund",
  "subpkg/task",
  "subpkg/profile/pages/orders",
  "subpkg/profile/pages/review",
  "subpkg/profile/pages/tags",
]);

module.exports = {
  FORBIDDEN_ROUTE_PREFIXES,
  FORMAL_TABS,
  MAIN_ROUTES,
  REGISTERED_FORMAL_ROUTES,
  SUBPACKAGE_ROUTES,
  WELCOME_ROUTE,
  WELCOME_STORAGE_KEY,
};
