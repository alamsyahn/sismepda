import { strict as assert } from "node:assert"
import { test } from "node:test"

import { auditActionLabel, auditTargetLabel } from "../lib/rbac-audit-view"

test("viewer audit memakai label manusia untuk action RBAC", () => {
  assert.equal(auditActionLabel("RBAC_ACCOUNT_STATUS_CHANGED"), "Status akun diubah")
  assert.equal(auditActionLabel("CUSTOM_ACTION"), "CUSTOM_ACTION")
})

test("viewer mempertahankan id target yang sudah dihapus", () => {
  assert.equal(auditTargetLabel({ targetUserId: "user-1", targetUserName: null }), "Akun terhapus (user-1)")
  assert.equal(auditTargetLabel({ targetUserId: "user-1", targetUserName: "Budi" }), "Budi")
  assert.equal(auditTargetLabel({ targetUserId: null, targetUserName: null }), "—")
})
