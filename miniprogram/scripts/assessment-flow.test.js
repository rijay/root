const assert = require("node:assert/strict");

const {
  firstIncompleteIndex,
  pruneHiddenAnswers,
  questionVisible,
  toggleMultiAnswer,
  visibleQuestions,
} = require("../utils/assessment-flow");

const questions = [
  { field: "safety", required: true },
  {
    field: "regularity",
    required: true,
    visibleIf: { field: "safety", operator: "EQ", value: false },
  },
  {
    field: "detail",
    required: true,
    visibleIf: {
      all: [
        { field: "safety", operator: "EQ", value: false },
        { field: "regularity", operator: "IN", values: ["irregular"] },
      ],
    },
  },
];

assert.equal(questionVisible(questions[1], { safety: false }), true);
assert.equal(questionVisible(questions[1], { safety: true }), false);
assert.deepEqual(
  visibleQuestions(questions, { safety: false, regularity: "regular" }).map((item) => item.field),
  ["safety", "regularity"],
);
assert.deepEqual(
  visibleQuestions(questions, { safety: false, regularity: "irregular" }).map((item) => item.field),
  ["safety", "regularity", "detail"],
);
assert.deepEqual(
  pruneHiddenAnswers(questions, {
    safety: true,
    regularity: "irregular",
    detail: "不应继续保留",
    unknown: "不应进入评测快照",
  }),
  { safety: true },
);
assert.equal(firstIncompleteIndex(visibleQuestions(questions, { safety: false }), { safety: false }), 1);

const multiQuestion = {
  options: [
    { value: "none", exclusive: true },
    { value: "bloating" },
    { value: "pain" },
  ],
};
assert.deepEqual(toggleMultiAnswer(multiQuestion, ["bloating"], "none"), ["none"]);
assert.deepEqual(toggleMultiAnswer(multiQuestion, ["none"], "pain"), ["pain"]);
assert.deepEqual(toggleMultiAnswer(multiQuestion, ["bloating"], "pain"), ["bloating", "pain"]);

console.log("assessment flow tests passed");
