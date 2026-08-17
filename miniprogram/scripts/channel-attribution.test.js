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
  captureLaunchAttribution,
  confirmPendingAttribution,
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
