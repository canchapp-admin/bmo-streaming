import { useEffect, useState } from 'react'
import { Dimensions, StyleSheet, type GestureResponderEvent } from 'react-native'
import Animated, {
  Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, posterUrl } from '@/lib/tmdb'

// Transición "zoom" de una tarjeta a la ficha, como en Apple TV / Fotos: el
// póster que tocaste crece desde donde está hasta ocupar el hero de la ficha,
// y en el camino se funde con la imagen horizontal del hero. Debajo, la ficha
// entra con un fundido (la ruta se abre con ?zoom=1 y en _layout esa entrada
// usa animation: 'fade').
//
// Cómo funciona: al tocar se mide la tarjeta en pantalla, se dibuja una copia
// encima de TODO (ZoomOverlay, montado en el layout raíz) y se anima su caja
// (posición, tamaño y radio) en el hilo de UI con Reanimated. Al llegar, la
// copia se desvanece y queda la ficha real debajo, en el mismo lugar.
//
// Si algo falla (no se pudo medir, Reducir movimiento) se navega normal.

type Rect = { x: number; y: number; w: number; h: number }
type Zoom = { id: number; from: Rect; to: Rect; poster: string | null; backdrop: string | null; landscape: boolean }

let listener: ((z: Zoom) => void) | null = null
let seq = 0

// Alto del hero de la ficha (app/title/[type]/[id].tsx: HERO_H = width * 0.95).
const heroRect = (): Rect => {
  const { width } = Dimensions.get('window')
  return { x: 0, y: 0, w: width, h: width * 0.95 }
}

/**
 * Mide la tarjeta tocada y arranca el zoom. Devuelve false si no se pudo
 * (entonces el que llama navega como siempre).
 */
export function startZoom(
  e: GestureResponderEvent | undefined,
  item: { poster_path?: string | null; backdrop_path?: string | null },
  navigate: () => void,
): boolean {
  const target = e?.currentTarget as unknown as {
    measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void
  } | undefined
  if (!listener || !target?.measureInWindow) return false
  const backdrop = backdropUrl(item.backdrop_path ?? null, 'w1280')
  // Precarga la imagen del hero: así al llegar ya está y no hay parpadeo.
  if (backdrop) Image.prefetch(backdrop).catch(() => {})
  target.measureInWindow((x, y, w, h) => {
    if (!w || !h) { navigate(); return }
    const landscape = w > h
    // Las tarjetas de póster llevan el nombre abajo: el zoom sale solo del
    // póster (2:3), no de toda la tarjeta.
    const from = { x, y, w, h: landscape ? h : Math.min(h, w * 1.5) }
    listener?.({
      id: ++seq,
      from,
      to: heroRect(),
      poster: landscape ? null : posterUrl(item.poster_path ?? null, 'w500'),
      backdrop,
      landscape,
    })
    navigate()
  })
  return true
}

const GROW_MS = 440
const EASE = Easing.bezier(0.2, 0.85, 0.2, 1)

export function ZoomOverlay() {
  const [zoom, setZoom] = useState<Zoom | null>(null)
  useEffect(() => {
    listener = setZoom
    return () => { listener = null }
  }, [])
  if (!zoom) return null
  return <ZoomRun key={zoom.id} zoom={zoom} onDone={() => setZoom(null)} />
}

function ZoomRun({ zoom, onDone }: { zoom: Zoom; onDone: () => void }) {
  const p = useSharedValue(0)
  const out = useSharedValue(1)
  useEffect(() => {
    p.value = withTiming(1, { duration: GROW_MS, easing: EASE })
    // Al llegar, un instante quieta (la ficha ya está debajo) y se va.
    out.value = withDelay(GROW_MS + 120, withTiming(0, { duration: 220 }, (fin) => { if (fin) runOnJS(onDone)() }))
  }, [])

  const { from, to } = zoom
  const box = useAnimatedStyle(() => ({
    left: interpolate(p.value, [0, 1], [from.x, to.x]),
    top: interpolate(p.value, [0, 1], [from.y, to.y]),
    width: interpolate(p.value, [0, 1], [from.w, to.w]),
    height: interpolate(p.value, [0, 1], [from.h, to.h]),
    borderRadius: interpolate(p.value, [0, 1], [12, 0]),
    opacity: out.value,
  }))
  // El póster vertical se funde con la imagen horizontal a mitad de camino.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: zoom.poster ? interpolate(p.value, [0.3, 0.85], [0, 1], 'clamp') : 1,
  }))
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.4, 1], [0, 1], 'clamp') }))

  return (
    <Animated.View pointerEvents="none" style={[styles.box, box]}>
      {zoom.poster && <Image source={zoom.poster} style={StyleSheet.absoluteFill} contentFit="cover" />}
      {zoom.backdrop && (
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Image source={zoom.backdrop} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
      )}
      {/* El mismo degradé de abajo que el hero de la ficha: al llegar, calza. */}
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)', '#000']}
          locations={[0, 0.7, 1]}
          style={styles.gradient}
        />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  box: { position: 'absolute', overflow: 'hidden', borderCurve: 'continuous', backgroundColor: '#111', zIndex: 9999 },
  gradient: { ...StyleSheet.absoluteFillObject },
})
