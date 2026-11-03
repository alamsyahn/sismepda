import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { isStudentQr } from "./scan"

export const qrHash = (value: string) => createHash("sha256").update(value).digest("hex")

function signature(tokenHash: string): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("Kunci autentikasi diperlukan untuk mencetak ulang kartu")
  return createHmac("sha256", secret).update(`sismepda:student-card:v2:${tokenHash}`).digest("base64url")
}

/** A printable representation of the SAME credential; SP1 cards remain valid. */
export function printableStudentQr(tokenHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error("Sidik QR tidak valid")
  return `SP2:${tokenHash}:${signature(tokenHash)}`
}

export function studentQrTokenHash(code: string): string | null {
  if (!isStudentQr(code)) return null
  if (code.startsWith("SP1:")) return qrHash(code)
  const [, tokenHash, signed] = code.split(":")
  const expected = signature(tokenHash)
  return timingSafeEqual(Buffer.from(signed), Buffer.from(expected)) ? tokenHash : null
}
