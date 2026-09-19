"use client"

import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { UserRound, X } from "lucide-react"

import { SEARCH_MIN_QUERY_LENGTH, autocompleteMatches, hasEnoughSearchQuery } from "@/lib/entity-search"
import { cn } from "@/lib/utils"

export type PickableTeacher = { readonly id: string; readonly name: string }

/**
 * Pemilih guru untuk tab "Jadwal Saya".
 *
 * BUKAN dropdown: membukanya tidak menampilkan seluruh guru. Daftar guru satu
 * sekolah berisi puluhan nama yang mirip, dan menggulir daftar sepanjang itu
 * lebih lambat daripada mengetik tiga huruf. Karena itu affordance-nya ikon
 * orang di kiri dan tombol hapus di kanan — tidak ada chevron, karena chevron
 * menjanjikan perilaku dropdown yang sengaja tidak ada di sini.
 *
 * DUA STATE YANG BERBEDA:
 *
 *   `query`      — teks yang sedang diketik. Hanya menyaring saran.
 *   `value.id`   — guru yang BENAR-BENAR dipilih. Hanya ini yang memuat jadwal.
 *
 * Keduanya sengaja tidak pernah disamakan. Mengetik nama yang kebetulan cocok
 * persis TIDAK memilih guru itu; jadwal berganti hanya setelah sebuah saran
 * diklik atau ditekan Enter. Tanpa pemisahan ini, setiap huruf yang diketik
 * berpotensi memanggil jadwal orang lain.
 *
 * Navigasi panah, Enter untuk memilih, dan Escape untuk menutup berasal dari
 * primitif Base UI, sehingga perilaku papan ketik dan ARIA-nya tidak menyimpang
 * dari pemilih lain di aplikasi.
 */
export function TeacherAutocomplete({
  id,
  teachers,
  value,
  onValueChange,
  disabled = false,
  placeholder = "Ketik nama guru",
}: {
  id?: string
  teachers: readonly PickableTeacher[]
  /** Guru terpilih, atau null ketika belum ada yang dipilih. */
  value: PickableTeacher | null
  onValueChange: (teacher: PickableTeacher | null) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Ketikan ditunda ~250 ms sebelum menyaring. Penyaringan ini memang lokal,
  // tetapi jeda yang sama membuat daftar tidak berkedip pada setiap ketukan
  // tombol, dan menjadi satu-satunya tempat yang perlu diubah bila pencarian
  // kelak pindah ke server.
  const [debounced, setDebounced] = React.useState("")
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  const ready = hasEnoughSearchQuery(debounced)
  const items = React.useMemo(
    () => autocompleteMatches(teachers, debounced, (teacher) => teacher.name),
    [teachers, debounced],
  )

  // Teks kotak: nama guru terpilih bila ada, selain itu ketikan mentah. Guru
  // terpilih tidak disimpan sebagai `query` supaya membuka kembali kotak tidak
  // memperlakukan namanya sebagai pencarian.
  const text = value ? value.name : query

  const clear = () => {
    onValueChange(null)
    setQuery("")
    setDebounced("")
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <AutocompletePrimitive.Root
      items={items}
      value={text}
      open={open && !value}
      disabled={disabled}
      // Penyaringan sudah dikerjakan `autocompleteMatches` dengan aturan
      // `lib/entity-search.ts`; penyaring bawaan dimatikan agar ambang tiga
      // huruf tidak dilangkahi.
      filter={null}
      onOpenChange={(next) => setOpen(next)}
      onValueChange={(next) => {
        // Mengetik di atas nama yang sudah terpilih berarti mencari orang
        // lain: pilihan lama dilepas supaya jadwalnya tidak tertinggal.
        if (value) onValueChange(null)
        setQuery(next)
        setOpen(true)
      }}
      itemToStringValue={(item: PickableTeacher) => item.name}
      onItemHighlighted={() => undefined}
    >
      <AutocompletePrimitive.InputGroup
        className={cn(
          "flex h-9 w-full items-center gap-1.5 rounded-lg border border-input bg-transparent pr-1.5 pl-2.5 text-sm transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          "has-disabled:cursor-default has-disabled:opacity-50 dark:bg-input/30",
        )}
      >
        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <AutocompletePrimitive.Input
          ref={inputRef}
          id={id}
          placeholder={placeholder}
          disabled={disabled}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-default"
        />
        {value || query ? (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label="Hapus pilihan guru"
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </AutocompletePrimitive.InputGroup>

      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner sideOffset={4} className="isolate z-50 w-(--anchor-width)">
          <AutocompletePrimitive.Popup className="max-h-72 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            {/*
              Dua keadaan yang berbeda, dan hanya satu yang boleh tampil:
              "belum cukup huruf" bukan "tidak ditemukan". Menyamakan keduanya
              membuat pengguna mengira gurunya tidak ada padahal pencarian
              belum berjalan.

              Keduanya dirender bersyarat — `Autocomplete.Empty` sengaja tidak
              dipakai karena elemennya tetap ter-mount saat ada hasil dan
              padding-nya menjadi ruang kosong sebelum item pertama.
            */}
            {!ready ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                Ketik minimal {SEARCH_MIN_QUERY_LENGTH} huruf untuk mencari guru
              </p>
            ) : items.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">Guru tidak ditemukan</p>
            ) : null}

            <AutocompletePrimitive.List>
              {(teacher: PickableTeacher) => (
                <AutocompletePrimitive.Item
                  key={teacher.id}
                  value={teacher}
                  onClick={() => {
                    onValueChange(teacher)
                    setQuery("")
                    setDebounced("")
                    setOpen(false)
                    // Pemilihan sudah selesai: cincin fokus yang tetap menyala
                    // membuat kotak tampak masih menunggu ketikan.
                    inputRef.current?.blur()
                  }}
                  className="flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{teacher.name}</span>
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  )
}
