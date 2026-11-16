import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { isStudentQr } from "./scan"

export const qrHash = (value: string) => createHash("sha256").update(value).digest("hex")

function cardHmac(version: "v2" | "v3", tokenHash: string) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("Kunci autentikasi diperlukan untuk mencetak ulang kartu")
  return createHmac("sha256", secret).update(`sismepda:student-card:${version}:${tokenHash}`)
}

/** Encode 128 bits in QR alphanumeric mode so the printed modules can be larger. */
export function shortStudentQr(tokenHash: string): string {
  const bits = cardHmac("v3", tokenHash).digest().subarray(0, 16)
  const token = BigInt(`0x${bits.toString("hex")}`).toString(36).toUpperCase().padStart(25, "0")
  return `SP3:${token}`
}

export function studentQrTokenHash(code: string): string | null {
  if (!isStudentQr(code)) return null
  if (code.startsWith("SP1:") || code.startsWith("SP3:")) return qrHash(code)
  const [, tokenHash, signed] = code.split(":")
  const expected = cardHmac("v2", tokenHash).digest("base64url")
  return timingSafeEqual(Buffer.from(signed), Buffer.from(expected)) ? tokenHash : null
}
