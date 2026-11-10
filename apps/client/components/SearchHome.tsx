import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { backdropUrl, titleOf, type Category, type MediaItem } from '@/lib/tmdb'
import { TitleMenu, menuItemFrom } from './TitleMenu'
import { Touchable } from './Touchable'
import { RowHeading } from './RowHeading'
import { PlatformRow, FranchiseRow } from './PlatformRow'
import { ThemeRow } from './ThemeCards'
import { colors } from '@/lib/theme'

const KIDS_GENRES = new Set([16, 10751, 10762])

// Estado inicial de Buscar (sin texto), como la búsqueda de la app Apple TV:
// primero lo personal (búsquedas recientes), después lo popular (lo más
// buscado), después explorar (plataformas, franquicias, géneros). Antes era
// una sola grilla de tarjetas iguales que mezclaba marcas y géneros con fotos
// al azar, sin título ni jerarquía.
export function SearchHome({
  recent,
  onPickRecent,
  onClearRecent,
  trending,
  categories,
  kids,
}: {
  recent: string[]
  onPickRecent: (q: string) => void
  onClearRecent: () => void
  trending: MediaItem[]
  categories: Category[]
  kids: boolean
}) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const tileW = Math.floor((width - 40 - 12) / 2)
  const genres = categories.filter(
    (c) => c.genreId != null && (!kids || KIDS_GENRES.has(c.genreId))
  )

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      // "automatic" deja que iOS ubique el contenido bajo el título grande nativo.
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {recent.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.heading}>Recientes</Text>
            <Touchable scaleTo={0.94} haptic="light" onPress={onClearRecent} hitSlop={8} accessibilityRole="button">
              <Text style={styles.clear}>Borrar</Text>
            </Touchable>
          </View>
          <View style={styles.group}>
            {recent.map((q, i) => (
              <View key={q}>
                {i > 0 && <View style={styles.separator} />}
                <Touchable scaleTo={0.99} haptic="selection" onPress={() => onPickRecent(q)} style={styles.recentRow}>
                  <SymbolView name="clock.arrow.circlepath" tintColor={colors.textMuted} style={styles.recentIcon} />
                  <Text style={styles.recentText} numberOfLines={1}>{q}</Text>
                  <SymbolView name="arrow.up.left" tintColor={colors.textMuted} style={styles.recentArrow} />
                </Touchable>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Especiales (Navidad, Halloween…): los de temporada primero. */}
      <ThemeRow kids={kids} />

      {trending.length > 0 && (
        <View style={styles.section}>
          <RowHeading title="Lo más buscado" />
          {/* Sin caja: filas sueltas sobre el negro, número grande y miniatura
              amplia — antes era una tarjeta gris con miniaturas adentro
              (cuadrado dentro de cuadrado). */}
          <View style={styles.topList}>
            {trending.slice(0, 6).map((item, i) => {
              const type = item.media_type === 'tv' || (!!item.name && !item.title) ? 'tv' : 'movie'
              const img = backdropUrl(item.backdrop_path, 'w300')
              const year = (item.release_date ?? item.first_air_date ?? '').slice(0, 4)
              return (
                <TitleMenu key={`${type}-${item.id}`} item={menuItemFrom({ ...item, media_type: type })}>
                <Touchable
                  scaleTo={0.98}
                  haptic="light"
                  style={styles.topRow}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}. ${titleOf(item)}`}
                >
                  <Text style={styles.rank} maxFontSizeMultiplier={1.2}>{i + 1}</Text>
                  {img ? (
                    <Image source={img} style={styles.topThumb} contentFit="cover" transition={150} cachePolicy="memory-disk" />
                  ) : (
                    <View style={styles.topThumb} />
                  )}
                  <View style={styles.flex}>
                    <Text style={styles.topTitle} numberOfLines={2} maxFontSizeMultiplier={1.4}>{titleOf(item)}</Text>
                    <Text style={styles.topMeta} maxFontSizeMultiplier={1.4}>
                      {type === 'tv' ? 'Serie' : 'Película'}{year ? ` · ${year}` : ''}
                    </Text>
                  </View>
                </Touchable>
                </TitleMenu>
              )
            })}
          </View>
        </View>
      )}

      <PlatformRow kids={kids} />
      <FranchiseRow kids={kids} />

      {genres.length > 0 && (
        <View style={styles.section}>
          <RowHeading title="Géneros" />
          <View style={styles.grid}>
            {genres.map((c) => {
              const img = backdropUrl(c.backdrop_path, 'w780')
              return (
                <Touchable
                  key={`${c.type}-${c.genreId}`}
                  scaleTo={0.96}
                  haptic="light"
                  onPress={() =>
                    router.push({
                      pathname: '/browse/[type]/[id]',
                      params: { type: c.type, id: String(c.genreId), name: c.name },
                    })
                  }
                  style={StyleSheet.flatten([styles.tile, { width: tileW, height: Math.round(tileW * 0.56) }])}
                >
                  {img ? (
                    <Image source={img} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" />
                  ) : null}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.8)']}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text style={styles.tileName} numberOfLines={1} maxFontSizeMultiplier={1.3}>{c.name}</Text>
                </Touchable>
              )
            })}
          </View>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { paddingBottom: 140 },
  flex: { flex: 1 },
  section: { marginBottom: 28 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12,
  },
  heading: { color: colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  clear: { color: colors.textDim, fontSize: 15, fontWeight: '600' },

  // Listas agrupadas de iOS, igual que Descargas en Biblioteca.
  group: {
    marginHorizontal: 20,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: 46 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 48 },
  recentIcon: { width: 18, height: 18 },
  recentText: { flex: 1, color: colors.text, fontSize: 16 },
  recentArrow: { width: 13, height: 13 },

  topList: { paddingHorizontal: 20, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rank: { width: 28, color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },
  topThumb: { width: 128, height: 72, borderRadius: 10, borderCurve: 'continuous', backgroundColor: colors.surface },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  topMeta: { color: colors.textMuted, fontSize: 13, marginTop: 3 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20 },
  tile: { borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.surface, justifyContent: 'flex-end' },
  tileName: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2, padding: 12 },
})
