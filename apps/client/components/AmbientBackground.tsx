import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Defs, RadialGradient, Stop, Circle, LinearGradient, Rect } from 'react-native-svg'
import { colors } from '@/lib/theme'

// Fondo "aurora" para las pantallas de sistema (perfiles, PIN, login).
//
// Liquid Glass necesita algo detrás para refractar: sobre negro plano el
// vidrio no se ve y la pantalla queda chata. Por eso son tres luces de color
// grandes y difusas (teal de marca, periwinkle y un violeta profundo) que se
// desplazan muy despacio, como los fondos de pantalla dinámicos de iOS. Un
// velo oscuro arriba y abajo baja la intensidad donde va texto.
//
// Con "Reducir movimiento" activo las luces quedan quietas.
const BLOBS = [
  { color: colors.accent, opacity: 0.55, x: 0.25, y: 0.22, r: 0.75, dx: 0.10, dy: 0.06, ms: 19000 },
  { color: colors.info, opacity: 0.5, x: 0.85, y: 0.5, r: 0.7, dx: -0.12, dy: 0.08, ms: 23000 },
  { color: '#6B3FD4', opacity: 0.45, x: 0.2, y: 0.85, r: 0.8, dx: 0.12, dy: -0.07, ms: 27000 },
] as const

export function AmbientBackground() {
  const { width, height } = useWindowDimensions()
  const [still, setStill] = useState(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill)
    return () => sub.remove()
  }, [])

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="none">
      {BLOBS.map((b, i) => (
        <Blob key={i} blob={b} width={width} height={height} still={still} id={`b${i}`} />
      ))}
      {/* Velo: oscurece arriba (hora, título) y abajo (acciones) para que el
          texto nunca dependa de dónde esté la luz en ese momento. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0.55} />
            <Stop offset="0.35" stopColor="#000" stopOpacity={0.15} />
            <Stop offset="0.7" stopColor="#000" stopOpacity={0.25} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.75} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#veil)" />
      </Svg>
    </View>
  )
}

function Blob({
  blob, width, height, still, id,
}: {
  blob: (typeof BLOBS)[number]
  width: number
  height: number
  still: boolean
  id: string
}) {
  const t = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (still) { t.stopAnimation(); t.setValue(0); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: blob.ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: blob.ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [still])

  const size = Math.max(width, height) * blob.r * 2
  const move = {
    transform: [
      { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, width * blob.dx] }) },
      { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height * blob.dy] }) },
    ],
  }

  return (
    <Animated.View
      style={[
        styles.blob,
        { width: size, height: size, left: width * blob.x - size / 2, top: height * blob.y - size / 2 },
        move,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blob.color} stopOpacity={blob.opacity} />
            <Stop offset="0.45" stopColor={blob.color} stopOpacity={blob.opacity * 0.35} />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bg, overflow: 'hidden' },
  blob: { position: 'absolute' },
})
