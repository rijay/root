const CANARY_ROUTE_KEY = "myroot_canary";
const CANARY_VALUE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
// Keep the online trial's v0.7 data surfaces isolated until the same routes
// are promoted to the default service. Login stays on the stable service, and
// release builds always bypass this value.
const TRIAL_CANDIDATE_ROUTE_VALUE = "v071817c99fchannel069";
const TRIAL_CANDIDATE_PATH_PREFIXES = Object.freeze([
  "/api/v1/channels/",
  "/api/v1/health/",
  "/api/v1/privacy/health-consent",
  "/api/v1/member-commerce/",
  "/api/v1/products",
]);

let canaryRouteValue = "";

function initializeCloudRoute(launchOptions = {}, envVersion = "release") {
  const query = launchOptions && launchOptions.query ? launchOptions.query : {};
  const value = String(query[CANARY_ROUTE_KEY] || "");
  canaryRouteValue = envVersion !== "release" && CANARY_VALUE_PATTERN.test(value) ? value : "";
  return Boolean(canaryRouteValue);
}

function refreshCloudRoute(showOptions = {}, envVersion = "release") {
  if (envVersion === "release") {
    canaryRouteValue = "";
    return false;
  }
  const query = showOptions && showOptions.query ? showOptions.query : {};
  if (!Object.prototype.hasOwnProperty.call(query, CANARY_ROUTE_KEY)) return Boolean(canaryRouteValue);
  const value = String(query[CANARY_ROUTE_KEY] || "");
  canaryRouteValue = CANARY_VALUE_PATTERN.test(value) ? value : "";
  return Boolean(canaryRouteValue);
}

function appendCloudRoute(path, envVersion = "release") {
  const requestPath = String(path || "");
  if (envVersion === "release" || !requestPath) return requestPath;
  if (new RegExp(`(?:^|[?&])${CANARY_ROUTE_KEY}=`).test(requestPath)) return requestPath;
  const routeValue = canaryRouteValue || (
    envVersion === "trial" && TRIAL_CANDIDATE_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix))
      ? TRIAL_CANDIDATE_ROUTE_VALUE
      : ""
  );
  if (!routeValue) return requestPath;
  const delimiter = requestPath.includes("?") ? "&" : "?";
  return `${requestPath}${delimiter}${CANARY_ROUTE_KEY}=${encodeURIComponent(routeValue)}`;
}

function clearCloudRoute() {
  canaryRouteValue = "";
}

module.exports = {
  appendCloudRoute,
  clearCloudRoute,
  initializeCloudRoute,
  refreshCloudRoute,
};
