function text(value) {
  return String(value || "").trim();
}

function isValidPrivacyContact(value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 254) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return true;
  const phone = normalized.replace(/[\s()\-]/g, "");
  return /^\+?\d{7,15}$/.test(phone);
}

module.exports = {
  isValidPrivacyContact,
};
