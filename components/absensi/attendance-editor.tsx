"use client"

import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusToggle } from "@/components/absensi/status-toggle"
import type { InputStatus, RosterStudent } from "@/lib/attendance-input"

type EditorProps = {
  roster: RosterStudent[]
  statuses: Record<string, InputStatus>
  notes: Record<string, string>
  onStatus: (studentId: string, status: InputStatus) => void
  onNote: (studentId: string, note: string) => void
}

export function AttendanceEditor(props: EditorProps) {
  return (
    <>
      <DesktopTable {...props} />
      <MobileCards {...props} />
    </>
  )
}

function DesktopTable({ roster, statuses, notes, onStatus, onNote }: EditorProps) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:block">
      <Table>
        <colgroup>
          <col style={{ width: "56px" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "20%" }} />
          <col />
          <col style={{ width: "24%" }} />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-12 text-center">No.</TableHead>
            <TableHead className="h-12">NIS</TableHead>
            <TableHead className="h-12">Nama Lengkap Siswa</TableHead>
            <TableHead className="h-12">Status Kehadiran</TableHead>
            <TableHead className="h-12">Keterangan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roster.map((s) => (
            <TableRow key={s.id} className="align-middle">
              <TableCell className="py-3 text-center font-medium tabular-nums text-muted-foreground">
                {String(s.no).padStart(2, "0")}
              </TableCell>
              <TableCell className="py-3 font-mono text-sm text-muted-foreground">{s.nis ?? "-"}</TableCell>
              <TableCell className="py-3 font-medium text-foreground">{s.name}</TableCell>
              <TableCell className="py-3">
                <StatusToggle
                  value={statuses[s.id] ?? "belum"}
                  onChange={(status) => onStatus(s.id, status)}
                  studentName={s.name}
                />
              </TableCell>
              <TableCell className="py-3">
                <Input
                  value={notes[s.id] ?? ""}
                  onChange={(e) => onNote(s.id, e.target.value)}
                  placeholder="Tambahkan keterangan..."
                  aria-label={`Keterangan untuk ${s.name}`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function MobileCards({ roster, statuses, notes, onStatus, onNote }: EditorProps) {
  return (
    <div className="space-y-3 lg:hidden">
      {roster.map((s) => (
        <div
          key={s.id}
          className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">
              {String(s.no).padStart(2, "0")}.
            </span>
            <span className="font-semibold text-foreground text-pretty">{s.name}</span>
          </div>
          <p className="text-xs text-muted-foreground">NIS: <span className="font-mono">{s.nis ?? "-"}</span></p>
          <StatusToggle
            value={statuses[s.id] ?? "belum"}
            onChange={(status) => onStatus(s.id, status)}
            studentName={s.name}
          />
          <Input
            value={notes[s.id] ?? ""}
            onChange={(e) => onNote(s.id, e.target.value)}
            placeholder="Tambahkan keterangan..."
            aria-label={`Keterangan untuk ${s.name}`}
          />
        </div>
      ))}
    </div>
  )
}
