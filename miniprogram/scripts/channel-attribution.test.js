const assert = require("node:assert/strict");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  cloud: {
    callContainer(options) {
      options.success({
        statusCode: 200,
        data: {
          code: 0,
          data: {
            accepted: true,
            result: "ATTRIBUTED",
            reason: "",
            attribution: { channelId: "ROADSHOW_A" },
          },
        },
      });
    },
  },
};

const {
  ATTRIBUTED_STORAGE_KEY,
  PENDING_STORAGE_KEY,
  activeChannelVisit,
  beginChannelVisit,
  captureLaunchAttribution,
  confirmPendingAttribution,
  isGeneralGutQrEntry,
  normalizeTargetPage,
  parseAttributionPayload,
  parseScannedAttribution,
} = require("../utils/channel-attribution");

const VALID = Object.freeze({
  channelId: "ROADSHOW_A",
  campaignId: "ROOT_V060_CAMPAIGN",
  targetPage: "/pages/products/index?productId=4749049439",
  expiresAt: "1788143999",
  keyId: "channel-key-v1",
  signature: "a".repeat(64),
});

async function run() {
  assert.equal(normalizeTargetPage(VALID.targetPage), VALID.targetPage);
  assert.equal(normalizeTargetPage("/pages/profile/index"), "");
  assert.equal(normalizeTargetPage("/pages/products/index?productId=%ZZ"), "");

  const parsed = parseAttributionPayload(VALID);
  assert.equal(parsed.present, true);
  assert.equal(parsed.payload.channelId, "ROADSHOW_A");
  assert.equal(parseAttributionPayload({ ...VALID, signature: "bad" }).reason, "PAYLOAD_INVALID");
  assert.equal(parseAttributionPayload({ unrelated: "value" }).present, false);

  const scanned = parseScannedAttribution({
    path: `pages/products/index?cid=${VALID.channelId}&camp=${VALID.campaignId}&target=${encodeURIComponent(VALID.targetPage)}&exp=${VALID.expiresAt}&kid=${VALID.keyId}&sig=${VALID.signature}`,
  });
  assert.equal(scanned.payload.targetPage, VALID.targetPage);
  assert.equal(parseScannedAttribution({ scene: "q=Z6GRY3RF" }).shortCode, "Z6GRY3RF");
  assert.equal(isGeneralGutQrEntry({ path: "subpkg/campaign/pages/root-with-you/index", scene: 1047 }), true);
  assert.equal(isGeneralGutQrEntry({ path: "/subpkg/campaign/pages/root-with-you/index", scene: "1049" }), true);
  assert.equal(isGeneralGutQrEntry({ path: "pages/home/index", scene: 1047 }), false);
  assert.equal(isGeneralGutQrEntry({ path: "subpkg/campaign/pages/root-with-you/index", scene: 1001 }), false);
  assert.equal(parseScannedAttribution({
    path: "subpkg/campaign/pages/root-with-you/index",
    scene: 1047,
  }).shortCode, "O78NQGAX");
  assert.equal(parseScannedAttribution({
    path: "subpkg/campaign/pages/root-with-you/index",
    scene: 1047,
    query: { q: "JSVFNCAG" },
  }).shortCode, "JSVFNCAG", "显式渠道短码必须优先于通用码映射");

  const captured = captureLaunchAttribution({ query: VALID });
  assert.equal(captured.captured, true);
  assert.equal(storage.get(PENDING_STORAGE_KEY).channelId, "ROADSHOW_A");
  const later = captureLaunchAttribution({ query: { ...VALID, channelId: "ROADSHOW_B" } });
  assert.equal(later.reason, "PENDING_FIRST_TOUCH_KEPT");
  assert.equal(later.pending.channelId, "ROADSHOW_A");

  storage.set("ROOT_TOKEN", "test-token");
  const confirmed = await confirmPendingAttribution();
  assert.equal(confirmed.state, "CONFIRMED");
  assert.equal(storage.has(PENDING_STORAGE_KEY), false);
  assert.equal(storage.get(ATTRIBUTED_STORAGE_KEY), true);
  assert.equal(captureLaunchAttribution({ query: VALID }).reason, "FIRST_TOUCH_ALREADY_SET");

  const calls = [];
  const visit = await beginChannelVisit({ query: { q: "A1B2C3D4" } }, async (options) => {
    calls.push(options);
    if (options.url === "/api/v1/channels/resolve") {
      return {
        visitId: "cfv_existing_user_scan",
        shortCode: "A1B2C3D4",
        channelId: "ROADSHOW_B",
        campaignId: "ROOT_GUT_TEST",
        targetPage: "/subpkg/campaign/pages/root-with-you/index",
      };
    }
    return { accepted: true, result: "EXISTING_KEPT", reason: "FIRST_TOUCH_ALREADY_SET" };
  });
  assert.equal(visit.active, true);
  assert.deepEqual(calls.map((item) => item.url), [
    "/api/v1/channels/resolve",
    "/api/v1/channels/attribution",
  ]);
  assert.equal(storage.has(PENDING_STORAGE_KEY), false);
  assert.equal(activeChannelVisit().shortCode, "A1B2C3D4");

  const directEntry = await beginChannelVisit({}, async () => {
    throw new Error("无短码入口不应请求服务端");
  });
  assert.deepEqual(directEntry, { active: false, reason: "NO_SHORT_CODE", visit: null });
  assert.equal(activeChannelVisit(), null, "无短码介绍页必须清除历史渠道访问，避免串归因");

  storage.set("ROOT_ACTIVE_CHANNEL_VISIT_V1", {
    visitId: "cfv_stale",
    shortCode: "A1B2C3D4",
    activatedAt: "2026-09-03T00:00:00.000Z",
  });
  assert.equal(activeChannelVisit(Date.parse("2026-09-03T02:00:00.001Z")), null, "超过两小时的访问不得继续归因");
}

run()
  .then(() => {
    delete global.wx;
    console.log("channel attribution tests passed");
  })
  .catch((error) => {
    delete global.wx;
    console.error(error);
    process.exit(1);
  });
