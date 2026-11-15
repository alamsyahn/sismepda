import { strict as assert } from "node:assert"
import { test } from "node:test"
import { DEFAULT_PHOTO_FRAMING, panPhoto, photoFramingSchema, photoFramingStyle } from "../lib/euks-photo-framing"

test("legacy framing defaults to the centered unzoomed photo and invalid values cannot enter CSS", () => {
  assert.deepEqual(photoFramingStyle(null), { objectPosition: "50% 50%", transformOrigin: "50% 50%", scale: 1 })
  assert.equal(photoFramingSchema.safeParse({ x: -1, y: 50, zoom: 2 }).success, false)
  assert.equal(photoFramingSchema.safeParse({ x: 50, y: Infinity, zoom: 2 }).success, false)
  assert.equal(photoFramingSchema.safeParse({ x: 50, y: 50, zoom: 4 }).success, false)
  assert.deepEqual(photoFramingStyle({ x: 20, y: 65, zoom: 1.5 }), {
    objectPosition: "20% 65%", transformOrigin: "20% 65%", scale: 1.5,
  })
})

test("drag moves on axes with available photo area and clamps to the image edges", () => {
  const image = { width: 400, height: 200 }
  const frame = { width: 100, height: 100 }
  assert.deepEqual(panPhoto(DEFAULT_PHOTO_FRAMING, image, frame, 30, 30), { x: 20, y: 50, zoom: 1 })
  assert.deepEqual(panPhoto({ x: 50, y: 50, zoom: 2 }, image, frame, -400, 400), { x: 100, y: 0, zoom: 2 })
})
