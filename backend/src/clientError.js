function markClientSafe(error) {
  if (!error || typeof error !== "object") return error;
  Object.defineProperty(error, "clientSafe", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return error;
}

function createClientError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return markClientSafe(error);
}

function isClientSafe(error) {
  return Boolean(error && error.clientSafe === true);
}

function clientErrorResponse(error, correlationId = null) {
  if (isClientSafe(error)) {
    return {
      status: Number(error.status) || 200,
      payload: {
        code: error.code || 500,
        message: error.message || "请求处理失败",
        data: null,
      },
    };
  }
  return {
    status: 500,
    payload: {
      code: 500,
      message: "请求处理失败，请稍后重试",
      data: correlationId ? { correlationId } : null,
    },
  };
}

module.exports = {
  clientErrorResponse,
  createClientError,
  isClientSafe,
  markClientSafe,
};
