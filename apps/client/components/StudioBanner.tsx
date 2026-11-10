import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { STUDIO_BRANDS, type StudioBrand } from '@/lib/studios'
import { Touchable } from './Touchable'
import { BRAND_ART, LOGO_BASE } from './PlatformRow'

// Banner de marca en el buscador (buscar "amazon", "disney"…) → abre su
// catálogo. Usa el mismo arte que las tarjetas de Plataformas y Franquicias:
// fondo de la marca y su logo real, en vez del nombre escrito a mano. Las
// marcas sin logo cargado (Warner, Universal…) siguen con el nombre en texto.
export function StudioBanner({ brand }: { brand: StudioBrand }) {
  const router = useRouter()
  const art = BRAND_ART[brand.key]
  const name = STUDIO_BRANDS.find((b) => b.key === brand.key)?.name ?? brand.name

  return (
    <Touchable
      scaleTo={0.98}
      haptic="light"
      onPress={() => router.push(`/studio/${brand.key}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Ver el catálogo de ${name}`}
    >
      <LinearGradient
        colors={art?.bg ?? brand.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0.16)', 'transparent']}
          locations={[0, 0.6]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.brand}>
          {art ? (
            <Image
              source={LOGO_BASE + art.logo}
              style={styles.logo}
              contentFit="contain"
              contentPosition="left"
              tintColor={art.tint}
              cachePolicy="memory-disk"
              transition={200}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
          )}
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Ver catálogo</Text>
          <SymbolView name="chevron.right" weight="semibold" tintColor="#fff" style={styles.ctaIcon} />
        </View>
      </LinearGradient>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  card: {
    height: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  brand: { flex: 1, height: 48, justifyContent: 'center' },
  logo: { width: '100%', height: '100%' },
  name: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  ctaText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ctaIcon: { width: 10, height: 10 },
})
