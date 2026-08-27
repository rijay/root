const fs = require("node:fs");
const path = require("node:path");
const {
  CATALOG_PROMPT_VERSION,
  CATALOG_VERSION,
  SYNTHETIC_SCENARIOS,
  TAXONOMY_VERSION,
  applyRequiredFiberAction,
  scenarioKey,
  validateCatalogAdvice,
} = require("../src/healthAdviceCatalog");
const { createEnvironmentHealthAdviceCatalogModelAdapter } = require("../src/healthAdviceModelAdapter");
const { readLocalHealthAdviceApiKey } = require("../src/localHealthAdviceKeychain");

const GENERATOR_ENV = Object.freeze({
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_ENABLED: "true",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_BASE_URL: "https://myroot-prod-d5gl3gzg7115f149a.api.tcloudbasegateway.com/v1/ai/cloudbase",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_NAME: "hy3",
  ROOT_HEALTH_ADVICE_CATALOG_MODEL_TIMEOUT_MS: "30000",
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

function resumeRequested(argv = process.argv.slice(2)) {
  return argv.includes("--resume");
}

function draftManifest(modelName) {
  return {
    schemaVersion: 1,
    catalogVersion: CATALOG_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: CATALOG_PROMPT_VERSION,
    modelName,
    generatedAt: new Date().toISOString(),
    generationStatus: "IN_PROGRESS",
    reviewStatus: "DRAFT",
    reviewedAt: "",
    reviewer: "",
    entries: [],
  };
}

function writeDraft(target, draft, exclusive = false) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = `${JSON.stringify(draft, null, 2)}\n`;
  if (exclusive) {
    fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return;
  }
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readResumeDraft(target, modelName) {
  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    draft = null;
  }
  const entries = draft && Array.isArray(draft.entries) ? draft.entries : [];
  const headerValid = Boolean(
    draft
    && draft.schemaVersion === 1
    && draft.catalogVersion === CATALOG_VERSION
    && draft.taxonomyVersion === TAXONOMY_VERSION
    && draft.promptVersion === CATALOG_PROMPT_VERSION
    && draft.modelName === modelName
    && draft.generationStatus === "IN_PROGRESS"
    && draft.reviewStatus === "DRAFT"
    && draft.reviewedAt === ""
    && draft.reviewer === ""
    && entries.length < SYNTHETIC_SCENARIOS.length
  );
  const entriesValid = headerValid && entries.every((entry, index) => {
    const scenario = SYNTHETIC_SCENARIOS[index];
    return entry
      && entry.initialResultCode === scenario.initialResultCode
      && entry.gutResultCode === scenario.gutResultCode
      && entry.scenarioKey === scenarioKey(scenario)
      && entry.reviewStatus === "PENDING_REVIEW"
      && Boolean(validateCatalogAdvice(entry.advice, scenario));
  });
  if (!entriesValid) {
    const error = new Error("续跑草稿结构、版本、顺序或固定纤维规则无效");
    error.code = "HEALTH_ADVICE_CATALOG_RESUME_INVALID";
    throw error;
  }
  return draft;
}

async function run(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const target = outputPath(argv);
  const resume = resumeRequested(argv);
  const targetExists = fs.existsSync(target);
  if (targetExists && !resume) {
    const error = new Error("草稿文件已存在，拒绝覆盖");
    error.code = "HEALTH_ADVICE_CATALOG_OUTPUT_EXISTS";
    throw error;
  }
  if (!targetExists && resume) {
    const error = new Error("续跑草稿不存在");
    error.code = "HEALTH_ADVICE_CATALOG_RESUME_MISSING";
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

  const draft = resume ? readResumeDraft(target, adapter.modelName) : draftManifest(adapter.modelName);
  if (!resume) writeDraft(target, draft, true);
  const entries = draft.entries;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  for (let index = entries.length; index < SYNTHETIC_SCENARIOS.length; index += 1) {
    const scenario = SYNTHETIC_SCENARIOS[index];
    onProgress({ completed: index, total: SYNTHETIC_SCENARIOS.length, scenarioKey: scenarioKey(scenario) });
    const advice = applyRequiredFiberAction(await adapter.generateSyntheticScenario(scenario), scenario);
    if (!advice || !validateCatalogAdvice(advice, scenario)) {
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
    writeDraft(target, draft);
    onProgress({ completed: index + 1, total: SYNTHETIC_SCENARIOS.length, scenarioKey: scenarioKey(scenario) });
  }

  draft.generationStatus = "GENERATED";
  writeDraft(target, draft);
  return { output: target, scenarioCount: entries.length, modelName: adapter.modelName };
}

if (require.main === module) {
  run({
    onProgress({ completed, total, scenarioKey: key }) {
      console.error(`[${completed}/${total}] ${key}`);
    },
  }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { GENERATOR_ENV, outputPath, readResumeDraft, resumeRequested, run };
