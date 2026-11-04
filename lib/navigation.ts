import {
  CalendarPlus,
  FileText,
  Inbox,
  LayoutDashboard,
  ScrollText,
  Settings2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { canManageRequests, canRunAudit, type Role } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export function navSectionsFor(role: Role): NavSection[] {
  const workspace: NavItem[] = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/requests", label: "My requests", icon: FileText },
    { href: "/requests/new", label: "Request leave", icon: CalendarPlus, exact: true },
    { href: "/balance", label: "My balance", icon: Wallet },
  ];

  if (canManageRequests(role)) {
    workspace.push({ href: "/approvals", label: "Approvals", icon: Inbox });
  }

  const sections: NavSection[] = [{ label: "Workspace", items: workspace }];

  if (canRunAudit(role)) {
    sections.push({
      label: "Administration",
      items: [
        { href: "/audit", label: "Audit log", icon: ScrollText },
        { href: "/settings/policies", label: "Leave policies", icon: Settings2 },
      ],
    });
  }

  return sections;
}

export function mobileNavItems(role: Role): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
    { href: "/requests", label: "Requests", icon: FileText },
    { href: "/requests/new", label: "Request", icon: CalendarPlus, exact: true },
    { href: "/balance", label: "Balance", icon: Wallet },
  ];

  if (canManageRequests(role)) {
    items.push({ href: "/approvals", label: "Approvals", icon: Inbox });
  }

  return items.slice(0, 5);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) {
    return pathname === item.href;
  }

  if (item.href === "/requests") {
    return pathname === "/requests" || /^\/requests\/(?!new$)[^/]+$/.test(pathname);
  }

  return pathname.startsWith(item.href);
}
