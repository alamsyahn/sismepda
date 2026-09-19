"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { filterBySearchQuery } from "@/lib/entity-search"
import { cn } from "@/lib/utils"

/**
 * Pemilih satu nilai yang DAPAT DIKETIK untuk menyaring pilihannya.
 *
 * Dipakai menggantikan `Select` pada daftar panjang (guru, kelas, mata
 * pelajaran, pemetaan impor). Daftar pendek yang memang mudah dipindai —
 * misalnya pilihan hari — tetap memakai `Select`, karena kotak pencarian di
 * sana hanya menambah langkah.
 *
 * Penyaringan memakai `lib/entity-search.ts` (substring, case-insensitive,
 * kata boleh tidak berurutan) sehingga perilaku pencarian sama di seluruh
 * aplikasi dan dapat diuji tanpa peramban. Navigasi papan ketik, Enter untuk
 * memilih, dan Escape untuk menutup berasal dari primitif Base UI — tidak ada
 * kotak pencarian buatan sendiri yang perilakunya menyimpang.
 */
export type ComboboxOption = {
  readonly value: string
  readonly label: string
  /** Baris kedua opsional: kelas, NIP, atau keterangan pembeda lain. */
  readonly description?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Pilih",
  emptyMessage = "Tidak ada yang cocok",
  disabled = false,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  options: readonly ComboboxOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
}) {
  const selected = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  // Teks yang cocok mencakup deskripsi, sehingga "VII A" tetap menemukan wali
  // kelasnya ketika deskripsi itulah yang membedakan dua nama yang mirip.
  const filter = React.useCallback(
    (items: readonly ComboboxOption[], query: string) =>
      filterBySearchQuery(items, query, (item) =>
        item.description ? `${item.label} ${item.description}` : item.label,
      ),
    [],
  )

  const [query, setQuery] = React.useState("")
  const filtered = React.useMemo(() => filter(options, query), [filter, options, query])

  return (
    <ComboboxPrimitive.Root
      items={filtered}
      value={selected}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next ? next.value : null)}
      onInputValueChange={(next) => setQuery(next)}
      onOpenChange={(open) => {
        // Menutup daftar mengembalikan kotak ke nama yang benar-benar terpilih,
        // bukan menyisakan potongan ketikan yang tidak memilih apa pun.
        if (!open) setQuery("")
      }}
      itemToStringLabel={(item: ComboboxOption) => item.label}
      itemToStringValue={(item: ComboboxOption) => item.value}
      isItemEqualToValue={(a: ComboboxOption, b: ComboboxOption) => a.value === b.value}
    >
      <ComboboxPrimitive.InputGroup
        data-slot="combobox-trigger"
        className={cn(
          "flex h-9 w-full items-center gap-1.5 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-default has-disabled:opacity-50 dark:bg-input/30",
          className,
        )}
      >
        <ComboboxPrimitive.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          disabled={disabled}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-default"
        />
        <ComboboxPrimitive.Trigger
          disabled={disabled}
          aria-label="Buka daftar pilihan"
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-muted-foreground disabled:cursor-default"
        >
          <ChevronDownIcon className="size-4" />
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} className="isolate z-50 w-(--anchor-width)">
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            className="max-h-72 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {/*
              `Combobox.Empty` WAJIB tetap ter-mount agar pembaca layar
              mengumumkan perubahan jumlah hasil; Base UI mengosongkan
              `children`-nya, bukan elemennya. Karena itu, saat ada hasil ia
              tersisa sebagai <div> kosong yang tetap membawa padding — itulah
              ruang kosong puluhan piksel sebelum item pertama.

              `empty:hidden` menyembunyikannya HANYA ketika benar-benar tanpa
              anak, sehingga pesan "tidak ditemukan" tetap tampil dan
              diumumkan saat daftar kosong. Perbaikan ditaruh di sini, di
              komponen sumbernya, bukan ditambal margin negatif di pemanggil.
            */}
            <ComboboxPrimitive.Empty className="px-2 py-3 text-center text-sm text-muted-foreground empty:hidden">
              {emptyMessage}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(item: ComboboxOption) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  className="relative flex w-full cursor-pointer items-start gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  <ComboboxPrimitive.ItemIndicator className="absolute right-2 top-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
