"use client"

import { Plus, GraduationCap } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateFilter } from "@/components/date-filter"
import { formatLongDate } from "@/lib/date"

type DashboardHeaderProps = {
  selectedClass: string
  onClassChange: (value: string) => void
  classes: Array<{ id: string; name: string }>
  date: string
  onDateChange: (value: string) => void
}

export function DashboardHeader({ selectedClass, onClassChange, classes, date, onDateChange }: DashboardHeaderProps) {
  const classOptions = [{ value: "all", label: "Semua Kelas" }, ...classes.map((c) => ({ value: c.id, label: c.name }))]
  const attendanceHref = selectedClass === "all"
    ? `/absensi/input?date=${encodeURIComponent(date)}`
    : `/absensi/input?date=${encodeURIComponent(date)}&classId=${encodeURIComponent(selectedClass)}`
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3">
        <span className="hidden size-11 items-center justify-center rounded-2xl bg-primary/12 text-primary sm:flex">
          <GraduationCap className="size-6" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground text-balance sm:text-3xl">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Ringkasan absensi dan kelengkapan input pada{" "}
            <span className="text-base font-bold text-foreground">{formatLongDate(date)}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <DateFilter value={date} onChange={onDateChange} ariaLabel="Tanggal dashboard" />

        <Select value={selectedClass} onValueChange={(value) => value && onClassChange(value)}>
          <SelectTrigger className="w-full bg-card shadow-sm sm:w-44">
            <SelectValue placeholder="Pilih kelas">
              {(value: string) =>
                classOptions.find((o) => o.value === value)?.label ?? "Pilih kelas"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {classOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button className="shadow-sm" render={<Link href={attendanceHref} />}>
          <Plus className="size-4" />
          Input Absensi
        </Button>
      </div>
    </header>
  )
}
