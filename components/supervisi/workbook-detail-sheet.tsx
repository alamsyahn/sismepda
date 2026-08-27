"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { StatusIcon, StatusLegend } from "@/components/supervisi/status-icon"
import { cn } from "@/lib/utils"
import { formatPercent, progressColor, statusLabels, type WorkbookItemStatus } from "@/lib/workbook"
import type { TeacherSupervisionRow, WorkbookMaster } from "@/lib/server-workbook"
import { ProfileNameLink } from "@/components/profile/profile-name-link"

const options: WorkbookItemStatus[] = ["UNREVIEWED", "PRESENT", "MISSING"]

export type DrawerTarget = { teacherId: string; workbookNumber: number }

export function WorkbookDetailSheet({
  target,
  onClose,
  teachers,
  workbooks,
  canSupervise,
}: {
  target: DrawerTarget | null
  onClose: () => void
  teachers: TeacherSupervisionRow[]
  workbooks: WorkbookMaster[]
  canSupervise: boolean
}) {
  const router = useRouter()
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  const teacher = target ? teachers.find((row) => row.id === target.teacherId) ?? null : null
  const workbook = target ? workbooks.find((item) => item.number === target.workbookNumber) ?? null : null
  const cell = teacher && target
    ? teacher.workbooks.find((item) => item.number === target.workbookNumber) ?? null
    : null

  async function changeStatus(workbookItemId: string, status: WorkbookItemStatus) {
    if (!teacher) return
    setPendingItemId(workbookItemId)
    try {
      const response = await fetch("/api/workbooks/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: teacher.id, workbookItemId, status }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Status supervisi gagal disimpan")
      toast.success(`Status diperbarui: ${statusLabels[status]}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status supervisi gagal disimpan")
    } finally {
      setPendingItemId(null)
    }
  }

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {teacher && workbook && cell ? (
          <>
            <SheetHeader className="border-b p-5">
              <SheetTitle className="text-base">{workbook.name}</SheetTitle>
              <SheetDescription className="text-foreground"><ProfileNameLink type="teacher" id={teacher.id} name={teacher.name} /></SheetDescription>
            </SheetHeader>

            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Kelengkapan</span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {cell.presentCount}/{cell.totalCount} — {formatPercent(cell.percent)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-700 motion-safe:ease-out"
                    style={{ width: `${cell.percent}%`, backgroundColor: progressColor(cell.percent) }}
                  />
                </div>
              </div>

              {cell.url ? (
                <Button
                  variant="outline"
                  size="lg"
                  nativeButton={false}
                  className="min-h-11 w-full"
                  render={<a href={cell.url} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink className="size-4" />
                  Buka {workbook.name}
                </Button>
              ) : (
                <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Guru belum memasukkan link Buku Kerja ini. Status komponen tetap dinilai terpisah dari
                  ketersediaan link.
                </p>
              )}

              <ul className="space-y-2.5">
                {workbook.items.map((item) => {
                  const current = cell.items.find((entry) => entry.itemId === item.id)
                  const status = current?.status ?? "UNREVIEWED"
                  const pending = pendingItemId === item.id
                  return (
                    <li key={item.id} className="space-y-2 rounded-xl border border-border p-3">
                      <div className="flex items-start gap-2.5">
                        <StatusIcon status={status} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground text-pretty">{item.name}</p>
                          {current?.reviewedBy ? (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Diperiksa oleh {current.reviewedBy}
                            </p>
                          ) : null}
                        </div>
                        {pending ? (
                          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>

                      {canSupervise ? (
                        <div
                          role="radiogroup"
                          aria-label={`Status ${item.name}`}
                          className="grid grid-cols-3 gap-1.5"
                        >
                          {options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              role="radio"
                              aria-checked={status === option}
                              disabled={pending}
                              onClick={() => changeStatus(item.id, option)}
                              className={cn(
                                "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                                status === option
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              <StatusIcon status={option} size="sm" />
                              <span className="truncate">
                                {option === "PRESENT" ? "Ada" : option === "MISSING" ? "Tidak" : "Belum"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>

              <StatusLegend />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
