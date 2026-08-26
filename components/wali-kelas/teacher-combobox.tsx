"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { teacherFullName, type Teacher } from "@/lib/wali-kelas"

type TeacherComboboxProps = {
  id?: string
  value: string | null
  teachers: Teacher[]
  // Map teacherId -> nama kelas tempat guru sudah menjadi wali (selain kelas ini).
  assignedElsewhere: Record<string, string>
  onSelect: (teacherId: string) => void
  onClear: () => void
  placeholder?: string
}

export function TeacherCombobox({
  id,
  value,
  teachers,
  assignedElsewhere,
  onSelect,
  onClear,
  placeholder = "Cari dan pilih guru",
}: TeacherComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const selected = value ? teachers.find((t) => t.id === value) ?? null : null

  const trimmed = query.trim().toLowerCase()
  const filtered = trimmed
    ? teachers.filter(
        (t) =>
          teacherFullName(t).toLowerCase().includes(trimmed) ||
          t.nip.includes(trimmed),
      )
    : teachers

  function commit(teacherId: string) {
    onSelect(teacherId)
    setQuery("")
    setOpen(false)
  }

  // Jika sudah ada guru terpilih, tampilkan kartu ringkas + tombol hapus.
  if (selected && !open) {
    return (
      <div ref={wrapRef} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setQuery("")
          }}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {teacherFullName(selected)}
            </span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              NIP {selected.nip}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Hapus pilihan wali kelas"
          title="Hapus pilihan"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
        }}
        className="pl-9"
      />

      {open ? (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
          <ul className="max-h-64 overflow-y-auto" role="listbox">
            {filtered.map((t) => {
              const takenIn = assignedElsewhere[t.id]
              const disabled = Boolean(takenIn)
              const isSelected = value === t.id
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={disabled}
                    onClick={() => !disabled && commit(t.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                      disabled
                        ? "cursor-default opacity-60"
                        : "hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-accent/60",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {teacherFullName(t)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground tabular-nums">
                        NIP {t.nip}
                      </span>
                      {takenIn ? (
                        <span className="mt-0.5 block text-xs font-medium text-destructive">
                          Sudah menjadi wali kelas {takenIn}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              )
            })}

            {filtered.length === 0 ? (
              <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                Guru tidak ditemukan
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
