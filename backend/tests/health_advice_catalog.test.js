const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CATALOG_PROMPT_VERSION,
  CATALOG_VERSION,
  REQUIRED_GUT_FIBER_ACTIONS,
  SYNTHETIC_SCENARIOS,
  TAXONOMY_VERSION,
  createHealthAdviceCatalog,
  defaultCatalog,
  requiredFiberActionForGutResult,
  scenarioKey,
} = require("../src/healthAdviceCatalog");
const { outputPath, run } = require("../scripts/generate-health-advice-catalog-draft");

test("v0.6.1 five-result fiber rules remain exact and immutable", () => {
  assert.deepEqual(REQUIRED_GUT_FIBER_ACTIONS, {
    CONSTIPATION: "补充益生元纤维，帮助软化便便促蠕动",
    LOOSE: "补充可溶性纤维，帮助吸水让便便成形",
    ALTERNATING: "补充益生元纤维，双向调节排便节奏",
    SENSITIVE: "补充低FODMAP益生元，温和滋养不胀气",
    HEALTHY: "日常补充益生元，持续滋养肠道有益菌",
  });
  assert.equal(Object.isFrozen(REQUIRED_GUT_FIBER_ACTIONS), true);
});

function advice(scenario) {
  return {
    summary: "保持稳定节奏并继续观察。",
    actions: [requiredFiberActionForGutResult(scenario.gutResultCode), "分次饮水。", "记录近期感受。"],
    cautions: ["不适持续时请咨询专业人士。"],
    followUp: "一周后回测。",
  };
}

function approvedManifest() {
  return {
    schemaVersion: 1,
    catalogVersion: CATALOG_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: CATALOG_PROMPT_VERSION,
    modelName: "hy3",
    generatedAt: "2026-08-26T10:00:00.000Z",
    reviewStatus: "APPROVED",
    reviewedAt: "2026-08-26T11:00:00.000Z",
    reviewer: "content-reviewer-1",
    entries: SYNTHETIC_SCENARIOS.map((scenario) => ({ ...scenario, advice: advice(scenario), reviewStatus: "APPROVED" })),
  };
}

test("checked-in catalog fails closed until all 30 scenarios are generated and reviewed", () => {
  assert.equal(SYNTHETIC_SCENARIOS.length, 30);
  assert.equal(defaultCatalog.configured, false);
  assert.equal(defaultCatalog.approvedEntryCount, 0);
  assert.equal(defaultCatalog.lookup([
    { assessmentType: "INITIAL", resultCode: "BASELINE" },
    { assessmentType: "GUT_REGULARITY", resultCode: "HEALTHY" },
  ]), null);
});

test("approved catalog resolves only frozen result-code combinations", () => {
  const catalog = createHealthAdviceCatalog(approvedManifest());
  assert.equal(catalog.configured, true);
  assert.equal(catalog.approvedEntryCount, 30);
  const entry = catalog.lookup([
    { assessmentType: "INITIAL", resultCode: "BASELINE", rootUserId: "not-used" },
    { assessmentType: "GUT_REGULARITY", resultCode: "HEALTHY", answers: { private: true } },
  ]);
  assert.equal(scenarioKey({
    initialResultCode: entry.initialResultCode,
    gutResultCode: entry.gutResultCode,
  }), "BASELINE:HEALTHY");
  assert.equal(entry.advice.actions.length, 3);
  assert.equal(entry.advice.actions[0], "日常补充益生元，持续滋养肠道有益菌");
});

test("one missing review or unsafe entry disables the entire catalog", () => {
  const missingReview = approvedManifest();
  missingReview.entries[0].reviewStatus = "PENDING_REVIEW";
  assert.equal(createHealthAdviceCatalog(missingReview).configured, false);

  const unsafe = approvedManifest();
  unsafe.entries[0].advice.summary = "保证有效并提供治疗";
  assert.equal(createHealthAdviceCatalog(unsafe).configured, false);

  const fiberRuleChanged = approvedManifest();
  fiberRuleChanged.entries[0].advice.actions[0] = "模型自行改写的第一条建议。";
  assert.equal(createHealthAdviceCatalog(fiberRuleChanged).configured, false);

  const extra = approvedManifest();
  extra.entries.push({ ...extra.entries[0], initialResultCode: "UNKNOWN" });
  assert.equal(createHealthAdviceCatalog(extra).configured, false);
});

test("draft generator requires a new explicit output and emits 30 pending-review scenarios", async () => {
  assert.throws(() => outputPath([]), { code: "HEALTH_ADVICE_CATALOG_OUTPUT_REQUIRED" });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-health-catalog-test-"));
  const target = path.join(directory, "catalog.draft.json");
  let calls = 0;
  try {
    const result = await run({
      argv: [`--output=${target}`],
      readApiKey: () => "keychain-secret",
      async fetchImpl(_url, options) {
        calls += 1;
        const body = JSON.parse(options.body);
        assert.equal(JSON.stringify(body).includes("keychain-secret"), false);
        assert.equal(JSON.stringify(body).includes("rootUserId"), false);
        return {
          ok: true,
          async json() {
            return {
              choices: [{ message: { content: JSON.stringify({
                summary: "保持稳定节奏并继续观察。",
                actions: ["模型建议一。", "模型建议二。", "模型建议三。"],
                cautions: ["不适持续时请咨询专业人士。"],
                followUp: "一周后回测。",
              }) } }],
            };
          },
        };
      },
    });
    const draft = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(result.scenarioCount, 30);
    assert.equal(calls, 30);
    assert.equal(draft.reviewStatus, "DRAFT");
    assert.equal(draft.entries.length, 30);
    assert.equal(draft.entries.every((entry) => entry.reviewStatus === "PENDING_REVIEW"), true);
    assert.equal(draft.entries.every((entry) => (
      entry.advice.actions[0] === requiredFiberActionForGutResult(entry.gutResultCode)
    )), true);
    await assert.rejects(() => run({ argv: [`--output=${target}`], readApiKey: () => "unused" }), {
      code: "HEALTH_ADVICE_CATALOG_OUTPUT_EXISTS",
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
