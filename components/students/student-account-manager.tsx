"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { StudentAccountRosterRow } from "@/lib/student-account-server"

export function StudentAccountManager({ students }: { students: StudentAccountRosterRow[] }) {
  const router = useRouter()
  const [studentId, setStudentId] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const available = students.filter((student) => !student.account)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/student-accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, email, password }),
      })
      const result = await response.json()
      if (!response.ok) { setMessage(result.error ?? "Akun gagal dibuat"); return }
      setPassword("")
      setEmail("")
      setStudentId("")
      setMessage("Akun berhasil dibuat. Berikan kredensial secara pribadi kepada siswi, bukan melalui daftar kelas.")
      router.refresh()
    } catch { setMessage("Koneksi gagal. Muat ulang daftar sebelum mencoba lagi.") }
    finally { setBusy(false) }
  }

  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>Buat akun pribadi siswi</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-sm text-muted-foreground">Hanya siswi aktif tanpa akun. Login memakai email dan sandi yang Anda tetapkan, bukan NIS/NISN. Akun yang sudah ada tidak dapat ditautkan atau diambil alih di sini.</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="student-account-student">Siswi</Label>
          <select id="student-account-student" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={studentId} onChange={(event) => setStudentId(event.target.value)} disabled={busy || available.length === 0} required>
            <option value="">Pilih siswi</option>{available.map((student) => <option key={student.id} value={student.id}>{student.name} — {student.schoolClass.name}</option>)}
          </select>
        </div>
        <div className="space-y-2"><Label htmlFor="student-account-email">Email login</Label><Input id="student-account-email" type="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required /></div>
        <div className="space-y-2"><Label htmlFor="student-account-password">Sandi awal</Label><Input id="student-account-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required /><p className="text-xs text-muted-foreground">8–128 karakter; gunakan sandi unik, bukan nomor identitas atau tanggal lahir.</p></div>
        <Button type="submit" disabled={busy || available.length === 0}>{busy ? "Membuat…" : "Buat akun"}</Button>
        <p role="status" aria-live="polite" className="text-sm">{message}</p>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Status akun siswi aktif</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-sm text-muted-foreground">Reset sandi dan penonaktifan akun dilakukan di Pengaturan Pengguna oleh pemegang izin kredensial/status. Sandi tidak ditampilkan kembali.</p>
      {students.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada siswi aktif.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Nama</th><th className="p-2">Kelas</th><th className="p-2">Status akun</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-b"><td className="p-2">{student.name}</td><td className="p-2">{student.schoolClass.name}</td><td className="p-2">{student.account ? (student.account.active ? "Aktif" : "Nonaktif") : "Belum dibuat"}</td></tr>)}</tbody></table></div>}
    </CardContent></Card>
  </div>
}
