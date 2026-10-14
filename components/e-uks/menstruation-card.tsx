'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MenstruationCalendar } from './menstruation-calendar'
import { useSchoolTimeZone } from '@/components/school-time-zone-provider'
import { formatSchoolDate, differenceInSchoolDays, requireSchoolDate } from '@/lib/school-date'

export type MenstruationEpisodeView = { id: string; version: number; startDate: string; endDate: string | null; complaint: string | null; source: string; recordedByName?: string | null; recorder?: { id: string; name: string } }
export type MenstruationCardData = { student: { id: string; name: string; className?: string }; profile: { version: number; neverMenstruated: boolean | null } | null; episodes: MenstruationEpisodeView[]; weeks?: { id: string; version: number }[]; conflicts?: MenstruationConflict[]; canReview?: boolean; history?: { id: string; action: string; createdAt: string; recorder: { id: string; name: string }; before: unknown; after: unknown }[] }
export function describeMenstruationProposal(value: unknown): string {
 if (!value || typeof value !== 'object') return 'Usulan tidak tersedia'
 const p = value as Record<string, unknown>
 if (p.action === 'profile') return p.neverMenstruated === true ? 'Belum pernah haid' : p.neverMenstruated === false ? 'Sudah pernah haid' : 'Belum ada informasi'
 if (p.action === 'weekly' && Array.isArray(p.rows)) return p.rows.map(r => describeMenstruationProposal(r)).join('; ')
 return [typeof p.status === 'string' ? ({ HAD: 'Haid minggu ini', NONE: 'Tidak haid minggu ini', UNKNOWN: 'Belum dikonfirmasi' } as Record<string,string>)[p.status] : '', typeof p.startDate === 'string' ? `Mulai ${p.startDate}` : '', p.endDate ? `Selesai ${p.endDate}` : 'Selesai belum diketahui', typeof p.complaint === 'string' ? `Keluhan: ${p.complaint}` : '', p.episode ? describeMenstruationProposal(p.episode) : ''].filter(Boolean).join(' · ')
}
export type MenstruationConflict = { id: string; targetType: string; targetId: string | null; proposed: unknown; createdAt: string; currentVersion?: number }
export function MenstruationConflictReview({ conflict, version, canReview }: { conflict: MenstruationConflict; version: number | undefined; canReview: boolean }) {
 const router = useRouter()
 const { dateFromInstant, formatTime } = useSchoolTimeZone()
 const [reason, setReason] = useState('')
 const [resolution, setResolution] = useState<'KEEP_CURRENT' | 'APPLY_PROPOSED'>('KEEP_CURRENT')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 if (!canReview) return null
 return <form data-current-version={version} className="space-y-2 rounded-lg border border-primary/30 p-3" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await postMenstruation({ action: 'review', requestId: crypto.randomUUID(), conflictId: conflict.id, version, resolution, reason }); router.refresh() } catch(e) { setError(e instanceof Error ? e.message : 'Tinjauan gagal disimpan.') } finally { setBusy(false) } }}><h4 className="font-medium">Selesaikan konflik</h4><p className="text-xs text-muted-foreground">Usulan <time dateTime={conflict.createdAt}>{formatSchoolDate(dateFromInstant(new Date(conflict.createdAt)))} · {formatTime(new Date(conflict.createdAt))}</time>. Bandingkan dengan catatan yang tampil sebelum memilih.</p><p className="text-sm text-muted-foreground">Jika usulan tumpang tindih dengan episode atau bertentangan dengan minggu NONE, pilih Pertahankan catatan sekarang lalu koreksi episode atau minggu terkait dengan versi terbaru. Terapkan usulan tidak menggabungkan episode atau mengubah minggu lain otomatis.</p><p className="break-words text-sm">Usulan: {describeMenstruationProposal(conflict.proposed)}</p><label className="block text-sm">Keputusan<select className="block w-full rounded-md border bg-background p-2" value={resolution} onChange={e => setResolution(e.target.value as typeof resolution)}><option value="KEEP_CURRENT">Pertahankan catatan sekarang</option><option value="APPLY_PROPOSED">Terapkan usulan</option></select></label><label className="block text-sm">Alasan tinjauan<Input required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy || !reason.trim() || version === undefined} type="submit">{busy ? 'Menyimpan…' : 'Simpan keputusan'}</Button></form>
}
export type MenstruationCardProps = { data: MenstruationCardData; today: string; canCreate: boolean; canUpdate: boolean; canReview?: boolean; own?: boolean; onSaved?: () => void }
export async function postMenstruation(payload: object) {
 const response = await fetch('/api/e-uks/menstruation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
 const body = await response.json().catch(() => ({}))
 if (!response.ok) throw new Error(body.error ?? body.message ?? (response.status === 409 ? 'Catatan telah berubah. Muat ulang untuk membandingkan; isian Anda tetap tersedia.' : 'Catatan gagal disimpan. Coba lagi.'))
 return body
}
export function MenstruationCard({ data, today, canCreate, canUpdate, canReview = data.canReview ?? false, own = false, onSaved }: MenstruationCardProps) {
 const router = useRouter()
 const { dateFromInstant, formatTime } = useSchoolTimeZone()
 const [month, setMonth] = useState(today.slice(0, 7))
 const [mode, setMode] = useState<'new' | 'close' | 'edit' | null>(null)
 const [editing, setEditing] = useState<MenstruationEpisodeView | null>(null)
 const [start, setStart] = useState(today)
 const [end, setEnd] = useState('')
 const [complaint, setComplaint] = useState('')
 const [never, setNever] = useState<boolean | null>(data.profile?.neverMenstruated ?? null)
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [error, setError] = useState('')
 const open = data.episodes.find(e => !e.endDate)
 const history = [...data.episodes].sort((a,b) => b.startDate.localeCompare(a.startDate))
 function begin(next: 'new' | 'close' | 'edit', episode?: MenstruationEpisodeView) { setMode(next); setEditing(episode ?? null); setStart(episode?.startDate ?? today); setEnd(next === 'close' ? today : episode?.endDate ?? ''); setComplaint(episode?.complaint ?? ''); setError(''); setMessage('') }
 async function save(profile = false) {
 setBusy(true); setError(''); setMessage('')
 try {
 const target = own ? {} : { studentId: data.student.id }
 await postMenstruation(profile ? { action: 'profile', requestId: crypto.randomUUID(), ...target, version: data.profile?.version ?? 0, neverMenstruated: never } : { action: 'episode', requestId: crypto.randomUUID(), ...target, ...(editing ? { id: editing.id, version: editing.version } : {}), startDate: start, endDate: end || null, complaint: complaint.trim() || null })
 setMessage('Catatan berhasil disimpan.'); setMode(null); onSaved?.(); router.refresh()
 } catch (e) { setError(e instanceof Error ? e.message : 'Catatan gagal disimpan. Isian tetap tersedia.') } finally { setBusy(false) }
 }
 return <Card className="min-w-0" data-menstruation-card><CardHeader><CardTitle>Kartu Menstruasi — {data.student.name}</CardTitle><p className="text-sm text-muted-foreground">Catat mulai dan selesai saat diketahui. Tidak perlu mengisi setiap hari.</p></CardHeader><CardContent className="space-y-6">
 <div className="grid min-w-0 gap-6 md:grid-cols-2"><div className="space-y-3"><label className="block text-sm" htmlFor={`month-${data.student.id}`}>Bulan kalender</label><Input id={`month-${data.student.id}`} type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /><MenstruationCalendar month={month} episodes={data.episodes} /></div>
 <div className="space-y-4"><p>{open ? `Mulai tercatat ${open.startDate}. Tanggal selesai belum diketahui.` : 'Tidak ada catatan dengan tanggal selesai yang belum diketahui.'}</p>
 <div className="flex flex-wrap gap-2">{canCreate && !open && <Button className="min-h-11" onClick={() => begin('new')}>Mulai haid</Button>}{canUpdate && open && <Button className="min-h-11" onClick={() => begin('close', open)}>Sudah selesai</Button>}{canCreate && <Button className="min-h-11" variant="outline" onClick={() => begin('new')}>Tambah catatan sebelumnya</Button>}</div>
 {mode && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save() }}><h3 className="font-medium">{mode === 'close' ? 'Tanggal selesai' : mode === 'edit' ? 'Ubah catatan' : 'Catatan mulai haid'}</h3><label htmlFor="menstruation-start" className="block text-sm">Tanggal mulai</label><Input id="menstruation-start" type="date" max={today} value={start} onChange={e => setStart(e.target.value)} required disabled={busy || mode === 'close'} /><label htmlFor="menstruation-end" className="block text-sm">Tanggal selesai {mode !== 'close' && '(opsional)'}</label><Input id="menstruation-end" type="date" min={start} max={today} value={end} onChange={e => setEnd(e.target.value)} required={mode === 'close'} disabled={busy} /><label htmlFor="menstruation-complaint" className="block text-sm">Keluhan (opsional)</label><Input id="menstruation-complaint" value={complaint} maxLength={1000} onChange={e => setComplaint(e.target.value)} disabled={busy} /><div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan catatan'}</Button><Button variant="outline" type="button" disabled={busy} onClick={() => setMode(null)}>Batal</Button></div></form>}
 <section className="rounded-lg border p-3"><h3 className="font-medium">Profil (terpisah dari catatan)</h3>{canUpdate ? <><label className="my-3 block space-y-2 text-sm">Informasi haid<select className="block w-full min-h-11 rounded-md border bg-background px-3" value={String(never)} onChange={e => setNever(e.target.value === 'null' ? null : e.target.value === 'true')} disabled={busy}><option value="null">Belum ada informasi</option><option value="true">Belum pernah haid</option><option value="false">Sudah pernah haid</option></select></label><Button variant="outline" disabled={busy} onClick={() => void save(true)}>Simpan profil</Button></> : <p className="text-sm">{data.profile?.neverMenstruated === true ? 'Belum pernah haid' : data.profile?.neverMenstruated === false ? 'Sudah pernah haid' : 'Belum ada informasi'}</p>}</section></div></div>
 {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-primary">{message}</p>}
 <section className="space-y-3"><h3 className="font-semibold">Riwayat</h3>{!history.length && <p className="text-sm text-muted-foreground">Belum ada catatan menstruasi.</p>}{history.map((e,i) => <article key={e.id} className="rounded-lg border p-3 space-y-1"><p className="font-medium">{e.startDate} — {e.endDate ?? 'Tanggal selesai belum diketahui'}</p><p className="text-sm">Durasi: {e.endDate ? `${differenceInSchoolDays(requireSchoolDate(e.startDate), requireSchoolDate(e.endDate)) + 1} hari` : 'belum dapat dihitung'}{history[i + 1] ? ` · Jarak mulai: ${differenceInSchoolDays(requireSchoolDate(history[i + 1].startDate), requireSchoolDate(e.startDate))} hari` : ''}</p><p className="text-xs text-muted-foreground">Sumber: {e.source === 'STUDENT' ? 'Siswa' : 'UKS'} · Pencatat: {e.recorder?.name ?? e.recordedByName ?? 'Tidak tersedia'}</p>{e.complaint && <p className="text-sm break-words">Keluhan: {e.complaint}</p>}{canUpdate && <Button variant="outline" onClick={() => begin('edit', e)}>Ubah catatan</Button>}</article>)}</section>
 {data.history && <section className="space-y-2"><h3 className="font-semibold">Riwayat perubahan</h3>{data.history.length ? <ul className="space-y-2">{data.history.map(h => <li key={h.id} className="rounded-md border p-2 text-sm"><span>{h.action === 'CREATE' ? 'Catatan dibuat' : h.action === 'UPDATE' ? 'Catatan diperbarui' : h.action === 'REVIEW' ? 'Konflik ditinjau' : 'Konflik dicatat'}</span> · Pencatat: {h.recorder.name} · <time dateTime={h.createdAt}>{formatSchoolDate(dateFromInstant(new Date(h.createdAt)))} · {formatTime(new Date(h.createdAt))}</time></li>)}</ul> : <p className="text-sm text-muted-foreground">Belum ada perubahan.</p>}</section>}
 {data.conflicts?.length ? <section className="space-y-3"><h3 className="font-semibold">Perlu ditinjau</h3>{own || !canReview ? <p className="text-sm text-muted-foreground">Catatan menunggu tinjauan petugas UKS.</p> : data.conflicts.map(c => <MenstruationConflictReview key={c.id} conflict={c} version={c.currentVersion ?? (c.targetType === 'profile' ? data.profile?.version ?? 0 : c.targetType === 'episode' ? (c.targetId ? data.episodes.find(e => e.id === c.targetId)?.version : 0) : (c.targetId ? data.weeks?.find(w => w.id === c.targetId)?.version : 0))} canReview={canReview} />)}</section> : null}
 </CardContent></Card>
}
