import { describe, expect, it } from "vitest";

import type { AuditEvent } from "@/lib/types";
import { AUDIT_CSV_HEADERS, actionLabel, auditEventToCsvRow } from "@/lib/utils/audit";
import { toCsv } from "@/lib/utils/csv";
import { auditReportQuerySchema, resolveAuditReportQuery } from "@/lib/validation/audit";

const EMPLOYEE_ID = "b0000000-0000-4000-8000-000000000002";

const event: AuditEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  requestId: "b0000000-0000-4000-8000-000000000001",
  requestReference: "LR-00000001",
  employee: {
    id: EMPLOYEE_ID,
    name: "Maya Chen",
    email: "maya.chen@leavetrack.demo",
  },
  actor: {
    id: "b0000000-0000-4000-8000-000000000001",
    name: "Daniel Okafor",
    email: "daniel.okafor@leavetrack.demo",
  },
  action: "hr_override_approved",
  occurredAt: "2026-11-18T12:30:00.000Z",
  detail: "HR override approved — team capacity confirmed",
};

describe("auditReportQuerySchema", () => {
  it("treats missing and empty values as no filter", () => {
    const missing = auditReportQuerySchema.parse({});
    expect(missing.employee).toBeUndefined();
    expect(missing.from).toBeUndefined();
    expect(missing.to).toBeUndefined();

    const empty = auditReportQuerySchema.parse({ employee: "", from: "", to: "" });
    expect(empty.employee).toBeUndefined();
    expect(empty.from).toBeUndefined();
    expect(empty.to).toBeUndefined();
  });

  it("accepts a valid inclusive range and employee", () => {
    const parsed = auditReportQuerySchema.parse({
      employee: EMPLOYEE_ID,
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(parsed).toMatchObject({
      employee: EMPLOYEE_ID,
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("allows from and to to be the same day", () => {
    const result = auditReportQuerySchema.safeParse({ from: "2026-11-18", to: "2026-11-18" });
    expect(result.success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const result = auditReportQuerySchema.safeParse({
      from: "2026-11-30",
      to: "2026-11-01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["to"]);
    }
  });

  it("rejects malformed dates and non-UUID employees", () => {
    expect(auditReportQuerySchema.safeParse({ from: "01/11/2026" }).success).toBe(false);
    expect(auditReportQuerySchema.safeParse({ employee: "maya" }).success).toBe(false);
  });
});

describe("resolveAuditReportQuery (page fail-closed behavior)", () => {
  it("returns a query and no error for valid inclusive filters", () => {
    const result = resolveAuditReportQuery({
      employee: EMPLOYEE_ID,
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.query).toMatchObject({
        employee: EMPLOYEE_ID,
        from: "2026-11-01",
        to: "2026-11-30",
      });
      expect(result.error).toBeNull();
    }
  });

  it("never produces a query for a reversed range", () => {
    const result = resolveAuditReportQuery({ from: "2026-11-30", to: "2026-11-01" });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.query).toBeNull();
      expect(result.error).toMatch(/before the start date/i);
    }
  });

  it("never produces a query for malformed dates or non-UUID employees", () => {
    for (const input of [{ from: "01/11/2026" }, { employee: "maya" }]) {
      const result = resolveAuditReportQuery(input);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.query).toBeNull();
        expect(result.error).toBeTruthy();
      }
    }
  });

  it("treats empty strings as no filter rather than an error", () => {
    const result = resolveAuditReportQuery({ employee: "", from: "", to: "" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.query).toMatchObject({});
  });
});

describe("actionLabel", () => {
  it("expands HR override actions", () => {
    expect(actionLabel("hr_override_approved")).toBe("HR override approved");
    expect(actionLabel("hr_override_rejected")).toBe("HR override rejected");
    expect(actionLabel("submitted")).toBe("Submitted");
    expect(actionLabel("approved")).toBe("Approved");
    expect(actionLabel("rejected")).toBe("Rejected");
  });
});

describe("auditEventToCsvRow", () => {
  it("mirrors the table columns in display order", () => {
    const row = auditEventToCsvRow(event);

    expect(row).toHaveLength(AUDIT_CSV_HEADERS.length);
    expect(row[0]).toBeTruthy();
    expect(row.slice(1)).toEqual([
      "Maya Chen",
      "LR-00000001",
      "HR override approved",
      "Daniel Okafor",
      "HR override approved — team capacity confirmed",
    ]);
  });
});

describe("toCsv", () => {
  it("quotes delimiters and doubles inner quotes", () => {
    const csv = toCsv(["Employee", "Detail"], [["Chen, Maya", 'said "approved"']]);
    expect(csv).toBe('Employee,Detail\r\n"Chen, Maya","said ""approved"""');
  });

  it("quotes embedded newlines", () => {
    const csv = toCsv(["Detail"], [["line one\nline two"]]);
    expect(csv).toBe('Detail\r\n"line one\nline two"');
  });

  it("neutralises spreadsheet formulas", () => {
    const csv = toCsv(["Detail"], [["=SUM(A1:A2)"], ["+cmd"], ["@ref"], ["-5 days"]]);
    expect(csv).toBe("Detail\r\n'=SUM(A1:A2)\r\n'+cmd\r\n'@ref\r\n'-5 days");
  });

  it("leaves ordinary text untouched", () => {
    expect(toCsv(["Action"], [["approved"]])).toBe("Action\r\napproved");
  });
});
