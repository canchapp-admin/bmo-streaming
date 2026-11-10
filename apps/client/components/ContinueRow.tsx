import { View, Text, FlatList, StyleSheet } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { ContinueCard } from './ContinueCard'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { colors } from '@/lib/theme'
import { rowHeading } from '@/lib/typography'
import type { Progress } from '@/lib/library'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// 300 de la tarjeta + 12 de separación (ver ContinueCard).
const CONTINUE_ITEM_W = 300 + 12
// La fila es un atajo, no el archivo completo: con 30 títulos a medias se
// volvía un scroll horizontal sin fin. Muestra los 10 más recientes y cierra
// con una tarjeta "Ver todo" (y el "›" del encabezado) hacia la lista entera.
const MAX_ITEMS = 10

export function ContinueRow({
  items,
  onChange,
  onSeeAll,
}: {
  items: Progress[]
  onChange?: () => void
  onSeeAll?: () => void
}) {
  if (!items.length) return null
  const visible = items.slice(0, MAX_ITEMS)

  return (
    <View style={styles.section}>
      <Touchable
        style={styles.headingRow}
        scaleTo={0.98}
        haptic="light"
        onPress={onSeeAll}
        disabled={!onSeeAll}
      >
        <Text style={styles.heading}>Seguir viendo</Text>
        {onSeeAll && (
          <SymbolView name="chevron.right" tintColor="#fff" style={styles.chevron} />
        )}
      </Touchable>
      <FlatList
        horizontal
        data={visible}
        keyExtractor={(i) => `${i.media_type}-${i.id}`}
        renderItem={({ item }) => <ContinueCard item={item} onRemove={onChange} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        getItemLayout={fixedItemLayout(CONTINUE_ITEM_W)}
        ListFooterComponent={
          items.length > MAX_ITEMS && onSeeAll ? (
            <Touchable scaleTo={0.96} haptic="light" onPress={onSeeAll} accessibilityRole="button">
              <Glass radius={14} style={styles.seeAll}>
                <SymbolView name="square.grid.2x2" tintColor={colors.text} style={styles.seeAllIcon} />
                <Text style={styles.seeAllText}>Ver todo</Text>
                <Text style={styles.seeAllCount}>{items.length} títulos</Text>
              </Glass>
            </Touchable>
          ) : null
        }
        {...rowVirtualization}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // 30 para igualar el ritmo del resto de secciones (ver library.tsx).
  section: { marginBottom: 30 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  heading: rowHeading,
  chevron: { width: 18, height: 18, marginTop: 2 },
  row: { paddingHorizontal: 20 },
  // Mismo alto que una tarjeta (300 × 0.58), más angosta: se lee como el final.
  seeAll: { width: 140, height: 174, alignItems: 'center', justifyContent: 'center', gap: 6 },
  seeAllIcon: { width: 24, height: 24, marginBottom: 4 },
  seeAllText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  seeAllCount: { color: colors.textDim, fontSize: 13 },
})
