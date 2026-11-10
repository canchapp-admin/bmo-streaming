// Protección y observabilidad del uso de Real-Debrid. Módulo puro (sin red) para
// poder testearlo.
//
// Contexto: toda la resolución sale de UNA cuenta de RD compartida, y la API de RD
// tiene un tope de 250 req/min por cuenta; las peticiones rechazadas (429) TAMBIÉN
// cuentan y insistir lleva a un bloqueo de duración indefinida. Por eso, ante
// señales de saturación o de cuenta rota dejamos de golpear un rato en vez de
// seguir lanzando candidatos que van a fallar igual.

export type FailureReason =
  | 'rate_limited'   // HTTP 429 (RD: error_code 5 / 34)
  | 'auth'           // 401/403 o placeholder de cuenta/acceso (token vencido, no premium, IP)
  | 'placeholder'    // Torrentio redirigió a un video de error propio (rar, sin archivo…)
  | 'http_error'     // otro 4xx/5xx
  | 'network'        // timeout / DNS / corte

// Cortes del breaker.
const COOLDOWN_RATE_LIMITED_MS = 60_000
const COOLDOWN_AUTH_MS = 5 * 60_000
const COOLDOWN_STREAK_MS = 45_000
// Cuántas resoluciones seguidas sin ningún candidato válido abren el breaker.
const STREAK_THRESHOLD = 5

export type GuardState = {
  openUntil: number
  openReason: FailureReason | 'streak' | null
  streak: number
  counts: Record<FailureReason, number>
  successes: number
  lastFailure: { reason: FailureReason; detail: string; at: number } | null
}

export class RdGuard {
  private s: GuardState = RdGuard.fresh()
  constructor(private now: () => number = Date.now) {}

  private static fresh(): GuardState {
    return {
      openUntil: 0,
      openReason: null,
      streak: 0,
      counts: { rate_limited: 0, auth: 0, placeholder: 0, http_error: 0, network: 0 },
      successes: 0,
      lastFailure: null,
    }
  }

  /** ¿Está permitido intentar con RD ahora? */
  allow(): boolean {
    return this.now() >= this.s.openUntil
  }

  /** Falla de UN candidato (se cuenta para estadísticas; abre el breaker si es grave). */
  recordFailure(reason: FailureReason, detail = '', retryAfterMs?: number) {
    this.s.counts[reason]++
    this.s.lastFailure = { reason, detail: detail.slice(0, 200), at: this.now() }
    if (reason === 'rate_limited') this.open(retryAfterMs ?? COOLDOWN_RATE_LIMITED_MS, reason)
    else if (reason === 'auth') this.open(COOLDOWN_AUTH_MS, reason)
  }

  /** Una resolución completa terminó con un link bueno. */
  recordSuccess() {
    this.s.successes++
    this.s.streak = 0
  }

  /** Una resolución completa terminó sin ningún link (todos los candidatos fallaron). */
  recordExhausted() {
    this.s.streak++
    if (this.s.streak >= STREAK_THRESHOLD) {
      this.open(COOLDOWN_STREAK_MS, 'streak')
      this.s.streak = 0
    }
  }

  private open(ms: number, reason: GuardState['openReason']) {
    // No acortar un corte más largo que ya estuviera en curso.
    const until = this.now() + ms
    if (until > this.s.openUntil) {
      this.s.openUntil = until
      this.s.openReason = reason
    }
  }

  snapshot() {
    const t = this.now()
    return {
      open: t < this.s.openUntil,
      openReason: t < this.s.openUntil ? this.s.openReason : null,
      retryInMs: Math.max(0, this.s.openUntil - t),
      streak: this.s.streak,
      successes: this.s.successes,
      failures: { ...this.s.counts },
      lastFailure: this.s.lastFailure,
    }
  }
}

/** Instancia única del proceso (cada instancia serverless tiene la suya). */
export const rdGuard = new RdGuard()

/**
 * Compuerta del tráfico de FONDO (pre-calentamiento al tocar un póster).
 *
 * El breaker solo debe frenar lo que no es urgente. Antes cortaba TODO: una
 * ráfaga de prewarms (deslizar el dedo por una fila dispara uno por póster)
 * provocaba un 429 de Real-Debrid, el breaker se abría 60 s y hasta el play que
 * el usuario SÍ pidió recibía 404. Ahora el fondo es el que se contiene:
 *  - no entra si el breaker está abierto, y
 *  - entran a lo sumo `max` a la vez (cada resolución cuesta varias llamadas a RD).
 * Lo que el usuario pide a propósito nunca pasa por acá.
 */
export class BackgroundGate {
  private inFlight = 0
  constructor(private max = 2) {}

  /** Devuelve la función que libera el cupo, o null si no hay lugar. */
  tryEnter(guard: Pick<RdGuard, 'allow'> = rdGuard): (() => void) | null {
    if (!guard.allow() || this.inFlight >= this.max) return null
    this.inFlight++
    let released = false
    return () => {
      if (released) return
      released = true
      this.inFlight--
    }
  }

  get active() { return this.inFlight }
}

export const bgGate = new BackgroundGate()

// Clasifica el resultado HTTP de un salto de la cadena de resolución.
export function classifyStatus(status: number): FailureReason | null {
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 403) return 'auth'
  if (status < 200 || status >= 400) return 'http_error'
  return null
}

// Torrentio no devuelve un error HTTP cuando algo falla con la cuenta: redirige a
// un video placeholder propio (p. ej. `failed_access_v2.mp4`, `failed_rar_v2.mp4`).
// Heurística sobre el nombre — los de cuenta/acceso/premium son 'auth' (hay que
// avisar y dejar de insistir); el resto, un problema de ESE torrent.
//
// El slate de ElfHosted (MediaFusion) es SIEMPRE 'placeholder': el error es de
// la sesión de RD del servidor de ElfHosted (su IP compartida limitada o
// rechazada), no de nuestra cuenta — abrir el breaker por eso cortaría el
// tráfico que sí funciona. El mensaje viene en `?title=`; se usa como detalle.
export function classifyPlaceholder(url: string): { reason: FailureReason; file: string } {
  let file = ''
  try {
    const u = new URL(url)
    if (/(^|\.)slate\.elfhosted\.com$/i.test(u.hostname)) {
      return { reason: 'placeholder', file: `elfhosted-slate: ${u.searchParams.get('title') ?? '?'}` }
    }
    file = u.pathname.split('/').pop() ?? ''
  } catch {}
  const reason: FailureReason = /access|auth|premium|expired|token|ip|limit|traffic/i.test(file)
    ? 'auth'
    : 'placeholder'
  return { reason, file }
}

// Quita la clave de RD de cualquier texto antes de loguearlo. La key viaja en el
// path de Torrentio (`/realdebrid=<KEY>/`) y, con el proxy, dentro del query
// `destination=` ya url-encodeada.
export function redactSecrets(text: string, key = process.env.DEBRID_KEY): string {
  let out = text.replace(/realdebrid(=|%3D)[^/&%\s]+/gi, 'realdebrid$1<redacted>')
  if (key) {
    out = out.split(key).join('<redacted>').split(encodeURIComponent(key)).join('<redacted>')
  }
  return out
}

// ── Salud de la cuenta ──

export type AccountHealth = {
  ok: boolean
  type?: string          // 'premium' | 'free'
  premiumDaysLeft?: number
  expiration?: string
  warning?: string
  error?: string
}

const EXPIRY_WARN_DAYS = 7

/** Interpreta la respuesta de GET /user de RD. Pura. */
export function interpretUser(u: { type?: string; premium?: number; expiration?: string }): AccountHealth {
  const days = typeof u.premium === 'number' ? Math.floor(u.premium / 86_400) : undefined
  const h: AccountHealth = { ok: true, type: u.type, premiumDaysLeft: days, expiration: u.expiration }
  if (u.type !== 'premium' || (days !== undefined && days <= 0)) {
    h.ok = false
    h.warning = 'La cuenta NO es premium (o ya venció): toda resolución va a fallar.'
  } else if (days !== undefined && days <= EXPIRY_WARN_DAYS) {
    h.warning = `El premium vence en ${days} día(s): renovar.`
  }
  return h
}
