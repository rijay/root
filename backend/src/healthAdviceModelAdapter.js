const MODEL_INPUT_VERSION = "root4u-health-advice-input-v1";

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
  const endpoint = text(env.ROOT_HEALTH_ADVICE_MODEL_ENDPOINT);
  const apiKey = text(env.ROOT_HEALTH_ADVICE_MODEL_API_KEY);
  const modelName = text(env.ROOT_HEALTH_ADVICE_MODEL_NAME);
  const processorName = text(env.ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Boolean(
    requested
    && /^https:\/\//i.test(endpoint)
    && apiKey
    && modelName
    && processorName
    && typeof fetchImpl === "function"
  );
  const timeoutMs = Math.max(1000, Math.min(10000, Number(env.ROOT_HEALTH_ADVICE_MODEL_TIMEOUT_MS || 5000)));

  return Object.freeze({
    adapterId: "OPENAI_COMPATIBLE_HEALTH_ADVICE_V1",
    configured,
    modelName,
    processorName,
    inputVersion: MODEL_INPUT_VERSION,
    async generate(input = {}) {
      if (!configured) throw adapterError("HEALTH_ADVICE_MODEL_NOT_CONFIGURED", "健康建议模型尚未配置");
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
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "你是 Root4U 的健康生活方式建议助手。只输出 JSON，不做诊断、治疗、用药、疾病判断或疗效承诺。输出字段必须为 summary、actions、cautions、followUp；actions 必须恰好三条，建议应低风险且可执行。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  inputVersion: MODEL_INPUT_VERSION,
                  states: Array.isArray(input.states) ? input.states : [],
                }),
              },
            ],
          }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response || !response.ok) {
          throw adapterError("HEALTH_ADVICE_MODEL_HTTP_ERROR", "健康建议模型暂时不可用");
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
  parseJsonContent,
};
