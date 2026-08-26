const fs = require("node:fs");
const path = require("node:path");
const {
  CATALOG_PROMPT_VERSION,
  CATALOG_VERSION,
  SYNTHETIC_SCENARIOS,
  TAXONOMY_VERSION,
  scenarioKey,
  validateCatalogAdvice,
} = require("../src/healthAdviceCatalog");
const { createEnvironmentHealthAdviceCatalogModelAdapter } = require("../src/healthAdviceModelAdapter");
const { readLocalHealthAdviceApiKey } = require("../src/localHealthAdviceKeychain");

const GENERATOR_ENV = Object.freeze({
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENABLED: "true",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_BASE_URL: "https://myroot-prod-d5gl3gzg7115f149a.api.tcloudbasegateway.com/v1/ai/cloudbase",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_NAME: "hy3",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_TIMEOUT_MS: "20000",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_MAX_TOKENS: "1200",
});

function outputPath(argv = process.argv.slice(2)) {
  const prefix = "--output=";
  const argument = argv.find((item) => String(item).startsWith(prefix));
  const value = argument ? String(argument).slice(prefix.length).trim() : "";
  if (!value) {
    const error = new Error("必须用 --output=... 指定新的草稿文件路径");
    error.code = "HEALTH_ADVICE_CATALOG_OUTPUT_REQUIRED";
    throw error;
  }
  return path.resolve(value);
}

async function run(options = {}) {
  const target = outputPath(options.argv);
  if (fs.existsSync(target)) {
    const error = new Error("草稿文件已存在，拒绝覆盖");
    error.code = "HEALTH_ADVICE_CATALOG_OUTPUT_EXISTS";
    throw error;
  }
  const apiKey = (options.readApiKey || readLocalHealthAdviceApiKey)();
  const adapter = createEnvironmentHealthAdviceCatalogModelAdapter({ ...process.env, ...GENERATOR_ENV }, {
    apiKey,
    fetchImpl: options.fetchImpl,
  });
  if (!adapter.configured) {
    const error = new Error("CloudBase 合成目录生成器未配置；需要本地钥匙串凭据");
    error.code = "HEALTH_ADVICE_CATALOG_MODEL_NOT_CONFIGURED";
    throw error;
  }

  const entries = [];
  for (const scenario of SYNTHETIC_SCENARIOS) {
    const advice = validateCatalogAdvice(await adapter.generateSyntheticScenario(scenario));
    if (!advice) {
      const error = new Error(`场景 ${scenarioKey(scenario)} 的模型输出未通过内容结构校验`);
      error.code = "HEALTH_ADVICE_CATALOG_MODEL_OUTPUT_INVALID";
      throw error;
    }
    entries.push({
      ...scenario,
      scenarioKey: scenarioKey(scenario),
      advice,
      reviewStatus: "PENDING_REVIEW",
    });
  }

  const draft = {
    schemaVersion: 1,
    catalogVersion: CATALOG_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: CATALOG_PROMPT_VERSION,
    modelName: adapter.modelName,
    generatedAt: new Date().toISOString(),
    reviewStatus: "DRAFT",
    reviewedAt: "",
    reviewer: "",
    entries,
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { output: target, scenarioCount: entries.length, modelName: adapter.modelName };
}

if (require.main === module) {
  run().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { GENERATOR_ENV, outputPath, run };
