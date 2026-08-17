const { sessionTokenDigest } = require("./credentialProtection");
const { createClientError } = require("./clientError");
const growthEngagement = require("./growthEngagement");
const healthAssessment = require("./healthAssessment");
const privacyConsent = require("./privacyConsent");
const productAnalytics = require("./productAnalytics");
const productCatalog = require("./productCatalog");

function sessionForToken(data, token) {
  if (!token) return null;
  const digest = sessionTokenDigest(token);
  const session = (data.sessions || []).find((item) => (
    (item.token_hash === digest || item.token === token)
    && !item.revoked_at
    && (!item.expires_at || Date.parse(item.expires_at) > Date.now())
  ));
  return session || null;
}

function principal(data, token, required = true) {
  const session = sessionForToken(data, token);
  const user = session && (data.users || []).find((item) => item.user_id === session.user_id);
  if (!user && required) throw createClientError(1003, "登录已过期，请重新登录", 401);
  return {
    session,
    user: user || null,
    rootUserId: user ? user.root_user_id || user.user_id : "",
  };
}

function listProducts(data, query = {}, context = {}) {
  return productCatalog.listProducts(data, {
    ...context,
    campaignId: query.campaignId || query.campaign_id || productCatalog.DEFAULT_CAMPAIGN_ID,
  });
}

function getProduct(data, productId, context = {}) {
  return { product: productCatalog.getProduct(data, productId, context) };
}

function recordProductJump(data, token, body = {}, context = {}) {
  const actor = principal(data, token);
  return productCatalog.recordJump(data, actor.rootUserId, body, context);
}

function assessmentCatalog(data, token) {
  const actor = principal(data, token);
  return healthAssessment.catalog(data, actor.rootUserId);
}

function startAssessment(data, token, body = {}, context = {}) {
  const actor = principal(data, token);
  privacyConsent.requireHealthConsent(data, actor.rootUserId, context);
  return healthAssessment.start(data, actor.rootUserId, body, context);
}

function getAssessment(data, token, assessmentId) {
  const actor = principal(data, token);
  return { assessment: healthAssessment.get(data, actor.rootUserId, assessmentId) };
}

function saveAssessmentDraft(data, token, assessmentId, body = {}, context = {}) {
  const actor = principal(data, token);
  privacyConsent.requireHealthConsent(data, actor.rootUserId, context);
  return healthAssessment.saveDraft(data, actor.rootUserId, assessmentId, body);
}

function completeAssessment(data, token, assessmentId, body = {}, context = {}) {
  const actor = principal(data, token);
  privacyConsent.requireHealthConsent(data, actor.rootUserId, context);
  return healthAssessment.complete(data, actor.rootUserId, assessmentId, body);
}

function assessmentHistory(data, token, query = {}) {
  const actor = principal(data, token);
  return healthAssessment.history(data, actor.rootUserId, query);
}

function compareAssessments(data, token, body = {}) {
  const actor = principal(data, token);
  return healthAssessment.compare(data, actor.rootUserId, body);
}

function claimPopup(data, token, context = {}) {
  const actor = principal(data, token);
  return growthEngagement.claimSessionPopup(
    data,
    actor.rootUserId,
    actor.session && actor.session.session_id,
    actor.user.state,
    context,
  );
}

function recordPopupAction(data, token, body = {}, context = {}) {
  const actor = principal(data, token);
  return growthEngagement.recordSessionPopupAction(
    data,
    actor.rootUserId,
    actor.session && actor.session.session_id,
    body,
    context,
  );
}

function attributeChannel(data, token, body = {}, context = {}) {
  const actor = principal(data, token);
  return growthEngagement.attributeFirstChannel(
    data,
    actor.rootUserId,
    body,
    context,
  );
}

function firstAttribution(data, token) {
  const actor = principal(data, token);
  return growthEngagement.getFirstChannelAttribution(data, actor.rootUserId);
}

function recordAnalytics(data, token, body = {}, context = {}) {
  const actor = principal(data, token, false);
  return {
    accepted: true,
    event: productAnalytics.recordEvent(data, { rootUserId: actor.rootUserId }, body, context),
  };
}

module.exports = Object.freeze({
  assessmentCatalog,
  assessmentHistory,
  attributeChannel,
  claimPopup,
  compareAssessments,
  completeAssessment,
  firstAttribution,
  getAssessment,
  getProduct,
  listProducts,
  recordAnalytics,
  recordPopupAction,
  recordProductJump,
  saveAssessmentDraft,
  sessionForToken,
  startAssessment,
});
