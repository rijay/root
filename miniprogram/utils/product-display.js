function pad(value) {
  return String(value).padStart(2, "0");
}

function formatProductSyncedAt(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/-/g, ".");

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.replace("T", " ").slice(0, 16);
  const chinaTime = new Date(date.getTime() + (8 * 60 * 60 * 1000));
  return `${chinaTime.getUTCFullYear()}.${pad(chinaTime.getUTCMonth() + 1)}.${pad(chinaTime.getUTCDate())} ${pad(chinaTime.getUTCHours())}:${pad(chinaTime.getUTCMinutes())}`;
}

module.exports = { formatProductSyncedAt };
