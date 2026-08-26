const crypto = require("node:crypto");

const BASE_URL = "http://127.0.0.1:8787";
const REVIEWED_MODEL_CATALOG = "REVIEWED_MODEL_CATALOG";
const REVIEWED_FALLBACK = "REVIEWED_FALLBACK";
const SUPPORTED_SOURCES = new Set([REVIEWED_MODEL_CATALOG, REVIEWED_FALLBACK]);
const initialAnswers = Object.freeze({
  primary_goal: "observe",
  impact_level: "0",
  safety: ["none"],
  bowel_frequency: "daily",
  stool_form: "formed",
  digestive_feelings: ["none"],
  sleep_duration: "7_8",
  sleep_issues: ["none"],
  activity: "regular_3",
  diet: ["balanced"],
  hydration: ["adequate"],
  stress_energy: ["stable"],
});
const gutAnswers = Object.freeze({
  Q1: "A",
  Q2: "B",
  Q3: ["A"],
  Q4: ["A"],
  Q5: ["A"],
});

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    const error = new Error(`local verification request failed: ${response.status}/${payload.code || "unknown"}`);
    error.code = "LOCAL_HEALTH_ADVICE_VERIFY_REQUEST_FAILED";
    throw error;
  }
  return payload.data;
}

function resolveExpectedSource(argv = process.argv.slice(2)) {
  const prefix = "--expected-source=";
  const argument = argv.find((item) => String(item).startsWith(prefix));
  const source = argument ? String(argument).slice(prefix.length).trim() : REVIEWED_MODEL_CATALOG;
  if (!SUPPORTED_SOURCES.has(source)) {
    const error = new Error("expected source must be REVIEWED_MODEL_CATALOG or REVIEWED_FALLBACK");
    error.code = "LOCAL_HEALTH_ADVICE_VERIFY_SOURCE_INVALID";
    throw error;
  }
  return source;
}

function validateResult(result, expectedSource = REVIEWED_MODEL_CATALOG) {
  const modelMatches = expectedSource === REVIEWED_MODEL_CATALOG
    ? result.modelName === "hy3"
    : result.modelName === "";
  if (!result.ready
    || result.adviceSource !== expectedSource
    || !modelMatches
    || result.actionCount !== 3) {
    const error = new Error(`local health advice verification failed: ${JSON.stringify(result)}`);
    error.code = "LOCAL_HEALTH_ADVICE_VERIFY_RESULT_FAILED";
    throw error;
  }
  return result;
}

async function run(options = {}) {
  const expectedSource = options.expectedSource || resolveExpectedSource(options.argv);
  const runId = crypto.randomUUID().replace(/-/g, "");
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: `myroot-v070-model-${runId}`, appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.token}` };
  const consent = await request("/api/v1/privacy/health-consent", { headers: auth });
  await request("/api/v1/privacy/health-consent", {
    method: "POST",
    headers: { ...auth, "X-Idempotency-Key": `${runId}-consent` },
    body: JSON.stringify({
      decision: "GRANTED",
      policyVersion: consent.notice.policyVersion,
      sourceChannel: "LOCAL_MODEL_VERIFICATION",
    }),
  });

  async function complete(type, answers) {
    const started = await request("/api/v1/health/assessments/start", {
      method: "POST",
      headers: { ...auth, "X-Idempotency-Key": `${runId}-${type}-start` },
      body: JSON.stringify({ assessmentType: type }),
    });
    return request(`/api/v1/health/assessments/${started.assessment.assessmentId}/complete`, {
      method: "POST",
      headers: { ...auth, "X-Idempotency-Key": `${runId}-${type}-complete` },
      body: JSON.stringify({ answers }),
    });
  }

  const initial = await complete("INITIAL", initialAnswers);
  const gut = await complete("GUT_REGULARITY", gutAnswers);
  const generated = await request("/api/v1/health/advice/generate", {
    method: "POST",
    headers: { ...auth, "X-Idempotency-Key": `${runId}-advice` },
    body: "{}",
  });

  const result = {
    expectedSource,
    ready: generated.ready,
    initialResult: initial.assessment.result.resultCode,
    gutResult: gut.assessment.result.resultCode,
    adviceSource: generated.advice && generated.advice.source,
    modelName: generated.advice && generated.advice.modelName,
    actionCount: generated.advice && Array.isArray(generated.advice.actions)
      ? generated.advice.actions.length
      : 0,
  };
  validateResult(result, expectedSource);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REVIEWED_MODEL_CATALOG,
  REVIEWED_FALLBACK,
  resolveExpectedSource,
  run,
  validateResult,
};
