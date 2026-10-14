import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

test("private history DTO exposes recorded source separately from current row source",()=>{
 const source=readFileSync("lib/server-menstruation.ts","utf8")
 assert.match(source,/history:histories\.map\(v=>\(\{id:v\.id,source:v\.source,/)
})
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { executeMenstruationMutation } from "../lib/server-menstruation"

const local=process.env.SISMEPDA_DB_ROLE === "local"
test("local menstruation consistency and private provenance",{skip:!local},async t=>{
 const url=process.env.DATABASE_URL!;const parsed=new URL(url)
 assert.equal(parsed.pathname,"/sismepda_dev");assert.ok(["localhost","127.0.0.1","[::1]"].includes(parsed.hostname))
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url},{schema:databaseSchema(url)})})
 const counts=async()=>Promise.all([db.student.count(),db.user.count(),db.schoolClass.count(),db.attendance.count(),db.euksVisit.count(),db.menstruationRecord.count(),db.menstruationHistory.count(),db.menstruationConflict.count(),db.menstruationRequest.count(),db.auditLog.count()])
 const before=await counts();const suffix=randomUUID();let classId="",actorId="";const students:string[]=[]
 try{
  classId=(await db.schoolClass.create({data:{name:`TEMP consistency ${suffix}`,grade:"TEST"}})).id
  for(let i=0;i<2;i++)students.push((await db.student.create({data:{name:`TEMP consistency ${i}`,nis:`TEMP-${suffix}-${i}`,gender:"PEREMPUAN",classId}})).id)
  actorId=(await db.user.create({data:{name:"TEMP consistency",email:`consistency-${suffix}@invalid.example`,passwordHash:"invalid-test-hash",studentId:students[0]}})).id
  const staff={id:actorId,grants:new Set(["euks.menstruation.create","euks.menstruation.update","euks.menstruation.review"])}
  const own={id:actorId,grants:new Set(["euks.menstruation.create.own","euks.menstruation.update.own"])}
  const run=(actor:typeof staff,raw:object)=>executeMenstruationMutation(db,actor,{requestId:randomUUID(),...raw},"2026-10-14")
  await t.test("weekly complaint persists, omission retains it and explicit null clears with history",async()=>{
   const row={studentId:students[0],status:"UNKNOWN",complaint:"private weekly note"}
   assert.equal((await run(staff,{action:"weekly",classId,weekStart:"2026-09-07",rows:[row]})).status,200)
   const first=await db.menstruationRecord.findFirstOrThrow({where:{studentId:students[0],kind:"WEEKLY"}})
   assert.equal(first.complaint,row.complaint);assert.equal(first.source,"UKS")
   await run(staff,{action:"weekly",classId,weekStart:first.key,rows:[{studentId:students[0],status:"HAD",version:1}]})
   assert.equal((await db.menstruationRecord.findUniqueOrThrow({where:{id:first.id}})).complaint,row.complaint)
   await run(staff,{action:"weekly",classId,weekStart:first.key,rows:[{studentId:students[0],status:"HAD",version:2,complaint:null}]})
   assert.equal((await db.menstruationRecord.findUniqueOrThrow({where:{id:first.id}})).complaint,null)
   const h=await db.menstruationHistory.findFirstOrThrow({where:{recordId:first.id,action:"UPDATE"},orderBy:{createdAt:"desc"}})
   assert.equal((h.before as {complaint:string}).complaint,row.complaint)
  })
  await t.test("NONE contradicting confirmed episode conflicts; review refuses instructively; unknown end is only start",async()=>{
   await run(own,{action:"episode",startDate:"2026-09-16",endDate:null,complaint:null})
   const rejected=await run(staff,{action:"weekly",classId,weekStart:"2026-09-14",rows:[{studentId:students[0],status:"NONE"}]})
   assert.equal(rejected.status,409)
   await assert.rejects(()=>run(staff,{action:"review",conflictId:rejected.data.conflictId,version:0,resolution:"APPLY_PROPOSED",reason:"review"}),/KEEP_CURRENT.*episode/i)
   assert.equal((await run(staff,{action:"weekly",classId,weekStart:"2026-09-21",rows:[{studentId:students[0],status:"NONE"}]})).status,200)
  })
  await t.test("student episode intersecting NONE conflicts and review gives explicit correction without losing before/source",async()=>{
   const rejected=await run(own,{action:"episode",startDate:"2026-09-23",endDate:"2026-09-24",complaint:"private proposed note"})
   assert.equal(rejected.status,409)
   const h=await db.menstruationHistory.findFirstOrThrow({where:{studentId:students[0],action:"CONFLICT"},orderBy:{createdAt:"desc"}})
   assert.equal(h.source,"STUDENT")
   assert.equal((h.after as {proposed:{complaint:string}}).proposed.complaint,"private proposed note")
   await assert.rejects(()=>run(staff,{action:"review",conflictId:rejected.data.conflictId,version:0,resolution:"APPLY_PROPOSED",reason:"review"}),/KEEP_CURRENT.*HAD.*UNKNOWN/)
   const week=await db.menstruationRecord.findFirstOrThrow({where:{studentId:students[0],kind:"WEEKLY",key:"2026-09-21"}})
   assert.equal(week.status,"NONE");assert.equal(week.version,1)
   await run(staff,{action:"review",conflictId:rejected.data.conflictId,version:0,resolution:"KEEP_CURRENT",reason:"correct opposing weekly claim first"})
   await run(staff,{action:"weekly",classId,weekStart:week.key,rows:[{studentId:students[0],status:"HAD",version:1}]})
   const saved=await run(own,{action:"episode",startDate:"2026-09-23",endDate:"2026-09-24",complaint:"private proposed note"})
   assert.equal(saved.status,200)
   await run(staff,{action:"episode",studentId:students[0],id:saved.data.recordId,version:1,startDate:"2026-09-23",endDate:"2026-09-24",complaint:"staff correction"})
   const change=await db.menstruationHistory.findFirstOrThrow({where:{recordId:saved.data.recordId,action:"UPDATE"}})
   assert.equal((change.before as {source:string}).source,"STUDENT");assert.equal((change.after as {source:string}).source,"UKS")
  })
  await t.test("overlapping creation has actionable review and nested batch restores prior writes",async()=>{
   const rejected=await run(own,{action:"episode",startDate:"2026-09-24",endDate:"2026-09-25",complaint:"overlap"})
   assert.equal(rejected.status,409)
   const c=await db.menstruationConflict.findUniqueOrThrow({where:{id:rejected.data.conflictId}})
   assert.equal(c.targetId,null)
   await assert.rejects(()=>run(staff,{action:"review",conflictId:c.id,version:0,resolution:"APPLY_PROPOSED",reason:"overlap review"}),/KEEP_CURRENT.*episode.*versi/)
   assert.equal((await db.menstruationConflict.findUniqueOrThrow({where:{id:c.id}})).resolvedAt,null)
   await run(staff,{action:"review",conflictId:c.id,version:0,resolution:"KEEP_CURRENT",reason:"edit existing episode explicitly"})
   const snapshot=await Promise.all([db.menstruationRecord.count(),db.menstruationHistory.count({where:{action:{not:"CONFLICT"}}})])
   const failed=await run(staff,{action:"weekly",classId,weekStart:"2026-09-21",rows:[{studentId:students[1],status:"HAD",complaint:"must rollback",episode:{startDate:"2026-09-22",endDate:null,complaint:"must rollback"}},{studentId:students[0],status:"HAD",version:2,episode:{startDate:"2026-09-24",endDate:null,complaint:"overlap"}}]})
   assert.equal(failed.status,409)
   const batchConflict=await db.menstruationConflict.findUniqueOrThrow({where:{id:failed.data.conflictId}})
   assert.equal((batchConflict.proposed as {action:string}).action,"weekly")
   assert.equal((batchConflict.proposed as {rows:unknown[]}).rows.length,2)
   assert.deepEqual(await Promise.all([db.menstruationRecord.count(),db.menstruationHistory.count({where:{action:{not:"CONFLICT"}}})]),snapshot)
   assert.equal(await db.menstruationRecord.count({where:{studentId:students[1]}}),0)
   const audit=await db.auditLog.findMany({where:{actorId}})
   assert.ok(audit.every(a=>a.before===null&&a.after===null&&!JSON.stringify(a).includes("complaint")))
  })
 }finally{
  if(actorId){await db.auditLog.deleteMany({where:{actorId}});await db.menstruationRequest.deleteMany({where:{actorId}})}
  if(students.length){await db.menstruationConflict.deleteMany({where:{studentId:{in:students}}});await db.menstruationHistory.deleteMany({where:{studentId:{in:students}}});await db.menstruationRecord.deleteMany({where:{studentId:{in:students}}})}
  if(actorId)await db.user.delete({where:{id:actorId}})
  if(classId){await db.student.deleteMany({where:{classId}});await db.schoolClass.delete({where:{id:classId}})}
  const after=await counts();console.log(JSON.stringify({before,after,restored:JSON.stringify(before)===JSON.stringify(after)}));assert.deepEqual(after,before);await db.$disconnect()
 }
})
