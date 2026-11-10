// Resolución DIRECTA contra la API de Real-Debrid, sin pasar por el addon.
//
// Por qué existe: el `url` que traen los streams de los indexadores (Torrentio,
// MediaFusion) es un endpoint de RESOLUCIÓN del addon — al visitarlo, el
// SERVIDOR DEL ADDON le pide el link a RD con nuestra key. Con MediaFusion en la
// instancia compartida de ElfHosted eso falla seguido: RD limita o rechaza esas
// IPs (las comparten miles de usuarios) y ElfHosted, en vez de un error HTTP,
// redirige a un video falso ("slate") con el mensaje — que el player reproduce
// como si fuera la peli. Verificado en producción (Inception: 2 de 9 fuentes de
// MediaFusion devolvieron el slate "Too many requests" y 3 no abrieron).
//
// Ahora los indexadores sólo BUSCAN: de cada stream se saca el infoHash (va en
// el path de la URL de ambos addons) y somos NOSOTROS los que hablamos con RD,
// desde Vercel y con nuestra key. Los errores pasan a ser reales (HTTP + código
// de RD), sin intermediarios ni videos falsos, y la carrera pasa al siguiente.
//
// Flujo (torrent ya cacheado en RD = todo instantáneo):
//   addMagnet → info (lista de archivos) → selectFiles(archivo) → info (links)
//   → unrestrict/link → URL de download.real-debrid.com
// Si tras elegir el archivo RD lo pone a DESCARGAR (no estaba cacheado) se borra
// el torrent y se falla: sólo queremos reproducción instantánea.
//
// Las partes puras (sacar el hash, elegir el archivo) están separadas y testeadas.
import { TTLCache } from './cache'
import { rdGuard, redactSecrets, type FailureReason } from './rd.guard'
import { parseEpisodeTag, type TorrentioStream } from './torrentio.parse'

const RD_API = 'https://api.real-debrid.com/rest/1.0'
const RD_CALL_TIMEOUT_MS = 5_000

// Interruptor de emergencia: RD_DIRECT=false vuelve al comportamiento anterior
// (resolver siguiendo la URL del addon) sin tocar código.
export const rdDirectEnabled = (): boolean =>
  !!process.env.DEBRID_KEY && process.env.RD_DIRECT !== 'false'

// ── Puro ────────────────────────────────────────────────────────────────────

const HASH_RE = /^[a-f0-9]{40}$/i

/**
 * infoHash del torrent de un stream. Si el addon no lo trae como campo, se saca
 * del path de la URL de resolución — ambos addons lo llevan como segmento propio:
 *   Torrentio:   /resolve/realdebrid/<key>/<HASH>/<cacheInfo>/<fileIdx>/<file>
 *   MediaFusion: /<secret>/playback/<provider>/<HASH>[/<s>/<e>][/<file>]
 */
export function extractInfoHash(s: Pick<TorrentioStream, 'infoHash' | 'url'>): string | null {
  if (s.infoHash && HASH_RE.test(s.infoHash)) return s.infoHash.toLowerCase()
  if (!s.url) return null
  try {
    const segs = new URL(s.url).pathname.split('/')
    const hit = segs.find((seg) => HASH_RE.test(seg))
    return hit ? hit.toLowerCase() : null
  } catch {
    return null
  }
}

/** Índice de archivo dentro del torrent (0-based) — sólo lo da Torrentio. */
export function extractFileIdx(s: Pick<TorrentioStream, 'fileIdx' | 'url'>): number | null {
  if (typeof s.fileIdx === 'number') return s.fileIdx
  if (!s.url) return null
  try {
    const u = new URL(s.url)
    if (!u.hostname.endsWith('torrentio.strem.fun')) return null
    const segs = u.pathname.split('/').filter(Boolean)
    const h = segs.findIndex((seg) => HASH_RE.test(seg))
    // <HASH>/<cacheInfo>/<fileIdx>/...
    const raw = h >= 0 ? segs[h + 2] : undefined
    const n = raw != null && /^\d+$/.test(raw) ? Number(raw) : NaN
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export type RdFile = { id: number; path: string; bytes: number; selected?: number }

export type FileHint = {
  // Nombre del archivo que anunció el indexador (behaviorHints.filename).
  filename?: string | null
  fileIdx?: number | null
  season?: number | null
  episode?: number | null
}

const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|mpg|mpeg)$/i
// Muestras, trailers y extras: nunca son lo que se quiere reproducir.
const JUNK_RE = /\b(sample|trailer|featurette|extras?|behind[\s._-]?the[\s._-]?scenes)\b/i

const baseName = (p: string) => (p.split('/').pop() ?? p).toLowerCase()

/**
 * Elige el archivo a reproducir dentro del torrent. En orden de confianza:
 *  1. el MISMO nombre que anunció el indexador,
 *  2. en series, el archivo cuyo nombre trae SxxEyy del episodio pedido,
 *  3. el fileIdx que dio Torrentio (RD numera desde 1, en el orden del torrent),
 *  4. el video más pesado (películas; en series sólo si no hay otra señal).
 */
export function pickRdFile(files: RdFile[], hint: FileHint): RdFile | null {
  const videos = files.filter((f) => VIDEO_EXT_RE.test(f.path) && !JUNK_RE.test(baseName(f.path)))
  if (!videos.length) return null

  if (hint.filename) {
    const want = hint.filename.toLowerCase()
    const exact = videos.find((f) => baseName(f.path) === want)
    if (exact) return exact
  }

  const isEpisode = hint.season != null && hint.episode != null
  if (isEpisode) {
    const match = videos.filter((f) => {
      const t = parseEpisodeTag(baseName(f.path))
      return t.season === hint.season && t.episode === hint.episode
    })
    if (match.length) return match.sort((a, b) => b.bytes - a.bytes)[0]!
  }

  if (hint.fileIdx != null) {
    const byIdx = videos.find((f) => f.id === hint.fileIdx! + 1)
    if (byIdx) return byIdx
  }

  // Un pack de temporada sin el episodio identificable: mejor fallar que
  // reproducir otro capítulo. Con un único video no hay ambigüedad.
  if (isEpisode && videos.length > 1) return null
  return [...videos].sort((a, b) => b.bytes - a.bytes)[0]!
}

// Códigos de error de RD que significan "la cuenta/acceso está mal" (no "este
// torrent"): token inválido, permiso denegado, cuenta bloqueada, IP no permitida.
const RD_AUTH_CODES = new Set([8, 9, 14, 15, 22])

export function classifyRdError(status: number, errorCode?: number): FailureReason {
  if (status === 429 || errorCode === 34 || errorCode === 5) return 'rate_limited'
  if (errorCode != null && RD_AUTH_CODES.has(errorCode)) return 'auth'
  if (status === 401) return 'auth'
  return 'http_error'
}

// ── Red ─────────────────────────────────────────────────────────────────────

export class RdDirectError extends Error {
  constructor(
    public reason: FailureReason | 'not_cached' | 'no_file',
    message: string,
  ) {
    super(message)
  }
}

async function rd<T>(path: string, init: { method?: string; form?: Record<string, string> } = {}): Promise<T> {
  const key = process.env.DEBRID_KEY!
  let r: Response
  try {
    r = await fetch(`${RD_API}${path}`, {
      method: init.method ?? (init.form ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      signal: AbortSignal.timeout(RD_CALL_TIMEOUT_MS),
    })
  } catch (e) {
    throw new RdDirectError('network', redactSecrets((e as Error).message ?? 'error de red'))
  }
  if (r.status === 204) return undefined as T
  const text = await r.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch {}
  if (!r.ok) {
    const code = typeof body?.error_code === 'number' ? body.error_code : undefined
    const reason = classifyRdError(r.status, code)
    throw new RdDirectError(reason, `RD ${r.status} ${body?.error ?? ''}${code != null ? ` (code ${code})` : ''} en ${path.split('/').slice(0, 3).join('/')}`)
  }
  return body as T
}

type RdTorrentInfo = {
  id: string
  hash: string
  status: string
  files?: RdFile[]
  links?: string[]
}
type RdTorrentListItem = { id: string; hash: string; status: string }

// Los torrents que ya están en la cuenta (de reproducciones anteriores — también
// los que agrega Torrentio con la misma key). Reutilizarlos evita llenar la lista
// de duplicados. Caché corta por instancia: es una optimización, no una fuente de
// verdad (si no aparece, se agrega el magnet y listo).
const listCache = new TTLCache<RdTorrentListItem[]>(60_000)

async function findExisting(hash: string): Promise<RdTorrentListItem | null> {
  const list = await listCache
    .resolve('torrents', () => rd<RdTorrentListItem[]>('/torrents?limit=100'))
    .catch(() => [] as RdTorrentListItem[])
  return list.find((t) => t.hash?.toLowerCase() === hash && t.status === 'downloaded') ?? null
}

// Link del archivo dentro de un torrent ya descargado. RD devuelve `links` en el
// orden de los archivos SELECCIONADOS (por id).
function linkFor(info: RdTorrentInfo, file: RdFile): string | null {
  const selected = (info.files ?? []).filter((f) => f.selected).sort((a, b) => a.id - b.id)
  const i = selected.findIndex((f) => f.id === file.id)
  return i >= 0 ? info.links?.[i] ?? null : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function infoWithFiles(id: string): Promise<RdTorrentInfo> {
  // Justo después de addMagnet RD puede tardar un instante en listar archivos
  // (estado magnet_conversion). Para uno cacheado son milisegundos.
  for (let i = 0; i < 4; i++) {
    const info = await rd<RdTorrentInfo>(`/torrents/info/${id}`)
    if (info.files?.length) return info
    if (!['magnet_conversion', 'waiting_files_selection', 'queued'].includes(info.status)) return info
    await sleep(350)
  }
  return rd<RdTorrentInfo>(`/torrents/info/${id}`)
}

async function unrestrict(link: string): Promise<string> {
  const u = await rd<{ download?: string }>('/unrestrict/link', { form: { link } })
  if (!u?.download) throw new RdDirectError('http_error', 'unrestrict sin download')
  return u.download
}

/**
 * Link directo de RD para un archivo de un torrent. Lanza RdDirectError con el
 * motivo; los de cuenta/rate-limit además quedan registrados en el breaker.
 */
export async function resolveViaRealDebrid(hash: string, hint: FileHint): Promise<string> {
  try {
    // 1) ¿Ya está en la cuenta con ese archivo elegido? → unrestrict directo.
    const existing = await findExisting(hash)
    if (existing) {
      const info = await rd<RdTorrentInfo>(`/torrents/info/${existing.id}`)
      const file = pickRdFile(info.files ?? [], hint)
      const link = file ? linkFor(info, file) : null
      if (link) return await unrestrict(link)
    }

    // 2) Agregar el magnet y elegir el archivo.
    const added = await rd<{ id: string }>('/torrents/addMagnet', { form: { magnet: `magnet:?xt=urn:btih:${hash}` } })
    const info = await infoWithFiles(added.id)
    const file = pickRdFile(info.files ?? [], hint)
    if (!file) {
      await rd(`/torrents/delete/${added.id}`, { method: 'DELETE' }).catch(() => {})
      throw new RdDirectError('no_file', 'el torrent no tiene un video que coincida')
    }
    await rd(`/torrents/selectFiles/${added.id}`, { form: { files: String(file.id) } })

    // 3) Cacheado = 'downloaded' al instante. Cualquier otro estado = RD se puso a
    //    descargarlo: no sirve para reproducir ya, y se borra para no dejar basura.
    let after = await rd<RdTorrentInfo>(`/torrents/info/${added.id}`)
    // Un cacheado puede quedar un instante en un estado de transición antes de
    // pasar a 'downloaded'. Una sola re-consulta corta; 'downloading' es definitivo.
    if (['queued', 'magnet_conversion', 'waiting_files_selection'].includes(after.status)) {
      await sleep(400)
      after = await rd<RdTorrentInfo>(`/torrents/info/${added.id}`)
    }
    if (after.status !== 'downloaded' || !after.links?.length) {
      await rd(`/torrents/delete/${added.id}`, { method: 'DELETE' }).catch(() => {})
      throw new RdDirectError('not_cached', `no cacheado en RD (estado ${after.status})`)
    }
    const link = linkFor(after, file) ?? after.links[0]!
    // Ahora está en la cuenta: el próximo play del mismo torrent lo reutiliza.
    listCache.invalidate('torrents')
    return await unrestrict(link)
  } catch (e) {
    const err = e instanceof RdDirectError ? e : new RdDirectError('network', (e as Error).message ?? 'error')
    if (err.reason === 'rate_limited' || err.reason === 'auth') {
      rdGuard.recordFailure(err.reason, `directo: ${err.message}`)
    }
    throw err
  }
}
