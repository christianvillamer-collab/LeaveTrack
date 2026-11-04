import { cn } from "@/lib/utils/cn";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-small text-foreground font-semibold", className)} {...props} />;
}
