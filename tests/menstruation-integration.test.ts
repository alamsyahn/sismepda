import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { executeMenstruationMutation } from "../lib/server-menstruation"

const local = process.env.SISMEPDA_DB_ROLE === "local"
test("local transaction: private episodes, durable replay, CAS conflict, weekly rollback and cleanup", { skip: !local }, async () => {
 const url=process.env.DATABASE_URL!
 const parsed=new URL(url)
 assert.ok(["localhost","127.0.0.1","[::1]"].includes(parsed.hostname))
 assert.equal(parsed.pathname,"/sismepda_dev")
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url},{schema:databaseSchema(url)})})
 const db2=new PrismaClient({adapter:new PrismaPg({connectionString:url},{schema:databaseSchema(url)})})
 const counts=async()=>({students:await db.student.count(),users:await db.user.count(),classes:await db.schoolClass.count(),records:await db.menstruationRecord.count(),history:await db.menstruationHistory.count(),conflicts:await db.menstruationConflict.count(),requests:await db.menstruationRequest.count(),audit:await db.auditLog.count()})
 const before=await counts(); const suffix=randomUUID(); let classId="", studentId="", actorId="", maleId=""
 try {
  assert.equal((await db.$queryRaw<{name:string}[]>`SELECT current_database() as name`)[0].name,"sismepda_dev")
  classId=(await db.schoolClass.create({data:{name:`TEMP menstruation ${suffix}`,grade:"TEST"}})).id
  studentId=(await db.student.create({data:{name:`TEMP menstruation female ${suffix}`,nis:`TEMP-F-${suffix}`,gender:"PEREMPUAN",classId}})).id
  maleId=(await db.student.create({data:{name:`TEMP menstruation male ${suffix}`,nis:`TEMP-M-${suffix}`,gender:"LAKI_LAKI",classId}})).id
  actorId=(await db.user.create({data:{name:`TEMP menstrual recorder ${suffix}`,email:`menstruation-${suffix}@invalid.example`,passwordHash:"not-a-valid-login-hash",studentId}})).id
  const grants=new Set(["euks.menstruation.read.own","euks.menstruation.create.own","euks.menstruation.update.own"])
  const actor={id:actorId,grants}; const today="2026-10-14"
  const command={action:"episode",requestId:randomUUID(),startDate:"2026-10-01",endDate:null,complaint:"temporary private complaint"}
  const first=await executeMenstruationMutation(db,actor,command,today)
  assert.equal(first.status,200); assert.equal(await db.menstruationRecord.count({where:{studentId}}),1)
  assert.deepEqual(await executeMenstruationMutation(db,actor,command,today),first)
  const record=await db.menstruationRecord.findFirstOrThrow({where:{studentId}})
  assert.equal(record.source,"STUDENT"); assert.equal(record.endDate,null)
  const writes=await Promise.all([db,db2].map((client,i)=>executeMenstruationMutation(client,actor,{...command,requestId:randomUUID(),id:record.id,version:1,complaint:`race ${i}`},today)))
  assert.deepEqual(writes.map(x=>x.status).sort(),[200,409])
  assert.equal((await db.menstruationRecord.findUniqueOrThrow({where:{id:record.id}})).version,2)
  assert.equal(await db.menstruationConflict.count({where:{studentId}}),1)
  const staff={id:actorId,grants:new Set(["euks.menstruation.create","euks.menstruation.update","euks.menstruation.review"])}
  await assert.rejects(()=>executeMenstruationMutation(db,staff,{action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:[{studentId,status:"HAD"},{studentId:maleId,status:"NONE"}]},today))
  assert.equal(await db.menstruationRecord.count({where:{kind:"WEEKLY",studentId}}),0)
  const weekly=await executeMenstruationMutation(db,staff,{action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:[{studentId,status:"HAD"}]},today)
  assert.equal(weekly.status,200)
  const replayRaceCommand={...command,requestId:randomUUID(),startDate:"2026-10-08"}
  const replayRace=await Promise.all([db,db2].map(client=>executeMenstruationMutation(client,actor,replayRaceCommand,today)))
  assert.deepEqual(replayRace[0],replayRace[1]);assert.equal(await db.menstruationRecord.count({where:{studentId,kind:"EPISODE"}}),2)
  const nested=await executeMenstruationMutation(db,staff,{action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-05",rows:[{studentId,status:"HAD",episode:{startDate:"2026-10-09",endDate:"2026-10-10",complaint:null}}]},today)
  assert.equal(nested.status,200)
  assert.equal(await db.menstruationRecord.count({where:{studentId,kind:"EPISODE"}}),3)
  const week=await db.menstruationRecord.findFirstOrThrow({where:{kind:"WEEKLY",studentId,key:"2026-10-12"}})
  assert.equal(week.startDate,null); assert.equal(week.episodeId,null)
  const conflict=await db.menstruationConflict.findFirstOrThrow({where:{studentId}})
  const resolved=await executeMenstruationMutation(db,staff,{action:"review",requestId:randomUUID(),conflictId:conflict.id,version:2,resolution:"APPLY_PROPOSED",reason:"temporary fixture review"},today)
  assert.equal(resolved.status,200)
  assert.ok((await db.menstruationConflict.findUniqueOrThrow({where:{id:conflict.id}})).resolvedAt)
  const profile=await executeMenstruationMutation(db,actor,{action:"profile",requestId:randomUUID(),version:0,neverMenstruated:false},today)
  assert.equal(profile.status,200)
  const unchanged=await executeMenstruationMutation(db,actor,{action:"profile",requestId:randomUUID(),version:1,neverMenstruated:false},today)
  assert.equal(unchanged.data.changed,0)
  const batchConflict=await executeMenstruationMutation(db,staff,{action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-10-12",rows:[{studentId,status:"NONE",version:0}]},today)
  assert.equal(batchConflict.status,409)
  const batchReview=await executeMenstruationMutation(db,staff,{action:"review",requestId:randomUUID(),conflictId:batchConflict.data.conflictId,version:1,resolution:"APPLY_PROPOSED",reason:"review batch"},today)
  assert.equal(batchReview.status,200)
  const weekAfter=await db.menstruationRecord.findUniqueOrThrow({where:{id:week.id}})
  assert.equal(weekAfter.status,"NONE")
  const otherClass=await db.schoolClass.create({data:{name:`TEMP wrong class ${suffix}`,grade:"TEST"}})
  try { await assert.rejects(()=>executeMenstruationMutation(db,staff,{action:"weekly",requestId:randomUUID(),classId:otherClass.id,weekStart:"2026-10-12",rows:[{studentId,status:"NONE",version:2}]},today)) } finally { await db.schoolClass.delete({where:{id:otherClass.id}}) }
  const batchStale=await executeMenstruationMutation(db,staff,{action:"weekly",requestId:randomUUID(),classId,weekStart:"2026-09-28",rows:[{studentId,status:"HAD",episode:{startDate:"2026-10-01",endDate:null,complaint:"different overlapping claim"}}]},today)
  assert.equal(batchStale.status,409)
  assert.equal(await db.menstruationRecord.count({where:{studentId,kind:"WEEKLY",key:"2026-09-28"}}),0)
  const audits=await db.auditLog.findMany({where:{actorId}})
  assert.ok(audits.length>0)
  assert.ok(audits.every(a=>a.before===null&&a.after===null&&!JSON.stringify(a).includes("complaint")))
  await assert.rejects(()=>executeMenstruationMutation(db,actor,{...command,requestId:randomUUID(),studentId:maleId},today))
  await assert.rejects(()=>executeMenstruationMutation(db,actor,{...command,requestId:randomUUID(),startDate:"2026-10-15"},today))
  console.log(JSON.stringify({target:{host:parsed.hostname,database:"sismepda_dev",schema:databaseSchema(url)},raceStatuses:writes.map(x=>x.status),before}))
 } finally {
  if(actorId){await db.auditLog.deleteMany({where:{actorId}});await db.menstruationRequest.deleteMany({where:{actorId}})}
  if(studentId){await db.menstruationConflict.deleteMany({where:{studentId}});await db.menstruationHistory.deleteMany({where:{studentId}});await db.menstruationRecord.deleteMany({where:{studentId}})}
  if(actorId)await db.user.delete({where:{id:actorId}})
  if(classId){await db.student.deleteMany({where:{classId}});await db.schoolClass.delete({where:{id:classId}})}
  const after=await counts(); console.log(JSON.stringify({after,restored:JSON.stringify(before)===JSON.stringify(after)}));assert.deepEqual(after,before)
  await db2.$disconnect();await db.$disconnect()
 }
})
