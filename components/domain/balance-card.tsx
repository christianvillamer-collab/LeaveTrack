import { Infinity as InfinityIcon } from "lucide-react";

import { LeaveTypeBadge } from "@/components/domain/leave-type-badge";
import { Card } from "@/components/ui/card";
import type { LeaveBalance } from "@/lib/types";
import { formatDate, formatDays } from "@/lib/utils/format";

export function BalanceCard({ balance }: { balance: LeaveBalance }) {
  const tracked = balance.confirmed !== null;
  const total = balance.confirmed ?? 0;
  const percent = tracked ? Math.min(100, Math.round((total / 20) * 100)) : 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <LeaveTypeBadge leaveType={balance.leaveType} />
        <span className="text-caption text-muted-foreground min-w-0">
          {tracked
            ? `${formatDays(balance.accrualPerMonth ?? 0)} accrued / month`
            : "No balance tracked"}
        </span>
      </div>

      <div>
        <p className="text-caption text-muted-foreground">
          {tracked ? "Available balance" : "Balance limit"}
        </p>
        <p className="text-h1 text-foreground mt-1 flex items-baseline gap-2 tabular-nums">
          {tracked ? (
            <>
              {total.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
              <span className="text-small text-muted-foreground font-normal">days</span>
            </>
          ) : (
            <>
              <InfinityIcon aria-hidden="true" className="text-muted-foreground size-7" />
              <span className="text-small text-muted-foreground font-normal">
                Not balance-limited
              </span>
            </>
          )}
        </p>
      </div>

      {tracked ? (
        <div
          role="img"
          aria-label={`${balance.leaveType.name}: ${formatDays(total)} available out of a 20 day reference`}
          className="bg-muted h-2 w-full overflow-hidden rounded-full"
        >
          <div
            aria-hidden="true"
            className="bg-primary h-full rounded-full"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      <dl className="border-border text-caption grid grid-cols-2 gap-3 border-t pt-3">
        <div>
          <dt className="text-muted-foreground">Pending</dt>
          <dd className="text-foreground mt-0.5 font-semibold tabular-nums">
            {balance.pending > 0 ? formatDays(balance.pending) : "None"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="text-foreground mt-0.5 font-semibold">
            {tracked ? formatDate(balance.lastAccruedAt) : "No accrual"}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
