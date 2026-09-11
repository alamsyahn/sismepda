"use client"

import { useEffect, useRef, useState } from "react"

import { Check, ChevronsUpDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { EuksStudentOption } from "@/lib/euks"

type StudentComboboxProps = {
  id?: string
  value: string
  students: EuksStudentOption[]
  onChange: (studentId: string) => void
  placeholder?: string
}

function optionLabel(student: EuksStudentOption): string {
  return `${student.name} — ${student.className}`
}

/**
 * Searchable student picker over existing SISMEPDA students. Students are never
 * created here; the visit form only references them.
 */
export function EuksStudentCombobox({
  id,
  value,
  students,
  onChange,
  placeholder = "Pilih siswa",
}: StudentComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const selected = students.find((student) => student.id === value)
  const trimmed = query.trim().toLowerCase()
  // Matching on class name too, so "7A" narrows the list the same way a name does.
  const filtered = trimmed
    ? students.filter(
        (student) =>
          student.name.toLowerCase().includes(trimmed) ||
          student.className.toLowerCase().includes(trimmed),
      )
    : students

  function commit(studentId: string) {
    onChange(studentId)
    setQuery("")
    setOpen(false)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : selected ? optionLabel(selected) : ""}
        onFocus={() => {
          setOpen(true)
          setQuery("")
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          if (!open) setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            if (filtered.length > 0) commit(filtered[0].id)
          } else if (event.key === "Escape") {
            setOpen(false)
          }
        }}
        className="pr-9"
      />
      <ChevronsUpDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />

      {open ? (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
          <ul className="max-h-56 overflow-y-auto" role="listbox">
            {filtered.slice(0, 50).map((student) => (
              <li key={student.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === student.id}
                  onClick={() => commit(student.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    value === student.id && "bg-accent/60",
                  )}
                >
                  <span className="truncate">
                    {student.name}
                    <span className="text-muted-foreground"> · {student.className}</span>
                  </span>
                  {value === student.id ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </button>
              </li>
            ))}

            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">
                {students.length === 0 ? "Belum ada siswa aktif" : "Tidak ada siswa yang cocok"}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
