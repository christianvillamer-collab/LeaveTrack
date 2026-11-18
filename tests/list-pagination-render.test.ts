import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RequestTable } from "@/components/domain/request-table";
import { TeamRequestTable } from "@/components/domain/team-request-table";
import type { PaginationMeta } from "@/lib/types";

const pagePastEnd: PaginationMeta = { page: 3, pageSize: 25, total: 10, pageCount: 1 };
const noResults: PaginationMeta = { page: 1, pageSize: 25, total: 0, pageCount: 1 };

describe("empty but paginated list rendering", () => {
  it("shows the request pager so a stale page can navigate back", () => {
    const html = renderToStaticMarkup(
      createElement(RequestTable, {
        requests: [],
        pagination: pagePastEnd,
        pageHref: (page) => `/requests?page=${page}`,
      }),
    );

    expect(html).toContain("No leave requests yet");
    expect(html).toContain('aria-label="Request pages"');
    expect(html).toContain('href="/requests?page=2"');
    expect(html).toContain("10 requests");
  });

  it("omits the request pager for a genuinely empty result set", () => {
    const html = renderToStaticMarkup(
      createElement(RequestTable, {
        requests: [],
        pagination: noResults,
        pageHref: (page) => `/requests?page=${page}`,
      }),
    );

    expect(html).toContain("No leave requests yet");
    expect(html).not.toContain('aria-label="Request pages"');
  });

  it("shows the queue pager so a stale page can navigate back", () => {
    const html = renderToStaticMarkup(
      createElement(TeamRequestTable, {
        requests: [],
        pagination: pagePastEnd,
        pageHref: (page) => `/approvals?page=${page}`,
      }),
    );

    expect(html).toContain("No requests in your scope");
    expect(html).toContain('aria-label="Queue pages"');
    expect(html).toContain('href="/approvals?page=2"');
    expect(html).toContain("10 requests");
  });

  it("omits the queue pager for a genuinely empty result set", () => {
    const html = renderToStaticMarkup(
      createElement(TeamRequestTable, {
        requests: [],
        pagination: noResults,
        pageHref: (page) => `/approvals?page=${page}`,
      }),
    );

    expect(html).toContain("No requests in your scope");
    expect(html).not.toContain('aria-label="Queue pages"');
  });
});
