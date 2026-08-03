const WELCOME_ROUTE = "pages/welcome/index";
const WELCOME_STORAGE_KEY = "ROOT_WELCOME_SEEN_V1";

const FORMAL_TABS = Object.freeze([
  Object.freeze({ pagePath: "pages/home/index", text: "首页" }),
  Object.freeze({ pagePath: "pages/health/index", text: "健康" }),
  Object.freeze({ pagePath: "pages/activities/index", text: "活动" }),
  Object.freeze({ pagePath: "pages/profile/index", text: "我的" }),
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
