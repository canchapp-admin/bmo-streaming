import { Elysia, t } from 'elysia'
import { resolveForDownload } from './resolver.service'
import type { AudioLang } from './resolver.service'
import { resolveUrl, pickVariant, parseVariant, playlistKind, isEncrypted, type Segment } from './download.playlist'

async function buildSegmentList(
  streamUrl: string,
  referer: string
): Promise<{ segments: Segment[]; quality: string }> {
  const headers: Record<string, string> = referer ? { Referer: referer } : {}

  const get = async (url: string, what: string): Promise<string> => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`${what} HTTP ${res.status}`)
    return res.text()
  }

  // 1. Bajar lo que devolvió el resolver: puede ser maestra o ya de medios.
  const first = await get(streamUrl, 'playlist')
  const kind = playlistKind(first)
  if (!kind) throw new Error('Playlist HLS inválida')

  let variantText = first
  let variantUrl = streamUrl
  let quality = ''

  // 2. Si es maestra, elegir la variante y bajarla.
  if (kind === 'master') {
    const chosen = pickVariant(first, streamUrl)
    if (!chosen) throw new Error('No variant found')
    variantUrl = chosen.url
    quality = chosen.quality
    variantText = await get(variantUrl, 'variante')
  }

  if (isEncrypted(variantText)) throw new Error('Fuente cifrada: no se puede descargar')

  const segments = parseVariant(variantText, variantUrl)
  if (!segments.length) throw new Error('La playlist no tiene segmentos')
  return { segments, quality }
}

// La calidad no viene en el StreamResult para fuentes 'file', pero el nombre
// del archivo de Real-Debrid casi siempre la lleva.
function qualityFromName(url: string): string {
  let name = url
  try { name = decodeURIComponent(new URL(url).pathname) } catch {}
  if (/2160p|\b4k\b/i.test(name)) return '2160p'
  if (/1080p/i.test(name)) return '1080p'
  if (/720p/i.test(name)) return '720p'
  if (/480p/i.test(name)) return '480p'
  return ''
}

// Respuesta discriminada por `kind`:
//   'file' → un único archivo directo (Real-Debrid): el cliente lo baja de una
//   'hls'  → lista de segmentos a bajar y recomponer en un m3u8 local
//
// Antes esto asumía SIEMPRE HLS: con una fuente 'file' hacía .text() sobre un
// MKV de varios GB para buscarle variantes, y la función moría por timeout.
// Desde que Real-Debrid es la fuente principal, eso rompía toda descarga.
async function buildPayload(result: NonNullable<Awaited<ReturnType<typeof resolveForDownload>>>) {
  const referer = result.headers.Referer ?? result.headers.referer ?? ''
  const common = { referer, captions: result.captions, source: result.source }

  if (result.type === 'file') {
    // sizeGB: el cliente comprueba el espacio libre ANTES de empezar a bajar.
    return { kind: 'file' as const, url: result.url, quality: qualityFromName(result.url), sizeGB: result.sizeGB ?? null, ...common }
  }
  const { segments, quality } = await buildSegmentList(result.url, referer)
  return { kind: 'hls' as const, segments, quality, ...common }
}

// Mismo default que el reproductor (usePlaybackSource arranca en 'latino'): lo que
// se descarga debe tener el audio que el usuario ve en streaming.
function parseLang(v?: string): AudioLang {
  return v === 'original' ? 'original' : 'latino'
}

export const downloadRoutes = new Elysia({ prefix: '/download' })
  .get(
    '/movie/:id',
    async ({ params, query, set }) => {
      const result = await resolveForDownload('movie', Number(params.id), undefined, undefined, parseLang(query.lang))
      if (!result) { set.status = 404; return { error: 'No stream' } }
      try {
        return await buildPayload(result)
      } catch (e) {
        set.status = 500
        return { error: (e as Error).message }
      }
    },
    { params: t.Object({ id: t.String() }), query: t.Object({ lang: t.Optional(t.String()) }) }
  )
  .get(
    '/tv/:id/:season/:episode',
    async ({ params, query, set }) => {
      const result = await resolveForDownload('tv', Number(params.id), Number(params.season), Number(params.episode), parseLang(query.lang))
      if (!result) { set.status = 404; return { error: 'No stream' } }
      try {
        return await buildPayload(result)
      } catch (e) {
        set.status = 500
        return { error: (e as Error).message }
      }
    },
    { params: t.Object({ id: t.String(), season: t.String(), episode: t.String() }), query: t.Object({ lang: t.Optional(t.String()) }) }
  )
