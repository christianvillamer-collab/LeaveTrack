/**
 * Public metadata for the optional one-click demo sign-in picker.
 *
 * This module deliberately contains no password or credential material. The
 * shared demo password stays server-side in `DEMO_LOGIN_PASSWORD`; the picker
 * only asks the `/auth/demo-login` route to sign in as one of these allowlisted
 * seeded accounts.
 */

export const DEMO_ACCOUNT_IDS = ["employee", "manager", "hr_admin"] as const;

export type DemoAccountId = (typeof DEMO_ACCOUNT_IDS)[number];

export interface DemoAccount {
  id: DemoAccountId;
  label: string;
  name: string;
  email: string;
}

export const DEMO_ACCOUNTS: Record<DemoAccountId, DemoAccount> = {
  employee: {
    id: "employee",
    label: "Employee",
    name: "Maya Chen",
    email: "maya.chen@leavetrack.demo",
  },
  manager: {
    id: "manager",
    label: "Manager",
    name: "Daniel Okafor",
    email: "daniel.okafor@leavetrack.demo",
  },
  hr_admin: {
    id: "hr_admin",
    label: "HR admin",
    name: "Priya Nair",
    email: "priya.nair@leavetrack.demo",
  },
};

export const DEMO_ACCOUNT_LIST: DemoAccount[] = DEMO_ACCOUNT_IDS.map((id) => DEMO_ACCOUNTS[id]);
