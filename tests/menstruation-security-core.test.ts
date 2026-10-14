import test from "node:test"
import assert from "node:assert/strict"
import * as wire from "../lib/menstruation"

test("private card projection removes other pupils from conflict proposals and nested history snapshots", () => {
 const proposal={action:"weekly",requestId:"request",classId:"class",weekStart:"2026-10-12",rows:[{studentId:"own",status:"HAD",complaint:"own note"},{studentId:"other",name:"other pupil",complaint:"other secret",episode:{complaint:"nested secret"}}]}
 const project=(wire as unknown as {projectMenstruationSnapshot:(value:unknown,studentId:string)=>unknown}).projectMenstruationSnapshot
 assert.equal(typeof project,"function")
 assert.deepEqual(project(proposal,"own"),{...proposal,rows:[proposal.rows[0]]})
 const history={conflictId:"conflict",proposed:proposal,before:{studentId:"other",complaint:"other secret"},after:{studentId:"own",complaint:"own note"}}
 assert.deepEqual(project(history,"own"),{conflictId:"conflict",proposed:{...proposal,rows:[proposal.rows[0]]},before:null,after:history.after})
 assert.equal(JSON.stringify(project(history,"own")).includes("other"),false)
 assert.deepEqual(proposal.rows.length,2)
})
