"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/(app)/actions";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { isNavItemActive, navSectionsFor } from "@/lib/navigation";
import { cn } from "@/lib/utils/cn";

export interface SidebarProps {
  name: string;
  email: string;
  role: Role;
}

export function Sidebar({ name, email, role }: SidebarProps) {
  const pathname = usePathname();
  const sections = navSectionsFor(role);

  return (
    <aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-[16.5rem] flex-col border-r lg:flex">
      <div className="flex h-16 items-center px-5">
        <Brand />
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.label} className="space-y-1">
            <p className="text-caption text-sidebar-muted px-3 font-semibold tracking-wider uppercase">
              {section.label}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isNavItemActive(item, pathname);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "text-small focus-visible:ring-primary-foreground flex items-center gap-3 rounded-md px-3 py-2.5 font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        active
                          ? "bg-sidebar-active text-sidebar-foreground shadow-xs"
                          : "text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon aria-hidden="true" className="size-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-sidebar-border border-t p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <Avatar name={name} size="sm" className="bg-sidebar-active text-sidebar-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-small text-sidebar-foreground truncate font-semibold">{name}</p>
            <p className="text-caption text-sidebar-muted truncate">{email}</p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 px-2">
          <Badge variant="primary" className="bg-sidebar-active text-sidebar-foreground">
            {ROLE_LABELS[role]}
          </Badge>
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              className="text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
