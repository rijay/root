const campaign = require("./campaign");
const manualReview = require("./manualReview");
const manualReviewExplanation = require("./manualReviewExplanation");
const productMirror = require("./productMirror");
const rewardGrant = require("./rewardGrant");
const settlement = require("./settlement");
const taskProgress = require("./taskProgress");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function findUser(data, rootUserId) {
  return ensureList(data, "users").find((user) => (user.root_user_id || user.user_id) === rootUserId || user.user_id === rootUserId) || null;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function leadForRootUser(data, rootUserId) {
  return ensureList(data, "leadProfiles").find((lead) => {
    return lead.root_user_id === rootUserId || lead.user_id === rootUserId;
  }) || null;
}

function userLabel(data, rootUserId) {
  const user = findUser(data, rootUserId);
  if (!user) return rootUserId || "-";
  return [user.nickname || "ROOT用户", user.phone || ""].filter(Boolean).join(" · ");
}

function weworkTagHint(data, grant) {
  const payload = objectValue(grant && (grant.payload_json || grant.payload));
  const lead = grant ? leadForRootUser(data, grant.root_user_id) : null;
  return {
    tagId: text(payload.tagId || payload.tag_id || payload.tagKey || payload.tag_key || (grant && grant.reward_key)),
    tagName: text(payload.tagName || payload.tag_name || (grant && grant.title)),
    externalContactId: text(
      payload.externalContactId
      || payload.external_contact_id
      || payload.external_userid
      || (lead && lead.external_contact_id),
    ),
    remarkName: text(lead && lead.wechat_remark_name),
    sourceChannel: text(lead && lead.source_channel),
  };
}

function campaigns(data) {
  campaign.ensureDefaultCampaign(data);
  return ensureList(data, "campaignDefinitions").map((item) => {
    const campaignId = item.campaign_id;
    return {
      campaignId,
      title: item.title,
      status: item.status,
      startAt: item.start_at || "",
      endAt: item.end_at || "",
      config: item.config_json || {},
      participantCount: ensureList(data, "campaignParticipants").filter((participant) => participant.campaign_id === campaignId).length,
      taskCount: ensureList(data, "taskDefinitions").filter((task) => task.campaign_id === campaignId && task.status !== "ARCHIVED").length,
      productCount: ensureList(data, "campaignProductRelations").filter((relation) => relation.campaign_id === campaignId).length,
      ruleVersionCount: ensureList(data, "campaignRuleVersions").filter((version) => version.campaign_id === campaignId).length,
      updatedAt: item.updated_at || item.created_at || "",
    };
  }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function taskDefinitions(data) {
  taskProgress.listTaskDefinitions(data, campaign.DEFAULT_CAMPAIGN_ID);
  return ensureList(data, "taskDefinitions").map((item) => ({
    taskDefinitionId: item.task_definition_id,
    campaignId: item.campaign_id,
    taskType: item.task_type,
    title: item.title,
    description: item.description || "",
    required: Boolean(item.required),
    status: item.status || "ACTIVE",
    displayOrder: item.display_order || 0,
    config: item.config_json || {},
    updatedAt: item.updated_at || item.created_at || "",
  })).sort((left, right) => String(left.campaignId).localeCompare(String(right.campaignId)) || left.displayOrder - right.displayOrder);
}

function products(data) {
  return ensureList(data, "youzanProducts").map((item) => ({
    productId: item.youzan_product_id,
    title: item.title,
    status: item.status,
    priceText: item.price_text || "",
    badge: item.badge || "",
    youzanAppId: item.youzan_app_id || "",
    relationCount: ensureList(data, "campaignProductRelations").filter((relation) => relation.youzan_product_id === item.youzan_product_id).length,
    skuCount: ensureList(data, "youzanSkus").filter((sku) => sku.youzan_product_id === item.youzan_product_id).length,
    syncedAt: item.synced_at || "",
    updatedAt: item.updated_at || item.created_at || "",
  })).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function conditionCount(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + conditionCount(item), 0);
  if (value && typeof value === "object" && Array.isArray(value.conditions)) {
    return value.conditions.reduce((sum, item) => sum + conditionCount(item), 0);
  }
  return value && typeof value === "object" ? 1 : 0;
}

function ruleVersions(data) {
  settlement.ensureDefaultRuleVersion(data);
  return ensureList(data, "campaignRuleVersions").map((item) => ({
    ...settlement.toRuleVersionPayload(item),
    conditionCount: conditionCount(item.conditions_json),
    rewardCount: Array.isArray(item.rewards_json) ? item.rewards_json.length : 0,
    updatedAt: item.updated_at || item.published_at || item.created_at || "",
  })).sort((left, right) => String(right.publishedAt || right.updatedAt).localeCompare(String(left.publishedAt || left.updatedAt)));
}

function settlements(data) {
  return ensureList(data, "settlementRecords").slice()
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, 30)
    .map((item) => ({
      ...settlement.toSettlementRecordPayload(item),
      userLabel: userLabel(data, item.root_user_id),
      rewardCount: Array.isArray(item.rewards_json) ? item.rewards_json.length : 0,
      missingCount: item.result_json && Array.isArray(item.result_json.missingConditions) ? item.result_json.missingConditions.length : 0,
    }));
}

function rewardGrants(data) {
  return rewardGrant.listRewardGrants(data).slice(0, 50).map((item) => ({
    ...rewardGrant.toRewardGrantPayload(item),
    rootUserId: item.root_user_id,
    campaignId: item.campaign_id,
    userLabel: userLabel(data, item.root_user_id),
    payload: objectValue(item.payload_json),
    weworkTagHint: item.reward_type === "TAG" ? weworkTagHint(data, item) : null,
    externalRef: item.external_ref || "",
    externalStatus: item.external_status || "",
    externalStatusCheckedAt: item.external_status_checked_at || "",
    usedAt: item.used_at || "",
    expiredAt: item.expired_at || "",
  }));
}

function deliveryJobs(data) {
  return ensureList(data, "rewardDeliveryJobs").slice()
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, 50)
    .map((job) => {
      const grant = ensureList(data, "rewardGrants").find((item) => item.reward_grant_id === job.reward_grant_id);
      const tagHint = grant && (grant.reward_type === "TAG" || job.adapter_type === "WEWORK_TAG")
        ? weworkTagHint(data, grant)
        : null;
      return {
        deliveryJobId: job.reward_delivery_job_id,
        rewardGrantId: job.reward_grant_id,
        adapterType: job.adapter_type,
        status: job.status,
        attemptCount: job.attempt_count || 0,
        lastError: job.last_error || "",
        nextRetryAt: job.next_retry_at || "",
        deliveredAt: job.delivered_at || "",
        statusCheckedAt: job.status_checked_at || "",
        externalResult: job.external_result_json || {},
        requestId: job.request_id || "",
        rewardTitle: grant ? grant.title : "",
        rewardStatus: grant ? grant.status : "",
        rewardType: grant ? grant.reward_type : "",
        payload: grant ? objectValue(grant.payload_json) : {},
        weworkTagHint: tagHint,
        externalRef: grant ? grant.external_ref || "" : "",
        externalStatus: grant ? grant.external_status || "" : "",
        externalStatusCheckedAt: grant ? grant.external_status_checked_at || "" : "",
        userLabel: grant ? userLabel(data, grant.root_user_id) : "",
        createdAt: job.created_at || "",
        updatedAt: job.updated_at || "",
      };
    });
}

function manualReviews(data, context = {}) {
  return manualReview.listManualReviewItems(data).slice(0, 50).map((item) => {
    const grant = item.source_type === "REWARD_GRANT"
      ? ensureList(data, "rewardGrants").find((candidate) => candidate.reward_grant_id === item.source_id)
      : null;
    return {
      ...manualReview.toManualReviewPayload(item, { ...context, audience: "admin", rewardTitle: grant ? grant.title : "" }),
      sourceType: item.source_type,
      sourceId: item.source_id,
      userLabel: userLabel(data, item.root_user_id),
      rewardTitle: grant ? grant.title : "",
      rewardStatus: grant ? grant.status : "",
      resolution: item.resolution || "",
    };
  });
}

function buildMetrics(workbench) {
  return {
    activeCampaigns: workbench.campaigns.filter((item) => item.status === "ACTIVE").length,
    activeTaskDefinitions: workbench.taskDefinitions.filter((item) => item.status === "ACTIVE").length,
    publishedRuleVersions: workbench.ruleVersions.filter((item) => item.status === "PUBLISHED").length,
    pendingDeliveryJobs: workbench.deliveryJobs.filter((item) => item.status === "PENDING").length,
    openManualReviews: workbench.manualReviews.filter((item) => item.status === "OPEN").length,
    recentSettlements: workbench.settlements.length,
  };
}

function buildConfigWorkbench(data, context = {}) {
  const workbench = {
    campaigns: campaigns(data),
    taskDefinitions: taskDefinitions(data),
    products: products(data),
    ruleVersions: ruleVersions(data),
    settlements: settlements(data),
    rewardGrants: rewardGrants(data),
    deliveryJobs: deliveryJobs(data),
    manualReviews: manualReviews(data, context),
    manualReviewExplanationTemplates: manualReviewExplanation.listManualReviewExplanationTemplates(context),
  };
  return {
    ...workbench,
    metrics: buildMetrics(workbench),
  };
}

module.exports = {
  buildConfigWorkbench,
};
