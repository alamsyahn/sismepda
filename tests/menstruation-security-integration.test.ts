import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { executeMenstruationMutation } from "../lib/server-menstruation"
import * as server from "../lib/server-menstruation"

async function fixture(run:(db:PrismaClient,actor:{id:string;grants:Set<string>},studentId:string,classId:string)=>Promise<void>) {
 const url=process.env.DATABASE_URL!; const parsed=new URL(url)
 assert.ok(["localhost","127.0.0.1","[::1]"].includes(parsed.hostname));assert.equal(parsed.pathname,"/sismepda_dev")
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url},{schema:databaseSchema(url)})})
 const tag=randomUUID();let classId="",studentId="",actorId=""
 try {
  classId=(await db.schoolClass.create({data:{name:`TEMP security ${tag}`,grade:"TEST"}})).id
  studentId=(await db.student.create({data:{name:`TEMP security ${tag}`,nis:`TEMP-${tag}`,gender:"PEREMPUAN",classId}})).id
  actorId=(await db.user.create({data:{name:`TEMP security ${tag}`,email:`security-${tag}@invalid.example`,passwordHash:"invalid-fixture-hash",studentId}})).id
  await run(db,{id:actorId,grants:new Set(["euks.menstruation.create","euks.menstruation.update","euks.menstruation.review"])},studentId,classId)
 } finally {
  if(actorId){await db.auditLog.deleteMany({where:{actorId}});await db.menstruationRequest.deleteMany({where:{actorId}})}
  if(studentId){await db.menstruationConflict.deleteMany({where:{studentId}});await db.menstruationHistory.deleteMany({where:{studentId}});await db.menstruationRecord.deleteMany({where:{studentId}})}
  if(actorId)await db.user.delete({where:{id:actorId}})
  if(studentId)await db.student.delete({where:{id:studentId}})
  if(classId)await db.schoolClass.delete({where:{id:classId}})
  assert.equal(await db.user.count({where:{id:actorId}}),0);assert.equal(await db.student.count({where:{id:studentId}}),0)
  await db.$disconnect()
 }
}
async function nestedConflictFixture(run:(db:PrismaClient,actor:{id:string;grants:Set<string>},studentId:string,siblingId:string,conflictId:string)=>Promise<void>) {
 return fixture(async(db,actor,studentId,classId)=>{
  const tag=randomUUID()
  const sibling=await db.student.create({data:{name:`TEMP nested ${tag}`,nis:`TEMP-${tag}`,gender:"PEREMPUAN",classId}})
  try {
   const episodes=[]
   for(const id of [sibling.id,studentId]) {
    const created=await executeMenstruationMutation(db,actor,{action:"episode",requestId:randomUUID(),studentId:id,startDate:"2026-10-12",endDate:"2026-10-13",complaint:"original"},"2026-10-14")
    assert.equal(created.status,200)
    episodes.push({studentId:id,id:created.data.recordId!,version:created.data.version!})
   }
   const target=episodes[1]
   assert.equal((await executeMenstruationMutation(db,actor,{action:"episode",requestId:randomUUID(),studentId,id:target.id,version:target.version,startDate:"2026-10-12",endDate:"2026-10-13",complaint:"edited target"},"2026-10-14")).status,200)
   const before=await db.menstruationRecord.findMany({where:{studentId:{in:[studentId,sibling.id]}},orderBy:{id:"asc"}})
   const historyCount=await db.menstruationHistory.count({where:{studentId:{in:[studentId,sibling.id]}}})
   const proposed={action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:episodes.map(e=>({studentId:e.studentId,status:"HAD",version:0,complaint:"weekly proposal",episode:{id:e.id,version:e.version,startDate:"2026-10-12",endDate:"2026-10-14",complaint:"episode proposal"}}))}
   const stale=await executeMenstruationMutation(db,actor,proposed,"2026-10-14")
   assert.equal(stale.status,409)
   const conflict=await db.menstruationConflict.findUniqueOrThrow({where:{id:stale.data.conflictId!}})
   assert.equal(conflict.targetType,"episode");assert.equal(conflict.targetId,target.id)
   assert.deepEqual(conflict.proposed,proposed)
   assert.deepEqual(await db.menstruationRecord.findMany({where:{studentId:{in:[studentId,sibling.id]}},orderBy:{id:"asc"}}),before)
   assert.equal(await db.menstruationHistory.count({where:{studentId:{in:[studentId,sibling.id]}}}),historyCount+1)
   await run(db,actor,studentId,sibling.id,conflict.id)
  } finally {
   await db.menstruationConflict.deleteMany({where:{studentId:sibling.id}})
   await db.menstruationHistory.deleteMany({where:{studentId:sibling.id}})
   await db.menstruationRecord.deleteMany({where:{studentId:sibling.id}})
   await db.student.delete({where:{id:sibling.id}})
  }
 })
}
const local=process.env.SISMEPDA_DB_ROLE==="local"
test("stale nested episode conflict review applies latest target version atomically with history",{skip:!local},()=>nestedConflictFixture(async(db,actor,studentId,siblingId,conflictId)=>{
 const ids=[studentId,siblingId]
 const before=await db.menstruationRecord.findMany({where:{studentId:{in:ids}},orderBy:{id:"asc"}})
 const target=before.find(r=>r.studentId===studentId)!
 const historyBefore=await db.menstruationHistory.findMany({where:{studentId:{in:ids}}})
 const auditCount=await db.auditLog.count({where:{actorId:actor.id}})
 const review={action:"review",requestId:randomUUID(),conflictId,version:target.version,resolution:"APPLY_PROPOSED",reason:"accept nested batch"}
 const result=await executeMenstruationMutation(db,actor,review,"2026-10-14")
 assert.equal(result.status,200);assert.equal(result.data.changed,2)
 const after=await db.menstruationRecord.findMany({where:{studentId:{in:ids}}})
 assert.equal(after.length,4)
 const histories=await db.menstruationHistory.findMany({where:{studentId:{in:ids},id:{notIn:historyBefore.map(h=>h.id)}}})
 assert.equal(histories.length,5)
 for(const original of before) {
  const saved=after.find(r=>r.id===original.id)!
  assert.equal(saved.version,original.version+1);assert.equal(saved.complaint,"episode proposal")
  assert.equal(saved.endDate!.toISOString(),"2026-10-14T00:00:00.000Z")
  assert.equal(saved.source,"UKS");assert.equal(saved.recordedById,actor.id)
  const update=histories.find(h=>h.recordId===original.id)!
  assert.equal(update.action,"UPDATE");assert.equal(update.source,"UKS")
  assert.deepEqual(update.before,JSON.parse(JSON.stringify(original)))
  assert.deepEqual(update.after,JSON.parse(JSON.stringify(saved)))
  const weekly=after.find(r=>r.studentId===original.studentId&&r.kind==="WEEKLY")!
  assert.equal(weekly.episodeId,original.id);assert.equal(weekly.status,"HAD");assert.equal(weekly.version,1)
  assert.equal(weekly.complaint,"weekly proposal")
  const create=histories.find(h=>h.recordId===weekly.id)!
  assert.equal(create.action,"CREATE");assert.equal(create.before,null)
  assert.deepEqual(create.after,JSON.parse(JSON.stringify(weekly)))
 }
 const conflict=await db.menstruationConflict.findUniqueOrThrow({where:{id:conflictId}})
 assert.ok(conflict.resolvedAt);assert.equal(conflict.resolvedById,actor.id);assert.equal(conflict.resolution,"APPLY_PROPOSED")
 assert.equal(conflict.reason,review.reason)
 const reviewed=histories.find(h=>h.action==="REVIEW")!
 assert.deepEqual(reviewed.before,{conflictId});assert.deepEqual(reviewed.after,{resolution:review.resolution,reason:review.reason})
 assert.equal(await db.auditLog.count({where:{actorId:actor.id}}),auditCount+5)
 assert.deepEqual((await db.menstruationRequest.findUniqueOrThrow({where:{actorId_requestId:{actorId:actor.id,requestId:review.requestId}}})).response,result)
}))
test("stale sibling nested episode denies review and rolls back the entire batch",{skip:!local},()=>nestedConflictFixture(async(db,actor,studentId,siblingId,conflictId)=>{
 const sibling=await db.menstruationRecord.findFirstOrThrow({where:{studentId:siblingId,kind:"EPISODE"}})
 assert.equal((await executeMenstruationMutation(db,actor,{action:"episode",requestId:randomUUID(),studentId:siblingId,id:sibling.id,version:sibling.version,startDate:"2026-10-12",endDate:"2026-10-13",complaint:"edited sibling"},"2026-10-14")).status,200)
 const ids=[studentId,siblingId]
 const snapshot=async()=>({
  records:await db.menstruationRecord.findMany({where:{studentId:{in:ids}},orderBy:{id:"asc"}}),
  histories:await db.menstruationHistory.findMany({where:{studentId:{in:ids}},orderBy:{id:"asc"}}),
  conflicts:await db.menstruationConflict.findMany({where:{studentId:{in:ids}},orderBy:{id:"asc"}}),
  audits:await db.auditLog.findMany({where:{actorId:actor.id},orderBy:{id:"asc"}}),
  requests:await db.menstruationRequest.findMany({where:{actorId:actor.id},orderBy:{id:"asc"}}),
 })
 const before=await snapshot()
 const target=before.records.find(r=>r.studentId===studentId)!
 // Equal current versions must not authorize the sibling's stale original version.
 assert.equal(before.records.find(r=>r.id===sibling.id)!.version,target.version)
 const review={action:"review",requestId:randomUUID(),conflictId,version:target.version,resolution:"APPLY_PROPOSED",reason:"must preserve sibling CAS"}
 await assert.rejects(()=>executeMenstruationMutation(db,actor,review,"2026-10-14"),error=>{
  assert.ok(error instanceof server.MenstruationError)
  assert.equal(error.status,409);assert.match(error.message,/Episode berubah; muat ulang batch/)
  return true
 })
 assert.deepEqual(await snapshot(),before)
 assert.equal((await db.menstruationConflict.findUniqueOrThrow({where:{id:conflictId}})).resolvedAt,null)
 assert.equal(await db.menstruationRequest.count({where:{actorId:actor.id,requestId:review.requestId}}),0)
}))
test("card loader projects legacy batch history for own and staff read-only callers",{skip:!local},()=>fixture(async(db,actor,studentId,classId)=>{
 const proposal={action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:[{studentId,status:"HAD"},{studentId:"other-private-pupil",status:"HAD",complaint:"OTHER_SECRET"}]}
 await db.menstruationConflict.create({data:{studentId,targetType:"weekly",targetId:null,proposed:proposal,recordedById:actor.id}})
 await db.menstruationHistory.create({data:{studentId,source:"UKS",action:"CONFLICT",after:{proposed:proposal},recordedById:actor.id}})
 await db.menstruationRecord.create({data:{studentId,kind:"WEEKLY",key:"2026-10-12",weekStart:new Date("2026-10-12"),status:"HAD",version:7,source:"UKS",recordedById:actor.id}})
 const read=(server as unknown as {loadMenstruationCard:typeof import("../lib/server-menstruation").loadMenstruationCard}).loadMenstruationCard
 assert.equal(typeof read,"function")
 for(const grants of [new Set(["euks.menstruation.read.own"]),new Set(["euks.menstruation.read"])]) {
  const card=await read(db,{id:actor.id,grants},studentId,"2026-10-14",studentId)
  assert.equal(JSON.stringify(card).includes("OTHER_SECRET"),false)
  assert.equal(JSON.stringify(card).includes("other-private-pupil"),false)
  assert.equal(card.conflicts[0].currentVersion,7)
  assert.equal((card.conflicts[0].proposed as {rows:unknown[]}).rows.length,1)
 }
 const reviewCard=await read(db,{id:actor.id,grants:new Set(["euks.menstruation.read","euks.menstruation.review"])},studentId,"2026-10-14",studentId)
 assert.equal((reviewCard.conflicts[0].proposed as {rows:unknown[]}).rows.length,2)
}))
test("identical nested episode batch with fresh request id is an effective weekly no-op",{skip:!local},()=>fixture(async(db,actor,studentId,classId)=>{
 const command={action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:[{studentId,status:"HAD",complaint:"weekly note",episode:{startDate:"2026-10-12",endDate:"2026-10-13",complaint:"episode note"}}]}
 assert.equal((await executeMenstruationMutation(db,actor,command,"2026-10-14")).status,200)
 const before=await db.menstruationRecord.findMany({where:{studentId},orderBy:{kind:"asc"}})
 const historyCount=await db.menstruationHistory.count({where:{studentId}})
 const repeat=await executeMenstruationMutation(db,actor,{...command,requestId:randomUUID(),rows:command.rows.map(row=>({...row,version:1}))},"2026-10-14")
 assert.equal(repeat.status,200);assert.equal(repeat.data.changed,0)
 assert.deepEqual(await db.menstruationRecord.findMany({where:{studentId},orderBy:{kind:"asc"}}),before)
 assert.equal(await db.menstruationHistory.count({where:{studentId}}),historyCount)
}))
test("null target weekly review uses current version and preserves source provenance",{skip:!local},()=>fixture(async(db,actor,studentId,classId)=>{
 const proposed={action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:[{studentId,status:"HAD",complaint:"review note",version:0}]}
 const c=await db.menstruationConflict.create({data:{studentId,targetType:"weekly",targetId:null,proposed,recordedById:actor.id}})
 const current=await db.menstruationRecord.create({data:{studentId,kind:"WEEKLY",key:"2026-10-12",weekStart:new Date("2026-10-12"),status:"UNKNOWN",version:7,source:"STUDENT",recordedById:actor.id}})
 const review={action:"review",requestId:randomUUID(),conflictId:c.id,version:0,resolution:"APPLY_PROPOSED",reason:"review"}
 await assert.rejects(()=>executeMenstruationMutation(db,actor,review,"2026-10-14"),/Data berubah lagi/)
 assert.equal((await executeMenstruationMutation(db,actor,{...review,requestId:randomUUID(),version:7},"2026-10-14")).status,200)
 const saved=await db.menstruationRecord.findUniqueOrThrow({where:{id:current.id}})
 assert.equal(saved.version,8);assert.equal(saved.status,"HAD");assert.equal(saved.source,"UKS")
}))
test("overlap review remains actionable 409 and cannot silently overwrite logical target",{skip:!local},()=>fixture(async(db,actor,studentId)=>{
 const proposed={action:"episode",requestId:randomUUID(),studentId,startDate:"2026-10-12",endDate:"2026-10-14",complaint:"proposal"}
 const c=await db.menstruationConflict.create({data:{studentId,targetType:"episode",targetId:null,proposed,recordedById:actor.id}})
 const current=await db.menstruationRecord.create({data:{studentId,kind:"EPISODE",key:"2026-10-12",startDate:new Date("2026-10-12"),endDate:new Date("2026-10-12"),complaint:"original",version:7,source:"STUDENT",recordedById:actor.id}})
 await db.menstruationRecord.create({data:{studentId,kind:"EPISODE",key:"2026-10-14",startDate:new Date("2026-10-14"),source:"STUDENT",recordedById:actor.id}})
 const review={action:"review",requestId:randomUUID(),conflictId:c.id,version:0,resolution:"APPLY_PROPOSED",reason:"review"}
 await assert.rejects(()=>executeMenstruationMutation(db,actor,review,"2026-10-14"),/Data berubah lagi/)
 await assert.rejects(()=>executeMenstruationMutation(db,actor,{...review,requestId:randomUUID(),version:7},"2026-10-14"),/KEEP_CURRENT/)
 const saved=await db.menstruationRecord.findUniqueOrThrow({where:{id:current.id}})
 assert.equal(saved.version,7);assert.equal(saved.complaint,"original");assert.equal(saved.source,"STUDENT")
 assert.equal((await db.menstruationConflict.findUniqueOrThrow({where:{id:c.id}})).resolvedAt,null)
}))
test("null target review compares logical existing profile version rather than zero",{skip:!local},()=>fixture(async(db,actor,studentId)=>{
 const proposal={action:"profile",requestId:randomUUID(),studentId,version:0,neverMenstruated:true}
 const c=await db.menstruationConflict.create({data:{studentId,targetType:"profile",targetId:null,proposed:proposal,recordedById:actor.id}})
 const current=await db.menstruationRecord.create({data:{studentId,kind:"PROFILE",key:"profile",neverMenstruated:false,version:7,source:"STUDENT",recordedById:actor.id}})
 await assert.rejects(()=>executeMenstruationMutation(db,actor,{action:"review",requestId:randomUUID(),conflictId:c.id,version:0,resolution:"APPLY_PROPOSED",reason:"stale review"},"2026-10-14"),/Data berubah lagi/)
 assert.equal((await db.menstruationRecord.findUniqueOrThrow({where:{id:current.id}})).version,7)
 assert.equal((await db.menstruationConflict.findUniqueOrThrow({where:{id:c.id}})).resolvedAt,null)
 const result=await executeMenstruationMutation(db,actor,{action:"review",requestId:randomUUID(),conflictId:c.id,version:7,resolution:"APPLY_PROPOSED",reason:"fresh review"},"2026-10-14")
 assert.equal(result.status,200)
 const saved=await db.menstruationRecord.findUniqueOrThrow({where:{id:current.id}})
 assert.equal(saved.version,8);assert.equal(saved.neverMenstruated,true);assert.equal(saved.source,"UKS")
}))
