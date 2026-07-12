const auditLog = require("./auditLog");
const settlement = require("./settlement");
const { recordLifecycleEvent } = require("./identity");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeIds(input = {}) {
  const values = input.rootUserIds || input.root_user_ids || input.userIds || input.user_ids || input.users || [];
  if (typeof values === "string") {
    return values.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(values)) {
    return values.map((item) => {
      if (typeof item === "string") return item;
      return item.rootUserId || item.root_user_id || item.userId || item.user_id || "";
    }).map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function findUser(data, rootUserId) {
  return ensureList(data, "users").find((item) => {
    return item.user_id === rootUserId || item.root_user_id === rootUserId;
  }) || null;
}

function userLabel(user, rootUserId) {
  if (!user) return rootUserId;
  return [user.nickname || "ROOT用户", user.phone || "", rootUserId].filter(Boolean).join(" · ");
}

function buildPreviewItem(data, rootUserId, campaignId, context = {}) {
  const user = findUser(data, rootUserId);
  if (!user) {
    return {
      rootUserId,
      userLabel: rootUserId,
      status: "ERROR",
      qualified: false,
      missingCount: 0,
      rewardCount: 0,
      message: "用户不存在",
    };
  }
  try {
    const preview = settlement.previewSettlement(data, rootUserId, campaignId, context);
    return {
      rootUserId,
      userLabel: userLabel(user, rootUserId),
      status: preview.result.qualified ? "QUALIFIED" : "NOT_QUALIFIED",
      qualified: preview.result.qualified,
      missingCount: preview.result.missingConditions.length,
      rewardCount: preview.result.rewards.length,
      ruleVersion: preview.ruleVersion.version,
      campaignId: preview.campaign.campaignId,
      missingConditions: preview.result.missingConditions,
      rewards: preview.result.rewards,
      message: preview.result.qualified ? "满足结算条件" : "未满足结算条件",
    };
  } catch (error) {
    return {
      rootUserId,
      userLabel: userLabel(user, rootUserId),
      status: "ERROR",
      qualified: false,
      missingCount: 0,
      rewardCount: 0,
      message: error.message || "结算预览失败",
    };
  }
}

function summarize(items) {
  return {
    total: items.length,
    qualified: items.filter((item) => item.status === "QUALIFIED").length,
    notQualified: items.filter((item) => item.status === "NOT_QUALIFIED").length,
    error: items.filter((item) => item.status === "ERROR").length,
    rewardCount: items.reduce((sum, item) => sum + (item.rewardCount || 0), 0),
  };
}

function previewBatchSettlement(data, input = {}, context = {}) {
  const ids = Array.from(new Set(normalizeIds(input)));
  if (!ids.length) throw businessError(8010, "请选择需要结算的用户");
  const campaignId = input.campaignId || input.campaign_id || "";
  const items = ids.map((rootUserId) => buildPreviewItem(data, rootUserId, campaignId, context));
  return {
    mode: "PREVIEW",
    campaignId: campaignId || (items[0] && items[0].campaignId) || "",
    summary: summarize(items),
    items,
  };
}

function executeItem(data, item, context = {}) {
  if (item.status !== "QUALIFIED") {
    return {
      ...item,
      executed: false,
      settlementRecord: null,
      rewardResults: [],
    };
  }
  const result = settlement.evaluateSettlement(data, item.rootUserId, item.campaignId, context);
  recordLifecycleEvent(data, item.rootUserId, "ADMIN_BATCH_SETTLEMENT_EVALUATED", {
    sourceChannel: "ADMIN_BATCH_SETTLEMENT",
    appCode: "MYROOT",
    metadata: {
      campaignId: result.campaign.campaignId,
      settlementRecordId: result.settlementRecord.settlement_record_id,
      status: result.settlementRecord.status,
      requestId: context.requestId || "",
    },
  });
  return {
    ...item,
    executed: true,
    settlementRecord: settlement.toSettlementRecordPayload(result.settlementRecord),
    rewardResults: result.rewardResults.map((entry) => {
      if (!entry.grant) {
        return {
          rewardGrantId: "",
          rewardType: entry.rewardType || "",
          rewardKey: entry.rewardKey || "",
          status: "SKIPPED",
          created: false,
          skipped: true,
          skippedReason: entry.skippedReason || "",
          deliveryJobId: "",
        };
      }
      return {
        rewardGrantId: entry.grant.reward_grant_id,
        rewardType: entry.grant.reward_type,
        rewardKey: entry.grant.reward_key,
        status: entry.grant.status,
        created: entry.created,
        deliveryJobId: entry.deliveryJob ? entry.deliveryJob.reward_delivery_job_id : "",
      };
    }),
  };
}

function executeBatchSettlement(data, input = {}, context = {}) {
  const requestId = input.requestId || input.request_id || context.requestId || "";
  if (!requestId) throw businessError(8011, "批量结算必须提供 request_id");
  if (!input.confirmRisk && !input.confirmExecute && !input.confirm_batch_settlement) {
    throw businessError(8012, "批量结算需要二次确认");
  }
  const preview = previewBatchSettlement(data, input, context);
  const items = preview.items.map((item) => executeItem(data, item, { ...context, requestId }));
  const result = {
    mode: "EXECUTE",
    requestId,
    campaignId: preview.campaignId,
    summary: {
      ...summarize(items),
      executed: items.filter((item) => item.executed).length,
      skipped: items.filter((item) => !item.executed).length,
    },
    items,
  };
  const audit = auditLog.appendAuditLog(data, {
    action: "BATCH_SETTLEMENT_EXECUTE",
    targetType: "SETTLEMENT_BATCH",
    targetId: requestId,
    operatorId: input.operatorId || input.operator_id || "",
    reason: input.reason || "后台批量结算",
    before: {
      campaignId: preview.campaignId,
      rootUserIds: preview.items.map((item) => item.rootUserId),
      previewSummary: preview.summary,
    },
    after: result.summary,
    metadata: {
      requestId,
      confirmed: true,
    },
  });
  return { ...result, audit };
}

module.exports = {
  executeBatchSettlement,
  previewBatchSettlement,
};
