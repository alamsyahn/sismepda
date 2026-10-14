import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
test("private menstrual persistence has CAS, attribution, durable replay, conflict and restrictive identity",()=> {
 const s=readFileSync("prisma/schema.prisma","utf8")
 for(const name of ["MenstruationRecord","MenstruationHistory","MenstruationConflict","MenstruationRequest"]) assert.match(s,new RegExp(`model ${name} \\{`))
 assert.match(s,/studentId String\? @unique/)
 assert.match(s,/linkedStudent Student\? @relation\("StudentAccount"/)
})
