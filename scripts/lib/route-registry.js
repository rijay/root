const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FIELD_NAMES = Object.freeze([
  "routeId",
  "canonicalPath",
  "pageOwnerModule",
  "resourceOwnerModules",
  "isTab",
  "accessRule",
  "parameterAllowlist",
  "fallbackRouteId",
  "legacyFallbackRouteId",
  "legacyAdapter",
  "minAppVersion",
  "introducedVersion",
  "deprecatedAfter",
  "uedScreenId",
  "acceptanceCriteriaIds",
]);

const CORE_FIELD_NAMES = Object.freeze([
  "routeId",
  "canonicalPath",
  "pageOwnerModule",
  "resourceOwnerModules",
  "isTab",
  "accessRule",
  "parameterAllowlist",
  "fallbackRouteId",
  "uedScreenId",
  "acceptanceCriteriaIds",
  "class",
]);

const CLASS_DEFAULT_FIELD_NAMES = Object.freeze([
  "legacyAdapter",
  "minAppVersion",
  "introducedVersion",
  "deprecatedAfter",
]);

const EXPECTED_CLASSES = Object.freeze(["LEGACY_REDIRECT", "LEGACY_STABLE", "V1_NATIVE"]);
const EXPECTED_ROUTE_COUNT = 47;
const FROZEN_LEGACY_MANIFEST_PATH = path.resolve(__dirname, "../../miniprogram/fixtures/miniprogram-app-v0.5.13.json");
const FROZEN_LEGACY_MANIFEST_SHA256 = "b11bf61066a175ae1975d0ca1f206f7b470b16893794480564a0da2f50aea2de";
const EXPECTED_V1_TAB_PATHS = Object.freeze([
  "/pages/home/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/pages/tasks/index",
  "/pages/profile/index",
]);
const EXPECTED_V1_TAB_TEXT = Object.freeze(["首页", "健康", "活动", "任务", "我的"]);
const REQUIRED_LOCAL_SHELL_ROUTE_IDS = Object.freeze([
  "HOME",
  "HEALTH_HOME",
  "ACTIVITY_LIST",
  "ACTIVITY_DETAIL",
  "MY_ENROLLMENTS",
  "TASK_CENTER",
  "PROFILE",
]);
const UNSAFE_PARAMETER_NAMES = new Set([
  "url",
  "path",
  "returnUrl",
  "redirect",
  "redirectUrl",
  "targetUrl",
  "nextUrl",
]);

function invalid(message) {
  throw new Error(`Route Registry invalid: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) invalid(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    invalid(`${label} fields must be exactly ${expected.join(", ")}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} must be a non-empty string`);
}

function assertUniqueStringArray(value, label, options = {}) {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  if (options.nonEmpty && value.length === 0) invalid(`${label} must not be empty`);
  const seen = new Set();
  value.forEach((item) => {
    assertNonEmptyString(item, `${label} item`);
    if (seen.has(item)) invalid(`${label} contains duplicate value ${item}`);
    if (options.pattern && !options.pattern.test(item)) invalid(`${label} contains invalid value ${item}`);
    if (options.reject && options.reject.has(item)) invalid(`${label} contains unsafe name ${item}`);
    seen.add(item);
  });
}

function normalizeMiniProgramPath(value) {
  return value.startsWith("/") ? value : `/${value}`;
}

function registeredPathsFromAppJson(appJson) {
  if (!isPlainObject(appJson) || !Array.isArray(appJson.pages)) invalid("appJson.pages must be an array");
  const paths = [
    ...appJson.pages,
    ...(Array.isArray(appJson.subPackages)
      ? appJson.subPackages.flatMap((pkg) => {
        if (!isPlainObject(pkg) || typeof pkg.root !== "string" || !Array.isArray(pkg.pages)) {
          invalid("appJson.subPackages entries require root and pages");
        }
        return pkg.pages.map((page) => `${pkg.root}/${page}`);
      })
      : []),
  ].map(normalizeMiniProgramPath).sort();
  assertUniqueStringArray(paths, "appJson registered paths", { nonEmpty: true });
  return paths;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function validateLegacyClient(legacyClient, appJson) {
  assertExactKeys(
    legacyClient,
    ["version", "appJsonPath", "registeredPathDigest", "registeredPaths"],
    "legacyClient",
  );
  assertNonEmptyString(legacyClient.version, "legacyClient.version");
  assertNonEmptyString(legacyClient.appJsonPath, "legacyClient.appJsonPath");
  if (!/^[a-f0-9]{64}$/.test(legacyClient.registeredPathDigest)) {
    invalid("legacyClient.registeredPathDigest must be a SHA-256 digest");
  }
  assertUniqueStringArray(legacyClient.registeredPaths, "legacyClient.registeredPaths", { nonEmpty: true });
  const sortedPaths = [...legacyClient.registeredPaths].sort();
  if (JSON.stringify(sortedPaths) !== JSON.stringify(legacyClient.registeredPaths)) {
    invalid("legacyClient.registeredPaths must be sorted");
  }
  const declaredDigest = sha256(JSON.stringify(legacyClient.registeredPaths));
  if (declaredDigest !== legacyClient.registeredPathDigest) {
    invalid("legacy registeredPathDigest does not match registeredPaths");
  }
  const actualPaths = registeredPathsFromAppJson(appJson);
  if (JSON.stringify(actualPaths) !== JSON.stringify(legacyClient.registeredPaths)) {
    invalid(`frozen legacy manifest paths do not match client ${legacyClient.version}`);
  }
  return actualPaths;
}

function validateCurrentV1Manifest(appJson, routeMap, legacyClient) {
  if (!isPlainObject(appJson)) invalid("currentV1Manifest must be an object");
  const currentPaths = registeredPathsFromAppJson(appJson);
  const currentPathSet = new Set(currentPaths);
  legacyClient.registeredPaths.forEach((registeredPath) => {
    if (!currentPathSet.has(registeredPath)) {
      invalid(`currentV1Manifest removed frozen legacy path ${registeredPath}`);
    }
  });

  const tabList = appJson.tabBar && Array.isArray(appJson.tabBar.list) ? appJson.tabBar.list : [];
  const tabPaths = tabList.map((item) => normalizeMiniProgramPath(String(item && item.pagePath || "")));
  const tabText = tabList.map((item) => String(item && item.text || ""));
  if (JSON.stringify(tabPaths) !== JSON.stringify(EXPECTED_V1_TAB_PATHS)) {
    invalid(`currentV1Manifest tabs must be ${EXPECTED_V1_TAB_PATHS.join(", ")}`);
  }
  if (JSON.stringify(tabText) !== JSON.stringify(EXPECTED_V1_TAB_TEXT)) {
    invalid(`currentV1Manifest tab text must be ${EXPECTED_V1_TAB_TEXT.join(", ")}`);
  }
  if (!appJson.window || appJson.window.navigationBarTitleText !== "myRoot") {
    invalid("currentV1Manifest global title must be myRoot");
  }

  REQUIRED_LOCAL_SHELL_ROUTE_IDS.forEach((routeId) => {
    const route = routeMap.get(routeId);
    if (!route || !currentPathSet.has(route.canonicalPath)) {
      invalid(`currentV1Manifest missing local shell route ${routeId}`);
    }
  });

  return {
    manifestStatus: "PARTIAL_LOCAL_SHELL_NOT_CANDIDATE",
    registeredPaths: currentPaths,
    tabPaths,
  };
}

function validateClassDefaults(classDefaults) {
  if (!isPlainObject(classDefaults)) invalid("classDefaults must be an object");
  const actualClasses = Object.keys(classDefaults).sort();
  if (JSON.stringify(actualClasses) !== JSON.stringify([...EXPECTED_CLASSES].sort())) {
    invalid(`classDefaults must define exactly ${EXPECTED_CLASSES.join(", ")}`);
  }
  EXPECTED_CLASSES.forEach((className) => {
    const defaults = classDefaults[className];
    assertExactKeys(defaults, CLASS_DEFAULT_FIELD_NAMES, `classDefaults.${className}`);
    assertNonEmptyString(defaults.legacyAdapter, `classDefaults.${className}.legacyAdapter`);
    assertNonEmptyString(defaults.minAppVersion, `classDefaults.${className}.minAppVersion`);
    assertNonEmptyString(defaults.introducedVersion, `classDefaults.${className}.introducedVersion`);
    if (defaults.deprecatedAfter !== null) {
      assertNonEmptyString(defaults.deprecatedAfter, `classDefaults.${className}.deprecatedAfter`);
    }
  });
}

function validateCoreRoutes(routes, classDefaults) {
  if (!Array.isArray(routes)) invalid("routes must be an array");
  if (routes.length !== EXPECTED_ROUTE_COUNT) {
    invalid(`routes must contain exactly ${EXPECTED_ROUTE_COUNT} records, got ${routes.length}`);
  }
  const routeMap = new Map();
  routes.forEach((route, index) => {
    assertExactKeys(route, CORE_FIELD_NAMES, `routes[${index}]`);
    assertNonEmptyString(route.routeId, `routes[${index}].routeId`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(route.routeId)) invalid(`${route.routeId} routeId is invalid`);
    if (routeMap.has(route.routeId)) invalid(`duplicate routeId ${route.routeId}`);
    if (!Object.prototype.hasOwnProperty.call(classDefaults, route.class)) {
      invalid(`${route.routeId} references unknown class ${route.class}`);
    }
    if (typeof route.canonicalPath !== "string" || !/^\/[A-Za-z0-9_./-]+$/.test(route.canonicalPath)) {
      invalid(`${route.routeId} canonicalPath must be a query-free mini-program path`);
    }
    assertNonEmptyString(route.pageOwnerModule, `${route.routeId} pageOwnerModule`);
    if (!/ Module$/.test(route.pageOwnerModule)) invalid(`${route.routeId} pageOwnerModule must identify a Module`);
    assertUniqueStringArray(route.resourceOwnerModules, `${route.routeId} resourceOwnerModules`);
    route.resourceOwnerModules.forEach((owner) => {
      if (!/ Module$/.test(owner)) invalid(`${route.routeId} resource owner ${owner} must identify a Module`);
    });
    if (typeof route.isTab !== "boolean") invalid(`${route.routeId} isTab must be boolean`);
    if (typeof route.accessRule !== "string" || !/^[A-Z][A-Z0-9_]*(\+[A-Z][A-Z0-9_]*)*$/.test(route.accessRule)) {
      invalid(`${route.routeId} accessRule is invalid`);
    }
    assertUniqueStringArray(route.parameterAllowlist, `${route.routeId} parameterAllowlist`, {
      pattern: /^[A-Za-z][A-Za-z0-9]*$/,
      reject: UNSAFE_PARAMETER_NAMES,
    });
    assertNonEmptyString(route.fallbackRouteId, `${route.routeId} fallbackRouteId`);
    assertNonEmptyString(route.uedScreenId, `${route.routeId} uedScreenId`);
    assertUniqueStringArray(route.acceptanceCriteriaIds, `${route.routeId} acceptanceCriteriaIds`, { nonEmpty: true });
    routeMap.set(route.routeId, route);
  });
  return routeMap;
}

function validateFallbackGraph(routeMap) {
  routeMap.forEach((route) => {
    const target = route.fallbackRouteId;
    if (target !== "SELF" && !routeMap.has(target)) {
      invalid(`${route.routeId} fallbackRouteId references unknown route ${target}`);
    }
  });

  routeMap.forEach((route) => {
    const chain = [];
    let currentId = route.routeId;
    while (currentId !== "SELF") {
      const repeatedAt = chain.indexOf(currentId);
      if (repeatedAt !== -1) {
        const cycle = chain.slice(repeatedAt).concat(currentId);
        invalid(`fallback cycle ${cycle.join(" -> ")}`);
      }
      chain.push(currentId);
      const current = routeMap.get(currentId);
      const target = current.fallbackRouteId;
      if (target === "SELF" || target === currentId) break;
      currentId = target;
    }
  });
}

function validateLegacyFallbacks(legacyFallbacks, routeMap, legacyClient) {
  if (!isPlainObject(legacyFallbacks)) invalid("legacyFallbacks must be an object");
  const routeIds = [...routeMap.keys()].sort();
  const fallbackIds = Object.keys(legacyFallbacks).sort();
  if (JSON.stringify(routeIds) !== JSON.stringify(fallbackIds)) {
    invalid("legacyFallbacks must contain exactly one projection for every routeId");
  }
  const registered = new Set(legacyClient.registeredPaths);
  const fallbackPaths = [];
  routeMap.forEach((route) => {
    const declaredTarget = legacyFallbacks[route.routeId];
    assertNonEmptyString(declaredTarget, `${route.routeId} legacyFallbackRouteId`);
    const targetId = declaredTarget === "SELF" ? route.routeId : declaredTarget;
    const target = routeMap.get(targetId);
    if (!target) invalid(`${route.routeId} legacyFallbackRouteId references unknown route ${declaredTarget}`);
    if (!registered.has(target.canonicalPath)) {
      invalid(`${route.routeId} legacy fallback path ${target.canonicalPath} is not registered by legacy client ${legacyClient.version}`);
    }
    fallbackPaths.push(target.canonicalPath);
  });
  return fallbackPaths;
}

function validateLegacyRedirectOverrides(overrides, routeMap) {
  if (!isPlainObject(overrides)) invalid("legacyRedirectOverrides must be an object");
  const redirectRouteIds = [...routeMap.values()]
    .filter((route) => route.class === "LEGACY_REDIRECT")
    .map((route) => route.routeId)
    .sort();
  const overrideIds = Object.keys(overrides).sort();
  redirectRouteIds.forEach((routeId) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, routeId)) {
      invalid(`${routeId} requires exactly one legacy redirect override`);
    }
  });
  overrideIds.forEach((routeId) => {
    const route = routeMap.get(routeId);
    if (!route) invalid(`${routeId} legacy redirect override references unknown route`);
    if (route.class !== "LEGACY_REDIRECT") invalid(`${routeId} must not declare a legacy redirect override`);
    const override = overrides[routeId];
    assertExactKeys(
      override,
      ["overrideAdapter", "targetRouteIds", "writeReplay", "unknownParams"],
      `${routeId} override`,
    );
    assertNonEmptyString(override.overrideAdapter, `${routeId} overrideAdapter`);
    assertUniqueStringArray(override.targetRouteIds, `${routeId} targetRouteIds`, { nonEmpty: true });
    override.targetRouteIds.forEach((targetRouteId) => {
      if (!routeMap.has(targetRouteId)) invalid(`${routeId} override target references unknown route ${targetRouteId}`);
    });
    if (override.writeReplay !== "DENY") invalid(`${routeId} override writeReplay must be DENY`);
    if (override.unknownParams !== "DROP") invalid(`${routeId} override unknownParams must be DROP`);
  });
  if (overrideIds.length !== redirectRouteIds.length) {
    invalid("legacyRedirectOverrides must match LEGACY_REDIRECT routes exactly");
  }
}

function expandRoutes(document, routeMap) {
  return document.routes.map((route) => {
    const defaults = document.classDefaults[route.class];
    const expanded = {
      routeId: route.routeId,
      canonicalPath: route.canonicalPath,
      pageOwnerModule: route.pageOwnerModule,
      resourceOwnerModules: [...route.resourceOwnerModules],
      isTab: route.isTab,
      accessRule: route.accessRule,
      parameterAllowlist: [...route.parameterAllowlist],
      fallbackRouteId: route.fallbackRouteId,
      legacyFallbackRouteId: document.legacyFallbacks[route.routeId],
      legacyAdapter: defaults.legacyAdapter,
      minAppVersion: defaults.minAppVersion,
      introducedVersion: defaults.introducedVersion,
      deprecatedAfter: defaults.deprecatedAfter,
      uedScreenId: route.uedScreenId,
      acceptanceCriteriaIds: [...route.acceptanceCriteriaIds],
    };
    if (!routeMap.has(route.routeId)) invalid(`cannot expand unknown route ${route.routeId}`);
    return expanded;
  });
}

function validateRegistryDocument(document, options = {}) {
  if (!isPlainObject(document)) invalid("document must be an object");
  assertExactKeys(
    document,
    [
      "schemaVersion",
      "registryVersion",
      "status",
      "sourcePrd",
      "legacyClient",
      "classDefaults",
      "legacyFallbacks",
      "legacyRedirectOverrides",
      "routes",
    ],
    "document",
  );
  assertNonEmptyString(document.schemaVersion, "schemaVersion");
  assertNonEmptyString(document.registryVersion, "registryVersion");
  if (document.status !== "NON_RUNTIME_FOUNDATION_CONTRACT") {
    invalid("status must remain NON_RUNTIME_FOUNDATION_CONTRACT in this slice");
  }
  assertNonEmptyString(document.sourcePrd, "sourcePrd");
  const frozenLegacyAppJson = options.frozenLegacyAppJson;
  const currentV1AppJson = options.currentV1AppJson;
  if (!frozenLegacyAppJson) invalid("frozenLegacyManifest is required");
  if (!currentV1AppJson) invalid("currentV1Manifest is required");
  const legacyRegisteredPaths = validateLegacyClient(document.legacyClient, frozenLegacyAppJson);
  validateClassDefaults(document.classDefaults);
  const routeMap = validateCoreRoutes(document.routes, document.classDefaults);
  validateFallbackGraph(routeMap);
  const legacyFallbackPaths = validateLegacyFallbacks(document.legacyFallbacks, routeMap, document.legacyClient);
  validateLegacyRedirectOverrides(document.legacyRedirectOverrides, routeMap);
  const currentV1Manifest = validateCurrentV1Manifest(currentV1AppJson, routeMap, document.legacyClient);
  const routes = expandRoutes(document, routeMap);
  const digestPayload = {
    schemaVersion: document.schemaVersion,
    registryVersion: document.registryVersion,
    status: document.status,
    legacyClient: document.legacyClient,
    routes,
    legacyRedirectOverrides: document.legacyRedirectOverrides,
  };
  return {
    schemaVersion: document.schemaVersion,
    registryVersion: document.registryVersion,
    status: document.status,
    fieldNames: FIELD_NAMES,
    routes,
    legacyRegisteredPaths,
    legacyFallbackPaths,
    frozenLegacyManifestSha256: FROZEN_LEGACY_MANIFEST_SHA256,
    currentV1Manifest,
    digest: sha256(stableStringify(digestPayload)),
  };
}

function loadAndValidateRegistry(sourcePath, options = {}) {
  assertNonEmptyString(sourcePath, "sourcePath");
  const document = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const frozenLegacyManifestPath = options.frozenLegacyAppJsonPath || FROZEN_LEGACY_MANIFEST_PATH;
  const frozenLegacyRaw = fs.readFileSync(frozenLegacyManifestPath);
  if (sha256(frozenLegacyRaw) !== FROZEN_LEGACY_MANIFEST_SHA256) {
    invalid("frozenLegacyManifest raw SHA-256 does not match origin/main@d761ae2");
  }
  const currentV1ManifestPath = options.currentV1AppJsonPath || options.appJsonPath;
  if (!currentV1ManifestPath && !options.currentV1AppJson) {
    invalid("currentV1Manifest path is required; it must not fall back to the frozen legacy manifest");
  }
  const frozenLegacyAppJson = JSON.parse(frozenLegacyRaw.toString("utf8"));
  const currentV1AppJson = options.currentV1AppJson || JSON.parse(fs.readFileSync(currentV1ManifestPath, "utf8"));
  return validateRegistryDocument(document, {
    ...options,
    frozenLegacyAppJson,
    currentV1AppJson,
  });
}

module.exports = {
  FIELD_NAMES,
  FROZEN_LEGACY_MANIFEST_PATH,
  FROZEN_LEGACY_MANIFEST_SHA256,
  loadAndValidateRegistry,
  registeredPathsFromAppJson,
  stableStringify,
  validateRegistryDocument,
};
