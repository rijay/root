const crypto = require("node:crypto");
const { nowISO } = require("./dates");

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function maskUrl(value) {
  const urlText = text(value);
  if (!urlText) return "";
  try {
    const url = new URL(urlText);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return urlText.slice(0, 12) ? `${urlText.slice(0, 12)}...` : "";
  }
}

function configFromRule(rule = {}) {
  const config = rule.config_json || rule.config || {};
  return typeof config === "object" && config !== null ? config : {};
}

function resolveWebhookConfig(rule = {}, context = {}) {
  const env = context.env || process.env;
  const config = configFromRule(rule);
  const url = text(
    rule.webhook_url ||
      rule.webhookUrl ||
      config.webhookUrl ||
      context.operationalAlertWebhookUrl ||
      env.ROOT_OPERATIONAL_ALERT_WEBHOOK_URL,
  );
  return {
    url,
    urlPreview: maskUrl(url),
    secret: text(config.webhookSecret || context.operationalAlertWebhookSecret || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET),
    channel: text(config.webhookChannel || context.operationalAlertWebhookChannel || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL, "GENERIC").toUpperCase(),
    template: text(config.webhookTemplate || context.operationalAlertWebhookTemplate || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE, "ROOT_OPERATIONAL_ALERT"),
    timeoutMs: Math.max(1000, Math.min(numberValue(config.webhookTimeoutMs || context.operationalAlertWebhookTimeoutMs || env.ROOT_OPERATIONAL_ALERT_WEBHOOK_TIMEOUT_MS, 5000), 30000)),
  };
}

function pickAlertFields(alert = {}) {
  return {
    key: alert.key || "",
    ruleId: alert.ruleId || "",
    label: alert.label || "",
    message: alert.message || "",
    severity: alert.severity || "",
    targetType: alert.targetType || "",
    targetKey: alert.targetKey || "",
    metricKey: alert.metricKey || "",
    metricValue: alert.metricValue ?? null,
    operator: alert.operator || "",
    thresholdValue: alert.thresholdValue ?? null,
    nextAction: alert.nextAction || "",
    ownerRole: alert.ownerRole || "",
    ownerName: alert.ownerName || "",
    ownerContact: alert.ownerContact || "",
    routeKey: alert.routeKey || "",
    sourceType: alert.sourceType || "",
    adapterKind: alert.adapterKind || "",
    sourceRunId: alert.sourceRunId || "",
    lifecycleJobId: alert.lifecycleJobId || "",
    lifecycleJobStatus: alert.lifecycleJobStatus || "",
    exportId: alert.exportId || "",
    exportFilename: alert.exportFilename || "",
    deliveryChannel: alert.deliveryChannel || "",
    deliveryStatus: alert.deliveryStatus || "",
    deliveryIssueCount: alert.deliveryIssueCount || 0,
    retryScheduledCount: alert.retryScheduledCount || 0,
    dueRetryCount: alert.dueRetryCount || 0,
    deadLetterCount: alert.deadLetterCount || 0,
    deliveredCount: alert.deliveredCount || 0,
    requestedCount: alert.requestedCount || 0,
    successRate: alert.successRate || 0,
    attemptCount: alert.attemptCount || 0,
    maxAttempts: alert.maxAttempts || 0,
    deadLetterReason: alert.deadLetterReason || "",
    failedCount: alert.failedCount || 0,
    pendingCount: alert.pendingCount || 0,
    ageMinutes: alert.ageMinutes || 0,
    errorMessage: alert.errorMessage || "",
  };
}

function buildWebhookPayload(rule, alert, publicRule, context = {}, config = resolveWebhookConfig(rule, context)) {
  return {
    event: "ROOT_OPERATIONAL_ALERT",
    generatedAt: text(context.now) || nowISO(),
    requestId: text(context.requestId),
    channel: config.channel,
    template: config.template,
    alert: pickAlertFields(alert),
    rule: publicRule,
    routing: {
      ownerRole: alert.ownerRole || rule.owner_role || "",
      ownerName: alert.ownerName || rule.owner_name || "",
      ownerContact: alert.ownerContact || rule.owner_contact || "",
      routeKey: alert.routeKey || rule.route_key || "",
    },
  };
}

function isWeworkRobotUrl(value) {
  try {
    const url = new URL(text(value));
    return url.hostname === "qyapi.weixin.qq.com" && url.pathname === "/cgi-bin/webhook/send";
  } catch {
    return false;
  }
}

function compactMarkdownText(value, fallback = "-") {
  const normalized = text(value, fallback)
    .replace(/@all/gi, "all")
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
  return normalized.slice(0, 600) || fallback;
}

function buildWeworkRobotPayload(payload = {}) {
  const alert = payload.alert || {};
  const routing = payload.routing || {};
  const severity = text(alert.severity).toLowerCase();
  const color = severity === "danger" || severity === "critical" ? "warning" : "comment";
  const lines = [
    "### myRoot 运营告警",
    `> 级别：<font color=\"${color}\">${compactMarkdownText(alert.severity, "warning")}</font>`,
    `> 事项：${compactMarkdownText(alert.label || alert.message)}`,
    `> 详情：${compactMarkdownText(alert.message)}`,
    `> 下一步：${compactMarkdownText(alert.nextAction, "请进入 myRoot Admin 查看并处理")}`,
    `> 负责人：${compactMarkdownText(routing.ownerName || routing.ownerRole, "待指定")}`,
    `> 路由：${compactMarkdownText(routing.routeKey, "myroot-operations")}`,
    `> 时间：${compactMarkdownText(payload.generatedAt)}`,
  ];
  return {
    msgtype: "markdown",
    markdown: { content: lines.join("\n").slice(0, 4000) },
  };
}

function signatureForBody(body, secret) {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function postWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (typeof AbortController !== "function") return fetchImpl(url, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendOperationalAlertWebhook(rule, alert, context = {}, publicRule = {}) {
  const config = resolveWebhookConfig(rule, context);
  const deliveryTarget = {
    channel: config.channel,
    template: config.template,
    urlConfigured: Boolean(config.url),
    urlPreview: config.urlPreview,
    signed: Boolean(config.secret),
    timeoutMs: config.timeoutMs,
  };
  if (!config.url) {
    return {
      status: "SKIPPED",
      externalRef: "",
      error: "missing webhook_url or ROOT_OPERATIONAL_ALERT_WEBHOOK_URL",
      deliveryTarget,
    };
  }
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { status: "FAILED", externalRef: "", error: "fetch unavailable", deliveryTarget };
  }
  const payload = buildWebhookPayload(rule, alert, publicRule, context, config);
  const weworkRobot = isWeworkRobotUrl(config.url);
  const body = JSON.stringify(weworkRobot ? buildWeworkRobotPayload(payload) : payload);
  const signature = signatureForBody(body, config.secret);
  const headers = {
    "Content-Type": "application/json",
    "X-Root-Alert-Event": "ROOT_OPERATIONAL_ALERT",
    "X-Root-Alert-Channel": config.channel,
    "X-Root-Alert-Template": config.template,
  };
  if (signature) headers["X-Root-Alert-Signature"] = signature;
  try {
    const response = await postWithTimeout(fetchImpl, config.url, {
      method: "POST",
      headers,
      body,
    }, config.timeoutMs);
    const status = response && response.status ? Number(response.status) : 0;
    const httpOk = !response || response.ok !== false;
    let remoteCode = null;
    let remoteMessage = "";
    if (weworkRobot && response && typeof response.text === "function") {
      const responseText = String(await response.text()).slice(0, 1000);
      try {
        const parsed = responseText ? JSON.parse(responseText) : {};
        remoteCode = Number.isFinite(Number(parsed.errcode)) ? Number(parsed.errcode) : null;
        remoteMessage = text(parsed.errmsg);
      } catch {
        remoteMessage = "invalid WeWork robot response";
      }
    }
    const remoteOk = !weworkRobot || remoteCode === 0;
    const ok = httpOk && remoteOk;
    return {
      status: ok ? "DELIVERED" : "FAILED",
      externalRef: status ? `HTTP ${status}${weworkRobot && remoteCode !== null ? ` / errcode ${remoteCode}` : ""}` : "",
      error: ok ? "" : (weworkRobot && remoteCode !== null
        ? `WeWork errcode ${remoteCode}${remoteMessage ? `: ${remoteMessage}` : ""}`
        : `HTTP ${status || "FAILED"}${remoteMessage ? `: ${remoteMessage}` : ""}`),
      deliveryTarget,
    };
  } catch (error) {
    const aborted = error && error.name === "AbortError";
    return {
      status: "FAILED",
      externalRef: "",
      error: aborted ? `webhook timeout after ${config.timeoutMs}ms` : error.message || "webhook failed",
      deliveryTarget,
    };
  }
}

module.exports = {
  buildWebhookPayload,
  buildWeworkRobotPayload,
  isWeworkRobotUrl,
  resolveWebhookConfig,
  sendOperationalAlertWebhook,
  signatureForBody,
};
