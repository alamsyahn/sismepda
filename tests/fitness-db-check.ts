import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
const url = process.env.DATABASE_URL!
const parsed = new URL(url)
if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !["/sismepda_dev", "/sismepda_prodclone"].includes(parsed.pathname)) throw new Error("Only verified local database targets allowed")
const db = new PrismaClient({adapter:new PrismaPg({connectionString:url},{schema:databaseSchema(url)})})
async function main() {
  try {
    const count = {students:await db.student.count(),users:await db.user.count(),classes:await db.schoolClass.count(),attendance:await db.attendance.count(),measurements:await db.studentHealthMeasurement.count()}
    console.log(JSON.stringify(count))
  } finally { await db.$disconnect() }
}
void main()
