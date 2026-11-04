import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-secondary",
        primary: "bg-primary-subtle text-primary-subtle-foreground",
        success: "bg-success-subtle text-success-foreground",
        warning: "bg-warning-subtle text-warning-foreground",
        danger: "bg-danger-subtle text-danger-foreground",
        info: "bg-info-subtle text-info-foreground",
        outline: "border border-border bg-surface text-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
