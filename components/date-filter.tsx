"use client"

import { CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { localDateValue } from "@/lib/date"

export function DateFilter({ value, onChange, ariaLabel = "Pilih tanggal" }: { value: string; onChange: (value: string) => void; ariaLabel?: string }) {
  return (
    <div className="relative">
      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
      <Input type="date" value={value} max={localDateValue()} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} className="w-full bg-card pl-9 sm:w-auto" />
    </div>
  )
}
