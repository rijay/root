const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");
const { createClientError } = require("./clientError");

const DEFAULT_CAMPAIGN_ID = "ROOT_7D_RESET";

const DEFAULT_CAMPAIGN = {
  campaign_id: DEFAULT_CAMPAIGN_ID,
  title: "ROOT 7 日身体重启计划",
  status: "ACTIVE",
  start_at: "",
  end_at: "",
  config_json: {
    durationDays: 7,
    settlementWindows: [7, 14, 21],
    allowNoOrderParticipation: true,
  },
};

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function businessError(code, message, status = 200) {
  return createClientError(code, message, status);
}

function normalizeStatus(value) {
  const status = String(value || "ACTIVE").trim().toUpperCase();
  return ["DRAFT", "ACTIVE", "PAUSED", "ENDED"].includes(status) ? status : "DRAFT";
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ensureDefaultCampaign(data) {
  const campaigns = ensureList(data, "campaignDefinitions");
  let campaign = campaigns.find((item) => item.campaign_id === DEFAULT_CAMPAIGN_ID);
  if (!campaign) {
    const now = nowISO();
    campaign = {
      ...DEFAULT_CAMPAIGN,
      created_at: now,
      updated_at: now,
    };
    campaigns.push(campaign);
  }
  return campaign;
}

function isCampaignActive(campaign, dateText = todayISO()) {
  if (!campaign || campaign.status !== "ACTIVE") return false;
  if (campaign.start_at && campaign.start_at.slice(0, 10) > dateText) return false;
  if (campaign.end_at && campaign.end_at.slice(0, 10) < dateText) return false;
  return true;
}

function getActiveCampaign(data, context = {}) {
  ensureDefaultCampaign(data);
  const dateText = context.dateText || context.date || todayISO();
  const campaignId = context.campaignId || context.campaign_id || "";
  const campaigns = ensureList(data, "campaignDefinitions");
  if (campaignId) {
    const campaign = campaigns.find((item) => item.campaign_id === campaignId);
    if (!campaign || !isCampaignActive(campaign, dateText)) throw businessError(404, "活动不存在或未开放", 404);
    return campaign;
  }
  const active = campaigns
    .filter((campaign) => isCampaignActive(campaign, dateText))
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))[0];
  if (!active) throw businessError(404, "暂无可参与活动", 404);
  return active;
}

function findParticipant(data, rootUserId, campaignId) {
  return ensureList(data, "campaignParticipants").find((item) => {
    return item.root_user_id === rootUserId && item.campaign_id === campaignId;
  }) || null;
}

function joinCampaign(data, rootUserId, campaignId = "", context = {}) {
  if (!rootUserId) throw businessError(1003, "请先登录", 401);
  const campaign = getActiveCampaign(data, { ...context, campaignId: campaignId || context.campaignId });
  const participants = ensureList(data, "campaignParticipants");
  let participant = findParticipant(data, rootUserId, campaign.campaign_id);
  const now = nowISO();
  if (!participant) {
    participant = {
      campaign_participant_id: createId("cpa"),
      campaign_id: campaign.campaign_id,
      root_user_id: rootUserId,
      joined_at: now,
      status: "JOINED",
      source_channel: context.sourceChannel || context.source_channel || "",
      metadata: objectValue(context.metadata),
      created_at: now,
      updated_at: now,
    };
    participants.push(participant);
    return { campaign, participant, created: true };
  }
  participant.status = participant.status || "JOINED";
  participant.updated_at = now;
  return { campaign, participant, created: false };
}

function upsertCampaignDefinition(data, input = {}) {
  const campaigns = ensureList(data, "campaignDefinitions");
  const campaignId = text(input.campaignId || input.campaign_id, createId("cmp"));
  const now = nowISO();
  let campaign = campaigns.find((item) => item.campaign_id === campaignId);
  if (!campaign) {
    campaign = {
      campaign_id: campaignId,
      created_at: now,
    };
    campaigns.push(campaign);
  }
  Object.assign(campaign, {
    title: text(input.title, campaign.title || "ROOT 活动"),
    status: normalizeStatus(input.status || campaign.status || "DRAFT"),
    start_at: text(input.startAt || input.start_at, campaign.start_at || ""),
    end_at: text(input.endAt || input.end_at, campaign.end_at || ""),
    config_json: {
      ...objectValue(campaign.config_json),
      ...objectValue(input.config || input.config_json),
    },
    updated_at: now,
  });
  return campaign;
}

function toCampaignPayload(campaign, participant = null) {
  return {
    campaignId: campaign.campaign_id,
    title: campaign.title,
    status: campaign.status,
    startAt: campaign.start_at || "",
    endAt: campaign.end_at || "",
    config: campaign.config_json || {},
    participant: participant ? {
      participantId: participant.campaign_participant_id,
      status: participant.status,
      joinedAt: participant.joined_at,
    } : null,
  };
}

module.exports = {
  DEFAULT_CAMPAIGN,
  DEFAULT_CAMPAIGN_ID,
  ensureDefaultCampaign,
  findParticipant,
  getActiveCampaign,
  joinCampaign,
  toCampaignPayload,
  upsertCampaignDefinition,
};
