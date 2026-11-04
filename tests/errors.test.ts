import { describe, expect, it } from "vitest";

import { AppError, ERROR_CODES, errorEnvelope, successEnvelope } from "@/lib/api/errors";

describe("error envelope", () => {
  it("matches the architecture contract", () => {
    expect(errorEnvelope(ERROR_CODES.VALIDATION_ERROR, "Bad input")).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Bad input" },
    });
  });

  it("wraps success data", () => {
    expect(successEnvelope({ ok: true })).toEqual({ success: true, data: { ok: true } });
  });

  it("keeps AppError status and code together", () => {
    const error = AppError.forbidden();
    expect(error.status).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error).toBeInstanceOf(Error);
  });
});
