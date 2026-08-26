const { resolveHealthAiDataPolicy } = require("./healthAiDataPolicy");

const MODEL_INPUT_VERSION = "root4u-health-advice-input-v1";
const REQUIRED_ASSESSMENT_TYPES = Object.freeze(["INITIAL", "GUT_REGULARITY"]);

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

function normalizeModelStates(value) {
  if (!Array.isArray(value) || value.length !== REQUIRED_ASSESSMENT_TYPES.length) {
    throw adapterError("HEALTH_ADVICE_MODEL_INPUT_INVALID", "健康建议模型输入无效");
  }
  const states = value.map((item) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const assessmentType = text(source.assessmentType).toUpperCase();
    const questionnaireVersion = Number(source.questionnaireVersion);
    const resultCode = text(source.resultCode).toUpperCase();
    const title = text(source.title);
    if (!REQUIRED_ASSESSMENT_TYPES.includes(assessmentType)
      || !Number.isInteger(questionnaireVersion)
      || questionnaireVersion < 1
      || questionnaireVersion > 9999
      || !/^[A-Z0-9_:-]{1,64}$/.test(resultCode)
      || !title
      || title.length > 64) {
      throw adapterError("HEALTH_ADVICE_MODEL_INPUT_INVALID", "健康建议模型输入无效");
    }
    return { assessmentType, questionnaireVersion, resultCode, title };
  });
  if (new Set(states.map((item) => item.assessmentType)).size !== REQUIRED_ASSESSMENT_TYPES.length) {
    throw adapterError("HEALTH_ADVICE_MODEL_INPUT_INVALID", "健康建议模型输入无效");
  }
  return states;
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
  } catch (error) {
    return "";
  }
}

function parseJsonContent(value) {
  const source = text(value).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw adapterError("HEALTH_ADVICE_MODEL_INVALID_JSON", "模型未返回有效建议结构");
  }
}

function createEnvironmentHealthAdviceModelAdapter(env = process.env, options = {}) {
  const requested = enabled(env.ROOT_HEALTH_ADVICE_MODEL_ENABLED);
  const endpoint = normalizeChatCompletionsEndpoint(
    env.ROOT_HEALTH_ADVICE_MODEL_BASE_URL || env.ROOT_HEALTH_ADVICE_MODEL_ENDPOINT
  );
  const apiKey = text(Object.hasOwn(options, "apiKey")
    ? options.apiKey
    : env.ROOT_HEALTH_ADVICE_MODEL_API_KEY);
  const modelName = text(env.ROOT_HEALTH_ADVICE_MODEL_NAME);
  const processorName = text(env.ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME);
  const dataPolicy = resolveHealthAiDataPolicy(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Boolean(
    requested
    && endpoint
    && apiKey
    && modelName
    && processorName
    && dataPolicy.configured
    && typeof fetchImpl === "function"
  );
  const timeoutMs = Math.max(1000, Math.min(30000, Number(env.ROOT_HEALTH_ADVICE_MODEL_TIMEOUT_MS || 15000)));
  const maxTokens = Math.max(400, Math.min(2000, Number(env.ROOT_HEALTH_ADVICE_MODEL_MAX_TOKENS || 1200)));

  return Object.freeze({
    adapterId: "OPENAI_COMPATIBLE_HEALTH_ADVICE_V1",
    configured,
    modelName,
    processorName,
    dataPolicy,
    inputVersion: MODEL_INPUT_VERSION,
    async generate(input = {}) {
      if (!configured) throw adapterError("HEALTH_ADVICE_MODEL_NOT_CONFIGURED", "健康建议模型尚未配置");
      const states = normalizeModelStates(input.states);
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
                content: "你是 Root4U 的健康生活方式建议助手。不要输出思考过程，直接输出 JSON。不做诊断、治疗、用药、疾病判断或疗效承诺。输出字段必须为 summary、actions、cautions、followUp；actions 必须恰好三条，建议应低风险且可执行。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  inputVersion: MODEL_INPUT_VERSION,
                  states,
                }),
              },
            ],
          }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response || !response.ok) {
          const error = adapterError("HEALTH_ADVICE_MODEL_HTTP_ERROR", "健康建议模型暂时不可用");
          error.status = Number(response && response.status) || 0;
          throw error;
        }
        const payload = await response.json();
        const content = payload && payload.choices && payload.choices[0]
          && payload.choices[0].message && payload.choices[0].message.content;
        return parseJsonContent(content);
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw adapterError("HEALTH_ADVICE_MODEL_TIMEOUT", "健康建议生成超时");
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
  createEnvironmentHealthAdviceModelAdapter,
  normalizeChatCompletionsEndpoint,
  parseJsonContent,
};
