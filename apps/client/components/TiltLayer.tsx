import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import type { Tilt } from '@/lib/useTilt'

// Una capa del relieve: se corre `depth` puntos según la inclinación. Positivo
// = el fondo (se mueve con el teléfono, como algo lejano detrás de una
// ventana); negativo = lo de adelante (se mueve al revés). La diferencia entre
// capas es lo que da la profundidad.
//
// `overscan` agranda la capa para que al correrse no se vean los bordes (solo
// para imágenes de fondo dentro de un contenedor recortado).
export function TiltLayer({
  tilt, depth, overscan = 0, style, children, pointerEvents,
}: {
  tilt?: Tilt
  depth: number
  overscan?: number
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  pointerEvents?: 'box-none' | 'none' | 'auto'
}) {
  const animated = useAnimatedStyle(() => {
    if (!tilt) return {}
    return {
      transform: [
        { translateX: tilt.x.value * depth },
        { translateY: tilt.y.value * depth * 0.7 },
        ...(overscan ? [{ scale: 1 + overscan }] : []),
      ],
    }
  })
  return (
    <Animated.View style={[style, animated]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  )
}

// Reflejo de luz que cruza la imagen al inclinar (el brillo "de vidrio" de los
// pósters de Apple TV). Muy sutil: se nota en movimiento, no quieto.
export function TiltGlare({ tilt }: { tilt?: Tilt }) {
  const animated = useAnimatedStyle(() => {
    if (!tilt) return { opacity: 0 }
    const m = Math.min(1, Math.abs(tilt.x.value) + Math.abs(tilt.y.value))
    return {
      opacity: 0.25 + m * 0.75,
      transform: [{ translateX: tilt.x.value * 140 }, { translateY: tilt.y.value * 60 }, { rotate: '18deg' }],
    }
  })
  return (
    <Animated.View pointerEvents="none" style={[styles.glare, animated]}>
      <LinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  glare: { position: 'absolute', top: '-30%', bottom: '-30%', left: '15%', width: '45%' },
})
