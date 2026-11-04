import { cn } from "@/lib/utils/cn";

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}
    >
      <div className="space-y-1">
        {eyebrow ? (
          <p className="text-caption text-primary font-semibold tracking-wide uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-h1 text-foreground">{title}</h1>
        {description ? (
          <p className="text-small text-muted-foreground max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
