"use client"

import { Check, Circle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { statusLabels, type WorkbookItemStatus } from "@/lib/workbook"

const iconByStatus = { PRESENT: Check, MISSING: X, UNREVIEWED: Circle } as const

const toneByStatus: Record<WorkbookItemStatus, string> = {
  PRESENT: "border-primary/30 bg-primary/10 text-primary",
  MISSING: "border-destructive/30 bg-destructive/10 text-destructive",
  UNREVIEWED: "border-border bg-muted text-muted-foreground",
}

/** Status marker: always an icon plus an accessible label, never colour alone. */
export function StatusIcon({
  status,
  className,
  size = "default",
}: {
  status: WorkbookItemStatus
  className?: string
  size?: "sm" | "default"
}) {
  const Icon = iconByStatus[status]
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border",
        size === "sm" ? "size-4" : "size-6",
        toneByStatus[status],
        className,
      )}
      title={statusLabels[status]}
    >
      <Icon className={size === "sm" ? "size-2.5" : "size-3.5"} strokeWidth={3} aria-hidden />
      <span className="sr-only">{statusLabels[status]}</span>
    </span>
  )
}

/** Compact run of item markers for a workbook cell, e.g. ✓ ✓ ✓ ✓ ○ ○ */
export function StatusDots({ statuses }: { statuses: WorkbookItemStatus[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {statuses.map((status, index) => (
        <StatusIcon key={index} status={status} size="sm" />
      ))}
    </span>
  )
}

export function StatusLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {(["PRESENT", "MISSING", "UNREVIEWED"] as const).map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <StatusIcon status={status} size="sm" />
          {statusLabels[status]}
        </li>
      ))}
    </ul>
  )
}
