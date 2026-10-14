import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
test('own page guards before own loader and never passes URL student id', () => {
 const text = readFileSync('app/kartu-menstruasi/page.tsx','utf8')
 assert.ok(text.indexOf('await requirePagePermission("euks.menstruation.read.own")') < text.indexOf('await readMenstruationCard()'))
 assert.match(text,/own/)
 assert.doesNotMatch(text,/searchParams|studentId:/)
})
test('weekly page guards before dedicated class query and loader, not broad euks loaders', () => {
 const text = readFileSync('app/e-uks/menstruasi-mingguan/page.tsx','utf8')
 assert.ok(text.indexOf('await requirePagePermission("euks.menstruation.read")') < text.indexOf('await prisma.schoolClass.findMany'))
 assert.match(text,/readMenstruationWeek/)
 assert.doesNotMatch(text,/server-euks|readEuksClassOptions/)
})
