import { useEffect, useState } from 'react'
import { Dimensions, StyleSheet, type GestureResponderEvent } from 'react-native'
import Animated, {
  interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { backdropUrl, posterUrl } from '@/lib/tmdb'

// Transición "zoom" de una tarjeta a la ficha, como en Apple TV / Fotos: el
// póster que tocaste crece desde donde está hasta ocupar el hero de la ficha
// y se funde con la imagen horizontal del hero.
//
// Cómo funciona: al tocar se mide la tarjeta, se dibuja una copia encima de
// TODO (ZoomOverlay, montado en el layout raíz) y se anima en el hilo de UI.
//
// Lo que la hacía verse entrecortada, y cómo se evita:
//  · La ficha se montaba A LA VEZ que la animación: montar la pantalla
//    (imágenes, listas, sensores) ocupa el hilo de UI y la animación perdía
//    cuadros. Ahora se navega cuando el zoom ya llegó (la copia tapa todo,
//    así que no se nota la espera) y la ficha entra sin animación propia.
//  · La copia se va recién cuando la ficha AVISA que su imagen ya está
//    (zoomLanded), con un fundido corto. Antes se iba a tiempo fijo y a
//    veces debajo todavía estaba el esqueleto.
//  · La imagen de arranque es la MISMA que ya muestra la tarjeta (mismo
//    tamaño de TMDB, está en caché): no arranca en negro. La del hero entra
//    con fundido recién cuando terminó de cargar, nunca de golpe.
//  · Movimiento con resorte críticamente amortiguado (sin rebote), como las
//    transiciones del sistema, en vez de una curva por tiempo.
//
// Si algo falla (no se pudo medir, Reducir movimiento) se navega normal.

type Rect = { x: number; y: number; w: number; h: number }
type Zoom = { id: number; from: Rect; to: Rect; start: string | null; hero: string | null }

let listener: ((z: Zoom) => void) | null = null
let landedListener: (() => void) | null = null
let seq = 0

// Alto del hero de la ficha (app/title/[type]/[id].tsx: HERO_H = width * 0.95).
const heroRect = (): Rect => {
  const { width } = Dimensions.get('window')
  return { x: 0, y: 0, w: width, h: width * 0.95 }
}

const SPRING = { duration: 520, dampingRatio: 1 } as const
// Se navega un poco antes de que el resorte termine del todo: el último
// tramo es casi imperceptible y así la ficha empieza a montarse antes.
const NAV_AFTER_MS = 400
// Si la ficha nunca avisa (sin imagen, error), la copia se va igual.
const LAND_TIMEOUT_MS = 1400

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
  const hero = backdropUrl(item.backdrop_path ?? null, 'w1280')
  // Precarga la imagen del hero mientras crece: casi siempre llega a tiempo.
  if (hero) Image.prefetch(hero).catch(() => {})
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
      // Mismo tamaño que usan las tarjetas → ya está en caché.
      start: landscape
        ? backdropUrl(item.backdrop_path ?? null, 'w780')
        : posterUrl(item.poster_path ?? null, 'w500'),
      hero,
    })
    setTimeout(navigate, NAV_AFTER_MS)
  })
  return true
}

/** La ficha avisa que su hero ya está dibujado: la copia puede irse. */
export function zoomLanded() {
  landedListener?.()
}

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
  const heroIn = useSharedValue(0)

  useEffect(() => {
    p.value = withSpring(1, SPRING)
    let gone = false
    const leave = () => {
      if (gone) return
      gone = true
      out.value = withTiming(0, { duration: 260 }, (fin) => { if (fin) runOnJS(onDone)() })
    }
    landedListener = leave
    const maxT = setTimeout(leave, LAND_TIMEOUT_MS)
    return () => {
      clearTimeout(maxT)
      if (landedListener === leave) landedListener = null
    }
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
  const heroStyle = useAnimatedStyle(() => ({ opacity: heroIn.value }))
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.35, 1], [0, 1], 'clamp') }))

  return (
    <Animated.View pointerEvents="none" style={[styles.box, box]}>
      {zoom.start && (
        <Image source={zoom.start} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
      )}
      {zoom.hero && (
        <Animated.View style={[StyleSheet.absoluteFill, heroStyle]}>
          <Image
            source={zoom.hero}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={0}
            // Entra con fundido cuando está lista, nunca de golpe.
            onLoad={() => { heroIn.value = withTiming(1, { duration: 280 }) }}
          />
        </Animated.View>
      )}
      {/* El mismo degradé de abajo que el hero de la ficha: al llegar, calza. */}
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)', '#000']}
          locations={[0, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  box: { position: 'absolute', overflow: 'hidden', borderCurve: 'continuous', backgroundColor: '#111', zIndex: 9999 },
})
