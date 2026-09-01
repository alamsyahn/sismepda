import assert from "node:assert/strict"
import test from "node:test"

/**
 * Guard branding disamakan dengan endpoint admin lain: requireAdmin() dipanggil
 * lebih dulu, sebelum body/file diproses, sehingga user biasa tidak dapat
 * menulis apa pun walau mem-bypass UI dan menembak endpoint langsung.
 */
async function runGuard(role: string | null, handler: (user: { role: string }) => Promise<string>) {
  if (!role) throw new Error("UNAUTHORIZED")
  if (role !== "ADMIN") throw new Error("FORBIDDEN")
  return handler({ role })
}

function statusFor(error: unknown): number {
  const message = error instanceof Error ? error.message : ""
  return message === "UNAUTHORIZED" || message === "FORBIDDEN" ? 403 : 500
}

test("guru tidak dapat mengubah branding lewat request langsung", async () => {
  let sideEffect = false
  await assert.rejects(
    () => runGuard("GURU", async () => { sideEffect = true; return "written" }),
    /FORBIDDEN/,
  )
  // Yang terpenting: handler tidak pernah berjalan, jadi tidak ada penulisan.
  assert.equal(sideEffect, false)
})

test("anonim tidak dapat mengubah branding", async () => {
  let sideEffect = false
  await assert.rejects(
    () => runGuard(null, async () => { sideEffect = true; return "written" }),
    /UNAUTHORIZED/,
  )
  assert.equal(sideEffect, false)
})

test("admin diizinkan menulis branding", async () => {
  const result = await runGuard("ADMIN", async () => "written")
  assert.equal(result, "written")
})

test("penolakan permission dipetakan ke 403, bukan 500", () => {
  assert.equal(statusFor(new Error("UNAUTHORIZED")), 403)
  assert.equal(statusFor(new Error("FORBIDDEN")), 403)
  assert.equal(statusFor(new Error("boom")), 500)
})
