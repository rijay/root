const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEnvironmentHealthAdviceModelAdapter,
  parseJsonContent,
} = require("../src/healthAdviceModelAdapter");

test("health advice model Adapter fails closed until every privacy and provider field is configured", () => {
  const adapter = createEnvironmentHealthAdviceModelAdapter({
    ROOT_HEALTH_ADVICE_MODEL_ENABLED: "true",
    ROOT_HEALTH_ADVICE_MODEL_ENDPOINT: "https://model.example.com/v1/chat/completions",
    ROOT_HEALTH_ADVICE_MODEL_API_KEY: "secret",
    ROOT_HEALTH_ADVICE_MODEL_NAME: "health-model",
  }, { fetchImpl: async () => ({ ok: true }) });
  assert.equal(adapter.configured, false, "受托处理者名称缺失时不得调用模型");
});

test("health advice model Adapter sends the fixed minimum JSON Interface", async () => {
  let request;
  const adapter = createEnvironmentHealthAdviceModelAdapter({
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
  const result = await adapter.generate({
    states: [{ assessmentType: "INITIAL", resultCode: "STEADY", title: "状态较平稳" }],
  });
  assert.equal(result.actions.length, 3);
  assert.equal(request.url, "https://model.example.com/v1/chat/completions");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "health-model");
  assert.equal(body.messages[1].content.includes("STEADY"), true);
  assert.equal(body.messages[1].content.includes("secret"), false);
});

test("model JSON parser accepts a fenced JSON object", () => {
  assert.deepEqual(parseJsonContent("```json\n{\"ok\":true}\n```"), { ok: true });
});
