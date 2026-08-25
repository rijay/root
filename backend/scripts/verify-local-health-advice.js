const crypto = require("node:crypto");

const BASE_URL = "http://127.0.0.1:8787";
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

async function run() {
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
    ready: generated.ready,
    initialResult: initial.assessment.result.resultCode,
    gutResult: gut.assessment.result.resultCode,
    adviceSource: generated.advice && generated.advice.source,
    modelName: generated.advice && generated.advice.modelName,
    actionCount: generated.advice && Array.isArray(generated.advice.actions)
      ? generated.advice.actions.length
      : 0,
  };
  if (!result.ready || result.adviceSource !== "MODEL_ASSISTED" || result.modelName !== "hy3" || result.actionCount !== 3) {
    const error = new Error(`local model verification failed: ${JSON.stringify(result)}`);
    error.code = "LOCAL_HEALTH_ADVICE_VERIFY_RESULT_FAILED";
    throw error;
  }
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
