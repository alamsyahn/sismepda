import { statusMeta, type AttendanceStatus } from "@/lib/dashboard-data"

export function StatusPill({
  status,
  count,
}: {
  status: AttendanceStatus
  count?: number
}) {
  const meta = statusMeta[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.badge}`}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.token }} />
      {meta.label}
      {count !== undefined ? <span className="font-semibold">{count}</span> : null}
    </span>
  )
}
