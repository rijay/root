class AtomicWriteError extends Error {
  constructor(cause) {
    super("atomic write failed");
    this.name = "AtomicWriteError";
    this.code = "ATOMIC_WRITE_FAILED";
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

function atomicWriteFailure(cause) {
  return cause instanceof AtomicWriteError ? cause : new AtomicWriteError(cause);
}

function isAtomicWriteError(error) {
  return error instanceof AtomicWriteError;
}

module.exports = {
  AtomicWriteError,
  atomicWriteFailure,
  isAtomicWriteError,
};
