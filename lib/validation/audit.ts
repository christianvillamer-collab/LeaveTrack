import { z } from "zod";

import {
  exportAllQuerySchema,
  listQuerySchema,
  type SearchParamValue,
} from "@/lib/validation/list";

/** An empty query-string value means "no filter", not an invalid value. */
const optionalDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.iso.date().optional(),
);

const optionalUuid = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.uuid().optional(),
);

/**
 * The HR audit report accepts one employee, an optional inclusive date range,
 * and the shared status/pagination contract. The same schema validates the
 * page's search params and the API's query string so both paths agree on what
 * "inclusive" and "page" mean.
 */
export const auditReportQuerySchema = listQuerySchema
  .extend({
    employee: optionalUuid,
    from: optionalDate,
    to: optionalDate,
    exportAll: exportAllQuerySchema,
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: "End date cannot be before the start date.",
    path: ["to"],
  });

export type AuditReportQuery = z.infer<typeof auditReportQuerySchema>;

export interface AuditReportInput {
  employee?: SearchParamValue;
  from?: SearchParamValue;
  to?: SearchParamValue;
  status?: SearchParamValue;
  page?: SearchParamValue;
  pageSize?: SearchParamValue;
  exportAll?: SearchParamValue;
}

export type ResolvedAuditQuery =
  | { valid: true; query: AuditReportQuery; error: null }
  | { valid: false; query: null; error: string };

/**
 * Resolve untrusted report search params without ever failing open.
 *
 * A malformed or reversed range must not become "no filter": that would turn a
 * narrow compliance window into a full-history report. Invalid status, page,
 * or page size values fail the same way. Invalid input therefore yields no
 * query at all, and the caller keeps the raw values for the form and surfaces
 * the error. Page and API share the schema; only the page needs this resolver
 * because it renders a correction form rather than a 400 envelope.
 */
export function resolveAuditReportQuery(input: AuditReportInput): ResolvedAuditQuery {
  const parsed = auditReportQuerySchema.safeParse(input);
  if (parsed.success) {
    return { valid: true, query: parsed.data, error: null };
  }
  return {
    valid: false,
    query: null,
    error: parsed.error.issues[0]?.message ?? "Enter valid report filters.",
  };
}
