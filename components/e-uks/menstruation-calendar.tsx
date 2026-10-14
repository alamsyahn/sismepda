import React from 'react'

export type CalendarEpisode = { id: string; startDate: string; endDate: string | null }
export function MenstruationCalendar({ month, episodes }: { month: string; episodes: CalendarEpisode[] }) {
 const [year, number] = month.split('-').map(Number)
 const count = new Date(Date.UTC(year, number, 0)).getUTCDate()
 const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7
 return <section aria-label={`Kalender menstruasi ${month}`} className="min-w-0 space-y-3">
 <div className="grid grid-cols-7 gap-1 text-center text-xs" aria-hidden="true">{['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d => <span key={d}>{d}</span>)}</div>
 <div className="grid grid-cols-7 gap-1">{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: count }, (_, i) => {
 const date = `${month}-${String(i + 1).padStart(2, '0')}`
 const confirmed = episodes.some(e => date >= e.startDate && date <= (e.endDate ?? e.startDate))
 return <span key={date} data-confirmed={confirmed ? 'true' : undefined} aria-label={`${date}${confirmed ? ', tanggal haid tercatat' : ''}`} className={`flex min-h-9 items-center justify-center rounded-md text-sm ${confirmed ? 'bg-primary text-primary-foreground font-semibold' : 'bg-muted/40'}`}>{i + 1}</span>
 })}</div><p className="text-xs text-muted-foreground">Warna menandai tanggal yang tercatat, bukan perkiraan.</p>{episodes.some(e => !e.endDate) && <p className="text-sm">Tanggal selesai belum diketahui; hanya hari mulai ditandai.</p>}
 </section>
}
