import { StyleSheet, Text } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { Touchable } from './Touchable'
import { rowHeading } from '@/lib/typography'

// Encabezado de fila. Con `onPress` se vuelve tocable y lleva "›", la señal de
// iOS para "ver todo" (como en Música o la App Store). Sin destino, es solo
// texto: un chevron que no lleva a ningún lado sería una promesa falsa.
//
// Tamaño de texto dinámico: sigue la letra del sistema, con tope en 1.5× para
// que un título largo no empuje la fila fuera de la pantalla.
export function RowHeading({ title, onPress }: { title: string; onPress?: () => void }) {
  if (!onPress) {
    return (
      <Text style={styles.heading} accessibilityRole="header" maxFontSizeMultiplier={1.5} numberOfLines={1}>
        {title}
      </Text>
    )
  }
  return (
    <Touchable
      style={styles.pressable}
      scaleTo={0.98}
      haptic="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Ver todo`}
    >
      <Text style={[styles.heading, styles.flexText]} maxFontSizeMultiplier={1.5} numberOfLines={1}>
        {title}
      </Text>
      <SymbolView name="chevron.right" tintColor="#fff" style={styles.chevron} />
    </Touchable>
  )
}

const styles = StyleSheet.create({
  heading: { ...rowHeading, marginBottom: 12, paddingHorizontal: 20 },
  pressable: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  // El texto ya trae su padding a los costados; el chevron se pega a la derecha.
  flexText: { paddingRight: 4, flexShrink: 1 },
  chevron: { width: 16, height: 16, marginBottom: 12, marginRight: 20 },
})
