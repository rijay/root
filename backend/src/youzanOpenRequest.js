function isOfficialYouzanUrl(value, methodName = "") {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch (_) {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "open.youzanyun.com") return false;
  if (!methodName) return true;
  const escapedMethod = String(methodName).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^/api/${escapedMethod}/\\d+\\.\\d+\\.\\d+/?$`).test(url.pathname.toLowerCase());
}

module.exports = {
  isOfficialYouzanUrl,
};
