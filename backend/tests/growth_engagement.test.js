const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attributeFirstChannel,
  claimSessionPopup,
  normalizeTargetPage,
  recordSessionPopupAction,
  signChannelAttribution,
} = require("../src/growthEngagement");
const { createEmptyData } = require("../src/store");

const NOW = "2026-08-17T10:00:00+08:00";
const KEY_ID = "channel-key-v1";
const SECRET = "channel-attribution-test-secret-at-least-32-characters";

function dataWithGrowthConfig() {
  const data = createEmptyData();
  data.campaignDefinitions.push({
    campaign_id: "ROOT_V060_CAMPAIGN",
    title: "ROOT 近期活动",
    status: "ACTIVE",
    start_at: "2026-08-01T00:00:00+08:00",
    end_at: "2026-08-31T23:59:59+08:00",
    config_json: {
      sessionPopup: {
        popupId: "root-v060-popup",
        version: 1,
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        priority: 10,
        audienceStates: ["REGISTERED_IDLE"],
        eyebrow: "ROOT 近期活动",
        title: "发现适合你的日常补给",
        body: "登录后每个会话只展示一次。",
        action: { type: "OPEN_PRODUCT", target: "4749049439", label: "立即探索" },
      },
    },
  });
  data.channelDefinitions.push({
    channel_definition_id: "chd_roadshow_a",
    channel_id: "ROADSHOW_A",
    campaign_id: "ROOT_V060_CAMPAIGN",
    status: "ACTIVE",
    signature_key_id: KEY_ID,
    allowed_target_pages_json: ["/pages/products/index", "/pages/product-detail/index"],
    start_at: "2026-08-01T00:00:00+08:00",
    end_at: "2026-08-31T23:59:59+08:00",
    created_at: NOW,
    updated_at: NOW,
  });
  return data;
}

function signedInput(overrides = {}) {
  const input = {
    channelId: "ROADSHOW_A",
    campaignId: "ROOT_V060_CAMPAIGN",
    targetPage: "/pages/products/index?productId=4749049439",
    expiresAt: 1788143999,
    keyId: KEY_ID,
    ...overrides,
  };
  return { ...input, signature: signChannelAttribution(input, SECRET) };
}

test("campaign popup is claimed once per login session and records safe actions", () => {
  const data = dataWithGrowthConfig();
  const first = claimSessionPopup(data, "root_user_1", "login_session_1", "REGISTERED_IDLE", { now: NOW });
  assert.equal(first.popup.popupId, "root-v060-popup");
  assert.equal(first.popup.action.type, "OPEN_PRODUCT");
  assert.equal(first.popup.action.target, "4749049439");

  const repeated = claimSessionPopup(data, "root_user_1", "login_session_1", "REGISTERED_IDLE", { now: NOW });
  assert.equal(repeated.popup, null);
  assert.equal(repeated.reason, "ALREADY_CLAIMED");

  recordSessionPopupAction(data, "root_user_1", "login_session_1", {
    popupId: "root-v060-popup",
    actionType: "VIEW",
  }, { now: NOW });
  const dismissed = recordSessionPopupAction(data, "root_user_1", "login_session_1", {
    popupId: "root-v060-popup",
    actionType: "DISMISS",
  }, { now: "2026-08-17T10:00:05+08:00" });
  assert.equal(dismissed.receipt.status, "DISMISSED");
  recordSessionPopupAction(data, "root_user_1", "login_session_1", {
    popupId: "root-v060-popup",
    actionType: "PRIMARY",
  }, { now: "2026-08-17T10:00:06+08:00" });
  assert.equal(data.analyticsEvents.filter((item) => item.event_name === "campaign_popup_view").length, 1);
  assert.equal(data.analyticsEvents.filter((item) => item.event_name === "campaign_popup_action").length, 1);
  assert.equal(JSON.stringify(data.analyticsEvents).includes("login_session_1"), false);

  const nextSession = claimSessionPopup(data, "root_user_1", "login_session_2", "REGISTERED_IDLE", { now: NOW });
  assert.equal(nextSession.popup.popupId, "root-v060-popup");
});

test("unapproved popup content remains unavailable", () => {
  const data = dataWithGrowthConfig();
  data.campaignDefinitions[0].config_json.sessionPopup.approvalStatus = "PENDING";
  const result = claimSessionPopup(data, "root_user_1", "login_session_1", "REGISTERED_IDLE", { now: NOW });
  assert.equal(result.popup, null);
  assert.equal(result.reason, "NO_ACTIVE_POPUP");
});

test("first channel attribution is signed, atomic, and never overwritten", () => {
  const data = dataWithGrowthConfig();
  const context = {
    now: NOW,
    env: { ROOT_CHANNEL_ATTRIBUTION_KEYS: JSON.stringify({ [KEY_ID]: SECRET }) },
  };
  const first = attributeFirstChannel(data, "root_user_1", signedInput(), context);
  assert.equal(first.accepted, true);
  assert.equal(first.result, "ATTRIBUTED");
  assert.equal(first.attribution.channelId, "ROADSHOW_A");

  data.channelDefinitions.push({
    ...data.channelDefinitions[0],
    channel_definition_id: "chd_roadshow_b",
    channel_id: "ROADSHOW_B",
  });
  const secondInput = signedInput({ channelId: "ROADSHOW_B" });
  secondInput.signature = signChannelAttribution(secondInput, SECRET);
  const second = attributeFirstChannel(data, "root_user_1", secondInput, context);
  assert.equal(second.accepted, true);
  assert.equal(second.result, "EXISTING_KEPT");
  assert.equal(second.attribution.channelId, "ROADSHOW_A");
  assert.equal(data.channelAttributions.length, 1);
  assert.deepEqual(data.channelAttributionAttempts.map((item) => item.result), ["ATTRIBUTED", "EXISTING_KEPT"]);
  assert.equal(JSON.stringify(data.channelAttributionAttempts).includes(SECRET), false);
});

test("invalid, expired, and unrecognized channel payloads are rejected without attribution", () => {
  const data = dataWithGrowthConfig();
  const context = {
    now: NOW,
    env: { ROOT_CHANNEL_ATTRIBUTION_KEYS: JSON.stringify({ [KEY_ID]: SECRET }) },
  };
  const invalid = attributeFirstChannel(data, "root_user_1", { ...signedInput(), signature: "0".repeat(64) }, context);
  assert.equal(invalid.reason, "SIGNATURE_INVALID");

  const expiredInput = signedInput({ expiresAt: 1700000000 });
  expiredInput.signature = signChannelAttribution(expiredInput, SECRET);
  const expired = attributeFirstChannel(data, "root_user_1", expiredInput, context);
  assert.equal(expired.reason, "QR_EXPIRED");

  const wrongTarget = signedInput({ targetPage: "/pages/profile/index" });
  wrongTarget.signature = signChannelAttribution(wrongTarget, SECRET);
  const target = attributeFirstChannel(data, "root_user_1", wrongTarget, context);
  assert.equal(target.reason, "PAYLOAD_INVALID");
  assert.equal(data.channelAttributions.length, 0);
  assert.equal(data.channelAttributionAttempts.length, 3);
  assert.equal(normalizeTargetPage("/pages/products/index?productId=4749049439"), "/pages/products/index?productId=4749049439");
  assert.equal(normalizeTargetPage("/pages/products/index?productId=%ZZ"), "");
});
