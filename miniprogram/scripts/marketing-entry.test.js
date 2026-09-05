const assert = require("node:assert/strict");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key) || ""; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const marketing = require("../config/marketing");
const sessions = require("../utils/login-session");
const channels = require("../utils/channel-attribution");
const { activeAt, validCampaign } = require("../utils/campaign-popup");

assert.equal(marketing.campaignPopup.enabled, false);
assert.deepEqual(marketing.channels, []);

const serverSession = sessions.startLoginSession({ id: "server-session-1" });
assert.equal(serverSession.sessionId, "server-session-1");
assert.equal(sessions.campaignShownInSession("campaign-a", serverSession), false);
assert.equal(sessions.markCampaignShown("campaign-a", serverSession), true);
assert.equal(sessions.campaignShownInSession("campaign-a", serverSession), true);
assert.equal(sessions.campaignShownInSession("campaign-b", serverSession), false);
sessions.startLoginSession({ id: "server-session-2" });
assert.equal(sessions.campaignShownInSession("campaign-a", sessions.currentLoginSession()), false);

const now = Date.parse("2026-08-21T00:00:00.000Z");
const campaign = {
  enabled: true,
  campaignId: "campaign-a",
  title: "活动标题",
  content: "活动内容",
  startsAt: "2026-08-20T00:00:00.000Z",
  endsAt: "2026-08-22T00:00:00.000Z",
};
assert.equal(activeAt(campaign, now), true);
assert.equal(validCampaign(campaign, now), true);
assert.equal(validCampaign({ ...campaign, campaignId: "" }, now), false);

const encodedScene = encodeURIComponent("root_channel:channelId=offline-a&signature=signed-a");
assert.deepEqual(channels.parseScene(encodedScene), {
  channelId: "offline-a",
  signature: "signed-a",
});
const channelConfig = [{
  enabled: true,
  channelId: "offline-a",
  signature: "signed-a",
  startsAt: "2026-08-20T00:00:00.000Z",
  endsAt: "2026-08-22T00:00:00.000Z",
  target: { type: "HEALTH" },
}];
assert.equal(channels.resolveChannel({ query: { scene: encodedScene } }, now, channelConfig).result, "VALID_CHANNEL");
assert.equal(channels.resolveChannel({ query: { channelId: "offline-a", signature: "wrong" } }, now, channelConfig).result, "INVALID_CHANNEL");
assert.equal(channels.resolveChannel({ query: { scene: "1001" } }, now, channelConfig).result, "NO_CHANNEL");
const targeted = channels.channelEntryOptions({
  result: "VALID_CHANNEL",
  target: { type: "PRODUCT", productId: "4749049439" },
}, { path: "pages/home/index" });
assert.equal(targeted.__rootChannelEntry, true);
assert.equal(targeted.path, "pages/products/index");
assert.equal(targeted.query.productId, "4749049439");
assert.equal(channels.channelEntryOptions({ result: "INVALID_CHANNEL" }, {}).path, "pages/channel-error/index");

storage.clear();
assert.equal(channels.captureFirstChannel({ query: { scene: encodedScene } }, now).result, "INVALID_CHANNEL");
assert.equal(channels.pendingSourceChannel(), "");

delete global.wx;
console.log("marketing entry tests passed");
