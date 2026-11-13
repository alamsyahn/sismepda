import { ApiError, describeAuthFailure } from "@/lib/api-errors"
import { EUKS_PORTAL_ORIGIN } from "@/lib/euks-portal"

function responseHeaders(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store", Vary: "Origin" })
  if (request.headers.get("origin") === EUKS_PORTAL_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", EUKS_PORTAL_ORIGIN)
    headers.set("Access-Control-Allow-Credentials", "true")
  }
  return headers
}

export function portalOptions(request: Request) {
  const headers = responseHeaders(request)
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Content-Type")
  return new Response(null, { status: 204, headers })
}

export function verifyPortalWrite(request: Request) {
  if (request.headers.get("origin") !== EUKS_PORTAL_ORIGIN) {
    throw new ApiError(403, "Permintaan ditolak.")
  }
}

export async function portalResponse(request: Request, work: () => Promise<unknown>) {
  const headers = responseHeaders(request)
  try {
    return Response.json(await work(), { headers })
  } catch (error) {
    const failure = describeAuthFailure(error)
    return Response.json({ error: failure.error }, { status: failure.status, headers })
  }
}
