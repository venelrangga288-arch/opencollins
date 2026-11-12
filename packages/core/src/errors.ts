/** Standardized gateway errors — mapped to HTTP responses by the gateway. */

export type GatewayErrorCode =
  | "invalid_api_key"
  | "missing_api_key"
  | "key_revoked"
  | "rate_limited"
  | "quota_exceeded"
  | "model_not_found"
  | "invalid_request"
  | "provider_error"
  | "provider_timeout"
  | "internal_error";

export class GatewayError extends Error {
  constructor(
    public code: GatewayErrorCode,
    public httpStatus: number,
    message: string,
    public providerStatus?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export function toErrorBody(code: GatewayErrorCode, message: string, requestId: string) {
  return {
    error: {
      code,
      message,
      request_id: requestId,
    },
  };
}
