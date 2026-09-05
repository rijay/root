const ADVICE_SOURCE_PRESENTATION = Object.freeze({
  REVIEWED_ADVICE_POOL: Object.freeze({
    tone: "reviewed",
    hint: "",
  }),
  REVIEWED_FALLBACK: Object.freeze({
    tone: "fallback",
    hint: "本次展示经审核固定建议。",
  }),
  REVIEWED_SAFETY: Object.freeze({
    tone: "safety",
    hint: "当前结果进入安全提示分支，展示经审核安全提示。",
  }),
});

const ADVICE_CONFIRMATION_DELAYS_MS = Object.freeze([800, 1200, 1600, 2400, 3200]);

function decorateAdvice(advice) {
  if (!advice || typeof advice !== "object" || Array.isArray(advice)) return null;
  const source = String(advice.source || "").trim();
  const presentation = ADVICE_SOURCE_PRESENTATION[source] || {
    tone: "reviewed",
    hint: "建议仅用于日常健康管理参考。",
  };
  return {
    ...advice,
    sourceTone: presentation.tone,
    sourceHint: presentation.hint,
  };
}

function isAdviceResultUnknown(error) {
  return Boolean(error && (
    error.resultUnknown === true
    || error.code === "WRITE_RESULT_UNKNOWN"
  ));
}

module.exports = {
  ADVICE_CONFIRMATION_DELAYS_MS,
  ADVICE_SOURCE_PRESENTATION,
  decorateAdvice,
  isAdviceResultUnknown,
};
