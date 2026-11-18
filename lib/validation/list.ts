import { z } from "zod";

import { REQUEST_STATUSES, type PaginationMeta } from "@/lib/types";

export const DEFAULT_PAGE_SIZE = 25;

/** Next.js search params may repeat, so a non-string value must never fail open. */
export type SearchParamValue = string | string[] | null | undefined;

function emptyToUndefined(value: SearchParamValue): SearchParamValue {
  return value === "" ? undefined : value;
}

function numericParam(value: SearchParamValue): unknown {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }
  // Only strings are valid query scalars. Arrays are left intact so Zod rejects
  // them instead of coercing `["1"]` into a page number.
  return typeof value === "string" ? Number(value) : value;
}

export const requestStatusSchema = z.enum(REQUEST_STATUSES);

export const statusQuerySchema = z.preprocess(emptyToUndefined, requestStatusSchema.optional());

const pageQuerySchema = z.preprocess(numericParam, z.number().int().min(1).optional()).default(1);

const pageSizeQuerySchema = z
  .preprocess(numericParam, z.number().int().min(1).max(100).optional())
  .default(DEFAULT_PAGE_SIZE);

/**
 * Every list read shares these bounds. An invalid value is a validation error,
 * never a fallback to an unbounded query.
 */
export const listQuerySchema = z.object({
  status: statusQuerySchema,
  page: pageQuerySchema,
  pageSize: pageSizeQuerySchema,
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const exportAllQuerySchema = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return false;
  }
  if (typeof value !== "string") {
    return value;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  return value;
}, z.boolean());

export function toPaginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize)
    ? Math.max(1, Math.floor(pageSize))
    : DEFAULT_PAGE_SIZE;

  return {
    total: safeTotal,
    page: safePage,
    pageSize: safePageSize,
    pageCount: Math.max(1, Math.ceil(safeTotal / safePageSize)),
  };
}
