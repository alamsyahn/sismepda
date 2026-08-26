"use client"

import { useRef, useState } from "react"
import { DatabaseBackup, Download, Loader2, RotateCcw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const CONFIRMATION = "RESTORE DATABASE"

export function DatabaseBackupCard() {
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function downloadBackup() {
    setDownloading(true)
    try {
      const response = await fetch("/api/admin/database", { cache: "no-store" })
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition") ?? ""
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "sismepda-backup.dump"
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
      toast.success("Backup database berhasil dibuat")
    } catch { toast.error("Backup database gagal dibuat") }
    finally { setDownloading(false) }
  }

  async function restoreBackup() {
    if (!file || confirmation !== CONFIRMATION) return
    setRestoring(true)
    try {
      const form = new FormData(); form.append("backup", file); form.append("confirmation", confirmation)
      const response = await fetch("/api/admin/database", { method: "POST", body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Restore database gagal")
      setRestoreOpen(false); setFile(null); setConfirmation(""); if (fileRef.current) fileRef.current.value = ""
      toast.success("Database berhasil direstore", { description: "Muat ulang aplikasi dan periksa data sebelum melanjutkan." })
    } catch (error) { toast.error(error instanceof Error ? error.message : "Restore database gagal") }
    finally { setRestoring(false) }
  }

  return <><Card><CardHeader><CardTitle className="flex items-center gap-2"><DatabaseBackup className="size-5 text-primary" />Backup & Restore Database</CardTitle><CardDescription>Unduh salinan seluruh data atau pulihkan data dari backup SISMEPDA.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground"><p>Backup berisi seluruh data aplikasi tanpa mengunci schema versi lama. Saat direstore pada versi aplikasi yang lebih baru, migrasi terbaru tetap dipertahankan.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Button onClick={downloadBackup} disabled={downloading || restoring}>{downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{downloading ? "Membuat Backup..." : "Download Backup"}</Button><Button variant="outline" onClick={() => setRestoreOpen(true)} disabled={downloading || restoring}><RotateCcw className="size-4" />Restore Database</Button></div></CardContent></Card>

  <Dialog open={restoreOpen} onOpenChange={(open) => { if (!restoring) setRestoreOpen(open) }}><DialogContent className="sm:max-w-md" showCloseButton={!restoring}><DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><ShieldAlert className="size-5" />Restore Database</DialogTitle><DialogDescription>Restore akan mengganti seluruh data saat ini. Proses berjalan dalam transaksi; jika backup tidak kompatibel, perubahan dibatalkan.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="backup-file">File backup (.dump)</Label><Input ref={fileRef} id="backup-file" type="file" accept=".dump,application/octet-stream" disabled={restoring} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div><div className="space-y-1.5"><Label htmlFor="restore-confirmation">Ketik {CONFIRMATION}</Label><Input id="restore-confirmation" autoComplete="off" value={confirmation} disabled={restoring} onChange={(event) => setConfirmation(event.target.value)} /></div></div><DialogFooter><DialogClose render={<Button variant="outline" disabled={restoring} />}>Batal</DialogClose><Button variant="destructive" onClick={restoreBackup} disabled={restoring || !file || confirmation !== CONFIRMATION}>{restoring ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{restoring ? "Memulihkan..." : "Restore Sekarang"}</Button></DialogFooter></DialogContent></Dialog></>
}
