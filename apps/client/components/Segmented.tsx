import { StyleSheet, Text, View } from 'react-native'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { colors } from '@/lib/theme'

// Control segmentado de iOS sobre Liquid Glass: una cápsula de vidrio con las
// opciones y la elegida en una pastilla blanca. Para filtros cortos (2–4
// opciones) que cambian la vista al instante; para listas largas, GlassMenu.
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[]
  value: K
  onChange: (k: K) => void
}) {
  return (
    <Glass radius={20} style={styles.track}>
      <View style={styles.row} accessibilityRole="tablist">
        {options.map((o) => {
          const active = o.key === value
          return (
            // El flex va en un View y no en el Touchable: Touchable aplica su
            // style a un Animated.View interno y el reparto del ancho fallaba.
            <View key={o.key} style={styles.flex}>
            <Touchable
              scaleTo={0.96}
              haptic="selection"
              onPress={() => onChange(o.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.segment, active && styles.segmentActive]}>
                <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
                  {o.label}
                </Text>
              </View>
            </Touchable>
            </View>
          )
        })}
      </View>
    </Glass>
  )
}

const styles = StyleSheet.create({
  track: { padding: 4 },
  row: { flexDirection: 'row', gap: 4 },
  flex: { flex: 1 },
  segment: { height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  segmentActive: { backgroundColor: '#fff' },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
  textActive: { color: '#000' },
})
