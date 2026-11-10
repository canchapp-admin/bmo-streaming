import { useEffect, useState } from 'react'
import { decode } from 'jpeg-js'

// Color dominante de una imagen de TMDB, como Apple Music con las portadas:
// la ficha se tiñe del color del título.
//
// Se baja la versión más chica (w92, ~3 KB) y se decodifica en JS: sin módulo
// nativo ni servidor. Se cachea en memoria por imagen.
//
// No es el promedio (que da marrón casi siempre): se agrupan los píxeles por
// tono y gana el grupo con más "presencia" (cantidad × saturación), ignorando
// casi-negros, casi-blancos y grises. Si la imagen es toda gris, gris.

const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max / 255 }
}

function dominant(data: Uint8Array): string | null {
  const BUCKETS = 18 // de a 20° de tono
  const acc = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  let gr = 0, gg = 0, gb = 0, gn = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const { h, s, v } = rgbToHsv(r, g, b)
    gr += r; gg += g; gb += b; gn++
    if (v < 0.16 || v > 0.97 || s < 0.22) continue
    const w = s * s * (0.4 + v) // lo saturado y no oscuro pesa más
    const a = acc[Math.floor(h / (360 / BUCKETS)) % BUCKETS]
    a.w += w; a.r += r * w; a.g += g * w; a.b += b * w
  }
  const best = acc.reduce((m, a) => (a.w > m.w ? a : m), acc[0])
  if (best.w < 0.5) return gn ? toHex(gr / gn, gg / gn, gb / gn) : null
  return toHex(best.r / best.w, best.g / best.w, best.b / best.w)
}

export function dominantColor(path: string | null | undefined): Promise<string | null> {
  if (!path) return Promise.resolve(null)
  if (cache.has(path)) return Promise.resolve(cache.get(path) ?? null)
  const inFlight = pending.get(path)
  if (inFlight) return inFlight
  const p = fetch(`https://image.tmdb.org/t/p/w92${path}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => {
      const img = decode(new Uint8Array(buf), { useTArray: true, formatAsRGBA: true })
      return dominant(img.data as Uint8Array)
    })
    .catch(() => null)
    .then((c) => { cache.set(path, c); pending.delete(path); return c })
  pending.set(path, p)
  return p
}

/** Color dominante (o null mientras carga / si no se pudo). */
export function useDominantColor(path: string | null | undefined) {
  const [color, setColor] = useState<string | null>(() => (path ? cache.get(path) ?? null : null))
  useEffect(() => {
    let alive = true
    setColor(path ? cache.get(path) ?? null : null)
    dominantColor(path).then((c) => { if (alive) setColor(c) })
    return () => { alive = false }
  }, [path])
  return color
}
