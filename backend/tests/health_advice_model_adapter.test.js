const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEnvironmentHealthAdviceModelAdapter,
  normalizeChatCompletionsEndpoint,
  parseJsonContent,
} = require("../src/healthAdviceModelAdapter");

const DATA_POLICY_ENV = Object.freeze({
  ROOT_HEALTH_ADVICE_MODEL_SECONDARY_USE: "NONE",
  ROOT_HEALTH_ADVICE_MODEL_PROCESSING_REGION: "CN_MAINLAND",
  ROOT_HEALTH_ADVICE_MODEL_OTHER_PROCESSORS: "NONE",
  ROOT_HEALTH_ADVICE_MODEL_LOG_RETENTION_DAYS: "0",
  ROOT_HEALTH_ADVICE_MODEL_CACHE_RETENTION_DAYS: "0",
  ROOT_HEALTH_ADVICE_MODEL_DATA_POLICY_VERIFIED: "true",
});

function validStates() {
  return [
    {
      assessmentType: "INITIAL",
      questionnaireVersion: 1,
      resultCode: "STEADY",
      title: "状态较平稳",
    },
    {
      assessmentType: "GUT_REGULARITY",
      questionnaireVersion: 2,
      resultCode: "HEALTHY",
      title: "肠道节奏挺稳",
    },
  ];
}

test("health advice model Adapter fails closed until every privacy and provider field is configured", () => {
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
  }, { fetchImpl: async () => ({ ok: true }) });
  assert.equal(adapter.configured, false, "受托处理者名称缺失时不得调用模型");
});

test("health advice model Adapter rejects an unverified or retaining provider policy", () => {
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
    ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "境内模型服务商",
    ROOT_HEALTH_ADVICE_MODEL_LOG_RETENTION_DAYS: "7",
  }, { fetchImpl: async () => ({ ok: true }) });
  assert.equal(adapter.configured, false);
  assert.deepEqual(adapter.dataPolicy.issues, ["PROVIDER_LOG_RETENTION_MUST_BE_ZERO"]);
});

test("an explicitly empty injected credential cannot fall back to a process environment secret", () => {
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "environment-secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
    ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "境内模型服务商",
  }, {
    apiKey: "",
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(adapter.configured, false);
});

test("health advice model Adapter sends the fixed minimum JSON Interface", async () => {
  let request;
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
    ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "境内模型服务商",
  }, {
    async fetchImpl(url, options) {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "{\"summary\":\"保持观察\",\"actions\":[\"行动一\",\"行动二\",\"行动三\"],\"cautions\":[],\"followUp\":\"一周后回测\"}" } }] };
        },
      };
    },
  });
  const states = validStates();
  states[0].rootUserId = "must-not-leave-server";
  states[0].answers = { private: true };
  states[0].safetyStopped = false;
  const result = await adapter.generate({ states });
  assert.equal(result.actions.length, 3);
  assert.equal(request.url, "https://model.example.com/v1/chat/completions");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "health-model");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.response_format, undefined);
  assert.equal(body.messages[1].content.includes("STEADY"), true);
  assert.equal(body.messages[1].content.includes("secret"), false);
  assert.equal(body.messages[1].content.includes("must-not-leave-server"), false);
  assert.equal(body.messages[1].content.includes("answers"), false);
  assert.equal(body.messages[1].content.includes("safetyStopped"), false);
});

test("health advice model Adapter rejects incomplete states before network access", async () => {
  let called = false;
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
    ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "境内模型服务商",
  }, {
    async fetchImpl() { called = true; return { ok: true }; },
  });

  await assert.rejects(
    () => adapter.generate({ states: validStates().slice(0, 1) }),
    (error) => error.code === "HEALTH_ADVICE_MODEL_INPUT_INVALID"
      && !error.message.includes("STEADY")
  );
  assert.equal(called, false);
  await assert.rejects(
    () => adapter.generate({ states: [
      validStates()[0],
      { ...validStates()[0], resultCode: "HEALTHY" },
    ] }),
    (error) => error.code === "HEALTH_ADVICE_MODEL_INPUT_INVALID"
  );
  assert.equal(called, false);
});

test("health advice model Adapter accepts a CloudBase Base URL and a non-env credential", async () => {
  let request;
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_BASE_URL: "https://example.api.tcloudbasegateway.com/v1/ai/cloudbase/",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "hy3",
    ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "腾讯云 CloudBase AI",
  }, {
    apiKey: "keychain-only-secret",
    async fetchImpl(url, options) {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "{\"summary\":\"保持观察\",\"actions\":[\"行动一\",\"行动二\",\"行动三\"],\"cautions\":[],\"followUp\":\"一周后回测\"}" } }] };
        },
      };
    },
  });

  assert.equal(adapter.configured, true);
  await adapter.generate({ states: validStates() });
  assert.equal(request.url, "https://example.api.tcloudbasegateway.com/v1/ai/cloudbase/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer keychain-only-secret");
});

test("chat completions endpoint normalization rejects unsafe URL material", () => {
  assert.equal(normalizeChatCompletionsEndpoint("http://example.com/v1"), "");
  assert.equal(normalizeChatCompletionsEndpoint("https://user:pass@example.com/v1"), "");
  assert.equal(normalizeChatCompletionsEndpoint("https://example.com/v1?token=value"), "");
  assert.equal(
    normalizeChatCompletionsEndpoint("https://example.com/v1/chat/completions"),
    "https://example.com/v1/chat/completions"
  );
});

test("health advice model Adapter reports only a safe HTTP status on provider rejection", async () => {
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ...DATA_POLICY_ENV,
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
    ROOT_HEALTH_ADVICE_MODEL_PROCESSOR_NAME: "境内模型服务商",
  }, {
    fetchImpl: async () => ({ ok: false, status: 400 }),
  });
  await assert.rejects(
    () => adapter.generate({ states: validStates() }),
    (error) => error.code === "HEALTH_ADVICE_MODEL_HTTP_ERROR"
      && error.status === 400
      && !error.message.includes("secret")
  );
});

test("model JSON parser accepts a fenced JSON object", () => {
  assert.deepEqual(parseJsonContent("```json\n{\"ok\":true}\n```"), { ok: true });
});
