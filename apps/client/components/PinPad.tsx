import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { colors } from '@/lib/theme'

export const PIN_LENGTH = 4

// Letras bajo cada número, como el teclado de código de iOS. No se usan para
// nada: son la seña visual de "esto es un teclado de código", y hacen que la
// tecla se lea como la del sistema y no como un botón redondo cualquiera.
const LETTERS: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL',
  '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ',
}

// Teclado numérico propio en vez de un TextInput: el input del sistema abre el
// teclado completo (con predicciones y barra de pegado), que para 4 dígitos es
// ruidoso y se ve mal. Este ocupa alto fijo y no empuja el layout.
//
// Con onCancel, la esquina inferior derecha funciona como en iOS: dice
// "Cancelar" (o cancelLabel) mientras no hay dígitos y "Borrar" en cuanto se
// escribe uno. Así no hace falta otro botón suelto debajo del teclado.
export function PinPad({
  value,
  onChange,
  title,
  subtitle,
  error,
  onCancel,
  cancelLabel = 'Cancelar',
}: {
  value: string
  onChange: (next: string) => void
  title: string
  subtitle?: string
  error?: string | null
  onCancel?: () => void
  cancelLabel?: string
}) {
  const shake = useRef(new Animated.Value(0)).current

  // Sacude los puntos al fallar. El error llega de afuera (el servidor decide),
  // así que se reacciona a su aparición.
  useEffect(() => {
    if (!error) return
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.5, duration: 45, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start()
  }, [error])

  function press(digit: string) {
    if (value.length >= PIN_LENGTH) return
    onChange(value + digit)
  }
  function back() {
    onChange(value.slice(0, -1))
  }

  const dots = { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) }] }
  const showCancel = value.length === 0 && !!onCancel

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <Animated.View
        style={[styles.dots, dots]}
        accessible
        accessibilityLabel={`${value.length} de ${PIN_LENGTH} dígitos`}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotOn, !!error && styles.dotError]} />
        ))}
      </Animated.View>

      <Text style={styles.error} accessibilityLiveRegion="polite">{error ?? ' '}</Text>

      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} digit={d} onPress={() => press(d)} />
        ))}
        {/* Hueco para alinear el 0 al centro, como el teclado del sistema */}
        <View style={styles.key} />
        <Key digit="0" onPress={() => press('0')} />
        {showCancel ? (
          <Touchable
            style={styles.key}
            scaleTo={0.94}
            haptic="light"
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
          >
            <Text style={styles.textKey} numberOfLines={1} adjustsFontSizeToFit>{cancelLabel}</Text>
          </Touchable>
        ) : (
          <Touchable
            style={styles.key}
            scaleTo={0.94}
            haptic="light"
            onPress={back}
            disabled={value.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Borrar"
          >
            <Text style={[styles.textKey, value.length === 0 && styles.textKeyOff]}>Borrar</Text>
          </Touchable>
        )}
      </View>
    </View>
  )
}

// Cada tecla es Liquid Glass interactivo, como el teclado de código de iOS 26+:
// es un control, así que va en la capa de vidrio, y al tocarla el material
// reacciona solo (brillo y leve rebote) además del encogido de Touchable.
const Key = ({ digit, onPress }: { digit: string; onPress: () => void }) => (
  <Touchable
    style={styles.key}
    scaleTo={0.94}
    haptic="selection"
    onPress={onPress}
    accessibilityRole="keyboardkey"
    accessibilityLabel={digit}
  >
    <Glass radius={KEY / 2} interactive style={styles.keyGlass}>
      <Text style={styles.keyText}>{digit}</Text>
      {/* El 0 y el 1 no llevan letras en iOS; el espacio se reserva igual para
          que todos los números queden a la misma altura. */}
      <Text style={styles.keyLetters}>{LETTERS[digit] ?? ' '}</Text>
    </Glass>
  </Touchable>
)

const KEY = 78

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  // textDim: el 40% quedaba por debajo de 4.5:1 sobre el fondo.
  subtitle: {
    color: colors.textDim, fontSize: 15,
    marginTop: 6, textAlign: 'center', lineHeight: 20,
  },
  dots: { flexDirection: 'row', gap: 22, marginTop: 28 },
  // Contorno más visible que antes (textFaint casi no se veía sobre negro).
  dot: {
    width: 13, height: 13, borderRadius: 7,
    borderWidth: 1.5, borderColor: colors.textDim,
  },
  dotOn: { backgroundColor: '#fff', borderColor: '#fff' },
  dotError: { borderColor: colors.danger },
  // Altura reservada siempre: sin esto el teclado salta al aparecer el error.
  error: { color: colors.danger, fontSize: 14, marginTop: 14, height: 18, textAlign: 'center' },

  // Medidas del teclado de código de iOS: teclas de 78 con ~24 de separación.
  pad: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 24, rowGap: 16, marginTop: 18, width: KEY * 3 + 24 * 2,
  },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  keyGlass: { width: KEY, height: KEY, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#fff', fontSize: 34, fontWeight: '400', lineHeight: 38, marginTop: 4 },
  keyLetters: { color: colors.text, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, marginTop: -1 },
  textKey: { color: '#fff', fontSize: 17 },
  textKeyOff: { color: colors.textFaint },
})
