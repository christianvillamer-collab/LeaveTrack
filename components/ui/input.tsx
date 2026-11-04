import { cn } from "@/lib/utils/cn";

export function Input({
  className,
  invalid,
  type = "text",
  ...props
}: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "border-input bg-surface text-small text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/25 disabled:bg-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/25 flex h-10 w-full max-w-full min-w-0 rounded-md border px-3 py-2 shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
