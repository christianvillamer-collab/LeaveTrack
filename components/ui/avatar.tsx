import { cn } from "@/lib/utils/cn";

const sizes = {
  sm: "size-8 text-caption",
  md: "size-10 text-small",
  lg: "size-12 text-body",
} as const;

export interface AvatarProps {
  name: string;
  size?: keyof typeof sizes;
  className?: string;
}

export function Avatar({ name, size = "md", className }: AvatarProps) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary-subtle text-primary-subtle-foreground inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizes[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
