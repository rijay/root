const http = require("node:http");
const https = require("node:https");

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_TEXT = 240;
const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-wechat-request-id",
  "x-tencent-request-id",
  "x-wx-trace-id",
  "x-wx-traceid",
  "traceid",
];

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function hasHeader(headers, name) {
  const target = String(name).toLowerCase();
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === target);
}

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers && headers[name];
    if (Array.isArray(value) && value[0]) return String(value[0]);
    if (value) return String(value);
  }
  return "";
}

function sanitizeTraceValue(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,96}$/.test(normalized) ? normalized : "";
}

function sanitizeDiagnosticText(value, limit = MAX_DIAGNOSTIC_TEXT) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/("(?:access_token|cloudbase_access_token|secret|session_key|token|openid|unionid|touser|phone|mobile|msgid)"\s*:\s*)"[^"]*"/gi, "$1\"[REDACTED]\"")
    .replace(/\b(access_token|cloudbase_access_token|secret|session_key|token|openid|unionid|touser|phone|mobile|msgid)\s*[=:]\s*([^&\s,;}]+)/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z0-9._~-]{24,}\b/g, "[REDACTED_ID]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function responseMetadata(res, rawBody) {
  const contentType = sanitizeDiagnosticText(firstHeader(res.headers, ["content-type"]), 64);
  const traceId = sanitizeTraceValue(firstHeader(res.headers, TRACE_HEADER_NAMES));
  return {
    contentType,
    traceId,
    bodyPreview: sanitizeDiagnosticText(rawBody),
  };
}

function requestJson(url, options = {}) {
  const target = url instanceof URL ? url : new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const headers = { ...(options.headers || {}) };
  const hasBody = options.body !== undefined && options.body !== null;
  const body = hasBody
    ? (Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body)))
    : null;
  if (body && !hasHeader(headers, "content-length") && !hasHeader(headers, "transfer-encoding")) {
    headers["Content-Length"] = String(body.length);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request(target, {
      method: options.method || "GET",
      headers,
      family: 4,
      timeout: options.timeoutMs || 8000,
    }, (res) => {
      const chunks = [];
      let responseBytes = 0;
      res.on("data", (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += buffer.length;
        if (responseBytes > MAX_RESPONSE_BYTES) {
          const error = new Error("WECHAT_RESPONSE_TOO_LARGE");
          error.code = "WECHAT_RESPONSE_TOO_LARGE";
          res.destroy(error);
          finishWithError(error);
          return;
        }
        chunks.push(buffer);
      });
      res.on("error", finishWithError);
      res.on("end", () => {
        if (settled) return;
        settled = true;
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let payload = {};
        let parseError = false;
        if (rawBody.trim()) {
          try {
            payload = JSON.parse(rawBody);
          } catch (error) {
            parseError = true;
          }
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          payload,
          parseError,
          ...responseMetadata(res, rawBody),
        });
      });
    });
    request.on("timeout", () => {
      const error = new Error("WECHAT_REQUEST_TIMEOUT");
      error.code = "WECHAT_REQUEST_TIMEOUT";
      request.destroy(error);
    });
    request.on("error", finishWithError);
    request.end(body || undefined);
  });
}

function sanitizeWechatErrorUrl(url) {
  const target = url instanceof URL ? url : new URL(url);
  return { host: target.host, path: target.pathname, protocol: target.protocol };
}

function hasWechatError(payload) {
  if (!payload || payload.errcode === undefined || payload.errcode === null) return false;
  return String(payload.errcode) !== "0";
}

function diagnosticSuffix(result, includeBody) {
  const parts = [];
  if (result.contentType) parts.push(`content-type=${result.contentType}`);
  if (result.traceId) parts.push(`trace=${result.traceId}`);
  if (includeBody && result.bodyPreview) parts.push(`body=${result.bodyPreview}`);
  return parts.length ? `；${parts.join("；")}` : "";
}

function responseError(result, headline, includeBody) {
  const error = businessError(1006, `${headline}${diagnosticSuffix(result, includeBody)}`.slice(0, 480));
  error.externalHttpStatus = String(result.status || 0);
  if (hasWechatError(result.payload)) error.externalCode = String(result.payload.errcode);
  return error;
}

async function fetchWechatJson(url, options) {
  let result;
  try {
    result = await requestJson(url, options);
  } catch (error) {
    console.error("[wechat] request failed", {
      ...sanitizeWechatErrorUrl(url),
      error: error && (error.code || error.message || String(error)),
    });
    throw businessError(1006, "微信登录服务暂时不可用，请稍后重试");
  }

  if (!result.ok) {
    const providerMessage = sanitizeDiagnosticText(result.payload && result.payload.errmsg);
    throw responseError(
      result,
      providerMessage || `微信接口请求失败：HTTP ${result.status}`,
      !providerMessage
    );
  }
  if (result.parseError) {
    throw responseError(result, `微信接口响应无法解析：HTTP ${result.status}`, true);
  }
  if (hasWechatError(result.payload)) {
    const providerMessage = sanitizeDiagnosticText(result.payload.errmsg);
    throw responseError(result, providerMessage || "微信接口返回业务错误", false);
  }
  return result.payload;
}

module.exports = {
  fetchWechatJson,
};
