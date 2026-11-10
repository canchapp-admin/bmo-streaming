import { View, Text, FlatList, StyleSheet, Dimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { type MediaItem, backdropUrl, titleOf } from '@/lib/tmdb'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { TitleMenu, menuItemFrom } from './TitleMenu'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'
import { colors } from '@/lib/theme'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

const { width } = Dimensions.get('window')
// md: dos tarjetas y media a la vista. lg: casi a lo ancho, como un cartel de
// cine — para filas que se lucen con la imagen horizontal.
const SIZES = { md: Math.round(width * 0.62), lg: Math.round(width * 0.84) } as const
const CARD_W = SIZES.md
const CARD_H = Math.round(CARD_W * 0.56)

function BackdropCard({ item, w }: { item: MediaItem; w: number }) {
  const big = w > CARD_W
  const uri = backdropUrl(item.backdrop_path, 'w780')
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)

  return (
    <TitleMenu item={menuItemFrom(item)}>
    <Touchable
      style={StyleSheet.flatten([styles.card, { width: w, height: Math.round(w * 0.56) }])}
      haptic="light"
      onPressIn={() => prewarmTitle(item.id, isTv)}
    >
      {uri ? (
        <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.8)']}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Text style={[styles.title, big && styles.titleBig]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{titleOf(item)}</Text>
    </Touchable>
    </TitleMenu>
  )
}

export function BackdropRow({
  title,
  items,
  onPressTitle,
  size = 'md',
}: {
  title: string
  items: MediaItem[]
  onPressTitle?: () => void
  size?: keyof typeof SIZES
}) {
  const w = SIZES[size]
  const onScroll = useRowEndHaptic()
  const filtered = items.filter((i) => i.backdrop_path)
  if (!filtered.length) return null

  return (
    <View style={styles.row}>
      <RowHeading title={title} onPress={onPressTitle} />
      <FlatList
        horizontal
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <BackdropCard item={item} w={w} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
        getItemLayout={fixedItemLayout(w + 10)}
        {...rowVirtualization}
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
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  placeholder: { backgroundColor: colors.surfaceHigh },
  title: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  titleBig: { fontSize: 18, bottom: 14, left: 14, right: 14, letterSpacing: -0.4 },
})
