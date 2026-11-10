import { View, Text, FlatList, StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Text as SvgText } from 'react-native-svg'
import { Image } from 'expo-image'
import { type MediaItem, posterUrl, titleOf } from '@/lib/tmdb'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { TitleMenu, menuItemFrom } from './TitleMenu'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'
import { colors } from '@/lib/theme'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// Top 10 grande, al estilo de los rankings de Apple TV: el número gigante
// queda DETRÁS del póster y asoma por su izquierda.
//
//  · El número es un contorno claro con relleno casi transparente (SVG), no
//    un bloque blanco: se lee enorme sin pelearse con el póster ni con fondos
//    de color (pantallas de marca o de especial).
//  · Cada número tiene su ancho: el "10" ocupa casi el doble que el "1". Antes
//    todos compartían 56 pt y el 10 salía achicado y cortado.
const CARD_W = 136
const CARD_H = CARD_W * 1.5
const NUM_SIZE = 150 // alto del número (pt)
const OVERLAP = 30 // cuánto del número queda tapado por el póster
const GAP = 10
const numWidth = (rank: number) => (rank >= 10 ? 156 : rank === 1 ? 74 : 92)

function RankNumber({ rank }: { rank: number }) {
  const w = numWidth(rank)
  const h = CARD_H
  const id = `rank-${rank}`
  return (
    <Svg width={w} height={h} style={styles.num} pointerEvents="none">
      <Defs>
        <SvgGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.02" />
        </SvgGradient>
      </Defs>
      <SvgText
        x={w}
        // Base del número apenas por debajo del borde del póster: el número
        // "apoya" en el suelo de la fila.
        y={h - 4}
        textAnchor="end"
        fontSize={NUM_SIZE}
        fontWeight="900"
        letterSpacing={rank >= 10 ? -10 : 0}
        fill={`url(#${id})`}
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      >
        {String(rank)}
      </SvgText>
    </Svg>
  )
}

function RankedCard({ item, rank }: { item: MediaItem; rank: number }) {
  const uri = posterUrl(item.poster_path, 'w500')
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)
  const numW = numWidth(rank)

  return (
    <TitleMenu item={menuItemFrom(item)}>
    <Touchable
      style={StyleSheet.flatten([styles.card, { width: numW - OVERLAP + CARD_W }])}
      haptic="light"
      onPressIn={() => prewarmTitle(item.id, isTv)}
      accessibilityLabel={`Número ${rank}: ${titleOf(item)}`}
    >
      {/* Primero el número y después el póster: el póster queda encima. */}
      <RankNumber rank={rank} />
      <View style={[styles.posterWrap, { left: numW - OVERLAP }]}>
        {uri ? (
          <Image source={uri} style={styles.poster} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
        ) : (
          <View style={[styles.poster, styles.placeholder]}>
            <Text style={styles.placeholderText} numberOfLines={3}>{titleOf(item)}</Text>
          </View>
        )}
      </View>
    </Touchable>
    </TitleMenu>
  )
}

export function RankedRow({
  title,
  items,
  onPressTitle,
}: {
  title: string
  items: MediaItem[]
  onPressTitle?: () => void
}) {
  const onScroll = useRowEndHaptic()
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      <RowHeading title={title} onPress={onPressTitle} />
      <FlatList
        horizontal
        data={items.slice(0, 10)}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => <RankedCard item={item} rank={index + 1} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
        // Todos miden lo mismo salvo el 10, que es el último: los offsets de
        // los anteriores siguen siendo exactos.
        getItemLayout={fixedItemLayout(numWidth(2) - OVERLAP + CARD_W + GAP)}
        {...rowVirtualization}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: 24 },
  list: { paddingLeft: 12, paddingRight: 20 },
  card: { height: CARD_H, marginRight: GAP },
  num: { position: 'absolute', left: 0, bottom: 0 },
  posterWrap: {
    position: 'absolute',
    top: 0,
    // Sombra hacia la izquierda: despega el póster del número que tapa.
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: -4, height: 0 },
  },
  poster: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
})
