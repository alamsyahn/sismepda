import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { ReactElement } from 'react'
import { SchoolTimeZoneProvider } from '../components/school-time-zone-provider'
function renderToStaticMarkup(node: ReactElement) { return renderMarkup(createElement(AppRouterContext.Provider, { value: { bfcacheId: '', refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch: async () => {} } }, createElement(SchoolTimeZoneProvider, { timeZone: 'Asia/Jayapura' }, node))) }
import { MenstruationWeekly, changedWeeklyRows } from '../components/e-uks/menstruation-weekly'
import { menstruationMutationSchema } from '../lib/menstruation'
test('changed weekly rows obey actual strict server contract', () => {
 const payload = { action: 'weekly', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', classId: 'c1', weekStart: '2026-10-12', rows: changedWeeklyRows(rows, { s1: { status: 'HAD', startDate: '', endDate: '', note: '', episodeId: '' } }) }
 assert.equal(menstruationMutationSchema.safeParse(payload).success, true)
})
test('weekly drafts serialize nested episodes atomically with identity and CAS', () => {
 const row = { student: { id: 's1', name: 'Ayu' }, observation: null, episodes: [{ id: 'e1', version: 2, startDate: '2026-10-12', endDate: null, complaint: null, source: 'STUDENT' }] }
 const payload = changedWeeklyRows([row], { s1: { status: 'HAD', startDate: '2026-10-12', endDate: '2026-10-14', note: 'keluhan', episodeId: 'e1' } })
 assert.deepEqual(payload[0].episode, { id: 'e1', version: 2, startDate: '2026-10-12', endDate: '2026-10-14', complaint: 'keluhan' })
 assert.equal(payload[0].episodeId, undefined)
})
const rows = [{ student: { id: 's1', name: 'Ayu' }, observation: null, episodes: [] }, { student: { id: 's2', name: 'Dewi' }, observation: null, episodes: [] }]
test('batch includes hidden changed rows only and unknown start never fabricates episode', () => {
 const drafts = { s1: { status: 'HAD' as const, startDate: '', endDate: '', note: 'belum diketahui', episodeId: '' }, s2: { status: 'NONE' as const, startDate: '', endDate: '', note: '', episodeId: '' } }
 const payload = changedWeeklyRows(rows, drafts)
 assert.equal(payload.length, 2)
 assert.equal(payload[0].complaint, 'belum diketahui')
 assert.equal(payload[0].episodeId, undefined)
 assert.equal(changedWeeklyRows(rows, { s2: drafts.s2 }).length, 1)
})
test('weekly conflict review uses server target version for another week and null targets', () => {
 for (const targetId of ['other-week', null]) {
  const row = { student: { id: 's1', name: 'Ayu' }, observation: { id: 'current-week', version: 2, status: 'NONE' as const }, episodes: [], conflicts: [{ id: 'c1', targetType: 'weekly', targetId, currentVersion: 9, proposed: { status: 'HAD' }, createdAt: '2026-10-14T16:30:00Z' }] }
  const html = renderToStaticMarkup(createElement(MenstruationWeekly, { data: { classId: 'c1', weekStart: '2026-10-12', rows: [row] }, classes: [{ id: 'c1', name: 'VII A' }], canCreate: false, canUpdate: false, canReview: true }))
  assert.match(html, /data-current-version="9"/)
  assert.match(html, /15 Oktober 2026/)
  assert.match(html, /01[.:]30/)
 }
})

test('read only weekly renders roster without batch or review mutation affordance', () => {
 const html = renderToStaticMarkup(createElement(MenstruationWeekly, { data: { classId: 'c1', weekStart: '2026-10-12', rows }, classes: [{ id: 'c1', name: 'VII A' }], canCreate: false, canUpdate: false, canReview: false }))
 assert.match(html, /<table/)
 assert.match(html, /<th[^>]*>Siswi/)
 assert.match(html, /Ayu/)
 assert.match(html, /Dewi/)
 assert.doesNotMatch(html, /Simpan perubahan|Selesaikan konflik/)
 assert.match(html, /Belum dikonfirmasi/)
})
