import type { Role } from "@/lib/auth/roles";
import type {
  AuditEvent,
  Employee,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  Policy,
} from "@/lib/types";

/**
 * Day 0 mock data. Every page renders from these fixtures; no database or
 * network call is made. Day 1 replaces this module with server-side queries
 * while keeping the exported types and selector signatures.
 */

export const employees: Employee[] = [
  {
    id: "u-maya",
    name: "Maya Chen",
    email: "maya.chen@leavetrack.demo",
    role: "employee",
    managerId: "u-daniel",
    jobTitle: "Product Designer",
    team: "Product",
  },
  {
    id: "u-daniel",
    name: "Daniel Okafor",
    email: "daniel.okafor@leavetrack.demo",
    role: "manager",
    managerId: null,
    jobTitle: "Head of Product",
    team: "Product",
  },
  {
    id: "u-priya",
    name: "Priya Nair",
    email: "priya.nair@leavetrack.demo",
    role: "hr_admin",
    managerId: null,
    jobTitle: "People Operations Lead",
    team: "People",
  },
  {
    id: "u-luis",
    name: "Luis Ortega",
    email: "luis.ortega@leavetrack.demo",
    role: "employee",
    managerId: "u-daniel",
    jobTitle: "Frontend Engineer",
    team: "Product",
  },
  {
    id: "u-amara",
    name: "Amara Diallo",
    email: "amara.diallo@leavetrack.demo",
    role: "employee",
    managerId: "u-daniel",
    jobTitle: "Data Analyst",
    team: "Product",
  },
  {
    id: "u-tom",
    name: "Tom Becker",
    email: "tom.becker@leavetrack.demo",
    role: "employee",
    managerId: "u-daniel",
    jobTitle: "QA Engineer",
    team: "Product",
  },
  {
    id: "u-sana",
    name: "Sana Iqbal",
    email: "sana.iqbal@leavetrack.demo",
    role: "employee",
    managerId: "u-daniel",
    jobTitle: "Product Manager",
    team: "Product",
  },
  {
    id: "u-erin",
    name: "Erin Walsh",
    email: "erin.walsh@leavetrack.demo",
    role: "manager",
    managerId: null,
    jobTitle: "Head of Engineering",
    team: "Engineering",
  },
  {
    id: "u-kai",
    name: "Kai Nakamura",
    email: "kai.nakamura@leavetrack.demo",
    role: "employee",
    managerId: "u-erin",
    jobTitle: "Platform Engineer",
    team: "Engineering",
  },
  {
    id: "u-nina",
    name: "Nina Petrov",
    email: "nina.petrov@leavetrack.demo",
    role: "employee",
    managerId: "u-erin",
    jobTitle: "Backend Engineer",
    team: "Engineering",
  },
];

export const leaveTypes: LeaveType[] = [
  { id: "lt-vacation", name: "Vacation", tracksBalance: true },
  { id: "lt-sick", name: "Sick", tracksBalance: true },
  { id: "lt-unpaid", name: "Unpaid", tracksBalance: false },
];

const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
const leaveTypeById = new Map(leaveTypes.map((leaveType) => [leaveType.id, leaveType]));

function person(id: string): Employee {
  const found = employeeById.get(id);
  if (!found) {
    throw new Error(`Unknown mock employee: ${id}`);
  }
  return found;
}

function type(id: string): LeaveType {
  const found = leaveTypeById.get(id);
  if (!found) {
    throw new Error(`Unknown mock leave type: ${id}`);
  }
  return found;
}

export const leaveRequests: LeaveRequest[] = [
  {
    id: "r-1001",
    reference: "LR-1001",
    employee: person("u-maya"),
    leaveType: type("lt-vacation"),
    startDate: "2026-11-16",
    endDate: "2026-11-20",
    days: 5,
    reason: "Family trip booked earlier this year. Handover notes are in the design sprint board.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-11-01T09:12:00.000Z",
  },
  {
    id: "r-1002",
    reference: "LR-1002",
    employee: person("u-maya"),
    leaveType: type("lt-sick"),
    startDate: "2026-10-06",
    endDate: "2026-10-07",
    days: 2,
    reason: "Flu — doctor advised two days of rest.",
    status: "approved",
    decidedBy: person("u-daniel"),
    decidedAt: "2026-10-05T16:40:00.000Z",
    decisionNote: "Get well soon.",
    createdAt: "2026-10-04T08:05:00.000Z",
  },
  {
    id: "r-1003",
    reference: "LR-1003",
    employee: person("u-maya"),
    leaveType: type("lt-vacation"),
    startDate: "2026-08-10",
    endDate: "2026-08-14",
    days: 5,
    reason: "Summer break with family.",
    status: "approved",
    decidedBy: person("u-daniel"),
    decidedAt: "2026-07-21T10:02:00.000Z",
    decisionNote: null,
    createdAt: "2026-07-18T13:30:00.000Z",
  },
  {
    id: "r-1004",
    reference: "LR-1004",
    employee: person("u-luis"),
    leaveType: type("lt-vacation"),
    startDate: "2026-11-23",
    endDate: "2026-11-27",
    days: 5,
    reason: "Thanksgiving week with my parents out of state.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-11-02T07:45:00.000Z",
  },
  {
    id: "r-1005",
    reference: "LR-1005",
    employee: person("u-amara"),
    leaveType: type("lt-sick"),
    startDate: "2026-11-09",
    endDate: "2026-11-09",
    days: 1,
    reason: "Dental procedure in the morning.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-11-02T14:18:00.000Z",
  },
  {
    id: "r-1006",
    reference: "LR-1006",
    employee: person("u-tom"),
    leaveType: type("lt-unpaid"),
    startDate: "2026-11-30",
    endDate: "2026-12-02",
    days: 3,
    reason: "Moving apartments — no paid leave left for the year.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-11-03T08:01:00.000Z",
  },
  {
    id: "r-1007",
    reference: "LR-1007",
    employee: person("u-sana"),
    leaveType: type("lt-vacation"),
    startDate: "2026-10-19",
    endDate: "2026-10-21",
    days: 3,
    reason: "Long weekend away.",
    status: "rejected",
    decidedBy: person("u-daniel"),
    decidedAt: "2026-10-12T11:25:00.000Z",
    decisionNote: "Overlaps the pricing launch. Please pick dates after 26 Oct.",
    createdAt: "2026-10-09T15:40:00.000Z",
  },
  {
    id: "r-1008",
    reference: "LR-1008",
    employee: person("u-kai"),
    leaveType: type("lt-vacation"),
    startDate: "2026-11-18",
    endDate: "2026-11-20",
    days: 3,
    reason: "Wedding in Osaka.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-11-01T11:10:00.000Z",
  },
  {
    id: "r-1009",
    reference: "LR-1009",
    employee: person("u-nina"),
    leaveType: type("lt-sick"),
    startDate: "2026-10-28",
    endDate: "2026-10-29",
    days: 2,
    reason: "Migraine, working from home is not possible.",
    status: "approved",
    decidedBy: person("u-erin"),
    decidedAt: "2026-10-27T09:55:00.000Z",
    decisionNote: null,
    createdAt: "2026-10-27T07:20:00.000Z",
  },
  {
    id: "r-1010",
    reference: "LR-1010",
    employee: person("u-priya"),
    leaveType: type("lt-vacation"),
    startDate: "2026-12-21",
    endDate: "2026-12-23",
    days: 3,
    reason: "Year-end break.",
    status: "approved",
    decidedBy: null,
    decidedAt: "2026-10-30T09:00:00.000Z",
    decisionNote: "Auto-approved — HR admin.",
    createdAt: "2026-10-29T12:00:00.000Z",
  },
  {
    id: "r-1011",
    reference: "LR-1011",
    employee: person("u-daniel"),
    leaveType: type("lt-vacation"),
    startDate: "2026-12-07",
    endDate: "2026-12-09",
    days: 3,
    reason: "Planning retreat followed by two days of family time.",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-11-02T10:30:00.000Z",
  },
];

const CURRENT_EMPLOYEE_BY_ROLE: Record<Role, string> = {
  employee: "u-maya",
  manager: "u-daniel",
  hr_admin: "u-priya",
};

export function currentEmployee(role: Role): Employee {
  return person(CURRENT_EMPLOYEE_BY_ROLE[role]);
}

export function employeeFor(id: string): Employee {
  return person(id);
}

export function directReports(managerId: string): Employee[] {
  return employees.filter((employee) => employee.managerId === managerId);
}

export function requestsForEmployee(employeeId: string): LeaveRequest[] {
  return leaveRequests
    .filter((request) => request.employee.id === employeeId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function teamRequests(managerId: string): LeaveRequest[] {
  const reportIds = new Set(directReports(managerId).map((employee) => employee.id));
  return leaveRequests
    .filter((request) => reportIds.has(request.employee.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pendingTeamRequests(managerId: string): LeaveRequest[] {
  return teamRequests(managerId).filter((request) => request.status === "pending");
}

export function allRequests(): LeaveRequest[] {
  return [...leaveRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function requestById(id: string): LeaveRequest | null {
  return leaveRequests.find((request) => request.id === id) ?? null;
}

const balanceFixtures: Record<string, LeaveBalance[]> = {
  "u-maya": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 12.5,
      pending: 5,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 8,
      pending: 0,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 0,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  "u-luis": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 6,
      pending: 5,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 5,
      pending: 0,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 0,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  "u-amara": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 14,
      pending: 0,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 9.5,
      pending: 1,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 0,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  "u-tom": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 2.5,
      pending: 0,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 7,
      pending: 0,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 3,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  "u-sana": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 9,
      pending: 0,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 6,
      pending: 0,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 0,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  "u-daniel": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 16.25,
      pending: 3,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 9,
      pending: 0,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 0,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
  "u-priya": [
    {
      leaveType: type("lt-vacation"),
      confirmed: 18,
      pending: 0,
      accrualPerMonth: 1.25,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-sick"),
      confirmed: 10,
      pending: 0,
      accrualPerMonth: 1,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
    {
      leaveType: type("lt-unpaid"),
      confirmed: null,
      pending: 0,
      accrualPerMonth: null,
      lastAccruedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
};

export function balancesFor(employeeId: string): LeaveBalance[] {
  return balanceFixtures[employeeId] ?? balanceFixtures["u-maya"];
}

export const policies: Policy[] = [
  {
    id: "pol-vacation",
    leaveType: type("lt-vacation"),
    accrualPerMonth: 1.25,
    assignedEmployees: 800,
  },
  {
    id: "pol-sick",
    leaveType: type("lt-sick"),
    accrualPerMonth: 1,
    assignedEmployees: 800,
  },
];

export const auditEvents: AuditEvent[] = [
  {
    id: "a-01",
    requestId: "r-1001",
    requestReference: "LR-1001",
    employee: person("u-maya"),
    actor: person("u-maya"),
    action: "submitted",
    occurredAt: "2026-11-01T09:12:00.000Z",
    detail: "Vacation request submitted for 16–20 Nov 2026.",
  },
  {
    id: "a-02",
    requestId: "r-1002",
    requestReference: "LR-1002",
    employee: person("u-maya"),
    actor: person("u-maya"),
    action: "submitted",
    occurredAt: "2026-10-04T08:05:00.000Z",
    detail: "Sick leave request submitted for 6–7 Oct 2026.",
  },
  {
    id: "a-03",
    requestId: "r-1002",
    requestReference: "LR-1002",
    employee: person("u-maya"),
    actor: person("u-daniel"),
    action: "approved",
    occurredAt: "2026-10-05T16:40:00.000Z",
    detail: "Approved by Daniel Okafor. Sick balance reduced by 2 days.",
  },
  {
    id: "a-04",
    requestId: "r-1007",
    requestReference: "LR-1007",
    employee: person("u-sana"),
    actor: person("u-daniel"),
    action: "rejected",
    occurredAt: "2026-10-12T11:25:00.000Z",
    detail: "Rejected: overlaps the pricing launch. No balance change.",
  },
  {
    id: "a-05",
    requestId: "r-1009",
    requestReference: "LR-1009",
    employee: person("u-nina"),
    actor: person("u-erin"),
    action: "approved",
    occurredAt: "2026-10-27T09:55:00.000Z",
    detail: "Approved by Erin Walsh. Sick balance reduced by 2 days.",
  },
  {
    id: "a-06",
    requestId: "r-1004",
    requestReference: "LR-1004",
    employee: person("u-luis"),
    actor: person("u-luis"),
    action: "submitted",
    occurredAt: "2026-11-02T07:45:00.000Z",
    detail: "Vacation request submitted for 23–27 Nov 2026.",
  },
  {
    id: "a-07",
    requestId: "r-1005",
    requestReference: "LR-1005",
    employee: person("u-amara"),
    actor: person("u-amara"),
    action: "submitted",
    occurredAt: "2026-11-02T14:18:00.000Z",
    detail: "Sick leave request submitted for 9 Nov 2026.",
  },
  {
    id: "a-08",
    requestId: "r-1010",
    requestReference: "LR-1010",
    employee: person("u-priya"),
    actor: person("u-priya"),
    action: "approved",
    occurredAt: "2026-10-30T09:00:00.000Z",
    detail: "Auto-approved for HR admin. Vacation balance reduced by 3 days.",
  },
];

export function auditForRequest(requestId: string): AuditEvent[] {
  return auditEvents
    .filter((event) => event.requestId === requestId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function auditForEmployee(employeeId: string): AuditEvent[] {
  return auditEvents
    .filter((event) => event.employee.id === employeeId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function allAuditEvents(): AuditEvent[] {
  return [...auditEvents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export const accrualSummary = {
  lastRunAt: "2026-11-01T00:00:00.000Z",
  nextRunAt: "2026-12-01T00:00:00.000Z",
  employeesProcessed: 800,
};
