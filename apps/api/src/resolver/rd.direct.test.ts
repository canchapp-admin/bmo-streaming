import { describe, expect, test } from 'bun:test'
import { extractInfoHash, extractFileIdx, pickRdFile, classifyRdError, type RdFile } from './rd.direct'

const HASH = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'

describe('extractInfoHash', () => {
  test('usa el campo infoHash cuando viene', () => {
    expect(extractInfoHash({ infoHash: HASH.toUpperCase() })).toBe(HASH)
  })

  test('lo saca del path de Torrentio', () => {
    const url = `https://torrentio.strem.fun/resolve/realdebrid/KEY123/${HASH}/null/3/Movie.2010.1080p.mkv`
    expect(extractInfoHash({ url })).toBe(HASH)
  })

  test('lo saca del path de MediaFusion (película y serie)', () => {
    expect(extractInfoHash({ url: `https://mediafusion.elfhosted.com/SECRET/playback/realdebrid/${HASH}` })).toBe(HASH)
    expect(extractInfoHash({ url: `https://mediafusion.elfhosted.com/SECRET/playback/realdebrid/${HASH}/1/5/Show.S01E05.mkv` })).toBe(HASH)
  })

  test('sin hash → null', () => {
    expect(extractInfoHash({ url: 'https://example.com/a/b/c' })).toBeNull()
    expect(extractInfoHash({})).toBeNull()
  })
})

describe('extractFileIdx', () => {
  test('lee el fileIdx de la URL de Torrentio', () => {
    expect(extractFileIdx({ url: `https://torrentio.strem.fun/resolve/realdebrid/K/${HASH}/null/3/x.mkv` })).toBe(3)
  })
  test('MediaFusion no da fileIdx (season/episode no se confunden con él)', () => {
    expect(extractFileIdx({ url: `https://mediafusion.elfhosted.com/S/playback/realdebrid/${HASH}/1/5/x.mkv` })).toBeNull()
  })
  test('campo explícito gana', () => {
    expect(extractFileIdx({ fileIdx: 0 })).toBe(0)
  })
})

describe('pickRdFile', () => {
  const movie: RdFile[] = [
    { id: 1, path: '/Movie/Sample/sample.mkv', bytes: 50e6 },
    { id: 2, path: '/Movie/Movie.2010.1080p.mkv', bytes: 2e9 },
    { id: 3, path: '/Movie/Movie.2010.nfo', bytes: 1e3 },
  ]

  test('película: el video más pesado, nunca el sample ni el .nfo', () => {
    expect(pickRdFile(movie, {})?.id).toBe(2)
  })

  test('el nombre que anunció el indexador manda', () => {
    const files: RdFile[] = [
      { id: 1, path: '/a/Big.Extended.mkv', bytes: 9e9 },
      { id: 2, path: '/a/Movie.Theatrical.mkv', bytes: 5e9 },
    ]
    expect(pickRdFile(files, { filename: 'movie.theatrical.MKV' })?.id).toBe(2)
  })

  const pack: RdFile[] = [
    { id: 1, path: '/Show.S02/Show.S02E01.mkv', bytes: 1e9 },
    { id: 2, path: '/Show.S02/Show.S02E02.mkv', bytes: 1.1e9 },
    { id: 3, path: '/Show.S02/Show.S02E03.mkv', bytes: 0.9e9 },
  ]

  test('pack de temporada: el episodio pedido por SxxEyy', () => {
    expect(pickRdFile(pack, { season: 2, episode: 3 })?.id).toBe(3)
  })

  test('pack sin el episodio identificable → null (no reproducir otro capítulo)', () => {
    const odd: RdFile[] = [
      { id: 1, path: '/x/part-a.mkv', bytes: 1e9 },
      { id: 2, path: '/x/part-b.mkv', bytes: 2e9 },
    ]
    expect(pickRdFile(odd, { season: 1, episode: 4 })).toBeNull()
  })

  test('fileIdx de Torrentio (0-based) → id de RD (1-based)', () => {
    const odd: RdFile[] = [
      { id: 1, path: '/x/part-a.mkv', bytes: 1e9 },
      { id: 2, path: '/x/part-b.mkv', bytes: 2e9 },
    ]
    expect(pickRdFile(odd, { season: 1, episode: 4, fileIdx: 0 })?.id).toBe(1)
  })

  test('sin videos (p. ej. un .rar) → null', () => {
    expect(pickRdFile([{ id: 1, path: '/x/movie.rar', bytes: 2e9 }], {})).toBeNull()
  })
})

describe('classifyRdError', () => {
  test('rate limit', () => {
    expect(classifyRdError(429)).toBe('rate_limited')
    expect(classifyRdError(503, 34)).toBe('rate_limited')
  })
  test('cuenta: token inválido, permission_denied, IP no permitida', () => {
    expect(classifyRdError(401, 8)).toBe('auth')
    expect(classifyRdError(403, 9)).toBe('auth')
    expect(classifyRdError(403, 22)).toBe('auth')
  })
  test('un 403 de ESE torrent (infringing_file) no es problema de cuenta', () => {
    expect(classifyRdError(403, 35)).toBe('http_error')
  })
})
