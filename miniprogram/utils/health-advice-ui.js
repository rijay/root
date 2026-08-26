const ADVICE_SOURCE_PRESENTATION = Object.freeze({
  REVIEWED_MODEL_CATALOG: Object.freeze({
    tone: "model",
    hint: "由 AI 基于合成状态辅助生成，经人工审核后收录；你的评测数据不会发送给模型。",
  }),
  REVIEWED_FALLBACK: Object.freeze({
    tone: "fallback",
    hint: "本次使用经审核的规则建议，不展示未通过校验的模型内容。",
  }),
  REVIEWED_SAFETY: Object.freeze({
    tone: "safety",
    hint: "当前结果进入安全提示分支，本次未调用模型，使用经审核的安全提示。",
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
