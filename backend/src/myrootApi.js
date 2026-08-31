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

async function liveProductSnapshotState(context, productIds) {
  const adapter = context.productCommerceAdapter;
  if (!adapter || adapter.configured !== true || typeof adapter.readProductSnapshots !== "function") {
    return { status: "UNAVAILABLE", reason: "LIVE_READ_NOT_CONFIGURED", products: [], syncedAt: "" };
  }
  try {
    const result = await adapter.readProductSnapshots({ productIds });
    const products = Array.isArray(result && result.products) ? result.products : [];
    const receivedIds = new Set(products.map((item) => String(item && item.productId || "")).filter(Boolean));
    const complete = productIds.every((productId) => receivedIds.has(String(productId)));
    return {
      status: complete ? "LIVE" : products.length ? "PARTIAL" : "UNAVAILABLE",
      reason: complete ? "" : "LIVE_READ_INCOMPLETE",
      products,
      syncedAt: String(result && result.syncedAt || "").trim(),
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      reason: error && error.code === "YOUZAN_KDT_ID_REQUIRED"
        ? "LIVE_READ_NOT_CONFIGURED"
        : "LIVE_READ_UNAVAILABLE",
      products: [],
      syncedAt: "",
    };
  }
}

async function listProducts(data, query = {}, context = {}) {
  const live = await liveProductSnapshotState(
    context,
    productCatalog.OFFICIAL_PRODUCTS.map((item) => item.youzan_product_id),
  );
  const catalog = productCatalog.listProducts(data, {
    ...context,
    campaignId: query.campaignId || query.campaign_id || productCatalog.DEFAULT_CAMPAIGN_ID,
    liveProductSnapshots: live.products,
  });
  return {
    ...catalog,
    priceSync: { status: live.status, reason: live.reason, syncedAt: live.syncedAt },
  };
}

async function getProduct(data, productId, context = {}) {
  productCatalog.getProduct(data, productId, context);
  const live = await liveProductSnapshotState(context, [productId]);
  return {
    product: productCatalog.getProduct(data, productId, { ...context, liveProductSnapshots: live.products }),
    priceSync: { status: live.status, reason: live.reason, syncedAt: live.syncedAt },
  };
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
