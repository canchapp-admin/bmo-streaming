import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ActivityIndicator,
  Animated, Easing, Pressable, ScrollView, useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native'
import { Image } from 'expo-image'
// expo-file-system v19 (SDK 54) movió esta API a /legacy; la nueva es File/Directory.
import * as FileSystem from 'expo-file-system/legacy'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEventListener } from 'expo'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import Slider from '@react-native-community/slider'
import * as ScreenOrientation from 'expo-screen-orientation'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stream, type AudioLang, type Subtitle, type SourceOption } from '@/lib/stream'
// Persistir estilo/sincronía ya no se hace acá: lo maneja useSubtitlePrefs.
// De este módulo solo quedan los mapas que traducen la preferencia a estilos RN.
import {
  SUBTITLE_FONT_SIZE, SUBTITLE_COLOR_CSS,
  SUBTITLE_OUTLINE, SUBTITLE_POSITION_BOTTOM, SUBTITLE_OPACITY_VALUE,
} from '@/lib/subtitleStyle'
import { decodeSrtBytes, parseSrt, findActiveCue, type SrtCue } from '@/lib/srt'
import { getProgress, setUpNext, type Progress } from '@/lib/library'
// Guardado de progreso y helpers compartidos con apps/tv (headless).
import {
  usePlaybackSource, useProgressSaver, useSpanishSubs, useSubtitlePrefs,
  describeSource, describePlaybackError, audioLangLabel, fmt,
  type SpanishSubsFetcher,
} from '@bmo/player'
import { backdropUrl, tmdb } from '@/lib/tmdb'
import { getLocalPath, smartDownloadNext } from '@/lib/download'
import { Touchable } from '@/components/Touchable'
import { Glass } from '@/components/Glass'
import { GlassButton } from '@/components/GlassButton'
import { Scrubber } from '@/components/player/Scrubber'
import { AirPlayButton, isAirPlayConnected } from '@/modules/airplay'
import VideoVLC from '@/vendor/react-native-video-vlc/src/VideoVLC'
import type {
  VideoVLCRef,
  OnLoadData, OnProgressData, OnVideoErrorData, OnBufferData,
} from '@/vendor/react-native-video-vlc/src'
import { colors } from '@/lib/theme'

const COUNTDOWN_S = 8
const FINISHED_RATIO = 0.9 // visto "completo" → ofrecer siguiente episodio
const NEXT_PILL_S = 50      // segundos finales en que aparece el pill "Siguiente"

// Descarga el subtítulo en español a disco (caché), lo parsea y devuelve las
// cues listas para renderizar como overlay en JS — no va a VLCKit: el estilo
// (tamaño/color/fondo) tiene que poder cambiar al instante, y las opciones de
// subtítulo de libvlc son de instancia (recrear el player entero, con re-buffer
// de red incluido, cada vez que el usuario toca "Grande"). Se baja DESDE EL
// TELÉFONO (no el servidor, cuya IP de datacenter bloquea Cloudflare en
// dl.opensubtitles.org). Corre en paralelo DESPUÉS de montar el player (no
// bloquea el arranque del video) — el overlay JS solo recoge las cues cuando
// llegan, sin ninguna carrera con el montaje nativo.
// Además de las cues devuelve un DIAGNÓSTICO legible de por qué no hay
// subtítulo, que el menú muestra en pantalla. Antes esto solo iba a console.log,
// o sea que para saber por qué faltaba el español había que tener el teléfono
// enchufado a Metro — imposible de averiguar para quien solo usa la app.
export type SubsOutcome = { cues: SrtCue[]; diagnosis: string }

async function downloadSpanishSubs(
  subs: Subtitle[], type: string, id: string, season?: number, episode?: number,
): Promise<SubsOutcome> {
  const esSubs = subs.filter((s) => s.lang === 'es')
  if (!esSubs.length) {
    console.log('[subs] sin candidatos en español')
    return { cues: [], diagnosis: 'La fuente no ofreció ningún subtítulo en español.' }
  }
  const dir = `${FileSystem.cacheDirectory}subs/`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  console.log(`[subs] ${esSubs.length} candidato(s) español para ${type}/${id} T${season}:E${episode}`)

  // Se queda con el motivo del ÚLTIMO intento fallido: es el más informativo
  // porque los candidatos se prueban en orden de preferencia.
  let lastFailure = 'Ningún candidato en español se pudo descargar.'

  for (const s of esSubs) {
    const localPath = `${dir}${type}-${id}-${season ?? 0}-${episode ?? 0}-${s.i}.srt`
    // No confiar solo en "existe": una descarga vieja/interrumpida puede haber
    // dejado un archivo chico/corrupto, y quedaría cacheado para siempre.
    const cached = await FileSystem.getInfoAsync(localPath, { size: true })
    if (cached.exists && cached.size > 200) {
      console.log(`[subs] caché (${cached.size}b): ${localPath}`)
      const cues = await readAndParseSrt(localPath)
      if (cues.length) return { cues, diagnosis: '' }
      await FileSystem.deleteAsync(localPath, { idempotent: true })
    } else if (cached.exists) {
      await FileSystem.deleteAsync(localPath, { idempotent: true })
    }
    for (const url of [s.url, ...s.altUrls]) {
      try {
        const dl = await FileSystem.downloadAsync(url, localPath)
        console.log(`[subs] GET ${url} → ${dl.status}`)
        if (dl.status !== 200) {
          lastFailure = `El servidor de subtítulos respondió ${dl.status}.`
          continue
        }
        // Un .srt real nunca es text/html; una página de bloqueo de Cloudflare sí.
        const ct = Object.entries(dl.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
        if (/text\/html/i.test(ct)) {
          console.log(`[subs] content-type=${ct} → bloqueo, descarto`)
          lastFailure = 'El host devolvió una página en vez del archivo (cuota de OpenSubtitles agotada o bloqueo).'
          await FileSystem.deleteAsync(localPath, { idempotent: true })
          continue
        }
        const cues = await readAndParseSrt(localPath)
        console.log(`[subs] OK: ${cues.length} cues parseadas de ${localPath}`)
        if (cues.length) return { cues, diagnosis: '' }
        lastFailure = 'El archivo se descargó pero no se pudo interpretar como subtítulo.'
        await FileSystem.deleteAsync(localPath, { idempotent: true })
      } catch (e) {
        console.log(`[subs] excepción ${url}: ${String(e)}`)
        lastFailure = `La descarga falló: ${String((e as Error)?.message ?? e).slice(0, 90)}`
      }
    }
  }
  console.log('[subs] ningún candidato dio cues válidas')
  return { cues: [], diagnosis: lastFailure }
}

// Lee el archivo como base64 (a salvo de encoding: no interpreta bytes) y
// decodifica/parsea. Un .srt con 0 cues parseadas normalmente es contenido
// basura (encoding roto, formato inesperado) — se trata como fallo.
async function readAndParseSrt(localPath: string): Promise<SrtCue[]> {
  const b64 = await FileSystem.readAsStringAsync(localPath, { encoding: FileSystem.EncodingType.Base64 })
  const binary = atob(b64)
  const text = decodeSrtBytes(binary)
  return parseSrt(text)
}

export default function PlayerScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    type: string; id: string; season?: string; episode?: string
    title?: string; poster?: string; backdrop?: string; episodeTitle?: string
    localPath?: string   // si viene con ruta local, reproducir sin resolver
  }>()
  const { type, id, season, episode, title } = params
  const isTv = type === 'tv'
  const seasonN = season ? Number(season) : undefined
  // El episodio es estado interno → cambiar de episodio NO renavega (transición fluida)
  const [episodeN, setEpisodeN] = useState(episode ? Number(episode) : undefined)

  const [showNext, setShowNext] = useState(false)

  // ── Descarga local ──
  // Si el título está descargado se reproduce el archivo y NO se resuelve nada
  // contra el API. Hay que saberlo ANTES de dejar resolver: si no, se dispara un
  // resolve remoto que después se descarta.
  //
  // El resultado se guarda junto a la clave del episodio al que pertenece y solo
  // se acepta si esa clave sigue siendo la actual. Sin eso, al pasar de un
  // episodio descargado a uno que no lo está, el `localUri` viejo seguía vigente
  // durante unos renders y se reproducía el episodio equivocado.
  const localKey = `${id}-${isTv ? 'tv' : 'movie'}-${seasonN ?? 0}-${episodeN ?? 0}`
  const [localFound, setLocalFound] = useState<{ key: string; uri: string | null; startAt: number } | null>(
    params.localPath ? { key: localKey, uri: params.localPath, startAt: 0 } : null
  )
  useEffect(() => {
    let cancelled = false
    const mediaType = isTv ? 'tv' : 'movie'
    Promise.all([
      params.localPath
        ? Promise.resolve(params.localPath)
        : getLocalPath(Number(id), mediaType, seasonN, episodeN).catch(() => null),
      getProgress(Number(id), mediaType, seasonN, episodeN).catch(() => 0),
    ]).then(([uri, pos]) => {
      if (!cancelled) setLocalFound({ key: localKey, uri, startAt: pos })
    })
    return () => { cancelled = true }
  }, [localKey, params.localPath, id, isTv, seasonN, episodeN])

  // Solo vale si es del episodio que se está mirando ahora.
  const local = localFound?.key === localKey ? localFound : null
  const localUri = local?.uri ?? null

  // Toda la orquestación (resolver, fallback multi-fuente por `exclude`, menú de
  // calidad, idioma de audio) vive en @bmo/player, compartida con apps/tv. Antes
  // el teléfono tenía su propia copia SIN fallback: cuando la fuente elegida no
  // reproducía, la pantalla moría en "No se pudo cargar" y "Reintentar" volvía a
  // pedir la MISMA fuente (misma clave de caché en el API).
  const src = usePlaybackSource({
    type: isTv ? 'tv' : 'movie',
    id,
    season: seasonN,
    episode: episodeN,
    enabled: !!local && !local.uri,
  })

  // Posición a la que arrancar. La trae el hook, salvo en reproducción local
  // (que no pasa por él) o cuando el salto a AirPlay / la caída a otra fuente la
  // pisan con la posición en curso.
  const [startAtOverride, setStartAtOverride] = useState<number | null>(null)
  const startAt = startAtOverride ?? (localUri ? local!.startAt : src.startAt)
  const ready = localUri ? true : !!src.info

  // El error que se muestra es una frase, no el string técnico. El crudo se
  // manda a consola: sigue haciendo falta para diagnosticar desde Metro, pero
  // no es lo que tiene que leer alguien que solo quiere ver una película.
  const error = src.error
  const friendlyError = useMemo(() => describePlaybackError(error), [error])
  useEffect(() => {
    if (error) console.log(`[player] error: ${error}`)
  }, [error])

  const referer = src.info?.referer ?? ''
  const hasLatinoAlternative = src.info?.hasLatinoAlternative ?? false

  // Casting: al conectar una TV por AirPlay forzamos la vía HLS. AVPlayer
  // (expo-video) castea solo a AirPlay; las fuentes VLC/mkv de Real-Debrid no
  // pueden ir por AirPlay, así que re-resolvemos a un master HLS equivalente
  // (proxeado, ya inyecta el Referer). Sticky: una vez casteando seguimos en
  // HLS aunque cambie de episodio, para no parpadear montando VLC de nuevo.
  const [castForceHls, setCastForceHls] = useState(false)

  // La rotación entrada/salida se CUBRE con un overlay negro. iOS no puede
  // sincronizar el fade del modal (fullScreenModal) con el lockAsync imperativo,
  // así que sin esto se ve el contenido landscape achatado en un frame portrait
  // mientras gira — el "bug" visual. Con `oriented=false` pintamos negro por
  // encima de TODO hasta que el giro asentó (ver el effect de landscape). Al
  // salir, lo volvemos a poner ANTES de rotar y navegar, así el giro de vuelta a
  // portrait pasa detrás del negro y no se ve el reflow.
  const [oriented, setOriented] = useState(false)

  async function exitToBack() {
    setOriented(false)
    // Dos frames para que el negro llegue a pintarse antes de girar (uno solo
    // no alcanza: el primero programa el render, el segundo lo ve en pantalla).
    // Antes eran 50 ms fijos, que en un panel de 120 Hz son seis frames de
    // espera pura.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    // SIN await: la rotación a vertical y la navegación de vuelta corren a la
    // vez. Esperar a que el giro terminara para recién ahí llamar a router.back()
    // encadenaba dos animaciones de ~300 ms una detrás de la otra, y esa suma
    // es lo que hacía que salir del reproductor se sintiera pesado. Las dos
    // pasan detrás del overlay negro, así que solaparlas no descubre el reflow.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    router.back()
  }

  // Episodios de la temporada actual (para saber si hay siguiente)
  const [seasonEps, setSeasonEps] = useState<number[]>([])
  useEffect(() => {
    if (!isTv) return
    let cancelled = false
    tmdb.season(id, seasonN ?? 1)
      .then((s) => {
        if (!cancelled) setSeasonEps(s.episodes.map((e) => e.episode_number))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isTv, id, seasonN])

  const nextEpisodeN = (episodeN ?? 1) + 1
  const hasNextEpisode = isTv && seasonEps.includes(nextEpisodeN)

  // Pre-resuelve el siguiente episodio en segundo plano, ya con el video andando.
  useEffect(() => {
    if (!src.info || !isTv) return
    stream.prewarm('tv', id, seasonN ?? 1, (episodeN ?? 1) + 1, src.audioLang)
  }, [src.info, isTv, id, seasonN, episodeN, src.audioLang])

  // El subtítulo en español NO bloquea el arranque: se baja en paralelo mientras
  // el player ya está montado y bufferizando, y el overlay JS lo recoge apenas
  // llega. La orquestación (cuándo bajarlo, re-bajarlo por fuente, limpiar las
  // cues viejas) es la misma que en la TV y vive en useSpanishSubs; lo único
  // propio del teléfono es CÓMO se baja: acá se cachea a disco, mientras que la
  // TV lo lee en memoria porque no tiene expo-file-system.
  // Por qué NO hay subtítulo español, para mostrarlo en el menú. El fetcher es
  // una función nuestra, así que reporta el motivo por acá y el contrato de
  // @bmo/player (que devuelve solo cues) queda intacto — la TV no se entera.
  const [subsDiagnosis, setSubsDiagnosis] = useState('')
  const fetchSubsToDisk = useCallback<SpanishSubsFetcher>(
    async (subs) => {
      setSubsDiagnosis('')
      const { cues, diagnosis } = await downloadSpanishSubs(subs, type, id, seasonN, episodeN)
      setSubsDiagnosis(diagnosis)
      return cues
    },
    [type, id, seasonN, episodeN]
  )
  // Con `info` en null (reproducción local) devuelve [] y no baja nada.
  const srtCues = useSpanishSubs(src.info, { fetcher: fetchSubsToDisk })

  // Una descarga puede ser de dos formas y cada una necesita un player
  // distinto: un m3u8 recompuesto a partir de segmentos (HLS → expo-video) o
  // un archivo único mkv/mp4 bajado de Real-Debrid (→ VLCKit). Antes se asumía
  // que todo lo local era HLS, así que un mkv descargado se le pasaba a
  // AVPlayer y no reproducía.
  const localIsFile = !!localUri && !localUri.endsWith('.m3u8')

  // URI final para la vía expo-video/HLS:
  //  - local: m3u8 descargado
  //  - hls: master proxeado por nuestro servidor (variantes + segmentos + subs)
  // Va con `src.excluded` para que el servidor salte las fuentes que ya fallaron
  // acá. No se usa resolvePlaybackUri porque el caso de AirPlay necesita un
  // master HLS incluso cuando la fuente resuelta es un mkv (ver castForceHls).
  const masterUrl = (localUri && !localIsFile ? localUri : null)
    ?? (isTv
      ? stream.masterTv(id, seasonN ?? 1, episodeN ?? 1, src.audioLang, src.excluded)
      : stream.masterMovie(id, src.audioLang, src.excluded))

  // Fuentes "file" → VLCKit: soporta mkv nativo y permite sideload/selección de
  // subtítulos y pistas de audio sin re-resolver. Cubre tanto el streaming
  // directo de Real-Debrid como un archivo ya descargado.
  const isVlcSource = localIsFile || (src.info?.type === 'file' && !localUri)
  // Al castear forzamos HLS (ver castForceHls): aunque la fuente sea VLC/mkv,
  // pasamos a NativePlayer con el master HLS para que AVPlayer lo mande a la TV.
  const useVlc = isVlcSource && !castForceHls
  // Para VLCKit: el archivo local manda sobre la URL remota.
  const vlcUri = localIsFile ? localUri! : src.info?.streamUrl ?? null

  // Orientación a nivel de PANTALLA, no por instancia de VlcPlayer ni por tipo
  // de fuente (el mismo lock sirve para VLC y para el fullscreen nativo de Apple).
  // La carga mientras resuelve es solo un spinner centrado (orientación-agnóstico),
  // y el reflow del giro lo tapa el overlay negro (ver `oriented`).
  // Fuerza landscape al entrar y marca `oriented` cuando el giro ASENTÓ, para
  // levantar el overlay negro recién ahí (no antes, o se ve el reflow). Detecta
  // el asentamiento por tres vías: si ya estábamos en landscape (no dispara
  // change), el evento de cambio de orientación, y un timeout de red de seguridad.
  useEffect(() => {
    let done = false
    const finish = () => { if (!done) { done = true; setOriented(true) } }
    const isLandscape = (o: ScreenOrientation.Orientation) =>
      o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
      o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
    // La rotación se dispara en el PRIMER frame. Antes se esperaba a que
    // resolviera getOrientationAsync() para recién ahí llamar a lockAsync: dos
    // viajes al lado nativo en serie, y el giro no empezaba hasta el segundo.
    // Ese retraso se pagaba entero detrás del overlay negro, en cada entrada al
    // reproductor. La consulta del estado actual sólo sirve para el caso "ya
    // estábamos en landscape", así que va en paralelo y no bloquea nada.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
    ScreenOrientation.getOrientationAsync().then((cur) => {
      if (isLandscape(cur)) finish()
    })
    const sub = ScreenOrientation.addOrientationChangeListener((e) => {
      if (isLandscape(e.orientationInfo.orientation)) finish()
    })
    const t = setTimeout(finish, 550)
    return () => { ScreenOrientation.removeOrientationChangeListener(sub); clearTimeout(t) }
  }, [])

  useEffect(() => {
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP) }
  }, [])

  // El menú de calidad no aplica a un archivo ya descargado: no hay fuentes
  // alternativas que ofrecer. El hook las pide igual (no sabe de descargas), así
  // que acá simplemente no se muestran.
  const sources = localIsFile ? [] : src.sources
  const sourcesLoading = localIsFile ? false : src.sourcesLoading

  // Última posición conocida. El hook lleva la suya para el cambio de calidad;
  // acá hace falta una propia porque el salto a AirPlay la necesita leída.
  const lastPositionRef = useRef(0)
  function reportPosition(t: number) {
    lastPositionRef.current = t
    src.reportPosition(t)
  }

  // Fuente VLC/mkv + TV conectada por AirPlay → saltar a la vía HLS retomando
  // la posición actual (el master HLS lo castea AVPlayer). Ver castForceHls.
  function forceCastHls() {
    if (castForceHls) return
    setStartAtOverride(lastPositionRef.current)
    setCastForceHls(true)
  }

  // Cambiar de calidad lo maneja el hook (retoma desde la posición reportada).
  // Acá solo se suelta el override del cast, que si no pisaría el startAt nuevo
  // con una posición vieja.
  async function pickSource(i: number) {
    setStartAtOverride(null)
    await src.pickSource(i)
  }

  // El motor no pudo reproducir (URL muerta, señuelo que pasó el filtro del
  // servidor, un códec que este iPhone no decodifica). Antes esto iba directo a
  // la pantalla de error; ahora se excluye esa fuente y se prueba la siguiente,
  // igual que hace la TV. Solo cuando se agotan las fuentes se muestra el error.
  // Un archivo local no tiene fuente que excluir → cae directo al error.
  function handlePlaybackError(msg: string) {
    const message = msg || 'Error de reproducción'
    // Diagnóstico: qué motor, qué fuente y qué tan lejos llegó. Sin esto un fallo
    // de VLC con 4K es indistinguible de un link muerto.
    console.log(
      `[player] fallo del motor (${useVlc ? 'VLC' : 'AVPlayer'}): "${message}" ` +
      `fuente=${src.info?.source ?? '?'} tipo=${src.info?.type ?? '?'} idioma=${src.info?.language ?? '?'} ` +
      `pos=${Math.round(lastPositionRef.current)}s excluidas=${src.excluded.length} local=${!!localUri}`
    )
    if (localUri) { src.setError(message); return }
    // Si la fuente llegó a reproducir algo, la siguiente retoma ahí. Si murió en
    // el arranque (posición ~0) NO se pisa el startAt: hay que conservar el
    // punto guardado del usuario, que es lo que el hook ya trae.
    if (lastPositionRef.current > 5) setStartAtOverride(lastPositionRef.current)
    src.onSourceFailed(src.info?.source ?? '', message)
  }


  // Título base: quita el sufijo "· T_:E_" si vino en el param
  const baseTitle = (title ?? '').replace(/\s*·\s*T\d+:E\d+\s*$/, '')

  const meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'> = {
    id: Number(id),
    media_type: isTv ? 'tv' : 'movie',
    title: title ?? '',
    poster_path: params.poster ?? null,
    backdrop_path: params.backdrop ?? null,
    season: seasonN,
    episode: episodeN,
  }

  // Encola el siguiente episodio en "Seguir viendo"
  function enqueueNext() {
    setUpNext({
      id: Number(id),
      media_type: 'tv',
      title: title ?? '',
      poster_path: params.poster ?? null,
      backdrop_path: params.backdrop ?? null,
      season: seasonN ?? 1,
      episode: nextEpisodeN,
    }).catch(() => {})
  }

  // Último episodio de la temporada: si la serie sigue, encola el E1 de la
  // temporada siguiente en "Seguir viendo". Antes, terminar un final de
  // temporada sacaba la serie de la fila (el progreso del episodio visto se
  // borra) y había que ir a buscarla. Solo si el E1 ya se emitió.
  async function enqueueNextSeason() {
    const next = (seasonN ?? 1) + 1
    try {
      const s = await tmdb.season(id, next)
      const today = new Date().toISOString().slice(0, 10)
      const first = s.episodes.find((e) => e.episode_number === 1)
      if (!first?.air_date || first.air_date > today) return
      await setUpNext({
        id: Number(id),
        media_type: 'tv',
        title: title ?? '',
        poster_path: params.poster ?? null,
        backdrop_path: params.backdrop ?? null,
        season: next,
        episode: 1,
      })
    } catch {}
  }

  // El usuario cerró el reproductor (botón X)
  function handleClose(watchedFraction: number) {
    if (isTv && watchedFraction >= FINISHED_RATIO && hasNextEpisode) {
      enqueueNext()
      setShowNext(true)
    } else {
      if (isTv && watchedFraction >= FINISHED_RATIO) enqueueNextSeason()
      exitToBack()
    }
  }

  // El video llegó al final
  function handleEnded() {
    if (isTv && hasNextEpisode) {
      // Se encola ya, no recién al tocar "Reproducir" en la pantalla de
      // siguiente: si el usuario sale desde ahí, la serie tiene que seguir en
      // "Seguir viendo" apuntando al próximo episodio (el progreso del que
      // terminó ya se borró al pasar el 92%).
      enqueueNext()
      // Smart download: pre-descarga el episodio siguiente al siguiente
      smartDownloadNext({
        id: Number(id),
        title: (title ?? '').replace(/\s*·\s*T\d+:E\d+\s*$/, ''),
        poster_path: params.poster ?? null,
        backdrop_path: params.backdrop ?? null,
        season: seasonN ?? 1,
        currentEpisode: episodeN ?? 1,
        seasonEpisodeNumbers: seasonEps,
      })
      setShowNext(true)
    } else {
      if (isTv) enqueueNextSeason()
      exitToBack()
    }
  }

  // Cambia de episodio SIN renavegar: mover episodeN alcanza para que el hook
  // re-resuelva (y traiga el progreso guardado del episodio nuevo). Solo hay que
  // soltar el override de posición, que es del episodio anterior.
  function playNextEpisode() {
    setShowNext(false)
    setStartAtOverride(null)
    setEpisodeN(nextEpisodeN)
  }

  // ── Pantalla "Siguiente episodio" (al terminar) ──
  if (showNext) {
    return (
      <NextEpisodeScreen
        title={title ?? ''}
        season={seasonN ?? 1}
        episode={nextEpisodeN}
        backdrop={params.backdrop ?? null}
        onPlay={playNextEpisode}
        onBack={exitToBack}
      />
    )
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      {error ? (
        <View style={styles.center}>
          <SymbolView name="film.stack" tintColor={colors.textMuted} style={styles.errIcon} />
          <Text style={styles.errText}>{friendlyError.title}</Text>
          <Text style={styles.errSub}>{friendlyError.detail}</Text>
          <View style={styles.errButtons}>
            <Touchable scaleTo={0.95} haptic="light" style={styles.retry} onPress={src.retry}>
              <SymbolView name="arrow.clockwise" tintColor="#000" style={styles.retryIcon} />
              <Text style={styles.retryText}>Reintentar</Text>
            </Touchable>
            <Touchable scaleTo={0.95} haptic="light" style={styles.errBackBtn} onPress={exitToBack}>
              <Text style={styles.errBackText}>Volver</Text>
            </Touchable>
          </View>
        </View>
      ) : ready && useVlc && vlcUri ? (
        <VlcPlayer
          // La fuente entra en la key: al cambiar de calidad —o al caer a otra
          // fuente tras un fallo— hay que remontar el player, no solo cambiarle
          // la uri. El remonta resetea el guard de "ya arranqué" y deja que
          // vuelva a buscar startAt (ver handleLoad/startedRef).
          key={`${seasonN ?? 0}-${episodeN ?? 0}-${src.pickedSource ?? 'auto'}-${src.excluded.length}-vlc`}
          uri={vlcUri}
          // Un archivo local no necesita Referer (y pasárselo confunde a VLC).
          referer={localIsFile ? '' : referer}
          srtCues={srtCues}
          subsDiagnosis={subsDiagnosis}
          startAt={startAt}
          meta={meta}
          title={baseTitle}
          episodeLabel={isTv ? `T${seasonN ?? 1}:E${episodeN ?? 1}` : undefined}
          hasNext={hasNextEpisode}
          audioLang={src.audioLang}
          hasLatinoAlternative={hasLatinoAlternative}
          onChangeAudioLang={src.changeAudioLang}
          sources={sources}
          sourcesLoading={sourcesLoading}
          activeSourceIndex={src.pickedSource}
          // Sin fuentes alternativas no se ofrece la pestaña (descarga local).
          onPickSource={localIsFile ? undefined : pickSource}
          // Sin fuente remota (descarga local) no hay HLS al que castear.
          onCast={localIsFile ? undefined : forceCastHls}
          onPosition={reportPosition}
          offsetKey={`${type}-${id}-${seasonN ?? 0}-${episodeN ?? 0}`}
          onClose={handleClose}
          onEnded={handleEnded}
          onPlayNext={playNextEpisode}
          onError={handlePlaybackError}
        />
      ) : ready && (!isVlcSource || castForceHls) && masterUrl ? (
        <NativePlayer
          key={`${seasonN ?? 0}-${episodeN ?? 0}-${src.excluded.length}-hls`}
          uri={masterUrl}
          referer={referer}
          startAt={startAt}
          meta={meta}
          title={baseTitle}
          episodeLabel={isTv ? `T${seasonN ?? 1}:E${episodeN ?? 1}` : undefined}
          hasNext={hasNextEpisode}
          onClose={handleClose}
          onEnded={handleEnded}
          onPlayNext={playNextEpisode}
          onError={handlePlaybackError}
        />
      ) : (
        // Carga mínima: solo un spinner centrado. Se ve bien en cualquier
        // orientación (no hay layout que reflowee al girar) — antes era una
        // pantalla completa posicionada para landscape que aparecía achatada en
        // vertical durante el giro y "bugueaba" todo.
        <View style={styles.loadingSpinnerWrap}>
          <ActivityIndicator color="#fff" size="large" />
          <Pressable style={styles.loadingBack} onPress={exitToBack} hitSlop={12}>
            <SymbolView name="chevron.left" tintColor={colors.text} style={styles.loadingBackIcon} />
          </Pressable>
        </View>
      )}

      {/* Cubre el reflow durante la rotación (entrada y salida): negro por encima
          de todo hasta que el giro asentó. Sin esto se ve el layout landscape
          achatado en un frame portrait mientras iOS gira la pantalla. */}
      {!oriented && <View pointerEvents="none" style={styles.orientationCover} />}
    </GestureHandlerRootView>
  )
}

// ── Player a pantalla completa con controles propios ────────────────────────

function NativePlayer({
  uri, referer, startAt, meta, hasNext, onClose, onEnded, onPlayNext, onError,
}: {
  uri: string; referer: string; startAt: number
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  episodeLabel?: string
  hasNext: boolean
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onError: (msg: string) => void
}) {
  const insets = useSafeAreaInsets()
  const videoRef = useRef<VideoView>(null)
  // progressRef local: onFullscreenExit lo lee para la fracción vista. El
  // guardado (throttle + final al desmontar) lo maneja useProgressSaver.
  const progressRef = useRef({ time: 0, duration: 0 })
  const { report: reportProgress } = useProgressSaver(meta)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [inFullscreen, setInFullscreen] = useState(false)

  const player = useVideoPlayer(
    { uri, headers: referer ? { Referer: referer } : undefined, contentType: 'hls' },
    (p) => {
      p.timeUpdateEventInterval = 0.5
      p.bufferOptions = { preferredForwardBufferDuration: 30 }
    }
  )

  // Arrancar cuando el stream esté listo + entrar al fullscreen nativo de Apple
  // (AVPlayerViewController) — el que tiene Liquid Glass, velocidad, audio y subtítulos
  const started = useRef(false)
  useEventListener(player, 'statusChange', ({ status, error: playerError }) => {
    if (status === 'readyToPlay' && !started.current) {
      started.current = true
      if (startAt > 5) player.currentTime = startAt
      player.play()
      // pequeño delay para que la vista esté montada antes de expandir
      setTimeout(() => videoRef.current?.enterFullscreen(), 60)
    } else if (status === 'error') {
      console.warn('[player] error:', playerError?.message)
      onError(playerError?.message ?? 'Player error desconocido')
    }
  })

  // Progreso (throttle 5s) + posición para el pill "Siguiente"
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const dur = player.duration
    progressRef.current = { time: currentTime, duration: dur }
    setPosition(currentTime)
    if (dur > 0) setDuration(dur)
    reportProgress(currentTime, dur)
  })

  useEventListener(player, 'playToEnd', () => onEnded())

  const remaining = Math.max(0, duration - position)
  const showPill = hasNext && duration > 0 && remaining > 1 && remaining <= NEXT_PILL_S

  return (
    <View style={styles.fill}>
      {/* Reproductor nativo de Apple (AVPlayerViewController fullscreen) —
          Liquid Glass, velocidad, audio y subtítulos integrados */}
      <VideoView
        ref={videoRef}
        player={player}
        style={styles.fill}
        nativeControls={true}
        allowsPictureInPicture
        contentFit="contain"
        onFullscreenEnter={() => setInFullscreen(true)}
        onFullscreenExit={() => {
          // El usuario cerró el reproductor nativo (botón "Listo"/X)
          const { time, duration: d } = progressRef.current
          onClose(d > 0 ? time / d : 0)
        }}
      />

      {/* Tapa negra sobre los controles inline (feos) hasta entrar a fullscreen */}
      {!inFullscreen && <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }]} pointerEvents="none" />}

      {/* Pill "Siguiente episodio" — solo visible fuera de fullscreen
          (en fullscreen Apple controla todo el overlay) */}
      {showPill && !inFullscreen && (
        <Touchable
          scaleTo={0.95}
          haptic="medium"
          style={[styles.nextPill, { bottom: insets.bottom + 80, right: insets.right + 24 }]}
          onPress={onPlayNext}
        >
          <SymbolView name="forward.fill" tintColor="#000" style={styles.nextPillIcon} />
          <Text style={styles.nextPillText}>Siguiente episodio</Text>
        </Touchable>
      )}
    </View>
  )
}

// ── Player VLCKit (fuentes "file" — mp4/mkv de Real-Debrid) ─────────────────
// Sin chrome nativo de AVPlayer: controles propios, mínimos, con selector de
// pista de audio/subtítulos (lo que expo-video no puede dar para estas fuentes).

type TrackInfo = { id: number; label: string; lang?: string }

// ¿Esta pista embebida es española? VLCKit expone `language` (ISO 639) además
// del título; antes se descartaba y solo se miraba el título, que en muchos
// MKV viene vacío o genérico ("Track 3").
function isSpanishTrack(t: TrackInfo): boolean {
  const lang = (t.lang ?? '').toLowerCase()
  if (lang.startsWith('es') || lang.startsWith('spa')) return true
  return /\b(?:spa|esp|spanish|español|castellano)\b/i.test(t.label) || isLatinTrack(t)
}

// Español LATINO específicamente, no castellano. Se usa para preferirlo cuando
// el archivo trae los dos doblajes: pedir "latino" y recibir el de España es
// exactamente el error que se busca evitar.
// `es-419` es el código ISO estándar para español de Latinoamérica; `es-MX`,
// `es-AR` etc. también aparecen en archivos reales.
function isLatinTrack(t: TrackInfo): boolean {
  const lang = (t.lang ?? '').toLowerCase()
  if (/^(?:es|spa)[-_](?:419|mx|ar|co|cl|pe|ve|la)/.test(lang)) return true
  return /\b(?:latino|latinoamerican[oa]|lat|mex|419)\b/i.test(t.label)
}

// Idioma legible de una pista de audio REAL del archivo (lo que lee VLC), o
// null si el archivo no lo dice.
function trackLangName(t: TrackInfo): string | null {
  if (isLatinTrack(t)) return 'Latino'
  const lang = (t.lang ?? '').toLowerCase()
  if (/^(?:es|spa)[-_]es\b/.test(lang) || /\b(?:castellano|españa|spain|cast)\b/i.test(t.label)) return 'Castellano'
  if (isSpanishTrack(t)) return 'Español'
  return LANG_NAMES[lang.split(/[-_]/)[0]] ?? null
}

type LangBadge = { text: string; tone: 'es' | 'cast' | 'other'; kind: 'confirmed' | 'claimed' | 'unknown'; a11y: string }
const toneOf = (l: string): LangBadge['tone'] =>
  l === 'Latino' || l === 'Español' ? 'es' : l === 'Castellano' ? 'cast' : 'other'

// Etiqueta de idioma de una fuente en el menú de Calidad, sin prometer de más:
//  · confirmed: la fuente que está sonando, con los idiomas que trae el
//    ARCHIVO (pistas de audio que lee VLC). Esto sí es cierto.
//  · claimed: lo que dice el nombre de la fuente. Puede fallar: se muestra
//    con borde, no relleno, para que no parezca un dato seguro.
//  · unknown: el nombre no dice nada → "Sin confirmar", en vez de callar.
function sourceLangBadge(langs: string[], realTracks: TrackInfo[] | null): LangBadge {
  if (realTracks && realTracks.length) {
    const names = [...new Set(realTracks.map(trackLangName).filter((n): n is string => !!n))]
    if (names.length) {
      // Primero el español, que es lo que se busca.
      names.sort((a, b) => Number(toneOf(b) !== 'other') - Number(toneOf(a) !== 'other'))
      const shown = names.slice(0, 2).join(' · ') + (names.length > 2 ? ` +${names.length - 2}` : '')
      return { text: shown, tone: toneOf(names[0]), kind: 'confirmed', a11y: `Audio confirmado: ${names.join(', ')}` }
    }
  }
  const claim = audioLangLabel(langs)
  if (claim) return { text: claim, tone: toneOf(claim), kind: 'claimed', a11y: `${claim}, según el nombre de la fuente, sin confirmar` }
  return { text: 'Sin confirmar', tone: 'other', kind: 'unknown', a11y: 'Idioma sin confirmar' }
}

function VlcPlayer({
  uri, referer, srtCues, subsDiagnosis, startAt, meta, hasNext, title, episodeLabel,
  audioLang, hasLatinoAlternative, onChangeAudioLang,
  sources, sourcesLoading, activeSourceIndex, onPickSource, onPosition,
  onCast,
  offsetKey,
  onClose, onEnded, onPlayNext, onError,
}: {
  uri: string; referer: string; startAt: number
  srtCues: SrtCue[]
  // Vacío = hay subtítulo español. Si no, explica por qué falta (ver
  // downloadSpanishSubs); se muestra en el menú de subtítulos.
  subsDiagnosis: string
  meta: Omit<Progress, 'position' | 'duration' | 'updatedAt'>
  title: string
  episodeLabel?: string
  hasNext: boolean
  audioLang: AudioLang
  hasLatinoAlternative: boolean
  onChangeAudioLang: (lang: AudioLang) => void
  // Selector de calidad. `onPickSource` ausente = la pestaña no se muestra
  // (p. ej. reproduciendo una descarga local, donde no hay otras fuentes).
  sources: SourceOption[]
  sourcesLoading: boolean
  activeSourceIndex: number | null
  onPickSource?: (i: number) => void
  onPosition?: (t: number) => void
  // Presente = se puede castear esta fuente (hay HLS remoto al que saltar).
  // Ausente (descarga local) = no se muestra el botón de AirPlay.
  onCast?: () => void
  // Clave de persistencia del desfase de subtítulos (por título/episodio).
  offsetKey: string
  onClose: (watchedFraction: number) => void
  onEnded: () => void
  onPlayNext: () => void
  onError: (msg: string) => void
}) {
  const insets = useSafeAreaInsets()
  const { width: winWidth, height: winHeight } = useWindowDimensions()
  // top fijo (no insets.top): en este landscape forzado por lockAsync (no una
  // rotación física real) safe-area-context a veces arrastra el inset de
  // portrait y empuja todo mucho más abajo de lo que hace falta — mismo
  // problema ya documentado para insets.bottom en el overlay de subtítulos.
  const topBarTop = 16
  // Tamaño fijo del dropdown (no crece con la cantidad de pistas ni se achica
  // con poco contenido) — clamp solo como red de seguridad en pantallas bajas
  // para que nunca se salga del área visible ni llegue a la barra de abajo.
  // Margen a los costados: el del notch en landscape, nunca menos de 24.
  const sidePad = Math.max(24, insets.left, insets.right)
  // El menú sale de abajo a la derecha (sobre los botones de acción) y nunca
  // pasa de la barra de arriba.
  const menuMaxHeight = Math.max(200, winHeight - insets.bottom - 112 - topBarTop - 56)
  const vlcRef = useRef<VideoVLCRef>(null)
  // progressRef local: lo usan seekTo, la detección de fin y la fracción vista.
  // El guardado (throttle + final al desmontar) lo maneja useProgressSaver.
  const progressRef = useRef({ time: 0, duration: 0 })
  const { report: reportProgress } = useProgressSaver(meta)
  const startedRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seeking = useRef(false)
  const seekGraceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSeekTarget = useRef<number | null>(null)
  const seekGuardUntil = useRef(0)

  // "Llenar pantalla" (recorta bordes, sin barras negras) vs "Ajustar"
  // (default, ve el frame completo) — binario, como Netflix/HBO, disparado
  // por pellizco en vez de doble tap. VLCKit ya soporta esto nativamente vía
  // resizeMode, no hace falta ningún transform de zoom manual en JS.
  const [filled, setFilled] = useState(false)
  const [fillHintVisible, setFillHintVisible] = useState(false)
  const fillHintOpacity = useRef(new Animated.Value(0)).current
  const fillHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Doble tap a la izquierda/derecha = retroceder/adelantar 10s (Netflix/
  // YouTube). Va sobre el mismo Pressable que ya maneja el tap simple
  // (mostrar/ocultar controles) — no un gesture-handler nuevo, porque
  // Gesture.Tap() está confirmado roto en este setup (ver comentario más abajo
  // en pinchGesture). El doble tap para seek NO debe mostrar el HUD completo,
  // solo el indicador ±10s — por eso mostrar el HUD desde oculto se difiere la
  // ventana de doble tap (ver handleVideoPress).
  const lastTap = useRef<{ time: number; side: 'left' | 'right' } | null>(null)
  // Mostrar el HUD desde oculto se DIFIERE la ventana de doble tap: si llega un
  // segundo toque (doble tap = seek), se cancela y el HUD nunca aparece.
  const pendingShow = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Aviso de doble tap. `amount` crece si seguís tocando del mismo lado
  // (racha, como YouTube): 10 → 20 → 30 s.
  const [seekHint, setSeekHint] = useState<{ side: 'left' | 'right'; amount: number } | null>(null)
  const seekHintOpacity = useRef(new Animated.Value(0)).current
  const seekHintPop = useRef(new Animated.Value(1)).current
  const seekStreak = useRef<{ side: 'left' | 'right'; time: number; amount: number } | null>(null)
  const seekHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [paused, setPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([])
  const [textTracks, setTextTracks] = useState<TrackInfo[]>([])
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(-1)
  // Menú abierto: 'media' = audio y subtítulos (dos columnas), 'style' =
  // estilo y sincronía del subtítulo, 'speed' = velocidad, 'quality' = fuente.
  const [trackPicker, setTrackPicker] = useState<'media' | 'style' | 'speed' | 'quality' | null>(null)
  const [rate, setRate] = useState(1)
  const [scrubbing, setScrubbing] = useState(false)
  // Lo que decide si los controles pueden esconderse solos, leído desde el
  // timer (que no ve el estado nuevo): en pausa, con un menú abierto o
  // arrastrando la barra, se quedan.
  const holdRef = useRef({ paused: false, picker: false, scrubbing: false })
  holdRef.current = { paused, picker: !!trackPicker, scrubbing }
  // Aparecen y se van con un fundido (antes era de golpe). Se desmontan
  // recién al terminar de irse.
  const controlsAnim = useRef(new Animated.Value(1)).current
  const menuAnim = useRef(new Animated.Value(0)).current

  // Preferencias de subtítulo (modo activo, estilo y sincronía) en @bmo/player,
  // compartidas con la TV. El hook trabaja con ids de pista en string; VLCKit
  // los da numéricos, así que se adaptan en los dos sentidos.
  //
  // El modo se auto-elige una sola vez y sin pisar la elección manual:
  //   1. El .srt externo, si llegó: lo dibujamos nosotros, así que el estilo se
  //      puede cambiar al instante.
  //   2. Si no hay .srt, una pista en español embebida en el propio MKV.
  const subtitleTracks = useMemo(
    () => textTracks.map((t) => ({ id: String(t.id), language: t.lang, label: t.label })),
    [textTracks]
  )
  const {
    subStyle, subOffset, subMode, chooseSubMode, changeSubStyle, bumpOffset,
  } = useSubtitlePrefs({ offsetKey, srtCues, subtitleTracks })

  // Id de pista nativa para VLCKit, o -1 cuando el subtítulo no es del archivo
  // (overlay externo o apagado). Number('external') sería NaN, de ahí el chequeo
  // explícito en vez de un cast.
  const isNativeSub = subMode !== 'external' && subMode !== 'none'
  const nativeTextTrack = isNativeSub ? Number(subMode) : -1

  // El offset se RESTA de la posición: con offset positivo hay que "mirar más
  // atrás" en las cues, o sea que el texto aparece más tarde.
  const activeCue = subMode === 'external' ? findActiveCue(srtCues, position - subOffset) : null
  // Diagnóstico: el estilo (tamaño, color…) solo afecta al subtítulo externo que
  // dibujamos nosotros ('external'); una pista incrustada la pinta VLCKit y no
  // admite cambios. Este log dice cuál de los dos casos es.
  useEffect(() => {
    console.log(`[subs] modo=${subMode} cues=${srtCues.length} pistasIncrustadas=${subtitleTracks.length} estilo.tamaño=${subStyle.size}`)
  }, [subMode, srtCues.length, subtitleTracks.length, subStyle.size])

  function scheduleHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      const h = holdRef.current
      if (h.paused || h.picker || h.scrubbing) return
      setControlsVisible(false)
    }, 4000)
  }

  // Los controles quedan MONTADOS aunque estén ocultos (fuera de pantalla y
  // sin recibir toques). Antes se desmontaban al esconderse y al tocar había
  // que crear de nuevo todo el árbol con sus vidrios: eso era buena parte de
  // la demora en aparecer.
  useEffect(() => {
    Animated.timing(controlsAnim, {
      toValue: controlsVisible ? 1 : 0,
      duration: controlsVisible ? 160 : 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [controlsVisible])

  // En pausa los controles no se van (como en Apple TV); al volver a
  // reproducir, arranca de nuevo la cuenta para esconderlos.
  useEffect(() => {
    if (paused) { setControlsVisible(true); if (hideTimer.current) clearTimeout(hideTimer.current) }
    else scheduleHide()
  }, [paused])

  // El menú entra con un resorte (escala + subida). Sin opacidad: el vidrio
  // de Liquid Glass no se dibuja con opacidad animada.
  useEffect(() => {
    if (!trackPicker) { menuAnim.setValue(0); return }
    Animated.spring(menuAnim, { toValue: 1, speed: 22, bounciness: 6, useNativeDriver: true }).start()
  }, [trackPicker == null])

  useEffect(() => {
    scheduleHide()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (fillHintTimer.current) clearTimeout(fillHintTimer.current)
      if (seekHintTimer.current) clearTimeout(seekHintTimer.current)
      if (pendingShow.current) clearTimeout(pendingShow.current)
    }
  }, [])

  // Mientras el dropdown de audio/subtítulos/estilo está abierto, los
  // controles (y el botón "..." que lo ancla) no se pueden esconder solos —
  // si no, a los 3.5s desaparece la barra de arriba y el dropdown queda
  // flotando sin nada a lo que estar anclado.
  useEffect(() => {
    if (trackPicker) {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      scheduleHide()
    }
  }, [trackPicker])

  // (El lock de orientación landscape/portrait ahora lo maneja PlayerScreen a
  // nivel de pantalla — ver comentario allá. Antes vivía acá y el
  // portrait-al-desmontar causaba el parpadeo al cambiar de episodio.)

  // Red de seguridad: si por lo que sea el evento nativo onLoad/onBuffer nunca
  // llega a JS, no dejar el spinner tapando el video para siempre — a los 6s
  // lo sacamos igual. No condicionamos a ningún otro evento porque si esos
  // tampoco llegan, esa condición nunca se cumpliría.
  useEffect(() => {
    const t = setTimeout(() => setBuffering(false), 6000)
    return () => clearTimeout(t)
  }, [])

  // Si ya hay una TV conectada por AirPlay (p. ej. desde el Centro de Control)
  // al montar esta fuente VLC, saltamos a HLS de una — sin esperar a que el
  // usuario toque el botón.
  useEffect(() => {
    if (onCast && isAirPlayConnected()) onCast()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleControls() {
    setControlsVisible((v) => {
      const next = !v
      if (next) scheduleHide()
      return next
    })
  }

  const DOUBLE_TAP_MS = 280

  function showSeekHint(side: 'left' | 'right', amount: number) {
    if (seekHintTimer.current) clearTimeout(seekHintTimer.current)
    setSeekHint({ side, amount })
    seekHintOpacity.setValue(1)
    // Un "pop" en cada toque de la racha: se siente que sumó.
    seekHintPop.setValue(0.86)
    Animated.spring(seekHintPop, { toValue: 1, speed: 30, bounciness: 12, useNativeDriver: true }).start()
    seekHintTimer.current = setTimeout(() => {
      Animated.timing(seekHintOpacity, { toValue: 0, duration: 250, useNativeDriver: true })
        .start(() => { setSeekHint(null); seekStreak.current = null })
    }, 650)
  }

  // Tap simple = mostrar/ocultar controles; doble tap en la mitad izquierda/
  // derecha = retroceder/adelantar 10s. Comparten el mismo Pressable.
  //
  // El toque muestra/oculta AL INSTANTE, como en la app TV. Antes, con el HUD
  // oculto, se esperaba la ventana de doble tap (280 ms) antes de mostrarlo y
  // se sentía lento. Ahora si llega el segundo toque se adelanta/atrasa igual
  // y los controles simplemente quedan a la vista (no se esconden de golpe,
  // que era el parpadeo que se quería evitar).
  function handleVideoPress(e: GestureResponderEvent) {
    const side: 'left' | 'right' = e.nativeEvent.locationX < winWidth / 2 ? 'left' : 'right'
    const now = Date.now()
    const last = lastTap.current

    // En racha (el aviso de ±10 sigue en pantalla): cada toque más del mismo
    // lado suma otros 10 s, sin tener que volver a hacer doble tap.
    const streak = seekStreak.current
    if (streak && streak.side === side && now - streak.time < 800) {
      lastTap.current = null
      if (pendingShow.current) { clearTimeout(pendingShow.current); pendingShow.current = null }
      seekStreak.current = { side, time: now, amount: streak.amount + 10 }
      skipBy(side === 'right' ? 10 : -10)
      showSeekHint(side, streak.amount + 10)
      Haptics.selectionAsync().catch(() => {})
      return
    }

    // Segundo toque del mismo lado dentro de la ventana → DOBLE TAP: seek + hint,
    // sin tocar el HUD (cancela el "mostrar" pendiente que dejó el primer toque).
    if (last && last.side === side && now - last.time < DOUBLE_TAP_MS) {
      lastTap.current = null
      if (pendingShow.current) { clearTimeout(pendingShow.current); pendingShow.current = null }
      skipBy(side === 'right' ? 10 : -10)
      seekStreak.current = { side, time: now, amount: 10 }
      showSeekHint(side, 10)
      Haptics.selectionAsync().catch(() => {})
      return
    }

    lastTap.current = { time: now, side }

    toggleControls()
  }

  function setFilledWithHint(next: boolean) {
    setFilled((prev) => {
      if (prev === next) return prev
      // Ícono de feedback breve — sin esto el pellizco no da ninguna señal de
      // que pasó algo (el cambio de encuadre puede ser sutil según el video).
      if (fillHintTimer.current) clearTimeout(fillHintTimer.current)
      setFillHintVisible(true)
      fillHintOpacity.setValue(1)
      fillHintTimer.current = setTimeout(() => {
        Animated.timing(fillHintOpacity, { toValue: 0, duration: 300, useNativeDriver: true })
          .start(() => setFillHintVisible(false))
      }, 500)
      return next
    })
  }

  // Pellizco (ajustar/llenar, binario — no zoom continuo) + tap (mostrar/
  // ocultar controles) sobre la misma vista. Gesture.Race, no Simultaneous:
  // tap y pellizco son alternativas excluyentes (o uno o el otro, nunca de
  // verdad "a la vez"), y Race deja que el primero en activar gane sin que
  // el otro interfiera — con Simultaneous el tap dejó de disparar.
  // scale > 1 = dedos separándose (pellizco "hacia afuera") → llenar.
  // scale < 1 = dedos juntándose (pellizco "hacia adentro") → ajustar.
  //
  // useMemo con deps vacías: sin esto, los objetos Gesture.* se recrean en
  // cada render y GestureDetector reconfigura el reconocedor nativo cada vez.
  // Los callbacks usan actualizaciones funcionales de estado (setX(prev =>
  // ...)) así que no necesitan closures frescas — son seguros de fijar una
  // sola vez.
  //
  // Gesture.Tap() de la API nueva quedó descartado para el toggle de
  // controles: con logs confirmé que se queda pegado en "begin" sin llegar
  // NUNCA a "end" ni "finalize", de forma consistente y reproducible — un
  // bug real de esa API en este setup, no una carrera de estado. En cambio,
  // Pressable (RN puro, sin gesture-handler) viene funcionando bien toda la
  // sesión para CADA OTRO botón de esta pantalla (X, play/pause, skip, filas
  // del picker) — así que el tap-para-mostrar-controles vuelve a Pressable,
  // ANIDADO adentro del mismo GestureDetector (no como hermano compitiendo,
  // que fue el problema original con el pellizco).
  const pinchGesture = useMemo(
    () => Gesture.Pinch()
      .runOnJS(true)
      .onEnd((e) => {
        if (e.scale > 1.15) setFilledWithHint(true)
        else if (e.scale < 0.85) setFilledWithHint(false)
      }),
    []
  )

  function handleLoad(data: OnLoadData) {
    setBuffering(false) // red de seguridad: onVideoLoad siempre llega al arrancar, aunque se pierda algún evento de buffer
    setDuration(data.duration)
    setAudioTracks(data.audioTracks.map((t) => ({
      id: t.id, label: t.title || t.language || `Pista ${t.id}`, lang: t.language,
    })))
    // Se conserva `language`: es lo que permite reconocer una pista española
    // cuando el MKV no la titula (ver isSpanishTrack y el efecto de subMode).
    setTextTracks(data.textTracks.map((t) => ({
      id: t.id, label: t.title || t.language || `Subtítulo ${t.id}`, lang: t.language,
    })))
    const selAudio = data.audioTracks.find((t) => t.selected)
    // El archivo puede traer varias pistas de audio embebidas (ej. dual audio
    // inglés/latino) y VLCKit no siempre elige la correcta por defecto — suele
    // quedarse en la primera. Si pedimos latino, buscamos una pista cuyo
    // nombre lo indique y la forzamos; si el archivo no la nombra (pistas
    // genéricas "Track 1"/"Track 2"), no hay forma de saberlo desde acá y
    // queda el default de VLCKit.
    // Se mira el título Y el código de idioma (`language`, ISO 639): muchos MKV
    // no titulan las pistas pero sí las etiquetan, y antes esas se perdían.
    // Además se prefiere LATINO sobre castellano cuando el archivo trae las
    // dos — son doblajes distintos y pedir "latino" y recibir el de España es
    // justo lo que se quiere evitar.
    const asTrack = (t: { id: number; title?: string; language?: string }) =>
      ({ id: t.id, label: t.title ?? '', lang: t.language })
    const latinoTrack = audioLang === 'latino'
      ? (data.audioTracks.find((t) => isLatinTrack(asTrack(t)))
        ?? data.audioTracks.find((t) => isSpanishTrack(asTrack(t))))
      : undefined
    setSelectedAudioTrack(latinoTrack ? latinoTrack.id : selAudio ? selAudio.id : -1)
    if (!startedRef.current) {
      startedRef.current = true
      if (startAt > 5) {
        vlcRef.current?.seek(startAt)
        lastSeekTarget.current = startAt
        seekGuardUntil.current = Date.now() + 5000
      }
    }
  }

  function handleProgress(data: OnProgressData) {
    if (seeking.current) return

    // Después de un jumpForward/jumpBackward nativo, VLC a veces reporta un
    // par de progress events con el tiempo "confundido" (cerca de 0) aunque
    // el video YA esté reproduciendo desde el punto correcto — confirmado
    // viendo el contenido real del video en un screen recording: la imagen
    // seguía en el punto saltado mientras el contador ya decía otra cosa.
    // Filtramos esos reportes implausibles hasta ver uno que tenga sentido.
    if (lastSeekTarget.current != null) {
      if (Date.now() < seekGuardUntil.current && Math.abs(data.currentTime - lastSeekTarget.current) > 8) {
        return
      }
      lastSeekTarget.current = null
    }

    // Si llega un progress event es porque el video está decodificando de
    // verdad — usamos eso como prueba definitiva de que no está bufferizando,
    // incluso si en algún momento se perdió el aviso nativo de "ya terminé de
    // bufferizar" (pasaba: quedaba el spinner pegado con el video ya andando).
    if (buffering) setBuffering(false)

    progressRef.current = { time: data.currentTime, duration: data.seekableDuration }
    // La pantalla necesita la posición en vivo para poder retomarla al cambiar
    // de fuente; el progreso guardado va throttleado a 5s y serviría un valor
    // viejo.
    onPosition?.(data.currentTime)
    setPosition(data.currentTime)
    if (data.seekableDuration > 0) setDuration(data.seekableDuration)
    reportProgress(data.currentTime, data.seekableDuration)
  }

  function handleError(data: OnVideoErrorData) {
    console.log(`[vlc] error nativo: code=${data.error.errorCode} "${data.error.errorString}" uri=${(uri ?? '').replace(/[?#].*$/, '').slice(-90)}`)
    onError(data.error.errorString || 'Error de reproducción')
  }

  function handleBuffer(data: OnBufferData) {
    setBuffering(data.isBuffering)
  }

  // Al desmontar → limpia el timer de gracia del seek (el progreso final lo
  // guarda useProgressSaver).
  useEffect(() => {
    return () => {
      if (seekGraceTimer.current) clearTimeout(seekGraceTimer.current)
    }
  }, [])

  function seekTo(time: number) {
    const clamped = Math.max(0, duration > 0 ? Math.min(duration, time) : time)
    if (!vlcRef.current) return
    vlcRef.current.seek(clamped)
    progressRef.current = { ...progressRef.current, time: clamped }
    setPosition(clamped)
    lastSeekTarget.current = clamped
    seekGuardUntil.current = Date.now() + 5000
    // El seek nativo no es instantáneo — si soltamos seeking.current acá mismo,
    // un onProgress "viejo" (todavía de la posición anterior) que llegue antes
    // de que el salto termine pisa la posición recién puesta y la barra "no
    // hace nada" a los ojos del usuario. Lo soltamos un rato después.
    if (seekGraceTimer.current) clearTimeout(seekGraceTimer.current)
    seekGraceTimer.current = setTimeout(() => { seeking.current = false }, 700)
  }

  // Desde progressRef y no desde `position`: en una racha de toques rápidos el
  // estado todavía no se actualizó y se perdían saltos.
  function skipBy(seconds: number) {
    seeking.current = true
    seekTo(progressRef.current.time + seconds)
    if (controlsVisible) scheduleHide()
  }

  const remaining = Math.max(0, duration - position)
  const showPill = hasNext && duration > 0 && remaining > 1 && remaining <= NEXT_PILL_S

  return (
    <View style={styles.fill}>
      {/* GestureDetector (pellizco) envuelve SOLO el video — si envolviera
          toda la pantalla (controles incluidos), les robaría el toque a los
          botones. El Pressable (tap → mostrar/ocultar controles) va ANIDADO
          adentro, no como hermano compitiendo — mismo motivo. */}
      <GestureDetector gesture={pinchGesture}>
        <View style={[styles.fill, styles.vlcZoomClip]}>
          <Pressable style={styles.fill} onPress={handleVideoPress}>
          <VideoVLC
            ref={vlcRef}
            style={styles.fill}
            initialSource={{ uri, headers: referer ? { Referer: referer } : undefined }}
            paused={paused}
            rate={rate}
            resizeMode={filled ? 'cover' : 'none'}
            progressUpdateInterval={500}
            selectedAudioTrack={selectedAudioTrack}
            selectedTextTrack={nativeTextTrack}
            onLoad={handleLoad}
            onProgress={handleProgress}
            onBuffer={handleBuffer}
            onError={handleError}
            onEnd={onEnded}
          />
          {activeCue && (
            // El `bottom` sale de la preferencia y NO se le suma insets.bottom:
            // en landscape forzado por lockAsync (no una rotación física real),
            // el safe-area-context a veces no vuelve a medir bien y arrastra el
            // inset de portrait — sumaba altura de más sin que se note por qué.
            <View
              pointerEvents="none"
              style={[
                styles.subtitleOverlay,
                {
                  bottom: SUBTITLE_POSITION_BOTTOM[subStyle.position],
                  // La opacidad va en el contenedor para que atenúe texto y
                  // fondo juntos (ver SUBTITLE_OPACITY_VALUE).
                  opacity: SUBTITLE_OPACITY_VALUE[subStyle.opacity],
                },
              ]}
            >
              <Text
                style={[
                  styles.subtitleText,
                  {
                    fontSize: SUBTITLE_FONT_SIZE[subStyle.size],
                    color: SUBTITLE_COLOR_CSS[subStyle.color],
                    backgroundColor: subStyle.background === 'semi' ? 'rgba(0,0,0,0.6)' : 'transparent',
                    textShadowColor: SUBTITLE_OUTLINE[subStyle.outline].color,
                    textShadowRadius: SUBTITLE_OUTLINE[subStyle.outline].radius,
                    textShadowOffset: { width: 0, height: SUBTITLE_OUTLINE[subStyle.outline].offsetY },
                  },
                ]}
              >
                {activeCue.text}
              </Text>
            </View>
          )}
          </Pressable>
        </View>
      </GestureDetector>

      {fillHintVisible && (
        <Animated.View style={[styles.fillHint, { opacity: fillHintOpacity }]} pointerEvents="none">
          <SymbolView
            name={filled ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'}
            tintColor="#fff"
            style={styles.fillHintIcon}
          />
          <Text style={styles.fillHintText}>{filled ? 'Pantalla completa' : 'Ajustar'}</Text>
        </Animated.View>
      )}

      {seekHint && (
        <Animated.View
          style={[
            styles.seekHint,
            seekHint.side === 'left' ? styles.seekHintLeft : styles.seekHintRight,
            { opacity: seekHintOpacity, transform: [{ scale: seekHintPop }] },
          ]}
          pointerEvents="none"
        >
          <SymbolView
            name={seekHint.side === 'left' ? 'backward.fill' : 'forward.fill'}
            tintColor="#fff"
            style={styles.seekHintIcon}
          />
          <Text style={styles.seekHintText}>
            {seekHint.side === 'left' ? '−' : '+'}{seekHint.amount} s
          </Text>
        </Animated.View>
      )}

      {buffering && (
        <View style={[StyleSheet.absoluteFillObject, styles.vlcBufferCenter]} pointerEvents="none">
          <View style={styles.bufferRing}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        </View>
      )}

      {(
        // box-none: el contenedor no intercepta toques (competía con el tap
        // del video); los botones de adentro sí.
        <View style={StyleSheet.absoluteFillObject} pointerEvents={controlsVisible ? 'box-none' : 'none'}>
          {/* Degradés arriba y abajo en vez de oscurecer todo el video: los
              controles se leen y la imagen sigue viéndose. En pausa, un velo
              más. Esto SÍ hace fundido (no es vidrio). */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity: controlsAnim }]}>
            <LinearGradient colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0)']} style={styles.scrimTop} />
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']} style={styles.scrimBottom} />
            {paused && <View style={styles.pausedVeil} />}
          </Animated.View>

          {/* Los botones son Liquid Glass, que no se dibuja con opacidad
              animada: en vez de fundirse, la barra de arriba entra desde
              arriba, la de abajo desde abajo y los del centro crecen. */}
          {/* Arriba: cerrar y el título (como Apple TV), AirPlay a la derecha */}
          <Animated.View
            style={[
              styles.topBar,
              {
                top: topBarTop, left: sidePad, right: sidePad,
                transform: [{ translateY: controlsAnim.interpolate({ inputRange: [0, 1], outputRange: [-(topBarTop + 70), 0] }) }],
              },
            ]}
            pointerEvents="box-none"
          >
            <GlassButton
              radius={21} style={styles.roundBtn}
              onPress={() => onClose(duration > 0 ? position / duration : 0)}
              accessibilityRole="button" accessibilityLabel="Cerrar"
            >
              <SymbolView name="xmark" weight="semibold" tintColor="#fff" style={styles.roundIcon} />
            </GlassButton>
            <View style={styles.topTitle} pointerEvents="none">
              <Text style={styles.topTitleText} numberOfLines={1}>{title}</Text>
              {!!episodeLabel && <Text style={styles.topSubText} numberOfLines={1}>{episodeLabel}</Text>}
            </View>
            {onCast && (
              <Glass radius={21} variant="clear" style={styles.roundBtn}>
                <AirPlayButton
                  style={styles.airplayBtn}
                  tint="#FFFFFF"
                  activeTint={colors.accent}
                  onConnectionChange={(e) => { if (e.nativeEvent.connected) onCast() }}
                />
              </Glass>
            )}
          </Animated.View>

          {/* Centro: −10 · play/pausa · +10. Se ocultan mientras carga (el
              spinner va ahí) y mientras arrastrás la barra (molestan). */}
          {!buffering && !scrubbing && (
            <Animated.View
              style={[styles.centerRow, { transform: [{ scale: controlsAnim.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] }) }] }]}
              pointerEvents="box-none"
            >
              <SkipButton direction="back" onPress={() => skipBy(-10)} />
              <GlassButton
                radius={42} style={styles.playBtn} haptic="medium" scaleTo={0.88}
                onPress={() => setPaused((p) => !p)}
                accessibilityRole="button" accessibilityLabel={paused ? 'Reproducir' : 'Pausar'}
              >
                <SymbolView name={paused ? 'play.fill' : 'pause.fill'} tintColor="#fff" style={styles.playIcon} />
              </GlassButton>
              <SkipButton direction="forward" onPress={() => skipBy(10)} />
            </Animated.View>
          )}

          {/* Abajo: acciones a la vista (antes escondidas en "…") y la barra */}
          <Animated.View
            style={[
              styles.bottomArea,
              {
                left: sidePad, right: sidePad, bottom: insets.bottom + 10,
                transform: [{ translateY: controlsAnim.interpolate({ inputRange: [0, 1], outputRange: [insets.bottom + 180, 0] }) }],
              },
            ]}
            pointerEvents="box-none"
          >
            {!buffering && (
              <View style={styles.actionsRow} pointerEvents="box-none">
                <ActionPill
                  icon="captions.bubble"
                  label="Audio y subtítulos"
                  active={trackPicker === 'media' || trackPicker === 'style'}
                  onPress={() => setTrackPicker((p) => (p === 'media' || p === 'style' ? null : 'media'))}
                />
                <ActionPill
                  icon="gauge.with.dots.needle.67percent"
                  label={rate === 1 ? 'Velocidad' : `${formatRate(rate)}×`}
                  active={trackPicker === 'speed'}
                  onPress={() => setTrackPicker((p) => (p === 'speed' ? null : 'speed'))}
                />
                {onPickSource && (
                  <ActionPill
                    icon="sparkles.tv"
                    label="Calidad"
                    active={trackPicker === 'quality'}
                    onPress={() => setTrackPicker((p) => (p === 'quality' ? null : 'quality'))}
                  />
                )}
                {hasNext && (
                  <ActionPill icon="forward.end.fill" label="Siguiente" onPress={onPlayNext} />
                )}
              </View>
            )}
            <Scrubber
              position={position}
              duration={duration}
              onScrubStart={() => { seeking.current = true; setScrubbing(true) }}
              onScrubEnd={() => { setScrubbing(false); scheduleHide() }}
              onSeek={(t) => { seeking.current = true; seekTo(t) }}
            />
          </Animated.View>
        </View>
      )}

      {/* Siguiente episodio: aparece al final, con la cuenta de lo que falta
          llenando la pastilla. */}
      {showPill && (
        <Touchable
          scaleTo={0.95}
          haptic="medium"
          style={[styles.nextPill, { bottom: insets.bottom + (controlsVisible ? 128 : 28), right: sidePad }]}
          onPress={onPlayNext}
          accessibilityRole="button"
          accessibilityLabel={`Siguiente episodio, empieza en ${Math.ceil(remaining)} segundos`}
        >
          <View style={[styles.nextPillFill, { width: `${(1 - remaining / NEXT_PILL_S) * 100}%` }]} />
          <SymbolView name="play.fill" tintColor="#000" style={styles.nextPillIcon} />
          <Text style={styles.nextPillText}>Siguiente episodio</Text>
        </Touchable>
      )}

      {trackPicker && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setTrackPicker(null)}
            accessibilityRole="button"
            accessibilityLabel="Cerrar menú"
          />
          <Animated.View
            style={[
              styles.menuWrap,
              {
                right: sidePad,
                bottom: insets.bottom + 112,
                width: trackPicker === 'media' ? Math.min(560, winWidth - sidePad * 2) : 330,
                maxHeight: menuMaxHeight,
                transformOrigin: 'bottom right',
                transform: [
                  { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                  { scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                ],
              },
            ]}
          >
            <Glass radius={26} style={styles.menuCard}>
              {/* ── Audio y subtítulos: dos columnas ── */}
              {trackPicker === 'media' && (
                <View style={styles.menuColumns}>
                  <View style={styles.menuColumn}>
                    <MenuHeader icon="waveform" title="Audio" />
                    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
                      {audioTracks.map((t) => (
                        <MenuRow
                          key={t.id}
                          label={prettyTrack(t)}
                          selected={selectedAudioTrack === t.id}
                          onPress={() => setSelectedAudioTrack(t.id)}
                        />
                      ))}
                      {audioTracks.length === 0 && (
                        <Text style={styles.menuEmpty}>Una sola pista de audio</Text>
                      )}
                      {/* Siempre a la vista: aunque el nombre del archivo no
                          diga "latino", el doblaje puede estar en otra fuente. */}
                      <MenuRow
                        icon="arrow.triangle.2.circlepath"
                        label={audioLang === 'latino'
                          ? 'Volver al audio original'
                          : hasLatinoAlternative ? 'Cambiar a audio latino' : 'Buscar audio latino'}
                        onPress={() => {
                          onChangeAudioLang(audioLang === 'latino' ? 'original' : 'latino')
                          setTrackPicker(null)
                        }}
                      />
                      {audioLang === 'latino' && audioTracks.length > 0 && !audioTracks.some(isSpanishTrack) && (
                        <Text style={styles.menuNotice}>
                          Esta fuente no trae audio en español. Probá otra desde Calidad.
                        </Text>
                      )}
                    </ScrollView>
                  </View>
                  <View style={styles.menuDivider} />
                  <View style={styles.menuColumn}>
                    <MenuHeader icon="captions.bubble" title="Subtítulos" />
                    <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
                      <MenuRow label="Desactivados" selected={subMode === 'none'} onPress={() => chooseSubMode('none')} />
                      {srtCues.length > 0 && (
                        <MenuRow
                          label="Español"
                          detail="Descargado · ajustable"
                          selected={subMode === 'external'}
                          onPress={() => chooseSubMode('external')}
                        />
                      )}
                      {textTracks.map((t) => (
                        <MenuRow
                          key={t.id}
                          label={prettyTrack(t)}
                          detail="Del archivo"
                          selected={subMode === String(t.id)}
                          onPress={() => chooseSubMode(String(t.id))}
                        />
                      ))}
                      {srtCues.length === 0 && textTracks.length === 0 && (
                        <Text style={styles.menuEmpty}>Esta fuente no trae subtítulos</Text>
                      )}
                      {srtCues.length === 0 && !!subsDiagnosis && (
                        <Text style={styles.menuNotice}>{subsDiagnosis}</Text>
                      )}
                    </ScrollView>
                    {srtCues.length > 0 && (
                      <MenuRow
                        icon="textformat.size"
                        label="Estilo y sincronía"
                        chevron
                        onPress={() => setTrackPicker('style')}
                      />
                    )}
                  </View>
                </View>
              )}

              {/* ── Estilo y sincronía del subtítulo ── */}
              {trackPicker === 'style' && (
                <View style={styles.menuPage}>
                  <View style={styles.menuBackRow}>
                    <Touchable
                      scaleTo={0.9} haptic="selection" style={styles.menuBackBtn}
                      onPress={() => setTrackPicker('media')}
                      accessibilityRole="button" accessibilityLabel="Volver"
                    >
                      <SymbolView name="chevron.left" weight="semibold" tintColor="#fff" style={styles.menuBackIcon} />
                    </Touchable>
                    <Text style={styles.menuTitle}>Estilo y sincronía</Text>
                  </View>
                  <ScrollView style={styles.menuScroll} contentContainerStyle={styles.styleContent} showsVerticalScrollIndicator={false}>
                    {/* Aviso ARRIBA, donde se ve: con una pista incrustada (la
                        dibuja VLCKit) estos ajustes no tienen efecto. Se ofrece
                        pasar al subtítulo descargado, que sí los respeta. */}
                    {isNativeSub && (
                      <View style={styles.styleNotice}>
                        <Text style={styles.styleNoticeText}>
                          Estás viendo una pista incrustada en el archivo: el tamaño y los colores no se aplican a ella.
                        </Text>
                        {srtCues.length > 0 && (
                          <Touchable
                            scaleTo={0.96} haptic="selection" style={styles.styleNoticeBtn}
                            onPress={() => chooseSubMode('external')}
                            accessibilityRole="button"
                          >
                            <Text style={styles.styleNoticeBtnText}>Usar el subtítulo descargado</Text>
                          </Touchable>
                        )}
                      </View>
                    )}
                    {/* Vista previa en vivo: cada cambio se ve al instante */}
                    <View style={styles.previewBox}>
                      <Text
                        style={[
                          styles.subtitleText,
                          {
                            fontSize: SUBTITLE_FONT_SIZE[subStyle.size] * 0.8,
                            color: SUBTITLE_COLOR_CSS[subStyle.color],
                            backgroundColor: subStyle.background === 'semi' ? 'rgba(0,0,0,0.6)' : 'transparent',
                            textShadowColor: SUBTITLE_OUTLINE[subStyle.outline].color,
                            textShadowRadius: SUBTITLE_OUTLINE[subStyle.outline].radius,
                            textShadowOffset: { width: 0, height: SUBTITLE_OUTLINE[subStyle.outline].offsetY },
                            opacity: SUBTITLE_OPACITY_VALUE[subStyle.opacity],
                          },
                        ]}
                      >
                        Así se ven tus subtítulos
                      </Text>
                    </View>
                    <SubtitleStyleRow
                      label="Tamaño"
                      value={subStyle.size}
                      options={[{ value: 'small', label: 'Chico' }, { value: 'medium', label: 'Medio' }, { value: 'large', label: 'Grande' }]}
                      onChange={(size) => changeSubStyle({ size })}
                    />
                    <SubtitleStyleRow
                      label="Color"
                      value={subStyle.color}
                      options={[{ value: 'white', label: 'Blanco' }, { value: 'yellow', label: 'Amarillo' }, { value: 'cyan', label: 'Cian' }]}
                      onChange={(color) => changeSubStyle({ color })}
                    />
                    <SubtitleStyleRow
                      label="Fondo"
                      value={subStyle.background}
                      options={[{ value: 'none', label: 'Sin fondo' }, { value: 'semi', label: 'Con fondo' }]}
                      onChange={(background) => changeSubStyle({ background })}
                    />
                    <SubtitleStyleRow
                      label="Borde"
                      value={subStyle.outline}
                      options={[{ value: 'none', label: 'Ninguno' }, { value: 'soft', label: 'Suave' }, { value: 'strong', label: 'Fuerte' }]}
                      onChange={(outline) => changeSubStyle({ outline })}
                    />
                    <SubtitleStyleRow
                      label="Posición"
                      value={subStyle.position}
                      options={[{ value: 'low', label: 'Abajo' }, { value: 'mid', label: 'Medio' }, { value: 'high', label: 'Alto' }]}
                      onChange={(position) => changeSubStyle({ position })}
                    />
                    <SubtitleStyleRow
                      label="Opacidad"
                      value={subStyle.opacity}
                      options={[{ value: 'full', label: '100%' }, { value: 'high', label: '85%' }, { value: 'medium', label: '70%' }]}
                      onChange={(opacity) => changeSubStyle({ opacity })}
                    />
                    {/* Sincronía: los .srt vienen cronometrados para otro
                        release, casi siempre hay desfase. Se guarda por
                        título/episodio. */}
                    <Text style={styles.styleLabel}>Sincronía</Text>
                    <View style={styles.syncRow}>
                      <Touchable scaleTo={0.9} haptic="selection" style={styles.syncBtn} onPress={() => bumpOffset(-0.5)}
                        accessibilityRole="button" accessibilityLabel="Atrasar medio segundo">
                        <SymbolView name="minus" weight="bold" tintColor="#fff" style={styles.syncIcon} />
                      </Touchable>
                      <Touchable scaleTo={0.94} haptic="light" style={styles.syncValue} onPress={() => bumpOffset(-subOffset)}
                        accessibilityRole="button" accessibilityLabel="Volver a cero">
                        <Text style={styles.syncValueText}>
                          {subOffset === 0 ? 'En sincronía' : `${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)} s`}
                        </Text>
                      </Touchable>
                      <Touchable scaleTo={0.9} haptic="selection" style={styles.syncBtn} onPress={() => bumpOffset(0.5)}
                        accessibilityRole="button" accessibilityLabel="Adelantar medio segundo">
                        <SymbolView name="plus" weight="bold" tintColor="#fff" style={styles.syncIcon} />
                      </Touchable>
                    </View>
                    <Text style={styles.syncHint}>Si el texto aparece antes que la voz, subí el valor. Tocá el centro para volver a 0.</Text>
                  </ScrollView>
                </View>
              )}

              {/* ── Velocidad ── */}
              {trackPicker === 'speed' && (
                <View style={styles.menuPage}>
                  <MenuHeader icon="gauge.with.dots.needle.67percent" title="Velocidad" />
                  <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
                    {RATES.map((r) => (
                      <MenuRow
                        key={r}
                        label={r === 1 ? 'Normal' : `${formatRate(r)}×`}
                        selected={rate === r}
                        onPress={() => { setRate(r); setTrackPicker(null) }}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* ── Calidad (fuentes) ── */}
              {trackPicker === 'quality' && (
                <View style={styles.menuPage}>
                  <MenuHeader icon="sparkles.tv" title="Calidad" />
                  <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
                    {sourcesLoading ? (
                      <ActivityIndicator color="#fff" style={styles.menuLoading} />
                    ) : sources.length === 0 ? (
                      <Text style={styles.menuEmpty}>No hay otras fuentes disponibles</Text>
                    ) : (
                      <>
                        {sources.map((s) => {
                          const active = s.i === activeSourceIndex
                          return (
                            <MenuRow
                              key={s.i}
                              label={describeSource(s)}
                              detail={s.label}
                              selected={active}
                              // Solo la que suena se puede confirmar: VLC ya
                              // leyó sus pistas de audio.
                              badge={sourceLangBadge(s.langs, active ? audioTracks : null)}
                              onPress={() => { onPickSource?.(s.i); setTrackPicker(null) }}
                            />
                          )
                        })}
                        <View style={styles.langLegend}>
                          <View style={styles.langLegendRow}>
                            <SymbolView name="checkmark.seal.fill" tintColor={colors.success} style={styles.langLegendIcon} />
                            <Text style={styles.langLegendText}>Confirmado: lo leímos del archivo que estás viendo.</Text>
                          </View>
                          <View style={styles.langLegendRow}>
                            <View style={styles.langLegendOutline} />
                            <Text style={styles.langLegendText}>Con borde: según el nombre de la fuente; puede no ser exacto.</Text>
                          </View>
                        </View>
                      </>
                    )}
                  </ScrollView>
                </View>
              )}
            </Glass>
          </Animated.View>
        </View>
      )}
    </View>
  )
}

// ── Piezas de la interfaz del reproductor ───────────────────────────────────

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const formatRate = (r: number) => String(r).replace('.', ',')

// Nombres de idioma legibles: muchos MKV traen pistas como "Track 2" o solo
// el código ("eng", "spa"). Se muestra "Inglés", "Español latino"…
const LANG_NAMES: Record<string, string> = {
  en: 'Inglés', eng: 'Inglés', es: 'Español', spa: 'Español', fr: 'Francés', fre: 'Francés', fra: 'Francés',
  pt: 'Portugués', por: 'Portugués', it: 'Italiano', ita: 'Italiano', de: 'Alemán', ger: 'Alemán', deu: 'Alemán',
  ja: 'Japonés', jpn: 'Japonés', ko: 'Coreano', kor: 'Coreano', zh: 'Chino', chi: 'Chino', zho: 'Chino',
  ru: 'Ruso', rus: 'Ruso', ar: 'Árabe', ara: 'Árabe', hi: 'Hindi', hin: 'Hindi',
}
function prettyTrack(t: TrackInfo): string {
  const lang = (t.lang ?? '').toLowerCase()
  const base = LANG_NAMES[lang.split(/[-_]/)[0]]
  const generic = /^(track|pista|subtítulo|subtitle)\s*\d+$/i.test(t.label.trim()) || t.label.trim().toLowerCase() === lang
  if (generic && base) return isLatinTrack(t) ? 'Español latino' : base
  return t.label
}

// −10 / +10 con un pequeño giro del ícono al tocar (como el de Apple).
function SkipButton({ direction, onPress }: { direction: 'back' | 'forward'; onPress: () => void }) {
  const spin = useRef(new Animated.Value(0)).current
  const sign = direction === 'back' ? -1 : 1
  return (
    <GlassButton
      radius={29}
      scaleTo={0.88}
      style={styles.skipBtn}
      onPress={() => {
        spin.setValue(0)
        Animated.sequence([
          Animated.timing(spin, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(spin, { toValue: 0, speed: 18, bounciness: 10, useNativeDriver: true }),
        ]).start()
        onPress()
      }}
      accessibilityRole="button"
      accessibilityLabel={direction === 'back' ? 'Retroceder 10 segundos' : 'Adelantar 10 segundos'}
    >
      <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${sign * 40}deg`] }) }] }}>
        <SymbolView name={direction === 'back' ? 'gobackward.10' : 'goforward.10'} tintColor="#fff" style={styles.skipIcon} />
      </Animated.View>
    </GlassButton>
  )
}

// Botón con ícono y texto de la fila de acciones (abajo a la derecha).
function ActionPill({
  icon, label, active, onPress,
}: { icon: string; label: string; active?: boolean; onPress: () => void }) {
  return (
    <GlassButton
      radius={18}
      variant="regular"
      // Abierto: el vidrio se tiñe de blanco y el texto pasa a negro.
      tint={active ? 'rgba(255,255,255,0.92)' : undefined}
      scaleTo={0.94}
      haptic="selection"
      style={styles.actionPill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: !!active }}
    >
      <SymbolView name={icon as never} tintColor={active ? '#000' : '#fff'} style={styles.actionIcon} />
      <Text style={[styles.actionText, active && styles.actionTextActive]} numberOfLines={1}>{label}</Text>
    </GlassButton>
  )
}

function MenuHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={styles.menuHeader} accessibilityRole="header">
      <SymbolView name={icon as never} tintColor="rgba(255,255,255,0.6)" style={styles.menuHeaderIcon} />
      <Text style={styles.menuHeaderText}>{title}</Text>
    </View>
  )
}

// Fila de menú al estilo de los menús de iOS: el check va a la IZQUIERDA en
// una columna fija (así los textos quedan alineados haya o no selección).
function MenuRow({
  label, detail, selected, icon, chevron, badge, onPress,
}: {
  label: string
  detail?: string
  selected?: boolean
  icon?: string
  chevron?: boolean
  badge?: LangBadge
  onPress: () => void
}) {
  return (
    <Touchable
      scaleTo={0.98}
      haptic="selection"
      style={[styles.menuRow, selected && styles.menuRowSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[label, detail, badge?.a11y].filter(Boolean).join(', ')}
      accessibilityState={{ selected: !!selected }}
    >
      <View style={styles.menuCheckCol}>
        {icon ? (
          <SymbolView name={icon as never} tintColor="#fff" style={styles.menuRowIcon} />
        ) : selected ? (
          <SymbolView name="checkmark" weight="bold" tintColor="#fff" style={styles.menuCheck} />
        ) : null}
      </View>
      <View style={styles.menuRowBody}>
        <Text style={[styles.menuRowText, selected && styles.menuRowTextSelected]} numberOfLines={1}>{label}</Text>
        {!!detail && <Text style={styles.menuRowDetail} numberOfLines={1}>{detail}</Text>}
      </View>
      {badge && (badge.kind === 'confirmed' ? (
        // Confirmado: relleno y con sello.
        <View style={[styles.badge, styles.badgeRow, badge.tone === 'es' ? styles.badgeEs : badge.tone === 'cast' ? styles.badgeCast : styles.badgeOther]}>
          <SymbolView name="checkmark.seal.fill" tintColor={badge.tone === 'other' ? '#fff' : '#000'} style={styles.badgeSeal} />
          <Text style={[styles.badgeText, badge.tone === 'other' && styles.badgeTextLight]}>{badge.text}</Text>
        </View>
      ) : (
        // Según el nombre (o desconocido): solo borde, se lee como "probable".
        <View
          style={[
            styles.badge, styles.badgeOutline,
            { borderColor: badge.kind === 'unknown' ? 'rgba(255,255,255,0.3)' : BADGE_TONE[badge.tone] },
          ]}
        >
          <Text style={[styles.badgeText, { color: badge.kind === 'unknown' ? 'rgba(255,255,255,0.55)' : BADGE_TONE[badge.tone] }]}>
            {badge.text}
          </Text>
        </View>
      ))}
      {chevron && <SymbolView name="chevron.right" weight="semibold" tintColor="rgba(255,255,255,0.5)" style={styles.menuChevron} />}
    </Touchable>
  )
}

const BADGE_TONE = { es: colors.success, cast: '#FF9F0A', other: 'rgba(255,255,255,0.75)' } as const

// Control segmentado para el estilo del subtítulo.
function SubtitleStyleRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <View style={styles.styleRow}>
      <Text style={styles.styleLabel}>{label}</Text>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((opt) => {
          const selected = opt.value === value
          return (
            <View key={opt.value} style={styles.segmentSlot}>
              <Touchable
                scaleTo={0.95}
                haptic="selection"
                style={[styles.segment, selected && styles.segmentActive]}
                onPress={() => onChange(opt.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextActive]} numberOfLines={1}>{opt.label}</Text>
              </Touchable>
            </View>
          )
        })}
      </View>
    </View>
  )
}

// ── Pantalla siguiente episodio (al terminar) ───────────────────────────────

function NextEpisodeScreen({
  title, season, episode, backdrop, onPlay, onBack,
}: {
  title: string; season: number; episode: number
  backdrop: string | null
  onPlay: () => void; onBack: () => void
}) {
  const [seconds, setSeconds] = useState(COUNTDOWN_S)
  const progress = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: COUNTDOWN_S * 1000,
      useNativeDriver: false,
    }).start()

    const interval = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) { clearInterval(interval); onPlay(); return 0 }
        return s - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const backdropUri = backdropUrl(backdrop, 'w1280')

  return (
    <View style={styles.nextContainer}>
      {backdropUri && (
        <Image source={backdropUri} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      )}
      {/* Degradé de izquierda a derecha y de abajo hacia arriba: la imagen
          se ve, y el texto (abajo a la izquierda) se lee. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.88)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.nextContent}>
        <Text style={styles.nextLabel}>A continuación</Text>
        <Text style={styles.nextTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.nextEp}>Temporada {season} · Episodio {episode}</Text>

        <View style={styles.nextButtons}>
          {/* La cuenta regresiva llena el botón: se entiende sin leer el número. */}
          <Touchable
            scaleTo={0.95} haptic="medium" style={styles.playNextBtn} onPress={onPlay}
            accessibilityRole="button" accessibilityLabel={`Reproducir siguiente episodio, empieza en ${seconds} segundos`}
          >
            <Animated.View
              style={[
                styles.playNextFill,
                { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['100%', '0%'] }) },
              ]}
            />
            <SymbolView name="play.fill" tintColor="#000" style={styles.playNextIcon} />
            <Text style={styles.playNextText}>Reproducir · {seconds}</Text>
          </Touchable>

          <Touchable
            scaleTo={0.95} haptic="light" style={styles.backBtn} onPress={onBack}
            accessibilityRole="button" accessibilityLabel="Salir"
          >
            <Text style={styles.backText}>Salir</Text>
          </Touchable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Tapa negra sobre todo mientras la pantalla rota (entrada/salida del player).
  orientationCover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 1000 },
  // Carga mínima: spinner centrado, orientación-agnóstico.
  loadingSpinnerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  loadingBack: {
    position: 'absolute', top: 24, left: 24,
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
  },
  loadingBackIcon: { width: 16, height: 16 },
  fill: { flex: 1, backgroundColor: '#000' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // Pantalla de carga: minimalista — backdrop desenfocado + spinner chico + título.
  loadingRoot: { flex: 1, backgroundColor: '#000' },
  loadingScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40,
  },
  loadingTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  // top/right fijos y no insets: en el landscape forzado por lockAsync el
  // safe-area-context a veces arrastra los insets de portrait (mismo problema
  // ya documentado para la barra superior del VlcPlayer).
  loadingClose: {
    position: 'absolute', top: 16, right: 20,
    width: 34, height: 34, borderRadius: 17, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  loadingCloseBlur: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingCloseIcon: { width: 13, height: 13 },

  // Selector de idioma de audio: flotante, discreto, abajo del todo
  langSwitch: { position: 'absolute', left: 0, right: 0, bottom: 56, alignItems: 'center' },
  langSegmented: {
    flexDirection: 'row',
    borderRadius: 16, padding: 4, gap: 4,
    overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  langOption: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 9 },
  langOptionActive: { backgroundColor: '#fff' },
  langOptionText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  langOptionTextActive: { color: '#000', fontWeight: '700' },

  // Pill siguiente episodio: blanca, con la cuenta llenándola de a poco.
  nextPill: {
    position: 'absolute',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.82)',
    paddingVertical: 13, paddingHorizontal: 20,
    borderRadius: 24, borderCurve: 'continuous',
    overflow: 'hidden',
    zIndex: 30,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  nextPillFill: { ...StyleSheet.absoluteFillObject, right: undefined, backgroundColor: '#fff' },
  nextPillIcon: { width: 14, height: 14 },
  nextPillText: { color: '#000', fontSize: 15, fontWeight: '700' },

  // ── Reproductor (VLC): controles ──
  vlcZoomClip: { overflow: 'hidden' },
  vlcBufferCenter: { alignItems: 'center', justifyContent: 'center' },
  bufferRing: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // Feedback breve al pellizco de ajustar/llenar pantalla.
  fillHint: {
    position: 'absolute', top: '46%', left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  fillHintIcon: { width: 26, height: 26 },
  fillHintText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  // Doble tap: un círculo esmerilado del lado tocado, con el total de la racha.
  seekHint: {
    position: 'absolute', top: '50%', marginTop: -55,
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  seekHintLeft: { left: '14%' },
  seekHintRight: { right: '14%' },
  seekHintIcon: { width: 26, height: 20 },
  seekHintText: { color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // Overlay del subtítulo en español (renderizado en JS, no por VLCKit).
  subtitleOverlay: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  subtitleText: {
    fontWeight: '700', textAlign: 'center',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 150 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 230 },
  pausedVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },

  topBar: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 14 },
  topTitle: { flex: 1 },
  topTitleText: {
    color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
  },
  topSubText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13.5, fontWeight: '600', marginTop: 1,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
  },
  // Botones de Liquid Glass (GlassButton): el vidrio pone forma y borde.
  roundBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  roundIcon: { width: 16, height: 16 },
  // AVRoutePickerView dibuja su propio glifo de AirPlay; centrado en el botón.
  airplayBtn: { width: 24, height: 24 },

  centerRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 52,
  },
  playBtn: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  playIcon: { width: 34, height: 34 },
  skipBtn: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  skipIcon: { width: 28, height: 28 },

  bottomArea: { position: 'absolute', gap: 6 },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginBottom: 2 },
  actionPill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 15 },
  actionIcon: { width: 16, height: 16 },
  actionText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  actionTextActive: { color: '#000' },

  // ── Menús ──
  menuWrap: {
    position: 'absolute',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: { width: 0, height: 14 },
  },
  menuCard: { padding: 8, flexShrink: 1 },
  menuColumns: { flexDirection: 'row', flexShrink: 1 },
  menuColumn: { flex: 1, flexShrink: 1 },
  menuDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.16)', marginVertical: 10 },
  menuPage: { flexShrink: 1 },
  menuScroll: { flexGrow: 0, flexShrink: 1 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  menuHeaderIcon: { width: 13, height: 13 },
  menuHeaderText: {
    color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700',
    letterSpacing: 0.9, textTransform: 'uppercase',
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 46, paddingVertical: 8, paddingRight: 12,
    borderRadius: 14, borderCurve: 'continuous',
  },
  menuRowSelected: { backgroundColor: 'rgba(255,255,255,0.1)' },
  menuCheckCol: { width: 36, alignItems: 'center' },
  menuCheck: { width: 14, height: 14 },
  menuRowIcon: { width: 17, height: 17 },
  menuRowBody: { flex: 1, gap: 1 },
  menuRowText: { color: 'rgba(255,255,255,0.88)', fontSize: 15.5, fontWeight: '500' },
  menuRowTextSelected: { color: '#fff', fontWeight: '700' },
  menuRowDetail: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  menuChevron: { width: 9, height: 14, marginLeft: 8 },
  menuNotice: {
    color: colors.warning, fontSize: 12.5, lineHeight: 17,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  menuEmpty: { color: 'rgba(255,255,255,0.5)', fontSize: 13, paddingHorizontal: 12, paddingVertical: 14 },
  menuLoading: { paddingVertical: 26 },
  menuBackRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 4 },
  menuBackBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  menuBackIcon: { width: 11, height: 16 },
  menuTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Badge de idioma de la fuente (mismos colores que la TV).
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 8 },
  badgeEs: { backgroundColor: colors.success },
  badgeCast: { backgroundColor: '#FF9F0A' },
  badgeOther: { backgroundColor: 'rgba(120,120,128,0.7)' },
  badgeText: { fontSize: 11.5, fontWeight: '800', color: '#000' },
  badgeTextLight: { color: '#fff' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeSeal: { width: 11, height: 11 },
  badgeOutline: { backgroundColor: 'transparent', borderWidth: 1.2, paddingVertical: 2 },
  langLegend: { gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  langLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  langLegendIcon: { width: 12, height: 12 },
  langLegendOutline: { width: 12, height: 9, borderRadius: 3, borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.6)' },
  langLegendText: { flex: 1, color: 'rgba(255,255,255,0.55)', fontSize: 11.5, lineHeight: 15 },

  // Estilo del subtítulo
  styleContent: { paddingHorizontal: 8, paddingBottom: 10, gap: 14 },
  styleNotice: {
    gap: 10, padding: 12, borderRadius: 14, borderCurve: 'continuous',
    backgroundColor: 'rgba(255,159,10,0.14)', marginTop: 4,
  },
  styleNoticeText: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  styleNoticeBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 14, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  styleNoticeBtnText: { color: '#000', fontSize: 13.5, fontWeight: '700' },
  previewBox: {
    height: 74, borderRadius: 14, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#3A4250',
    marginTop: 4,
  },
  styleRow: { gap: 8 },
  styleLabel: {
    color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700',
    letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 4,
  },
  segmented: {
    flexDirection: 'row', padding: 3, borderRadius: 12, borderCurve: 'continuous',
    backgroundColor: 'rgba(120,120,128,0.26)',
  },
  segmentSlot: { flex: 1 },
  segment: { paddingVertical: 8, borderRadius: 9, borderCurve: 'continuous', alignItems: 'center' },
  segmentActive: { backgroundColor: 'rgba(255,255,255,0.92)' },
  segmentText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#000', fontWeight: '700' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  syncBtn: {
    width: 44, height: 40, borderRadius: 12, borderCurve: 'continuous',
    backgroundColor: 'rgba(120,120,128,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  syncIcon: { width: 14, height: 14 },
  syncValue: {
    flex: 1, height: 40, borderRadius: 12, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)',
  },
  syncValueText: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  syncHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 16, paddingHorizontal: 4, marginTop: -6 },

  errIcon: { width: 48, height: 48 },
  errText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16 },
  errSub: { color: colors.textMuted, fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 28, lineHeight: 20 },
  errButtons: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28 },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12,
  },
  retryIcon: { width: 15, height: 15 },
  retryText: { color: '#000', fontWeight: '700', fontSize: 15 },
  errBackBtn: {
    paddingHorizontal: 22, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.textFaint,
  },
  errBackText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Siguiente episodio (pantalla)
  nextContainer: { flex: 1, backgroundColor: '#000' },
  nextContent: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 48, paddingBottom: 48, maxWidth: 620 },
  nextLabel: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
  },
  nextTitle: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -0.8, marginBottom: 6 },
  nextEp: { color: 'rgba(255,255,255,0.75)', fontSize: 16, fontWeight: '600', marginBottom: 26 },
  nextButtons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playNextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 26, borderCurve: 'continuous', overflow: 'hidden',
  },
  playNextFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#fff' },
  playNextIcon: { width: 16, height: 16 },
  playNextText: { color: '#000', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  backBtn: {
    paddingVertical: 14, paddingHorizontal: 24,
    borderRadius: 26, borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)',
  },
  backText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
