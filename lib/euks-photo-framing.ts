import { z } from "zod"

export const photoFramingSchema = z.strictObject({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  zoom: z.number().min(1).max(3),
})

export type PhotoFraming = z.infer<typeof photoFramingSchema>
export const DEFAULT_PHOTO_FRAMING: PhotoFraming = { x: 50, y: 50, zoom: 1 }

export function readPhotoFraming(value: unknown): PhotoFraming {
  return photoFramingSchema.safeParse(value).data ?? DEFAULT_PHOTO_FRAMING
}

export function photoFramingStyle(value: unknown) {
  const { x, y, zoom } = readPhotoFraming(value)
  const position = `${x}% ${y}%`
  return { objectPosition: position, transformOrigin: position, scale: zoom }
}

export function panPhoto(
  framing: PhotoFraming, image: { width: number; height: number },
  frame: { width: number; height: number }, dx: number, dy: number,
): PhotoFraming {
  if (!image.width || !image.height || !frame.width || !frame.height) return framing
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * framing.zoom
  const move = (current: number, delta: number, overflow: number) =>
    overflow > 0.01 ? Math.min(100, Math.max(0, current - delta * 100 / overflow)) : current
  return {
    ...framing,
    x: move(framing.x, dx, image.width * scale - frame.width),
    y: move(framing.y, dy, image.height * scale - frame.height),
  }
}
