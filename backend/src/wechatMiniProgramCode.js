const http = require("node:http");
const https = require("node:https");

const { resolveWechatAccessToken } = require("./wechatAccessToken");
const { resolveWechatOpenApiUrl } = require("./wechatOpenApiEndpoint");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function businessError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function credentials(env = {}) {
  return {
    appid: env.ROOT_WECHAT_APPID || env.WECHAT_APPID || env.WX_APPID || "",
    secret: env.ROOT_WECHAT_APPSECRET || env.WECHAT_APPSECRET || env.WECHAT_SECRET || env.WX_SECRET || "",
  };
}

function requestBuffer(url, options = {}) {
  const transport = url.protocol === "http:" ? http : https;
  const body = Buffer.from(options.body || "");
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "POST",
      family: 4,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          response.destroy(businessError("WECHAT_CODE_TOO_LARGE", "微信小程序码响应过大"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("error", reject);
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        contentType: String(response.headers["content-type"] || "").toLowerCase(),
        body: Buffer.concat(chunks),
      }));
    });
    request.on("timeout", () => request.destroy(businessError("WECHAT_CODE_TIMEOUT", "微信小程序码生成超时")));
    request.on("error", reject);
    request.end(body);
  });
}

function providerError(result) {
  try {
    const payload = JSON.parse(result.body.toString("utf8"));
    const code = String(payload.errcode || "WECHAT_CODE_FAILED").replace(/[^A-Za-z0-9_-]/g, "_");
    return businessError(code, `微信小程序码生成失败（${code}）`);
  } catch (_) {
    return businessError("WECHAT_CODE_FAILED", "微信小程序码生成失败");
  }
}

async function generateChannelCodeImage(code, context = {}) {
  if (context.wechatCodeGenerator && typeof context.wechatCodeGenerator.generate === "function") {
    const generated = await context.wechatCodeGenerator.generate(code);
    if (!generated || !Buffer.isBuffer(generated.body)) {
      throw businessError("WECHAT_CODE_ADAPTER_INVALID", "微信小程序码生成适配器返回无效");
    }
    return { body: generated.body, contentType: generated.contentType || "image/png" };
  }
  const env = context.env || process.env;
  const accessToken = await resolveWechatAccessToken(credentials(env));
  const url = resolveWechatOpenApiUrl("/wxa/getwxacodeunlimit", env);
  url.searchParams.set("access_token", accessToken);
  const payload = {
    scene: code.scene,
    page: String(code.targetPage || "").replace(/^\//, ""),
    check_path: true,
    env_version: code.envVersion || "release",
    width: 430,
  };
  const result = await requestBuffer(url, { body: JSON.stringify(payload) });
  if (result.status < 200 || result.status >= 300 || result.contentType.includes("json")) {
    throw providerError(result);
  }
  if (!result.body.length) throw businessError("WECHAT_CODE_EMPTY", "微信小程序码内容为空");
  return {
    body: result.body,
    contentType: result.contentType.startsWith("image/") ? result.contentType.split(";")[0] : "image/png",
  };
}

module.exports = Object.freeze({
  generateChannelCodeImage,
});
