const { nowISO } = require("./dates");
const { isValidPrivacyContact } = require("./privacyConfig");
const {
  parsePreviousKeyring,
  parseRetiredKeyIds,
} = require("./keyRotationConfiguration");
const { parseScopedJobRouteTokens } = require("./jobRouteToken");
const { resolveWechatOpenApiUrl } = require("./wechatOpenApiEndpoint");
const { defaultHealthAdvicePool } = require("./healthAdvicePool");

const FORMAL_JOB_ROUTES = Object.freeze([
  "/api/v1/jobs/health-data-retention-cleanup",
]);

const FORBIDDEN_HEALTH_ADVICE_RUNTIME_ENV = Object.freeze([
  "ROOT_HEALTH_ADVICE_MODEL_ENABLED",
  "ROOT_HEALTH_ADVICE_MODEL_BASE_URL",
  "ROOT_HEALTH_ADVICE_MODEL_ENDPOINT",
  "ROOT_HEALTH_ADVICE_MODEL_API_KEY",
  "ROOT_HEALTH_ADVICE_MODEL_NAME",
  "ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENABLED",
  "ROOT_HEALTH_ADVICE_CATALOG_MODEL_BASE_URL",
  "ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENDPOINT",
  "ROOT_HEALTH_ADVICE_CATALOG_MODEL_API_KEY",
  "ROOT_HEALTH_ADVICE_CATALOG_MODEL_NAME",
]);

const ENV_GROUPS = [
  {
    id: "runtime",
    label: "运行与微信登录",
    ownerRole: "研发",
    required: [
      "WECHAT_APPID",
      "WECHAT_APPSECRET",
      "ROOT_PUBLIC_BASE_URL",
      "ROOT_RELEASE_ID",
      "ROOT_PHONE_HMAC_KEY",
      "ROOT_COMMAND_REQUEST_DIGEST_KEY",
      "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID",
      "ROOT_COMMAND_RESULT_ENCRYPTION_KEY",
      "ROOT_COMMAND_RESULT_KEY_ID",
    ],
    anyOf: [["ROOT_ADMIN_TOKEN", "ROOT_ADMIN_TOKENS"]],
    anyOfRules: {
      ROOT_ADMIN_TOKEN: "nonblank_secret",
      ROOT_ADMIN_TOKENS: "admin_token_rotation",
    },
    requiredRules: {
      ROOT_RELEASE_ID: "release_id",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: "strong_key",
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "key_id",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "strong_key",
      ROOT_COMMAND_RESULT_KEY_ID: "key_id",
    },
    optional: [
      "ROOT_ALLOW_OPENID_LOGIN",
      "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON",
      "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON",
      "ROOT_WECHAT_OPENAPI_BASE_URL",
    ],
    optionalRules: {
      ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: "request_digest_keyring",
      ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: "command_result_keyring",
      ROOT_WECHAT_OPENAPI_BASE_URL: "wechat_official_openapi_origin",
    },
    action: "配置正式小程序密钥、HTTPS 域名、唯一候选 ROOT_RELEASE_ID、手机号 HMAC 密钥、命令请求摘要密钥、命令结果加密密钥及各自 key id，并配置后台访问口令；旧 key 只进入相应有界验证/解密 keyring。",
  },
  {
    id: "privacy_compliance",
    label: "隐私与敏感信息单独同意",
    ownerRole: "产品/运营/研发",
    required: [
      "ROOT_REQUIRE_HEALTH_CONSENT",
      "ROOT_PRIVACY_CONTROLLER_NAME",
      "ROOT_PRIVACY_CONTACT",
      "ROOT_HEALTH_DATA_RETENTION_DAYS",
      "ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED",
    ],
    requiredValues: {
      ROOT_REQUIRE_HEALTH_CONSENT: ["true", "1"],
      ROOT_HEALTH_DATA_RETENTION_DAYS: ["180"],
      ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: ["true", "1"],
    },
    requiredRules: {
      ROOT_PRIVACY_CONTACT: "privacy_contact",
      ROOT_HEALTH_DATA_RETENTION_DAYS: "positive_integer",
    },
    optional: ["ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT"],
    action: "开启健康类敏感信息单独同意，配置处理者、联系方式和保存天数，并启用可审计的到期脱敏与 CloudBase 图片清理 Job。",
  },
  {
    id: "health_advice_pool",
    label: "健康建议审核池",
    ownerRole: "产品/研发/内容审核",
    required: [
      "ROOT_HEALTH_ADVICE_POOL_VERSION",
      "ROOT_HEALTH_ADVICE_POOL_REVIEWED",
    ],
    requiredValues: {
      ROOT_HEALTH_ADVICE_POOL_VERSION: ["root4u-health-advice-pool-v1"],
      ROOT_HEALTH_ADVICE_POOL_REVIEWED: ["true"],
    },
    action: "发布前确认 88 个建议组件全部通过内容与安全审核，五条固定纤维首条逐字一致，并将审核人、审核时间、建议池版本和候选工件证据归档；正式运行环境不得配置模型 API Key，也不得发起实时模型调用。",
  },
  {
    id: "store",
    label: "生产数据仓库",
    ownerRole: "研发",
    required: ["ROOT_STORE_ADAPTER", "ROOT_MYSQL_MIGRATION_MODE", "MYSQL_ADDRESS", "MYSQL_USERNAME", "MYSQL_PASSWORD", "MYSQL_DATABASE"],
    requiredValues: {
      ROOT_STORE_ADAPTER: ["mysql"],
      ROOT_MYSQL_MIGRATION_MODE: ["verify_only"],
    },
    requiredRules: {
      MYSQL_ADDRESS: "mysql_address",
      MYSQL_USERNAME: "opaque_ascii_128",
      MYSQL_PASSWORD: "nonblank_value",
      MYSQL_DATABASE: "opaque_ascii_64",
    },
    optional: [
      "MYSQL_HOST",
      "MYSQL_PORT",
      "ROOT_STORE_FILE",
      "ROOT_SQLITE_FILE",
      "ROOT_ENFORCE_MYSQL_LEAST_PRIVILEGE",
    ],
    optionalRules: {
      MYSQL_HOST: "opaque_ascii_255",
      MYSQL_PORT: "integer_1_65535",
    },
    action: "正式环境使用 MySQL Store Adapter，运行时固定 verify_only 并以独立迁移 Adapter 升级 schema；运行时账号只保留数据读写权限，再确认快照、备份和回滚路径。",
  },
  {
    id: "member_commerce",
    label: "Root 会员商城只读接入",
    ownerRole: "研发/商城运营",
    required: ["ROOT_YOUZAN_ACCESS_TOKEN"],
    requiredRules: {
      ROOT_YOUZAN_ACCESS_TOKEN: "nonblank_secret",
    },
    anyOf: [["ROOT_YOUZAN_KDT_ID", "YOUZAN_GRANT_ID"]],
    anyOfRules: {
      ROOT_YOUZAN_KDT_ID: "positive_integer",
      YOUZAN_GRANT_ID: "positive_integer",
    },
    optional: [
      "ROOT_YOUZAN_TIMEOUT_MS",
      "ROOT_YOUZAN_SUMMARY_CACHE_TTL_MS",
      "ROOT_YOUZAN_PRODUCT_CACHE_TTL_MS",
    ],
    action: "在服务端密钥配置中注入 ROOT 店铺只读 token 和店铺 kdt/grant id，确认商品详情、订单、用户与优惠券读取权限；不得把 token 或会员原始数据下发到小程序。",
  },
  {
    id: "cloudbase_store",
    label: "CloudBase Store 决策",
    ownerRole: "研发",
    required: [
      "ROOT_CLOUDBASE_STORE_DECISION",
      "ROOT_CLOUDBASE_STORE_BACKUP_PLAN",
      "ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN",
    ],
    anyOf: [
      ["ROOT_CLOUDBASE_ENV_ID", "CLOUDBASE_ENV_ID", "TCB_ENV_ID"],
      ["ROOT_CLOUDBASE_REGION", "TENCENTCLOUD_REGION"],
    ],
    anyOfRules: {
      ROOT_CLOUDBASE_ENV_ID: "opaque_ascii_128",
      CLOUDBASE_ENV_ID: "opaque_ascii_128",
      TCB_ENV_ID: "opaque_ascii_128",
    },
    optional: [
      "ROOT_CLOUDBASE_STORE_PROOF",
      "ROOT_PRODUCTION_STORE_DECISION",
    ],
    action: "确认 CloudBase 生产环境、Store 决策、备份计划、回滚计划和发布证明引用。",
  },
  {
    id: "cloudbase_object_storage",
    label: "CloudBase 对象存储",
    ownerRole: "研发",
    required: ["ROOT_CLOUDBASE_STORAGE_TRANSPORT"],
    requiredValues: {
      ROOT_CLOUDBASE_STORAGE_TRANSPORT: ["http", "http_api"],
    },
    anyOf: [
      ["ROOT_CLOUDBASE_ENV_ID", "CLOUDBASE_ENV_ID", "TCB_ENV_ID"],
      ["CLOUDBASE_APIKEY", "ROOT_CLOUDBASE_API_KEY"],
    ],
    anyOfRules: {
      ROOT_CLOUDBASE_ENV_ID: "opaque_ascii_128",
      CLOUDBASE_ENV_ID: "opaque_ascii_128",
      TCB_ENV_ID: "opaque_ascii_128",
    },
    optional: [
      "ROOT_CLOUDBASE_STORAGE_API_BASE_URL",
      "ROOT_CLOUDBASE_STORAGE_TIMEOUT_MS",
    ],
    action: "容器型云托管使用 CloudBase HTTP Interface，并从生产密钥配置注入服务端 API Key；不得把 Key 写入仓库、日志或客户端。",
  },
  {
    id: "cloudbase_jobs",
    label: "CloudBase 定时 Job",
    ownerRole: "研发",
    required: [
      "ROOT_JOB_BASE_URL",
      "ROOT_CLOUDBASE_JOB_INVOCATION_POLICY_EVIDENCE",
      "ROOT_ADMIN_JOB_ROUTE_TOKENS",
      "ROOT_REQUIRE_SCOPED_JOB_TOKENS",
    ],
    requiredValues: {
      ROOT_REQUIRE_SCOPED_JOB_TOKENS: ["true"],
    },
    requiredRules: {
      ROOT_JOB_BASE_URL: "https_url",
      ROOT_CLOUDBASE_JOB_INVOCATION_POLICY_EVIDENCE: "opaque_ascii",
      ROOT_ADMIN_JOB_ROUTE_TOKENS: "job_route_token_rotation",
    },
    optional: [
      "ROOT_JOB_DRY_RUN",
    ],
    optionalRules: {
      ROOT_JOB_DRY_RUN: "exact_boolean",
    },
    action: "在 CloudBase 环境变量或密钥管理中注入 HTTPS Job 域名、可解析的定时任务专用口令轮换配置，并附上仅允许平台 timer 调用函数的策略证据。",
  },
];

function normalizeTarget(target) {
  return target === "production" ? "production" : "gray";
}

function present(env, name) {
  return Boolean(env && env[name]);
}

function isStrongKey(value) {
  const key = String(value || "");
  return Buffer.byteLength(key, "utf8") >= 32
    && Buffer.byteLength(key, "utf8") <= 4096
    && key === key.trim()
    && !key.includes("\u0000")
    && new Set(Array.from(key)).size >= 8;
}

function isPreviousKeyring(value, env, activeKeyIdName) {
  try {
    parsePreviousKeyring(value, {
      activeKeyId: env && env[activeKeyIdName],
      validateSecret: isStrongKey,
    });
    return true;
  } catch {
    return false;
  }
}

function isRetiredKeyIds(value, env) {
  try {
    const retired = parseRetiredKeyIds(value);
    const domains = [
      ["REQUEST_DIGEST", "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID", "ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON"],
      ["COMMAND_RESULT", "ROOT_COMMAND_RESULT_KEY_ID", "ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON"],
    ];
    for (const [domain, activeKeyIdName, previousKeyringName] of domains) {
      const activeKeyId = env && env[activeKeyIdName];
      const previous = parsePreviousKeyring(
        previousKeyringName && env && Object.prototype.hasOwnProperty.call(env, previousKeyringName)
          ? env[previousKeyringName]
          : undefined,
        { activeKeyId, validateSecret: isStrongKey }
      );
      if (retired[domain].includes(activeKeyId)
        || [...previous.keys()].some((keyId) => retired[domain].includes(keyId))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPersistenceKeyId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value || ""));
}

function isReleaseIdentifier(value) {
  const text = String(value || "");
  return text.length >= 1
    && text.length <= 128
    && text === text.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(text);
}

function isOpaqueAscii(value, maximumLength = 96) {
  const text = String(value || "");
  return text.length >= 1
    && text.length <= maximumLength
    && text === text.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text);
}

function isMysqlAddress(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim()) return false;
  const matched = raw.match(/^([^:]+):(\d+)$/);
  if (!matched || !isOpaqueAscii(matched[1], 255)) return false;
  const port = Number(matched[2]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isNonblankValue(value) {
  const raw = String(value || "");
  return raw.length >= 1
    && raw.length <= 4096
    && Boolean(raw.trim())
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isMysqlRoleUsername(value) {
  const raw = String(value || "");
  return raw.length >= 1
    && raw.length <= 128
    && raw === raw.trim()
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isMysqlRolePassword(value) {
  const raw = String(value || "");
  return raw.length >= 16
    && raw.length <= 4096
    && raw === raw.trim()
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isMysqlCurrentUser(value) {
  const raw = String(value || "");
  return raw.length >= 3
    && raw.length <= 288
    && raw.includes("@")
    && /^[\x21-\x7e]+$/.test(raw);
}

function isHttpsBaseUrl(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim()) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:"
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return false;
  }
}

function isHttpsEndpoint(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim() || raw.length > 2048) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:"
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.hash;
  } catch {
    return false;
  }
}

function isWechatOfficialOpenApiOrigin(value) {
  try {
    const target = resolveWechatOpenApiUrl("/", {
      NODE_ENV: "production",
      ROOT_WECHAT_OPENAPI_BASE_URL: value,
    });
    return target.href === "https://api.weixin.qq.com/";
  } catch {
    return false;
  }
}

function isNonblankSecret(value) {
  const raw = String(value || "");
  return raw.length >= 16
    && raw.length <= 4096
    && raw === raw.trim()
    && !/[\u0000-\u001f\u007f]/.test(raw);
}

function isJobTokenRotation(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 64 * 1024) return false;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  if (entries.length < 1 || entries.length > 16) return false;
  const tokens = entries.map((item) => (
    typeof item === "string" ? item : item && typeof item === "object" ? item.token : ""
  ));
  return tokens.every(isNonblankSecret) && new Set(tokens).size === tokens.length;
}

function isJobRouteTokenRotation(value) {
  try {
    const parsed = parseScopedJobRouteTokens({ ROOT_ADMIN_JOB_ROUTE_TOKENS: value });
    return parsed.configured
      && Object.keys(parsed.routes).sort().join("\0") === FORMAL_JOB_ROUTES.join("\0");
  } catch {
    return false;
  }
}

function isAdminTokenRotation(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 64 * 1024) return false;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  let tokens;
  if (Array.isArray(parsed)) {
    if (parsed.length < 1 || parsed.length > 64) return false;
    // parseAdminTokens accepts only object entries in array form. Keeping this
    // rule identical prevents the readiness matrix from accepting a rotation
    // that the runtime would parse as configured-but-empty.
    tokens = parsed.map((item) => (
      item && typeof item === "object" && !Array.isArray(item) ? item.token : ""
    ));
  } else if (parsed && typeof parsed === "object") {
    const entries = Object.values(parsed);
    if (entries.length < 1 || entries.length > 64) return false;
    tokens = entries.map((item) => (
      typeof item === "string"
        ? item
        : item && typeof item === "object" && !Array.isArray(item)
          ? item.token
          : ""
    ));
  } else {
    return false;
  }
  return tokens.every(isNonblankSecret) && new Set(tokens).size === tokens.length;
}

function envRows(env, names = [], requiredValues = {}, requiredRules = {}) {
  return names.map((name) => {
    const expectedValues = requiredValues[name] || [];
    const rule = requiredRules[name] || "";
    const strictConfiguredRule = [
      "request_digest_keyring",
      "command_result_keyring",
      "inbox_content_keyring",
      "retired_key_ids",
    ].includes(rule);
    const isPresent = present(env, name)
      || (strictConfiguredRule && Boolean(env)
        && Object.prototype.hasOwnProperty.call(env, name));
    const normalized = String(env && env[name] || "").trim().toLowerCase();
    const raw = String(env && env[name] || "");
    const validByRule = rule === "positive_integer"
      ? /^\d+$/.test(normalized) && Number(normalized) > 0
      : rule === "nonnegative_integer"
        ? /^\d+$/.test(normalized)
      : rule === "integer_min_3"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 3
      : rule === "integer_3_64"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 3 && Number(normalized) <= 64
      : rule === "integer_3_1024"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 3 && Number(normalized) <= 1024
      : rule === "integer_1_25"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 25
      : rule === "integer_1_64"
        ? /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= 64
      : rule === "integer_1_100"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 100
      : rule === "integer_1_10000"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 10000
      : rule === "integer_1_65535"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 65535
      : rule === "integer_1_1000000000"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 1000000000
      : rule === "integer_0_1000000000"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 0 && Number(normalized) <= 1000000000
      : rule === "integer_1_3600"
        ? /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 3600
      : rule === "exact_true"
        ? raw === "true"
      : rule === "exact_boolean"
        ? raw === "true" || raw === "false"
      : rule === "exact_disengaged"
        ? raw === "DISENGAGED"
      : rule === "opaque_ascii"
        ? isOpaqueAscii(raw)
      : rule === "opaque_ascii_64"
        ? isOpaqueAscii(raw, 64)
      : rule === "opaque_ascii_128"
        ? isOpaqueAscii(raw, 128)
      : rule === "opaque_ascii_255"
        ? isOpaqueAscii(raw, 255)
      : rule === "mysql_address"
        ? isMysqlAddress(raw)
      : rule === "nonblank_value"
        ? isNonblankValue(raw)
      : rule === "nonblank_secret"
        ? isNonblankSecret(raw)
      : rule === "mysql_role_username"
        ? isMysqlRoleUsername(raw)
      : rule === "mysql_role_password"
        ? isMysqlRolePassword(raw)
      : rule === "mysql_current_user"
        ? isMysqlCurrentUser(raw)
      : rule === "sha256_digest"
        ? /^[0-9a-f]{64}$/.test(raw)
      : rule === "https_url"
        ? isHttpsBaseUrl(raw)
      : rule === "https_endpoint"
        ? isHttpsEndpoint(raw)
      : rule === "wechat_official_openapi_origin"
        ? isWechatOfficialOpenApiOrigin(raw)
      : rule === "privacy_contact"
        ? isValidPrivacyContact(String(env && env[name] || ""))
      : rule === "future_datetime_24h"
        ? Number.isFinite(Date.parse(String(env && env[name] || ""))) && Date.parse(String(env && env[name] || "")) > Date.now() + 24 * 60 * 60 * 1000
      : rule === "min_length_32"
        ? String(env && env[name] || "").length >= 32
      : rule === "strong_key"
        ? isStrongKey(env && env[name])
      : rule === "key_id"
        ? isPersistenceKeyId(env && env[name])
      : rule === "release_id"
        ? isReleaseIdentifier(env && env[name])
      : rule === "request_digest_keyring"
        ? isPreviousKeyring(raw, env, "ROOT_COMMAND_REQUEST_DIGEST_KEY_ID")
      : rule === "command_result_keyring"
        ? isPreviousKeyring(raw, env, "ROOT_COMMAND_RESULT_KEY_ID")
      : rule === "retired_key_ids"
        ? isRetiredKeyIds(raw, env)
        : true;
    return {
      name,
      present: isPresent,
      valid: !isPresent || ((!expectedValues.length || expectedValues.includes(normalized)) && validByRule),
      expectedValues,
      expectedDescription: rule === "positive_integer"
        ? "正整数"
        : rule === "nonnegative_integer" ? "非负整数"
        : rule === "integer_min_3" ? "不小于 3 的整数"
        : rule === "integer_3_64" ? "3 至 64 的整数"
        : rule === "integer_3_1024" ? "3 至 1024 的整数"
        : rule === "integer_1_25" ? "1 至 25 的整数"
        : rule === "integer_1_64" ? "1 至 64 的规范十进制整数"
        : rule === "integer_1_100" ? "1 至 100 的整数"
        : rule === "integer_1_10000" ? "1 至 10000 的整数"
        : rule === "integer_1_65535" ? "1 至 65535 的整数"
        : rule === "integer_1_1000000000" ? "1 至 1000000000 的整数"
        : rule === "integer_0_1000000000" ? "0 至 1000000000 的整数"
        : rule === "integer_1_3600" ? "1 至 3600 的整数"
        : rule === "exact_true" ? "精确字符串 true"
        : rule === "exact_boolean" ? "精确字符串 true 或 false"
        : rule === "exact_disengaged" ? "精确字符串 DISENGAGED"
        : rule === "opaque_ascii" ? "1 至 96 位稳定 ASCII 标识"
        : rule === "opaque_ascii_64" ? "1 至 64 位稳定 ASCII 标识"
        : rule === "opaque_ascii_128" ? "1 至 128 位稳定 ASCII 标识"
        : rule === "opaque_ascii_255" ? "1 至 255 位稳定 ASCII 标识"
        : rule === "mysql_address" ? "host:port（端口为 1 至 65535）"
        : rule === "nonblank_value" ? "非空、无控制字符且不超过 4096 位"
        : rule === "nonblank_secret" ? "至少 16 位、无首尾空白或控制字符的服务端密钥"
        : rule === "mysql_role_username" ? "1 至 128 位、无首尾空白或控制字符的 MySQL 角色用户名"
        : rule === "mysql_role_password" ? "16 至 4096 位、无首尾空白或控制字符的 MySQL 角色凭据"
        : rule === "mysql_current_user" ? "3 至 288 位、含 @ 且仅含非空白可打印 ASCII 的 CURRENT_USER"
        : rule === "sha256_digest" ? "64 位小写十六进制 SHA-256 摘要"
        : rule === "https_url" ? "无用户信息、查询或片段的 HTTPS origin"
        : rule === "https_endpoint" ? "无用户信息或片段的 HTTPS endpoint"
        : rule === "wechat_official_openapi_origin" ? "精确微信官方 HTTPS origin https://api.weixin.qq.com"
        : rule === "privacy_contact" ? "有效邮箱或 7 至 15 位电话"
        : rule === "future_datetime_24h" ? "至少晚于当前时间24小时的有效时间"
        : rule === "min_length_32" ? "至少 32 个字符"
        : rule === "strong_key" ? "至少 32 UTF-8 字节、无首尾空白且字符多样性不低于 8"
        : rule === "key_id" ? "1 至 64 位字母、数字、点、下划线或连字符"
        : rule === "request_digest_keyring" ? "不超过 8 个非当前请求摘要 key 的有界 JSON 对象"
        : rule === "command_result_keyring" ? "不超过 8 个非当前命令结果 key 的有界 JSON 对象"
        : rule === "inbox_content_keyring" ? "不超过 8 个非当前 Inbox key 的有界 JSON 对象"
        : rule === "retired_key_ids" ? "精确包含 REQUEST_DIGEST、COMMAND_RESULT、INBOX_CONTENT、NOTIFICATION_RECEIPT 四域的有界 JSON 对象"
        : rule === "release_id" ? "1 至 128 位发布标识（字母或数字开头，仅含 . _ : + -）" : "",
    };
  });
}

function anyOfRows(env, groups = [], rules = {}) {
  return groups.map((names) => {
    const presentNames = names.filter((name) => present(env, name));
    const validNames = presentNames.filter((name) => {
      const rule = rules[name] || "";
      if (rule === "nonblank_secret") return isNonblankSecret(env[name]);
      if (rule === "job_route_token_rotation") return isJobRouteTokenRotation(env[name]);
      if (rule === "job_token_rotation") return isJobTokenRotation(env[name]);
      if (rule === "admin_token_rotation") return isAdminTokenRotation(env[name]);
      if (rule === "https_endpoint") return isHttpsEndpoint(env[name]);
      if (rule === "positive_integer") return /^\d+$/.test(String(env[name] || "")) && Number(env[name]) > 0;
      if (rule === "opaque_ascii_128") return isOpaqueAscii(env[name], 128);
      if (rule === "sha256_digest") return /^[0-9a-f]{64}$/.test(String(env[name] || ""));
      return true;
    });
    const invalidNames = presentNames.filter((name) => !validNames.includes(name));
    return {
      names,
      present: validNames.length > 0 && invalidNames.length === 0,
      presentNames,
      validNames,
      invalidNames,
      missingNames: names.filter((name) => !present(env, name)),
    };
  });
}

function crossGroupMissing(group, env, context = {}) {
  if (group.id === "health_advice_pool") {
    const pool = context.healthAdvicePool || defaultHealthAdvicePool;
    const pendingReviewCount = Number(pool && pool.pendingReviewCount);
    const approvedComponentCount = Number.isFinite(pendingReviewCount)
      ? Math.max(0, 88 - pendingReviewCount)
      : 0;
    const missing = pool && pool.configured
      ? []
      : [`health-advice-pool=需要 88/88 个已审核组件（当前 ${approvedComponentCount}/88）`];
    const forbidden = FORBIDDEN_HEALTH_ADVICE_RUNTIME_ENV.filter((name) => present(env, name));
    if (forbidden.length) missing.push(`health-advice-runtime-model-env=必须移除 ${forbidden.join(", ")}`);
    return missing;
  }
  if (group.id === "cloudbase_jobs") {
    return String(env && env.ROOT_REQUIRE_SCOPED_JOB_TOKENS || "") === "true"
      && !isJobRouteTokenRotation(env && env.ROOT_ADMIN_JOB_ROUTE_TOKENS)
      ? ["ROOT_ADMIN_JOB_ROUTE_TOKENS=每个 exact Job route 的独立轮换 token"]
      : [];
  }
  return [];
}

function groupStatus(group, target, missingRequired, missingAnyOf) {
  if (group.optionalOnly) return "OPTIONAL";
  if (!missingRequired.length && !missingAnyOf.length) return "PASS";
  return target === "production" ? "BLOCKER" : "WARNING";
}

function groupMessage(group, missingRequired, missingAnyOf) {
  if (group.optionalOnly) return group.action;
  const parts = [];
  if (missingRequired.length) parts.push(`缺少 ${missingRequired.join(", ")}`);
  if (missingAnyOf.length) parts.push(`至少需要其一：${missingAnyOf.map((item) => item.names.join(" / ")).join("；")}`);
  return parts.length ? `${parts.join("；")}。${group.action}` : "必要环境变量已配置。";
}

function buildGroup(group, env, target, context = {}) {
  const required = envRows(env, group.required || [], group.requiredValues || {}, group.requiredRules || {});
  const anyOf = anyOfRows(env, group.anyOf || [], group.anyOfRules || {});
  const optional = envRows(env, group.optional || [], {}, group.optionalRules || {});
  const missingRequired = required
    .filter((item) => !item.present || !item.valid)
    .map((item) => item.valid ? item.name : `${item.name}=${item.expectedValues[0] || item.expectedDescription}`);
  missingRequired.push(...crossGroupMissing(group, env, context));
  missingRequired.push(...optional
    .filter((item) => item.present && !item.valid)
    .map((item) => `${item.name}=${item.expectedDescription}`));
  const missingAnyOf = anyOf.filter((item) => !item.present);
  const status = groupStatus(group, target, missingRequired, missingAnyOf);
  return {
    id: group.id,
    label: group.label,
    ownerRole: group.ownerRole,
    status,
    message: groupMessage(group, missingRequired, missingAnyOf),
    required,
    anyOf,
    optional,
    missingRequired,
    missingAnyOf: missingAnyOf.map((item) => item.names),
    action: group.action,
  };
}

function summarize(groups) {
  const blockers = groups.filter((item) => item.status === "BLOCKER").length;
  const warnings = groups.filter((item) => item.status === "WARNING").length;
  const passed = groups.filter((item) => item.status === "PASS").length;
  const optional = groups.filter((item) => item.status === "OPTIONAL").length;
  return { blockers, warnings, passed, optional, total: groups.length };
}

function statusFromSummary(summary) {
  if (summary.blockers) return "BLOCKED";
  if (summary.warnings) return "NEEDS_REVIEW";
  return "READY";
}

function flattenMissingEnv(groups) {
  const names = [];
  for (const group of groups) {
    group.missingRequired.forEach((name) => names.push({ groupId: group.id, groupLabel: group.label, name, kind: "required" }));
    group.missingAnyOf.forEach((set) => names.push({
      groupId: group.id,
      groupLabel: group.label,
      name: set.join(" / "),
      kind: "anyOf",
    }));
  }
  return names;
}

function buildProductionEnvMatrix(env = process.env, options = {}) {
  const target = normalizeTarget(options.target);
  const groups = ENV_GROUPS.map((group) => buildGroup(group, env, target, options));
  const summary = summarize(groups);
  return {
    title: "ROOT 生产环境变量矩阵",
    target,
    status: statusFromSummary(summary),
    generatedAt: nowISO(),
    summary,
    groups,
    missingEnv: flattenMissingEnv(groups).filter((item) => {
      const group = groups.find((entry) => entry.id === item.groupId);
      return group && group.status !== "OPTIONAL";
    }),
    sequence: [
      "先配置运行、隐私、数据仓库、Root 会员商城只读凭据和 CloudBase Store 决策。",
      "再配置对象存储与健康数据清理 Job，并完成 scoped token 校验。",
      "最后通过正式接口、性能和 Candidate 证据门禁，不以本地配置替代真实发布证明。",
    ],
  };
}

module.exports = {
  ENV_GROUPS,
  buildProductionEnvMatrix,
};
