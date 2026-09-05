const {
  CATALOG_PROMPT_VERSION,
  GUT_RESULTS,
  INITIAL_RESULTS,
  TAXONOMY_VERSION,
  normalizeSyntheticScenario,
  requiredFiberActionForGutResult,
} = require("./healthAdviceCatalog");

const MODEL_INPUT_VERSION = "root4u-health-advice-synthetic-input-v1";

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function text(value) {
  return String(value || "").trim();
}

function adapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeChatCompletionsEndpoint(value) {
  const source = text(value);
  if (!source) return "";
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.endsWith("/chat/completions")
      ? pathname
      : `${pathname}/chat/completions`;
    return url.toString();
  } catch {
    return "";
  }
}

function parseJsonContent(value) {
  const source = text(value).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch {
    throw adapterError("HEALTH_ADVICE_MODEL_INVALID_JSON", "模型未返回有效建议结构");
  }
}

function syntheticPromptInput(value) {
  const scenario = normalizeSyntheticScenario(value);
  return Object.freeze({
    inputVersion: MODEL_INPUT_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: CATALOG_PROMPT_VERSION,
    scenario: Object.freeze({
      initialResultCode: scenario.initialResultCode,
      initialLabel: INITIAL_RESULTS[scenario.initialResultCode].label,
      initialDescription: INITIAL_RESULTS[scenario.initialResultCode].description,
      gutResultCode: scenario.gutResultCode,
      gutLabel: GUT_RESULTS[scenario.gutResultCode].label,
      gutDescription: GUT_RESULTS[scenario.gutResultCode].description,
      requiredFiberAction: requiredFiberActionForGutResult(scenario.gutResultCode),
    }),
  });
}

function createEnvironmentHealthAdviceCatalogModelAdapter(env = process.env, options = {}) {
  const requested = enabled(env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENABLED);
  const endpoint = normalizeChatCompletionsEndpoint(
    env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_BASE_URL || env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENDPOINT
  );
  const apiKey = text(Object.hasOwn(options, "apiKey")
    ? options.apiKey
    : env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_API_KEY);
  const modelName = text(env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_NAME);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Boolean(requested && endpoint && apiKey && modelName && typeof fetchImpl === "function");
  const timeoutMs = Math.max(1000, Math.min(30000, Number(env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_TIMEOUT_MS || 20000)));
  const maxTokens = Math.max(400, Math.min(2000, Number(env.ROOT_HEALTH_ADVICE_CATALOG_MODEL_MAX_TOKENS || 1200)));

  return Object.freeze({
    adapterId: "OPENAI_COMPATIBLE_SYNTHETIC_HEALTH_ADVICE_CATALOG_V1",
    configured,
    modelName,
    inputVersion: MODEL_INPUT_VERSION,
    async generateSyntheticScenario(input = {}) {
      if (!configured) throw adapterError("HEALTH_ADVICE_CATALOG_MODEL_NOT_CONFIGURED", "健康建议目录模型尚未配置");
      const promptInput = syntheticPromptInput(input);
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelName,
            stream: false,
            temperature: 0.2,
            max_tokens: maxTokens,
            messages: [
              {
                role: "system",
                content: "你是 Root4U 的通用健康生活方式内容助手。输入是产品团队预先定义的合成状态枚举，不代表任何真实用户。不要输出思考过程，直接输出 JSON。不做诊断、治疗、用药、疾病判断或疗效承诺。输出字段必须为 summary、actions、cautions、followUp；actions 必须恰好三条，actions[0] 必须逐字使用 scenario.requiredFiberAction，不得改写、删除或后移；其余建议应低风险且可执行。",
              },
              { role: "user", content: JSON.stringify(promptInput) },
            ],
          }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response || !response.ok) {
          const error = adapterError("HEALTH_ADVICE_CATALOG_MODEL_HTTP_ERROR", "健康建议目录模型暂时不可用");
          error.status = Number(response && response.status) || 0;
          throw error;
        }
        const payload = await response.json();
        const content = payload && payload.choices && payload.choices[0]
          && payload.choices[0].message && payload.choices[0].message.content;
        return parseJsonContent(content);
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw adapterError("HEALTH_ADVICE_CATALOG_MODEL_TIMEOUT", "健康建议目录生成超时");
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  });
}

module.exports = {
  MODEL_INPUT_VERSION,
  createEnvironmentHealthAdviceCatalogModelAdapter,
  normalizeChatCompletionsEndpoint,
  parseJsonContent,
  syntheticPromptInput,
};
