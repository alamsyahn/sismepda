import { cn } from "@/lib/utils"
import {
  sarprasStatusColors,
  sarprasStatusLabels,
  type SarprasStatus,
} from "@/lib/sarpras"

/**
 * Status chip used across the table, tree, and detail panel.
 * The colored dot is decorative — the label always carries the meaning, so the
 * status is readable without relying on color alone.
 */
export function SarprasStatusBadge({
  status,
  className,
}: {
  status: SarprasStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: sarprasStatusColors[status] }}
        aria-hidden
      />
      {sarprasStatusLabels[status]}
    </span>
  )
}
