import { View, Text, FlatList, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { type MediaItem, posterUrl, titleOf } from '@/lib/tmdb'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { TitleMenu, menuItemFrom } from './TitleMenu'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'
import { colors } from '@/lib/theme'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// Top 10 grande, con el número gigante asomando detrás del póster: es la fila
// que más tiene que destacarse a simple vista.
const CARD_W = 136
const CARD_H = CARD_W * 1.5
const NUM_W = 56

function RankedCard({ item, rank }: { item: MediaItem; rank: number }) {
  const uri = posterUrl(item.poster_path, 'w500')
  const isTv = item.media_type === 'tv' || (!!item.name && !item.title)

  return (
    <TitleMenu item={menuItemFrom(item)}>
    <Touchable
      style={styles.card}
      haptic="light"
      onPressIn={() => prewarmTitle(item.id, isTv)}
    >
      <Text style={styles.num} maxFontSizeMultiplier={1} adjustsFontSizeToFit numberOfLines={1}>{rank}</Text>
      {uri ? (
        <Image source={uri} style={styles.poster} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={String(item.id)} />
      ) : (
        <View style={[styles.poster, styles.placeholder]}>
          <Text style={styles.placeholderText} numberOfLines={3}>{titleOf(item)}</Text>
        </View>
      )}
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
        getItemLayout={fixedItemLayout(NUM_W - 14 + CARD_W + 8)}
        {...rowVirtualization}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { marginBottom: 24 },
  list: { paddingHorizontal: 20, paddingLeft: 20 - NUM_W + 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginRight: 8,
  },
  num: {
    width: NUM_W,
    color: colors.text,
    fontSize: 84,
    fontWeight: '900',
    lineHeight: 84,
    letterSpacing: -6,
    textAlign: 'right',
    marginRight: -14,
    marginBottom: -6,
    zIndex: 1,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  poster: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 12,
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
