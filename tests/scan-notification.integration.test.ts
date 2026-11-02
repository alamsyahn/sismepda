import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { prisma } from "../lib/prisma"
import { sendWhatsAppMessage } from "../lib/server-whatsapp"
import type { WhatsAppTransport } from "../lib/whatsapp-transport"

test("local fake transport: scan event replay claims before sending; manual resend remains explicit", { skip: process.env.SISMEPDA_DB_ROLE !== "local" }, async () => {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); assert.equal(url.pathname, "/sismepda_dev")
  assert.equal((await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() as name`)[0].name, "sismepda_dev")
  const suffix = randomUUID(), before = await prisma.whatsAppSendLog.count()
  const message = await prisma.whatsAppMessage.create({ data: { kind: "MANUAL", title: "TEMP scan notification", description: "Temporary fake transport test", sortOrder: 99999, enabled: false, slots: [], selectedVariables: [] } })
  let sends = 0
  const fake = { sendMessage: async () => { sends++; await new Promise(r => setTimeout(r, 80)); return { providerMessageId: "fake-" + sends } } } as unknown as WhatsAppTransport
  const body = { messageId: message.id, slot: null, trigger: "MANUAL" as const, eventKey: "scan-visit:"+suffix, text: "Temporary test message; never leaves the fake transport", recipient: { jid: "6281234567890@s.whatsapp.net", name: "Fake test recipient" } }
  try {
    const race = await Promise.all([sendWhatsAppMessage(fake,body), sendWhatsAppMessage(fake,body)])
    assert.equal(sends,1); assert.ok(race.some(r=>r.status==="SENT"))
    assert.equal((await sendWhatsAppMessage(fake,body)).status,"SENT");assert.equal(sends,1)
    const failureKey="scan-visit:failed-"+suffix
    const failing={sendMessage:async()=>{sends++;throw new Error("fake offline")}} as unknown as WhatsAppTransport
    assert.equal((await sendWhatsAppMessage(failing,{...body,eventKey:failureKey})).status,"FAILED")
    assert.equal((await sendWhatsAppMessage(fake,{...body,eventKey:failureKey})).status,"FAILED");assert.equal(sends,2)
    await sendWhatsAppMessage(fake,{...body,eventKey:undefined});assert.equal(sends,3)
    assert.equal(await prisma.whatsAppSendLog.count({where:{messageId:message.id}}),3)
  } finally {
    await prisma.whatsAppSendLog.deleteMany({where:{messageId:message.id}})
    await prisma.whatsAppMessage.delete({where:{id:message.id}})
    assert.equal(await prisma.whatsAppSendLog.count(),before)
    await prisma.$disconnect()
  }
})
