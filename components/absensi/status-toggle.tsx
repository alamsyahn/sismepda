"use client"

import { useRef } from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import type { StatusConfig } from "@/lib/attendance-input"

export type StatusOption<T extends string> = {
  value: T
  config: StatusConfig
}

/**
 * Segmented control yang secara semantik adalah radio group.
 *
 * Dipakai dua kali per siswa: status utama (Belum Diisi / Hadir / Tidak Hadir)
 * dan alasan ketidakhadiran. Navigasi panah mengikuti pola radio group WAI-ARIA
 * (roving tabindex), dan pilihan aktif ditandai ikon centang + border tebal,
 * bukan warna saja.
 */
export function StatusRadioGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  optionClassName,
}: {
  options: readonly StatusOption<T>[]
  value: T | null
  onChange: (value: T) => void
  label: string
  className?: string
  optionClassName?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length
    onChange(options[next].value)
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")
    buttons?.[next]?.focus()
  }

  const activeIndex = options.findIndex((option) => option.value === value)

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {options.map((option, index) => {
        const active = option.value === value
        // Roving tabindex: hanya satu tombol per grup yang masuk urutan Tab.
        const tabbable = activeIndex === -1 ? index === 0 : active
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault()
                move(index, 1)
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault()
                move(index, -1)
              }
            }}
            className={cn(
              "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? cn(option.config.active, "border-2 font-semibold shadow-sm")
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              optionClassName,
            )}
          >
            {active ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <span
                className="size-1.5 shrink-0 rounded-full opacity-40"
                style={{ backgroundColor: option.config.token }}
                aria-hidden
              />
            )}
            <span className="text-center leading-tight">{option.config.label}</span>
          </button>
        )
      })}
    </div>
  )
}
