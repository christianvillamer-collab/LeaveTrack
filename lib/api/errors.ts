export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  DATABASE_NOT_CONFIGURED: "DATABASE_NOT_CONFIGURED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }

  static validation(message = "The submitted data is invalid.") {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, message, 400);
  }

  static unauthenticated(message = "Authentication is required.") {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, message, 401);
  }

  static forbidden(message = "You do not have access to this resource.") {
    return new AppError(ERROR_CODES.FORBIDDEN, message, 403);
  }

  static notFound(message = "The requested resource was not found.") {
    return new AppError(ERROR_CODES.NOT_FOUND, message, 404);
  }

  static internal(message = "An unexpected error occurred.") {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, message, 500);
  }
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
  };
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export function errorEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { success: false, error: { code, message } };
}

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}
