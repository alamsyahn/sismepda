/** SERVER ONLY: private health persistence. No client value imports. */
import { createHash } from "node:crypto"
import { Prisma, type PrismaClient, type MenstruationRecord } from "@/app/generated/prisma/client"
import { menstruationMutationSchema, projectMenstruationSnapshot, validateMenstruationDates, type MenstruationMutation, type MenstruationSource, type MenstruationCardData, type MenstruationWeekData, type MenstruationWeeklyData } from "./menstruation"
import { decideMenstruationAccess } from "./menstruation-access"
import { requireSchoolDate, toPrismaDate, fromPrismaDate, todayInSchoolTimeZone, startOfSchoolWeek } from "./school-date"

export class MenstruationError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
type Actor = { id: string; grants: ReadonlySet<string> }
type Tx = Prisma.TransactionClient
export type MenstruationResult = { status: number; data: { changed?: number; recordId?: string; version?: number; conflictId?: string; message?: string } }
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v))
const date = (v: string | null | undefined) => v ? toPrismaDate(requireSchoolDate(v)) : null
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function access(actor: Actor, linked: string | null, action: "read" | "create" | "update" | "review", studentId?: string) {
  try { return decideMenstruationAccess(actor.grants, linked, action, studentId) } catch { throw new MenstruationError("FORBIDDEN", 403) }
}
async function eligible(tx: Tx, studentId: string, classId?: string) {
  const student = await tx.student.findFirst({ where: { id: studentId, active: true, gender: "PEREMPUAN", ...(classId ? { classId } : {}) }, select: { id: true, name: true, classId: true } })
  if (!student) throw new MenstruationError("Siswa tidak memenuhi syarat", 404)
  return student
}
async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`menstruation:${key}`}, 0))`
}
async function history(tx: Tx, actor: Actor, studentId: string, source: MenstruationSource, action: string, before: unknown, after: unknown, recordId?: string) {
  const h = await tx.menstruationHistory.create({ data: { studentId, recordedById: actor.id, source, action, recordId, ...(before ? { before: json(before) } : {}), ...(after ? { after: json(after) } : {}) } })
  // Only opaque ids/action in general audit; health values belong exclusively above.
  await tx.auditLog.create({ data: { actorId: actor.id, entity: "MenstruationChange", entityId: h.id, action, summary: "Private record changed" } })
}
function conflictLogicalTarget(c: {studentId:string;targetType:string;proposed:unknown}) {
  const proposed=menstruationMutationSchema.parse(c.proposed)
  if(proposed.action === "profile") return {studentId:c.studentId,kind:"PROFILE" as const,key:"profile"}
  if(proposed.action === "episode") return {studentId:c.studentId,kind:"EPISODE" as const,key:proposed.startDate}
  if(proposed.action === "weekly") {
    if(c.targetType === "episode") {
      const row=proposed.rows.find(v=>v.studentId===c.studentId)
      if(row?.episode) return {studentId:c.studentId,kind:"EPISODE" as const,key:row.episode.startDate}
      throw new MenstruationError("Konflik tidak valid")
    }
    return {studentId:c.studentId,kind:"WEEKLY" as const,key:proposed.weekStart}
  }
  throw new MenstruationError("Konflik tidak valid")
}
async function conflictCurrent(tx: Tx, c: {studentId:string;targetType:string;targetId:string|null;proposed:unknown}) {
  if(c.targetId) return tx.menstruationRecord.findFirst({where:{id:c.targetId,studentId:c.studentId}})
  return tx.menstruationRecord.findUnique({where:{studentId_kind_key:conflictLogicalTarget(c)}})
}
async function conflict(tx: Tx, actor: Actor, studentId: string, targetType: string, targetId: string | null, proposed: MenstruationMutation): Promise<MenstruationResult> {
  const c = await tx.menstruationConflict.create({ data: { studentId, targetType, targetId, proposed: json(proposed), recordedById: actor.id } })
  const user=await tx.user.findUniqueOrThrow({where:{id:actor.id},select:{studentId:true}})
  const source=proposed.action === "weekly" || proposed.action === "review" ? "UKS" : access(actor,user.studentId,proposed.action === "episode" && !proposed.id ? "create" : "update",studentId).source
  const before=targetId ? await tx.menstruationRecord.findUnique({where:{id:targetId}}) : null
  await history(tx, actor, studentId, source, "CONFLICT", before, { conflictId: c.id, proposed })
  return { status: 409, data: { conflictId: c.id, message: "Data telah berubah; tinjau konflik sebelum menyimpan" } }
}

/** Trusted server boundary: caller identity/grants come from getAuthorizationContext.
 * Exported DB-injected core permits genuine isolated local integration tests.
 * Student binding is still re-read from DB INSIDE this transaction.
 */
export async function executeMenstruationMutation(db: PrismaClient, actor: Actor, raw: unknown, today: string): Promise<MenstruationResult> {
  const parsed = menstruationMutationSchema.safeParse(raw)
  if (!parsed.success) throw new MenstruationError("Payload tidak valid")
  const input = parsed.data
  requireSchoolDate(today)
  try { validateMenstruationDates(input, today) } catch (e) { throw new MenstruationError(e instanceof Error ? e.message : "Tanggal tidak valid") }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex")
  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, studentId: true } })
    if (!user?.active) throw new MenstruationError("UNAUTHORIZED", 401)
    // Replay and writes serialize across connections. Consistent lock order prevents batch deadlock.
    await lock(tx, `request:${actor.id}:${input.requestId}`)
    const replay = await tx.menstruationRequest.findUnique({ where: { actorId_requestId: { actorId: actor.id, requestId: input.requestId } } })
    // Permission checked on every replay below before the saved private response is returned.
    if (input.action === "weekly") {
      if (!actor.grants.has("euks.menstruation.create") && !actor.grants.has("euks.menstruation.update")) throw new MenstruationError("FORBIDDEN",403)
    } else if (input.action === "review") {
      if (!actor.grants.has("euks.menstruation.review")) throw new MenstruationError("FORBIDDEN",403)
    } else access(actor,user.studentId,input.action === "episode" && !input.id ? "create" : "update",input.studentId)
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new MenstruationError("RequestId sudah digunakan untuk payload berbeda",409)
      return replay.response as unknown as MenstruationResult
    }
    const studentIds = input.action === "weekly" ? input.rows.map(r=>r.studentId) : input.action === "review" ? [(await tx.menstruationConflict.findUnique({where:{id:input.conflictId}}))?.studentId ?? ""] : [access(actor,user.studentId,input.action === "episode" && !input.id ? "create" : "update",input.studentId).studentId]
    if(input.action === "review") {
      const c=await tx.menstruationConflict.findUnique({where:{id:input.conflictId}})
      if(c) { const proposal=menstruationMutationSchema.parse(c.proposed); if(proposal.action === "weekly") studentIds.push(...proposal.rows.map(v=>v.studentId)) }
    }
    for (const studentId of [...new Set(studentIds)].sort()) { await lock(tx, `student:${studentId}`); await eligible(tx,studentId,input.action === "weekly" ? input.classId : undefined) }
    let result: MenstruationResult
    if (input.action === "review") {
      const c = await tx.menstruationConflict.findUnique({where:{id:input.conflictId}})
      if (!c || c.resolvedAt) throw new MenstruationError("Konflik tidak tersedia",409)
      const current = await conflictCurrent(tx,c)
      if ((current?.version ?? 0) !== input.version) throw new MenstruationError("Data berubah lagi; muat ulang",409)
      result = {status:200,data:{changed:0}}
      if (input.resolution === "APPLY_PROPOSED") {
        const proposed = menstruationMutationSchema.parse(c.proposed)
        if(proposed.action === "review") throw new MenstruationError("Konflik tidak valid")
        validateMenstruationDates(proposed,today)
        if(proposed.action === "weekly") for(const row of proposed.rows) {
          const existing=await tx.menstruationRecord.findUnique({where:{studentId_kind_key:{studentId:row.studentId,kind:"WEEKLY",key:proposed.weekStart}}})
          const expected=existing && existing.id===current?.id ? input.version : row.version??0
          if((existing?.version??0)!==expected)throw new MenstruationError("Baris lain berubah; muat ulang batch",409)
          if(row.episode?.id) {
            const episode=await tx.menstruationRecord.findFirst({where:{id:row.episode.id,studentId:row.studentId,kind:"EPISODE"}})
            const expectedEpisodeVersion=episode && episode.id===current?.id ? input.version : row.episode.version
            if(!episode || episode.version!==expectedEpisodeVersion)throw new MenstruationError("Episode berubah; muat ulang batch",409)
          }
        }
        result = await apply(tx, actor, user.studentId, proposed, true)
        if(result.status!==200) throw new MenstruationError("Resolusi masih bertentangan; data tidak diubah",409)
      }
      await tx.menstruationConflict.update({where:{id:c.id},data:{resolvedAt:new Date(),resolvedById:actor.id,resolution:input.resolution,reason:input.reason}})
      await history(tx,actor,c.studentId,"UKS","REVIEW",{conflictId:c.id},{resolution:input.resolution,reason:input.reason})
    } else {
      await tx.$executeRawUnsafe("SAVEPOINT menstrual_batch")
      result = await apply(tx,actor,user.studentId,input,false)
      if (result.status === 409 && result.data.conflictId) {
        const c=await tx.menstruationConflict.findUniqueOrThrow({where:{id:result.data.conflictId}})
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT menstrual_batch")
        result=await conflict(tx,actor,c.studentId,c.targetType,c.targetId,input.action === "weekly" ? input : menstruationMutationSchema.parse(c.proposed))
      }
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT menstrual_batch")
    }
    await tx.menstruationRequest.create({data:{actorId:actor.id,requestId:input.requestId,fingerprint,response:json(result)}})
    return result
  }, { timeout: 20000 })
}

async function apply(tx: Tx, actor: Actor, linked: string | null, input: Exclude<MenstruationMutation,{action:"review"}>, review: boolean): Promise<MenstruationResult> {
  if (input.action === "weekly") {
    const plans: { row: typeof input.rows[number]; current: MenstruationRecord | null; same: boolean }[]=[]
    for(const row of input.rows) {
      await eligible(tx,row.studentId,input.classId)
      const current=await tx.menstruationRecord.findUnique({where:{studentId_kind_key:{studentId:row.studentId,kind:"WEEKLY",key:input.weekStart}}})
      if(row.status === "NONE") {
        const start=date(input.weekStart)!
        const end=new Date(start.getTime()+6*86400000)
        const episodes=await tx.menstruationRecord.findMany({where:{studentId:row.studentId,kind:"EPISODE",startDate:{lte:end}}})
        if(episodes.some(e=>(e.endDate??e.startDate!)>=start)) {
          if(review)throw new MenstruationError("Pilih KEEP_CURRENT lalu koreksi episode yang ada secara eksplisit sebelum menyimpan NONE",409)
          return conflict(tx,actor,row.studentId,"weekly",current?.id??null,input)
        }
      }
      if(row.episodeId) {
        const episode=await tx.menstruationRecord.findFirst({where:{id:row.episodeId,studentId:row.studentId,kind:"EPISODE"}})
        if(!episode || row.status!=="HAD") throw new MenstruationError("Episode tidak valid")
        const end=episode.endDate ?? episode.startDate!
        const start=toPrismaDate(requireSchoolDate(input.weekStart)); const weekEnd=new Date(start.getTime()+6*86400000)
        if(episode.startDate!>weekEnd || end<start) throw new MenstruationError("Episode tidak terkait minggu")
      }
      const nestedCurrent=row.episode ? (row.episode.id ? await tx.menstruationRecord.findFirst({where:{id:row.episode.id,studentId:row.studentId,kind:"EPISODE"}}) : await tx.menstruationRecord.findUnique({where:{studentId_kind_key:{studentId:row.studentId,kind:"EPISODE",key:row.episode.startDate}}})) : null
      const effectiveEpisodeId=row.episode ? nestedCurrent?.id ?? null : row.episodeId ?? null
      const same=!!current && current.status===row.status && current.episodeId===effectiveEpisodeId && current.complaint===(row.complaint === undefined ? current.complaint : row.complaint)
      if(!review) {
        const key=`euks.menstruation.${current ? "update":"create"}`
        if(!actor.grants.has(key)) throw new MenstruationError("FORBIDDEN",403)
      }
      if(!same && !review && (current?.version ?? 0)!==(row.version ?? 0)) return conflict(tx,actor,row.studentId,"weekly",current?.id??null,input)
      plans.push({row,current,same})
    }
    // All scope/CAS checks above precede ANY row write: batch is all-or-nothing.
    let changed=0
    for(const {row,current} of plans) {
      let episodeId=row.episodeId??null
      if(row.episode) {
        const nested=await apply(tx,actor,linked,{action:"episode",requestId:input.requestId,studentId:row.studentId,...row.episode},review)
        if(nested.status!==200)return nested
        episodeId=nested.data.recordId!
      }
      // Nested resolution may return an existing id; compare effective weekly facts.
      if(current && current.status===row.status && current.episodeId===episodeId && current.complaint===(row.complaint === undefined ? current.complaint : row.complaint))continue
      await persist(tx,actor,row.studentId,"UKS",current,{kind:"WEEKLY",key:input.weekStart,weekStart:date(input.weekStart),status:row.status,episodeId,complaint:row.complaint === undefined ? current?.complaint ?? null : row.complaint})
      changed++
    }
    return {status:200,data:{changed}}
  }
  const resolved=review ? {studentId:input.studentId!,source:"UKS" as const} : access(actor,linked,input.action==="episode"&&!input.id ? "create":"update",input.studentId)
  const studentId=resolved.studentId
  // Reviewed own proposals omit studentId; resolve from current record or DB binding.
  const targetStudentId=studentId || (input.action==="episode"&&input.id ? (await tx.menstruationRecord.findUnique({where:{id:input.id}}))?.studentId : linked)
  if(!targetStudentId)throw new MenstruationError("Siswa tidak tersedia",404)
  await eligible(tx,targetStudentId)
  const kind: "EPISODE" | "PROFILE"=input.action==="episode"?"EPISODE":"PROFILE"
  const key=input.action==="episode"?input.startDate:"profile"
  const current=input.action==="episode"&&input.id ? await tx.menstruationRecord.findFirst({where:{id:input.id,studentId:targetStudentId,kind}}) : await tx.menstruationRecord.findUnique({where:{studentId_kind_key:{studentId:targetStudentId,kind,key}}})
  if(input.action==="episode"&&input.id&&!current)throw new MenstruationError("Record tidak tersedia",404)
  const values=input.action==="episode"?{kind,key,startDate:date(input.startDate),endDate:date(input.endDate),complaint:input.complaint}:{kind,key,neverMenstruated:input.neverMenstruated}
  const same=current && Object.entries(values).every(([k,v])=>equal(current[k as keyof MenstruationRecord],v))
  if(same)return {status:200,data:{changed:0,recordId:current.id,version:current.version}}
  if(!review&&(current?.version??0)!==(input.version??0))return conflict(tx,actor,targetStudentId,input.action,current?.id??null,{...input,studentId:targetStudentId})
  if(input.action==="episode") {
    const others=await tx.menstruationRecord.findMany({where:{studentId:targetStudentId,kind:"EPISODE",...(current?{id:{not:current.id}}:{})}})
    const end=values.endDate??values.startDate!
    const overlaps=others.filter(e=>e.startDate!<=end&&(e.endDate??e.startDate!)>=values.startDate!)
    if(overlaps.length) {
      if(review)throw new MenstruationError(`Pilih KEEP_CURRENT lalu koreksi/gabungkan episode yang ada (${overlaps.map(e=>e.id).join(", ")}) dengan id dan versi terbaru; jangan membuat episode tumpang tindih`,409)
      return conflict(tx,actor,targetStudentId,"episode",current?.id??null,{...input,studentId:targetStudentId})
    }
    const noneWeeks=await tx.menstruationRecord.findMany({where:{studentId:targetStudentId,kind:"WEEKLY",status:"NONE",weekStart:{lte:end}}})
    if(noneWeeks.some(w=>new Date(w.weekStart!.getTime()+6*86400000)>=values.startDate!)) {
      if(review)throw new MenstruationError("Pilih KEEP_CURRENT lalu koreksi minggu NONE menjadi HAD atau UNKNOWN dengan versi terbaru sebelum menyimpan episode",409)
      return conflict(tx,actor,targetStudentId,"episode",current?.id??null,{...input,studentId:targetStudentId})
    }
    const profile=await tx.menstruationRecord.findUnique({where:{studentId_kind_key:{studentId:targetStudentId,kind:"PROFILE",key:"profile"}}})
    if(profile?.neverMenstruated===true)throw new MenstruationError("Perbarui informasi belum menstruasi sebelum mencatat episode")
  }else if(input.neverMenstruated===true && await tx.menstruationRecord.count({where:{studentId:targetStudentId,kind:"EPISODE"}})>0)throw new MenstruationError("Sudah ada episode menstruasi")
  const saved=await persist(tx,actor,targetStudentId,resolved.source,current,values)
  return {status:200,data:{changed:1,recordId:saved.id,version:saved.version}}
}
async function persist(tx:Tx,actor:Actor,studentId:string,source:MenstruationSource,current:MenstruationRecord|null,values:Prisma.MenstruationRecordUncheckedUpdateInput & {kind: "EPISODE"|"WEEKLY"|"PROFILE";key:string}) {
  let saved:MenstruationRecord
  if(current){
    const cas=await tx.menstruationRecord.updateMany({where:{id:current.id,version:current.version},data:{...values,source,recordedById:actor.id,version:{increment:1}}})
    if(cas.count!==1)throw new MenstruationError("Data berubah",409)
    saved=await tx.menstruationRecord.findUniqueOrThrow({where:{id:current.id}})
  }else saved=await tx.menstruationRecord.create({data:{...values,studentId,source,recordedById:actor.id} as Prisma.MenstruationRecordUncheckedCreateInput})
  await history(tx,actor,studentId,source,current?"UPDATE":"CREATE",current,saved,saved.id)
  return saved
}

async function runtime() {
  const [{ prisma },{getAuthorizationContext},{readSchoolTimeZone}]=await Promise.all([import("./prisma"),import("./rbac-access"),import("./server-school-time-zone")])
  const context=await getAuthorizationContext()
  const user=await prisma.user.findUniqueOrThrow({where:{id:context.user.id},select:{studentId:true}})
  return {db:prisma,actor:{id:context.user.id,grants:context.grants},linked:user.studentId,today:todayInSchoolTimeZone(new Date(),await readSchoolTimeZone())}
}
export async function mutateMenstruation(raw:unknown){const r=await runtime();return executeMenstruationMutation(r.db,r.actor,raw,r.today)}
const recorderSelect={id:true,name:true} as const
function weeklyDto(r:MenstruationRecord & {recordedBy:{id:string;name:string}}):MenstruationWeeklyData {return {id:r.id,studentId:r.studentId,weekStart:fromPrismaDate(r.weekStart!),status:r.status!,complaint:r.complaint,version:r.version,episodeId:r.episodeId,source:r.source,recorder:r.recordedBy,updatedAt:r.updatedAt.toISOString()}}
export async function readMenstruationCard(studentId?:string):Promise<MenstruationCardData> {
  const r=await runtime()
  return loadMenstruationCard(r.db,r.actor,r.linked,r.today,studentId)
}
/** DB-injected loader shared by runtime and direct privacy regression tests. */
export async function loadMenstruationCard(db: PrismaClient, actor: Actor, linked: string|null, today: string, studentId?: string):Promise<MenstruationCardData> {
  const r={db,actor,linked,today}; const resolved=access(r.actor,r.linked,"read",studentId)
  const student=await eligible(r.db,resolved.studentId)
  const [records,histories,conflicts]=await Promise.all([
    r.db.menstruationRecord.findMany({where:{studentId:student.id},include:{recordedBy:{select:recorderSelect}},orderBy:{startDate:"desc"}}),
    r.db.menstruationHistory.findMany({where:{studentId:student.id},include:{recordedBy:{select:recorderSelect}},orderBy:{createdAt:"desc"}}),
    r.db.menstruationConflict.findMany({where:{studentId:student.id,resolvedAt:null},orderBy:{createdAt:"desc"}}),
  ])
  const can=(action:"create"|"update"|"review")=>{try{access(r.actor,r.linked,action,student.id);return true}catch{return false}}
  const profile=records.find(v=>v.kind==="PROFILE")
  // Own cards stay single-student even if the account also holds review rights.
  const project=(value:unknown)=>r.actor.grants.has("euks.menstruation.review") && resolved.source!=="STUDENT" ? value : projectMenstruationSnapshot(value,student.id)
  const conflictDtos=conflicts.map(v=>{
    const logical=v.targetId ? records.find(record=>record.id===v.targetId) : records.find(record=>{const key=conflictLogicalTarget(v);return record.kind===key.kind&&record.key===key.key})
    return {id:v.id,targetType:v.targetType,targetId:v.targetId,currentVersion:logical?.version??0,proposed:project(v.proposed),createdAt:v.createdAt.toISOString()}
  })
  return {student,today:r.today,profile:{neverMenstruated:profile?.neverMenstruated??null,version:profile?.version??0},episodes:records.filter(v=>v.kind==="EPISODE").map(v=>({id:v.id,version:v.version,startDate:fromPrismaDate(v.startDate!),endDate:v.endDate?fromPrismaDate(v.endDate):null,complaint:v.complaint,source:v.source,recorder:v.recordedBy,updatedAt:v.updatedAt.toISOString()})),weeks:records.filter(v=>v.kind==="WEEKLY").map(weeklyDto),history:histories.map(v=>({id:v.id,source:v.source,action:v.action,createdAt:v.createdAt.toISOString(),recorder:v.recordedBy,before:project(v.before),after:project(v.after)})),conflicts:conflictDtos,canCreate:can("create"),canUpdate:can("update"),canReview:can("review")}
}
export async function readMenstruationWeek(classId:string,weekStart:string):Promise<MenstruationWeekData> {
  const r=await runtime()
  if(!r.actor.grants.has("euks.menstruation.read"))throw new MenstruationError("FORBIDDEN",403)
  const week=requireSchoolDate(weekStart)
  if(startOfSchoolWeek(week)!==week)throw new MenstruationError("Minggu harus dimulai Senin")
  if(!await r.db.schoolClass.findUnique({where:{id:classId},select:{id:true}}))throw new MenstruationError("Kelas tidak tersedia",404)
  const students=await r.db.student.findMany({where:{classId,active:true,gender:"PEREMPUAN"},select:{id:true,name:true,menstruationRecords:{where:{kind:"WEEKLY",weekStart:toPrismaDate(week)},include:{recordedBy:{select:recorderSelect}}}},orderBy:{name:"asc"}})
  return {classId,weekStart:week,today:r.today,students:students.map(v=>({id:v.id,name:v.name,confirmation:v.menstruationRecords[0]?weeklyDto(v.menstruationRecords[0]):null})),canCreate:r.actor.grants.has("euks.menstruation.create"),canUpdate:r.actor.grants.has("euks.menstruation.update")}
}
