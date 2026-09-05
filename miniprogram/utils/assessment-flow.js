function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function questionField(question = {}) {
  return text(question.field);
}

function answerMatches(value, rule = {}) {
  const operator = text(rule.operator || "EQ").toUpperCase();
  const expected = rule.value !== undefined ? rule.value : rule.equals;
  if (operator === "IN") return Array.isArray(rule.values) && rule.values.includes(value);
  if (operator === "NOT_IN") return Array.isArray(rule.values) && !rule.values.includes(value);
  if (operator === "TRUTHY") return Boolean(value) === (rule.value === undefined ? true : Boolean(rule.value));
  if (operator === "NE") return value !== expected;
  return value === expected;
}

function questionVisible(question = {}, answers = {}) {
  const rule = question.visibleIf || question.visible_if;
  if (!rule) return true;
  if (Array.isArray(rule.all)) {
    return rule.all.every((item) => answerMatches(answers[item.field], item));
  }
  if (Array.isArray(rule.any)) {
    return rule.any.some((item) => answerMatches(answers[item.field], item));
  }
  return answerMatches(answers[rule.field], rule);
}

function pruneHiddenAnswers(questions = [], answers = {}) {
  const rows = Array.isArray(questions) ? questions : [];
  const source = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const fields = new Set(rows.map(questionField).filter(Boolean));
  const pruned = Object.keys(source).reduce((result, field) => {
    if (!fields.has(field)) return result;
    const value = source[field];
    result[field] = Array.isArray(value) ? [...value] : value;
    return result;
  }, {});

  for (let pass = 0; pass <= rows.length; pass += 1) {
    let changed = false;
    rows.forEach((question) => {
      const field = questionField(question);
      if (field && Object.prototype.hasOwnProperty.call(pruned, field) && !questionVisible(question, pruned)) {
        delete pruned[field];
        changed = true;
      }
    });
    if (!changed) break;
  }
  return pruned;
}

function visibleQuestions(questions = [], answers = {}) {
  const rows = Array.isArray(questions) ? questions : [];
  const pruned = pruneHiddenAnswers(rows, answers);
  return rows.filter((question) => questionField(question) && questionVisible(question, pruned));
}

function missingAnswer(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}

function firstIncompleteIndex(questions = [], answers = {}) {
  const index = questions.findIndex((question) => (
    question.required !== false && missingAnswer(answers[questionField(question)])
  ));
  return index < 0 ? Math.max(0, questions.length - 1) : index;
}

function toggleMultiAnswer(question = {}, current = [], value = "") {
  const options = Array.isArray(question.options) ? question.options : [];
  const selected = Array.isArray(current) ? current.filter((item) => options.some((option) => option.value === item)) : [];
  const target = options.find((option) => option.value === value);
  if (!target) return selected;
  if (target.exclusive) return selected.includes(value) ? [] : [value];
  const withoutExclusive = selected.filter((item) => {
    const option = options.find((candidate) => candidate.value === item);
    return !(option && option.exclusive);
  });
  return withoutExclusive.includes(value)
    ? withoutExclusive.filter((item) => item !== value)
    : withoutExclusive.concat(value);
}

module.exports = Object.freeze({
  answerMatches,
  firstIncompleteIndex,
  missingAnswer,
  pruneHiddenAnswers,
  questionVisible,
  toggleMultiAnswer,
  visibleQuestions,
});
