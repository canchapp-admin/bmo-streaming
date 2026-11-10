import { View, FlatList, StyleSheet } from 'react-native'
import { type MediaItem } from '@/lib/tmdb'
import { PosterCard } from './PosterCard'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// Ancho que ocupa cada tarjeta en la fila: los 124 del póster + su separación.
// Tiene que seguir a PosterCard; si cambia allá, cambia acá.
const POSTER_ITEM_W = 124 + 12

export function PosterRow({
  title,
  items,
  // Opcional: hace el encabezado tocable (con chevron) — lo usan las filas de
  // plataforma del catálogo para saltar a /studio/[key]. Mismo patrón que
  // ContinueRow ("Seguir viendo ›").
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
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PosterCard item={item} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
        getItemLayout={fixedItemLayout(POSTER_ITEM_W)}
        {...rowVirtualization}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 24,
  },
  list: {
    paddingHorizontal: 20,
  },
})
