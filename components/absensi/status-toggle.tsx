"use client"

import { cn } from "@/lib/utils"
import {
  INPUT_STATUS_ORDER,
  inputStatusConfig,
  type InputStatus,
} from "@/lib/attendance-input"

export function StatusToggle({
  value,
  onChange,
  studentName,
}: {
  value: InputStatus
  onChange: (status: InputStatus) => void
  studentName: string
}) {
  return (
    <div
      role="group"
      aria-label={`Status kehadiran ${studentName}`}
      className="flex flex-wrap gap-1.5"
    >
      {INPUT_STATUS_ORDER.map((status) => {
        const cfg = inputStatusConfig[status]
        const active = value === status
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(status)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? cn(cfg.active, "shadow-sm")
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full transition-opacity", !active && "opacity-40")}
              style={{ backgroundColor: cfg.token }}
              aria-hidden
            />
            {cfg.label}
          </button>
        )
      })}
    </div>
  )
}
