const campaign = require("./campaign");
const operationalAlerts = require("./operationalAlerts");
const taskProgress = require("./taskProgress");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberRate(count, total) {
  if (!total) return null;
  return Math.round((Number(count || 0) / total) * 1000) / 10;
}

function inDateRange(value, range) {
  const date = String(value || "").slice(0, 10);
  if (!date) return true;
  if (range.dateFrom && date < range.dateFrom) return false;
  if (range.dateTo && date > range.dateTo) return false;
  return true;
}

function datePart(value) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromQuery(query = {}) {
  return {
    dateFrom: text(query.dateFrom || query.date_from),
    dateTo: text(query.dateTo || query.date_to),
  };
}

function rootUserIdForUser(user) {
  return user && (user.root_user_id || user.user_id) || "";
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function countUsers(values) {
  return uniq(values).length;
}

function setAdd(set, value) {
  const normalized = text(value);
  if (normalized) set.add(normalized);
}

function stage(stageKey, label, count, previousCount, note = "") {
  return {
    key: stageKey,
    label,
    count,
    conversionRate: previousCount === null ? null : numberRate(count, previousCount),
    dropoff: previousCount === null ? 0 : Math.max(0, Number(previousCount || 0) - Number(count || 0)),
    note,
  };
}

function countBy(items, fieldFn) {
  return items.reduce((acc, item) => {
    const key = text(fieldFn(item), "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function distributionRows(items, fieldFn) {
  const total = items.length;
  return Object.entries(countBy(items, fieldFn))
    .map(([key, count]) => ({ key, count, rate: numberRate(count, total) }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function countByDate(items, dateFn) {
  return items.reduce((acc, item) => {
    const date = datePart(dateFn(item));
    if (!date) return acc;
    acc[date] = (acc[date] || 0) + 1;
    return acc;
  }, {});
}

function countUsersByDate(items, dateFn, userFn) {
  const buckets = items.reduce((acc, item) => {
    const date = datePart(dateFn(item));
    const userId = text(userFn(item));
    if (!date || !userId) return acc;
    if (!acc[date]) acc[date] = new Set();
    acc[date].add(userId);
    return acc;
  }, {});
  return Object.fromEntries(Object.entries(buckets).map(([date, values]) => [date, values.size]));
}

function observedDates(input) {
  return uniq([
    ...input.leads.map((item) => datePart(item.created_at || item.updated_at)),
    ...input.rootUsers.map((item) => datePart(item.created_at || item.updated_at)),
    ...input.participants.map((item) => datePart(item.joined_at || item.created_at || item.updated_at)),
    ...input.productJumps.map((item) => datePart(item.occurred_at || item.created_at)),
    ...input.orders.map((item) => datePart(item.paid_at || item.created_at || item.updated_at || item.matched_at)),
    ...input.taskEvents.map((item) => datePart(item.task_date || item.occurred_at || item.created_at)),
    ...input.settlements.map((item) => datePart(item.evaluated_at || item.created_at)),
    ...input.rewards.map((item) => datePart(item.created_at || item.updated_at)),
    ...input.deliveryJobs.map((item) => datePart(item.delivered_at || item.updated_at || item.created_at)),
  ]).sort();
}

function trendDates(input, range) {
  if (range.dateFrom && range.dateTo) {
    const dates = [];
    for (let date = range.dateFrom; date <= range.dateTo && dates.length < 93; date = addDays(date, 1)) {
      dates.push(date);
    }
    return dates;
  }
  const dates = observedDates(input);
  if (range.dateFrom) return dates.filter((date) => date >= range.dateFrom).slice(-31);
  if (range.dateTo) return dates.filter((date) => date <= range.dateTo).slice(-31);
  if (dates.length) return dates.slice(-14);
  return [new Date().toISOString().slice(0, 10)];
}

function campaignIdFromQuery(data, query = {}) {
  if (query.campaignId || query.campaign_id) return query.campaignId || query.campaign_id;
  return campaign.getActiveCampaign(data).campaign_id;
}

function usersInRange(data, range) {
  return ensureList(data, "users").filter((user) => inDateRange(user.created_at || user.registered_at || user.activated_at, range));
}

function rootUsersInRange(data, range) {
  const rootUsers = ensureList(data, "rootUsers");
  if (rootUsers.length) return rootUsers.filter((user) => inDateRange(user.created_at || user.updated_at, range));
  return usersInRange(data, range).map((user) => ({
    root_user_id: rootUserIdForUser(user),
    lifecycle_status: user.state || "",
    source_channel: user.source_channel || "",
    created_at: user.created_at || "",
    updated_at: user.updated_at || "",
  }));
}

function leadsInRange(data, range) {
  return ensureList(data, "leadProfiles").filter((lead) => inDateRange(lead.created_at || lead.updated_at, range));
}

function participantsInRange(data, campaignId, range) {
  return ensureList(data, "campaignParticipants")
    .filter((item) => item.campaign_id === campaignId)
    .filter((item) => inDateRange(item.joined_at || item.created_at || item.updated_at, range));
}

function productJumpsInRange(data, campaignId, range) {
  return ensureList(data, "productJumpLogs")
    .filter((item) => !campaignId || item.campaign_id === campaignId)
    .filter((item) => inDateRange(item.occurred_at || item.created_at, range));
}

function ordersInRange(data, range) {
  return ensureList(data, "youzanOrders").filter((order) => {
    return inDateRange(order.paid_at || order.created_at || order.updated_at || order.matched_at, range);
  });
}

function taskEventsInRange(data, campaignId, range) {
  return ensureList(data, "taskEvents")
    .filter((event) => event.campaign_id === campaignId && event.status !== "VOID")
    .filter((event) => inDateRange(event.task_date || event.occurred_at || event.created_at, range));
}

function settlementsInRange(data, campaignId, range) {
  return ensureList(data, "settlementRecords")
    .filter((item) => item.campaign_id === campaignId)
    .filter((item) => inDateRange(item.evaluated_at || item.created_at, range));
}

function rewardsInRange(data, campaignId, range) {
  return ensureList(data, "rewardGrants")
    .filter((item) => item.campaign_id === campaignId)
    .filter((item) => inDateRange(item.created_at || item.updated_at, range));
}

function deliveryJobsInRange(data, rewardGrantIds, range) {
  return ensureList(data, "rewardDeliveryJobs")
    .filter((job) => rewardGrantIds.has(job.reward_grant_id))
    .filter((job) => inDateRange(job.created_at || job.updated_at || job.delivered_at, range));
}

function resolveSettlementReadyRootUserIds(data, participants, campaignId) {
  return participants
    .filter((participant) => {
      const progress = taskProgress.computeTaskProgress(data, participant.root_user_id, campaignId);
      return progress.summary.settlementReady;
    })
    .map((participant) => participant.root_user_id);
}

function stageSummary(input) {
  const leadUsers = countUsers(input.leads.map((lead) => lead.root_user_id || lead.user_id));
  const registeredUsers = countUsers(input.rootUsers.map((user) => user.root_user_id));
  const participantUsers = countUsers(input.participants.map((item) => item.root_user_id));
  const productJumpUsers = countUsers(input.productJumps.map((item) => item.root_user_id));
  const syncedOrders = input.orders.length;
  const boundOrderUsers = countUsers(input.orders.filter((order) => order.user_id).map((order) => order.user_id));
  const taskUsers = countUsers(input.taskEvents.map((event) => event.root_user_id));
  const settlementReadyUsers = countUsers(input.settlementReadyRootUserIds);
  const qualifiedSettlementUsers = countUsers(input.settlements.filter((item) => item.status === "QUALIFIED").map((item) => item.root_user_id));
  const rewardUsers = countUsers(input.rewards.map((reward) => reward.root_user_id));
  const deliveredRewardUsers = countUsers(input.rewards.filter((reward) => reward.status === "DELIVERED").map((reward) => reward.root_user_id));

  return [
    stage("wework_leads", "企微线索", input.leads.length, null, `${leadUsers} 个线索已关联用户`),
    stage("registered_users", "myRoot 注册", registeredUsers, input.leads.length, "Root 用户主键池"),
    stage("campaign_joined", "参与活动", participantUsers, registeredUsers, "进入可配置活动任务"),
    stage("product_jump", "跳转有赞", productJumpUsers, participantUsers, "从 myRoot 商品页跳 Root 会员中心"),
    stage("order_synced", "订单同步", syncedOrders, productJumpUsers, "Root 会员中心订单镜像"),
    stage("order_bound", "订单补链", boundOrderUsers, syncedOrders, "订单已关联 myRoot 用户"),
    stage("task_started", "开始任务", taskUsers, participantUsers, "任一打卡/问卷/分享/咨询/购买事实"),
    stage("settlement_ready", "达到结算", settlementReadyUsers, taskUsers, "满足当前规则必需条件"),
    stage("settlement_qualified", "结算通过", qualifiedSettlementUsers, settlementReadyUsers, "已生成 QUALIFIED 结算记录"),
    stage("reward_granted", "生成奖励", rewardUsers, qualifiedSettlementUsers, "优惠券、免单机会或积分承诺"),
    stage("reward_delivered", "奖励发放", deliveredRewardUsers, rewardUsers, "外部奖励已发放或确认"),
  ];
}

function buildBottlenecks(input, stages) {
  const stageByKey = Object.fromEntries(stages.map((item) => [item.key, item]));
  const linkedLeadCount = input.leads.filter((lead) => lead.root_user_id || lead.user_id).length;
  const unresolvedLeads = Math.max(0, input.leads.length - linkedLeadCount);
  const participantsWithoutTask = Math.max(0, stageByKey.campaign_joined.count - stageByKey.task_started.count);
  const productJumpWithoutBoundOrder = Math.max(0, stageByKey.product_jump.count - stageByKey.order_bound.count);
  const readyWithoutSettlement = Math.max(0, stageByKey.settlement_ready.count - stageByKey.settlement_qualified.count);
  const pendingRewards = input.rewards.filter((reward) => ["PENDING_DELIVERY", "PENDING_REVIEW", "PROMISED"].includes(reward.status)).length;
  const deliveryFailures = input.deliveryJobs.filter((job) => job.status === "FAILED").length;
  return [
    {
      key: "unresolved_leads",
      label: "企微线索未补链",
      count: unresolvedLeads,
      severity: unresolvedLeads ? "warning" : "success",
      nextAction: unresolvedLeads ? "用手机号、UnionID 或订单证据补齐 root_user_id" : "线索补链正常",
    },
    {
      key: "joined_without_task",
      label: "参与后未开始任务",
      count: participantsWithoutTask,
      severity: participantsWithoutTask ? "warning" : "success",
      nextAction: participantsWithoutTask ? "检查企微触达、任务入口和首页引导" : "任务启动正常",
    },
    {
      key: "jump_without_bound_order",
      label: "跳有赞后订单未补链",
      count: productJumpWithoutBoundOrder,
      severity: productJumpWithoutBoundOrder ? "warning" : "success",
      nextAction: productJumpWithoutBoundOrder ? "校准有赞客户/订单同步和 yzUid、UnionID、手机号证据" : "购买补链正常",
    },
    {
      key: "ready_without_settlement",
      label: "达标未结算",
      count: readyWithoutSettlement,
      severity: readyWithoutSettlement ? "danger" : "success",
      nextAction: readyWithoutSettlement ? "运行批量结算预览并处理人工复核" : "结算推进正常",
    },
    {
      key: "pending_rewards",
      label: "奖励待处理",
      count: pendingRewards + deliveryFailures,
      severity: pendingRewards + deliveryFailures ? "danger" : "success",
      nextAction: pendingRewards + deliveryFailures ? "进入奖励复核执行发放或查询状态" : "奖励发放正常",
    },
  ];
}

function buildRecentActivity(input) {
  return [
    ...input.productJumps.map((item) => ({
      type: "PRODUCT_JUMP",
      label: item.youzan_product_id || "商品跳转",
      rootUserId: item.root_user_id || "",
      occurredAt: item.occurred_at || "",
    })),
    ...input.taskEvents.map((item) => ({
      type: item.task_type || "TASK",
      label: item.event_type || item.task_type || "任务事实",
      rootUserId: item.root_user_id || "",
      occurredAt: item.occurred_at || item.created_at || "",
    })),
    ...input.settlements.map((item) => ({
      type: "SETTLEMENT",
      label: item.status || "结算记录",
      rootUserId: item.root_user_id || "",
      occurredAt: item.evaluated_at || item.created_at || "",
    })),
    ...input.rewards.map((item) => ({
      type: "REWARD",
      label: `${item.reward_type || "奖励"} ${item.status || ""}`.trim(),
      rootUserId: item.root_user_id || "",
      occurredAt: item.created_at || item.updated_at || "",
    })),
  ]
    .filter((item) => item.occurredAt)
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    .slice(0, 20);
}

function buildTrend(input) {
  const leadCounts = countByDate(input.leads, (item) => item.created_at || item.updated_at);
  const registeredCounts = countUsersByDate(input.rootUsers, (item) => item.created_at || item.updated_at, (item) => item.root_user_id);
  const participantCounts = countUsersByDate(input.participants, (item) => item.joined_at || item.created_at || item.updated_at, (item) => item.root_user_id);
  const jumpCounts = countUsersByDate(input.productJumps, (item) => item.occurred_at || item.created_at, (item) => item.root_user_id);
  const orderCounts = countByDate(input.orders, (item) => item.paid_at || item.created_at || item.updated_at || item.matched_at);
  const taskCounts = countUsersByDate(input.taskEvents, (item) => item.task_date || item.occurred_at || item.created_at, (item) => item.root_user_id);
  const settlementCounts = countUsersByDate(input.settlements.filter((item) => item.status === "QUALIFIED"), (item) => item.evaluated_at || item.created_at, (item) => item.root_user_id);
  const rewardCounts = countUsersByDate(input.rewards, (item) => item.created_at || item.updated_at, (item) => item.root_user_id);
  const deliveredCounts = countUsersByDate(input.rewards.filter((item) => item.status === "DELIVERED"), (item) => item.updated_at || item.created_at, (item) => item.root_user_id);
  return trendDates(input, input.range).map((date) => ({
    date,
    leads: leadCounts[date] || 0,
    registeredUsers: registeredCounts[date] || 0,
    participants: participantCounts[date] || 0,
    productJumpUsers: jumpCounts[date] || 0,
    orders: orderCounts[date] || 0,
    taskUsers: taskCounts[date] || 0,
    qualifiedSettlements: settlementCounts[date] || 0,
    rewardUsers: rewardCounts[date] || 0,
    deliveredRewardUsers: deliveredCounts[date] || 0,
  }));
}

function buildAlerts(stages, bottlenecks) {
  const conversionAlerts = stages
    .filter((item) => item.conversionRate !== null && item.dropoff > 0 && item.conversionRate < 70)
    .map((item) => ({
      key: `conversion_${item.key}`,
      severity: item.conversionRate < 40 ? "danger" : "warning",
      label: `${item.label}转化偏低`,
      count: item.dropoff,
      message: `${item.label}转化率 ${item.conversionRate}%`,
      nextAction: item.note,
    }));
  const bottleneckAlerts = bottlenecks
    .filter((item) => item.count > 0)
    .map((item) => ({
      key: `bottleneck_${item.key}`,
      severity: item.severity,
      label: item.label,
      count: item.count,
      message: `${item.label} ${item.count} 条`,
      nextAction: item.nextAction,
    }));
  return [...bottleneckAlerts, ...conversionAlerts]
    .sort((left, right) => {
      const rank = { danger: 0, warning: 1, success: 2, info: 3 };
      return (rank[left.severity] ?? 3) - (rank[right.severity] ?? 3) || right.count - left.count;
    })
    .slice(0, 12);
}

function buildUserSourceContext(input) {
  const userIdToRootUserId = new Map();
  const rootUserSource = new Map();
  const normalizeSource = (value) => text(value, "UNKNOWN");
  const setRootSource = (rootUserId, source, priority = 1) => {
    const normalizedRootUserId = text(rootUserId);
    const normalizedSource = text(source);
    if (!normalizedRootUserId || !normalizedSource) return;
    const current = rootUserSource.get(normalizedRootUserId);
    if (current && current.priority > priority) return;
    rootUserSource.set(normalizedRootUserId, { source: normalizedSource, priority });
  };

  input.users.forEach((user) => {
    const rootUserId = rootUserIdForUser(user);
    if (user.user_id && rootUserId) userIdToRootUserId.set(user.user_id, rootUserId);
    setRootSource(rootUserId, user.source_channel || user.register_source || user.channel, 1);
  });
  input.rootUsers.forEach((user) => {
    const rootUserId = rootUserIdForUser(user);
    if (user.user_id && rootUserId) userIdToRootUserId.set(user.user_id, rootUserId);
    setRootSource(rootUserId, user.source_channel || user.register_source || user.channel, 2);
  });
  input.leads.forEach((lead) => {
    const rootUserId = lead.root_user_id || userIdToRootUserId.get(lead.user_id) || "";
    if (lead.user_id && rootUserId) userIdToRootUserId.set(lead.user_id, rootUserId);
    setRootSource(rootUserId, lead.source_channel || lead.offline_event_name, 5);
  });
  input.participants.forEach((participant) => {
    setRootSource(participant.root_user_id, participant.source_channel, 3);
  });
  input.productJumps.forEach((jump) => {
    setRootSource(jump.root_user_id, jump.source_channel, 3);
  });

  const rootUserIdFor = (item = {}) => {
    const direct = text(item.root_user_id);
    if (direct) return direct;
    const mapped = userIdToRootUserId.get(item.user_id);
    if (mapped) return mapped;
    return text(item.user_id);
  };
  const sourceFor = (item = {}, fallback = "UNKNOWN") => {
    const rootUserId = rootUserIdFor(item);
    if (rootUserId && rootUserSource.has(rootUserId)) return rootUserSource.get(rootUserId).source;
    const explicit = text(item.source_channel || item.offline_event_name || item.channel);
    if (explicit) return explicit;
    return normalizeSource(fallback);
  };

  return { rootUserIdFor, sourceFor };
}

function createSegmentBucket(key) {
  return {
    key,
    leadIds: new Set(),
    linkedLeadUsers: new Set(),
    rootUsers: new Set(),
    participantUsers: new Set(),
    productJumpUsers: new Set(),
    orderUsers: new Set(),
    taskUsers: new Set(),
    settlementReadyUsers: new Set(),
    qualifiedSettlementUsers: new Set(),
    rewardUsers: new Set(),
    deliveredRewardUsers: new Set(),
  };
}

function segmentSeverity(row) {
  if (row.participantUsers && row.taskStartRate !== null && row.taskStartRate < 50) return "danger";
  if (row.taskUsers && row.settlementReadyRate !== null && row.settlementReadyRate < 50) return "danger";
  if (row.rewardUsers && row.rewardDeliveredRate !== null && row.rewardDeliveredRate < 80) return "warning";
  if (row.leads && row.registrationRate !== null && row.registrationRate < 50) return "warning";
  return "success";
}

function segmentNextAction(row) {
  if (row.severity === "success") return "保持当前来源节奏，继续观察任务完成和奖励发放";
  if (row.taskStartRate !== null && row.taskStartRate < 50) return "优化该来源的企微触达、首页引导和任务入口";
  if (row.settlementReadyRate !== null && row.settlementReadyRate < 50) return "复核该来源的打卡/问卷达标条件和提醒节奏";
  if (row.rewardDeliveredRate !== null && row.rewardDeliveredRate < 80) return "检查该来源奖励发放队列、外部 Adapter 和人工复核";
  return "补齐该来源线索与注册账号的 UnionID、手机号或订单证据";
}

function buildRetentionSegments(input) {
  const { rootUserIdFor, sourceFor } = buildUserSourceContext(input);
  const buckets = new Map();
  const bucketFor = (source) => {
    const key = text(source, "UNKNOWN");
    if (!buckets.has(key)) buckets.set(key, createSegmentBucket(key));
    return buckets.get(key);
  };

  input.leads.forEach((lead) => {
    const bucket = bucketFor(sourceFor(lead, lead.source_channel || lead.offline_event_name));
    bucket.leadIds.add(lead.lead_id || lead.external_contact_id || `${bucket.key}:${bucket.leadIds.size + 1}`);
    setAdd(bucket.linkedLeadUsers, rootUserIdFor(lead));
  });
  input.rootUsers.forEach((user) => {
    setAdd(bucketFor(sourceFor(user)).rootUsers, rootUserIdFor(user));
  });
  input.participants.forEach((participant) => {
    setAdd(bucketFor(sourceFor(participant)).participantUsers, participant.root_user_id);
  });
  input.productJumps.forEach((jump) => {
    setAdd(bucketFor(sourceFor(jump)).productJumpUsers, jump.root_user_id);
  });
  input.orders.forEach((order) => {
    const rootUserId = rootUserIdFor(order);
    const bucket = bucketFor(rootUserId ? sourceFor(order, order.match_source) : "UNBOUND_ORDER");
    setAdd(bucket.orderUsers, rootUserId || order.order_id || order.youzan_order_no);
  });
  input.taskEvents.forEach((event) => {
    setAdd(bucketFor(sourceFor(event)).taskUsers, event.root_user_id);
  });
  input.settlementReadyRootUserIds.forEach((rootUserId) => {
    setAdd(bucketFor(sourceFor({ root_user_id: rootUserId })).settlementReadyUsers, rootUserId);
  });
  input.settlements
    .filter((item) => item.status === "QUALIFIED")
    .forEach((settlement) => {
      setAdd(bucketFor(sourceFor(settlement)).qualifiedSettlementUsers, settlement.root_user_id);
    });
  input.rewards.forEach((reward) => {
    const bucket = bucketFor(sourceFor(reward));
    setAdd(bucket.rewardUsers, reward.root_user_id);
    if (reward.status === "DELIVERED") setAdd(bucket.deliveredRewardUsers, reward.root_user_id);
  });

  return Array.from(buckets.values())
    .map((bucket) => {
      const row = {
        key: bucket.key,
        label: bucket.key === "UNKNOWN" ? "未知来源" : bucket.key,
        leads: bucket.leadIds.size,
        linkedLeadUsers: bucket.linkedLeadUsers.size,
        rootUsers: bucket.rootUsers.size,
        participantUsers: bucket.participantUsers.size,
        productJumpUsers: bucket.productJumpUsers.size,
        orderUsers: bucket.orderUsers.size,
        taskUsers: bucket.taskUsers.size,
        settlementReadyUsers: bucket.settlementReadyUsers.size,
        qualifiedSettlementUsers: bucket.qualifiedSettlementUsers.size,
        rewardUsers: bucket.rewardUsers.size,
        deliveredRewardUsers: bucket.deliveredRewardUsers.size,
      };
      row.registrationRate = numberRate(row.rootUsers, row.leads);
      row.joinRate = numberRate(row.participantUsers, row.rootUsers);
      row.productJumpRate = numberRate(row.productJumpUsers, row.participantUsers);
      row.orderBoundRate = numberRate(row.orderUsers, row.productJumpUsers);
      row.taskStartRate = numberRate(row.taskUsers, row.participantUsers);
      row.settlementReadyRate = numberRate(row.settlementReadyUsers, row.taskUsers);
      row.rewardDeliveredRate = numberRate(row.deliveredRewardUsers, row.rewardUsers);
      row.severity = segmentSeverity(row);
      row.nextAction = segmentNextAction(row);
      return row;
    })
    .sort((left, right) => {
      const leftVolume = left.participantUsers || left.rootUsers || left.leads;
      const rightVolume = right.participantUsers || right.rootUsers || right.leads;
      return rightVolume - leftVolume || left.label.localeCompare(right.label);
    });
}

function buildCharts(stages, trend, retentionSegments) {
  const maxStageCount = Math.max(1, ...stages.map((item) => Number(item.count || 0)));
  const maxSegmentParticipants = Math.max(1, ...retentionSegments.map((item) => Number(item.participantUsers || 0)));
  const trendDefinitions = [
    ["leads", "企微线索"],
    ["registeredUsers", "myRoot 注册"],
    ["participants", "参与活动"],
    ["productJumpUsers", "跳转有赞"],
    ["orders", "订单同步"],
    ["taskUsers", "开始任务"],
    ["qualifiedSettlements", "结算通过"],
    ["deliveredRewardUsers", "奖励发放"],
  ];
  return {
    funnelBars: stages.map((item) => ({
      key: item.key,
      label: item.label,
      count: item.count,
      widthRate: numberRate(item.count, maxStageCount) || 0,
      conversionRate: item.conversionRate,
      dropoff: item.dropoff,
      severity: item.conversionRate === null || item.conversionRate >= 70 ? "success" : item.conversionRate >= 40 ? "warning" : "danger",
    })),
    trendSeries: trendDefinitions.map(([key, label]) => ({
      key,
      label,
      total: trend.reduce((sum, item) => sum + Number(item[key] || 0), 0),
      points: trend.map((item) => ({ date: item.date, value: Number(item[key] || 0) })),
    })),
    segmentBars: retentionSegments.map((item) => ({
      key: item.key,
      label: item.label,
      participantUsers: item.participantUsers,
      widthRate: numberRate(item.participantUsers, maxSegmentParticipants) || 0,
      taskStartRate: item.taskStartRate,
      settlementReadyRate: item.settlementReadyRate,
      rewardDeliveredRate: item.rewardDeliveredRate,
      severity: item.severity,
    })),
  };
}

function buildOperationalAnalytics(data, query = {}) {
  const campaignId = campaignIdFromQuery(data, query);
  const range = dateFromQuery(query);
  const users = usersInRange(data, range);
  const leads = leadsInRange(data, range);
  const rootUsers = rootUsersInRange(data, range);
  const participants = participantsInRange(data, campaignId, range);
  const productJumps = productJumpsInRange(data, campaignId, range);
  const orders = ordersInRange(data, range);
  const taskEvents = taskEventsInRange(data, campaignId, range);
  const settlements = settlementsInRange(data, campaignId, range);
  const rewards = rewardsInRange(data, campaignId, range);
  const rewardGrantIds = new Set(rewards.map((reward) => reward.reward_grant_id));
  const deliveryJobs = deliveryJobsInRange(data, rewardGrantIds, range);
  const settlementReadyRootUserIds = resolveSettlementReadyRootUserIds(data, participants, campaignId);
  const input = {
    campaignId,
    range,
    users,
    leads,
    rootUsers,
    participants,
    productJumps,
    orders,
    taskEvents,
    settlements,
    rewards,
    deliveryJobs,
    settlementReadyRootUserIds,
  };
  const stages = stageSummary(input);
  const bottlenecks = buildBottlenecks(input, stages);
  const trend = buildTrend(input);
  const retentionSegments = buildRetentionSegments(input);
  const alertEvaluation = operationalAlerts.evaluateOperationalAlerts(data, {
    filters: { campaignId, ...range },
    stages,
    bottlenecks,
    trend,
    retentionSegments,
  }, { campaignId, ...range });
  return {
    filters: { campaignId, ...range },
    generatedAt: new Date().toISOString(),
    stages,
    bottlenecks,
    alerts: alertEvaluation.alerts,
    alertRules: alertEvaluation.rules,
    alertSummary: alertEvaluation.summary,
    alertRuns: operationalAlerts.listAlertRuns(data, { campaignId, limit: 10 }),
    alertNotifications: operationalAlerts.recentNotifications(data, { campaignId, limit: 20 }),
    trend,
    retentionSegments,
    charts: buildCharts(stages, trend, retentionSegments),
    refresh: {
      defaultIntervalSeconds: 60,
      maxTrendDays: 93,
    },
    distributions: {
      leadSource: distributionRows(leads, (item) => item.source_channel || item.offline_event_name),
      participantSource: distributionRows(participants, (item) => item.source_channel),
      productJumpSource: distributionRows(productJumps, (item) => item.source_channel),
      taskType: distributionRows(taskEvents, (item) => item.task_type),
      rewardStatus: distributionRows(rewards, (item) => item.status),
    },
    recentActivity: buildRecentActivity(input),
    totals: {
      leads: leads.length,
      rootUsers: rootUsers.length,
      participants: participants.length,
      productJumps: productJumps.length,
      orders: orders.length,
      taskEvents: taskEvents.length,
      settlements: settlements.length,
      rewards: rewards.length,
    },
  };
}

function csvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function buildOperationalAnalyticsCsv(data, query = {}) {
  const analytics = buildOperationalAnalytics(data, query);
  const lines = [
    csvLine(["section", "key", "label", "date", "count", "conversion_rate", "dropoff", "severity", "note"]),
  ];
  analytics.stages.forEach((item) => {
    lines.push(csvLine(["stage", item.key, item.label, "", item.count, item.conversionRate ?? "", item.dropoff, "", item.note]));
  });
  analytics.bottlenecks.forEach((item) => {
    lines.push(csvLine(["bottleneck", item.key, item.label, "", item.count, "", "", item.severity, item.nextAction]));
  });
  analytics.alerts.forEach((item) => {
    lines.push(csvLine(["alert", item.key, item.label, "", item.count, "", "", item.severity, item.nextAction]));
  });
  analytics.trend.forEach((item) => {
    lines.push(csvLine(["trend", "leads", "企微线索", item.date, item.leads, "", "", "", ""]));
    lines.push(csvLine(["trend", "registered_users", "myRoot 注册", item.date, item.registeredUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "participants", "参与活动", item.date, item.participants, "", "", "", ""]));
    lines.push(csvLine(["trend", "product_jump_users", "跳转有赞", item.date, item.productJumpUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "orders", "订单同步", item.date, item.orders, "", "", "", ""]));
    lines.push(csvLine(["trend", "task_users", "开始任务", item.date, item.taskUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "qualified_settlements", "结算通过", item.date, item.qualifiedSettlements, "", "", "", ""]));
    lines.push(csvLine(["trend", "reward_users", "生成奖励", item.date, item.rewardUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "delivered_reward_users", "奖励发放", item.date, item.deliveredRewardUsers, "", "", "", ""]));
  });
  analytics.retentionSegments.forEach((item) => {
    lines.push(csvLine(["segment", item.key, item.label, "", item.participantUsers, item.taskStartRate ?? "", "", item.severity, item.nextAction]));
    lines.push(csvLine(["segment_reward", item.key, item.label, "", item.deliveredRewardUsers, item.rewardDeliveredRate ?? "", "", item.severity, item.nextAction]));
  });
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildOperationalAnalytics,
  buildOperationalAnalyticsCsv,
};
