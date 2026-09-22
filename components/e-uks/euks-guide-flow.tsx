import {
  Calculator,
  ChevronDown,
  ChevronRight,
  ClipboardPen,
  LineChart,
  Ruler,
  ShieldCheck,
  Tags,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react"

import { EUKS_GUIDE_FLOW, type EuksGuideFlowStep } from "@/lib/euks-guide"
import { cn } from "@/lib/utils"

const flowIcons: Record<EuksGuideFlowStep["icon"], LucideIcon> = {
  ruler: Ruler,
  "shield-check": ShieldCheck,
  calculator: Calculator,
  "line-chart": LineChart,
  tags: Tags,
  "trending-up": TrendingUp,
  "clipboard-pen": ClipboardPen,
  "users-round": UsersRound,
}

/**
 * Diagram alur pengukuran sampai tindak lanjut.
 *
 * Digambar dari HTML + Tailwind + ikon Lucide, tanpa pustaka diagram dan tanpa
 * ASCII. Strukturnya satu daftar berurut: pada ponsel menjadi alur vertikal
 * dengan panah ke bawah, pada layar lebar menjadi grid dua/empat kolom dengan
 * panah ke samping. Panah adalah elemen dekoratif (`aria-hidden`) — urutan
 * sudah dibawa oleh `<ol>` dan nomor langkahnya, jadi pembaca layar tidak
 * mendengar "panah kanan" delapan kali.
 */
export function EuksGuideFlow() {
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {EUKS_GUIDE_FLOW.map((step, index) => {
        const Icon = flowIcons[step.icon]
        const isLast = index === EUKS_GUIDE_FLOW.length - 1
        return (
          <li key={step.step} className="relative flex flex-col">
            <div className="bg-card h-full space-y-2 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <span className="bg-euks-accent-soft text-euks-accent flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon aria-hidden="true" className="size-4.5" />
                </span>
                <span className="text-muted-foreground text-xs font-semibold tabular-nums">
                  Langkah {step.step}
                </span>
              </div>
              <p className="text-sm font-semibold text-pretty">{step.title}</p>
              <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                {step.description}
              </p>
            </div>
            {isLast ? null : (
              <>
                <ChevronDown
                  aria-hidden="true"
                  className="text-euks-accent/70 mx-auto my-1 size-5 sm:hidden"
                />
                {/* Panah menyamping hanya digambar bila kartu berikutnya memang
                    berada di kolom sebelahnya: di akhir baris (kelipatan 2 pada
                    sm, kelipatan 4 pada xl) panah itu akan menunjuk ke luar
                    grid. */}
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "text-euks-accent/70 absolute top-1/2 -right-3 hidden size-5 -translate-y-1/2",
                    (index + 1) % 2 === 0 ? "sm:hidden" : "sm:block",
                    (index + 1) % 4 === 0 ? "xl:hidden" : "xl:block",
                  )}
                />
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}
