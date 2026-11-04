import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const styles = {
  info: {
    container: "border-info/25 bg-info-subtle text-info-foreground",
    icon: Info,
  },
  success: {
    container: "border-success/25 bg-success-subtle text-success-foreground",
    icon: CheckCircle2,
  },
  warning: {
    container: "border-warning/25 bg-warning-subtle text-warning-foreground",
    icon: TriangleAlert,
  },
  danger: {
    container: "border-danger/25 bg-danger-subtle text-danger-foreground",
    icon: AlertCircle,
  },
} as const;

export type AlertVariant = keyof typeof styles;

export interface AlertProps extends React.ComponentProps<"div"> {
  variant?: AlertVariant;
  title?: string;
}

export function Alert({ className, variant = "info", title, children, ...props }: AlertProps) {
  const config = styles[variant];
  const Icon = config.icon;

  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn(
        "text-small flex gap-3 rounded-md border px-4 py-3",
        config.container,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-small opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
