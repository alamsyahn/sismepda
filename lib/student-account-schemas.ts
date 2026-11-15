import { z } from "zod"
import { accountAdminMutationSchema, ownProfileUpdateSchema } from "@/lib/account-schemas"

/** An empty email selects NIS login for the linked student. */
export const studentAccountCreateSchema = z.object({
  studentId: z.string().trim().min(1).max(100),
  email: ownProfileUpdateSchema.shape.email.optional().transform(value => value?.trim().toLowerCase() || null),
  password: accountAdminMutationSchema.options[0].shape.password,
}).strict()

export type StudentAccountCreate = z.infer<typeof studentAccountCreateSchema>
