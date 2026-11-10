import { useRef, useState } from 'react'
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { fmt } from '@bmo/player'

// Barra de progreso del reproductor, al estilo del de Apple:
//  · Fina en reposo; al tocarla se engrosa y aparece el punto, así se ve que
//    la estás agarrando.
//  · Se puede tocar en cualquier lado para saltar ahí, o arrastrar. Mientras
//    se arrastra, una burbuja arriba muestra el tiempo al que vas a ir; el
//    video salta recién al soltar (pedirle a VLC un seek por cada movimiento
//    del dedo lo traba).
//  · Abajo: lo transcurrido y lo que FALTA ("-55:48"), que es lo que la gente
//    quiere saber. Tocando el de la derecha alterna con la duración total.
//  · Accesible: VoiceOver la anuncia como ajustable y deslizar arriba/abajo
//    adelanta/retrocede 10 s.

const TRACK_H = 5
const HIT_H = 40
const BUBBLE_W = 84

export function Scrubber({
  position,
  duration,
  onScrubStart,
  onScrubEnd,
  onSeek,
}: {
  position: number
  duration: number
  onScrubStart?: () => void
  onScrubEnd?: () => void
  onSeek: (t: number) => void
}) {
  const [width, setWidth] = useState(0)
  const [scrubT, setScrubT] = useState<number | null>(null)
  const [showTotal, setShowTotal] = useState(false)
  const grow = useRef(new Animated.Value(0)).current
  const startX = useRef(0)
  // El PanResponder se crea una vez: lee lo último por refs.
  const live = useRef({ width, duration, onSeek, onScrubStart, onScrubEnd })
  live.current = { width, duration, onSeek, onScrubStart, onScrubEnd }

  const timeAt = (x: number) => {
    const { width: w, duration: d } = live.current
    if (w <= 0 || d <= 0) return 0
    return Math.max(0, Math.min(1, x / w)) * d
  }

  const setGrown = (on: boolean) =>
    Animated.timing(grow, {
      toValue: on ? 1 : 0, duration: on ? 140 : 220,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start()

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Una vez agarrada, que el scroll/gesto de afuera no se la lleve.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX
        setScrubT(timeAt(startX.current))
        setGrown(true)
        live.current.onScrubStart?.()
        Haptics.selectionAsync().catch(() => {})
      },
      onPanResponderMove: (_, g) => {
        setScrubT(timeAt(startX.current + g.dx))
      },
      onPanResponderRelease: (_, g) => {
        const t = timeAt(startX.current + g.dx)
        setScrubT(null)
        setGrown(false)
        live.current.onSeek(t)
        live.current.onScrubEnd?.()
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
      },
      onPanResponderTerminate: () => {
        setScrubT(null)
        setGrown(false)
        live.current.onScrubEnd?.()
      },
    })
  ).current

  const shown = scrubT ?? position
  const frac = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0
  const remaining = Math.max(0, duration - shown)
  const bubbleLeft = Math.max(0, Math.min(width - BUBBLE_W, frac * width - BUBBLE_W / 2))

  return (
    <View>
      <View
        style={styles.hit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Progreso"
        accessibilityValue={{ text: `${fmt(shown)} de ${fmt(duration)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onSeek(position + (e.nativeEvent.actionName === 'increment' ? 10 : -10))}
        {...pan.panHandlers}
      >
        {/* La barra se engrosa (escala vertical) al agarrarla */}
        <Animated.View
          style={[
            styles.track,
            { transform: [{ scaleY: grow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] },
          ]}
        >
          <View style={[styles.fill, { width: `${frac * 100}%` }]} />
        </Animated.View>
        {/* El punto: solo mientras se agarra */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.knob,
            {
              left: frac * width - 8,
              transform: [{ scale: grow }],
            },
          ]}
        />
        {scrubT != null && (
          <View pointerEvents="none" style={[styles.bubble, { left: bubbleLeft }]}>
            <Text style={styles.bubbleText}>{fmt(scrubT)}</Text>
          </View>
        )}
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{fmt(shown)}</Text>
        <Pressable
          hitSlop={10}
          onPress={() => setShowTotal((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={showTotal ? `Duración ${fmt(duration)}` : `Faltan ${fmt(remaining)}`}
          accessibilityHint="Alterna entre lo que falta y la duración total"
        >
          <Text style={styles.time}>{showTotal ? fmt(duration) : `-${fmt(remaining)}`}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  hit: { height: HIT_H, justifyContent: 'center' },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: '#fff', borderRadius: TRACK_H },
  knob: {
    position: 'absolute',
    top: HIT_H / 2 - 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bubble: {
    position: 'absolute',
    bottom: HIT_H - 4,
    width: BUBBLE_W,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(28,28,30,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  bubbleText: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: {
    color: 'rgba(255,255,255,0.78)', fontSize: 12.5, fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
  },
})
