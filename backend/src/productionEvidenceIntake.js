const GROUP_LABELS = {
  identity: "账号身份",
  commerce: "有赞商城",
  operations: "运营触达",
  data: "数据与 Store",
  release: "发布回滚",
};

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function statusRank(status) {
  if (["BLOCKED", "BLOCKER", "FAIL", "REJECTED"].includes(status)) return 3;
  if (["NEEDS_REVIEW", "WARNING", "PENDING", "MISSING"].includes(status)) return 2;
  if (["READY", "PASS", "APPROVED", "VERIFIED"].includes(status)) return 1;
  return 2;
}

function normalizeStatus(status) {
  if (["BLOCKER", "FAIL", "REJECTED"].includes(status)) return "BLOCKED";
  if (["WARNING", "PENDING", "MISSING"].includes(status)) return "NEEDS_REVIEW";
  if (["PASS", "APPROVED", "VERIFIED"].includes(status)) return "READY";
  return ["READY", "NEEDS_REVIEW", "BLOCKED"].includes(status) ? status : "NEEDS_REVIEW";
}

function worstStatus(values = []) {
  const statuses = values.map((value) => normalizeStatus(value)).filter(Boolean);
  const worst = statuses.reduce((current, value) => {
    return statusRank(value) > statusRank(current) ? value : current;
  }, "READY");
  return statuses.length ? worst : "NEEDS_REVIEW";
}

function findById(rows = [], id) {
  return list(rows).find((row) => row && row.id === id) || null;
}

function sourceStatus(rows = [], ids = []) {
  const selected = ids.map((id) => findById(rows, id)).filter(Boolean);
  return worstStatus(selected.map((item) => item.status));
}

function sourceMessages(rows = [], ids = []) {
  return ids.map((id) => findById(rows, id)).filter(Boolean).map((item) => ({
    id: item.id,
    label: item.label,
    status: item.status,
    message: item.message || "",
    proofSource: item.proofSource || "",
  }));
}

function adapterSourceStatus(calibration = {}, sourceTypes = []) {
  const rows = list(calibration.sources).filter((source) => sourceTypes.includes(source.sourceType));
  return worstStatus(rows.map((source) => source.status));
}

function adapterSignals(calibration = {}, sourceTypes = []) {
  return list(calibration.sources)
    .filter((source) => sourceTypes.includes(source.sourceType))
    .map((source) => ({
      id: source.sourceType,
      label: source.label,
      status: source.status,
      blockers: source.blockers || 0,
      warnings: source.warnings || 0,
    }));
}

function actionStatus(actionCalibration = {}, ids = []) {
  const rows = list(actionCalibration.actions).filter((action) => ids.includes(action.id));
  return worstStatus(rows.map((action) => action.status));
}

function actionSignals(actionCalibration = {}, ids = []) {
  return list(actionCalibration.actions)
    .filter((action) => ids.includes(action.id))
    .map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      blockers: action.blockers || 0,
      warnings: action.warnings || 0,
    }));
}

function legacyDeprecationStatus(adminTransition = {}) {
  const decision = adminTransition.legacyDeprecationDecision || {};
  if (decision.status === "APPROVED") return "READY";
  return "NEEDS_REVIEW";
}

function item({
  id,
  backlogId,
  group,
  label,
  ownerRole,
  status,
  source,
  signals = [],
  nextAction,
}) {
  return {
    id,
    backlogId,
    group,
    groupLabel: GROUP_LABELS[group] || group,
    label,
    ownerRole,
    status: normalizeStatus(status),
    source,
    signals,
    nextAction,
  };
}

function summarize(items) {
  const readyCount = items.filter((row) => row.status === "READY").length;
  const blockerCount = items.filter((row) => row.status === "BLOCKED").length;
  const warningCount = items.filter((row) => row.status === "NEEDS_REVIEW").length;
  return {
    total: items.length,
    readyCount,
    blockerCount,
    warningCount,
  };
}

function groupItems(items) {
  return Object.entries(GROUP_LABELS).map(([group, label]) => {
    const rows = items.filter((row) => row.group === group);
    const summary = summarize(rows);
    return {
      group,
      label,
      status: summary.blockerCount ? "BLOCKED" : summary.warningCount ? "NEEDS_REVIEW" : "READY",
      summary,
    };
  }).filter((row) => row.summary.total > 0);
}

function buildProductionEvidenceIntake(input = {}) {
  const target = input.target === "production" ? "production" : "gray";
  const cutoverItems = list(input.productionCutover && input.productionCutover.items);
  const adminDecision = input.adminTransition && input.adminTransition.legacyDeprecationDecision
    ? input.adminTransition.legacyDeprecationDecision
    : {};
  const legacyMigration = input.legacyMigration || {};
  const rows = [
    item({
      id: "wechat_unionid_probe",
      backlogId: "T-001",
      group: "identity",
      label: "微信开放平台与 CloudBase unionid 实测",
      ownerRole: "研发",
      status: sourceStatus(cutoverItems, ["wechat_open_platform", "cloudbase_unionid"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["wechat_open_platform", "cloudbase_unionid"]),
      nextAction: "认证通过并绑定两个小程序后，用真实 CloudBase 请求记录脱敏 openid/unionid 证明。",
    }),
    item({
      id: "root_member_center_jump",
      backlogId: "T-002",
      group: "commerce",
      label: "Root 会员中心 appId/path 与体验版跳转证明",
      ownerRole: "产品/研发",
      status: input.rootMemberCenter && input.rootMemberCenter.status,
      source: "rootMemberCenterReadiness",
      signals: list(input.rootMemberCenter && input.rootMemberCenter.checks).map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        message: check.message,
      })),
      nextAction: "补齐真实 appId、商品购买路径，并记录 myRoot 商品页跳 Root 会员中心的 VERIFIED 证明。",
    }),
    item({
      id: "youzan_product_fields",
      backlogId: "T-003",
      group: "commerce",
      label: "有赞商品/SKU 字段样本",
      ownerRole: "研发/运营",
      status: sourceStatus(cutoverItems, ["youzan_live_fields"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["youzan_live_fields"]),
      nextAction: "用有赞商品/SKU 真实样本校准商品 ID、标题、价格、库存、购买路径和 Root 会员中心 appId。",
    }),
    item({
      id: "youzan_order_customer_fields",
      backlogId: "T-004",
      group: "commerce",
      label: "有赞订单/客户字段样本与小批量运行",
      ownerRole: "研发/运营",
      status: worstStatus([
        adapterSourceStatus(input.adapterCalibration, ["YOUZAN_ORDER", "YOUZAN_CUSTOMER"]),
        sourceStatus(cutoverItems, ["youzan_live_fields"]),
      ]),
      source: "adapterCalibration + productionCutoverReadiness",
      signals: [
        ...adapterSignals(input.adapterCalibration, ["YOUZAN_ORDER", "YOUZAN_CUSTOMER"]),
        ...sourceMessages(cutoverItems, ["youzan_live_fields"]),
      ],
      nextAction: "补齐有赞订单和客户字段样本，先 PREVIEW 再 IMPORT 小批量确认手机号、unionid、yzUid 和游标。",
    }),
    item({
      id: "youzan_coupon_actions",
      backlogId: "T-005",
      group: "commerce",
      label: "有赞券发放与状态查询真实执行证据",
      ownerRole: "研发/运营",
      status: worstStatus([
        actionStatus(input.actionAdapterCalibration, ["YOUZAN_COUPON_SEND", "YOUZAN_COUPON_STATUS"]),
        sourceStatus(cutoverItems, ["youzan_reward_fields"]),
      ]),
      source: "actionAdapterCalibration + productionCutoverReadiness",
      signals: [
        ...actionSignals(input.actionAdapterCalibration, ["YOUZAN_COUPON_SEND", "YOUZAN_COUPON_STATUS"]),
        ...sourceMessages(cutoverItems, ["youzan_reward_fields"]),
      ],
      nextAction: "用真实券码执行小批量发券和状态查询，确认幂等外部引用、核销状态和回滚口径。",
    }),
    item({
      id: "wework_contact_actions",
      backlogId: "T-006",
      group: "operations",
      label: "企微咨询跳转、标签写入和联系回写真执行证据",
      ownerRole: "研发/运营",
      status: worstStatus([
        adapterSourceStatus(input.adapterCalibration, ["WECHAT_LEAD"]),
        actionStatus(input.actionAdapterCalibration, ["WEWORK_TAG", "WEWORK_CONTACT_WRITEBACK"]),
        sourceStatus(cutoverItems, ["wework_live_fields"]),
      ]),
      source: "adapterCalibration + actionAdapterCalibration + productionCutoverReadiness",
      signals: [
        ...adapterSignals(input.adapterCalibration, ["WECHAT_LEAD"]),
        ...actionSignals(input.actionAdapterCalibration, ["WEWORK_TAG", "WEWORK_CONTACT_WRITEBACK"]),
        ...sourceMessages(cutoverItems, ["wework_live_fields"]),
      ],
      nextAction: "确认企微活码/客服链接、外部联系人字段、标签 ID、回写 URL/token/模板，并执行小批量校准。",
    }),
    item({
      id: "oplus_font_device_check",
      backlogId: "T-007",
      group: "release",
      label: "OPLUS SANS 小程序字体真机验证",
      ownerRole: "设计/研发",
      status: "NEEDS_REVIEW",
      source: "manualDeviceCheck",
      signals: [{
        id: "wechat_devtools",
        label: "微信开发者工具/真机预览",
        status: "NEEDS_REVIEW",
        message: "字体加载和授权范围需要在真机预览中确认。",
      }],
      nextAction: "在微信开发者工具和真机预览中确认 Root 字体加载、降级字体和大字体模式不重叠。",
    }),
    item({
      id: "admin_legacy_deprecation",
      backlogId: "T-008",
      group: "release",
      label: "旧静态后台下线决策",
      ownerRole: "研发/运营",
      status: legacyDeprecationStatus(input.adminTransition),
      source: "adminTransitionReadiness",
      signals: [{
        id: "legacyDeprecationDecision",
        label: "下线决策",
        status: adminDecision.status || "PENDING",
        message: `${adminDecision.source || "NONE"}${adminDecision.evidenceRef ? " / 已有证据引用" : ""}${adminDecision.rollbackRef ? " / 已有回滚引用" : ""}`,
      }],
      nextAction: "Element Plus Admin 灰度稳定且 /admin-legacy 无日常依赖后，录入 APPROVED 决策、证据引用和回滚引用。",
    }),
    item({
      id: "cloudbase_store_production",
      backlogId: "T-009",
      group: "data",
      label: "CloudBase 环境与生产 Store Adapter 生产配置",
      ownerRole: "研发",
      status: input.cloudbaseStore && input.cloudbaseStore.status,
      source: "cloudbaseStoreReadiness",
      signals: list(input.cloudbaseStore && input.cloudbaseStore.checks).map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        message: check.message,
      })),
      nextAction: "配置 ROOT_CLOUDBASE_STORE_DECISION、CloudBase 环境/地域、备份计划、回滚计划和生产证明引用。",
    }),
    item({
      id: "legacy_data_execution",
      backlogId: "T-010",
      group: "data",
      label: "旧 7 日试饮历史数据真实执行历史",
      ownerRole: "研发/运营",
      status: legacyMigration.status,
      source: "legacyDataMigration",
      signals: [{
        id: "decision",
        label: "生产处置决策",
        status: legacyMigration.decision && legacyMigration.decision.status || "PENDING",
        message: legacyMigration.decision && legacyMigration.decision.policy ? legacyMigration.decision.policy : "未录入生产处置决策",
      }, {
        id: "execution",
        label: "执行历史",
        status: legacyMigration.execution && legacyMigration.execution.status || "PENDING",
        message: legacyMigration.execution && legacyMigration.execution.action ? legacyMigration.execution.action : "未录入真实执行历史",
      }],
      nextAction: "基于生产快照选择只读归档、选择性补迁或人工处理，并录入真实执行截图/链接或 CloudBase 留档。",
    }),
    item({
      id: "wechat_checkin_reminder_delivery",
      backlogId: "T-011",
      group: "operations",
      label: "次日打卡订阅提醒真实送达",
      ownerRole: "研发/运营",
      status: sourceStatus(cutoverItems, ["wechat_checkin_reminder_delivery"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["wechat_checkin_reminder_delivery"]),
      nextAction: "使用新的独立账号和一次性额度仅发送一次，核对真机可见、任务终态与额度账本；UNKNOWN 不重试。",
    }),
    item({
      id: "cloudrun_candidate_runtime",
      backlogId: "T-012",
      group: "release",
      label: "CloudRun 候选运行与默认流量保护",
      ownerRole: "研发",
      status: sourceStatus(cutoverItems, ["cloudrun_candidate_runtime"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["cloudrun_candidate_runtime"]),
      nextAction: "留存候选版本、0% 路由、/health、/ready 和 15 次无参数默认流量保护证明。",
    }),
    item({
      id: "miniprogram_trial_core_flow",
      backlogId: "T-013",
      group: "release",
      label: "同版本体验版真机核心流程",
      ownerRole: "产品/研发",
      status: sourceStatus(cutoverItems, ["miniprogram_trial_core_flow"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["miniprogram_trial_core_flow"]),
      nextAction: "上传同版本体验版并在关闭调试的真机完成完整核心流程和 Root 会员中心商品跳转。",
    }),
    item({
      id: "cloudrun_canary_observation",
      backlogId: "T-014",
      group: "release",
      label: "5% 灰度观察与回滚阈值",
      ownerRole: "研发/运营",
      status: sourceStatus(cutoverItems, ["cloudrun_canary_observation"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["cloudrun_canary_observation"]),
      nextAction: "阻塞项清零并完成备份后进入 5% 灰度，至少观察 30 分钟并记录 20 并发、错误率、延迟和回滚阈值。",
    }),
    item({
      id: "release_artifact_traceability",
      backlogId: "T-015",
      group: "release",
      label: "候选工件与版本库追溯",
      ownerRole: "研发",
      status: sourceStatus(cutoverItems, ["release_artifact_traceability"]),
      source: "productionCutoverReadiness",
      signals: sourceMessages(cutoverItems, ["release_artifact_traceability"]),
      nextAction: "把候选 ZIP、SHA256、BuildId、版本号映射到已推送 commit/tag，并确认回滚源码可获取。",
    }),
  ];
  const summary = summarize(rows);
  return {
    status: summary.blockerCount ? "BLOCKED" : summary.warningCount ? "NEEDS_REVIEW" : "READY",
    target,
    summary,
    groups: groupItems(rows),
    items: rows,
    blockers: rows.filter((row) => row.status === "BLOCKED").map((row) => `${row.backlogId} ${row.label}: ${row.nextAction}`),
    warnings: rows.filter((row) => row.status === "NEEDS_REVIEW").map((row) => `${row.backlogId} ${row.label}: ${row.nextAction}`),
  };
}

module.exports = {
  buildProductionEvidenceIntake,
};
