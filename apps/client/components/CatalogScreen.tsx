import { useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native'
import { Stack } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAsync } from '@/lib/useAsync'
import { useAuth } from '@/lib/auth'
import { forProfile } from '@/lib/kidsFilter'
import { PosterRow } from './PosterRow'
import { BackdropRow } from './BackdropRow'
import { RankedRow } from './RankedRow'
import { FeaturedCarousel } from './FeaturedCarousel'
import { PlatformRow } from './PlatformRow'
import { PosterCard } from './PosterCard'
import { RowHeading } from './RowHeading'
import { GlassMenu } from './GlassMenu'
import { EmptyState } from './EmptyState'
import { CatalogSkeleton } from './Skeleton'
import { screenTitle } from '@/lib/typography'
import type { CatalogData, MediaItem } from '@/lib/tmdb'
import { colors } from '@/lib/theme'

const GRID_GAP = 12
const GRID_PAD = 20
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3
)
const ALL = 'all'

// Las filas de género rotan entre tres patrones visuales (en vez de alternar
// solo dos) — con ~12 géneros, dos patrones se volvían muy repetitivos.
const GENRE_PATTERNS = ['backdrop', 'poster', 'ranked'] as const

type Section =
  | { key: string; kind: 'platforms' }
  | { key: string; kind: 'carousel'; title: string; items: MediaItem[] }
  | { key: string; kind: 'poster'; title: string; items: MediaItem[]; size?: 'md' | 'lg'; genre?: string }
  | { key: string; kind: 'backdrop'; title: string; items: MediaItem[]; genre?: string }
  | { key: string; kind: 'ranked'; title: string; items: MediaItem[]; genre?: string }

// Catálogo de Series / Películas, con la estructura de la app Apple TV:
//
//  · Arriba, el título grande y el selector de géneros como un botón de
//    vidrio a su derecha. Antes la barra de géneros flotaba ENCIMA del título
//    — al revés de la jerarquía de iOS: primero dónde estás, después cómo
//    filtrar. Sin hero: el contenido arranca directo con Tendencias.
//  · Los géneros son un menú desplegable, no una tira de pastillas cortada a
//    la derecha: hay ~20 y la tira escondía casi todos.
//  · El título de cada fila de género lleva "›" y abre ese género completo.
//  · Las filas "Lo mejor de Netflix / HBO…" pasan a las tarjetas de
//    Plataformas, como en el Inicio.
export function CatalogScreen({
  brand,
  kind,
  load,
}: {
  brand: string
  kind: 'movie' | 'tv'
  load: () => Promise<CatalogData>
}) {
  const insets = useSafeAreaInsets()
  const { profile } = useAuth()
  const kids = !!profile?.is_kids
  const { data, loading, error, refetch } = useAsync(load)
  const [genre, setGenre] = useState<string>(ALL)
  const listRef = useRef<FlatList>(null)

  const scrollY = useRef(new Animated.Value(0)).current
  const shell = (inner: React.ReactNode, pad = false) => (
    <View style={[styles.root, pad && { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {inner}
    </View>
  )

  if (loading) return shell(<CatalogSkeleton />, true)
  if (error || !data) return shell(
    <View style={styles.fill}>
      <EmptyState
        icon="wifi.slash"
        title="No pude cargar el catálogo"
        subtitle="Revisa tu conexión e intenta de nuevo."
        action={{ label: 'Reintentar', onPress: refetch }}
      />
    </View>,
    true
  )

  const tag = (items: MediaItem[] = []): MediaItem[] =>
    forProfile(items, kids).map((i) => ({ ...i, media_type: kind } as MediaItem))

  const genres = data.genres
    .map((g) => ({ name: g.name, results: tag(g.results) }))
    .filter((g) => g.results.length > 0)

  function chooseGenre(key: string) {
    setGenre(key)
    // Al cambiar de vista se vuelve arriba: quedarse a mitad de una grilla
    // nueva desorienta.
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }

  const menu = (
    <GlassMenu
      size="compact"
      align="right"
      label={genre === ALL ? 'Géneros' : genre}
      accessibilityLabel={genre === ALL ? 'Filtrar por género' : `Género: ${genre}. Cambiar`}
      options={[
        { key: ALL, label: 'Todos' },
        ...genres.map((g) => ({ key: g.name, label: g.name })),
      ]}
      selectedKey={genre}
      onSelect={chooseGenre}
    />
  )

  // ── Vista de un género: grilla ─────────────────────────────────────────
  const selected = genre !== ALL ? genres.find((g) => g.name === genre)?.results ?? [] : null
  if (selected) {
    return shell(
      <>
        <FlatList
          ref={listRef}
          key="grid"
          style={styles.container}
          data={selected}
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          columnWrapperStyle={styles.gridCol}
          contentContainerStyle={[styles.gridContent, { paddingTop: insets.top + 64 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.gridHeader}>
              <Text style={styles.kicker}>{brand.toUpperCase()}</Text>
              <Text style={styles.bigTitle} numberOfLines={1} adjustsFontSizeToFit>{genre}</Text>
            </View>
          }
          renderItem={({ item }) => <PosterCard item={item} width={GRID_CARD} />}
        />
        <View style={[styles.gridBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(0,0,0,0.95)', 'rgba(0,0,0,0.7)', 'transparent']}
            locations={[0, 0.65, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {menu}
        </View>
      </>
    )
  }

  // ── Vista general ──────────────────────────────────────────────────────
  const trending = tag(data.trending.results)
  const topRated = tag(data.topRated.results)
  // `?.` en los campos nuevos: una API aún no desplegada no los trae (ver CatalogData)
  const popular = tag(data.popular?.results)
  const recent = tag(data.recent?.results)
  const classics = tag(data.classics?.results)
  const carousel = topRated
    .filter((i) => i.backdrop_path && i.overview)
    .slice(0, 6)

  const sections: Section[] = [
    { key: 'trending', kind: 'poster', title: 'Tendencias', items: trending, size: 'lg' },
    { key: 'top10', kind: 'ranked', title: 'Top 10', items: topRated },
    { key: 'platforms', kind: 'platforms' },
    ...(recent.length
      ? [{
          key: 'recent',
          kind: 'poster',
          title: kind === 'movie' ? 'Recién estrenadas' : 'Series nuevas',
          items: recent,
        } as Section]
      : []),
    ...(popular.length
      ? [{ key: 'popular', kind: 'backdrop', title: 'Populares', items: popular } as Section]
      : []),
    ...(carousel.length
      ? [{ key: 'imperdibles', kind: 'carousel', title: 'Imperdibles', items: carousel } as Section]
      : []),
    ...(classics.length
      ? [{ key: 'classics', kind: 'ranked', title: 'Clásicos aclamados', items: classics } as Section]
      : []),
    ...genres.map((g, i) => ({
      key: `genre-${g.name}`,
      kind: GENRE_PATTERNS[i % GENRE_PATTERNS.length],
      title: g.name,
      items: g.results,
      genre: g.name,
    })),
  ]

  function renderSection(s: Section) {
    const openGenre = 'genre' in s && s.genre ? () => chooseGenre(s.genre!) : undefined
    switch (s.kind) {
      case 'platforms':
        return <PlatformRow kids={kids} />
      case 'carousel':
        return (
          <View style={styles.section}>
            <RowHeading title={s.title} />
            <FeaturedCarousel items={s.items} />
          </View>
        )
      case 'backdrop':
        return <BackdropRow title={s.title} items={s.items} onPressTitle={openGenre} />
      case 'ranked':
        return <RankedRow title={s.title} items={s.items} onPressTitle={openGenre} />
      case 'poster':
        return <PosterRow title={s.title} items={s.items} size={s.size} onPressTitle={openGenre} />
    }
  }

  // Al bajar, el título grande se va y queda una franja oscura detrás de la
  // hora y del menú (el "scroll edge" de iOS 26), así no flotan sobre pósters.
  const titleOpacity = scrollY.interpolate({ inputRange: [0, 60], outputRange: [1, 0], extrapolate: 'clamp' })
  const edgeOpacity = scrollY.interpolate({ inputRange: [0, 40], outputRange: [0, 1], extrapolate: 'clamp' })

  return shell(
    <>
      <Animated.FlatList
        ref={listRef as never}
        key="sections"
        style={styles.container}
        data={sections}
        keyExtractor={(s) => s.key}
        renderItem={({ item }) => renderSection(item)}
        contentContainerStyle={[styles.rows, { paddingTop: insets.top + 64 }]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        initialNumToRender={4}
        maxToRenderPerBatch={3}
        windowSize={7}
      />

      {/* Borde superior al hacer scroll: la hora y el menú quedan sobre negro
          y no sobre pósters de cualquier color. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.topEdge, { height: insets.top + 64, opacity: edgeOpacity }]}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.96)', 'rgba(0,0,0,0.75)', 'transparent']}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Título grande a la izquierda (se desvanece al bajar) y el menú de
          géneros a la derecha, siempre a mano — como el avatar del Inicio. */}
      <View style={[styles.header, { top: insets.top + 4 }]} pointerEvents="box-none">
        <Animated.Text style={[styles.bigTitle, styles.titleShadow, { opacity: titleOpacity }]}>
          {brand}
        </Animated.Text>
        {menu}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  bigTitle: screenTitle,
  titleShadow: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 },
  kicker: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },

  header: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0 },

  rows: { paddingBottom: 120 },
  section: { marginBottom: 24 },

  gridBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 14,
    alignItems: 'flex-end',
  },
  gridHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  gridCol: { gap: GRID_GAP, paddingHorizontal: GRID_PAD, marginBottom: GRID_GAP },
  gridContent: { paddingBottom: 120 },
})
