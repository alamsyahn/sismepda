import { cn } from "@/lib/utils"
import {
  INPUT_STATUS_ORDER,
  inputStatusConfig,
  type InputStatus,
} from "@/lib/attendance-input"

export function StatusSummary({ counts }: { counts: Record<InputStatus, number> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {INPUT_STATUS_ORDER.map((status) => {
        const cfg = inputStatusConfig[status]
        return (
          <span
            key={status}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              cfg.badge,
            )}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: cfg.token }}
              aria-hidden
            />
            <span className="font-semibold tabular-nums">{counts[status]}</span>
            {cfg.label}
          </span>
        )
      })}
    </div>
  )
}
