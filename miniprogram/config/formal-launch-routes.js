const WELCOME_ROUTE = "pages/welcome/index";
const WELCOME_STORAGE_KEY = "ROOT_WELCOME_SEEN_V1";

const FORMAL_TABS = Object.freeze([
  Object.freeze({ pagePath: "pages/home/index", text: "首页", icon: "/static/icons/tab-home.svg", activeIcon: "/static/icons/tab-home-active.svg" }),
  Object.freeze({ pagePath: "pages/products/index", text: "产品", icon: "/static/icons/tab-product.svg", activeIcon: "/static/icons/tab-product-active.svg" }),
  Object.freeze({ pagePath: "pages/health/index", text: "健康", icon: "/static/icons/tab-health.svg", activeIcon: "/static/icons/tab-health-active.svg" }),
  Object.freeze({ pagePath: "pages/activities/index", text: "活动", icon: "/static/icons/tab-activity.svg", activeIcon: "/static/icons/tab-activity-active.svg" }),
  Object.freeze({ pagePath: "pages/profile/index", text: "我的", icon: "/static/icons/tab-profile.svg", activeIcon: "/static/icons/tab-profile-active.svg" }),
]);

const MAIN_ROUTES = Object.freeze([
  WELCOME_ROUTE,
  ...FORMAL_TABS.map((tab) => tab.pagePath),
  "pages/login/index",
  "pages/register/index",
  "pages/product-detail/index",
  "pages/legal/index",
  "pages/health-consent/index",
  "pages/channel-error/index",
]);

const SUBPACKAGE_ROUTES = Object.freeze([
  "subpkg/content/pages/brand-foundation/index",
  "subpkg/content/pages/phgg-reference/index",
  "subpkg/content/pages/detail/index",
  "subpkg/content/pages/webview/index",
  "subpkg/campaign/pages/root-with-you/index",
  "subpkg/health/pages/assessment/index",
  "subpkg/health/pages/result/index",
  "subpkg/health/pages/history/index",
  "subpkg/health/pages/compare/index",
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
