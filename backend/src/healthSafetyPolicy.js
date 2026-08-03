const { createClientError } = require("./clientError");

const SAFETY_POLICY_VERSION = 1;
const SAFETY_SIGNALS = Object.freeze([
  "pregnancy",
  "medical_diet",
  "major_treatment",
  "recent_acute",
  "blood_stool",
  "acute_digestive",
  "weight_loss",
  "self_harm",
]);

const PROMPT_SUPPORT_SIGNALS = new Set(["recent_acute", "blood_stool", "acute_digestive", "weight_loss"]);

function evaluateSafety(answers = {}) {
  const selected = Array.isArray(answers.safety)
    ? Array.from(new Set(answers.safety.map((value) => String(value || "").trim())))
    : [];
  if (!selected.length) {
    throw createClientError("FORMAL_HEALTH_SAFETY_REQUIRED", "请完成安全与适用性确认", 422);
  }
  if (selected.includes("none") && selected.length > 1) {
    throw createClientError("FORMAL_HEALTH_SAFETY_CONFLICT", "请重新选择安全与适用性确认", 422);
  }
  const matchedSignals = SAFETY_SIGNALS.filter((signal) => selected.includes(signal));
  if (!matchedSignals.length && selected.length === 1 && selected[0] === "none") {
    return {
      status: "STANDARD_GUIDANCE",
      urgency: "NONE",
      matchedSignals: [],
      guidanceKey: null,
      policyVersion: SAFETY_POLICY_VERSION,
    };
  }
  if (!matchedSignals.length || selected.some((signal) => signal !== "none" && !SAFETY_SIGNALS.includes(signal))) {
    throw createClientError("FORMAL_HEALTH_SAFETY_INVALID", "安全与适用性选项无效", 422);
  }
  const urgent = matchedSignals.includes("self_harm");
  const prompt = matchedSignals.some((signal) => PROMPT_SUPPORT_SIGNALS.has(signal));
  return {
    status: "PROFESSIONAL_SUPPORT_RECOMMENDED",
    urgency: urgent ? "URGENT" : (prompt ? "PROMPT" : "PROFESSIONAL_REVIEW"),
    matchedSignals,
    guidanceKey: urgent ? "URGENT_SUPPORT" : (prompt ? "PROMPT_SUPPORT" : "PROFESSIONAL_REVIEW"),
    policyVersion: SAFETY_POLICY_VERSION,
  };
}

module.exports = {
  SAFETY_POLICY_VERSION,
  SAFETY_SIGNALS,
  evaluateSafety,
};
