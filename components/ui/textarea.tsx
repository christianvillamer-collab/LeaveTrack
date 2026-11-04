import { cn } from "@/lib/utils/cn";

export function Textarea({
  className,
  invalid,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        "border-input bg-surface text-small text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/25 disabled:bg-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/25 flex min-h-24 w-full rounded-md border px-3 py-2 shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
