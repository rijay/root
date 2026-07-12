function valueAt(source, path) {
  return String(path).split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

function firstDefined(source, paths) {
  for (const path of paths) {
    const value = valueAt(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function assertYouzanBusinessSuccess(payload, label, createError) {
  const success = firstDefined(payload, ["success", "response.success", "data.success"]);
  const rawCode = firstDefined(payload, [
    "code",
    "response.code",
    "error_response.code",
    "gw_err_resp.err_code",
    "error.code",
  ]);
  const normalizedCode = String(rawCode === undefined ? "" : rawCode).trim().toUpperCase();
  const codeReady = !normalizedCode || ["0", "200", "SUCCESS", "OK"].includes(normalizedCode);
  if (success !== false && String(success).toLowerCase() !== "false" && codeReady) return payload;

  const message = firstDefined(payload, [
    "message",
    "msg",
    "error_msg",
    "error_response.msg",
    "error_response.message",
    "gw_err_resp.err_msg",
    "gw_err_resp.message",
    "error.message",
  ]) || "unknown error";
  const code = Number.isFinite(Number(rawCode)) ? Number(rawCode) : 502;
  throw createError(code, `${label}失败：${message}`, payload);
}

function derivePageCursor(payload, currentCursor, limit, paths = {}) {
  const explicitCursor = firstDefined(payload, paths.cursor || []);
  if (explicitCursor !== undefined && explicitCursor !== null && explicitCursor !== "") return String(explicitCursor);
  const total = Number(firstDefined(payload, paths.total || []));
  if (!Number.isFinite(total) || total <= 0) return "";
  const currentPage = Math.max(1, Number(currentCursor) || Number(firstDefined(payload, paths.page || [])) || 1);
  const pageSize = Math.max(1, Number(firstDefined(payload, paths.pageSize || [])) || Number(limit) || 20);
  return currentPage * pageSize < total ? String(currentPage + 1) : "";
}

module.exports = {
  assertYouzanBusinessSuccess,
  derivePageCursor,
};
