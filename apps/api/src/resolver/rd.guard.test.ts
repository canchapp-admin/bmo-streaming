import { describe, expect, test } from 'bun:test'
import { RdGuard, classifyStatus, classifyPlaceholder, redactSecrets, interpretUser } from './rd.guard'

const clock = (start = 1_000_000) => {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('RdGuard', () => {
  test('arranca abierto al tráfico', () => {
    expect(new RdGuard().allow()).toBe(true)
  })

  test('un 429 corta el tráfico y se reabre pasado el cooldown', () => {
    const c = clock()
    const g = new RdGuard(c.now)
    g.recordFailure('rate_limited', 'HTTP 429')
    expect(g.allow()).toBe(false)
    c.advance(59_000)
    expect(g.allow()).toBe(false)
    c.advance(2_000)
    expect(g.allow()).toBe(true)
  })

  test('respeta Retry-After cuando viene', () => {
    const c = clock()
    const g = new RdGuard(c.now)
    g.recordFailure('rate_limited', '', 5_000)
    c.advance(5_100)
    expect(g.allow()).toBe(true)
  })

  test('un error de cuenta corta por más tiempo', () => {
    const c = clock()
    const g = new RdGuard(c.now)
    g.recordFailure('auth', 'placeholder failed_access')
    c.advance(4 * 60_000)
    expect(g.allow()).toBe(false)
    c.advance(61_000)
    expect(g.allow()).toBe(true)
  })

  test('fallas de un torrent (placeholder/red) no cortan por sí solas', () => {
    const g = new RdGuard()
    g.recordFailure('placeholder', 'rar')
    g.recordFailure('network', 'timeout')
    g.recordFailure('http_error', '404')
    expect(g.allow()).toBe(true)
    expect(g.snapshot().failures).toMatchObject({ placeholder: 1, network: 1, http_error: 1 })
  })

  test('una racha de resoluciones vacías abre el breaker; un éxito la corta', () => {
    const g = new RdGuard()
    for (let i = 0; i < 4; i++) g.recordExhausted()
    g.recordSuccess()
    for (let i = 0; i < 4; i++) g.recordExhausted()
    expect(g.allow()).toBe(true)
    g.recordExhausted()
    expect(g.allow()).toBe(false)
    expect(g.snapshot().openReason).toBe('streak')
  })

  test('un corte corto no acorta uno largo en curso', () => {
    const c = clock()
    const g = new RdGuard(c.now)
    g.recordFailure('auth', '')
    g.recordFailure('rate_limited', '', 1_000)
    c.advance(10_000)
    expect(g.allow()).toBe(false)
  })
})

describe('clasificación', () => {
  test('status HTTP', () => {
    expect(classifyStatus(200)).toBeNull()
    expect(classifyStatus(206)).toBeNull()
    expect(classifyStatus(429)).toBe('rate_limited')
    expect(classifyStatus(401)).toBe('auth')
    expect(classifyStatus(403)).toBe('auth')
    expect(classifyStatus(404)).toBe('http_error')
    expect(classifyStatus(503)).toBe('http_error')
  })

  test('placeholders de Torrentio', () => {
    expect(classifyPlaceholder('https://torrentio.strem.fun/videos/failed_rar_v2.mp4')).toEqual({ reason: 'placeholder', file: 'failed_rar_v2.mp4' })
    expect(classifyPlaceholder('https://torrentio.strem.fun/videos/failed_access_v2.mp4').reason).toBe('auth')
  })
})

describe('redactSecrets', () => {
  test('oculta la key en el path de Torrentio', () => {
    const out = redactSecrets('https://torrentio.strem.fun/realdebrid=ABC123SECRET/stream/movie/tt1.json', 'ABC123SECRET')
    expect(out).not.toContain('ABC123SECRET')
    expect(out).toContain('realdebrid=<redacted>')
  })

  test('oculta la key url-encodeada (vía proxy)', () => {
    const url = 'https://proxy/?destination=' + encodeURIComponent('https://t.fun/realdebrid=ABC123SECRET/stream')
    expect(redactSecrets(url, 'ABC123SECRET')).not.toContain('ABC123SECRET')
  })

  test('oculta la key suelta en un mensaje de error', () => {
    expect(redactSecrets('fetch failed for K3Y', 'K3Y')).toBe('fetch failed for <redacted>')
  })
})

describe('interpretUser', () => {
  const day = 86_400
  test('premium con margen', () => {
    expect(interpretUser({ type: 'premium', premium: 30 * day })).toMatchObject({ ok: true, premiumDaysLeft: 30 })
    expect(interpretUser({ type: 'premium', premium: 30 * day }).warning).toBeUndefined()
  })
  test('avisa cuando quedan pocos días', () => {
    const h = interpretUser({ type: 'premium', premium: 3 * day })
    expect(h.ok).toBe(true)
    expect(h.warning).toContain('3 día')
  })
  test('free o vencido es no-ok', () => {
    expect(interpretUser({ type: 'free', premium: 0 }).ok).toBe(false)
    expect(interpretUser({ type: 'premium', premium: 0 }).ok).toBe(false)
  })
})
