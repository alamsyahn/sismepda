import { z } from "zod"
import { accountAdminMutationSchema, ownProfileUpdateSchema } from "@/lib/account-schemas"

/** Reuse the central account credentials rules; student logins always need email. */
export const studentAccountCreateSchema = z.object({
  studentId: z.string().trim().min(1).max(100),
  email: ownProfileUpdateSchema.shape.email.refine((value) => value.length > 0)
    .transform((value) => value.toLowerCase()),
  password: accountAdminMutationSchema.options[0].shape.password,
}).strict()

export type StudentAccountCreate = z.infer<typeof studentAccountCreateSchema>
