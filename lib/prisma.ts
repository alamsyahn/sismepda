import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/app/generated/prisma/client"
import { databaseSchema } from "@/lib/database-config"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const connectionString = process.env.DATABASE_URL ?? "postgresql://build:***@127.0.0.1:5432/build"
const adapter = new PrismaPg({ connectionString }, { schema: databaseSchema(connectionString) })

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
