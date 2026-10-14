import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
test("API protects mutations by same origin and reads through guarded private loaders",()=>{
 const source=readFileSync("app/api/e-uks/menstruation/route.ts","utf8")
 assert.match(source,/verifySameOrigin\(request\)/)
 assert.match(source,/readMenstruationCard/)
 assert.match(source,/readMenstruationWeek/)
 assert.match(source,/mutateMenstruation/)
 assert.match(source,/no-store/)
 assert.doesNotMatch(source,/console\.(log|error)/)
})
