const { sessionTokenDigest } = require("./credentialProtection");
const { createClientError } = require("./clientError");
const assessmentSourceSurvey = require("./assessmentSourceSurvey");
const channelFunnel = require("./channelFunnel");
const growthEngagement = require("./growthEngagement");
const healthAssessment = require("./healthAssessment");
const healthStatusAdvice = require("./healthStatusAdvice");
const memberCommerce = require("./memberCommerce");
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

async function liveProductSnapshots(context, productIds) {
  const adapter = context.productCommerceAdapter;
  if (!adapter || adapter.configured !== true || typeof adapter.readProductSnapshots !== "function") return [];
  try {
    const result = await adapter.readProductSnapshots({ productIds });
    return Array.isArray(result && result.products) ? result.products : [];
  } catch (error) {
    return [];
  }
}

async function listProducts(data, query = {}, context = {}) {
  const snapshots = await liveProductSnapshots(
    context,
    productCatalog.OFFICIAL_PRODUCTS.map((item) => item.youzan_product_id),
  );
  return productCatalog.listProducts(data, {
    ...context,
    campaignId: query.campaignId || query.campaign_id || productCatalog.DEFAULT_CAMPAIGN_ID,
    liveProductSnapshots: snapshots,
  });
}

async function getProduct(data, productId, context = {}) {
  productCatalog.getProduct(data, productId, context);
  const snapshots = await liveProductSnapshots(context, [productId]);
  return { product: productCatalog.getProduct(data, productId, { ...context, liveProductSnapshots: snapshots }) };
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
  const channelSource = channelFunnel.assessmentSource(data, actor.rootUserId, body, context);
  const result = healthAssessment.start(data, actor.rootUserId, body, {
    ...context,
    ...(channelSource || {}),
  });
  if (result.created) {
    const attempt = (data.healthAssessmentAttempts || [])
      .find((item) => item.assessment_id === result.assessment.assessmentId);
    channelFunnel.assessmentStage(data, actor.rootUserId, attempt, "ASSESSMENT_CREATED", context);
  }
  return result;
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
  const result = healthAssessment.complete(data, actor.rootUserId, assessmentId, body);
  const attempt = (data.healthAssessmentAttempts || [])
    .find((item) => item.assessment_id === assessmentId);
  channelFunnel.assessmentStage(data, actor.rootUserId, attempt, "ASSESSMENT_COMPLETED", context);
  return result;
}

function assessmentSourceGate(data, token, assessmentId) {
  const actor = principal(data, token);
  return assessmentSourceSurvey.gate(data, actor.rootUserId, assessmentId);
}

function confirmAssessmentSource(data, token, assessmentId, body = {}, context = {}) {
  const actor = principal(data, token);
  return assessmentSourceSurvey.confirm(data, actor.rootUserId, assessmentId, body, context);
}

function assessmentHistory(data, token, query = {}) {
  const actor = principal(data, token);
  return healthAssessment.history(data, actor.rootUserId, query);
}

function deleteAssessment(data, token, assessmentId) {
  const actor = principal(data, token);
  return healthAssessment.remove(data, actor.rootUserId, assessmentId);
}

function compareAssessments(data, token, body = {}) {
  const actor = principal(data, token);
  return healthAssessment.compare(data, actor.rootUserId, body);
}

function healthOverview(data, token) {
  const actor = principal(data, token);
  return healthStatusAdvice.overview(data, actor.rootUserId);
}

async function generateHealthAdvice(data, token, context = {}) {
  const actor = principal(data, token);
  privacyConsent.requireHealthConsent(data, actor.rootUserId, context);
  return healthStatusAdvice.generate(data, actor.rootUserId, context);
}

async function memberCommerceSummary(data, token, context = {}) {
  const actor = principal(data, token);
  return memberCommerce.summary(data, actor.rootUserId, context);
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
  if (body.visitId || body.visit_id) {
    return channelFunnel.bindFirstTouch(data, actor.rootUserId, body, context);
  }
  return growthEngagement.attributeFirstChannel(
    data,
    actor.rootUserId,
    body,
    context,
  );
}

function resolveChannelCode(data, body = {}, context = {}) {
  return channelFunnel.resolveCode(data, body, context);
}

function recordChannelFunnelStage(data, token, body = {}, context = {}) {
  const actor = principal(data, token, false);
  const stage = String(body.stage || "").trim().toUpperCase();
  if (["ASSESSMENT_CREATED", "ASSESSMENT_COMPLETED", "RESULT_VIEWED"].includes(stage)) {
    if (!actor.rootUserId) throw createClientError(1003, "登录已过期，请重新登录", 401);
    const assessmentId = String(body.assessmentId || body.assessment_id || "").trim();
    const assessment = (data.healthAssessmentAttempts || []).find((item) => (
      item.assessment_id === assessmentId && item.root_user_id === actor.rootUserId
    ));
    if (!assessment) throw createClientError(6101, "评测记录不存在", 404);
    const visitId = String(body.visitId || body.visit_id || "").trim();
    if (!assessment.source_visit_id || assessment.source_visit_id !== visitId) {
      throw createClientError(6102, "评测渠道来源不匹配", 409);
    }
  }
  return channelFunnel.recordStage(data, actor.rootUserId, body, context);
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
  assessmentSourceGate,
  assessmentCatalog,
  assessmentHistory,
  attributeChannel,
  claimPopup,
  compareAssessments,
  completeAssessment,
  confirmAssessmentSource,
  deleteAssessment,
  firstAttribution,
  getAssessment,
  generateHealthAdvice,
  getProduct,
  listProducts,
  healthOverview,
  memberCommerceSummary,
  recordAnalytics,
  recordChannelFunnelStage,
  recordPopupAction,
  resolveChannelCode,
  recordProductJump,
  saveAssessmentDraft,
  sessionForToken,
  startAssessment,
});
