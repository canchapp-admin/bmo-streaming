import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getContinueWatching, type Progress } from '@/lib/library'
import { ContinueCard } from '@/components/ContinueCard'
import { BackButton } from '@/components/BackButton'
import { EmptyState } from '@/components/EmptyState'
import { screenTitle } from '@/lib/typography'
import { colors } from '@/lib/theme'

// "Seguir viendo" completo: las mismas tarjetas grandes de la fila, a todo el
// ancho y en vertical. Es a donde lleva "Ver todo" cuando hay más de 10.
export default function ContinueScreen() {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [items, setItems] = useState<Progress[]>([])
  const reload = useCallback(() => { getContinueWatching().then(setItems) }, [])
  useFocusEffect(reload)

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(p) => `${p.media_type}-${p.id}`}
        renderItem={({ item }) => <ContinueCard item={item} width={width - 40} onRemove={reload} />}
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 40 }]}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Seguir viendo</Text>
            {items.length > 0 && <Text style={styles.count}>{items.length} títulos</Text>}
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="play.circle" title="Nada a medias" subtitle="Lo que empieces a ver aparece acá." />
        }
      />
      <BackButton style={[styles.back, { top: insets.top + 6 }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  list: { paddingHorizontal: 20 },
  header: { marginBottom: 18 },
  title: screenTitle,
  count: { color: colors.textMuted, fontSize: 15, fontWeight: '500', marginTop: 4 },
  gap: { height: 16 },
  back: { position: 'absolute', left: 16, zIndex: 10 },
})
