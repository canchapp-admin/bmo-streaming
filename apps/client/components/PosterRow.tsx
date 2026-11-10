import { View, FlatList, StyleSheet } from 'react-native'
import { type MediaItem } from '@/lib/tmdb'
import { PosterCard } from './PosterCard'
import { RowHeading } from './RowHeading'
import { useRowEndHaptic } from '@/lib/useRowEndHaptic'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// Dos tamaños de póster para darle ritmo al Home: filas "normales" y filas
// protagonistas, más grandes. Alternarlas evita la grilla monótona de pósters
// todos iguales (es lo que hace la app Apple TV entre sus estantes).
const SIZES = { md: 140, lg: 176 } as const
const GAP = 12

export function PosterRow({
  title,
  items,
  // Opcional: hace el encabezado tocable (con chevron) — lo usan las filas de
  // plataforma del catálogo para saltar a /studio/[key]. Mismo patrón que
  // ContinueRow ("Seguir viendo ›").
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
  if (!items?.length) return null

  return (
    <View style={styles.row}>
      <RowHeading title={title} onPress={onPressTitle} />
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PosterCard item={item} width={w} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={styles.list}
        getItemLayout={fixedItemLayout(w + GAP)}
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
    gap: GAP,
  },
})
