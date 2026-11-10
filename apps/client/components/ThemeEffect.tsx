import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'
import { useReduceMotion } from '@/lib/useReduceMotion'

// Animación de bienvenida de cada especial y de cada plataforma/franquicia: al entrar a Navidad nieva un
// rato, en San Valentín suben corazones, en Terror caen dos relámpagos… y
// después se va sola. Es un saludo, no un fondo animado: dura unos segundos
// y no vuelve hasta que se entra de nuevo.
//
// Buenas prácticas:
//  · Con Reduce Motion activado no se muestra nada.
//  · pointerEvents="none": nunca bloquea un toque.
//  · Todo corre en el hilo nativo (useNativeDriver): no compite con el JS
//    que arma las filas mientras se cargan.
//  · Partículas simples (la nieve, la más cargada, usa ~110 y la mitad son
//    puntos lisos): sin costo en equipos viejos.

type Shape =
  | { kind: 'dot'; color: string }
  | { kind: 'petal'; colors: string[] } // óvalo que gira (pétalos, hojas)
  | { kind: 'confetti'; colors: string[] } // tira que gira y "da vueltas" en 3D
  | { kind: 'symbol'; name: string; colors: string[] }

type Effect =
  | { type: 'fall' | 'rise'; count: number; shape: Shape; size: [number, number]; speed: [number, number]; sway: number }
  | { type: 'twinkle'; count: number; color: string }
  | { type: 'flash'; color: string }
  | { type: 'bats'; count: number }
  | { type: 'snow'; count: number }
  | { type: 'hyperspace'; count: number; color: string }
  | { type: 'bokeh'; colors: string[]; count: number }

// Qué animación tiene cada especial. Los que no figuran no tienen.
// Un especial puede combinar varias (Halloween: murciélagos + brasas).
const EFFECTS: Record<string, Effect | Effect[]> = {
  // RuPaul's Drag Race: lluvia de confeti y purpurina de final de temporada,
  // en los colores del show (fucsia, dorado, plateado, violeta), con destellos
  // dorados que titilan. El confeti gira y además "voltea" en 3D: brilla y se
  // apaga al girar, como el de verdad bajo las luces.
  rupaul: [
    {
      type: 'fall', count: 46,
      shape: { kind: 'confetti', colors: ['#FF2E93', '#FF5EC4', '#F5C542', '#FFE08A', '#E6E6F0', '#9B5CFF'] },
      size: [8, 14], speed: [3000, 5200], sway: 36,
    },
    {
      type: 'fall', count: 16,
      shape: { kind: 'symbol', name: 'sparkle', colors: ['#FFE08A', '#F5C542', '#FFFFFF'] },
      size: [8, 16], speed: [3600, 5600], sway: 24,
    },
    { type: 'twinkle', count: 20, color: '#FFE08A' },
  ],
  navidad: { type: 'snow', count: 110 },
  diademuertos: {
    type: 'fall', count: 28,
    shape: { kind: 'petal', colors: ['#FF9F1C', '#FFB703', '#F77F00', '#E85D04'] }, // cempasúchil
    size: [7, 12], speed: [3600, 6000], sway: 40,
  },
  anime: {
    type: 'fall', count: 28,
    shape: { kind: 'petal', colors: ['#FFC4D6', '#FFAFCC', '#FFD6E5'] }, // sakura
    size: [7, 11], speed: [3800, 6200], sway: 44,
  },
  halloween: [
    { type: 'bats', count: 9 },
    {
      type: 'rise', count: 18,
      shape: { kind: 'dot', color: '#FF8C2A' }, // brasas
      size: [2, 4], speed: [3000, 5200], sway: 18,
    },
  ],
  sanvalentin: {
    type: 'rise', count: 18,
    shape: { kind: 'symbol', name: 'heart.fill', colors: ['#FF4D8D', '#FF85A9', '#F0457E'] },
    size: [12, 22], speed: [3400, 5400], sway: 22,
  },
  espacio: { type: 'twinkle', count: 34, color: '#fff' },
  terror: { type: 'flash', color: '#E8ECFF' },
  zombies: { type: 'flash', color: '#D8F0C0' },

  // ── Plataformas y franquicias (pantallas de marca) ──
  // Inspiradas en el mundo de cada una, sin copiar sus intros: un saludo
  // breve en el color de la marca.
  // Plataformas: luces desenfocadas (bokeh) en su color.
  netflix: { type: 'bokeh', colors: ['#E50914', '#FF3B3B', '#B20710'], count: 14 },
  hbo: { type: 'bokeh', colors: ['#9B5CFF', '#B98CFF', '#6A2FD6'], count: 14 },
  prime: { type: 'bokeh', colors: ['#1FA2FF', '#3FB5FF', '#7FD0FF'], count: 14 },
  appletv: { type: 'bokeh', colors: ['#FFFFFF', '#D8D8DE'], count: 12 },
  paramountplus: [
    { type: 'bokeh', colors: ['#0064FF', '#5C9DFF'], count: 10 },
    { type: 'twinkle', count: 22, color: '#CFE0FF' }, // las estrellas de la montaña
  ],
  peacock: {
    type: 'rise', count: 24,
    shape: { kind: 'symbol', name: 'circle.fill', colors: ['#FCCC12', '#F37021', '#CD1C54', '#6E55DC', '#069DE0', '#05AC3F'] },
    size: [6, 12], speed: [3200, 5200], sway: 20,
  },
  // Disney: polvo mágico que cae titilando.
  disney: [
    {
      type: 'fall', count: 30,
      shape: { kind: 'symbol', name: 'sparkle', colors: ['#FFFFFF', '#FFF3C4', '#CFE3FF'] },
      size: [6, 14], speed: [3800, 6000], sway: 30,
    },
    { type: 'twinkle', count: 18, color: '#FFF3C4' },
  ],
  disneyanimation: {
    type: 'fall', count: 30,
    shape: { kind: 'symbol', name: 'sparkle', colors: ['#FFFFFF', '#FFF3C4', '#CFE3FF'] },
    size: [6, 14], speed: [3800, 6000], sway: 30,
  },
  // Franquicias.
  starwars: { type: 'hyperspace', count: 70, color: '#DCEBFF' }, // salto al hiperespacio
  marvel: [{ type: 'bokeh', colors: ['#ED1D24', '#FF4A4A'], count: 12 }, { type: 'flash', color: '#FF4A4A' }],
  dc: [{ type: 'flash', color: '#BFD9FF' }, { type: 'bokeh', colors: ['#2F7BFF', '#5C9DFF'], count: 10 }], // relámpago
  pixar: {
    type: 'rise', count: 22, // globos de colores
    shape: { kind: 'symbol', name: 'circle.fill', colors: ['#FF5A5F', '#FFC93C', '#3FC1C9', '#8A6CFF', '#5FD068', '#FF8FB1'] },
    size: [10, 20], speed: [4200, 6200], sway: 26,
  },
  dreamworks: { type: 'twinkle', count: 36, color: '#FFF6D5' }, // el cielo estrellado de la luna
  illumination: {
    type: 'rise', count: 26, // burbujas amarillas
    shape: { kind: 'dot', color: '#F5C518' },
    size: [4, 10], speed: [3400, 5400], sway: 22,
  },
  ghibli: {
    type: 'fall', count: 26, // hojas al viento
    shape: { kind: 'petal', colors: ['#7FB069', '#A7C957', '#6A994E', '#C9DB74'] },
    size: [8, 13], speed: [4200, 6400], sway: 48,
  },
  blumhouse: { type: 'flash', color: '#FFD0D0' },
}

// Qué claves tienen efecto (la pantalla de marca lo usa para no montar nada
// en las que no).
export const hasEffect = (key: string) => key in EFFECTS

const SHOW_MS = 4200 // cuánto dura antes de empezar a irse
const FADE_MS = 1200
// La nevada se queda un poco más y se va más despacio, como cuando para de nevar de verdad.
const TIMING: Record<string, { show: number; fade: number }> = {
  navidad: { show: 6500, fade: 2200 },
  rupaul: { show: 5200, fade: 1600 },
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

// `themeKey` es la clave de un especial (navidad…) o de una marca (netflix…).
export function ThemeEffect({ themeKey }: { themeKey: string }) {
  const reduceMotion = useReduceMotion()
  const entry = EFFECTS[themeKey]
  const effects = entry ? (Array.isArray(entry) ? entry : [entry]) : []
  const effect = effects[0]
  const [done, setDone] = useState(false)
  const fade = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!effect || reduceMotion) return
    const { show, fade: fadeMs } = TIMING[themeKey] ?? { show: SHOW_MS, fade: FADE_MS }
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: fadeMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
        .start(() => setDone(true))
    }, show)
    return () => clearTimeout(t)
  }, [effect, reduceMotion])

  if (!effect || reduceMotion || done) return null

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer, { opacity: fade }]}>
      {effects.map((e, i) =>
        e.type === 'flash' ? <Flash key={i} color={e.color} />
        : e.type === 'twinkle' ? <Twinkle key={i} count={e.count} color={e.color} />
        : e.type === 'bats' ? <Bats key={i} count={e.count} />
        : e.type === 'snow' ? <Snow key={i} count={e.count} />
        : e.type === 'hyperspace' ? <Hyperspace key={i} count={e.count} color={e.color} />
        : e.type === 'bokeh' ? <Bokeh key={i} colors={e.colors} count={e.count} />
        : <Drift key={i} effect={e} />
      )}
    </Animated.View>
  )
}

// ── Caída / subida (nieve, pétalos, brasas, corazones) ────────────────────
function Drift({ effect }: { effect: Extract<Effect, { type: 'fall' | 'rise' }> }) {
  const { width, height } = useWindowDimensions()
  // Las partículas se arman una sola vez: posición, tamaño, demora y ritmo al
  // azar, para que no se note un patrón.
  const particles = useMemo(
    () =>
      Array.from({ length: effect.count }, () => {
        const size = rand(effect.size[0], effect.size[1])
        const shape = effect.shape
        return {
          x: rand(-10, width + 10),
          size,
          // Las más chicas, más lejanas: caen más lento y más transparentes.
          // Esa diferencia es lo que le da profundidad.
          duration: rand(effect.speed[0], effect.speed[1]) * (1.25 - (size - effect.size[0]) / (effect.size[1] - effect.size[0] + 0.001) * 0.35),
          delay: rand(0, 1800),
          sway: rand(effect.sway * 0.4, effect.sway) * (Math.random() < 0.5 ? -1 : 1),
          spin: rand(180, 540) * (Math.random() < 0.5 ? -1 : 1),
          opacity: rand(0.55, 1),
          color: shape.kind === 'dot' ? shape.color : pick(shape.colors),
          progress: new Animated.Value(0),
        }
      }),
    [effect, width]
  )

  useEffect(() => {
    const anims = particles.map((p) =>
      Animated.loop(
        Animated.timing(p.progress, { toValue: 1, duration: p.duration, easing: Easing.linear, useNativeDriver: true })
      )
    )
    const timers = particles.map((p, i) => setTimeout(() => anims[i].start(), p.delay))
    return () => {
      timers.forEach(clearTimeout)
      anims.forEach((a) => a.stop())
    }
  }, [particles])

  const fall = effect.type === 'fall'
  return (
    <>
      {particles.map((p, i) => {
        const translateY = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: fall ? [-30, height + 30] : [height + 30, height * 0.15],
        })
        // Vaivén lateral: varias paradas para que se mueva en "S" y no en línea.
        const translateX = p.progress.interpolate({
          inputRange: [0, 0.25, 0.5, 0.75, 1],
          outputRange: [0, p.sway, 0, -p.sway, 0],
        })
        const rotate = p.progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] })
        // Al subir (brasas, corazones) se desvanecen antes de llegar arriba.
        const opacity = fall
          ? p.opacity
          : p.progress.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, p.opacity, p.opacity * 0.6, 0] })

        // El confeti además voltea sobre su eje: con perspectiva, la tira se
        // afina y se ensancha mientras cae, como un papelito de verdad.
        const flip = p.progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin * 2}deg`] })
        const transform = [
          { translateX }, { translateY },
          ...(effect.shape.kind === 'dot' ? [] : [{ rotate }]),
          ...(effect.shape.kind === 'confetti' ? [{ perspective: 400 }, { rotateX: flip }] : []),
        ]
        return (
          <Animated.View key={i} style={[styles.particle, { left: p.x, opacity, transform }]}>
            {effect.shape.kind === 'symbol' ? (
              <SymbolView name={effect.shape.name as never} tintColor={p.color} style={{ width: p.size, height: p.size }} />
            ) : effect.shape.kind === 'confetti' ? (
              <View style={{ width: p.size * 0.45, height: p.size, borderRadius: 1.5, backgroundColor: p.color }} />
            ) : effect.shape.kind === 'petal' ? (
              <View style={{ width: p.size, height: p.size * 0.6, borderRadius: p.size, backgroundColor: p.color }} />
            ) : (
              <View
                style={{
                  width: p.size, height: p.size, borderRadius: p.size / 2, backgroundColor: p.color,
                  // Halo suave: nieve y brasas brillan un poco.
                  shadowColor: p.color, shadowOpacity: 0.8, shadowRadius: p.size, shadowOffset: { width: 0, height: 0 },
                }}
              />
            )}
          </Animated.View>
        )
      })}
    </>
  )
}

// ── Nieve (Navidad) ──────────────────────────────────────────────────────
// Lo que hace que se vea real:
//  · TRES planos de profundidad. Lejos: copos diminutos, tenues y lentos (la
//    mayoría). Medio. Cerca: pocos, grandes y más rápidos. Sin esa mezcla
//    parece confeti cayendo todo a la misma distancia.
//  · Copos blandos: un degradado radial (blanco al centro, transparente en el
//    borde), no círculos duros.
//  · Viento: todos derivan un poco hacia el mismo lado, y encima cada copo
//    se mece a su ritmo.
//  · Ya está nevando al entrar: cada copo arranca en un punto al azar de su
//    caída, en vez de empezar todos arriba con la pantalla vacía.
type Layer = { share: number; size: [number, number]; opacity: [number, number]; ms: [number, number]; sway: [number, number]; soft: boolean }
const SNOW_LAYERS: Layer[] = [
  { share: 0.5, size: [1.5, 3], opacity: [0.35, 0.6], ms: [8000, 11000], sway: [4, 10], soft: false }, // lejos
  { share: 0.35, size: [3, 5.5], opacity: [0.6, 0.85], ms: [5600, 7600], sway: [10, 22], soft: true }, // medio
  { share: 0.15, size: [6, 11], opacity: [0.75, 0.95], ms: [3800, 5200], sway: [18, 34], soft: true }, // cerca
]

function SoftFlake({ size, id, color = '#fff' }: { size: number; id: string; color?: string }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="0.45" stopColor={color} stopOpacity="0.85" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  )
}

function Snow({ count }: { count: number }) {
  const { width, height } = useWindowDimensions()
  const flakes = useMemo(() => {
    const wind = rand(30, 70) // deriva común hacia la derecha
    return SNOW_LAYERS.flatMap((layer, li) =>
      Array.from({ length: Math.round(count * layer.share) }, () => {
        const size = rand(layer.size[0], layer.size[1])
        return {
          soft: layer.soft,
          size,
          x: rand(-40, width),
          opacity: rand(layer.opacity[0], layer.opacity[1]),
          ms: rand(layer.ms[0], layer.ms[1]),
          // Los cercanos sienten más el viento (paralaje).
          drift: wind * (0.5 + li * 0.5),
          sway: rand(layer.sway[0], layer.sway[1]),
          // Cuántas veces se mece por caída: no todos al mismo compás.
          swayTurns: Math.random() < 0.5 ? 1 : 2,
          start: Math.random(), // punto de la caída donde arranca
          progress: new Animated.Value(0),
        }
      })
    )
  }, [count, width])

  useEffect(() => {
    const anims = flakes.map((f) => {
      f.progress.setValue(f.start)
      return Animated.sequence([
        // Termina la caída desde donde arrancó…
        Animated.timing(f.progress, { toValue: 1, duration: f.ms * (1 - f.start), easing: Easing.linear, useNativeDriver: true }),
        // …y después cae entera, en bucle.
        Animated.loop(
          Animated.sequence([
            Animated.timing(f.progress, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(f.progress, { toValue: 1, duration: f.ms, easing: Easing.linear, useNativeDriver: true }),
          ])
        ),
      ])
    })
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [flakes])

  return (
    <>
      {flakes.map((f, i) => {
        const translateY = f.progress.interpolate({ inputRange: [0, 1], outputRange: [-20, height + 20] })
        const steps = f.swayTurns * 4
        const translateX = f.progress.interpolate({
          inputRange: Array.from({ length: steps + 1 }, (_, k) => k / steps),
          outputRange: Array.from({ length: steps + 1 }, (_, k) => {
            const sway = [0, f.sway, 0, -f.sway][k % 4]
            return sway + f.drift * (k / steps)
          }),
        })
        return (
          <Animated.View key={i} style={[styles.particle, { left: f.x, opacity: f.opacity, transform: [{ translateX }, { translateY }] }]}>
            {f.soft ? (
              <SoftFlake size={f.size} id={`f${i}`} />
            ) : (
              <View style={{ width: f.size, height: f.size, borderRadius: f.size / 2, backgroundColor: '#fff' }} />
            )}
          </Animated.View>
        )
      })}
    </>
  )
}

// ── Murciélagos (Halloween) ──────────────────────────────────────────────
// Silueta vectorial (SF Symbols no tiene murciélago). Cada uno cruza la
// pantalla UNA vez, en diagonal y ondulando, mientras aletea: el aleteo es
// la silueta achatándose y estirándose en vertical muy rápido, que a ese
// tamaño se lee como alas que suben y bajan.
const BAT_PATH =
  'M50 17 L47 8 L45 16 C40 12 30 7 18 8 C10 9 4 13 0 20 C6 20 10 22 12 28 ' +
  'C17 23 23 24 26 31 C31 26 37 27 40 33 C42 30 44 30 46 33 C47 38 49 41 50 43 ' +
  'C51 41 53 38 54 33 C56 30 58 30 60 33 C63 27 69 26 74 31 C77 24 83 23 88 28 ' +
  'C90 22 94 20 100 20 C96 13 90 9 82 8 C70 7 60 12 55 16 L53 8 Z'

function Bats({ count }: { count: number }) {
  const { width, height } = useWindowDimensions()
  const bats = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        // Alternan el sentido, y vuelan sobre todo por la mitad de arriba.
        const ltr = i % 3 !== 1
        const size = rand(26, 58)
        const startY = rand(height * 0.25, height * 0.7)
        return {
          ltr,
          size,
          startY,
          endY: startY - rand(height * 0.15, height * 0.4),
          wave: rand(14, 34),
          // Los grandes (cercanos) cruzan más rápido; los chicos, lejos y lentos.
          duration: rand(2200, 3400) * (1.3 - (size - 26) / 32 * 0.5),
          delay: rand(0, 2200),
          flapMs: rand(110, 170),
          opacity: 0.55 + ((size - 26) / 32) * 0.4,
          progress: new Animated.Value(0),
          flap: new Animated.Value(0),
        }
      }),
    [count, width, height]
  )

  useEffect(() => {
    const anims = bats.map((b) =>
      Animated.parallel([
        Animated.sequence([
          Animated.delay(b.delay),
          Animated.timing(b.progress, { toValue: 1, duration: b.duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.loop(
          Animated.sequence([
            Animated.timing(b.flap, { toValue: 1, duration: b.flapMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(b.flap, { toValue: 0, duration: b.flapMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ])
        ),
      ])
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [bats])

  return (
    <>
      {bats.map((b, i) => {
        const w = b.size
        const h = b.size / 2
        const translateX = b.progress.interpolate({
          inputRange: [0, 1],
          outputRange: b.ltr ? [-w - 20, width + 20] : [width + 20, -w - 20],
        })
        const translateY = b.progress.interpolate({
          inputRange: [0, 0.25, 0.5, 0.75, 1],
          outputRange: [
            b.startY,
            b.startY + (b.endY - b.startY) * 0.25 - b.wave,
            b.startY + (b.endY - b.startY) * 0.5,
            b.startY + (b.endY - b.startY) * 0.75 - b.wave,
            b.endY,
          ],
        })
        const scaleY = b.flap.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] })
        // Inclinado hacia donde va: sube en diagonal.
        const tilt = b.ltr ? '-12deg' : '12deg'
        return (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              { left: 0, opacity: b.opacity, transform: [{ translateX }, { translateY }, { rotate: tilt }, { scaleY }] },
            ]}
          >
            <Svg width={w} height={h} viewBox="0 0 100 50">
              {/* Casi negro con un toque violeta, y un borde naranja tenue
                  como si los iluminara la luna/las calabazas: sobre fondos
                  oscuros sigue leyéndose la silueta. */}
              <Path d={BAT_PATH} fill="#120A1A" stroke="rgba(255,140,42,0.45)" strokeWidth={1.5} />
            </Svg>
          </Animated.View>
        )
      })}
    </>
  )
}

// ── Hiperespacio (Star Wars) ─────────────────────────────────────────────
// Estelas que nacen en el centro y salen disparadas hacia los bordes,
// acelerando y estirándose: el salto a la velocidad de la luz.
function Hyperspace({ count, color }: { count: number; color: string }) {
  const { width, height } = useWindowDimensions()
  const reach = Math.hypot(width, height) / 2 + 40
  const streaks = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        angle: rand(0, 360),
        start: rand(10, 60), // nace un poco afuera del centro
        length: rand(40, 120),
        thick: rand(1, 2.4),
        ms: rand(700, 1300),
        delay: rand(0, 1600),
        opacity: rand(0.5, 1),
        v: new Animated.Value(0),
      })),
    [count, width, height]
  )
  useEffect(() => {
    const anims = streaks.map((s) =>
      Animated.sequence([
        Animated.delay(s.delay),
        Animated.loop(
          Animated.sequence([
            Animated.timing(s.v, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(s.v, { toValue: 1, duration: s.ms, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          ])
        ),
      ])
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [streaks])

  return (
    <View style={[StyleSheet.absoluteFill, styles.center]}>
      {streaks.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: s.thick,
            height: s.length,
            borderRadius: s.thick,
            backgroundColor: color,
            shadowColor: color, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
            opacity: s.v.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, s.opacity, s.opacity, 0] }),
            transform: [
              { rotate: `${s.angle}deg` },
              { translateY: s.v.interpolate({ inputRange: [0, 1], outputRange: [-s.start, -reach] }) },
              // Se estira mientras acelera.
              { scaleY: s.v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.6] }) },
            ],
          }}
        />
      ))}
    </View>
  )
}

// ── Bokeh (plataformas) ──────────────────────────────────────────────────
// Círculos de luz desenfocados en el color de la marca que suben despacio y
// se desvanecen, como luces fuera de foco detrás de un plano de cine. Pocos,
// grandes y muy transparentes: ambienta sin tapar nada.
function Bokeh({ colors, count }: { colors: string[]; count: number }) {
  const { width, height } = useWindowDimensions()
  const lights = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const size = rand(28, 96)
        return {
          id: `bk${i}`,
          size,
          x: rand(-size / 2, width - size / 2),
          y: rand(height * 0.1, height * 0.85),
          rise: rand(60, 160),
          drift: rand(-24, 24),
          ms: rand(3200, 4600),
          delay: rand(0, 900),
          // Las grandes (más "cerca" y más desenfocadas) son más tenues.
          opacity: 0.42 - ((size - 28) / 68) * 0.22,
          color: pick(colors),
          v: new Animated.Value(0),
        }
      }),
    [count, width, height, colors]
  )
  useEffect(() => {
    const anims = lights.map((l) =>
      Animated.sequence([
        Animated.delay(l.delay),
        Animated.timing(l.v, { toValue: 1, duration: l.ms, easing: Easing.out(Easing.sin), useNativeDriver: true }),
      ])
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [lights])

  return (
    <>
      {lights.map((l) => (
        <Animated.View
          key={l.id}
          style={{
            position: 'absolute',
            left: l.x,
            top: l.y,
            opacity: l.v.interpolate({ inputRange: [0, 0.25, 0.7, 1], outputRange: [0, l.opacity, l.opacity, 0] }),
            transform: [
              { translateY: l.v.interpolate({ inputRange: [0, 1], outputRange: [0, -l.rise] }) },
              { translateX: l.v.interpolate({ inputRange: [0, 1], outputRange: [0, l.drift] }) },
              { scale: l.v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) },
            ],
          }}
        >
          <SoftFlake size={l.size} id={l.id} color={l.color} />
        </Animated.View>
      ))}
    </>
  )
}

// ── Estrellas que titilan (El espacio) ───────────────────────────────────
function Twinkle({ count, color }: { count: number; color: string }) {
  const { width, height } = useWindowDimensions()
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: rand(0, width),
        y: rand(0, height * 0.75),
        size: rand(1.5, 3.5),
        delay: rand(0, 2000),
        duration: rand(900, 1700),
        v: new Animated.Value(0),
      })),
    [count, width, height]
  )
  useEffect(() => {
    const anims = stars.map((s) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(s.delay),
          Animated.timing(s.v, { toValue: 1, duration: s.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(s.v, { toValue: 0, duration: s.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [stars])

  return (
    <>
      {stars.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: s.x, top: s.y,
            width: s.size, height: s.size, borderRadius: s.size, backgroundColor: color,
            shadowColor: color, shadowOpacity: 1, shadowRadius: s.size * 2, shadowOffset: { width: 0, height: 0 },
            opacity: s.v,
            transform: [{ scale: s.v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.2] }) }],
          }}
        />
      ))}
    </>
  )
}

// ── Relámpago (Terror, Zombies) ──────────────────────────────────────────
// Dos destellos cortos, como una tormenta afuera. Suaves (opacidad máxima
// 0.55) y nunca más de 3 por segundo: por debajo del umbral de destellos que
// las guías de accesibilidad marcan como riesgoso.
function Flash({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const blink = (peak: number, ms: number) =>
      Animated.sequence([
        Animated.timing(v, { toValue: peak, duration: 60, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ])
    const a = Animated.sequence([
      Animated.delay(500),
      blink(0.55, 260),
      Animated.delay(120),
      blink(0.35, 700),
      Animated.delay(1500),
      blink(0.3, 600),
    ])
    a.start()
    // El trueno se siente: un golpe háptico con el primer destello.
    const t = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 520)
    return () => { a.stop(); clearTimeout(t) }
  }, [])
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: v }]} />
}

const styles = StyleSheet.create({
  layer: { zIndex: 5 },
  particle: { position: 'absolute', top: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
})
