const env = require("../../config/env");

function stringify(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.errMsg) return value.errMsg;
  if (value.message) return value.message;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function compact(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return stringify(value);
  }
}

function statusFromResponse(res) {
  if (res && res.fail) return "blocked";
  if (res && res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.code === 0) return "ready";
  return "blocked";
}

function detailFromResponse(res) {
  if (!res) return "未执行";
  if (res.fail) return stringify(res.err || res);
  return `statusCode=${res.statusCode || "-"} ${compact(res.data || {})}`;
}

function makeCheck(key, label, response) {
  const status = statusFromResponse(response);
  return {
    key,
    label,
    statusClass: status,
    statusText: status === "ready" ? "通过" : "阻塞",
    detail: detailFromResponse(response),
  };
}

Page({
  data: {
    running: false,
    envSummary: "",
    checks: [
      { key: "health", label: "云托管入口", statusClass: "running", statusText: "未测", detail: "等待检测" },
      { key: "identity", label: "微信身份透传", statusClass: "running", statusText: "未测", detail: "等待检测" },
      { key: "login", label: "免手机号登录探针", statusClass: "running", statusText: "未测", detail: "等待检测" },
    ],
    rawText: "",
  },

  onLoad() {
    this.setData({
      envSummary: `envVersion=${env.envVersion}; env=${env.cloudEnvId}; service=${env.cloudServiceName}`,
    });
    this.runProbe();
  },

  call(path, options = {}) {
    return new Promise((resolve) => {
      wx.cloud.callContainer({
        config: { env: env.cloudEnvId },
        path,
        method: options.method || "GET",
        timeout: options.timeout || 30000,
        data: options.data || undefined,
        header: {
          "Content-Type": "application/json",
          "X-WX-SERVICE": env.cloudServiceName,
          ...(options.header || {}),
        },
        success: resolve,
        fail: (err) => resolve({ fail: true, err }),
      });
    });
  },

  async runProbe() {
    this.setData({ running: true });
    const meta = {
      envVersion: env.envVersion,
      cloudEnvId: env.cloudEnvId,
      cloudServiceName: env.cloudServiceName,
      sdkVersion: wx.getSystemInfoSync ? (wx.getSystemInfoSync().SDKVersion || "") : "",
    };
    const health = await this.call("/health");
    const identity = await this.call("/api/v1/admin/cloudbase-identity-probe?appCode=MYROOT");
    const login = await this.call("/api/v1/auth/login", {
      method: "POST",
      timeout: 45000,
      data: { appCode: "MYROOT" },
    });
    const result = { meta, health, identity, login };
    const checks = [
      makeCheck("health", "云托管入口", health),
      makeCheck("identity", "微信身份透传", identity),
      makeCheck("login", "免手机号登录探针", login),
    ];
    const rawText = JSON.stringify(result, null, 2);
    console.log("MYROOT_EXPERIENCE_PROBE", rawText);
    this.setData({ checks, rawText, running: false });
  },

  copyResult() {
    wx.setClipboardData({ data: this.data.rawText || "" });
  },
});
