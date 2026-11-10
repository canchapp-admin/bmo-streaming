import { useRef } from 'react'
import { Animated, View, Text, StyleSheet, Dimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tmdb, backdropUrl, titleOf, type MediaItem } from '@/lib/tmdb'
import { SEARCH_THEMES, isInSeason } from '@/lib/themes'
import { useAsync } from '@/lib/useAsync'
import { useAuth } from '@/lib/auth'
import { forProfile } from '@/lib/kidsFilter'
import { dedupeRows } from '@/lib/dedupeRows'
import { useReduceMotion } from '@/lib/useReduceMotion'
import { fadeTo, mix, withAlpha } from '@/lib/color'
import { BackButton } from '@/components/BackButton'
import { Glass } from '@/components/Glass'
import { Touchable } from '@/components/Touchable'
import { PosterRow } from '@/components/PosterRow'
import { BackdropRow } from '@/components/BackdropRow'
import { RankedRow } from '@/components/RankedRow'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonRow } from '@/components/Skeleton'
import { colors } from '@/lib/theme'

const { width } = Dimensions.get('window')
const HERO_H = Math.round(width * 1.12)

// Pantalla de un tema del buscador (Navidad, Halloween, Terror…).
//
// Misma familia que las pantallas de marca, pero con identidad de TEMA:
//  · El hero es la foto de un título destacado bañada en los DOS colores del
//    tema (rojo y verde en Navidad, naranja y violeta en Halloween), con el
//    símbolo del tema en vidrio, su nombre y una línea que lo vende.
//  · El fondo sigue teñido debajo del hero y se apaga a negro: hero y fondo
//    empalman en el mismo color opaco, sin costura.
//  · Las filas vienen armadas desde la API (palabras clave de TMDB) y acá se
//    les quitan los repetidos: la primera fila que pide un título se lo queda.
export default function ThemeScreen() {
  const router = useRouter()
  const { key } = useLocalSearchParams<{ key: string }>()
  const insets = useSafeAreaInsets()
  const { profile } = useAuth()
  const kids = !!profile?.is_kids
  const reduceMotion = useReduceMotion()
  const theme = SEARCH_THEMES.find((t) => t.key === key)
  // Misma cacheKey que la vista previa del buscador: al entrar ya está cargado.
  const { data, loading, error, refetch } = useAsync(() => tmdb.theme(key!), [key], `theme:${key}`)
  const scrollY = useRef(new Animated.Value(0)).current

  if (!theme || (kids && theme.adult)) {
    return (
      <View style={[styles.container, styles.center]}>
        <EmptyState
          icon="lock.fill"
          title={theme ? 'No disponible en este perfil' : 'Especial no encontrado'}
          subtitle={theme ? 'Este especial no se muestra en perfiles infantiles.' : undefined}
        />
        <BackButton style={[styles.backBtn, { top: insets.top + 6 }]} />
      </View>
    )
  }

  const [primary, secondary] = theme.colors
  // Color de empalme: el principal muy oscurecido (rojo → bordó casi negro).
  const base = mix(primary, 0.2)

  const rawRows = (data?.rows ?? []).map((r, i) => ({
    ...r,
    key: String(i),
    items: forProfile(r.results.map((x) => ({ ...x, media_type: r.type }) as MediaItem), kids),
  }))
  const deduped = dedupeRows(rawRows)
  const rows = rawRows
    .map((r) => ({ ...r, items: deduped[r.key] ?? [] }))
    .filter((r) => r.items.length >= 6)

  const featured = rows[0]?.items.find((i) => i.backdrop_path)
  const heroUrl = backdropUrl(featured?.backdrop_path ?? null, 'w1280')
  const openFeatured = () =>
    featured && router.push(`/title/${featured.media_type === 'tv' ? 'tv' : 'movie'}/${featured.id}` as never)

  const heroShift = reduceMotion
    ? 0
    : scrollY.interpolate({ inputRange: [-200, 0, HERO_H], outputRange: [-60, 0, HERO_H * 0.35], extrapolate: 'clamp' })
  const edgeOpacity = scrollY.interpolate({ inputRange: [HERO_H - 180, HERO_H - 80], outputRange: [0, 1], extrapolate: 'clamp' })
  const fade = fadeTo(base)

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {/* Fondo teñido bajo el hero: arranca en `base` (el mismo color en que
            termina el hero), pasa por el segundo color del tema y se apaga. */}
        <LinearGradient
          colors={[base, mix(secondary, 0.12), '#000']}
          locations={[0, 0.4, 1]}
          style={[styles.ambient, { top: HERO_H }]}
          pointerEvents="none"
        />

        {/* ── Hero ── */}
        <View style={styles.hero}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: heroShift }] }]}>
            {heroUrl ? (
              <Image source={heroUrl} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
            ) : (
              <LinearGradient colors={[primary, secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
          </Animated.View>
          {/* Baño en los dos colores del tema, en diagonal. */}
          <LinearGradient
            colors={[withAlpha(primary, 0.45), withAlpha(primary, 0.08), withAlpha(secondary, 0.4)]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Sombra neutra arriba (hora y botón de volver). */}
          <LinearGradient colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} locations={[0, 0.28]} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={fade.colors} locations={fade.locations} style={StyleSheet.absoluteFill} />

          <View style={styles.heroContent}>
            <Glass radius={26} variant="clear" tint={withAlpha(primary, 0.3)} style={styles.symbolBadge}>
              <SymbolView name={theme.symbol as never} weight="semibold" tintColor="#fff" style={styles.symbol} />
            </Glass>
            <Text style={styles.kicker} maxFontSizeMultiplier={1.3}>
              {isInSeason(theme) ? 'Especial de temporada' : 'Especial'}
            </Text>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
              {theme.name}
            </Text>
            <Text style={styles.tagline} maxFontSizeMultiplier={1.4}>{theme.tagline}</Text>

            {featured && (
              <Touchable
                scaleTo={0.96}
                haptic="light"
                onPress={openFeatured}
                accessibilityRole="button"
                accessibilityLabel={`Destacado: ${titleOf(featured)}. Ver ficha`}
              >
                <Glass radius={22} interactive tint="rgba(0,0,0,0.25)" style={styles.featured}>
                  <Text style={styles.featuredLabel} maxFontSizeMultiplier={1.3}>Destacado</Text>
                  <Text style={styles.featuredTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>{titleOf(featured)}</Text>
                  <SymbolView name="chevron.right" weight="semibold" tintColor="#fff" style={styles.featuredChevron} />
                </Glass>
              </Touchable>
            )}
          </View>
        </View>

        {/* ── Filas ── */}
        {loading && !data ? (
          <View style={styles.skeletonRows}>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </View>
        ) : error && !data ? (
          <View style={styles.errorBox}>
            <EmptyState
              icon="wifi.slash"
              title="No se pudo cargar el especial"
              subtitle="Revisa tu conexión e intenta de nuevo."
              action={{ label: 'Reintentar', onPress: refetch }}
            />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.errorBox}>
            <EmptyState icon="sparkles" title="Pronto habrá más" subtitle="Todavía no hay títulos para este especial." />
          </View>
        ) : (
          <View style={styles.rows}>
            {rows.map((r, i) => {
              if (r.style === 'ranked') return <RankedRow key={r.key} title={r.title} items={r.items.slice(0, 10)} />
              if (r.style === 'backdrop') return <BackdropRow key={r.key} title={r.title} items={r.items} size={i === 0 ? 'lg' : 'md'} />
              return <PosterRow key={r.key} title={r.title} items={r.items} size={i === 0 ? 'lg' : 'md'} />
            })}
          </View>
        )}
      </Animated.ScrollView>

      <Animated.View pointerEvents="none" style={[styles.topEdge, { height: insets.top + 60, opacity: edgeOpacity }]}>
        <LinearGradient colors={['rgba(0,0,0,0.95)', 'rgba(0,0,0,0.6)', 'transparent']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <BackButton style={[styles.backBtn, { top: insets.top + 6 }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  ambient: { position: 'absolute', left: 0, right: 0, height: 1000 },
  hero: { height: HERO_H, overflow: 'hidden' },
  heroContent: { position: 'absolute', left: 20, right: 20, bottom: 24 },
  symbolBadge: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  symbol: { width: 26, height: 26 },
  kicker: {
    color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  title: {
    color: '#fff', fontSize: 46, fontWeight: '900', letterSpacing: -1.6,
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 14,
  },
  tagline: { color: colors.textDim, fontSize: 16, lineHeight: 21, marginTop: 4 },
  featured: {
    marginTop: 18, alignSelf: 'flex-start', maxWidth: '100%',
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16,
  },
  featuredLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  featuredTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  featuredChevron: { width: 11, height: 11 },
  rows: { paddingTop: 12 },
  skeletonRows: { paddingTop: 20, gap: 28 },
  errorBox: { paddingTop: 60, alignItems: 'center' },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0 },
  backBtn: { position: 'absolute', left: 16, zIndex: 10 },
})
