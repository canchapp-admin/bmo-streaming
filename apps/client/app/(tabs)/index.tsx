import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  Animated,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { PosterRow } from '@/components/PosterRow'
import { PlatformRow, FranchiseRow } from '@/components/PlatformRow'
import { RowHeading } from '@/components/RowHeading'
import { BackdropRow } from '@/components/BackdropRow'
import { RankedRow } from '@/components/RankedRow'
import { FeaturedCard } from '@/components/FeaturedCard'
import { HeroCarousel } from '@/components/HeroCarousel'
import { HERO_H } from '@/components/Hero'
import { ContinueRow } from '@/components/ContinueRow'
import { HomeSkeleton } from '@/components/Skeleton'
import { Touchable } from '@/components/Touchable'
import { Glass } from '@/components/Glass'
import { LinearGradient } from 'expo-linear-gradient'
import { EmptyState } from '@/components/EmptyState'
import { screenTitle } from '@/lib/typography'
import { getContinueWatching, getMyList, type LibraryItem, type Progress } from '@/lib/library'
import { forProfile } from '@/lib/kidsFilter'
import { refreshMyList } from '@/lib/myListStore'
import { useAuth } from '@/lib/auth'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { dedupeRows, heroIds } from '@/lib/dedupeRows'
import { Reveal } from '@/components/Reveal'
import { colors } from '@/lib/theme'

// Cuántos títulos rota el hero. Tiene que coincidir con MAX_ITEMS de
// HeroCarousel: es la lista que se excluye del resto del Home.
const HERO_ITEMS = 6
// Desde qué scroll empieza a aparecer el borde superior: cuando el hero ya
// subió lo suficiente como para que debajo de la hora asome una fila.
const HERO_FADE_START = 380
const GENRE = { comedy: 35, horror: 27, family: 10751 }

export default function HomeScreen() {
  const router = useRouter()
  const { profile } = useAuth()
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current

  const { data, loading, error, refetch } = useAsync(() => tmdb.home())
  // Filas por género y estado de ánimo. Cada una por separado (allSettled):
  // si una falla —o la API todavía no tiene /short-movies— solo esa no se
  // dibuja. Se piden aparte del catálogo principal para no demorar el hero.
  const { data: moods } = useAsync(async () => {
    const [comedy, horror, family, short] = await Promise.allSettled([
      tmdb.discover('movie', GENRE.comedy),
      tmdb.discover('movie', GENRE.horror),
      tmdb.discover('movie', GENRE.family),
      tmdb.shortMovies(),
    ])
    const ok = (r: PromiseSettledResult<{ results: MediaItem[] }>) =>
      r.status === 'fulfilled' ? r.value.results.map((i) => ({ ...i, media_type: 'movie' as const })) : []
    return { comedy: ok(comedy), horror: ok(horror), family: ok(family), short: ok(short) }
  })

  const kids = !!profile?.is_kids

  const [watching, setWatching] = useState<Progress[]>([])
  const [myList, setMyList] = useState<MediaItem[]>([])
  const loadWatching = useCallback(() => {
    getContinueWatching().then(setWatching)
    getMyList().then((l) => setMyList(l.map(fromLibrary)))
    // El menú de cada tarjeta muestra si el título está en Mi lista: se relee
    // al volver al Home por si cambió desde la ficha o el hero.
    refreshMyList()
  }, [])
  useFocusEffect(loadWatching)

  // El hero solo "vive" (avanza, reproduce el tráiler) si el Home está en
  // pantalla y el hero todavía se ve: al bajar a las filas o abrir una ficha
  // se queda quieto, sin gastar red ni batería en algo que nadie mira.
  const [focused, setFocused] = useState(true)
  useFocusEffect(useCallback(() => {
    setFocused(true)
    return () => setFocused(false)
  }, []))
  const [heroInView, setHeroInView] = useState(true)
  const heroInViewRef = useRef(true)
  const onScrollY = useCallback((y: number) => {
    const inView = y < HERO_H * 0.5
    if (inView !== heroInViewRef.current) {
      heroInViewRef.current = inView
      setHeroInView(inView)
    }
  }, [])

  // "Porque viste X": parecidos al último título que se miró. Se recalcula solo
  // cuando cambia ese título, no en cada foco del Home.
  const seed = watching[0]
  const [because, setBecause] = useState<{ title: string; items: MediaItem[] } | null>(null)
  useEffect(() => {
    if (!seed) { setBecause(null); return }
    let alive = true
    const load = seed.media_type === 'tv' ? tmdb.tv : tmdb.movie
    load(String(seed.id))
      .then((d) => {
        if (!alive) return
        const items = (d.similar?.results ?? [])
          .filter((i) => i.poster_path)
          .map((i) => ({ ...i, media_type: seed.media_type }))
        setBecause({ title: seed.title, items })
      })
      .catch(() => alive && setBecause(null))
    return () => { alive = false }
  }, [seed?.id, seed?.media_type])

  if (loading) {
    return <HomeSkeleton />
  }
  if (error || !data) {
    return (
      <View style={styles.fill}>
        <EmptyState
          icon="wifi.slash"
          title="No pude cargar el catálogo"
          subtitle="Revisa tu conexión e intenta de nuevo."
          action={{ label: 'Reintentar', onPress: refetch }}
        />
      </View>
    )
  }

  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 180],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })
  // Borde superior que aparece cuando el hero ya se fue: sin él, la hora y la
  // batería quedan encima de pósters de cualquier color. Es el "scroll edge
  // effect" de iOS 26: oscurece solo la franja de arriba, no toda la pantalla.
  const edgeOpacity = scrollY.interpolate({
    inputRange: [HERO_FADE_START, HERO_FADE_START + 80],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })

  // Item destacado: primer trending con backdrop + overview
  // Perfiles infantiles: todo el catálogo del Home pasa por el mismo filtro
  // (hero, destacado, filas y recomendaciones). Mi lista y Seguir viendo no:
  // son títulos que el propio perfil eligió.
  const pick = (items: MediaItem[]) => forProfile(items, kids)
  const trending = pick(data.trending.results)
  const spotlight = trending.find((i) => i.backdrop_path && i.overview)

  // El Home mezcla fuentes que se solapan mucho (lo que es tendencia también es
  // popular, y lo popular suele estar en Netflix): medido contra la API real,
  // el 26% de las tarjetas eran un título ya visto más arriba. Se reparte una
  // sola vez cada título, respetando el orden de las filas como prioridad.
  // Menos filas y mejor elegidas. Las cinco "Lo mejor de Netflix / HBO / …"
  // se fueron (en BMO está todo; ahora son tarjetas en "Plataformas") y en su
  // lugar hay filas por estado de ánimo, que responden a "¿qué tengo ganas de
  // ver?" mejor que "¿en qué servicio está?".
  const rows = dedupeRows(
    [
      { key: 'trending', items: trending },
      { key: 'topMovies', items: pick(data.topMovies.results) },
      { key: 'comedy', items: pick(moods?.comedy ?? []) },
      { key: 'popularSeries', items: pick(data.popularSeries.results) },
      { key: 'short', items: pick(moods?.short ?? []) },
      // Perfiles infantiles: "En familia" ocupa el lugar de "Terror".
      kids
        ? { key: 'last', items: pick(moods?.family ?? []) }
        : { key: 'last', items: moods?.horror ?? [] },
    ],
    {
      // El hero y el destacado ya ocupan la parte alta de la pantalla: volver a
      // verlos en una fila unos centímetros más abajo es la repetición más
      // evidente de todas.
      exclude: [
        ...heroIds(trending, HERO_ITEMS),
        ...(spotlight ? [spotlight.id] : []),
      ],
    }
  )

  const browse = (genreId: number, name: string) => () =>
    router.push({ pathname: '/browse/[type]/[id]', params: { type: 'movie', id: String(genreId), name } })

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          {
            useNativeDriver: true,
            listener: (e: { nativeEvent: { contentOffset: { y: number } } }) =>
              onScrollY(e.nativeEvent.contentOffset.y),
          }
        )}
      >
        <HeroCarousel items={trending} scrollY={scrollY} live={focused && heroInView} />

        <View style={styles.rows}>
          <Reveal index={0}>
            <ContinueRow
              items={watching}
              onChange={loadWatching}
              onSeeAll={() => router.push('/continue' as never)}
            />
          </Reveal>

          {/* Mi lista: lo que el perfil guardó, a mano en el Home y no solo
              en Biblioteca. PosterRow no se dibuja si está vacía. */}
          <Reveal index={1}>
            <PosterRow title="Mi lista" items={myList} onPressTitle={() => router.navigate('/library')} />
          </Reveal>

          <Reveal index={2}><PosterRow title="Tendencias" items={rows.trending} size="lg" /></Reveal>

          {/* Porque viste X: parecidos al último título en curso */}
          {because && seed && (
            <Reveal index={3}>
              <PosterRow
                title={`Porque viste ${because.title}`}
                items={pick(because.items)}
                onPressTitle={() => router.push(`/title/${seed.media_type}/${seed.id}` as never)}
              />
            </Reveal>
          )}

          {spotlight && (
            <Reveal index={4}>
              <View style={styles.featuredWrap}>
                <RowHeading title="Destacado hoy" />
                <FeaturedCard item={spotlight} />
              </View>
            </Reveal>
          )}

          <Reveal index={5}><RankedRow title="Top 10 películas" items={rows.topMovies} /></Reveal>

          <Reveal index={6}><PlatformRow kids={kids} /></Reveal>

          <Reveal index={7}>
            <PosterRow title="Para reírse" items={rows.comedy} onPressTitle={browse(GENRE.comedy, 'Comedia')} />
          </Reveal>

          <Reveal index={8}><BackdropRow title="Series del momento" items={rows.popularSeries} /></Reveal>

          {/* Separada de Plataformas a propósito: dos filas de logos seguidas
              se leen como una sola tira de publicidad. */}
          <Reveal index={8}><FranchiseRow kids={kids} /></Reveal>

          <Reveal index={9}><BackdropRow title="Una peli cortita" items={rows.short} size="lg" /></Reveal>

          <Reveal index={10}>
            {kids ? (
              <PosterRow title="En familia" items={rows.last} size="lg" onPressTitle={browse(GENRE.family, 'Familia')} />
            ) : (
              <PosterRow title="Terror" items={rows.last} size="lg" onPressTitle={browse(GENRE.horror, 'Terror')} />
            )}
          </Reveal>
        </View>
      </Animated.ScrollView>

      <Animated.View
        pointerEvents="none"
        style={[styles.topEdge, { height: insets.top + 76, opacity: edgeOpacity }]}
      >
        <LinearGradient
          // Casi opaco detrás de la hora: con 0.85 los títulos grandes de las
          // tarjetas se seguían leyendo debajo del reloj y ensuciaban la barra.
          colors={['rgba(0,0,0,0.96)', 'rgba(0,0,0,0.75)', 'transparent']}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={[styles.header, { top: insets.top + 4 }]} pointerEvents="box-none">
        {/* Solo el título se desvanece al bajar; el avatar queda siempre a
            mano, como el botón de cuenta de la app Apple TV. */}
        <Animated.Text style={[styles.headerTitle, { opacity: headerOpacity }]}>Inicio</Animated.Text>
        {/* Avatar → selector de perfiles, sobre un círculo de vidrio: es un
            control que flota sobre el contenido. */}
        <Touchable
          scaleTo={0.9}
          haptic="light"
          onPress={() => router.push('/profiles' as never)}
          accessibilityRole="button"
          accessibilityLabel={profile ? `Perfil ${profile.name}. Cambiar de perfil` : 'Perfiles'}
        >
          <Glass radius={22} interactive variant="clear" style={styles.avatar}>
            {profile ? (
              <ProfileAvatar avatar={profile.avatar} size={36} />
            ) : (
              <SymbolView name="person.fill" tintColor={colors.text} style={styles.avatarIcon} />
            )}
          </Glass>
        </Touchable>
      </View>
    </View>
  )
}

// Mi lista guarda lo justo para dibujar la tarjeta; las filas esperan un
// MediaItem de TMDB.
function fromLibrary(i: LibraryItem): MediaItem {
  return {
    id: i.id,
    media_type: i.media_type,
    ...(i.media_type === 'tv' ? { name: i.title } : { title: i.title }),
    poster_path: i.poster_path,
    backdrop_path: i.backdrop_path,
    overview: '',
    vote_average: 0,
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  rows: { paddingTop: 16, paddingBottom: 90 },
  featuredWrap: { marginBottom: 24 },
  header: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    ...screenTitle,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 8,
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0 },
  avatarIcon: { width: 22, height: 22 },
})
