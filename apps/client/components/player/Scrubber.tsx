import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { fmt } from '@bmo/player'

// Barra de progreso del reproductor, al estilo del de Apple:
//  · Fina en reposo; al tocarla se engrosa y aparece el punto, así se ve que
//    la estás agarrando.
//  · Se puede tocar en cualquier lado para saltar ahí, o arrastrar. Mientras
//    se arrastra, una burbuja arriba muestra el tiempo al que vas a ir; el
//    video salta recién al soltar (pedirle a VLC un seek por cada movimiento
//    del dedo lo traba).
//  · Abajo: lo transcurrido y lo que FALTA ("-55:48"). Tocando el de la
//    derecha alterna con la duración total.
//  · Accesible: VoiceOver la anuncia como ajustable y deslizar arriba/abajo
//    adelanta/retrocede 10 s.
//
// Rendimiento: el gesto y el dibujo de la barra corren en el hilo de UI
// (Gesture Handler + Reanimated). Antes era un PanResponder en JS y el hilo
// de JS está ocupado con el reproductor (progreso, subtítulos…): la barra
// seguía al dedo con retraso y a los saltos. Ahora sigue al dedo a 60/120 fps
// aunque JS esté trabado; a JS solo van los textos, una vez por segundo.
//
// Después de soltar, VLC tarda en saltar y mientras tanto sigue reportando la
// posición VIEJA: la barra volvía para atrás y después saltaba. Se mantiene
// el punto elegido hasta que el video llega ahí (o pasan unos segundos).

const TRACK_H = 5
const HIT_H = 40
const BUBBLE_W = 84
const KNOB = 16
const HOLD_MS = 4000 // cuánto se espera, como mucho, a que el video llegue al punto elegido
const HOLD_NEAR_S = 3 // "llegó" = el progreso reportado está a menos de esto del destino

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
  const [scrubSec, setScrubSec] = useState<number | null>(null)
  const [heldSec, setHeldSec] = useState<number | null>(null)
  const [showTotal, setShowTotal] = useState(false)

  const w = useSharedValue(0)
  const dur = useSharedValue(duration)
  const progress = useSharedValue(0) // 0..1, lo que se ve en reposo
  const scrub = useSharedValue(0) // 0..1, bajo el dedo
  const active = useSharedValue(0) // 1 mientras se agarra
  const grow = useSharedValue(0)
  const lastSec = useSharedValue(-1)

  const hold = useRef<{ t: number; until: number } | null>(null)
  const live = useRef({ onSeek, onScrubStart, onScrubEnd })
  live.current = { onSeek, onScrubStart, onScrubEnd }

  useEffect(() => { dur.value = duration }, [duration])

  // Posición que llega del video (cada ~500 ms) → barra. Si es un avance
  // normal se anima lineal hasta el próximo reporte, así la barra avanza
  // continua y no a saltitos.
  useEffect(() => {
    const h = hold.current
    if (h) {
      if (Date.now() < h.until && Math.abs(position - h.t) > HOLD_NEAR_S) return
      hold.current = null
      setHeldSec(null)
    }
    if (duration <= 0) return
    const next = Math.max(0, Math.min(1, position / duration))
    const deltaS = (next - progress.value) * duration
    progress.value = deltaS > 0 && deltaS < 2
      ? withTiming(next, { duration: 520, easing: Easing.linear })
      : next
  }, [position, duration])

  // ── Lado JS: solo lo que no puede vivir en el hilo de UI ──
  function begin(sec: number) {
    setScrubSec(sec)
    live.current.onScrubStart?.()
    Haptics.selectionAsync().catch(() => {})
  }
  function end(frac: number, commit: boolean) {
    setScrubSec(null)
    if (commit && duration > 0) {
      const t = frac * duration
      hold.current = { t, until: Date.now() + HOLD_MS }
      setHeldSec(t)
      live.current.onSeek(t)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    }
    live.current.onScrubEnd?.()
  }

  const pan = Gesture.Pan()
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onStart((e) => {
      const f = w.value > 0 ? Math.max(0, Math.min(1, e.x / w.value)) : 0
      scrub.value = f
      active.value = 1
      grow.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) })
      lastSec.value = Math.floor(f * dur.value)
      runOnJS(begin)(lastSec.value)
    })
    .onUpdate((e) => {
      const f = w.value > 0 ? Math.max(0, Math.min(1, e.x / w.value)) : 0
      scrub.value = f
      // A JS solo cuando cambia el segundo: el texto de la burbuja.
      const s = Math.floor(f * dur.value)
      if (s !== lastSec.value) {
        lastSec.value = s
        runOnJS(setScrubSec)(s)
      }
    })
    .onEnd(() => {
      // La barra se queda donde la soltaste (sin esperar a JS ni a VLC).
      progress.value = scrub.value
      runOnJS(end)(scrub.value, true)
    })
    .onFinalize((_, success) => {
      active.value = 0
      grow.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) })
      if (!success) runOnJS(end)(scrub.value, false)
    })

  const fillStyle = useAnimatedStyle(() => {
    const f = active.value ? scrub.value : progress.value
    // Relleno de ancho completo corrido hacia la izquierda (y recortado por el
    // track): es transform, no layout, y la punta queda redondeada.
    return { transform: [{ translateX: (f - 1) * w.value }] }
  })
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + grow.value * 0.8 }],
  }))
  const knobStyle = useAnimatedStyle(() => {
    const f = active.value ? scrub.value : progress.value
    return { transform: [{ translateX: f * w.value - KNOB / 2 }, { scale: grow.value }] }
  })
  const bubbleStyle = useAnimatedStyle(() => {
    const x = Math.max(0, Math.min(w.value - BUBBLE_W, scrub.value * w.value - BUBBLE_W / 2))
    return { opacity: active.value, transform: [{ translateX: x }] }
  })

  const shown = scrubSec ?? heldSec ?? position
  const remaining = Math.max(0, duration - shown)

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          style={styles.hit}
          onLayout={(e) => {
            setWidth(e.nativeEvent.layout.width)
            w.value = e.nativeEvent.layout.width
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Progreso"
          accessibilityValue={{ text: `${fmt(shown)} de ${fmt(duration)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onSeek(position + (e.nativeEvent.actionName === 'increment' ? 10 : -10))}
        >
          <Animated.View style={[styles.track, trackStyle]}>
            <Animated.View style={[styles.fill, { width }, fillStyle]} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.knob, knobStyle]} />
          <Animated.View pointerEvents="none" style={[styles.bubble, bubbleStyle]}>
            <Text style={styles.bubbleText}>{fmt(scrubSec ?? 0)}</Text>
          </Animated.View>
        </View>
      </GestureDetector>
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
    left: 0,
    top: HIT_H / 2 - KNOB / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bubble: {
    position: 'absolute',
    left: 0,
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
