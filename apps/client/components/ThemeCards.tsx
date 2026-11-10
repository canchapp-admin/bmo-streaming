import { FlatList, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { isInSeason, themesForNow, type SearchTheme } from '@/lib/themes'
import { withAlpha } from '@/lib/color'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'

// Las piezas visuales de los temas del buscador (Navidad, Halloween…).
// Todas usan la misma receta: un degradado en diagonal entre los DOS colores
// del tema, un brillo arriba (volumen, como las tarjetas de canal de tvOS) y
// el símbolo del tema. Así un tema se reconoce igual en la tarjeta, en el
// banner del buscador y en su pantalla.

function ThemeFill({ theme }: { theme: SearchTheme }) {
  const [a, b] = theme.colors
  return (
    <>
      <LinearGradient
        colors={[a, withAlpha(b, 0.9)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Oscurece un poco abajo: el texto blanco se lee sobre cualquier color. */}
      <LinearGradient
        colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.35)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    </>
  )
}

// ── Banner del buscador ─────────────────────────────────────────────────
// Aparece arriba de los resultados cuando el texto es un tema. Lleva a la
// colección completa.
export function ThemeBanner({ theme }: { theme: SearchTheme }) {
  const router = useRouter()
  return (
    <Touchable
      scaleTo={0.98}
      haptic="light"
      onPress={() => router.push(`/theme/${theme.key}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Especial ${theme.name}. ${theme.tagline}. Ver especial`}
    >
      <View style={styles.banner}>
        <ThemeFill theme={theme} />
        {/* Símbolo grande y recortado al fondo: textura, no protagonista. */}
        <SymbolView name={theme.symbol as never} tintColor="rgba(255,255,255,0.12)" style={styles.bannerWatermark} />
        <Glass radius={22} variant="clear" style={styles.bannerIcon}>
          <SymbolView name={theme.symbol as never} weight="semibold" tintColor="#fff" style={styles.bannerIconSymbol} />
        </Glass>
        <View style={styles.bannerText}>
          <Text style={styles.kicker} maxFontSizeMultiplier={1.3}>
            {isInSeason(theme) ? 'Especial de temporada' : 'Especial'}
          </Text>
          <Text style={styles.bannerName} numberOfLines={1} maxFontSizeMultiplier={1.3}>{theme.name}</Text>
          <Text style={styles.bannerTagline} numberOfLines={1} maxFontSizeMultiplier={1.3}>{theme.tagline}</Text>
        </View>
        <SymbolView name="chevron.right" weight="semibold" tintColor="rgba(255,255,255,0.85)" style={styles.bannerChevron} />
      </View>
    </Touchable>
  )
}

// ── Fila "Especiales" del buscador vacío ─────────────────────────────────
// Para descubrirlos sin saber que existen. Los de temporada van primero y
// llevan un punto que lo indica.
const TILE_W = 156
const TILE_H = 104

function ThemeTile({ theme }: { theme: SearchTheme }) {
  const router = useRouter()
  const seasonal = isInSeason(theme)
  return (
    <Touchable
      scaleTo={0.95}
      haptic="light"
      onPress={() => router.push(`/theme/${theme.key}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Especial ${theme.name}${seasonal ? ', de temporada' : ''}`}
    >
      <View style={styles.tile}>
        <ThemeFill theme={theme} />
        <SymbolView name={theme.symbol as never} tintColor="rgba(255,255,255,0.22)" style={styles.tileWatermark} />
        {seasonal && (
          <View style={styles.seasonBadge}>
            <View style={styles.seasonDot} />
            <Text style={styles.seasonText}>Temporada</Text>
          </View>
        )}
        <Text style={styles.tileName} numberOfLines={2} maxFontSizeMultiplier={1.25}>{theme.name}</Text>
      </View>
    </Touchable>
  )
}

export function ThemeRow({ kids = false }: { kids?: boolean }) {
  const onScroll = useRowEndHaptic()
  const data = themesForNow(kids)
  return (
    <View style={styles.row}>
      <RowHeading title="Especiales" />
      <FlatList
        horizontal
        data={data}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => <ThemeTile theme={item} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Banner
  banner: {
    height: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  bannerWatermark: { position: 'absolute', right: -18, top: -14, width: 120, height: 120 },
  bannerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bannerIconSymbol: { width: 22, height: 22 },
  bannerText: { flex: 1 },
  kicker: {
    color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase',
  },
  bannerName: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 1 },
  bannerTagline: { color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 1 },
  bannerChevron: { width: 13, height: 13 },

  // Fila
  row: { marginBottom: 28 },
  list: { paddingHorizontal: 20, gap: 12 },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: 12,
    justifyContent: 'flex-end',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  tileWatermark: { position: 'absolute', right: -10, top: -8, width: 72, height: 72 },
  tileName: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  seasonBadge: {
    position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 8, height: 20, borderRadius: 10,
  },
  seasonDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  seasonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
})
