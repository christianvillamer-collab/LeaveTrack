export type Role = "employee" | "manager" | "hr_admin";

export const ROLES = ["employee", "manager", "hr_admin"] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  hr_admin: "HR Admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  employee: "Submit requests and view your own balances.",
  manager: "Review requests from your direct reports only.",
  hr_admin: "Run audit reports and manage leave policies.",
};

export const ROLE_HOME = "/dashboard";

export function isRole(value: string | undefined | null): value is Role {
  return value === "employee" || value === "manager" || value === "hr_admin";
}

export function canManageRequests(role: Role): boolean {
  return role === "manager" || role === "hr_admin";
}

export function canRunAudit(role: Role): boolean {
  return role === "hr_admin";
}

export function canConfigurePolicies(role: Role): boolean {
  return role === "hr_admin";
}
