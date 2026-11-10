import { useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Dimensions, Animated, Easing } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import {
  tmdb,
  type MediaItem,
  backdropUrl,
  titleOf,
  isUpcoming,
  logoUrl,
  genreNames,
  trailerKey,
} from '@/lib/tmdb'
import { isInMyList, toggleMyList, toLibraryItem } from '@/lib/library'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { HeroTrailer } from './HeroTrailer'
import { TiltLayer, TiltGlare } from './TiltLayer'
import type { Tilt } from '@/lib/useTilt'
import { colors } from '@/lib/theme'

const { width, height } = Dimensions.get('window')
// 64% del alto (antes 74%): con el hero más bajo, "Seguir viendo" asoma sin
// hacer scroll, y es la fila que más se usa. Lo comparte HeroCarousel.
export const HERO_H = height * 0.64
const KEN_BURNS_MS = 9000 // más lento que el auto-advance del carrusel (7s) → nunca se nota el corte
const KEN_BURNS_SCALE = 1.09
// Cuánto hay que quedarse quieto mirando el hero antes de que arranque el
// tráiler. Lo bastante corto para que se note, lo bastante largo para no
// dispararlo al pasar de largo.
const TRAILER_IDLE_MS = 3000

// Claves de tráiler ya buscadas: volver al Home o al mismo slide no repite la
// llamada. `null` = ese título no tiene tráiler.
const trailerCache = new Map<string, string | null>()

export function Hero({
  item,
  active,
  scrollY,
  live = false,
  reduceMotion = false,
  onTrailerPlaying,
  onTrailerEnded,
  tilt,
}: {
  item: MediaItem
  active: boolean
  scrollY?: Animated.Value
  // El hero está a la vista y nadie lo está tocando: solo así arranca el
  // tráiler. Lo decide el carrusel (pantalla enfocada, hero sin scrollear).
  live?: boolean
  reduceMotion?: boolean
  onTrailerPlaying?: (playing: boolean) => void
  onTrailerEnded?: () => void
  // Inclinación del teléfono (relieve). Solo la recibe el slide activo.
  tilt?: Tilt
}) {
  const router = useRouter()
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  // w1280 y NO 'original': el hero ocupa el ancho de la pantalla, que en un
  // iPhone 3x son ~1206 px — w1280 los cubre justo, sin recorte visible. Medido
  // contra TMDB, el mismo backdrop pesa 175 KB en w1280 y 1.1 MB en 'original':
  // seis veces más bytes (y un bitmap enorme al decodificar) por píxeles que la
  // pantalla no puede mostrar. El carrusel rota seis títulos, así que se pagaba
  // en la pantalla más vista de la app.
  //
  // Sólo el slide activo carga esta calidad; el resto se queda en w780 para no
  // gastar en imágenes que quizás nunca se vean.
  const bg = backdropUrl(item.backdrop_path, active ? 'w1280' : 'w780')
  const upcoming = isUpcoming(item)

  const [logo, setLogo] = useState<string | null>(null)
  const [inList, setInList] = useState(false)

  // Logo + estado de "Mi Lista" solo se piden la PRIMERA vez que el slide se
  // activa (no en los 6 al montar el carrusel) — evita 2×N llamadas de red
  // inútiles al abrir Home.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!active || loadedRef.current) return
    loadedRef.current = true
    let cancelled = false
    tmdb
      .logo(isTv ? 'tv' : 'movie', item.id)
      .then((r) => !cancelled && setLogo(logoUrl(r.logo)))
      .catch(() => {})
    isInMyList(item.id, isTv ? 'tv' : 'movie').then(
      (v) => !cancelled && setInList(v)
    )
    return () => {
      cancelled = true
    }
  }, [active, item.id, isTv])

  // Ken Burns: zoom lento y continuo mientras el slide está activo (look de cine,
  // como Apple TV/Netflix) — se resetea al desactivarse para volver fresco.
  const kenBurns = useRef(new Animated.Value(1)).current
  useEffect(() => {
    // Con "Reducir movimiento" la imagen queda quieta.
    if (!active || reduceMotion) {
      kenBurns.setValue(1)
      return
    }
    const anim = Animated.timing(kenBurns, {
      toValue: KEN_BURNS_SCALE,
      duration: KEN_BURNS_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [active, reduceMotion])

  // Tráiler en silencio tras unos segundos quieto, como la app Apple TV. Si el
  // hero deja de estar "en vivo" (scroll, otra pantalla, un toque) se quita, y
  // vuelve a esperar desde cero. Nunca con "Reducir movimiento": un video que
  // arranca solo es justo lo que esa opción pide evitar.
  const [trailer, setTrailer] = useState<string | null>(null)
  const canTrail = active && live && !reduceMotion && !isUpcoming(item)
  useEffect(() => {
    if (!canTrail) { setTrailer(null); return }
    let cancelled = false
    const type = isTv ? 'tv' : 'movie'
    const cacheKey = `${type}:${item.id}`
    const timer = setTimeout(async () => {
      let key = trailerCache.get(cacheKey)
      if (key === undefined) {
        try {
          const d = await (isTv ? tmdb.tv : tmdb.movie)(String(item.id))
          key = trailerKey(d.videos?.results)
        } catch {
          key = null
        }
        trailerCache.set(cacheKey, key)
      }
      if (!cancelled && key) setTrailer(key)
    }, TRAILER_IDLE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [canTrail, item.id, isTv])

  function open() {
    router.push(`/title/${isTv ? 'tv' : 'movie'}/${item.id}` as never)
  }

  function play() {
    router.push({
      pathname: '/player',
      params: {
        type: isTv ? 'tv' : 'movie',
        id: String(item.id),
        title: titleOf(item),
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
        ...(isTv ? { season: '1', episode: '1' } : {}),
      },
    })
  }

  async function toggleList() {
    const added = await toggleMyList(
      toLibraryItem({ ...item, media_type: isTv ? 'tv' : 'movie' })
    )
    setInList(added)
    // Confirmación táctil, la misma que en el menú contextual de las tarjetas.
    Haptics.notificationAsync(
      added ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {})
  }

  const meta = [isTv ? 'Serie' : 'Película', ...genreNames(item.genre_ids)].join('  ·  ')

  // Solo Ken Burns aquí — el estiramiento por pull-to-refresh vive en una capa
  // aparte (PullStretchBackdrop, en HeroCarousel) que no está recortada
  // horizontalmente, así el zoom grande del pull no sangra al slide vecino.
  const bgTransform = { transform: [{ scale: kenBurns }] }

  // En cuanto empieza el halón, este fondo se desvanece para dejar ver SOLO
  // el PullStretchBackdrop de atrás (que sí se estira) — si ambos quedaran
  // visibles a la vez se ve la imagen duplicada/fantasma.
  const bgOpacity = scrollY
    ? scrollY.interpolate({ inputRange: [-20, 0], outputRange: [0, 1], extrapolate: 'clamp' })
    : 1

  return (
    <View style={styles.hero}>
      {/* Relieve: el fondo se corre con la inclinación (agrandado para que
          no se vean los bordes) y el logo y los botones al revés, un poco
          menos. Encima, un reflejo de luz que cruza al inclinar. */}
      {bg && (
        <TiltLayer tilt={tilt} depth={14} overscan={0.08} style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, bgTransform, { opacity: bgOpacity }]}>
          <Image source={bg} style={styles.bg} contentFit="cover" transition={300} />
          {trailer && (
            <HeroTrailer
              youtubeKey={trailer}
              width={width}
              height={HERO_H}
              onPlaying={onTrailerPlaying}
              onEnded={() => { setTrailer(null); onTrailerEnded?.() }}
            />
          )}
          {/* El degradado va DENTRO del transform para estirarse junto a la imagen */}
          <LinearGradient
            colors={['rgba(0,0,0,0.25)', 'transparent', 'rgba(0,0,0,0.5)', '#000']}
            locations={[0, 0.35, 0.78, 1]}
            style={styles.gradient}
          />
        </Animated.View>
        </TiltLayer>
      )}
      {!trailer && <TiltGlare tilt={tilt} />}

      <TiltLayer tilt={tilt} depth={-7} style={styles.content} pointerEvents="box-none">
        {/* Etiqueta tipográfica, como en la app Apple TV: sin caja ni borde.
            Es contenido, no un control, así que no lleva vidrio. */}
        <Text style={styles.trendingText}>Tendencia</Text>

        <View style={styles.logoBox}>
          {logo ? (
            <Image source={logo} style={styles.logo} contentFit="contain" transition={400} />
          ) : (
            <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
              {titleOf(item)}
            </Text>
          )}
        </View>

        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={1.6}>
          {meta}
        </Text>

        <View style={styles.buttons}>
          {upcoming ? (
            <Glass radius={27} variant="clear" style={styles.soonBtn}>
              <SymbolView name="clock" tintColor={colors.text} style={styles.playIcon} />
              <Text style={styles.soonText}>Próximamente</Text>
            </Glass>
          ) : (
            <Touchable
              scaleTo={0.95}
              haptic="medium"
              style={styles.playBtn}
              onPressIn={() => prewarmTitle(item.id, isTv)}
              onPress={play}
            >
              <SymbolView name="play.fill" tintColor="#000" style={styles.playIcon} />
              <Text style={styles.playText}>Reproducir</Text>
            </Touchable>
          )}
          {/* Control sobre el póster: vidrio "clear" (deja ver la imagen); el
              degradado del hero ya hace de capa de oscurecimiento que piden
              las HIG para que el ícono se lea. */}
          <Touchable
            scaleTo={0.92}
            onPress={toggleList}
            accessibilityRole="button"
            accessibilityLabel={inList ? 'Quitar de Mi lista' : 'Agregar a Mi lista'}
          >
            <Glass radius={26} interactive variant="clear" style={styles.addBtn}>
              <SymbolView
                name={inList ? 'checkmark' : 'plus'}
                tintColor="#fff"
                style={styles.addIcon}
              />
            </Glass>
          </Touchable>
        </View>
      </TiltLayer>

      {/* Toque en el arte → detalle */}
      <Touchable
        scaleTo={1}
        style={styles.tapArea}
        onPressIn={() => prewarmTitle(item.id, isTv)}
        onPress={open}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // overflow:hidden — el zoom del Ken Burns crece la imagen más allá de estos
  // límites; sin recorte se asoma al slide vecino del carrusel (están uno al
  // lado del otro dentro del FlatList horizontal).
  hero: { width, height: HERO_H, overflow: 'hidden' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface },
  gradient: { ...StyleSheet.absoluteFillObject },
  tapArea: { position: 'absolute', top: 0, left: 0, right: 0, height: '60%' },
  content: { position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  trendingText: {
    color: colors.text, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 12, opacity: 0.85,
  },
  logoBox: { height: 100, justifyContent: 'flex-end', alignItems: 'center' },
  logo: { width: width * 0.72, height: 100 },
  title: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.5, textAlign: 'center' },
  meta: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 27,
    paddingVertical: 14,
    paddingHorizontal: 40,
    gap: 8,
  },
  soonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 32,
    gap: 8,
  },
  playIcon: { width: 16, height: 16 },
  playText: { color: '#000', fontSize: 16, fontWeight: '700' },
  soonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  addBtn: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: { width: 22, height: 22 },
})
