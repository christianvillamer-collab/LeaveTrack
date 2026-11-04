"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";

import { Brand, PreviewBadge } from "@/components/layout/brand";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/(app)/actions";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { isNavItemActive, mobileNavItems, navSectionsFor } from "@/lib/navigation";
import { cn } from "@/lib/utils/cn";

export interface MobileNavProps {
  name: string;
  email: string;
  role: Role;
}

export function MobileNav({ name, email, role }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const sections = navSectionsFor(role);
  const bottomItems = mobileNavItems(role);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable || focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="border-border bg-background/95 sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur lg:hidden">
        <Brand variant="light" />
        <div className="flex items-center gap-2">
          <PreviewBadge className="xs:inline-flex hidden" />
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Open navigation menu"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="bg-foreground/40 absolute inset-0 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <nav
            ref={drawerRef}
            id="mobile-navigation"
            aria-label="Primary"
            className="bg-surface absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col shadow-lg"
          >
            <div className="border-border flex h-14 items-center justify-between border-b px-4">
              <Brand variant="light" />
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            <div className="border-border flex items-center gap-3 border-b p-4">
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <p className="text-small truncate font-semibold">{name}</p>
                <p className="text-caption text-muted-foreground truncate">{email}</p>
              </div>
              <Badge variant="primary">{ROLE_LABELS[role]}</Badge>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-3">
              {sections.map((section) => (
                <div key={section.label} className="space-y-1">
                  <p className="text-caption text-muted-foreground px-3 font-semibold tracking-wider uppercase">
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
                            onClick={() => setOpen(false)}
                            className={cn(
                              "text-small flex items-center gap-3 rounded-md px-3 py-2.5 font-medium",
                              active
                                ? "bg-primary-subtle text-primary-subtle-foreground"
                                : "text-foreground hover:bg-muted",
                            )}
                          >
                            <Icon aria-hidden="true" className="size-5" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <form action={signOut} className="border-border border-t p-3">
              <Button
                type="submit"
                variant="secondary"
                className="w-full justify-start"
                aria-label="Sign out"
              >
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      ) : null}

      <nav
        aria-label="Mobile primary"
        className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="flex items-stretch justify-around">
          {bottomItems.map((item) => {
            const active = isNavItemActive(item, pathname);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "text-caption flex flex-col items-center gap-1 px-1 py-2.5 font-medium",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
