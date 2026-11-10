import { describe, expect, it } from "vitest";

import {
  canConfigurePolicies,
  canDecideRequest,
  canDecideTeamRequests,
  canManageRequests,
  canRunAudit,
  canViewRequest,
  canViewTeam,
  type Actor,
  type RequestScope,
} from "@/lib/auth/policy";

const employee: Actor = { id: "employee-1", role: "employee" };
const manager: Actor = { id: "manager-1", role: "manager" };
const otherManager: Actor = { id: "manager-2", role: "manager" };
const hr: Actor = { id: "hr-1", role: "hr_admin" };

const ownRequest: RequestScope = {
  ownerId: "employee-1",
  ownerManagerId: "manager-1",
  status: "pending",
};

const directReportRequest: RequestScope = {
  ownerId: "employee-2",
  ownerManagerId: "manager-1",
  status: "pending",
};

const otherTeamRequest: RequestScope = {
  ownerId: "employee-3",
  ownerManagerId: "manager-2",
  status: "pending",
};

const unmanagedRequest: RequestScope = {
  ownerId: "employee-4",
  ownerManagerId: null,
  status: "pending",
};

describe("canViewRequest", () => {
  it("lets an employee see their own request", () => {
    expect(canViewRequest(employee, ownRequest)).toBe(true);
  });

  it("stops an employee seeing a direct report or another team's request", () => {
    expect(canViewRequest(employee, directReportRequest)).toBe(false);
    expect(canViewRequest(employee, otherTeamRequest)).toBe(false);
  });

  it("lets a manager see their own request and a direct report's request", () => {
    expect(
      canViewRequest(manager, { ...ownRequest, ownerId: "manager-1", ownerManagerId: null }),
    ).toBe(true);
    expect(canViewRequest(manager, directReportRequest)).toBe(true);
  });

  it("stops a manager seeing another team's request", () => {
    expect(canViewRequest(manager, otherTeamRequest)).toBe(false);
    expect(canViewRequest(otherManager, directReportRequest)).toBe(false);
  });

  it("treats an unmanaged record as visible only to its owner and HR", () => {
    expect(canViewRequest(manager, unmanagedRequest)).toBe(false);
    expect(canViewRequest(hr, unmanagedRequest)).toBe(true);
  });

  it("lets HR see every request", () => {
    expect(canViewRequest(hr, ownRequest)).toBe(true);
    expect(canViewRequest(hr, directReportRequest)).toBe(true);
    expect(canViewRequest(hr, otherTeamRequest)).toBe(true);
  });
});

describe("canDecideRequest", () => {
  it("lets a manager decide a direct report's pending request", () => {
    expect(canDecideRequest(manager, directReportRequest)).toBe(true);
  });

  it("stops a manager deciding their own or another team's request", () => {
    expect(
      canDecideRequest(manager, { ...ownRequest, ownerId: "manager-1", ownerManagerId: null }),
    ).toBe(false);
    expect(canDecideRequest(manager, otherTeamRequest)).toBe(false);
  });

  it("stops an employee deciding their own request", () => {
    expect(canDecideRequest(employee, ownRequest)).toBe(false);
  });

  it("rejects a request that is no longer pending, even for a direct report", () => {
    expect(canDecideRequest(manager, { ...directReportRequest, status: "approved" })).toBe(false);
    expect(canDecideRequest(manager, { ...directReportRequest, status: "rejected" })).toBe(false);
  });

  it("stops HR deciding here; an audited override is a separate task", () => {
    expect(canDecideRequest(hr, otherTeamRequest)).toBe(false);
    expect(canDecideRequest(hr, directReportRequest)).toBe(false);
  });

  it("stops a manager deciding an unmanaged pending record", () => {
    expect(canDecideRequest(manager, unmanagedRequest)).toBe(false);
  });
});

describe("action gates", () => {
  it("limits the team queue to managers", () => {
    expect(canViewTeam(manager)).toBe(true);
    expect(canViewTeam(employee)).toBe(false);
    expect(canViewTeam(hr)).toBe(false);
  });

  it("limits the decision endpoint to managers", () => {
    expect(canDecideTeamRequests(manager)).toBe(true);
    expect(canDecideTeamRequests(employee)).toBe(false);
    expect(canDecideTeamRequests(hr)).toBe(false);
  });

  it("allows managers and HR to manage requests", () => {
    expect(canManageRequests(manager)).toBe(true);
    expect(canManageRequests(hr)).toBe(true);
    expect(canManageRequests(employee)).toBe(false);
  });

  it("limits audit reports to HR", () => {
    expect(canRunAudit(hr)).toBe(true);
    expect(canRunAudit(manager)).toBe(false);
    expect(canRunAudit(employee)).toBe(false);
  });

  it("limits policy configuration to HR", () => {
    expect(canConfigurePolicies(hr)).toBe(true);
    expect(canConfigurePolicies(manager)).toBe(false);
    expect(canConfigurePolicies(employee)).toBe(false);
  });

  it("accepts a bare role string for role-only gates", () => {
    expect(canViewTeam("manager")).toBe(true);
    expect(canDecideTeamRequests("manager")).toBe(true);
    expect(canManageRequests("hr_admin")).toBe(true);
    expect(canRunAudit("hr_admin")).toBe(true);
    expect(canConfigurePolicies("hr_admin")).toBe(true);
    expect(canRunAudit("manager")).toBe(false);
    expect(canManageRequests("employee")).toBe(false);
  });
});
