const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const channelFunnel = require("../../backend/src/channelFunnel");

const root = path.resolve(__dirname, "..");
const INTRO_PATH = "subpkg/campaign/pages/root-with-you/index";
const ASSESSMENT_PATH = "subpkg/health/pages/assessment/index";
const WELCOME_PATH = "pages/welcome/index";
// Public short codes from the 2026-09-02 GUT_01–GUT_10 print manifest.
// Keep the fixture local so this regression never depends on production or exported files.
const PRINT_SHORT_CODES = [
  "JSVFNCAG", "RZIBCKDH", "BVHTPDEV", "ROTFLGDB", "VULSM0BW",
  "UV5GYA1Z", "8FOBATKM", "SI5XPQQY", "PEQ8VVRD", "3KREFZNZ",
];

function createRuntime(initialPages = [], requestImpl) {
  let app;
  let welcomePage;
  let pages = initialPages;
  const calls = [];
  const storage = new Map();
  const noop = () => {};
  const rejectNetwork = () => { throw new Error("Lifecycle regression must not make network requests"); };
  const navigate = (method) => ({ url }) => {
    calls.push({ method, url });
    const [route, query = ""] = url.replace(/^\//, "").split("?", 2);
    pages = [{ route, options: Object.fromEntries(new URLSearchParams(query)) }];
  };
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    reLaunch: navigate("reLaunch"),
    redirectTo: navigate("redirectTo"),
    switchTab: navigate("switchTab"),
    request: rejectNetwork,
    cloud: { init: noop, callContainer: rejectNetwork, callFunction: rejectNetwork },
  };
  // Keep app lifecycle, launching-entry, channel-attribution and their pure config
  // dependencies real. Only external I/O, telemetry and unrelated prewarming are isolated.
  const stubs = new Map(Object.entries({
    "config/env.js": { envVersion: "develop" },
    "utils/router.js": {},
    "utils/cloud-route.js": { initializeCloudRoute: noop, refreshCloudRoute: noop },
    "utils/performance-monitor.js": { performanceMonitor: { startNativeObservation: noop, record: noop, flush: noop } },
    "utils/privacy-authorization.js": { initializePrivacyAuthorization: noop },
    "utils/page-share.js": { installGlobalSharePolicy: noop, showFriendShareMenu: noop },
    "utils/formal-access.js": { FORMAL_ACCESS_STATE: { PHONE_REQUIRED: "PHONE_REQUIRED" }, inspectFormalAccess: rejectNetwork },
    "utils/profile-cache.js": { readProfileCache: noop, writeProfileCache: noop },
    "utils/login-session.js": { ensureLoginSession: noop },
    "utils/request.js": { getToken: () => "", request: requestImpl || rejectNetwork },
    "utils/runtime-request-adapter.js": { resolveRuntimeRequestConfig: () => ({ mode: "TEST_OFFLINE", adapter: "request" }) },
    "utils/activity-feed-cache.js": { prewarmActivityFeed: () => Promise.resolve() },
    "utils/member-commerce.js": { getMemberCommerceSummary: rejectNetwork, readMemberCommerceSummaryEntry: noop },
    "utils/session-image-cache.js": { prewarmSessionImage: noop },
    "utils/analytics.js": { track: noop },
  }).map(([file, value]) => [path.join(root, file), value]));
  const context = vm.createContext({
    wx,
    App: (definition) => { app = definition; },
    Page: (definition) => { welcomePage = definition; },
    getApp: () => app,
    getCurrentPages: () => pages,
  });
  const cache = new Map();
  function load(file) {
    if (stubs.has(file)) return stubs.get(file);
    if (cache.has(file)) return cache.get(file).exports;
    assert.ok(file.startsWith(`${root}${path.sep}`), `Unexpected dependency outside miniprogram: ${file}`);
    const module = { exports: {} };
    cache.set(file, module);
    const source = fs.readFileSync(file, "utf8");
    const execute = vm.runInContext(`(function(require, module, exports) {\n${source}\n})`, context, { filename: file });
    execute((specifier) => {
      assert.ok(specifier.startsWith("."), `Unexpected non-local dependency: ${specifier}`);
      const dependency = path.resolve(path.dirname(file), specifier);
      return load(path.extname(dependency) ? dependency : `${dependency}.js`);
    }, module, module.exports);
    return module.exports;
  }
  load(path.join(root, "app.js"));
  return {
    app,
    calls,
    storage,
    setPages: (nextPages) => { pages = nextPages; },
    loadWelcome: () => {
      load(path.join(root, "pages/welcome/index.js"));
      return welcomePage;
    },
    loadIntroduction: (options) => {
      load(path.join(root, INTRO_PATH + ".js"));
      return welcomePage.onLoad.call({ route: INTRO_PATH, options }, options);
    },
    attribution: load(path.join(root, "utils/channel-attribution.js")),
  };
}

function scanOptions(code, queryKind = "scene") {
  return {
    path: INTRO_PATH,
    scene: 1047,
    query: queryKind === "scene" ? { scene: encodeURIComponent(`q=${code}`) } : { q: code },
  };
}

function assertDirectScan(runtime, code, expectedCount = 1) {
  assert.equal(runtime.calls.length, expectedCount, "Only a scan not already served by the native first page needs navigation");
  if (expectedCount) {
    assert.deepEqual(runtime.calls[expectedCount - 1], {
      method: "reLaunch",
      url: `/${INTRO_PATH}?q=${code}`,
    }, "The app must replace the page stack with this scan's hand-drawn introduction");
  }
  assert.equal(runtime.app.globalData.launchingHandledThisSession, true);
  assert.equal(runtime.app.globalData.launchingTarget, undefined, "A stale brand-page restoration target must be cleared");
  assert.equal(runtime.app.globalData.pendingChannelEntry, undefined);
  assert.equal(runtime.app.globalData.pendingNativeChannelCode, undefined);
}

const pageStates = [
  ["empty page stack", []],
  ["home", [{ route: "pages/home/index", options: {} }]],
  ["introduction with old code", [{ route: INTRO_PATH, options: { q: "OLDQ1234", answers: "discard" } }]],
  ["assessment in progress", [{ route: ASSESSMENT_PATH, options: { assessmentId: "assessment-local" } }]],
  ["brand welcome page", [{ route: WELCOME_PATH, options: { mode: "launching" } }]],
];

for (const code of PRINT_SHORT_CODES) {
  for (const [stateName, pages] of pageStates) {
    for (const queryKind of ["scene", "q"]) {
      for (const alreadyHandled of [false, true]) {
        test(`${code}: ${queryKind}, ${stateName}, session handled=${alreadyHandled}`, () => {
          const runtime = createRuntime(pages);
          runtime.app.globalData.launchingHandledThisSession = alreadyHandled;
          runtime.app.globalData.launchingTarget = { route: "/pages/products/index", options: { productId: "stale-product" } };
          const options = scanOptions(code, queryKind);
          if (!alreadyHandled) {
            runtime.app.onLaunch(options);
            assert.equal(runtime.calls.length, 0, "onLaunch must only capture the channel; onShow owns navigation");
          }
          // Warm rescans only receive onShow: there must be no pending onLaunch
          // channel to accidentally hide a failure to handle this event's query.
          runtime.app.onShow(options);
          const navigationCount = !alreadyHandled && !pages.length ? 0 : 1;
          assertDirectScan(runtime, code, navigationCount);
          runtime.app.onShow({ path: INTRO_PATH, scene: 1001, query: {} });
          assert.equal(runtime.calls.length, navigationCount, "Ordinary resume after scanning must not reopen the brand or introduction page");
        });
      }
    }
  }
}

test("onLaunch channel survives first onShow without channel parameters", () => {
  const runtime = createRuntime();
  runtime.app.onLaunch(scanOptions(PRINT_SHORT_CODES[0]));
  runtime.app.onShow({ path: WELCOME_PATH, scene: 1001, query: {} });
  assertDirectScan(runtime, PRINT_SHORT_CODES[0], 0);
});

test("first onShow explicit code takes precedence over a different onLaunch code", () => {
  const runtime = createRuntime();
  const [firstCode, nextCode] = PRINT_SHORT_CODES;
  runtime.app.onLaunch(scanOptions(firstCode));
  runtime.app.onShow(scanOptions(nextCode));
  assertDirectScan(runtime, nextCode);
  assert.equal(runtime.storage.get("ROOT_PENDING_CHANNEL_V2").shortCode, firstCode,
    "Current navigation must not rewrite pending first touch");
});

test("first onShow inferred general code does not replace an explicit onLaunch code", () => {
  const runtime = createRuntime();
  runtime.app.onLaunch(scanOptions(PRINT_SHORT_CODES[0]));
  runtime.app.onShow({ path: INTRO_PATH, scene: 1047, query: {} });
  assertDirectScan(runtime, PRINT_SHORT_CODES[0], 0);
});

test("consecutive A to B scans reload the same introduction with B and preserve first-touch semantics", () => {
  const runtime = createRuntime();
  const [firstCode, nextCode] = PRINT_SHORT_CODES;
  runtime.app.onLaunch(scanOptions(firstCode));
  runtime.app.onShow(scanOptions(firstCode));
  assertDirectScan(runtime, firstCode, 0);
  runtime.app.onShow(scanOptions(nextCode, "q"));
  assertDirectScan(runtime, nextCode, 1);
  runtime.app.onShow(scanOptions(nextCode));
  assertDirectScan(runtime, nextCode, 2);
  assert.equal(runtime.storage.get("ROOT_PENDING_CHANNEL_V2").shortCode, firstCode,
    "Navigation uses the current scan without silently rewriting historical first touch");
});

for (const scene of [1001, 1089]) {
  for (const queryKind of ["q", "scene"]) {
    test(`scan then assessment then ordinary resume with stale ${queryKind} (scene ${scene}) keeps the assessment`, () => {
      const runtime = createRuntime();
      const code = PRINT_SHORT_CODES[0];
      const options = scanOptions(code);
      runtime.app.onLaunch(options);
      runtime.app.onShow(options);
      assertDirectScan(runtime, code, 0);
      runtime.setPages([{ route: ASSESSMENT_PATH, options: { assessmentId: "assessment-local" } }]);
      // WeChat may retain entry path/query while the user resumes an in-progress page.
      runtime.app.onShow({ ...scanOptions(code, queryKind), scene });
      assert.equal(runtime.calls.length, 0, "Residual q alone must not turn ordinary resume into a new scan");
      assert.equal(runtime.app.globalData.launchingTarget, undefined);
    });
  }
}

for (const scene of [1011, 1012, 1013, 1047, 1048, 1049]) {
  test(`a genuine rescan of the same code still reloads the introduction (scene ${scene})`, () => {
    const runtime = createRuntime();
    const code = PRINT_SHORT_CODES[0];
    runtime.app.onLaunch(scanOptions(code));
    runtime.app.onShow(scanOptions(code));
    assertDirectScan(runtime, code, 0);
    runtime.setPages([{ route: ASSESSMENT_PATH, options: { assessmentId: "assessment-local" } }]);
    runtime.app.onShow({ ...scanOptions(code), scene });
    assertDirectScan(runtime, code, 1);
  });
}

test("a first cold entry with a direct q works before a QR scene is available", () => {
  const runtime = createRuntime();
  const code = PRINT_SHORT_CODES[0];
  const options = { path: INTRO_PATH, query: { q: code } };
  runtime.app.onLaunch(options);
  runtime.app.onShow(options);
  assertDirectScan(runtime, code, 0);
});

for (const pages of [[], [{ route: WELCOME_PATH, options: {} }]]) {
  test(`ordinary cold launch retains the brand page (stack size ${pages.length})`, () => {
    const runtime = createRuntime(pages);
    const options = { path: WELCOME_PATH, scene: 1001, query: {} };
    runtime.app.onLaunch(options);
    runtime.app.onShow(options);
    assert.deepEqual(runtime.calls, []);
    assert.equal(runtime.app.globalData.launchingTarget.route, "/pages/home/index");
    assert.equal(runtime.app.globalData.launchingHandledThisSession, true);
  });
}

test("ordinary first entry from home still opens the brand welcome page", () => {
  const runtime = createRuntime([{ route: "pages/home/index", options: {} }]);
  const options = { path: "pages/home/index", scene: 1001, query: {} };
  runtime.app.onLaunch(options);
  runtime.app.onShow(options);
  assert.deepEqual(runtime.calls, [{ method: "reLaunch", url: "/pages/welcome/index?mode=launching" }]);
  assert.equal(runtime.app.globalData.launchingTarget.route, "/pages/home/index");
});

test("ordinary welcome skip still switches to home exactly once", () => {
  const runtime = createRuntime([{ route: WELCOME_PATH, options: {} }]);
  const options = { path: WELCOME_PATH, scene: 1001, query: {} };
  runtime.app.onLaunch(options);
  runtime.app.onShow(options);
  const welcome = runtime.loadWelcome();
  welcome.skipWelcome();
  welcome.skipWelcome();
  assert.deepEqual(runtime.calls, [{ method: "switchTab", url: "/pages/home/index" }]);
  assert.equal(runtime.app.globalData.launchingTarget, undefined);
});

for (const alreadyHandled of [false, true]) {
  test(`ordinary assessment resume keeps the current page and answers (session handled=${alreadyHandled})`, () => {
    const assessmentPage = { route: ASSESSMENT_PATH, options: { assessmentId: "assessment-local" }, data: { answers: { localQuestion: "localAnswer" } } };
    const runtime = createRuntime([assessmentPage]);
    runtime.app.globalData.launchingHandledThisSession = alreadyHandled;
    const options = { path: ASSESSMENT_PATH, scene: 1001, query: { assessmentId: "assessment-local" } };
    runtime.app.onLaunch(options);
    runtime.app.onShow(options);
    assert.deepEqual(runtime.calls, []);
    assert.deepEqual(assessmentPage.data.answers, { localQuestion: "localAnswer" });
  });
}

test("ordinary protected assessment deep link still redirects from a visible brand page", () => {
  const runtime = createRuntime([{ route: WELCOME_PATH, options: {} }]);
  const options = { path: ASSESSMENT_PATH, scene: 1001, query: { assessmentId: "assessment-local" } };
  runtime.app.onLaunch(options);
  runtime.app.onShow(options);
  assert.deepEqual(runtime.calls, [{ method: "redirectTo", url: `/${ASSESSMENT_PATH}?assessmentId=assessment-local` }]);
});

// Run the actual introduction onLoad and attribution code against the actual,
// in-memory backend funnel implementation. Only transport and unrelated I/O are replaced.
function createFunnelRuntime(responseHook = async (_request, result) => result) {
  const data = {};
  const requests = [];
  for (const code of [...PRINT_SHORT_CODES, "O78NQGAX"]) {
    channelFunnel.upsertChannel(data, { channelId: `TEST_${code}`, campaignId: "LOCAL_SCAN_QA" });
    channelFunnel.createCode(data, { channelId: `TEST_${code}`, label: "local only" });
    data.channelQrCodes[data.channelQrCodes.length - 1].short_code = code;
  }
  const runtime = createRuntime([], async (request) => {
    requests.push(request);
    let result;
    if (request.url === "/api/v1/channels/resolve") result = channelFunnel.resolveCode(data, request.data);
    else if (request.url === "/api/v1/channels/attribution") result = channelFunnel.bindFirstTouch(data, "local_scan_user", request.data);
    else if (request.url === "/api/v1/channels/funnel") result = channelFunnel.recordStage(data, "local_scan_user", request.data);
    else throw new Error(`Unexpected local request: ${request.url}`);
    return responseHook(request, result);
  });
  return { ...runtime, data, requests };
}

function stageCount(runtime, stage) {
  return (runtime.data.channelFunnelEvents || []).filter((event) => event.stage === stage).length;
}

function resolveRequests(runtime) {
  return runtime.requests.filter((request) => request.url === "/api/v1/channels/resolve");
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const code of PRINT_SHORT_CODES) {
  for (const queryKind of ["q", "scene"]) {
    test(`native cold entry counts once: ${code}, ${queryKind}`, async () => {
      const runtime = createFunnelRuntime();
      const options = scanOptions(code, queryKind);
      runtime.app.onLaunch(options);
      runtime.app.onShow(options);
      // The native first page still loads even if App.onShow also requested reLaunch.
      const loads = [runtime.loadIntroduction(options.query)];
      for (const call of runtime.calls) {
        const query = call.url.split("?")[1] || "";
        loads.push(runtime.loadIntroduction(Object.fromEntries(new URLSearchParams(query))));
      }
      await Promise.all(loads);
      assert.equal(resolveRequests(runtime).length, 1, "One external entry must issue one resolve request");
      assert.equal(runtime.data.channelFunnelVisits.length, 1);
      assert.equal(runtime.data.channelFunnelVisits[0].short_code, code);
      assert.equal(stageCount(runtime, "SCAN_OPEN"), 1);
      assert.equal(stageCount(runtime, "INTRO_VIEW"), 1);
      assert.equal(runtime.calls.length, 0, "An already-correct native cold entry needs no reLaunch");
    });
  }
}

for (const settled of [false, true]) {
  test(`duplicate page loads share the scan after response settled=${settled}`, async () => {
    const runtime = createFunnelRuntime();
    const code = PRINT_SHORT_CODES[0];
    runtime.app.globalData.launchingHandledThisSession = true;
    runtime.setPages([{ route: ASSESSMENT_PATH, options: {} }]);
    runtime.app.onShow(scanOptions(code));
    const firstLoad = runtime.loadIntroduction({ q: code });
    if (settled) await firstLoad;
    const duplicateLoad = runtime.loadIntroduction({ scene: encodeURIComponent(`q=${code}`) });
    await Promise.all([firstLoad, duplicateLoad]);
    assert.equal(resolveRequests(runtime).length, 1);
    assert.equal(runtime.data.channelFunnelVisits.length, 1);
    assert.equal(stageCount(runtime, "SCAN_OPEN"), 1);
    assert.equal(stageCount(runtime, "INTRO_VIEW"), 1);
  });
}

for (const scene of [1011, 1012, 1013, 1047, 1048, 1049]) {
  test(`real same-code rescan creates a new visit without a time window: scene ${scene}`, async () => {
    const runtime = createFunnelRuntime();
    const options = scanOptions(PRINT_SHORT_CODES[0], "q");
    runtime.app.onLaunch(options);
    runtime.app.onShow(options);
    await runtime.loadIntroduction(options.query);
    runtime.app.onShow({ ...options, scene });
    await Promise.all([
      runtime.loadIntroduction(options.query),
      runtime.loadIntroduction(options.query),
    ]);
    assert.equal(resolveRequests(runtime).length, 2);
    assert.equal(runtime.data.channelFunnelVisits.length, 2);
    assert.equal(stageCount(runtime, "SCAN_OPEN"), 2);
    assert.equal(stageCount(runtime, "INTRO_VIEW"), 2);
    assert.equal(new Set(resolveRequests(runtime).map((request) => request.data.clientVisitId)).size, 2);
  });
}

test("rapid A to B to B scans keep distinct visits and preserve confirmed first touch", async () => {
  const runtime = createFunnelRuntime();
  for (const code of [PRINT_SHORT_CODES[0], PRINT_SHORT_CODES[1], PRINT_SHORT_CODES[1]]) {
    runtime.app.onShow(scanOptions(code, "q"));
    await Promise.all([runtime.loadIntroduction({ q: code }), runtime.loadIntroduction({ q: code })]);
    assert.equal(runtime.attribution.activeChannelVisit().shortCode, code);
  }
  assert.deepEqual(runtime.data.channelFunnelVisits.map((visit) => visit.short_code), [
    PRINT_SHORT_CODES[0], PRINT_SHORT_CODES[1], PRINT_SHORT_CODES[1],
  ]);
  assert.equal(stageCount(runtime, "SCAN_OPEN"), 3);
  assert.equal(stageCount(runtime, "INTRO_VIEW"), 3);
  assert.equal(runtime.data.channelAttributions[0].channel_id, `TEST_${PRINT_SHORT_CODES[0]}`);
});

test("ordinary resume retains the visit and answers without a new resolve", async () => {
  const runtime = createFunnelRuntime();
  const options = scanOptions(PRINT_SHORT_CODES[0], "q");
  runtime.app.onLaunch(options);
  runtime.app.onShow(options);
  await runtime.loadIntroduction(options.query);
  const visitId = runtime.attribution.activeChannelVisit().visitId;
  const assessment = { route: ASSESSMENT_PATH, options: {}, data: { answers: { local: "synthetic" } } };
  runtime.setPages([assessment]);
  const navigationCount = runtime.calls.length;
  runtime.app.onShow({ ...options, scene: 1089 });
  assert.equal(runtime.calls.length, navigationCount);
  assert.equal(resolveRequests(runtime).length, 1);
  assert.equal(runtime.attribution.activeChannelVisit().visitId, visitId);
  assert.deepEqual(assessment.data.answers, { local: "synthetic" });
});

test("a late A resolve cannot replace the active B visit or record A INTRO_VIEW against B", async () => {
  const oldResponse = deferred();
  const [codeA, codeB] = PRINT_SHORT_CODES;
  const runtime = createFunnelRuntime(async (request, result) => {
    if (request.url.endsWith("/resolve") && request.data.shortCode === codeA) await oldResponse.promise;
    return result;
  });
  runtime.app.onShow(scanOptions(codeA, "q"));
  const oldLoad = runtime.loadIntroduction({ q: codeA });
  runtime.app.onShow(scanOptions(codeB, "q"));
  await runtime.loadIntroduction({ q: codeB });
  const visitB = runtime.attribution.activeChannelVisit().visitId;
  oldResponse.resolve();
  await oldLoad;
  assert.equal(runtime.attribution.activeChannelVisit().visitId, visitB);
  const introRequests = runtime.requests.filter((request) => request.data.stage === "INTRO_VIEW");
  assert.equal(introRequests.length, 1, "A superseded load must not record an introduction event");
  assert.equal(introRequests[0].data.visitId, visitB);
});

test("an uncertain resolve retry keeps its original idempotency key", async () => {
  let loseFirstResponse = true;
  const runtime = createFunnelRuntime(async (request, result) => {
    if (request.url.endsWith("/resolve") && loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error("synthetic response lost after server commit");
    }
    return result;
  });
  const options = scanOptions(PRINT_SHORT_CODES[0], "q");
  runtime.app.onShow(options);
  await runtime.loadIntroduction(options.query);
  await runtime.loadIntroduction(options.query);
  const requests = resolveRequests(runtime);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.equal(runtime.data.channelFunnelVisits.length, 1);
  assert.equal(stageCount(runtime, "SCAN_OPEN"), 1);
  assert.equal(stageCount(runtime, "INTRO_VIEW"), 1);
});

test("a superseded native A page cannot start a visit after onShow selects B", async () => {
  const runtime = createFunnelRuntime();
  const [codeA, codeB] = PRINT_SHORT_CODES;
  runtime.app.onLaunch(scanOptions(codeA, "q"));
  runtime.app.onShow(scanOptions(codeB, "q"));
  await runtime.loadIntroduction({ q: codeA });
  await runtime.loadIntroduction({ q: codeB });
  assertDirectScan(runtime, codeB);
  assert.equal(resolveRequests(runtime).length, 1);
  assert.equal(runtime.data.channelFunnelVisits[0].short_code, codeB);
  assert.equal(stageCount(runtime, "INTRO_VIEW"), 1);
});

test("a late attribution confirmation cannot clear the newer pending visit", async () => {
  const oldConfirmation = deferred();
  const oldConfirmationStarted = deferred();
  let confirmationCount = 0;
  const runtime = createFunnelRuntime(async (request, result) => {
    if (request.url.endsWith("/attribution")) {
      confirmationCount += 1;
      if (confirmationCount === 1) {
        oldConfirmationStarted.resolve();
        await oldConfirmation.promise;
      } else {
        throw new Error("synthetic lost attribution confirmation for B");
      }
    }
    return result;
  });
  const [codeA, codeB] = PRINT_SHORT_CODES;
  runtime.app.onShow(scanOptions(codeA, "q"));
  const loadA = runtime.loadIntroduction({ q: codeA });
  await oldConfirmationStarted.promise;
  runtime.app.onShow(scanOptions(codeB, "q"));
  await runtime.loadIntroduction({ q: codeB });
  const visitB = runtime.attribution.activeChannelVisit().visitId;
  oldConfirmation.resolve();
  await loadA;
  assert.equal(runtime.storage.get("ROOT_PENDING_CHANNEL_V2").visitId, visitB);
  assert.equal(runtime.attribution.activeChannelVisit().visitId, visitB);
  assert.equal(stageCount(runtime, "INTRO_VIEW"), 1);
  assert.equal(runtime.data.channelAttributions[0].channel_id, `TEST_${codeA}`);
});

test("parameterless QR native and redirected pages share one general visit", async () => {
  const runtime = createFunnelRuntime();
  const options = { path: INTRO_PATH, scene: 1047, query: {} };
  runtime.app.onLaunch(options);
  runtime.app.onShow(options);
  await Promise.all([
    runtime.loadIntroduction({}),
    runtime.loadIntroduction({ q: "O78NQGAX" }),
  ]);
  assert.equal(resolveRequests(runtime).length, 1);
  assert.equal(runtime.data.channelFunnelVisits[0].short_code, "O78NQGAX");
  assert.equal(stageCount(runtime, "SCAN_OPEN"), 1);
  assert.equal(stageCount(runtime, "INTRO_VIEW"), 1);
});

test("an internal parameterless introduction preserves the general-entry rule", async () => {
  const runtime = createFunnelRuntime();
  const code = PRINT_SHORT_CODES[0];
  runtime.app.onShow(scanOptions(code, "q"));
  await runtime.loadIntroduction({ q: code });
  await runtime.loadIntroduction({});
  assert.deepEqual(runtime.data.channelFunnelVisits.map((visit) => visit.short_code), [code, "O78NQGAX"]);
  assert.equal(runtime.attribution.activeChannelVisit().shortCode, "O78NQGAX");
  assert.equal(runtime.data.channelAttributions[0].channel_id, `TEST_${code}`);
});

test("ordinary resume ends scan reuse without suppressing later internal page visits", async () => {
  const runtime = createFunnelRuntime();
  const options = scanOptions(PRINT_SHORT_CODES[0], "q");
  runtime.app.onShow(options);
  await runtime.loadIntroduction(options.query);
  runtime.app.onShow({ ...options, scene: 1089 });
  await runtime.loadIntroduction(options.query);
  assert.equal(resolveRequests(runtime).length, 2);
  assert.equal(stageCount(runtime, "SCAN_OPEN"), 2);
});

test("an invalid explicit scene never silently creates a general visit", async () => {
  const runtime = createFunnelRuntime();
  await runtime.loadIntroduction({ scene: encodeURIComponent("q=invalid!") });
  assert.equal(resolveRequests(runtime).length, 0);
  assert.equal(stageCount(runtime, "INTRO_VIEW"), 0);
});
