import { FlatList, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { isInSeason, themesForNow, type SearchTheme } from '@/lib/themes'
import { mix, withAlpha } from '@/lib/color'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'

// Las piezas visuales de los temas del buscador (Navidad, Halloween…).
// Receta común: la IMAGEN del tema (un título icónico: Mi pobre angelito,
// Coco, Interstellar…) y encima una sombra en el color PRINCIPAL del tema,
// oscurecido. Antes era un degradado entre los dos colores y en temas como
// Navidad (rojo → verde) el medio quedaba marrón.

const ART_BASE = 'https://image.tmdb.org/t/p/'

function ThemeArt({ theme, size = 'w780' }: { theme: SearchTheme; size?: string }) {
  return (
    <Image
      source={ART_BASE + size + theme.art}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={200}
      cachePolicy="memory-disk"
      accessibilityIgnoresInvertColors
    />
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
      accessibilityLabel={`${theme.franchise ? 'Franquicia' : 'Especial'} ${theme.name}. ${theme.tagline}. Ver`}
    >
      <View style={[styles.banner, { backgroundColor: mix(theme.colors[0], 0.25) }]}>
        {/* La imagen ocupa la mitad derecha y se funde hacia la izquierda en
            el color del tema, donde va el texto. */}
        <View style={styles.bannerArt}>
          <ThemeArt theme={theme} />
        </View>
        <LinearGradient
          colors={[mix(theme.colors[0], 0.25), withAlpha(mix(theme.colors[0], 0.25), 0.85), withAlpha(mix(theme.colors[0], 0.25), 0)]}
          locations={[0.35, 0.55, 0.9]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.bannerText}>
          <View style={styles.kickerRow}>
            <SymbolView name={theme.symbol as never} weight="semibold" tintColor={tone(theme)} style={styles.kickerSymbol} />
            <Text style={[styles.kicker, { color: tone(theme) }]} maxFontSizeMultiplier={1.3}>
              {theme.franchise ? 'Franquicia' : isInSeason(theme) ? 'Especial de temporada' : 'Especial'}
            </Text>
          </View>
          {theme.logo ? (
            <Image
              source={ART_BASE + 'w500' + theme.logo}
              style={styles.bannerLogo}
              contentFit="contain"
              contentPosition="left"
              accessibilityLabel={theme.name}
            />
          ) : (
            <Text style={styles.bannerName} numberOfLines={1} maxFontSizeMultiplier={1.3}>{theme.name}</Text>
          )}
          <Text style={styles.bannerTagline} numberOfLines={2} maxFontSizeMultiplier={1.3}>{theme.tagline}</Text>
        </View>
        <Glass radius={16} variant="clear" style={styles.bannerCta}>
          <SymbolView name="chevron.right" weight="bold" tintColor="#fff" style={styles.bannerChevron} />
        </Glass>
      </View>
    </Touchable>
  )
}

// ── Fila "Especiales" del buscador vacío ─────────────────────────────────
// Para descubrirlos sin saber que existen. Los de temporada van primero y
// llevan "De temporada" arriba del nombre.
const TILE_W = 232
const TILE_H = 130 // 16:9

function ThemeTile({ theme }: { theme: SearchTheme }) {
  const router = useRouter()
  const seasonal = isInSeason(theme)
  const shade = mix(theme.colors[0], 0.3)
  return (
    <Touchable
      scaleTo={0.95}
      haptic="light"
      onPress={() => router.push(`/theme/${theme.key}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Especial ${theme.name}${seasonal ? ', de temporada' : ''}`}
    >
      <View style={[styles.tile, { backgroundColor: shade }]}>
        <ThemeArt theme={theme} size="w500" />
        {/* Sombra en el color del tema, de abajo hacia arriba: tiñe la imagen
            con la identidad del tema y deja legible el nombre. */}
        <LinearGradient
          colors={[withAlpha(shade, 0), withAlpha(shade, 0.55), withAlpha(shade, 0.95)]}
          locations={[0.25, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tileText}>
          {seasonal && (
            <Text style={[styles.tileKicker, { color: tone(theme) }]} maxFontSizeMultiplier={1.25}>
              De temporada
            </Text>
          )}
          <View style={styles.tileNameRow}>
            <SymbolView name={theme.symbol as never} weight="semibold" tintColor="#fff" style={styles.tileSymbol} />
            <Text style={styles.tileName} numberOfLines={1} maxFontSizeMultiplier={1.25}>{theme.name}</Text>
          </View>
        </View>
      </View>
    </Touchable>
  )
}

// Versión clara del color del tema para los textos chicos ("De temporada"):
// el color puro sobre su propia sombra no se lee; mezclado con blanco, sí.
function tone(theme: SearchTheme) {
  const n = parseInt(theme.colors[0].slice(1), 16)
  const lift = (c: number) => Math.round(c + (255 - c) * 0.55)
  return `rgb(${lift((n >> 16) & 255)}, ${lift((n >> 8) & 255)}, ${lift(n & 255)})`
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
    height: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 18,
    paddingRight: 14,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  bannerArt: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '62%' },
  bannerText: { flex: 1 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  kickerSymbol: { width: 12, height: 12 },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  bannerLogo: { width: '100%', height: 38, marginVertical: 2 },
  bannerName: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  bannerTagline: { color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 17, marginTop: 2, maxWidth: '85%' },
  bannerCta: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  bannerChevron: { width: 12, height: 12 },

  // Fila
  row: { marginBottom: 28 },
  list: { paddingHorizontal: 20, gap: 12 },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  tileText: { padding: 14 },
  tileKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 },
  tileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tileSymbol: { width: 17, height: 17 },
  tileName: { flexShrink: 1, color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
})
