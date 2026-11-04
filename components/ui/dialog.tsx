"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onOpenChange(false);
        }
      }}
      className={cn(
        "border-border bg-surface text-foreground backdrop:bg-foreground/50 m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border p-0 shadow-lg backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div className="border-border flex items-start justify-between gap-4 border-b p-5">
        <div className="space-y-1">
          <h2 id={titleId} className="text-h3">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-small text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close dialog"
          onClick={() => onOpenChange(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {children ? <div className="p-5">{children}</div> : null}
      {footer ? (
        <div className="border-border bg-surface-muted/50 flex flex-wrap justify-end gap-3 border-t p-5">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
