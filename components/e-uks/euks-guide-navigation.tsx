import { ArrowDown } from "lucide-react"

import { EUKS_GUIDE_SECTIONS } from "@/lib/euks-guide"

/**
 * Navigasi cepat ke section pada halaman yang sama.
 *
 * Anchor `<a href="#id">` biasa — tanpa state, tanpa JavaScript — sehingga
 * halaman tetap server component dan tautan tetap bekerja meskipun skrip
 * gagal dimuat. Grid melebar bertahap: satu kolom di ponsel, dua di tablet,
 * empat di desktop, sehingga tidak pernah ada gulir horizontal.
 */
export function EuksGuideNavigation() {
  return (
    <nav aria-label="Navigasi cepat panduan" className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase">Navigasi cepat</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {EUKS_GUIDE_SECTIONS.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="bg-card hover:border-euks-accent/50 focus-visible:ring-ring group flex h-full flex-col gap-1 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true">{entry.emoji}</span>
                {entry.title}
                <ArrowDown
                  aria-hidden="true"
                  className="text-euks-accent ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                />
              </span>
              <span className="text-muted-foreground text-xs text-pretty">{entry.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
