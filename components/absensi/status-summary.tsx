import { cn } from "@/lib/utils"
import {
  PRIMARY_STATUS_ORDER,
  primaryStatusConfig,
  type InputStatus,
  type PrimaryStatus,
} from "@/lib/attendance-input"

/**
 * Ringkasan tiga kelompok: Belum Diisi, Hadir, dan Tidak Hadir sebagai gabungan
 * Sakit + Izin + Alfa + Dispensasi. Rinciannya tetap disebut pada judul agar
 * pengguna tahu apa yang digabung.
 */
export function summarizePrimary(counts: Record<InputStatus, number>): Record<PrimaryStatus, number> {
  return {
    belum: counts.belum,
    hadir: counts.hadir,
    tidakHadir: counts.sakit + counts.izin + counts.alfa + counts.dispensasi,
  }
}

export function StatusSummary({ counts }: { counts: Record<InputStatus, number> }) {
  const grouped = summarizePrimary(counts)
  return (
    <div className="flex flex-wrap gap-2">
      {PRIMARY_STATUS_ORDER.map((status) => {
        const cfg = primaryStatusConfig[status]
        return (
          <span
            key={status}
            title={
              status === "tidakHadir"
                ? `Sakit ${counts.sakit} • Izin ${counts.izin} • Alfa ${counts.alfa} • Dispensasi ${counts.dispensasi}`
                : undefined
            }
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
            <span className="font-semibold tabular-nums">{grouped[status]}</span>
            {cfg.label}
          </span>
        )
      })}
    </div>
  )
}
