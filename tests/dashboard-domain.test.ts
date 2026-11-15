import { describe, expect, it } from "vitest";

import {
  summariseEmployeeLeave,
  summariseManagerQueue,
  summariseOrg,
  todayIso,
  upcomingLeave,
} from "@/lib/domain/dashboard";
import type {
  AccrualSummary,
  LeaveBalance,
  LeaveType,
  MyLeaveData,
  MyLeaveRequest,
  OrgLeaveOverview,
  PolicyOverview,
  TeamLeaveData,
  TeamLeaveRequest,
} from "@/lib/types";

const vacation: LeaveType = {
  id: "type-vacation",
  name: "Vacation",
  tracksBalance: true,
};
const sick: LeaveType = { id: "type-sick", name: "Sick", tracksBalance: true };
const unpaid: LeaveType = { id: "type-unpaid", name: "Unpaid", tracksBalance: false };

const TODAY = "2026-11-15";

function myRequest(overrides: Partial<MyLeaveRequest> & { id: string }): MyLeaveRequest {
  return {
    reference: `LR-${overrides.id.toUpperCase()}`,
    leaveType: vacation,
    startDate: "2026-11-20",
    endDate: "2026-11-21",
    days: 2,
    status: "pending",
    createdAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

function teamRequest(overrides: Partial<TeamLeaveRequest> & { id: string }): TeamLeaveRequest {
  return {
    reference: `LR-${overrides.id.toUpperCase()}`,
    employee: { id: "u-1", name: "Maya Chen", email: "maya@example.test" },
    leaveType: vacation,
    startDate: "2026-11-20",
    endDate: "2026-11-21",
    days: 2,
    reason: "Family trip",
    status: "pending",
    createdAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

function balance(overrides: Partial<LeaveBalance> & { leaveType: LeaveType }): LeaveBalance {
  return {
    confirmed: 12.5,
    pending: 0,
    accrualPerMonth: 1.25,
    lastAccruedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("upcomingLeave", () => {
  it("excludes rejected and past requests and sorts by start date", () => {
    const requests = [
      myRequest({ id: "late", startDate: "2026-12-01" }),
      myRequest({ id: "past", startDate: "2026-11-01" }),
      myRequest({ id: "rejected", startDate: "2026-11-20", status: "rejected" }),
      myRequest({ id: "soon", startDate: "2026-11-16", status: "approved" }),
    ];

    expect(upcomingLeave(requests, TODAY).map((request) => request.id)).toEqual(["soon", "late"]);
  });

  it("includes leave that starts today", () => {
    const requests = [myRequest({ id: "today", startDate: TODAY })];

    expect(upcomingLeave(requests, TODAY)).toHaveLength(1);
  });

  it("returns an empty list when nothing qualifies", () => {
    expect(upcomingLeave([], TODAY)).toEqual([]);
  });
});

describe("summariseEmployeeLeave", () => {
  const data: MyLeaveData = {
    balances: [
      balance({ leaveType: vacation, confirmed: 12.5, pending: 5 }),
      balance({ leaveType: sick, confirmed: 8, pending: 0 }),
      balance({ leaveType: unpaid, confirmed: null, pending: 0, accrualPerMonth: null }),
    ],
    requests: [
      myRequest({ id: "pending", status: "pending", days: 2 }),
      myRequest({ id: "approved", status: "approved", days: 5, startDate: "2026-08-10" }),
      myRequest({ id: "rejected", status: "rejected", days: 3, startDate: "2026-10-19" }),
    ],
  };

  const summary = summariseEmployeeLeave({ id: "u-1", name: "Maya Chen" }, data, TODAY);

  it("counts only pending requests", () => {
    expect(summary.pendingCount).toBe(1);
  });

  it("sums approved days only", () => {
    expect(summary.approvedDays).toBe(5);
  });

  it("picks the next non-rejected request from today onwards", () => {
    expect(summary.nextLeave?.id).toBe("pending");
    expect(summary.upcoming.map((request) => request.id)).toEqual(["pending"]);
  });

  it("maps database rows to table summaries with the owner attached", () => {
    expect(summary.requests).toHaveLength(3);
    expect(summary.requests[0]).toMatchObject({
      id: "pending",
      reference: "LR-PENDING",
      employee: { id: "u-1", name: "Maya Chen" },
    });
  });

  it("finds the vacation balance and ignores the others", () => {
    expect(summary.vacationBalance?.leaveType.name).toBe("Vacation");
    expect(summary.vacationBalance?.confirmed).toBe(12.5);
  });

  it("returns no next leave and no balance for an empty workspace", () => {
    const empty = summariseEmployeeLeave(
      { id: "u-2", name: "New Hire" },
      { balances: [], requests: [] },
      TODAY,
    );

    expect(empty.pendingCount).toBe(0);
    expect(empty.approvedDays).toBe(0);
    expect(empty.nextLeave).toBeNull();
    expect(empty.vacationBalance).toBeNull();
  });
});

describe("summariseManagerQueue", () => {
  const data: TeamLeaveData = {
    directReports: [
      { id: "u-1", name: "Maya Chen", email: "maya@example.test" },
      { id: "u-2", name: "Luis Ortega", email: "luis@example.test" },
    ],
    requests: [
      teamRequest({ id: "p1", status: "pending" }),
      teamRequest({
        id: "p2",
        status: "pending",
        employee: { id: "u-2", name: "Luis Ortega", email: "luis@example.test" },
      }),
      teamRequest({ id: "a1", status: "approved" }),
      teamRequest({ id: "a2", status: "approved" }),
      teamRequest({ id: "a3", status: "approved" }),
      teamRequest({ id: "a4", status: "approved" }),
      teamRequest({ id: "r1", status: "rejected" }),
    ],
  };

  const summary = summariseManagerQueue(data);

  it("separates pending from decided without re-filtering by manager", () => {
    expect(summary.pending.map((request) => request.id)).toEqual(["p1", "p2"]);
    expect(summary.pendingCount).toBe(2);
    expect(summary.decided.map((request) => request.id)).toEqual(["a1", "a2", "a3", "a4", "r1"]);
  });

  it("caps the approved preview at three requests", () => {
    expect(summary.currentlyAway.map((request) => request.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("passes the scoped direct reports through unchanged", () => {
    expect(summary.reports.map((report) => report.id)).toEqual(["u-1", "u-2"]);
  });
});

describe("summariseOrg", () => {
  const overview: OrgLeaveOverview = {
    headcount: 10,
    requests: [
      teamRequest({ id: "p1", status: "pending" }),
      teamRequest({ id: "p2", status: "pending" }),
      teamRequest({ id: "a1", status: "approved" }),
    ],
  };
  const policies: PolicyOverview[] = [
    { leaveType: vacation, accrualPerMonth: 1.25, assignedEmployees: 10 },
  ];
  const accrual: AccrualSummary = {
    lastPeriod: "2026-11-01",
    lastRunAt: "2026-11-01T00:00:00.000Z",
    nextRunAt: "2026-12-01",
    peopleProcessed: 10,
  };

  it("counts every pending request across the organisation", () => {
    const summary = summariseOrg({ overview, events: [], eventCount: 42, policies, accrual });

    expect(summary.pending.map((request) => request.id)).toEqual(["p1", "p2"]);
    expect(summary.pendingCount).toBe(2);
    expect(summary.headcount).toBe(10);
    expect(summary.eventCount).toBe(42);
  });

  it("carries the accrual and policy rows through for rendering", () => {
    const summary = summariseOrg({ overview, events: [], eventCount: 0, policies, accrual });

    expect(summary.accrual.lastPeriod).toBe("2026-11-01");
    expect(summary.policies).toHaveLength(1);
  });
});

describe("todayIso", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
