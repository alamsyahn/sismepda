import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { ReactElement } from 'react'
import { SchoolTimeZoneProvider } from '../components/school-time-zone-provider'
function renderToStaticMarkup(node: ReactElement) { return renderMarkup(createElement(AppRouterContext.Provider, { value: { bfcacheId: '', refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch: async () => {} } }, createElement(SchoolTimeZoneProvider, { timeZone: 'Asia/Jayapura' }, node))) }
import { MenstruationCalendar } from '../components/e-uks/menstruation-calendar'
import { MenstruationCard, MenstruationConflictReview } from '../components/e-uks/menstruation-card'
test('conflict reviewer hides controls without explicit review grant', () => {
 const props = { conflict: { id: 'conflict1', targetType: 'episode', targetId: 'e1', proposed: { complaint: 'catatan baru' }, createdAt: '2026-10-14' }, version: 2, canReview: false }
 assert.equal(renderToStaticMarkup(createElement(MenstruationConflictReview, props)), '')
 const html = renderToStaticMarkup(createElement(MenstruationConflictReview, { ...props, canReview: true }))
 assert.match(html, /Pertahankan catatan sekarang/)
 assert.match(html, /Terapkan usulan/)
 assert.match(html, /Alasan tinjauan/)
})

const data = { student: { id: 's1', name: 'Ayu', className: 'VII A' }, profile: null, episodes: [{ id: 'e1', version: 1, startDate: '2026-10-02', endDate: null, complaint: null, source: 'STUDENT' as const, recordedByName: 'Ayu' }] }
test('private revisions show recorder and date but never raw JSON', () => {
 const html = renderToStaticMarkup(createElement(MenstruationCard, { data: { ...data, history: [{ id: 'h1', action: 'UPDATE', createdAt: '2026-10-14T10:00:00Z', recorder: { id: 'u1', name: 'Petugas UKS' }, before: { hidden: 'raw secret' }, after: {} }] }, today: '2026-10-14', canCreate: false, canUpdate: false }))
 assert.match(html, /Riwayat perubahan/)
 assert.match(html, /Petugas UKS/)
 assert.doesNotMatch(html, /raw secret/)
})
test('read-only card has history and no mutation affordance', () => {
 const html = renderToStaticMarkup(createElement(MenstruationCard, { data, today: '2026-10-14', canCreate: false, canUpdate: false }))
 assert.match(html, /Ayu/)
 assert.match(html, /Riwayat/)
 assert.match(html, /Tanggal selesai belum diketahui/)
 assert.doesNotMatch(html, /Mulai haid|Sudah selesai|Tambah catatan sebelumnya|Ubah catatan|Simpan profil/)
})
test('student card offers close for open episode and previous note without daily entry', () => {
 const html = renderToStaticMarkup(createElement(MenstruationCard, { data, today: '2026-10-14', canCreate: true, canUpdate: true, own: true }))
 assert.match(html, /Sudah selesai/)
 assert.match(html, /Tambah catatan sebelumnya/)
 assert.doesNotMatch(html, /Isi harian/)
})

test('revision timestamps cross the school date boundary in Jayapura', () => {
 const html = renderToStaticMarkup(createElement(MenstruationCard, { data: { ...data, history: [{ id: 'h1', action: 'UPDATE', createdAt: '2026-10-14T16:30:00Z', recorder: { id: 'u1', name: 'UKS' }, before: {}, after: {} }] }, today: '2026-10-15', canCreate: false, canUpdate: false }))
 assert.match(html, /15 Oktober 2026/)
 assert.match(html, /01[.:]30/)
 assert.doesNotMatch(html, / UTC/)
})

test('profile preserves explicit unknown, never and experienced values separately', () => {
 for (const [value, label] of [[null, 'Belum ada informasi'], [true, 'Belum pernah haid'], [false, 'Sudah pernah haid']] as const) {
  const props = { data: { ...data, profile: { version: 1, neverMenstruated: value } }, today: '2026-10-14', canCreate: true, canUpdate: true }
  const html = renderToStaticMarkup(createElement(MenstruationCard, props))
  assert.match(html, new RegExp(`<option value="${String(value)}" selected="">${label}`))
  assert.doesNotMatch(html, /type="checkbox"/)
  assert.match(html, /Tambah catatan sebelumnya/)
  const readonly = renderToStaticMarkup(createElement(MenstruationCard, { ...props, canUpdate: false }))
  assert.match(readonly, new RegExp(label))
 }
})

test('individual staff reviews use current target versions while own cards only explain pending review', () => {
 const conflict = { id: 'c1', targetType: 'episode', targetId: 'e1', currentVersion: 7, proposed: { complaint: 'private proposal' }, createdAt: '2026-10-14T16:30:00Z' }
 const props = { data: { ...data, conflicts: [conflict], canReview: true }, today: '2026-10-15', canCreate: false, canUpdate: false }
 const staff = renderToStaticMarkup(createElement(MenstruationCard, props))
 assert.match(staff, /Selesaikan konflik/)
 assert.match(staff, /data-current-version="7"/)
 assert.match(staff, /15 Oktober 2026/)
 assert.match(staff, /tumpang tindih/)
 assert.match(staff, /NONE/)
 const own = renderToStaticMarkup(createElement(MenstruationCard, { ...props, own: true, canReview: true }))
 assert.match(own, /menunggu tinjauan petugas UKS/)
 assert.doesNotMatch(own, /Keputusan|Terapkan usulan|private proposal/)
 const denied = renderToStaticMarkup(createElement(MenstruationCard, { ...props, data: { ...props.data, canReview: false } }))
 assert.doesNotMatch(denied, /Selesaikan konflik/)
})

test('monthly calendar marks only start when end unknown, never extends to today', () => {
 const html = renderToStaticMarkup(createElement(MenstruationCalendar, { month: '2026-10', episodes: [{ id: 'e1', startDate: '2026-10-02', endDate: null }] }))
 assert.equal((html.match(/data-confirmed="true"/g) ?? []).length, 1)
 assert.match(html, /Tanggal selesai belum diketahui/)
})
test('monthly calendar renders confirmed inclusive range across month boundary', () => {
 const html = renderToStaticMarkup(createElement(MenstruationCalendar, { month: '2026-10', episodes: [{ id: 'e1', startDate: '2026-09-29', endDate: '2026-10-03' }] }))
 assert.equal((html.match(/data-confirmed="true"/g) ?? []).length, 3)
 assert.match(html, /grid-cols-7/)
})
