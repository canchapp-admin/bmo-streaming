import { FlatList, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { STUDIO_BRANDS } from '@/lib/studios'
import { Touchable } from './Touchable'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'

// Plataformas y franquicias como tarjetas de canal, al estilo de la app Apple TV: fondo con
// la identidad de la marca y su logo real encima. Reemplaza las cinco filas
// "Lo mejor de Netflix / HBO / …" y abre el catálogo de esa marca.
//
// Los logos son los oficiales que TMDB publica para cada servicio (network) o
// estudio (company), servidos desde image.tmdb.org como el resto del arte.
// Cada uno lleva su tratamiento: hay logos negros (Pixar, Apple TV) que sobre
// fondo oscuro desaparecen, así que esos van en blanco (`tint`); Netflix y
// Marvel se ven mejor con sus colores de siempre.
export type Platform = {
  key: string
  logo: string // ruta de TMDB
  bg: [string, string]
  tint?: string // pinta el logo de un solo color; sin esto, colores originales
  logoW?: number // ancho relativo (0–1) — los logos altos se ven enormes a ancho completo
}

export const LOGO_BASE = 'https://image.tmdb.org/t/p/w500'

// Plataformas: solo servicios de streaming.
const PLATFORMS: Platform[] = [
  { key: 'netflix', logo: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png', bg: ['#1A1A1A', '#000000'] },
  { key: 'hbo', logo: '/nmU0UMDJB3dRRQSTUqawzF2Od1a.png', bg: ['#7B2FF7', '#2A0B66'], tint: '#fff' },
  { key: 'disney', logo: '/1edZOYAfoyZyZ3rklNSiUpXX30Q.png', bg: ['#1F4FD8', '#0A1A5C'], tint: '#fff', logoW: 0.56 },
  { key: 'appletv', logo: '/bngHRFi794mnMq34gfVcm9nDxN1.png', bg: ['#3A3A3C', '#0E0E10'], tint: '#fff', logoW: 0.42 },
  { key: 'prime', logo: '/w7HfLNm9CWwRmAMU58udl2L7We7.png', bg: ['#1FA2FF', '#0A3F7A'], tint: '#fff', logoW: 0.62 },
  { key: 'paramountplus', logo: '/fi83B1oztoS47xxcemFdPMhIzK.png', bg: ['#0064FF', '#002A6B'], tint: '#fff', logoW: 0.66 },
  { key: 'peacock', logo: '/gIAcGTjKKr0KOHL5s4O36roJ8p7.png', bg: ['#2A2A2E', '#000000'], tint: '#fff', logoW: 0.6 },
]

// Franquicias y estudios con identidad propia: lo que uno busca por "universo"
// más que por servicio.
const FRANCHISES: Platform[] = [
  { key: 'marvel', logo: '/hUzeosd33nzE5MCNsZxCGEKTXaQ.png', bg: ['#F4F4F4', '#D9D9D9'] },
  { key: 'dc', logo: '/4Y00XuSMuP1gimd0jP6JT57QbCI.png', bg: ['#0B2A66', '#050F26'], logoW: 0.36 },
  // TMDB no tiene logo propio de Star Wars: se usa el de Lucasfilm, su casa.
  { key: 'starwars', logo: '/tlVSws0RvvtPBwViUyOFAO0vcQS.png', bg: ['#1C1C1C', '#000000'], tint: '#FFE81F', logoW: 0.6 },
  { key: 'pixar', logo: '/1TjvGVDMYsj6JBxOAkUHpPEwLf7.png', bg: ['#2AA5E0', '#0D5C8A'], tint: '#fff', logoW: 0.62 },
  { key: 'disneyanimation', logo: '/8bH86UPmMP8hlITzXV3XgV9eaAc.png', bg: ['#1B3A8C', '#0A1640'], tint: '#fff', logoW: 0.66 },
  { key: 'dreamworks', logo: '/3BPX5VGBov8SDqTV7wC1L1xShAS.png', bg: ['#1E6FCC', '#0B2E5C'], tint: '#fff', logoW: 0.5 },
  { key: 'illumination', logo: '/fOG2oY4m1YuYTQh4bMqqZkmgOAI.png', bg: ['#F5C518', '#C79100'], tint: '#111', logoW: 0.66 },
  { key: 'ghibli', logo: '/uFuxPEZRUcBTEiYIxjHJq62Vr77.png', bg: ['#3C8F6B', '#14402D'], tint: '#fff', logoW: 0.66 },
  { key: 'blumhouse', logo: '/rzKluDcRkIwHZK2pHsiT667A2Kw.png', bg: ['#3A0D0D', '#000000'], tint: '#fff', logoW: 0.62 },
]

// Arte de cada marca por clave, para reusarlo fuera de las filas (el banner
// de marca del buscador).
export const BRAND_ART: Record<string, Platform> = Object.fromEntries(
  [...PLATFORMS, ...FRANCHISES].map((p) => [p.key, p])
)

// Perfiles infantiles: solo marcas de animación y familia.
const KIDS = new Set(['disney', 'pixar', 'disneyanimation', 'dreamworks', 'illumination', 'ghibli'])

const CARD_W = 208
const CARD_H = 117 // 16:9

function PlatformCard({ p }: { p: Platform }) {
  const router = useRouter()
  const name = STUDIO_BRANDS.find((b) => b.key === p.key)?.name ?? p.key
  const logoW = CARD_W * (p.logoW ?? 0.7)
  return (
    <Touchable
      scaleTo={0.95}
      haptic="light"
      onPress={() => router.push(`/studio/${p.key}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Catálogo de ${name}`}
    >
      <LinearGradient colors={p.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        {/* Brillo superior: el volumen de las tarjetas de canal de tvOS */}
        <LinearGradient
          colors={['rgba(255,255,255,0.16)', 'transparent']}
          locations={[0, 0.55]}
          style={StyleSheet.absoluteFill}
        />
        <Image
          source={LOGO_BASE + p.logo}
          style={{ width: logoW, height: CARD_H * 0.5 }}
          contentFit="contain"
          tintColor={p.tint}
          cachePolicy="memory-disk"
          transition={200}
          accessibilityIgnoresInvertColors
        />
      </LinearGradient>
    </Touchable>
  )
}

function BrandRow({ title, brands, kids }: { title: string; brands: Platform[]; kids: boolean }) {
  const onScroll = useRowEndHaptic()
  const data = kids ? brands.filter((p) => KIDS.has(p.key)) : brands
  if (!data.length) return null

  return (
    <View style={styles.row}>
      <RowHeading title={title} />
      <FlatList
        horizontal
        data={data}
        keyExtractor={(p) => p.key}
        renderItem={({ item }) => <PlatformCard p={item} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
      />
    </View>
  )
}

export function PlatformRow({ kids = false }: { kids?: boolean }) {
  return <BrandRow title="Plataformas" brands={PLATFORMS} kids={kids} />
}

export function FranchiseRow({ kids = false }: { kids?: boolean }) {
  return <BrandRow title="Franquicias" brands={FRANCHISES} kids={kids} />
}

const styles = StyleSheet.create({
  row: { marginBottom: 28 },
  list: { paddingHorizontal: 20, gap: 12 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
})
