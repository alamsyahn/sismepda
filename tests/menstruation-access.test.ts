import test from "node:test"
import assert from "node:assert/strict"
import { decideMenstruationAccess } from "../lib/menstruation-access"
test("own permission requires DB student binding and cannot target another student", () => {
 const grants = new Set(["euks.menstruation.read.own"])
 assert.throws(() => decideMenstruationAccess(grants, null, "read", "a"))
 assert.throws(() => decideMenstruationAccess(grants, "a", "read", "b"))
 assert.deepEqual(decideMenstruationAccess(grants,"a","read"), { studentId:"a",source:"STUDENT" })
 assert.throws(() => decideMenstruationAccess(grants,"a","update","a"))
 assert.deepEqual(decideMenstruationAccess(new Set(["euks.menstruation.read"]),null,"read","b"),{ studentId:"b",source:"UKS" })
})
