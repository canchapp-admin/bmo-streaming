import { FlatList, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { STUDIO_BRANDS, type StudioBrand } from '@/lib/studios'
import { Touchable } from './Touchable'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'

// Plataformas como tarjetas, al estilo de los canales de la app Apple TV.
// Reemplaza las cinco filas "Lo mejor de Netflix / HBO / …": en BMO está todo,
// así que la plataforma no es dónde se ve algo sino una forma de explorar.
// Cada tarjeta abre el catálogo de esa marca (/studio/[key]).
const ALL = ['netflix', 'hbo', 'disney', 'appletv', 'prime', 'marvel', 'starwars', 'pixar', 'dreamworks']
// Perfiles infantiles: solo las marcas de animación y familia.
const KIDS = ['disney', 'pixar', 'dreamworks']

const CARD_W = 150
const CARD_H = 84

function PlatformCard({ brand }: { brand: StudioBrand }) {
  const router = useRouter()
  return (
    <Touchable
      scaleTo={0.95}
      haptic="light"
      onPress={() => router.push(`/studio/${brand.key}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Catálogo de ${brand.name}`}
    >
      <LinearGradient colors={brand.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        {/* Brillo superior: le da el volumen de las tarjetas de canal de tvOS */}
        <LinearGradient
          colors={['rgba(255,255,255,0.18)', 'transparent']}
          locations={[0, 0.55]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
          {brand.name}
        </Text>
      </LinearGradient>
    </Touchable>
  )
}

export function PlatformRow({ kids = false }: { kids?: boolean }) {
  const onScroll = useRowEndHaptic()
  const keys = kids ? KIDS : ALL
  const brands = keys
    .map((k) => STUDIO_BRANDS.find((b) => b.key === k))
    .filter((b): b is StudioBrand => !!b)

  return (
    <View style={styles.row}>
      <RowHeading title="Plataformas" />
      <FlatList
        horizontal
        data={brands}
        keyExtractor={(b) => b.key}
        renderItem={({ item }) => <PlatformCard brand={item} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: 24 },
  list: { paddingHorizontal: 20, gap: 10 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  name: { color: '#fff', fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
})
