const {
  gutHealthOptions,
  improvementOptions,
  joinReasonOptions,
  stoolOptions,
} = require("./options");

function buildLabelMap(options) {
  return options.reduce((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {});
}

const joinReasonMap = buildLabelMap(joinReasonOptions);
const gutHealthMap = buildLabelMap(gutHealthOptions);
const improvementMap = buildLabelMap(improvementOptions);
const stoolMap = buildLabelMap(stoolOptions);

function valueLabel(map, value) {
  if (!value) return "暂未填写";
  return map[value] || value;
}

function joinReasonLabel(value) {
  return valueLabel(joinReasonMap, value);
}

function gutHealthLabel(value) {
  return valueLabel(gutHealthMap, value);
}

function improvementLabel(value) {
  return valueLabel(improvementMap, value);
}

function stoolLabel(value) {
  return valueLabel(stoolMap, value);
}

function formatOptionList(values, labelGetter) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  if (!list.length) return "暂未填写";
  return list.map(labelGetter).filter(Boolean).join("、") || "暂未填写";
}

module.exports = {
  formatOptionList,
  gutHealthLabel,
  improvementLabel,
  joinReasonLabel,
  stoolLabel,
};
