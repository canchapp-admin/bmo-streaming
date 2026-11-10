import { useEffect, useMemo, useRef } from 'react'
import { Animated, Dimensions, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { useReduceMotion } from '@/lib/useReduceMotion'

// Disney+: al entrar, una estrella fugaz cruza en arco por encima del título
// destacado, lo va encendiendo a su paso y deja una estela de polvo dorado
// que cae titilando. Es un saludo: dura ~3 s y después queda el título
// normal (y el cielo estrellado de ThemeEffect).
//
// Original a propósito: ni castillo ni logo, solo la idea de "magia".
//
// Todo cuelga de UN valor (p: 0→1) animado con el driver nativo; cada pieza
// es una interpolación de ese valor. No hay trabajo en JS por cuadro.
//
// Coordenadas: relativas a la esquina superior izquierda del título. El arco
// entra por la izquierda a la altura del título, lo recorre rozando su parte
// de arriba (ahí lo ilumina) y después sube hacia la esquina superior
// derecha y sale de pantalla.

const SCREEN_W = Dimensions.get('window').width
const W = SCREEN_W - 40 // ancho del título (heroContent: left/right 20)

const DELAY = 500 // que la pantalla termine de entrar antes de la estrella
const DURATION = 3200 // todo el saludo (la estrella cruza en la primera mitad)
// "ts" es el tiempo de la estrella: 0 = entra, 1 = sale. Corre hasta 2 para
// que la estela y el polvo terminen después de que la estrella se fue.
const TS_MAX = 2

// Arco: Bézier cúbica.
const P = [
  { x: -70, y: 22 },
  { x: W * 0.4, y: 2 },
  { x: W * 0.75, y: -12 },
  { x: W + 60, y: -290 },
]
function at(t: number) {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return {
    x: a * P[0].x + b * P[1].x + c * P[2].x + d * P[3].x,
    y: a * P[0].y + b * P[1].y + c * P[2].y + d * P[3].y,
  }
}
const STEPS = 32
const T_IN = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS)
const X_OUT = T_IN.map((t) => at(t).x)
const Y_OUT = T_IN.map((t) => at(t).y)

// Estela: puntos que siguen el mismo camino con un poco de retraso, cada vez
// más chicos y más fríos (dorado junto a la estrella → azul en la cola).
const TRAIL = 28
const TRAIL_GAP = 0.008
function lerpColor(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t)
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

// Pseudoaleatorio con semilla: el polvo cae igual en cada render.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const SPOT_W = 96 // ventana de luz que viaja con la estrella sobre el título

export function ShootingStarTitle({ title, style }: { title: string; style: StyleProp<TextStyle> }) {
  const reduceMotion = useReduceMotion()
  const p = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduceMotion) { p.stopAnimation(); p.setValue(1); return }
    const timers: ReturnType<typeof setTimeout>[] = []
    const anim = Animated.timing(p, {
      toValue: 1, duration: DURATION, delay: DELAY, easing: Easing.linear, useNativeDriver: true,
    })
    anim.start()
    // Un toque al aparecer la estrella y otro cuando enciende el título.
    timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), DELAY + 60))
    timers.push(setTimeout(() => Haptics.selectionAsync().catch(() => {}), DELAY + DURATION * (0.3 / TS_MAX)))
    return () => { anim.stop(); timers.forEach(clearTimeout) }
  }, [reduceMotion])

  const ts = p.interpolate({ inputRange: [0, 1], outputRange: [0, TS_MAX] })

  const path = (lag: number) => {
    const t = lag ? Animated.add(ts, -lag) : ts
    return {
      x: t.interpolate({ inputRange: T_IN, outputRange: X_OUT, extrapolate: 'clamp' }),
      y: t.interpolate({ inputRange: T_IN, outputRange: Y_OUT, extrapolate: 'clamp' }),
      t,
    }
  }

  const head = path(0)
  // La estrella aparece de golpe pero suave al entrar y se apaga al salir.
  const headOpacity = ts.interpolate({ inputRange: [0, 0.06, 0.9, 1], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' })
  const spin = ts.interpolate({ inputRange: [0, TS_MAX], outputRange: ['0deg', '260deg'] })

  const trail = useMemo(
    () =>
      Array.from({ length: TRAIL }, (_, i) => {
        const k = i + 1
        const f = k / (TRAIL + 1)
        return {
          lag: k * TRAIL_GAP,
          size: 1.2 + 5.4 * (1 - f),
          opacity: 0.95 * (1 - f) ** 1.3,
          color: lerpColor('#FFF3C4', '#7FB2FF', f),
        }
      }),
    []
  )

  // Polvo que se desprende a lo largo del camino y cae titilando.
  const dust = useMemo(() => {
    const r = seeded(7)
    return Array.from({ length: 34 }, () => {
      const t0 = 0.08 + r() * 0.74
      const pt = at(t0)
      const life = 0.7 + r() * 0.45
      return {
        t0,
        life,
        x: pt.x + (r() - 0.5) * 22,
        y: pt.y + (r() - 0.5) * 18,
        fall: 34 + r() * 60,
        sway: (r() - 0.5) * 26,
        size: 5 + r() * 7,
        color: r() < 0.65 ? '#FFE9A8' : '#E4EEFF',
      }
    })
  }, [])

  // Brillo general del título: sube cuando la estrella lo cruza y se apaga.
  const glow = ts.interpolate({ inputRange: [0.04, 0.24, 0.5, 1], outputRange: [0, 0.85, 0.5, 0], extrapolate: 'clamp' })
  // La ventana más brillante solo mientras la estrella va sobre el título.
  const spotOpacity = ts.interpolate({ inputRange: [0, 0.06, 0.48, 0.62], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' })
  const spotLeft = Animated.add(head.x, -SPOT_W / 2)

  return (
    <View>
      <Text style={style} numberOfLines={2}>{title}</Text>

      {/* Copia cálida del título: el brillo que deja la estrella. */}
      <Animated.Text
        style={[style, styles.lit, { width: W, opacity: glow }]}
        numberOfLines={2}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {title}
      </Animated.Text>

      {/* Donde pasa la estrella, casi blanco: una ventana que viaja con ella
          y deja ver una copia más encendida del título. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.spot, { opacity: spotOpacity, transform: [{ translateX: spotLeft }] }]}
      >
        <Animated.Text
          style={[style, styles.lit, styles.spotText, { width: W, transform: [{ translateX: Animated.multiply(spotLeft, -1) }] }]}
          numberOfLines={2}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {title}
        </Animated.Text>
      </Animated.View>

      {/* Polvo */}
      {dust.map((d, i) => {
        const a = d.t0, b = d.t0 + d.life
        return (
          <Animated.View
            key={`d${i}`}
            pointerEvents="none"
            style={[
              styles.abs,
              {
                left: d.x - d.size / 2,
                top: d.y - d.size / 2,
                opacity: ts.interpolate({ inputRange: [a - 0.001, a + 0.04, a + d.life * 0.55, b], outputRange: [0, 1, 0.75, 0], extrapolate: 'clamp' }),
                transform: [
                  { translateY: ts.interpolate({ inputRange: [a, b], outputRange: [0, d.fall], extrapolate: 'clamp' }) },
                  { translateX: ts.interpolate({ inputRange: [a, b], outputRange: [0, d.sway], extrapolate: 'clamp' }) },
                  { scale: ts.interpolate({ inputRange: [a, a + 0.05, a + d.life * 0.5, b], outputRange: [0.3, 1.15, 0.75, 0.4], extrapolate: 'clamp' }) },
                ],
              },
            ]}
          >
            <SymbolView name="sparkle" tintColor={d.color} style={{ width: d.size, height: d.size }} />
          </Animated.View>
        )
      })}

      {/* Estela */}
      {trail.map((tr, i) => {
        const pt = path(tr.lag)
        return (
          <Animated.View
            key={`t${i}`}
            pointerEvents="none"
            style={[
              styles.abs,
              styles.trailDot,
              {
                width: tr.size, height: tr.size, borderRadius: tr.size / 2,
                left: -tr.size / 2, top: -tr.size / 2,
                backgroundColor: tr.color,
                shadowColor: tr.color,
                opacity: Animated.multiply(headOpacity, tr.opacity),
                transform: [{ translateX: pt.x }, { translateY: pt.y }],
              },
            ]}
          />
        )
      })}

      {/* La estrella: halo, núcleo y un destello de cuatro puntas que gira. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.abs, styles.head, { opacity: headOpacity, transform: [{ translateX: head.x }, { translateY: head.y }] }]}
      >
        <View style={styles.halo} />
        <View style={styles.core} />
        <Animated.View style={[styles.flare, { transform: [{ rotate: spin }] }]}>
          <SymbolView name="sparkle" tintColor="#FFF8E1" style={styles.flareIcon} />
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const HEAD = 44

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
  lit: {
    position: 'absolute', left: 0, top: 0,
    color: '#FFF7DD', textShadowColor: 'rgba(255,222,150,0.95)', textShadowRadius: 16,
  },
  spot: { position: 'absolute', left: 0, top: -20, bottom: -20, width: SPOT_W, overflow: 'hidden' },
  spotText: { top: 20, color: '#FFFFFF', textShadowColor: 'rgba(255,243,196,1)', textShadowRadius: 24 },
  trailDot: { shadowOpacity: 1, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  head: { left: -HEAD / 2, top: -HEAD / 2, width: HEAD, height: HEAD, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(214,230,255,0.28)',
    shadowColor: '#CFE3FF', shadowOpacity: 1, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
  },
  core: {
    position: 'absolute', width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FFFFFF',
    shadowColor: '#FFF3C4', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  flare: { position: 'absolute' },
  flareIcon: { width: 30, height: 30 },
})
