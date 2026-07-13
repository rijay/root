const env = require("../config/env");
const { appendCloudRoute } = require("./cloud-route");

const DEFAULT_REQUEST_TIMEOUT = 10000;
const CLOUD_REQUEST_TIMEOUT = 30000;

function getToken() {
  return wx.getStorageSync("ROOT_TOKEN") || "";
}

function setToken(token) {
  wx.setStorageSync("ROOT_TOKEN", token);
}

function clearToken() {
  wx.removeStorageSync("ROOT_TOKEN");
}

function stringifyError(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.message && typeof value.message === "string") return value.message;
  if (value.errMsg && typeof value.errMsg === "string") return value.errMsg;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer <redacted>")
    .replace(/([?&](?:token|secret|password|openid|unionid|code)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/((?:["']?)(?:token|secret|password|openid|unionid|code)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s}&]+)/gi, "$1<redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted>")
    .replace(/\b1[3-9]\d{9}\b/g, "<redacted-phone>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted>")
    .slice(0, 200);
}

function safeErrorSummary(value) {
  const code = value && (value.errCode || value.errno || value.code);
  return {
    code: code === undefined || code === null ? "" : sanitizeDiagnosticText(code),
    message: sanitizeDiagnosticText(stringifyError(value)),
  };
}

function toError(value, fallback) {
  const message = stringifyError(value) || fallback;
  return new Error(message);
}

function requestFailMessage(error, adapter) {
  const message = stringifyError(error);
  if (message.includes("timeout") || message.includes("timed out")) return "服务响应较慢，请稍后重试";
  if (adapter === "cloudContainer") {
    const code = error && (error.errCode || error.errno || error.code);
    const codeMatch = message.match(/\b(?:errCode[:：]?\s*)?(-?\d{2,})\b/);
    const cloudCode = code || (codeMatch && codeMatch[1]);
    return cloudCode ? `服务暂时不可用（云托管${cloudCode}）` : "服务暂时不可用，请稍后重试";
  }
  if (message.includes("ERR_CONNECTION_REFUSED")) return "后台服务未连接，请先启动本地后端";
  return "网络连接失败，请确认后台服务已启动";
}

function parseResponse(res) {
  const payload = res.data || {};
  if (payload.code === 0) return payload.data;
  if (payload.code === 1003 || res.statusCode === 401) clearToken();
  throw toError(payload.message || payload, "请求失败");
}

function buildHeader(token, requestId, optionsHeader) {
  return {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(optionsHeader || {}),
  };
}

function requestByWxRequest(options, token, requestId) {
  return new Promise((resolve, reject) => {
    if (/example\.com/.test(env.apiBaseUrl)) {
      reject(new Error("请先在 config/env.js 配置正式环境 API 域名"));
      return;
    }
    wx.request({
      url: `${env.apiBaseUrl}${options.url}`,
      method: options.method || "GET",
      timeout: options.timeout || DEFAULT_REQUEST_TIMEOUT,
      data: options.data || {},
      header: buildHeader(token, requestId, options.header),
      success(res) {
        try {
          resolve(parseResponse(res));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        reject(new Error(requestFailMessage(error, "wxRequest")));
      },
    });
  });
}

function requestByCloudContainer(options, token, requestId) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callContainer) {
      reject(new Error("当前基础库不支持云托管调用，请升级微信开发者工具基础库"));
      return;
    }
    if (!env.cloudEnvId || !env.cloudServiceName) {
      reject(new Error("请先在 config/env.js 配置云开发环境和云托管服务名"));
      return;
    }

    const requestPath = appendCloudRoute(options.url, env.envVersion);
    wx.cloud.callContainer({
      config: {
        env: env.cloudEnvId,
      },
      path: requestPath,
      method: options.method || "GET",
      timeout: options.timeout || CLOUD_REQUEST_TIMEOUT,
      data: options.data || {},
      header: {
        ...buildHeader(token, requestId, options.header),
        "X-WX-SERVICE": env.cloudServiceName,
      },
      success(res) {
        try {
          resolve(parseResponse(res));
        } catch (error) {
          reject(error);
        }
      },
      fail(error) {
        console.warn("MYROOT_CLOUD_CONTAINER_FAIL", {
          envVersion: env.envVersion,
          cloudServiceName: env.cloudServiceName,
          path: String(requestPath || "").split("?")[0],
          error: safeErrorSummary(error),
        });
        reject(new Error(requestFailMessage(error, "cloudContainer")));
      },
    });
  });
}

function request(options) {
  const token = getToken();
  const requestId = String(options.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    .replace(/[^A-Za-z0-9:._-]/g, "")
    .slice(0, 120);
  if (env.requestAdapter === "cloudContainer") return requestByCloudContainer(options, token, requestId);
  return requestByWxRequest(options, token, requestId);
}

module.exports = {
  clearToken,
  getToken,
  request,
  safeErrorSummary,
  setToken,
  stringifyError,
};
