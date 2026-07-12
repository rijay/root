function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function compareAnswer(value, rule = {}) {
  const operator = String(rule.operator || rule.op || (rule.in !== undefined ? "IN" : rule.notIn !== undefined || rule.not_in !== undefined ? "NOT_IN" : rule.notEquals !== undefined || rule.not_equals !== undefined ? "NE" : rule.exists !== undefined ? "EXISTS" : rule.truthy !== undefined ? "TRUTHY" : "EQ")).toUpperCase();
  if (operator === "EXISTS") return rule.exists === false ? isMissing(value) : !isMissing(value);
  if (operator === "TRUTHY") return rule.truthy === false ? !value : Boolean(value);
  if (operator === "NE" || operator === "NOT_EQUALS") return value !== (rule.notEquals !== undefined ? rule.notEquals : rule.not_equals);
  if (operator === "IN") return arrayValue(rule.in || rule.values).includes(value);
  if (operator === "NOT_IN") return !arrayValue(rule.notIn || rule.not_in || rule.values).includes(value);
  if (["GT", "GTE", "LT", "LTE"].includes(operator)) {
    const left = Number(value);
    const right = Number(rule.value !== undefined ? rule.value : rule.equals);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === "GT") return left > right;
    if (operator === "GTE") return left >= right;
    if (operator === "LT") return left < right;
    return left <= right;
  }
  return value === (rule.equals !== undefined ? rule.equals : rule.value);
}

function evaluateVisibleRule(rule, answers = {}) {
  if (!rule) return true;
  if (Array.isArray(rule)) return rule.every((item) => evaluateVisibleRule(item, answers));
  const conditions = rule.conditions || rule.all || rule.any;
  if (Array.isArray(conditions)) {
    const logic = String(rule.logic || (rule.any ? "OR" : "AND")).toUpperCase();
    return logic === "OR"
      ? conditions.some((item) => evaluateVisibleRule(item, answers))
      : conditions.every((item) => evaluateVisibleRule(item, answers));
  }
  const field = String(rule.field || "").trim();
  if (!field) return true;
  return compareAnswer(answers[field], rule);
}

function isQuestionVisible(question = {}, answers = {}) {
  return evaluateVisibleRule(question.visibleIf || question.visible_if || question.showIf || question.show_if, answers);
}

function visibleQuestionRows(questionnaire, answers = {}, decorate = (question) => question) {
  if (!questionnaire || !Array.isArray(questionnaire.questions)) return [];
  return questionnaire.questions
    .filter((question) => isQuestionVisible(question, answers))
    .map((question) => decorate(question));
}

module.exports = {
  isMissing,
  isQuestionVisible,
  visibleQuestionRows,
};
