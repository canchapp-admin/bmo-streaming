import { BackButton } from '@/components/BackButton'
import { ShootingStarTitle } from '@/components/ShootingStar'
import { PixarLamp, PIXAR_LAMP_SIZE, ThemeEffect, pixarLampAim, pixarLampHits } from '@/components/ThemeEffect'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useRef } from 'react'
import { Animated, View, Text, StyleSheet, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tmdb, backdropUrl, titleOf, genreNames, type MediaItem } from '@/lib/tmdb'
import { STUDIO_BRANDS } from '@/lib/studios'
import { useAsync } from '@/lib/useAsync'
import { useAuth } from '@/lib/auth'
import { forProfile } from '@/lib/kidsFilter'
import { PosterRow } from '@/components/PosterRow'
import { RankedRow } from '@/components/RankedRow'
import { FeaturedCarousel } from '@/components/FeaturedCarousel'
import { BackdropRow } from '@/components/BackdropRow'
import { RowHeading } from '@/components/RowHeading'
import { Touchable } from '@/components/Touchable'
import { BRAND_ART, LOGO_BASE } from '@/components/PlatformRow'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonRow } from '@/components/Skeleton'
import { colors } from '@/lib/theme'
import { mix, withAlpha } from '@/lib/color'

const { width } = Dimensions.get('window')

// Pixar: la lámpara se para sobre un piso justo debajo del título destacado,
// a la derecha, y lo ilumina. Su cuadro termina 6pt antes del borde.
const LAMP_SCREEN_LEFT = width - 6 - PIXAR_LAMP_SIZE.width
const LAMP_TITLE_ROOM = 92 // lugar que el título le deja a la base de la lámpara
// Apunta al centro de la primera parte del título, un poco arriba del piso.
const LAMP_AIM = pixarLampAim(20 + 100 - LAMP_SCREEN_LEFT, PIXAR_LAMP_SIZE.height - 24)
const LAMP_TITLE_W = width - 40 - LAMP_TITLE_ROOM
// Dónde cae el centro del haz sobre el título (x dentro del título) según el
// giro de la cabeza: la mancha de luz lo sigue.
const LAMP_ANGLES = [-30, -15, 0, 10, 20, 30, 40, 50, 60, 75]
const LAMP_SPOT_X = pixarLampHits(PIXAR_LAMP_SIZE.height - 24, LAMP_ANGLES).map((x) => x + LAMP_SCREEN_LEFT - 20)
// Ventanas de luz: varias, cada una más ancha y tenue, apiladas = una mancha
// con borde suave (sin máscaras: todo con transform, en el hilo nativo).
const LAMP_SPOTS = [
  { w: 70, o: 0.34 },
  { w: 130, o: 0.28 },
  { w: 200, o: 0.22 },
  { w: 300, o: 0.16 },
]
const HERO_H = Math.round(width * 1.15)
const GENRE_PATTERNS = ['poster', 'backdrop', 'poster', 'ranked'] as const

// Catálogo de una plataforma o franquicia, ambientado con su marca — como la
// página de un canal en la app Apple TV:
//
//  · Hero alto con el título destacado y, encima, el LOGO real de la marca
//    (antes era el nombre escrito en texto, igual para todas).
//  · Todo el fondo de la pantalla lleva un resplandor del color de la marca
//    que se apaga hacia abajo: entrar a Netflix se siente rojo, a HBO violeta.
//  · Más contenido: además de pelis/series populares, top y recientes, filas
//    por género de la marca ("Acción en Prime Video", …), que la API arma solo
//    con los géneros que tienen suficientes títulos.
export default function StudioScreen() {
  const router = useRouter()
  const { key } = useLocalSearchParams<{ key: string }>()
  const lamp = key === 'pixar'
  const lampLight = useRef(new Animated.Value(0)).current
  const lampHead = useRef(new Animated.Value(-12)).current
  // Cuánta luz recibe el título: prendida y apuntándole (si la lámpara mira
  // para otro lado, se apaga).
  const lampOnTitle = Animated.multiply(
    lampLight,
    lampHead.interpolate({ inputRange: [LAMP_AIM - 40, LAMP_AIM - 12, LAMP_AIM + 12, LAMP_AIM + 40], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' })
  )
  const lampSpotX = lampHead.interpolate({ inputRange: LAMP_ANGLES, outputRange: LAMP_SPOT_X, extrapolate: 'clamp' })
  const insets = useSafeAreaInsets()
  const { profile } = useAuth()
  const kids = !!profile?.is_kids
  const { data, loading, error, refetch } = useAsync(() => tmdb.studio(key!), [key])
  const scrollY = useRef(new Animated.Value(0)).current

  const brand = STUDIO_BRANDS.find((b) => b.key === key)
  const art = key ? BRAND_ART[key] : undefined
  // Color de ambiente: el de la marca (rojo Netflix, violeta HBO…).
  const glow = brand?.colors[0] ?? art?.bg[0] ?? '#222222'
  // Fondo base: la marca muy oscurecida (rojo Netflix → bordó casi negro).
  const base = mix(glow, 0.22)
  const primary: 'movie' | 'tv' =
    data?.primary === 'tv' || (data?.primary == null && data?.type === 'tv') ? 'tv' : 'movie'

  const tagAs = (items: MediaItem[] | undefined, k: 'movie' | 'tv'): MediaItem[] =>
    forProfile((items ?? []).map((i) => ({ ...i, media_type: k })), kids)
  const movies = tagAs(data?.movies ?? (primary === 'movie' ? data?.popular : []), 'movie')
  const moviesTop = tagAs(data?.moviesTop ?? (primary === 'movie' ? data?.topRated : []), 'movie')
  const series = tagAs(data?.series ?? (primary === 'tv' ? data?.popular : []), 'tv')
  const seriesTop = tagAs(data?.seriesTop ?? (primary === 'tv' ? data?.topRated : []), 'tv')
  const recent = tagAs(data?.recent, primary)
  const genres = (data?.genres ?? [])
    .map((g) => ({ ...g, results: tagAs(g.results, g.type) }))
    .filter((g) => g.results.length >= 6)

  const brandName = data?.name ?? brand?.name ?? key ?? ''

  const primaryPop = primary === 'movie' ? movies : series
  const primaryTop = primary === 'movie' ? moviesTop : seriesTop
  const secondaryPop = primary === 'movie' ? series : movies
  const secondaryTop = primary === 'movie' ? seriesTop : moviesTop
  const heroItem = primaryPop.find((i) => i.backdrop_path)
  const heroUrl = backdropUrl(heroItem?.backdrop_path ?? data?.hero ?? null, 'w1280')

  const carouselItems = primaryPop
    .filter((i) => i.id !== heroItem?.id && i.backdrop_path && i.overview)
    .slice(0, 6)
  const usedIds = new Set<number>([heroItem?.id, ...carouselItems.map((i) => i.id)].filter(Boolean) as number[])
  const primaryRow = primaryPop.filter((i) => !usedIds.has(i.id))
  const label = (t: 'movie' | 'tv') => (t === 'movie' ? 'Películas' : 'Series')

  const openHero = () =>
    heroItem && router.push(`/title/${heroItem.media_type === 'tv' ? 'tv' : 'movie'}/${heroItem.id}` as never)

  // Parallax suave del hero y franja oscura arriba al bajar (detrás del botón
  // de volver y la hora).
  const heroShift = scrollY.interpolate({ inputRange: [-400, 0, HERO_H], outputRange: [-400, 0, HERO_H * 0.35], extrapolate: 'clamp' })
  // Estirón al tirar hacia abajo: la foto sube con el contenido (heroShift)
  // y crece desde arriba, así nunca asoma el fondo negro sobre el hero.
  const heroStretch = scrollY.interpolate({ inputRange: [-400, 0], outputRange: [1 + 400 / HERO_H, 1], extrapolate: 'clamp' })
  const edgeOpacity = scrollY.interpolate({ inputRange: [HERO_H - 160, HERO_H - 60], outputRange: [0, 1], extrapolate: 'clamp' })

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {/* ── Resplandor de la marca debajo del hero: arranca EXACTAMENTE en
            el mismo color opaco en que termina el hero (`base`) y se apaga a
            negro. Antes el hero terminaba en negro y el resplandor seguía en
            rojo por detrás: quedaba una línea cortada, peor al hacer scroll. ── */}
        <LinearGradient
          colors={[base, mix(glow, 0.1), '#000']}
          locations={[0, 0.4, 1]}
          style={[styles.ambient, { top: HERO_H }]}
          pointerEvents="none"
        />

        {/* ── Hero ── */}
        {/* overflow hidden: con el parallax la foto ya no se sale del hero
            por encima de las filas. */}
        <View style={{ height: HERO_H }}>
          {/* Recorte que llega muy por encima del hero y lo corta solo por
              abajo: la foto puede cubrir el estirón sin pasarse a las filas. */}
          <View style={styles.heroClip} pointerEvents="none">
          <Animated.View style={[styles.heroLayer, { transform: [{ translateY: heroShift }, { scale: heroStretch }] }]}>
            {heroUrl ? (
              <Image source={heroUrl} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: glow }]} />
            )}
            {/* Baño del color de la marca en diagonal (rojo Netflix, azul
                Disney…), como en los especiales. Dentro de la capa que se
                estira, así lo estirado al tirar hacia abajo también se tiñe. */}
            <LinearGradient
              colors={[withAlpha(glow, 0.42), withAlpha(glow, 0.06), withAlpha(glow, 0.3)]}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {/* Arriba, una sombra neutra para que se lean el logo y la hora.
                Dentro de la capa que se estira, para que cubra también lo
                estirado al tirar hacia abajo. */}
            <LinearGradient
              colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
              locations={[0, 0.3]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          </View>
          {/* Abajo, un fundido largo y con muchas paradas (sin escalones) hacia
              el color base de la marca. */}
          <LinearGradient
            colors={[withAlpha(base, 0), withAlpha(base, 0.35), withAlpha(base, 0.75), withAlpha(base, 0.94), base]}
            locations={[0.3, 0.5, 0.7, 0.86, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Logo de la marca arriba, centrado — la "firma" del canal. */}
          <View style={[styles.brandMark, { top: insets.top + 4 }]} pointerEvents="none">
            {art ? (
              <Image
                source={LOGO_BASE + art.logo}
                style={styles.brandLogo}
                contentFit="contain"
                // Sobre la foto, un logo oscuro (Illumination) se pierde: va en blanco.
                tintColor={art.tint === '#111' ? '#fff' : art.tint}
                cachePolicy="memory-disk"
                transition={200}
                accessibilityLabel={brandName}
              />
            ) : (
              <Text style={styles.brandText} numberOfLines={1}>{brandName}</Text>
            )}
          </View>

          {/* Título destacado abajo, con su botón. */}
          {heroItem && (
            <View style={styles.heroContent}>
              <Text style={styles.heroKicker}>Destacado en {brandName}</Text>
              {lamp ? (
                // El título sobre el piso de la lámpara. Encima, una copia
                // cálida y con brillo que aparece cuando la luz lo toca (luz
                // prendida y cabeza apuntándole).
                <View style={{ paddingRight: LAMP_TITLE_ROOM }}>
                  <Text style={styles.heroTitle} numberOfLines={2}>{titleOf(heroItem)}</Text>
                  {/* Sombra del título en el piso: la luz viene de arriba a la
                      derecha, así que se proyecta hacia la izquierda, aplastada
                      y desenfocada. Solo existe con la luz prendida. */}
                  <Animated.Text
                    style={[
                      styles.heroTitle, styles.heroTitleShadow,
                      { width: LAMP_TITLE_W, opacity: Animated.multiply(lampOnTitle, 0.5) },
                    ]}
                    numberOfLines={2}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {titleOf(heroItem)}
                  </Animated.Text>
                  {/* Rebote: con la luz prendida todo el título toma un tono cálido. */}
                  <Animated.Text
                    style={[styles.heroTitle, styles.heroTitleLit, { width: LAMP_TITLE_W, opacity: Animated.multiply(lampOnTitle, 0.3) }]}
                    numberOfLines={2}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {titleOf(heroItem)}
                  </Animated.Text>
                  {/* La mancha de luz: donde pega el haz, el título brilla; sigue
                      a la cabeza cuando se mueve. Cada ventana recorta una copia
                      iluminada (la copia se mueve al revés y queda quieta). */}
                  {LAMP_SPOTS.map((sp, k) => {
                    const left = lampSpotX.interpolate({ inputRange: [-2000, 2000], outputRange: [-2000 - sp.w / 2, 2000 - sp.w / 2] })
                    return (
                      <Animated.View
                        key={k}
                        style={[
                          styles.lampSpot,
                          { width: sp.w, opacity: Animated.multiply(lampOnTitle, sp.o), transform: [{ translateX: left }] },
                        ]}
                      >
                        <Animated.Text
                          style={[
                            styles.heroTitle, styles.heroTitleLit, styles.heroTitleSpot,
                            { width: LAMP_TITLE_W, transform: [{ translateX: Animated.multiply(left, -1) }] },
                          ]}
                          numberOfLines={2}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        >
                          {titleOf(heroItem)}
                        </Animated.Text>
                      </Animated.View>
                    )
                  })}
                  <PixarLamp
                    light={lampLight}
                    head={lampHead}
                    aim={LAMP_AIM}
                    screenLeft={LAMP_SCREEN_LEFT}
                    style={{ right: -14, bottom: -2 }}
                  />
                </View>
              ) : key === 'disney' ? (
                // Disney+: una estrella fugaz cruza y enciende el título.
                <ShootingStarTitle title={titleOf(heroItem)} style={styles.heroTitle} />
              ) : (
                <Text style={styles.heroTitle} numberOfLines={2}>{titleOf(heroItem)}</Text>
              )}
              {!!heroItem.genre_ids?.length && (
                <Text style={styles.heroMeta} numberOfLines={1}>
                  {[label(heroItem.media_type === 'tv' ? 'tv' : 'movie').replace(/s$/, ''), ...genreNames(heroItem.genre_ids).slice(0, 2)].join(' · ')}
                </Text>
              )}
              <Touchable scaleTo={0.96} haptic="light" onPress={openHero} accessibilityRole="button" accessibilityLabel={`Ver ${titleOf(heroItem)}`}>
                <View style={styles.heroBtn}>
                  <SymbolView name="info.circle.fill" tintColor="#000" style={styles.heroBtnIcon} />
                  <Text style={styles.heroBtnText}>Ver ficha</Text>
                </View>
              </Touchable>
            </View>
          )}
        </View>

        {/* ── Contenido ── */}
        {loading ? (
          <View style={styles.skeletonRows}>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <EmptyState
              icon="wifi.slash"
              title="No se pudo cargar el catálogo"
              subtitle="Revisa tu conexión e intenta de nuevo."
              action={{ label: 'Reintentar', onPress: refetch }}
            />
          </View>
        ) : (
          <View style={styles.sections}>
            {primaryRow.length > 0 && (
              <PosterRow title={`${label(primary)} populares`} items={primaryRow} size="lg" />
            )}
            {primaryTop.length > 0 && (
              <RankedRow title={`Top 10 en ${brandName}`} items={primaryTop.slice(0, 10)} />
            )}
            {carouselItems.length > 0 && (
              <View style={styles.section}>
                <RowHeading title="Imperdibles" />
                <FeaturedCarousel items={carouselItems} />
              </View>
            )}
            {secondaryPop.length > 0 && <PosterRow title={label(primary === 'movie' ? 'tv' : 'movie')} items={secondaryPop} />}
            {recent.length > 0 && <BackdropRow title="Recién llegados" items={recent} size="lg" />}
            {genres.map((g, i) => {
              const kind = GENRE_PATTERNS[i % GENRE_PATTERNS.length]
              if (kind === 'backdrop') return <BackdropRow key={g.id} title={g.name} items={g.results} />
              if (kind === 'ranked') return <RankedRow key={g.id} title={g.name} items={g.results.slice(0, 10)} />
              return <PosterRow key={g.id} title={g.name} items={g.results} />
            })}
            {secondaryTop.length > 0 && (
              <PosterRow
                title={`${label(primary === 'movie' ? 'tv' : 'movie')} mejor valoradas`}
                items={secondaryTop}
              />
            )}
          </View>
        )}
      </Animated.ScrollView>

      {/* Saludo animado de la marca (barrido de luz, hiperespacio, polvo
          mágico…). Se va solo; no bloquea toques. */}
      {!!key && <ThemeEffect themeKey={key} />}

      {/* Franja superior al bajar: el botón de volver y la hora sobre negro. */}
      <Animated.View pointerEvents="none" style={[styles.topEdge, { height: insets.top + 60, opacity: edgeOpacity }]}>
        <LinearGradient colors={['rgba(0,0,0,0.95)', 'rgba(0,0,0,0.6)', 'transparent']} style={StyleSheet.absoluteFill} />
      </Animated.View>

      <BackButton style={[styles.backBtn, { top: insets.top + 6 }]} />
    </View>
  )
}

const HERO_OVERSCROLL = 1000

const styles = StyleSheet.create({
  heroClip: { position: 'absolute', left: 0, right: 0, top: -HERO_OVERSCROLL, bottom: 0, overflow: 'hidden' },
  heroLayer: { position: 'absolute', left: 0, right: 0, top: HERO_OVERSCROLL, bottom: 0, transformOrigin: 'top center' },
  container: { flex: 1, backgroundColor: '#000' },
  ambient: { position: 'absolute', left: 0, right: 0, height: 900 },
  brandMark: { position: 'absolute', left: 72, right: 72, height: 44, alignItems: 'center', justifyContent: 'center' },
  brandLogo: { width: '100%', height: 34 },
  brandText: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  heroContent: { position: 'absolute', left: 20, right: 20, bottom: 24 },
  heroKicker: {
    color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 6,
  },
  heroTitle: {
    color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 12,
  },
  heroTitleLit: {
    position: 'absolute', left: 0, top: 0,
    color: '#FFE6AE', textShadowColor: 'rgba(255,196,100,0.9)', textShadowRadius: 16,
  },
  // Donde pega el haz: casi blanco, con un resplandor más ancho.
  heroTitleSpot: { top: 20, color: '#FFF8E6', textShadowColor: 'rgba(255,214,140,1)', textShadowRadius: 22 },
  lampSpot: { position: 'absolute', left: 0, top: -20, bottom: -20, overflow: 'hidden' },
  heroTitleShadow: {
    position: 'absolute', left: 0, top: 0, zIndex: -1,
    color: '#000', textShadowColor: '#000', textShadowRadius: 8,
    // Se da vuelta sobre la base (cae al piso), se aplasta y se inclina a la
    // izquierda, lejos de la lámpara.
    transformOrigin: 'bottom',
    transform: [{ skewX: '-48deg' }, { scaleY: -0.28 }],
  },
  heroMeta: { color: colors.textDim, fontSize: 14, fontWeight: '600', marginTop: 6 },
  heroBtn: {
    marginTop: 16, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', height: 46, paddingHorizontal: 22, borderRadius: 23,
  },
  heroBtnIcon: { width: 18, height: 18 },
  heroBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  sections: { paddingTop: 12 },
  section: { marginBottom: 28 },
  skeletonRows: { paddingTop: 20, gap: 28 },
  errorBox: { paddingTop: 60, alignItems: 'center' },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0 },
  backBtn: { position: 'absolute', left: 16, zIndex: 10 },
})
