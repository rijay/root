const { formatDateCn } = require("../../../utils/date-display");
const { stoolLabel } = require("../../../utils/option-labels");

function read(record, snakeKey, camelKey) {
  if (!record) return "";
  if (record[snakeKey] !== undefined) return record[snakeKey];
  return record[camelKey];
}

function truncateFeedback(text, maxLength = 40) {
  const value = String(text || "").trim();
  if (!value) return "今天也完成了一次真实记录。";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function buildPosterSummaryRows(record) {
  const hadStool = Boolean(read(record, "had_stool", "hadStool"));
  const rows = [
    { label: "服用 ROOT", value: read(record, "took_product", "tookProduct") ? "已服用" : "未服用" },
    { label: "昨日排便", value: hadStool ? "有" : "没有" },
  ];
  if (hadStool) rows.push({ label: "便型", value: stoolLabel(read(record, "stool_type", "stoolType")) });
  return rows;
}

function buildSharePosterPayload(record, context = {}) {
  const mode = context.mode || "daily";
  const dateText = read(record, "checkin_date", "checkinDate") || context.date || "";
  const stats = context.stats || {};
  const dayIndex = read(record, "day_index", "dayIndex") || context.dayIndex || 1;
  const title = mode === "checkin" ? `第 ${dayIndex} 天，身体记录已完成` : "今天，身体记录已完成";
  const streakText = mode === "checkin"
    ? `已完成 ${context.completedDays || dayIndex} 天试饮记录`
    : `累计记录 ${stats.totalDays || 0} 天 · 当前连续 ${stats.currentStreak || 0} 天`;

  return {
    brand: "ROOT",
    dateText: formatDateCn(dateText),
    title,
    subtitle: "一次真实记录，也是在照看身体的节律。",
    summaryRows: buildPosterSummaryRows(record),
    feedback: truncateFeedback(read(record, "feedback", "feedback"), 40),
    streakText,
    footer: "身体自有其序，记录会让它被看见。",
  };
}

module.exports = {
  buildPosterSummaryRows,
  buildSharePosterPayload,
  truncateFeedback,
};
