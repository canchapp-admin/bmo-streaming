import { describe, expect, test } from 'bun:test'
import { playlistKind, isEncrypted, parseVariant, pickVariant, resolveUrl } from './download.playlist'

const MEDIA = '#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXTINF:8.000,\nseg-1.ts\n#EXTINF:8.000,\nseg-2.ts\n#EXT-X-ENDLIST'
const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3500000\nhigh/index.m3u8'

describe('playlistKind', () => {
  test('maestra', () => expect(playlistKind(MASTER)).toBe('master'))
  test('de medios (el caso que antes fallaba con "No variant found")', () => expect(playlistKind(MEDIA)).toBe('media'))
  test('basura → null', () => expect(playlistKind('<html>403</html>')).toBeNull())
})

describe('segmentos', () => {
  test('una playlist de medios con rutas relativas se resuelve contra su URL', () => {
    const segs = parseVariant(MEDIA, 'https://cdn.x/a/b/index.m3u8')
    expect(segs.map((s) => s.url)).toEqual(['https://cdn.x/a/b/seg-1.ts', 'https://cdn.x/a/b/seg-2.ts'])
    expect(segs[0].duration).toBe(8)
  })
  test('rutas absolutas y con barra inicial', () => {
    expect(resolveUrl('https://o/x.ts', 'https://cdn.x/a/i.m3u8')).toBe('https://o/x.ts')
    expect(resolveUrl('/z.ts', 'https://cdn.x/a/i.m3u8')).toBe('https://cdn.x/z.ts')
  })
  test('en la maestra elige la variante más liviana', () => {
    expect(pickVariant(MASTER, 'https://cdn.x/m.m3u8')?.url).toBe('https://cdn.x/low/index.m3u8')
  })
})

describe('isEncrypted', () => {
  test('AES-128 sí', () => expect(isEncrypted('#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:8,\na.ts')).toBe(true))
  test('METHOD=NONE no', () => expect(isEncrypted('#EXT-X-KEY:METHOD=NONE\n#EXTINF:8,\na.ts')).toBe(false))
  test('sin clave no', () => expect(isEncrypted(MEDIA)).toBe(false))
})
