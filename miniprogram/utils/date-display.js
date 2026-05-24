function parseDateParts(dateText) {
  if (!dateText) return null;
  const text = String(dateText);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function getReferenceYear(options) {
  if (typeof options === "number") return options;
  if (typeof options === "string") {
    const parts = parseDateParts(options);
    return parts ? parts.year : new Date().getFullYear();
  }
  if (options && typeof options.referenceYear === "number") return options.referenceYear;
  if (options && options.referenceDate) {
    const parts = parseDateParts(options.referenceDate);
    if (parts) return parts.year;
  }
  return new Date().getFullYear();
}

function formatDateCn(dateText, options = {}) {
  const parts = parseDateParts(dateText);
  if (!parts) return dateText ? String(dateText) : "";
  if (!options.alwaysShowYear && parts.year === getReferenceYear(options)) {
    return `${parts.month}月${parts.day}日`;
  }
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

function formatDateRangeCn(startDate, endDate, options = {}) {
  const start = formatDateCn(startDate, options);
  const end = formatDateCn(endDate, options);
  if (start && end) return `${start} 至 ${end}`;
  return start || end || "";
}

function formatRelativeDateCn(dateText, todayText) {
  if (!dateText) return "";
  const options = todayText ? { referenceDate: todayText } : {};
  if (dateText === todayText) return `今天 · ${formatDateCn(dateText, options)}`;
  const today = parseDateParts(todayText);
  const target = parseDateParts(dateText);
  if (!today || !target) return formatDateCn(dateText, options);
  const todayDate = new Date(today.year, today.month - 1, today.day);
  const targetDate = new Date(target.year, target.month - 1, target.day);
  const diff = Math.round((todayDate.getTime() - targetDate.getTime()) / 86400000);
  if (diff === 1) return `昨天 · ${formatDateCn(dateText, options)}`;
  return formatDateCn(dateText, options);
}

function formatDateTimeCn(dateText, options = {}) {
  if (!dateText) return "";
  const date = formatDateCn(dateText, options);
  const timeMatch = String(dateText).match(/T(\d{2}):(\d{2})/);
  if (!timeMatch) return date;
  return `${date} ${timeMatch[1]}:${timeMatch[2]}`;
}

module.exports = {
  formatDateCn,
  formatDateRangeCn,
  formatDateTimeCn,
  formatRelativeDateCn,
};
