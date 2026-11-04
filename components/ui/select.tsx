import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export function Select({
  className,
  invalid,
  children,
  ...props
}: React.ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          "border-input bg-surface text-small text-foreground focus-visible:border-primary focus-visible:ring-ring/25 disabled:bg-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/25 flex h-10 w-full appearance-none rounded-md border py-2 pr-9 pl-3 shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </div>
  );
}
