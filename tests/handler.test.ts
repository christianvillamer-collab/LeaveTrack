import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { AppError } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/test", { method: "POST" });
}

describe("withApiHandler success status", () => {
  it("defaults to 200 for existing routes such as health", async () => {
    const handler = withApiHandler("test 200", async () => ({ ok: true }));
    const response = await handler(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { ok: true },
    });
  });

  it("uses the configured 201 status for created resources", async () => {
    const handler = withApiHandler("test 201", async () => ({ id: "new" }), {
      successStatus: 201,
    });
    const response = await handler(makeRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { id: "new" },
    });
  });

  it("keeps the error envelope for AppError failures", async () => {
    const handler = withApiHandler("test error", async () => {
      throw AppError.validation("Bad input.");
    });
    const response = await handler(makeRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Bad input." },
    });
  });

  it("passes dynamic route params to the handler context", async () => {
    const handler = withApiHandler<{ id: string }, { id: string }>(
      "test params",
      async (_request, context) => ({
        id: (await context.params)?.id ?? "missing",
      }),
    );
    const response = await handler(makeRequest(), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { id: "abc" },
    });
  });
});
