const CANARY_ROUTE_KEY = "myroot_canary";
const CANARY_VALUE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

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
  if (envVersion === "release" || !canaryRouteValue || !requestPath) return requestPath;
  if (new RegExp(`(?:^|[?&])${CANARY_ROUTE_KEY}=`).test(requestPath)) return requestPath;
  const delimiter = requestPath.includes("?") ? "&" : "?";
  return `${requestPath}${delimiter}${CANARY_ROUTE_KEY}=${encodeURIComponent(canaryRouteValue)}`;
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
