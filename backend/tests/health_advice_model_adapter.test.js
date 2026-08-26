const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEnvironmentHealthAdviceCatalogModelAdapter,
  normalizeChatCompletionsEndpoint,
  parseJsonContent,
  syntheticPromptInput,
} = require("../src/healthAdviceModelAdapter");

const MODEL_ENV = Object.freeze({
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENABLED: "true",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_NAME: "hy3",
});

const scenario = Object.freeze({ initialResultCode: "BASELINE", gutResultCode: "HEALTHY" });

test("synthetic catalog Adapter requires the offline generation namespace and credential", () => {
  assert.equal(createEnvironmentHealthAdviceCatalogModelAdapter({
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "legacy-runtime-secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "hy3",
  }).configured, false);
  assert.equal(createEnvironmentHealthAdviceCatalogModelAdapter(MODEL_ENV, { apiKey: "" }).configured, false);
});

test("synthetic catalog Adapter sends only the fixed product taxonomy scenario", async () => {
  let request;
  const adapter = createEnvironmentHealthAdviceCatalogModelAdapter(MODEL_ENV, {
    apiKey: "keychain-secret",
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

  const result = await adapter.generateSyntheticScenario(scenario);
  assert.equal(result.actions.length, 3);
  const body = JSON.parse(request.options.body);
  const prompt = JSON.parse(body.messages[1].content);
  assert.equal(request.url, MODEL_ENV.ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENDPOINT);
  assert.deepEqual(Object.keys(prompt).sort(), ["inputVersion", "promptVersion", "scenario", "taxonomyVersion"]);
  assert.deepEqual(Object.keys(prompt.scenario).sort(), [
    "gutDescription", "gutLabel", "gutResultCode", "initialDescription", "initialLabel", "initialResultCode",
  ]);
  assert.equal(JSON.stringify(body).includes("keychain-secret"), false);
  assert.equal(JSON.stringify(body).includes("questionnaireVersion"), false);
  assert.equal(JSON.stringify(body).includes("rootUserId"), false);
  assert.match(body.messages[0].content, /不代表任何真实用户/);
});

test("synthetic scenario rejects extra fields and unknown codes before network access", async () => {
  let called = false;
  const adapter = createEnvironmentHealthAdviceCatalogModelAdapter(MODEL_ENV, {
    apiKey: "keychain-secret",
    async fetchImpl() { called = true; return { ok: true }; },
  });
  await assert.rejects(
    () => adapter.generateSyntheticScenario({ ...scenario, rootUserId: "must-not-leave" }),
    { code: "HEALTH_ADVICE_CATALOG_SCENARIO_INVALID" },
  );
  await assert.rejects(
    () => adapter.generateSyntheticScenario({ initialResultCode: "UNKNOWN", gutResultCode: "HEALTHY" }),
    { code: "HEALTH_ADVICE_CATALOG_SCENARIO_INVALID" },
  );
  assert.equal(called, false);
});

test("synthetic prompt material comes only from the frozen taxonomy", () => {
  const input = syntheticPromptInput(scenario);
  assert.equal(input.scenario.initialResultCode, "BASELINE");
  assert.equal(input.scenario.gutResultCode, "HEALTHY");
  assert.equal(Object.isFrozen(input.scenario), true);
});

test("CloudBase base URL normalization and safe errors remain enforced", async () => {
  assert.equal(normalizeChatCompletionsEndpoint("http://example.com/v1"), "");
  assert.equal(normalizeChatCompletionsEndpoint("https://user:pass@example.com/v1"), "");
  assert.equal(normalizeChatCompletionsEndpoint("https://example.com/v1?token=value"), "");
  assert.equal(normalizeChatCompletionsEndpoint("https://example.com/v1"), "https://example.com/v1/chat/completions");

  const adapter = createEnvironmentHealthAdviceCatalogModelAdapter(MODEL_ENV, {
    apiKey: "keychain-secret",
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  await assert.rejects(
    () => adapter.generateSyntheticScenario(scenario),
    (error) => error.code === "HEALTH_ADVICE_CATALOG_MODEL_HTTP_ERROR"
      && error.status === 429
      && !error.message.includes("keychain-secret"),
  );
});

test("model JSON parser accepts a fenced JSON object", () => {
  assert.deepEqual(parseJsonContent("```json\n{\"ok\":true}\n```"), { ok: true });
});
