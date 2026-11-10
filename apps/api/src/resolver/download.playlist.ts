// Lectura de playlists HLS para la descarga. Puro (sin red) para poder testearlo.

export function resolveUrl(href: string, base: string): string {
  if (href.startsWith('http')) return href
  if (href.startsWith('/')) return new URL(base).origin + href
  return base.slice(0, base.lastIndexOf('/') + 1) + href
}

// Para descarga elige la calidad MÁS BAJA disponible:
// mismos segmentos pero ~3x más pequeños → descarga 3x más rápida
export function pickVariant(master: string, baseUrl: string): { url: string; quality: string } | null {
  const lines = master.split('\n')
  const variants: { bw: number; url: string }[] = []

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const bwMatch = line.match(/BANDWIDTH=(\d+)/)
    const bw = bwMatch ? Number(bwMatch[1]) : 0
    const rawUrl = lines[i + 1]?.trim()
    if (!rawUrl || rawUrl.startsWith('#')) continue
    variants.push({ bw, url: resolveUrl(rawUrl, baseUrl) })
  }

  if (!variants.length) return null
  // Ordenar por bitrate ascendente → tomar el más pequeño disponible
  variants.sort((a, b) => a.bw - b.bw)
  const v = variants[0]
  const quality = v.bw >= 3_000_000 ? '1080p' : v.bw >= 1_500_000 ? '720p' : v.bw >= 700_000 ? '480p' : '360p'
  return { url: v.url, quality }
}

export type Segment = { url: string; duration: number }

export function parseVariant(m3u8: string, baseUrl: string): Segment[] {
  const lines = m3u8.split('\n')
  const segments: Segment[] = []
  let dur = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF:')) {
      dur = parseFloat(line.slice(8).split(',')[0]) || 0
    } else if (line && !line.startsWith('#')) {
      segments.push({ url: resolveUrl(line, baseUrl), duration: dur })
      dur = 0
    }
  }
  return segments
}


export type PlaylistKind = 'master' | 'media'

// ¿Lo que bajamos es una playlist MAESTRA (lista de variantes) o ya una playlist de
// MEDIOS (lista de segmentos)? Muchos hosts (p. ej. lookmovie) devuelven directo
// la de medios; asumir siempre maestra hacía fallar la descarga con
// "No variant found". Si hay #EXT-X-STREAM-INF es maestra; si no y hay #EXTINF, de medios.
export function playlistKind(text: string): PlaylistKind | null {
  if (text.includes('#EXT-X-STREAM-INF')) return 'master'
  if (text.includes('#EXTINF')) return 'media'
  return null
}

// Segmentos cifrados (#EXT-X-KEY con METHOD distinto de NONE): el cliente reescribe
// la playlist sin la línea de la clave, así que quedarían ilegibles. Mejor avisar
// que entregar un archivo "descargado" que no reproduce.
export function isEncrypted(text: string): boolean {
  return /#EXT-X-KEY:[^\n]*METHOD=(?!NONE)[A-Z0-9-]+/i.test(text)
}
