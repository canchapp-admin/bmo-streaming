import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { Touchable } from './Touchable'
import { Glass } from './Glass'

// Botón de volver flotante, el mismo en todas las pantallas que dibujan su
// propia barra (ficha, catálogos). Círculo de Liquid Glass "clear" de 44 pt:
// el tamaño táctil mínimo de las HIG y el de los botones de barra de iOS 26.
// "clear" porque casi siempre va encima de una imagen y tiene que dejarla ver.
export const BACK_SIZE = 44

export function BackButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter()
  return (
    <Touchable
      scaleTo={0.9}
      haptic="light"
      style={style}
      onPress={() => router.back()}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Volver"
    >
      <Glass radius={BACK_SIZE / 2} interactive variant="clear" style={styles.glass}>
        <SymbolView name="chevron.left" weight="semibold" tintColor="#fff" style={styles.icon} />
      </Glass>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  glass: { width: BACK_SIZE, height: BACK_SIZE, alignItems: 'center', justifyContent: 'center' },
  // Un pelo a la izquierda del centro: el chevron "apunta" hacia allá y
  // centrado matemáticamente se ve corrido a la derecha.
  icon: { width: 19, height: 19, marginLeft: -2 },
})
