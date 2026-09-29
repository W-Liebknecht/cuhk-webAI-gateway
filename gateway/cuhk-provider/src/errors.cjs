"use strict";

class BridgeError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = options.code || "bridge_error";
    this.status = options.status || 500;
    this.retryable = options.retryable === true;
  }
}

class RequestError extends BridgeError {
  constructor(message, code = "invalid_request_error") {
    super(message, { code, status: 400 });
  }
}

class UnavailableError extends BridgeError {
  constructor(message) {
    super(message, { code: "cuhk_unavailable", status: 503, retryable: true });
  }
}

class ConflictError extends BridgeError {
  constructor(message, code = "cuhk_session_busy") {
    super(message, { code, status: 409, retryable: true });
  }
}

class ProtocolError extends BridgeError {
  constructor(message) {
    super(message, { code: "cuhk_tool_protocol_error", status: 502 });
  }
}

class UpstreamError extends BridgeError {
  constructor(message, options = {}) {
    super(message, {
      code: options.code || "cuhk_upstream_error",
      status: options.status || 502,
      retryable: options.retryable === true
    });
  }
}

function errorBody(error) {
  const normalized = error instanceof BridgeError
    ? error
    : new BridgeError(error instanceof Error ? error.message : String(error));
  return {
    error: {
      code: normalized.code,
      message: normalized.message,
      type: normalized instanceof RequestError ? "invalid_request_error" : "server_error",
      retryable: normalized.retryable
    }
  };
}

module.exports = { BridgeError, ConflictError, ProtocolError, RequestError, UnavailableError, UpstreamError, errorBody };
