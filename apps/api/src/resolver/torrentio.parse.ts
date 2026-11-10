// Parseo y ranking de los streams que devuelve Torrentio.
//
// Módulo PURO a propósito: sin fetch, sin process.env, sin import de red. Toda
// la lógica de decisión (qué archivo es reproducible, cuál es mejor, cuál hay
// que descartar) vive acá para poder testearla sin tocar la red — Torrentio
// solo responde a IPs de Vercel, así que un test que dependa de él es
// imposible de correr en local o en CI.
//
// El objetivo del ranking es un iPhone reproduciendo por datos móviles, NO la
// mejor calidad absoluta. Ver scoreStream() para el detalle de cada peso.

export type TorrentioStream = {
  name?: string
  title?: string
  infoHash?: string
  fileIdx?: number
  url?: string
  behaviorHints?: { filename?: string; bingeGroup?: string }
  // Indexador de origen (torrentio | mediafusion). Metadato nuestro para
  // deduplicar y diagnosticar; no viene del addon.
  _source?: string
}

// Tres estados, NO un boolean. `null` = "no pudimos leer el marcador", que es
// muy distinto de "no está cacheado". Colapsar null→false haría que el día que
// Torrentio cambie el formato descartemos todos los candidatos y Real-Debrid
// deje de usarse por completo. Ver cacheSignalHealth().
export type CacheState = true | false | null

export type AudioTag =
  | 'latino' | 'castellano' | 'spanish'
  | 'english' | 'italian' | 'french' | 'portuguese'
  // Idiomas que casi nunca son lo que el usuario quiere oír. Existen para poder
  // reconocer un release que SOLO trae ese audio (un doblaje ruso o hindi de una
  // peli inglesa) y no dejar que pase por "no sé qué idioma es".
  | 'russian' | 'indian' | 'korean' | 'japanese' | 'chinese'
  | 'german' | 'turkish' | 'arabic' | 'polish'

// Procedencia del release. Es independiente de la resolución: un "1080p" puede
// ser una grabación de cine (CAM/PRE-HD) que se ve horrible. En estrenos
// recientes estos rips abundan y sin esto ganaban por tener buen bitrate.
export type ReleaseKind = 'cam' | 'screener' | 'hdtv' | 'web' | 'bluray' | null

export type ParsedStream = {
  raw: TorrentioStream
  filename: string
  resolution: 2160 | 1080 | 720 | 480 | null
  codec: 'av1' | 'hevc' | 'h264' | 'xvid' | null
  bitDepth: 8 | 10 | null
  hdr: 'none' | 'hdr10' | 'hdr10plus' | 'dv'
  isRemux: boolean
  isUpscale: boolean
  releaseKind: ReleaseKind
  sizeGB: number | null
  seeders: number | null
  cached: CacheState
  year: number | null
  season: number | null
  episode: number | null
  isSeasonPack: boolean
  langs: Set<AudioTag>
  resolveUrl: string | null
}

// Lo que sabemos del título por TMDB, para validar que el torrent sea el
// correcto. `title` viene localizado (la API pide es-ES) y `originalTitle` en
// el idioma original — tener los dos evita rechazar releases traducidos.
export type MediaRef = {
  type: 'movie' | 'tv'
  title: string
  originalTitle: string | null
  originalLanguage: string | null
  // Película: año de estreno. Serie: año del EPISODIO pedido, no de la serie
  // (usar el de la serie rechazaría cualquier temporada posterior a la 1).
  year: number | null
  runtimeMin: number | null
  // Otros títulos en español (Latinoamérica: "IntensaMente 2" vs "Del revés 2"
  // de España). Sin esto los releases latinos —que usan el título latino— caían
  // en el castigo de título (-80) o directamente en title-mismatch.
  altTitles?: string[]
  season?: number
  episode?: number
}

export type Rejection =
  | 'no-url' | 'not-video' | 'av1'
  | 'wrong-year' | 'wrong-season' | 'wrong-episode'
  | 'too-heavy' | 'title-mismatch'

// Capacidad de decodificación del dispositivo que pide el stream:
//  - 'high': iPhone / TV con hardware capaz → sin restricciones extra.
//  - 'low':  Fire TV Stick y similares de poca RAM → solo lo que decodifican por
//    HARDWARE (1080p H.264/HEVC-8bit). El 4K y el HEVC 10-bit caen a software y
//    revientan la memoria (el LMK de Android mata la app). Se rechazan de plano.
export type HwTier = 'low' | 'high'

// Por qué un candidato es "pobre": se ve mal o se oye en un idioma que el usuario
// no entiende. No se descarta de plano (si es lo único que hay, el selector
// manual puede ofrecerlo), pero NUNCA se reproduce solo si existe algo mejor.
export type PoorReason = 'cam' | 'screener' | 'foreign-audio'

// Preferencia de audio del usuario. 'latino' sube los releases en español;
// 'original' no toca el ranking.
export type LangPreference = 'original' | 'latino'

export type ScoredCandidate = {
  parsed: ParsedStream
  score: number
  poor: PoorReason | null
  // Desglose por término. Los tests afirman sobre términos individuales en vez
  // de sobre un total mágico, y debugTorrentio lo expone para poder ver POR QUÉ
  // ganó un archivo sin tener que reproducir el cálculo a mano.
  parts: Record<string, number>
}

// ── Parsers ─────────────────────────────────────────────────────────────────

// Torrentio marca el estado en Real-Debrid en el campo `name`, algo como
// "[RD+] Torrentio\n1080p" (cacheado) o "[RD download] ..." (habría que
// descargarlo). Aceptamos varios debrids (RD/AD/PM/...) y varios marcadores
// porque el formato exacto no está documentado y no se puede verificar sin
// desplegar. Ante cualquier duda devolvemos null en vez de adivinar.
const CACHE_RE = /\[\s*(?:RD|AD|PM|DL|OC|TB)(\+|⚡|\s*download|\s*dl)?\s*\]/i

export function parseCacheState(name?: string): CacheState {
  const text = name ?? ''
  const m = CACHE_RE.exec(text)
  if (m) {
    const marker = (m[1] ?? '').trim().toLowerCase()
    if (marker === '+' || marker === '⚡') return true
    if (marker === 'download' || marker === 'dl') return false
    // "[RD]" pelado: ambiguo — sigue evaluando otros marcadores abajo.
  }
  // MediaFusion / Comet marcan la disponibilidad instantánea (cacheada) con un
  // rayo ⚡ SUELTO, sin corchetes de debrid. Un ⚡ no aparece en un nombre de
  // release por ninguna otra razón, así que es señal fiable de cacheado. Los no
  // cacheados de esos addons no lo llevan → quedan en null (y el filtro los
  // descarta, que es justo lo que queremos). Formato a verificar vía debug.
  if (text.includes('⚡')) return true
  return null // sin marcador legible: ambiguo, no inventamos
}

// ¿Podemos confiar en la señal de cacheado del lote?
//  - 'absent':  no se parseó ni un marcador → Torrentio cambió el formato
//  - 'uniform': todos idénticos → la señal no discrimina, no filtra nada
//  - 'ok':      hay mezcla → se puede filtrar con confianza
// El caller usa esto para degradar en vez de quedarse sin candidatos.
export function cacheSignalHealth(parsed: ParsedStream[]): 'ok' | 'absent' | 'uniform' {
  const known = parsed.filter((p) => p.cached !== null)
  if (known.length === 0) return 'absent'
  const anyTrue = known.some((p) => p.cached === true)
  const anyFalse = known.some((p) => p.cached === false)
  return anyTrue && anyFalse ? 'ok' : 'uniform'
}

// Un año suelto en un nombre de archivo es traicionero: "Blade Runner 2049",
// "1917", "2012" son TÍTULOS que parecen años. Por eso exigimos delimitadores,
// preferimos el que está entre paréntesis, y si hay varios candidatos nos
// quedamos con el ÚLTIMO (el título va primero, el año del release después).
// El cierre va por lookahead y admite coma: los packs rusos/ucranianos escriben
// "[1978, BDRemux 1080p]", y exigir ")"/"]" pegado dejaba ese año sin parsear —
// con lo cual rejectionOf no podía descartar la peli equivocada (un Superman
// del 78 competía contra el de 2025).
const YEAR_PAREN_RE = /[([](19\d{2}|20\d{2})(?=[)\],;])/g
const YEAR_LOOSE_RE = /(?:^|[.\s_\-])(19\d{2}|20\d{2})(?=$|[.\s_\-])/g

export function parseYear(text: string, now = new Date()): number | null {
  const maxYear = now.getFullYear() + 1
  const pick = (re: RegExp): number | null => {
    let last: number | null = null
    for (const m of text.matchAll(re)) {
      const y = Number(m[1])
      if (y >= 1900 && y <= maxYear) last = y
    }
    return last
  }
  return pick(YEAR_PAREN_RE) ?? pick(YEAR_LOOSE_RE)
}

// Los season packs ("S05.COMPLETE") suelen ser las fuentes mejor sembradas y
// más veces cacheadas: devuelven episode:null y Torrentio resuelve el episodio
// concreto vía fileIdx. Rechazarlos por "no coincide el episodio" sería tirar
// las mejores fuentes de series.
const SXXEYY_RE = /\bS(\d{1,2})[\s._-]?E(\d{1,3})\b/i
const NXNN_RE = /\b(\d{1,2})x(\d{2,3})\b/i
const SEASON_ONLY_RE = /\b(?:S(\d{1,2})\b(?![\s._-]?E)|Season[\s._-]?(\d{1,2})\b)/i

export function parseEpisodeTag(
  text: string
): { season: number | null; episode: number | null; isSeasonPack: boolean } {
  const se = SXXEYY_RE.exec(text) ?? NXNN_RE.exec(text)
  if (se) return { season: Number(se[1]), episode: Number(se[2]), isSeasonPack: false }
  const s = SEASON_ONLY_RE.exec(text)
  if (s) return { season: Number(s[1] ?? s[2]), episode: null, isSeasonPack: true }
  return { season: null, episode: null, isSeasonPack: false }
}

// Torrentio pone el tamaño en `title`, tipo "👤 45 💾 1.4 GB ⚙️ TPB".
// Acepta MB además de GB — un rip de 850 MB antes no matcheaba y quedaba sin
// puntuar ni penalizar.
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(GB|MB)\b/i
const SEEDERS_RE = /👤\s*(\d+)/

export function parseSize(text: string): number | null {
  const m = SIZE_RE.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return m[2].toUpperCase() === 'MB' ? n / 1024 : n
}

export function parseSeeders(text: string): number | null {
  const m = SEEDERS_RE.exec(text)
  return m ? Number(m[1]) : null
}

// Idioma del audio. Dos fuentes: tokens en el nombre y emoji de bandera (que
// Torrentio deriva de las pistas reales del torrent, así que son más fiables
// que el texto).
//
// Latino y castellano se mantienen SEPARADOS a propósito: son doblajes
// distintos y los grupos los taggean aparte justamente para diferenciarlos.
// Tratarlos como sinónimos hacía que pidiendo latino cayera un castellano.
//
// Los \b son obligatorios: sin ellos "TRANSLATED" y "Platinum" matchean "lat".
const LANG_PATTERNS: [AudioTag, RegExp][] = [
  ['latino', /\b(?:latino|latinoamerican[oa]|latin|latam|lat|esp[\s._-]?lat|spa[\s._-]?lat|dual[\s._-]?lat|audio[\s._-]?lat(?:ino)?|doblad[oa]|doblaje|es[\s._-]?419)\b|🇲🇽|🇦🇷|🇨🇴|🇨🇱|🇵🇪|🇻🇪|🇪🇨|🇧🇴|🇩🇴|🇺🇾|🇵🇾|🇬🇹/i],
  // Trackers de ESPAÑA: sus releases son castellano aunque sólo digan "[Esp]"
  // (caso real: "Del reves 2 … [Esp](wolfmax4k.com)" contaba como español
  // ambiguo y le ganaba al latino).
  ['castellano', /\b(?:castellano|cast|wolfmax4k|mejortorrent|dontorrent|divxtotal|elitetorrent|grantorrent|pctfenix|pctmix|atomohd)\b|🇪🇸/i],
  ['spanish', /\b(?:spanish|espanol|español|spa|esp)\b/i],
  ['english', /\b(?:english|eng|ing)\b|🇬🇧|🇺🇸/i],
  ['italian', /\b(?:italian|ita)\b|🇮🇹/i],
  ['french', /\b(?:french|fre|fra|vff|vostfr)\b|🇫🇷/i],
  ['portuguese', /\b(?:portuguese|por|pt[\s._-]?br|dublado)\b|🇧🇷|🇵🇹/i],
  // Cirílico = release ruso/ucraniano aunque no diga "Rus". Los packs de esos
  // trackers aparecen seguido entre los resultados.
  ['russian', /\b(?:russian|rus|mvo|dvo|lostfilm)\b|🇷🇺|[\u0400-\u04FF]/i],
  ['indian', /\b(?:hindi|tamil|telugu|malayalam|kannada|bengali|punjabi|marathi|bollywood)\b|🇮🇳/i],
  ['korean', /\b(?:korean|kor)\b|🇰🇷/i],
  ['japanese', /\b(?:japanese|jpn)\b|🇯🇵/i],
  ['chinese', /\b(?:chinese|mandarin|cantonese)\b|🇨🇳|🇭🇰|🇹🇼/i],
  ['german', /\b(?:german|ger|deu)\b|🇩🇪/i],
  ['turkish', /\b(?:turkish)\b|🇹🇷/i],
  ['arabic', /\b(?:arabic)\b|🇸🇦|🇪🇬/i],
  ['polish', /\b(?:polish|lektor)\b|🇵🇱/i],
]

export function parseLangs(text: string): Set<AudioTag> {
  const out = new Set<AudioTag>()
  for (const [tag, re] of LANG_PATTERNS) if (re.test(text)) out.add(tag)
  // "Latino"/"Castellano" implican español sin decirlo con esa palabra.
  if (out.has('latino') || out.has('castellano')) out.add('spanish')
  return out
}

// Lista NEGRA, no blanca: se rechaza solo ante evidencia POSITIVA de que no es
// video (un .rar, un .iso). Con lista blanca se caían ~10% de candidatos por
// título, porque Torrentio a veces no da `behaviorHints.filename` y la primera
// línea de `title` es un nombre de display sin extensión — un torrent perfecto
// que descartábamos por no poder leerle la extensión.
const NON_VIDEO_EXT_RE = /\.(?:rar|zip|7z|iso|exe|nfo|txt|srt|sub|idx|jpe?g|png)$/i

// Grabaciones de sala y pre-estrenos: se ven mal a cualquier resolución.
const CAM_RE = /\b(?:cam|hdcam|hqcam|hq[\s._-]?cam|camrip|cam[\s._-]?rip|hdts|hd[\s._-]?ts|telesync|telecine|hdtc|tc|pre[\s._-]?hd|pre[\s._-]?dvd)\b/i
const SCREENER_RE = /\b(?:scr|screener|dvdscr|r5)\b/i

// "TS" a secas SÍ se usa, pero solo tras sacar las extensiones de contenedor.
// El \b ya lo separa de "DTS" (la D pega con la T y no hay borde), así que la
// única colisión real era el archivo ".ts" — y esa se resuelve quitando la
// extensión antes de mirar. Sin esto, un telesync como
// "Superman.2025.1080p.TS.READNFO.x264-AOC.mkv" pasaba por release limpio y
// rankeaba entre los tres primeros.
const CONTAINER_EXT_RE = /\.(?:mkv|mp4|avi|ts|m2ts|mov|wmv|flv|webm|mpg|mpeg)(?=\s|$)/gi
const TS_RE = /\bts\b/i

function parseReleaseKind(text: string): ReleaseKind {
  if (CAM_RE.test(text) || TS_RE.test(text.replace(CONTAINER_EXT_RE, ''))) return 'cam'
  if (SCREENER_RE.test(text)) return 'screener'
  if (/\b(?:blu[\s._-]?ray|bdrip|brrip|bdremux|remux|bdmux)\b/i.test(text)) return 'bluray'
  if (/\b(?:web[\s._-]?dl|web[\s._-]?rip|webrip|amzn|nf|dsnp|web)\b/i.test(text)) return 'web'
  if (/\bhdtv\b/i.test(text)) return 'hdtv'
  return null
}

export function parseStream(s: TorrentioStream): ParsedStream {
  // Torrentio omite behaviorHints.filename en algunos torrents de archivo
  // único; ahí la primera línea de `title` ES el nombre del archivo. Sin este
  // fallback esos candidatos se descartaban en silencio.
  const filename = s.behaviorHints?.filename?.trim() || (s.title ?? '').split('\n')[0].trim()
  const text = `${s.title ?? ''} ${filename}`
  const ep = parseEpisodeTag(text)

  const hdr: ParsedStream['hdr'] =
    /\bdolby[\s._-]?vision\b|\bdv\b/i.test(text) ? 'dv'
    : /\bhdr10\+|\bhdr10plus\b/i.test(text) ? 'hdr10plus'
    : /\bhdr\b|\bhdr10\b|\bpq\b/i.test(text) ? 'hdr10'
    : 'none'

  const codec: ParsedStream['codec'] =
    /\bav1\b/i.test(text) ? 'av1'
    : /\b(?:x265|h\.?265|hevc)\b/i.test(text) ? 'hevc'
    : /\b(?:x264|h\.?264|avc)\b/i.test(text) ? 'h264'
    : /\b(?:xvid|divx)\b/i.test(text) ? 'xvid'
    : null

  // Lookarounds de dígito en vez de \b: los grupos pegan los tokens sin
  // separador ("4Kreescalado2160") y con \b no se detectaba nada. Excluir solo
  // dígitos adyacentes evita además confundir "H265" o "x264" con una
  // resolución, y deja pasar "1920x1080".
  const resolution: ParsedStream['resolution'] =
    /(?<!\d)2160(?!\d)|(?<![a-z0-9])4k|(?<![a-z0-9])uhd(?![a-z])/i.test(text) ? 2160
    : /(?<!\d)1080(?!\d)/i.test(text) ? 1080
    : /(?<!\d)720(?!\d)/i.test(text) ? 720
    : /(?<!\d)480(?!\d)/i.test(text) ? 480
    : null

  return {
    raw: s,
    filename,
    resolution,
    codec,
    bitDepth: /\b10[\s._-]?bits?\b/i.test(text) ? 10 : /\b8[\s._-]?bits?\b/i.test(text) ? 8 : null,
    hdr,
    // "BDRemux"/"UHDRemux" van pegados y \bremux\b no los ve (entre la D y la R
    // no hay borde de palabra). Era una clase entera de archivos —los más
    // pesados y los más lentos en empezar a bufferear— esquivando la
    // penalización de remux por completo.
    isRemux: /\bremux\b|\b(?:bd|br|uhd|dvd)[\s._-]?remux\b/i.test(text),
    releaseKind: parseReleaseKind(text),
    // "4Kreescalado", "upscaled": 4K falso hecho a partir de un 1080p. Pesa
    // como 4K y no aporta nada de calidad.
    isUpscale: /reescalad|upscal|re[\s._-]?scaled/i.test(text),
    sizeGB: parseSize(text),
    seeders: parseSeeders(text),
    cached: parseCacheState(s.name),
    year: parseYear(text),
    season: ep.season,
    episode: ep.episode,
    isSeasonPack: ep.isSeasonPack,
    langs: parseLangs(text),
    resolveUrl: s.url ?? null,
  }
}

// ── Rechazos duros ──────────────────────────────────────────────────────────

// Normaliza para comparar títulos: sin acentos, sin puntuación, minúsculas.
function normalizeTitle(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function titleOverlap(filename: string, m: MediaRef): number {
  const hay = ' ' + normalizeTitle(filename) + ' '
  const score = (title: string): number => {
    // Palabras de 3+ letras: las cortas ("de", "la", "el") dan falsos positivos.
    const words = normalizeTitle(title).split(' ').filter((w) => w.length >= 3)
    if (!words.length) return 1 // título impossible de tokenizar → no penalizar
    const hits = words.filter((w) => hay.includes(` ${w} `)).length
    return hits / words.length
  }
  return Math.max(
    score(m.title),
    m.originalTitle ? score(m.originalTitle) : 0,
    ...(m.altTitles ?? []).map(score),
  )
}

// SOLO descartes categóricos: contenido equivocado o imposible de reproducir.
// Todo lo demás (calidad, tamaño, idioma) es preferencia y va al score.
export function rejectionOf(p: ParsedStream, m: MediaRef, hwTier: HwTier = 'high'): Rejection | null {
  if (!p.resolveUrl) return 'no-url'
  if (NON_VIDEO_EXT_RE.test(p.filename)) return 'not-video'

  // AV1 no tiene decodificación por hardware en iPhone salvo A17 Pro y
  // posteriores; por software un 4K AV1 es imposible en un teléfono. Reproduce
  // negro o directamente falla, así que no es una preferencia: es inservible.
  if (p.codec === 'av1') return 'av1'

  // Dispositivo de poca RAM (Fire TV Stick): lo que no decodifica por HARDWARE
  // cae a software y lo mata por OOM. El 4K y el HEVC 10-bit son los culpables —
  // se descartan para que solo le llegue 1080p H.264/HEVC-8bit reproducible.
  if (hwTier === 'low') {
    if (p.resolution === 2160) return 'too-heavy'
    if (p.codec === 'hevc' && p.bitDepth === 10) return 'too-heavy'
  }

  if (m.type === 'tv') {
    // Nada de validar año en series: el año del archivo es el de emisión del
    // episodio, que en temporadas tardías difiere años del de la serie.
    if (m.season != null && p.season != null && p.season !== m.season) return 'wrong-season'
    // Los season packs delegan el episodio a fileIdx → no se valida.
    if (m.episode != null && p.episode != null && !p.isSeasonPack && p.episode !== m.episode) {
      return 'wrong-episode'
    }
    return null
  }

  // Película: el año es la señal fiable de "esta es otra peli". Solo se rechaza
  // si el archivo TIENE año parseable y no coincide — muchos releases legítimos
  // no traen año (p.ej. "El club de la Lucha 4Kreescalado2160.mkv").
  if (m.year != null && p.year != null && Math.abs(p.year - m.year) > 1) return 'wrong-year'
  // Sin año en el archivo, el título es lo ÚNICO que ata este release a la peli
  // pedida. Si no comparte ni una palabra (ni del título localizado ni del
  // original), no hay nada que diga que sea la misma película: se descarta.
  if (p.year == null && titleOverlap(p.filename, m) === 0) return 'title-mismatch'
  return null
}

// ── Score ───────────────────────────────────────────────────────────────────

export function bitrateMbps(sizeGB: number | null, runtimeMin: number | null): number | null {
  if (sizeGB == null || !runtimeMin) return null
  return (sizeGB * 8192) / (runtimeMin * 60)
}

// Penalización de DECODIFICACIÓN: es un término de interacción, no la suma de
// penalizar resolución y códec por separado. 1080p HEVC 10-bit va perfecto en
// cualquier iPhone; 2160p HEVC 10-bit en MKV no, porque VLCKit no rutea de
// forma confiable HEVC-en-MKV por VideoToolbox y por software se cae a pedazos.
// Modelarlo aditivo haría que 2160p-HEVC-10bit le gane a 1080p-x264 con solo
// desafinar un poco el peso de la resolución.
export function decodePenalty(
  resolution: ParsedStream['resolution'],
  codec: ParsedStream['codec'],
  bitDepth: ParsedStream['bitDepth']
): number {
  if (resolution !== 2160) return codec === 'hevc' && bitDepth === 10 ? -2 : 0
  if (codec === 'hevc') return bitDepth === 10 ? -45 : -30
  if (codec === 'h264') return -20 // 4K x264 = bitrate altísimo
  return -35
}

// El idioma es una preferencia OPCIONAL (`prefer`) y por defecto no toca nada. Solo
// cuando el usuario pide español se suma un bonus moderado: los candidatos ya son
// todos cacheados, así que elegir entre ellos por idioma no cuesta velocidad. Los
// castigos de calidad (cam, upscale, remux, audio ajeno) son mayores que el bonus,
// de modo que "latino" nunca justifica un archivo malo.
export function scoreStream(
  p: ParsedStream,
  m: MediaRef,
  hwTier: HwTier = 'high',
  prefer: LangPreference = 'original',
): ScoredCandidate {
  const parts: Record<string, number> = {}

  // Ya cacheado en Real-Debrid = arranca al instante. Peso alto pero no
  // infinito: el filtro duro de cacheados vive aparte (ver rankCandidates).
  parts.cached = p.cached === true ? 120 : 0

  // NO hay bonus por español. Antes se sumaban puntos a los releases latinos y
  // eso desviaba la elección: el objetivo es la fuente que arranque más rápido
  // con la mejor calidad, y el idioma se resuelve DESPUÉS — el reproductor ya
  // auto-selecciona la pista de audio en español cuando el archivo la trae, y
  // los subtítulos van aparte. Elegir un archivo peor "porque dice Latino" era
  // pagar velocidad y calidad por algo que casi siempre se consigue igual.
  //
  // Lo que SÍ se conserva es el castigo a un doblaje ajeno al idioma original
  // (el caso "Superman 2160p iTA EnG", donde ganaba un release italiano). Eso
  // no es preferencia de idioma: un doblaje al italiano de una película inglesa
  // es peor material de partida, sin importar qué idioma quiera el usuario.
  const orig = m.originalLanguage
  const tagFor: Record<string, AudioTag> = {
    en: 'english', it: 'italian', fr: 'french', pt: 'portuguese', es: 'spanish',
    ru: 'russian', hi: 'indian', ta: 'indian', te: 'indian', ml: 'indian', kn: 'indian', bn: 'indian',
    ko: 'korean', ja: 'japanese', zh: 'chinese', cn: 'chinese', de: 'german', tr: 'turkish', ar: 'arabic', pl: 'polish',
  }
  const wanted = orig ? tagFor[orig] : undefined
  // Un release que además trae español (dual/multi) NO se castiga: sigue
  // teniendo el audio original adentro.
  // Pidiendo español, un doblaje al español TAMBIÉN es lo buscado: no se castiga
  // por "pisar el original" (lo haría perder justo contra el audio que no pidió).
  const wantsSpanish = prefer === 'latino' && (p.langs.has('latino') || p.langs.has('spanish') || p.langs.has('castellano'))
  const keepsOriginal = !wanted || p.langs.size === 0 || p.langs.has(wanted) || wantsSpanish
  parts.lang = keepsOriginal ? 0 : -60

  // Título: penalización, NUNCA rechazo. Los releases usan abreviaturas y
  // títulos traducidos, así que un solapamiento bajo es sospecha, no certeza.
  // Solapamiento parcial también es sospecha (p. ej. "Superman" dentro de
  // "Superman II"), pero más leve que un cero rotundo.
  const overlap = titleOverlap(p.filename, m)
  parts.title = overlap === 0 ? -80 : overlap < 0.5 ? -40 : 0

  // Preferencia de idioma. SOLO cuando el usuario pidió español: los candidatos
  // ya son todos cacheados (arrancan igual de rápido), así que elegir entre
  // ellos por idioma no cuesta velocidad.
  //
  // Pesos (antes 35/30/12): con 35 un latino 1080p de bitrate medio (-25) perdía
  // contra un multi-idioma CASTELLANO liviano (+12 +15) — caso real House of the
  // Dragon S01E01: había 5 latinos cacheados y ganaba el castellano, y como el
  // player auto-elige la pista "Español", el usuario oía castellano habiendo
  // pedido latino. Ahora un latino explícito le gana a cualquier no-latino de
  // calidad razonable; el castellano casi no suma (no es lo que se pidió).
  // Siguen sin rescatar un latino MALO: cam/screener se filtran aparte, y un 4K
  // reescalado o un remux 4K acumulan castigos mayores que el bonus.
  if (prefer === 'latino') {
    parts.langPref =
      p.langs.has('latino') ? 80
      : p.langs.has('spanish') && !p.langs.has('castellano') ? 45
      : p.langs.has('castellano') ? 10
      : 0
  }

  // Resolución invertida respecto de lo habitual: el objetivo es un teléfono
  // por datos móviles, donde 1080p es el punto dulce y 4K es un lastre.
  parts.resolution =
    p.resolution === 1080 ? 40
    : p.resolution === 720 ? 25
    : p.resolution === 2160 ? 10
    : p.resolution === 480 ? 5
    : 5

  parts.decode = decodePenalty(p.resolution, p.codec, p.bitDepth)

  // HDR penaliza porque el player usa VLCKit para estas fuentes (ver
  // `isVlcSource` en apps/client/app/player.tsx) y VLCKit no hace tone mapping
  // de PQ en iOS: el HDR10 se ve lavado y Dolby Vision perfil 5 peor todavía
  // (no tiene capa base compatible con HDR10). Con AVPlayer esto NO aplicaría.
  parts.hdr = p.hdr === 'dv' ? -25 : p.hdr === 'hdr10plus' ? -15 : p.hdr === 'hdr10' ? -12 : 0

  parts.upscale = p.isUpscale ? -60 : 0
  parts.remux = p.isRemux ? -40 : 0

  // Procedencia. Un CAM/PRE-HD "1080p" con buen bitrate se colaba al tope
  // (caso real: un "HQ PRE-HD" ganaba en Superman 2025) porque ningún otro
  // término mira de dónde salió la copia.
  parts.release =
    p.releaseKind === 'cam' ? -120
    : p.releaseKind === 'screener' ? -90
    : p.releaseKind === 'hdtv' ? -10
    : 0

  // Bitrate, no tamaño: 20 GB en 90 min (~30 Mbps) y 20 GB en 3 h (~15 Mbps)
  // son cosas muy distintas para una conexión móvil.
  const br = bitrateMbps(p.sizeGB, m.runtimeMin)
  if (br != null) {
    parts.bitrate = br <= 4 ? 15 : br <= 8 ? 0 : br <= 15 ? -25 : -50
  } else if (p.sizeGB != null) {
    parts.bitrate = p.sizeGB > 20 ? -40 : p.sizeGB > 10 ? -20 : p.sizeGB > 6 ? -8 : 5
  } else {
    // Peso desconocido: prior negativo, no neutro. MediaFusion no publica el
    // tamaño en el texto, así que sus candidatos salían con bitrate 0 — o sea
    // EMPATANDO con un archivo medido y liviano y GANÁNDOLE a un WEB-DL 1080p
    // honesto de 8-15 Mbps (-25). Sus remuxes flotaban al tope por no poder
    // medirlos. -12 los deja debajo de lo medido-bueno y encima de lo medido-pesado.
    parts.bitrate = -12
  }

  parts.seeders = p.seeders ? Math.min(10, Math.log2(p.seeders + 1)) : 0

  // Arranque rápido en dispositivos flojos (Fire TV): un remux/archivo enorme
  // tarda MUCHO más en empezar a bufferear que un WEB-DL 1080p liviano — y sobre
  // datos/CPU limitados eso es la diferencia entre arrancar al toque o esperar.
  // Solo se añade el término en 'low' (en 'high' ni existe la clave → el scoring
  // y sus tests quedan idénticos). Es preferencia, nunca rechazo: si lo único
  // cacheado es un remux, igual se sirve.
  if (hwTier === 'low') {
    parts.fastStart =
      (p.releaseKind === 'web' ? 8 : 0) +
      (p.isRemux ? -20 : 0) +
      (p.sizeGB != null && p.sizeGB > 8 ? -15 : 0)
  }

  // ¿Es un candidato pobre? Solo audio ajeno: si el release trae el original,
  // español o inglés (aunque sea además de otro), no lo es.
  const acceptable = new Set<AudioTag>(['english', 'spanish', 'latino', 'castellano'])
  if (wanted) acceptable.add(wanted)
  const foreignOnly = p.langs.size > 0 && [...p.langs].every((t) => !acceptable.has(t))
  if (foreignOnly) parts.foreignAudio = -80

  const poor: PoorReason | null =
    p.releaseKind === 'cam' ? 'cam'
    : p.releaseKind === 'screener' ? 'screener'
    : foreignOnly ? 'foreign-audio'
    : null

  const score = Object.values(parts).reduce((a, b) => a + b, 0)
  return { parsed: p, score, parts, poor }
}

// ── Ranking ─────────────────────────────────────────────────────────────────

export type RankResult = {
  ranked: ScoredCandidate[]
  rejected: { label: string; reason: Rejection }[]
  hasLatinoAlternative: boolean
  cacheSignal: 'ok' | 'absent' | 'uniform'
  cacheCounts: { cached: number; uncached: number; unknown: number }
}

export function rankCandidates(
  streams: TorrentioStream[],
  m: MediaRef,
  hwTier: HwTier = 'high',
  prefer: LangPreference = 'original'
): RankResult {
  const parsed = streams.map(parseStream)
  const rejected: { label: string; reason: Rejection }[] = []
  const kept: ParsedStream[] = []

  for (const p of parsed) {
    const reason = rejectionOf(p, m, hwTier)
    if (reason) rejected.push({ label: p.filename || '(sin nombre)', reason })
    else kept.push(p)
  }

  // Se calcula sobre los SUPERVIVIENTES (no sobre los crudos): así no le
  // ofrecemos al usuario "cambiar a latino" si la única opción latina era un
  // AV1 que igual no iba a reproducir. Pero sí se lo ofrecemos cuando existe y
  // simplemente puntuó bajo.
  // Cuenta latino explícito y "Español" ambiguo (probable latino), no castellano:
  // el botón "cambiar a latino" del cliente debe aparecer también cuando hay un
  // release en español sin la palabra "Latino" (que antes quedaba invisible).
  const hasLatinoAlternative = kept.some(
    (p) => p.langs.has('latino') || (p.langs.has('spanish') && !p.langs.has('castellano'))
  )

  const cacheSignal = cacheSignalHealth(kept)
  const cacheCounts = {
    cached: kept.filter((p) => p.cached === true).length,
    uncached: kept.filter((p) => p.cached === false).length,
    unknown: kept.filter((p) => p.cached === null).length,
  }

  const ranked = kept
    .map((p) => scoreStream(p, m, hwTier, prefer))
    .sort((a, b) => b.score - a.score)

  return { ranked, rejected, hasLatinoAlternative, cacheSignal, cacheCounts }
}

// Filtro de cacheados, con degradación segura.
//
// Resolver un torrent NO cacheado le ordena a Real-Debrid empezar a
// descargarlo: consume la cuota del usuario y le llena la librería. Y como
// prewarmTitle dispara un resolve en cada press-in de póster, navegar el home
// bastaría para ensuciar la cuenta. Por eso los no cacheados no se tocan.
//
// La degradación se dispara SOLO con 'absent' (no se pudo leer ni un marcador,
// o sea Torrentio cambió el formato): ahí filtrar dejaría cero candidatos y
// Real-Debrid quedaría inutilizado en silencio, así que preferimos el
// comportamiento previo y un log fuerte.
//
// 'uniform' NO degrada: que todos los supervivientes sean no-cacheados es una
// respuesta legible y legítima, no una señal rota. Devolver la lista completa
// ahí sería correr justamente los torrents que no queremos tocar. Con cero
// cacheados devolvemos vacío → el caller da null → scrape() cae a los scrapers.
export function selectRunnable(r: RankResult): ScoredCandidate[] {
  const pool = r.cacheSignal === 'absent' ? r.ranked : r.ranked.filter((c) => c.parsed.cached === true)
  // Si existe AL MENOS un candidato decente, los pobres (copias de cine, audio
  // ajeno) ni se listan: ofrecer una grabación de sala cuando hay un BluRay es
  // ruido. Si solo quedan pobres, se conservan para que el selector manual pueda
  // mostrarlos con su etiqueta — pero ver autoPlayable().
  return pool.some((c) => !c.poor) ? pool.filter((c) => !c.poor) : pool
}

// Orden para DESCARGAR, no para ver en streaming. En streaming gana la mejor
// calidad con arranque rápido; para bajar un archivo entero al teléfono manda el
// peso: un remux o un 4K de 15 GB tarda una eternidad, se corta más y llena el
// disco, y en una pantalla de teléfono un 1080p de 2-4 GB se ve igual. Parte del
// score normal (que ya filtra lo pobre y lo roto) y le resta peso.
export function rankForDownload(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const adjusted = (c: ScoredCandidate): number => {
    const { sizeGB, resolution } = c.parsed
    const sizePenalty = sizeGB != null ? Math.min(70, sizeGB * 8) : 15 // peso desconocido: prior negativo
    const resPenalty = resolution === 2160 ? 40 : 0
    return c.score - sizePenalty - resPenalty
  }
  return [...candidates].sort((a, b) => adjusted(b) - adjusted(a))
}

// Lo que el resolver puede reproducir SOLO, sin que el usuario lo elija. Nunca
// incluye candidatos pobres: es preferible caer a los scrapers (que pueden tener
// una copia buena) a arrancar una grabación de cine o un doblaje ruso sin avisar.
export function autoPlayable(runnable: ScoredCandidate[]): ScoredCandidate[] {
  return runnable.filter((c) => !c.poor)
}
