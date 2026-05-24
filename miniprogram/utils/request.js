const env = require("../config/env");

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

function toError(value, fallback) {
  const message = stringifyError(value) || fallback;
  return new Error(message);
}

function requestFailMessage(error, adapter) {
  const message = stringifyError(error);
  if (message.includes("timeout")) return "请求超时，请确认后台服务和代理设置";
  if (adapter === "cloudContainer") return "云托管调用失败，请确认云环境和服务名配置";
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
      timeout: options.timeout || 10000,
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
        reject(toError(error, requestFailMessage(error, "wxRequest")));
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
      reject(new Error("请先在 config/env.js 配置云托管环境和服务名"));
      return;
    }
    wx.cloud.callContainer({
      config: {
        env: env.cloudEnvId,
      },
      path: options.url,
      method: options.method || "GET",
      timeout: options.timeout || 10000,
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
        reject(toError(error, requestFailMessage(error, "cloudContainer")));
      },
    });
  });
}

function request(options) {
  const token = getToken();
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (env.requestAdapter === "cloudContainer") return requestByCloudContainer(options, token, requestId);
  return requestByWxRequest(options, token, requestId);
}

module.exports = {
  clearToken,
  getToken,
  request,
  setToken,
  stringifyError,
};
