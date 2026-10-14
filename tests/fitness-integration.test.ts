import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { executeFitnessBatch } from "../lib/server-fitness"

test("fitness local database: authorization, atomic save, replay, concurrency, historical roster and rollback", { skip: process.env.SISMEPDA_DB_ROLE !== "local" }, async () => {
  const url = process.env.DATABASE_URL!
  const parsed = new URL(url)
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(parsed.hostname))
  assert.equal(parsed.pathname,"/sismepda_dev")
  const db = new PrismaClient({ adapter: new PrismaPg({connectionString:url},{schema:databaseSchema(url)}) })
  const db2 = new PrismaClient({ adapter: new PrismaPg({connectionString:url},{schema:databaseSchema(url)}) })
  const key = randomUUID()
  let classId = "", otherId = "", userId = ""
  try {
    assert.equal((await db.$queryRaw<{name:string}[]>`SELECT current_database() AS name`)[0].name,"sismepda_dev")
    classId = (await db.schoolClass.create({ data:{ name:`TEMP Fitness ${key}`,grade:"VII" } })).id
    otherId = (await db.schoolClass.create({ data:{ name:`TEMP Other Fitness ${key}`,grade:"VIII" } })).id
    userId = (await db.user.create({ data:{name:`TEMP Fitness ${key}`,email:`fitness-${key}@invalid.example`,passwordHash:"invalid-login-hash"} })).id
    const a = await db.student.create({data:{name:`TEMP A ${key}`,nis:`TMP-FA-${key}`,classId,gender:"PEREMPUAN"}})
    const b = await db.student.create({data:{name:`TEMP B ${key}`,nis:`TMP-FB-${key}`,classId,gender:"LAKI_LAKI"}})
    const foreign = await db.student.create({data:{name:`TEMP Foreign ${key}`,nis:`TMP-FX-${key}`,classId:otherId}})
    const actor = {id:userId,grants:new Set(["euks.fitness.read","euks.fitness.create","euks.fitness.update"])}
    const row = {studentId:a.id,status:"TESTED",version:0,level:4,shuttle:4,note:"temporary note"}
    const input = {classId,testedAt:"2026-10-01",protocol:"TKSI_D_20M_2023",audioLabel:"Official TKSI test fixture",rows:[row]}
    const save = (v:unknown, grants=actor.grants) => executeFitnessBatch(db,{id:userId,grants},v,"2026-10-14")
    await assert.rejects(save(input,new Set(["euks.fitness.read"])),/izin/)
    await assert.rejects(save({...input,testedAt:"2026-10-15"}),/masa depan/)
    await assert.rejects(save({...input,rows:[{...row,studentId:foreign.id}]}),/kelas/)
    assert.equal(await db.fitnessSession.count({where:{classId}}),0)
    assert.equal((await save(input)).changed,1)
    assert.equal((await save(input)).changed,0)
    assert.equal(await db.fitnessResult.count({where:{studentId:a.id}}),1)
    const first = await db.fitnessResult.findFirstOrThrow({where:{studentId:a.id}})
    assert.equal(first.genderAtTest,"PEREMPUAN")
    await assert.rejects(save({...input,rows:[{...row,version:1,shuttle:5}]},new Set(["euks.fitness.read","euks.fitness.create"])),/izin/)
    const outcomes = await Promise.allSettled([db,db2].map((client,i)=>executeFitnessBatch(client,actor,{...input,rows:[{...row,version:1,shuttle:5+i}]},"2026-10-14")))
    assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1)
    assert.equal(outcomes.filter(r=>r.status==="rejected").length,1)
    const winner = await db.fitnessResult.findUniqueOrThrow({where:{id:first.id}})
    assert.equal(winner.version,2)
    await assert.rejects(save({...input,rows:[{...row,studentId:b.id,status:"ABSENT",level:null,shuttle:null},{...row,version:1,note:"stale change"}]}),/berubah/)
    assert.equal(await db.fitnessResult.count({where:{studentId:b.id}}),0)
    await assert.rejects(save({...input,audioLabel:"different"}),/audio/)
    await db.student.update({where:{id:a.id},data:{classId:otherId,active:false,gender:"LAKI_LAKI"}})
    await save({...input,rows:[{...row,version:2,shuttle:winner.shuttle,note:"historical correction"}]})
    const historical = await db.fitnessResult.findUniqueOrThrow({where:{id:first.id}})
    assert.equal(historical.genderAtTest,"PEREMPUAN")
    assert.equal(historical.gradeAtTest,"VII")
    assert.equal(historical.version,3)
    await save({...input,rows:[{...row,studentId:b.id,status:"INVALID",level:null,shuttle:null,note:"test interrupted"}]})
    const invalid = await db.fitnessResult.findFirstOrThrow({where:{studentId:b.id}})
    assert.equal(invalid.level,null); assert.equal(invalid.shuttle,null)
    assert.ok((await db.auditLog.findMany({where:{actorId:userId}})).every(a=>!a.summary?.includes("temporary note")))
  } finally {
    if(userId) await db.auditLog.deleteMany({where:{actorId:userId}})
    if(classId || otherId) {
      await db.student.deleteMany({where:{classId:{in:[classId,otherId].filter(Boolean)}}})
      await db.schoolClass.deleteMany({where:{id:{in:[classId,otherId].filter(Boolean)}}})
    }
    if(userId) await db.user.delete({where:{id:userId}})
    await Promise.all([db.$disconnect(),db2.$disconnect()])
  }
})
