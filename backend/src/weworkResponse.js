function assertWeworkBusinessSuccess(payload, label, createError) {
  const rawCode = payload && (payload.errcode ?? (payload.data && payload.data.errcode));
  const code = Number(rawCode);
  if (!Number.isFinite(code) || code === 0) return payload;
  const message = String((payload && (payload.errmsg || payload.message)) || "unknown error").trim();
  throw createError(code, `${label}失败：${message}`, payload);
}

module.exports = { assertWeworkBusinessSuccess };
