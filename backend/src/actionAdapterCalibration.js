const { nowISO } = require("./dates");

const ACTION_ADAPTERS = [
  {
    id: "YOUZAN_COUPON_SEND",
    group: "reward",
    label: "有赞优惠券发放",
    adapterType: "YOUZAN_COUPON",
    requiredEnv: ["YOUZAN_COUPON_SEND_URL"],
    anyOfEnv: [["YOUZAN_COUPON_ACCESS_TOKEN", "YOUZAN_ACCESS_TOKEN"]],
    optionalEnv: [
      "YOUZAN_COUPON_SEND_METHOD",
      "YOUZAN_COUPON_ACCESS_TOKEN_LOCATION",
      "YOUZAN_COUPON_RESULT_REF_PATH",
      "YOUZAN_COUPON_RESULT_FIELD_MAP",
    ],
    evidenceKind: "REWARD_DELIVERY",
    playbook: [
      "用真实有赞优惠券执行小批量发券，确认外部券码、成功状态和幂等外部引用。",
      "确认失败响应会进入发放失败和人工复核路径，不会重复发券。",
    ],
    rollback: "暂停 YOUZAN_COUPON 自动发券，改用人工发券并在奖励复核中回写外部券码。",
  },
  {
    id: "YOUZAN_COUPON_STATUS",
    group: "reward",
    label: "有赞优惠券状态查询",
    adapterType: "YOUZAN_COUPON",
    requiredEnv: ["YOUZAN_COUPON_STATUS_URL"],
    anyOfEnv: [["YOUZAN_COUPON_STATUS_ACCESS_TOKEN", "YOUZAN_COUPON_ACCESS_TOKEN", "YOUZAN_ACCESS_TOKEN"]],
    optionalEnv: [
      "YOUZAN_COUPON_STATUS_METHOD",
      "YOUZAN_COUPON_STATUS_REF_PARAM",
      "YOUZAN_COUPON_STATUS_PATH",
      "YOUZAN_COUPON_STATUS_REF_PATH",
      "YOUZAN_COUPON_STATUS_FIELD_MAP",
    ],
    evidenceKind: "REWARD_STATUS",
    playbook: [
      "用已发放券码执行状态查询，确认 ISSUED/USED/EXPIRED/CANCELLED 映射。",
      "确认核销时间和过期时间字段可被记录到 reward_grant。",
    ],
    rollback: "暂停自动状态查询，改用奖励复核页人工回写 USED/EXPIRED/CANCELLED。",
  },
  {
    id: "WEWORK_TAG",
    group: "wework",
    label: "企业微信标签写入",
    adapterType: "WEWORK_TAG",
    requiredEnv: ["WEWORK_TAG_APPLY_URL", "WEWORK_CORP_ID"],
    anyOfEnv: [["WEWORK_TAG_ACCESS_TOKEN", "WEWORK_ACCESS_TOKEN", "WEWORK_CONTACT_ACCESS_TOKEN", "WEWORK_CONTACT_SECRET"]],
    optionalEnv: [
      "WEWORK_TAG_DEFAULT_ID",
      "WEWORK_TAG_USERID",
      "WEWORK_TAG_APPLY_METHOD",
      "WEWORK_TAG_RESULT_REF_PATH",
      "WEWORK_TAG_RESULT_FIELD_MAP",
    ],
    evidenceKind: "REWARD_DELIVERY",
    playbook: [
      "用真实外部联系人和真实标签 ID 执行小批量写入。",
      "确认 externalContactId、tagId、tagName 和外部回执引用写入发放记录。",
    ],
    rollback: "暂停 WEWORK_TAG 自动写入，改由运营在企业微信后台手工打标签。",
  },
  {
    id: "WEWORK_CONTACT_WRITEBACK",
    group: "wework",
    label: "企业微信联系回写",
    adapterType: "WEWORK_CONTACT_WRITEBACK",
    requiredEnv: ["WEWORK_CONTACT_WRITEBACK_URL", "WEWORK_CORP_ID"],
    anyOfEnv: [["WEWORK_CONTACT_WRITEBACK_ACCESS_TOKEN", "WEWORK_CONTACT_ACCESS_TOKEN", "WEWORK_ACCESS_TOKEN", "WEWORK_CONTACT_SECRET"]],
    optionalEnv: [
      "WEWORK_CONTACT_WRITEBACK_METHOD",
      "WEWORK_CONTACT_WRITEBACK_USERID",
      "WEWORK_CONTACT_WRITEBACK_RESULT_REF_PATH",
      "WEWORK_CONTACT_WRITEBACK_RESULT_FIELD_MAP",
      "WEWORK_CONTACT_WRITEBACK_EXTRA_PARAMS",
    ],
    evidenceKind: "WEWORK_WRITEBACK",
    playbook: [
      "用真实咨询跟进待办执行企业微信回写。",
      "确认外部联系人 ID、跟进结果、模板字段和外部回执引用可追溯。",
    ],
    rollback: "暂停 WEWORK_CONTACT_WRITEBACK，改由生命周期详情抽屉人工记录已联系。",
  },
];

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function present(env, name) {
  return Boolean(env && env[name]);
}

function envRows(env, names = []) {
  return names.map((name) => ({ name, present: present(env, name) }));
}

function anyOfRows(env, groups = []) {
  return groups.map((names) => ({
    names,
    present: names.some((name) => present(env, name)),
    presentNames: names.filter((name) => present(env, name)),
    missingNames: names.filter((name) => !present(env, name)),
  }));
}

function checkStatus(target, blocking) {
  if (!blocking) return "PASS";
  return target === "production" ? "BLOCKER" : "WARNING";
}

function makeCheck(id, label, status, message, detail = {}) {
  return { id, label, status, message, detail };
}

function configurationCheck(config, env, target) {
  const required = envRows(env, config.requiredEnv);
  const anyOf = anyOfRows(env, config.anyOfEnv);
  const missingRequired = required.filter((row) => !row.present).map((row) => row.name);
  const missingAnyOf = anyOf.filter((row) => !row.present).map((row) => row.names);
  const missing = Boolean(missingRequired.length || missingAnyOf.length);
  const parts = [];
  if (missingRequired.length) parts.push(`缺少 ${missingRequired.join(", ")}`);
  if (missingAnyOf.length) parts.push(`至少需要其一：${missingAnyOf.map((names) => names.join(" / ")).join("；")}`);
  return makeCheck(
    "configuration",
    "运行配置",
    checkStatus(target, missing),
    missing ? parts.join("；") : "必要 URL、token 和请求配置已具备。",
    { required, anyOf, missingRequired, missingAnyOf },
  );
}

function latestByTime(rows = [], timeFields = []) {
  return list(rows).slice().sort((left, right) => {
    const leftTime = timeFields.map((field) => text(left[field])).find(Boolean) || "";
    const rightTime = timeFields.map((field) => text(right[field])).find(Boolean) || "";
    return rightTime.localeCompare(leftTime);
  })[0] || null;
}

function rewardJobs(data, adapterType) {
  return list(data && data.rewardDeliveryJobs).filter((job) => job.adapter_type === adapterType);
}

function latestRewardDelivery(data, adapterType) {
  return latestByTime(rewardJobs(data, adapterType), ["delivered_at", "updated_at", "created_at"]);
}

function latestRewardStatus(data) {
  return latestByTime(
    rewardJobs(data, "YOUZAN_COUPON").filter((job) => text(job.status_checked_at)),
    ["status_checked_at", "updated_at", "created_at"],
  );
}

function latestWeworkWriteback(data) {
  return latestByTime(
    list(data && data.consultationWeworkWritebacks).filter((row) => row.adapter_type === "WEWORK_CONTACT_WRITEBACK"),
    ["delivered_at", "created_at"],
  );
}

function evidenceFor(data, config) {
  if (config.evidenceKind === "REWARD_DELIVERY") {
    const job = latestRewardDelivery(data, config.adapterType);
    return {
      status: job && job.status === "DELIVERED" ? "PASS" : job && job.status === "FAILED" ? "FAIL" : "MISSING",
      ref: job ? job.external_ref || job.reward_delivery_job_id || "" : "",
      record: job ? {
        deliveryJobId: job.reward_delivery_job_id,
        adapterType: job.adapter_type,
        status: job.status,
        externalRef: job.external_ref || "",
        deliveredAt: job.delivered_at || "",
        updatedAt: job.updated_at || "",
      } : null,
    };
  }
  if (config.evidenceKind === "REWARD_STATUS") {
    const job = latestRewardStatus(data);
    const payload = job && job.external_result_json && typeof job.external_result_json === "object"
      ? job.external_result_json
      : {};
    return {
      status: job && payload.lastStatus && payload.lastStatus !== "UNKNOWN" ? "PASS" : job ? "FAIL" : "MISSING",
      ref: job ? job.external_ref || job.reward_delivery_job_id || "" : "",
      record: job ? {
        deliveryJobId: job.reward_delivery_job_id,
        adapterType: job.adapter_type,
        status: job.status,
        externalRef: job.external_ref || "",
        externalStatus: payload.lastStatus || "",
        statusCheckedAt: job.status_checked_at || "",
      } : null,
    };
  }
  if (config.evidenceKind === "WEWORK_WRITEBACK") {
    const writeback = latestWeworkWriteback(data);
    return {
      status: writeback && writeback.status === "DELIVERED" ? "PASS" : writeback && writeback.status === "FAILED" ? "FAIL" : "MISSING",
      ref: writeback ? writeback.external_ref || writeback.writeback_id || "" : "",
      record: writeback ? {
        writebackId: writeback.writeback_id,
        adapterType: writeback.adapter_type,
        status: writeback.status,
        externalRef: writeback.external_ref || "",
        deliveredAt: writeback.delivered_at || "",
        createdAt: writeback.created_at || "",
      } : null,
    };
  }
  return { status: "MISSING", ref: "", record: null };
}

function evidenceCheck(config, data, target) {
  const evidence = evidenceFor(data, config);
  if (evidence.status === "PASS") {
    return makeCheck("live_evidence", "真实执行证据", "PASS", "已有真实动作成功记录。", evidence);
  }
  if (evidence.status === "FAIL") {
    return makeCheck("live_evidence", "真实执行证据", "BLOCKER", "最近真实动作执行失败，需要重新校准。", evidence);
  }
  return makeCheck(
    "live_evidence",
    "真实执行证据",
    checkStatus(target, true),
    "还没有成功执行记录，需先用真实账号小批量校准。",
    evidence,
  );
}

function summarize(checks) {
  const blockers = checks.filter((item) => item.status === "BLOCKER").length;
  const warnings = checks.filter((item) => item.status === "WARNING").length;
  const passed = checks.filter((item) => item.status === "PASS").length;
  return { blockers, warnings, passed, total: checks.length };
}

function statusFromSummary(summary) {
  if (summary.blockers) return "BLOCKED";
  if (summary.warnings) return "NEEDS_REVIEW";
  return "READY";
}

function buildActionCalibration(config, data, env, target) {
  const checks = [
    configurationCheck(config, env, target),
    evidenceCheck(config, data, target),
  ];
  const summary = summarize(checks);
  return {
    id: config.id,
    group: config.group,
    label: config.label,
    adapterType: config.adapterType,
    status: statusFromSummary(summary),
    summary,
    checks,
    env: {
      required: envRows(env, config.requiredEnv),
      anyOf: anyOfRows(env, config.anyOfEnv),
      optional: envRows(env, config.optionalEnv),
    },
    playbook: config.playbook,
    rollback: config.rollback,
  };
}

function buildActionAdapterCalibration(data, options = {}) {
  const target = normalizeTarget(options.target);
  const env = options.env || process.env;
  const actions = ACTION_ADAPTERS.map((config) => buildActionCalibration(config, data || {}, env, target));
  const summary = summarize(actions.flatMap((action) => action.checks));
  return {
    status: statusFromSummary(summary),
    target,
    generatedAt: nowISO(),
    summary: {
      ...summary,
      readyActionCount: actions.filter((action) => action.status === "READY").length,
      totalActionCount: actions.length,
    },
    actions,
    sequence: [
      "先确认 URL、token、请求方法和字段映射配置。",
      "再用真实账号执行小批量动作，记录成功回执。",
      "最后通过发布记录确认动作类 Adapter 和拉取类 Adapter 都不再阻塞。",
    ],
  };
}

module.exports = {
  ACTION_ADAPTERS,
  buildActionAdapterCalibration,
};
