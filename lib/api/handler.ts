import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { AppError, ERROR_CODES, errorEnvelope, successEnvelope } from "@/lib/api/errors";
import { requestLogger } from "@/lib/logging/logger";

const NO_STORE = { "Cache-Control": "no-store" };

export interface ApiHandlerOptions {
  successStatus?: number;
}

export interface ApiHandlerContext<Params = Record<string, string | string[] | undefined>> {
  requestId: string;
  params?: Promise<Params>;
}

/**
 * Wraps a route handler so every failure leaves through the single error
 * envelope defined in ARCH-LeaveTrack-v1.0: { success:false, error:{code,message} }.
 */
export function withApiHandler<T, Params = Record<string, string | string[] | undefined>>(
  route: string,
  handler: (request: NextRequest, context: ApiHandlerContext<Params>) => Promise<T>,
  options: ApiHandlerOptions = {},
) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Params> },
  ): Promise<NextResponse> => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    const log = requestLogger(requestId, route);
    const successStatus = options.successStatus ?? 200;

    try {
      const data = await handler(request, {
        requestId,
        params: routeContext?.params,
      });
      log.info({ status: successStatus }, "request completed");

      return NextResponse.json(successEnvelope(data), {
        status: successStatus,
        headers: { ...NO_STORE, "x-request-id": requestId },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues[0]?.message ?? "The submitted data is invalid.";
        log.warn({ status: 400, code: ERROR_CODES.VALIDATION_ERROR }, "request rejected");
        return NextResponse.json(errorEnvelope(ERROR_CODES.VALIDATION_ERROR, message), {
          status: 400,
          headers: { ...NO_STORE, "x-request-id": requestId },
        });
      }

      if (error instanceof AppError) {
        const level = error.status >= 500 ? "error" : "warn";
        log[level]({ status: error.status, code: error.code }, error.message);
        return NextResponse.json(errorEnvelope(error.code, error.message), {
          status: error.status,
          headers: { ...NO_STORE, "x-request-id": requestId },
        });
      }

      log.error({ err: error, status: 500 }, "unhandled request error");
      return NextResponse.json(
        errorEnvelope(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred."),
        { status: 500, headers: { ...NO_STORE, "x-request-id": requestId } },
      );
    }
  };
}
