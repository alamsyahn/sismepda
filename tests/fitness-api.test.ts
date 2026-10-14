import assert from "node:assert/strict"
import { test } from "node:test"
import { POST } from "../app/api/e-uks/fitness/route"

test("fitness API rejects cross-origin writes before accessing private data", async () => {
  const response = await POST(new Request("http://localhost:3000/api/e-uks/fitness", {
    method:"POST", headers:{Origin:"https://untrusted.invalid","Content-Type":"application/json"}, body:"{}",
  }))
  assert.equal(response.status,403)
  assert.equal(response.headers.get("Cache-Control"),"private, no-store")
})

test("fitness API rejects oversized and malformed bodies before database mutations", async () => {
  // Trusted origin is explicitly scoped to this isolated test process.
  const previous = process.env.APP_ORIGIN
  process.env.APP_ORIGIN = "http://localhost:3000"
  try {
    const oversized = await POST(new Request("http://localhost:3000/api/e-uks/fitness", {
      method:"POST", headers:{Origin:"http://localhost:3000","Content-Length":"300001"}, body:"{}",
    }))
    assert.equal(oversized.status,413)
    const malformed = await POST(new Request("http://localhost:3000/api/e-uks/fitness", {
      method:"POST", headers:{Origin:"http://localhost:3000"}, body:"{",
    }))
    assert.equal(malformed.status,400)
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN
    else process.env.APP_ORIGIN = previous
  }
})
