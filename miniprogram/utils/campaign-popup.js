const marketing = require("../config/marketing");
const { track } = require("./analytics");
const { getToken } = require("./request");
const { openProducts } = require("./product-navigation");
const {
  campaignShownInSession,
  ensureLoginSession,
  markCampaignShown,
} = require("./login-session");

let presenting = false;

function activeAt(campaign, now = Date.now()) {
  const startsAt = campaign.startsAt ? Date.parse(campaign.startsAt) : 0;
  const endsAt = campaign.endsAt ? Date.parse(campaign.endsAt) : 0;
  return (!startsAt || now >= startsAt) && (!endsAt || now <= endsAt);
}

function validCampaign(campaign, now = Date.now()) {
  return Boolean(
    campaign
    && campaign.enabled === true
    && String(campaign.campaignId || "").trim()
    && String(campaign.title || "").trim()
    && String(campaign.content || "").trim()
    && activeAt(campaign, now)
  );
}

function runCampaignAction(action = {}) {
  if (action.type === "PRODUCT") {
    openProducts(action.productId || "", "campaign_popup");
    return true;
  }
  return false;
}

function maybeShowCampaignPopup(now = Date.now()) {
  const campaign = marketing.campaignPopup;
  if (presenting || !validCampaign(campaign, now) || !getToken()) return false;
  const session = ensureLoginSession();
  if (campaignShownInSession(campaign.campaignId, session)) return false;
  presenting = true;
  markCampaignShown(campaign.campaignId, session);
  track("campaign_popup_view", {
    campaignId: campaign.campaignId,
    loginSessionId: session.sessionId,
    sourcePage: "main_tab",
  });
  wx.showModal({
    title: campaign.title,
    content: campaign.content,
    confirmText: campaign.confirmText || "去看看",
    cancelText: campaign.cancelText || "稍后再说",
    success(result) {
      const action = result.confirm ? "CONFIRM" : "CANCEL";
      track("campaign_popup_action", {
        campaignId: campaign.campaignId,
        loginSessionId: session.sessionId,
        action,
        sourcePage: "main_tab",
      });
      if (result.confirm) runCampaignAction(campaign.action);
    },
    complete() {
      presenting = false;
    },
  });
  return true;
}

module.exports = Object.freeze({
  activeAt,
  maybeShowCampaignPopup,
  runCampaignAction,
  validCampaign,
});
