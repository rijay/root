const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ADVICE_CONFIRMATION_DELAYS_MS,
  decorateAdvice,
  isAdviceResultUnknown,
} = require("../utils/health-advice-ui");

assert.equal(decorateAdvice({ source: "MODEL_ASSISTED" }).sourceTone, "model");
assert.match(decorateAdvice({ source: "MODEL_ASSISTED" }).sourceHint, /AI/);
assert.equal(decorateAdvice({ source: "REVIEWED_FALLBACK" }).sourceTone, "fallback");
assert.match(decorateAdvice({ source: "REVIEWED_FALLBACK" }).sourceHint, /经审核/);
assert.equal(decorateAdvice({ source: "REVIEWED_SAFETY" }).sourceTone, "safety");
assert.match(decorateAdvice({ source: "REVIEWED_SAFETY" }).sourceHint, /未调用模型/);
assert.equal(decorateAdvice(null), null);
assert.equal(isAdviceResultUnknown({ code: "WRITE_RESULT_UNKNOWN" }), true);
assert.equal(isAdviceResultUnknown({ resultUnknown: true }), true);
assert.equal(isAdviceResultUnknown({ code: "NETWORK_ERROR" }), false);
assert.ok(ADVICE_CONFIRMATION_DELAYS_MS.reduce((sum, value) => sum + value, 0) >= 8000);

const root = path.resolve(__dirname, "..");
const pageScript = fs.readFileSync(path.join(root, "pages/health/index.js"), "utf8");
const pageView = fs.readFileSync(path.join(root, "pages/health/index.wxml"), "utf8");
assert.match(pageScript, /isAdviceResultUnknown/);
assert.match(pageScript, /confirmPendingAdvice/);
assert.match(pageScript, /adviceLoading/);
assert.match(pageView, /adviceStatusText/);
assert.match(pageView, /sourceHint/);
assert.match(pageView, /无需重复点击/);

console.log("health advice UI state checks passed");
