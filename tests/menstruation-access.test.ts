import test from "node:test"
import assert from "node:assert/strict"
import { canReadOwnMenstruation, decideMenstruationAccess } from "../lib/menstruation-access"
test("own permission requires DB student binding and cannot target another student", () => {
 const grants = new Set(["euks.menstruation.read.own"])
 assert.throws(() => decideMenstruationAccess(grants, null, "read", "a"))
 assert.throws(() => decideMenstruationAccess(grants, "a", "read", "b"))
 assert.deepEqual(decideMenstruationAccess(grants,"a","read"), { studentId:"a",source:"STUDENT" })
 assert.throws(() => decideMenstruationAccess(grants,"a","update","a"))
 assert.deepEqual(decideMenstruationAccess(new Set(["euks.menstruation.read"]),null,"read","b"),{ studentId:"b",source:"UKS" })
})

test("personal card eligibility requires own permission and an active female student", () => {
 const own = new Set(["euks.menstruation.read.own"])
 assert.equal(canReadOwnMenstruation(own, null), false)
 assert.equal(canReadOwnMenstruation(own, { active: false, gender: "PEREMPUAN" }), false)
 assert.equal(canReadOwnMenstruation(own, { active: true, gender: "LAKI_LAKI" }), false)
 assert.equal(canReadOwnMenstruation(own, { active: true, gender: null }), false)
 assert.equal(canReadOwnMenstruation(new Set(["euks.menstruation.read"]), { active: true, gender: "PEREMPUAN" }), false)
 assert.equal(canReadOwnMenstruation(own, { active: true, gender: "PEREMPUAN" }), true)
})
