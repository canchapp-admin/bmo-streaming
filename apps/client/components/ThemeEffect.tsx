import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgLinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
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
  | { type: 'bats'; count: number; rim?: string; fill?: string; delayMs?: number }
  | { type: 'rain'; count: number }
  | { type: 'candles'; count: number }
  | { type: 'clouds'; count: number }
  | { type: 'spell'; at: number }
  | { type: 'searchlight' }
  | { type: 'snow'; count: number }
  | { type: 'hyperspace'; count: number; color: string }
  | { type: 'bokeh'; colors: string[]; count: number }
  | { type: 'webs' }

// Qué animación tiene cada especial. Los que no figuran no tienen.
// Un especial puede combinar varias (Halloween: murciélagos + brasas).
const EFFECTS: Record<string, Effect | Effect[]> = {
  // Los Simpson: como la apertura, se abren las nubes del cielo.
  simpsons: { type: 'clouds', count: 9 },
  // Harry Potter: el Gran Comedor sin dibujar a nadie. Velas que flotan y
  // titilan sobre el castillo de noche, un cielo con estrellas y, al segundo,
  // un hechizo: una estela de chispas doradas que cruza en arco y estalla.
  harrypotter: [
    { type: 'twinkle', count: 18, color: '#FFF3D0' },
    { type: 'candles', count: 15 },
    { type: 'spell', at: 1300 },
  ],
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
  // Marvel: un guiño a Spider-Man sin dibujarlo (su diseño tiene derechos):
  // dos telarañas salen disparadas y quedan tejidas en las esquinas, sobre
  // luces rojas Marvel.
  marvel: [
    { type: 'bokeh', colors: ['#ED1D24', '#FF4A4A'], count: 10 },
    { type: 'webs' },
  ],
  // DC: una noche en Gotham, sin el emblema (tiene derechos). Llovizna en
  // diagonal, un reflector que barre el cielo, un relámpago y una bandada de
  // murciélagos con borde azul frío.
  dc: [
    { type: 'rain', count: 70 },
    { type: 'searchlight' },
    { type: 'flash', color: '#BFD9FF' },
    { type: 'bats', count: 11, rim: 'rgba(150,190,255,0.5)', fill: '#070B14', delayMs: 700 },
  ],
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
  marvel: { show: 4400, fade: 1100 },
  dc: { show: 4800, fade: 1300 },
  harrypotter: { show: 5600, fade: 1600 },
  simpsons: { show: 2800, fade: 800 },
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
        : e.type === 'bats' ? <Bats key={i} count={e.count} rim={e.rim} fill={e.fill} delayMs={e.delayMs} />
        : e.type === 'rain' ? <Rain key={i} count={e.count} />
        : e.type === 'candles' ? <Candles key={i} count={e.count} />
        : e.type === 'clouds' ? <Clouds key={i} count={e.count} />
        : e.type === 'spell' ? <Spell key={i} at={e.at} />
        : e.type === 'searchlight' ? <Searchlight key={i} />
        : e.type === 'snow' ? <Snow key={i} count={e.count} />
        : e.type === 'hyperspace' ? <Hyperspace key={i} count={e.count} color={e.color} />
        : e.type === 'bokeh' ? <Bokeh key={i} colors={e.colors} count={e.count} />
        : e.type === 'webs' ? <Webs key={i} />
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

function Bats({
  count,
  // Halloween: casi negro violáceo con borde naranja (calabazas). DC: más
  // azul y con borde frío (luna, reflector).
  rim = 'rgba(255,140,42,0.45)',
  fill = '#120A1A',
  delayMs = 0,
}: { count: number; rim?: string; fill?: string; delayMs?: number }) {
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
          delay: delayMs + rand(0, 2200),
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
              <Path d={BAT_PATH} fill={fill} stroke={rim} strokeWidth={1.5} />
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

// ── Telarañas (Marvel) ───────────────────────────────────────────────────
// "¡Thwip!": una hebra sale disparada desde afuera de la pantalla hacia una
// esquina y, al pegar, la telaraña se despliega desde esa esquina con un
// rebote. Dos disparos: arriba a la izquierda y abajo a la derecha. La red se
// arma por código (radios + hilos que se comban hacia la esquina), así que
// es nítida a cualquier tamaño.
const WEB = 230
function webPath(size: number) {
  const angles = [0, 15, 30, 45, 60, 75, 90].map((d) => (d * Math.PI) / 180)
  const radii = [0.18, 0.34, 0.5, 0.67, 0.84].map((r) => r * size)
  const pt = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r]
  let d = ''
  // Radios: de la esquina hacia afuera.
  for (const a of angles) {
    const [x, y] = pt(a, size)
    d += `M0 0 L${x.toFixed(1)} ${y.toFixed(1)} `
  }
  // Hilos en espiral: cada tramo entre dos radios se comba hacia la esquina,
  // que es lo que le da el aspecto de telaraña y no de tablero.
  for (const r of radii) {
    for (let i = 0; i < angles.length - 1; i++) {
      const [x1, y1] = pt(angles[i], r)
      const [x2, y2] = pt(angles[i + 1], r)
      const [cx, cy] = pt((angles[i] + angles[i + 1]) / 2, r * 0.86)
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `
    }
  }
  return d
}
const WEB_D = webPath(WEB)

function Webs() {
  const { width, height } = useWindowDimensions()
  const shots = useMemo(
    () => [
      // Esquina arriba-izquierda (debajo del botón de volver queda bien: el
      // botón es vidrio y la red se ve a través).
      { corner: 'tl' as const, at: 250, from: { x: width * 0.55, y: height * 0.5 } },
      { corner: 'br' as const, at: 800, from: { x: width * 0.35, y: height * 0.45 } },
    ].map((s) => ({ ...s, line: new Animated.Value(0), web: new Animated.Value(0) })),
    [width, height]
  )

  useEffect(() => {
    const anims = shots.map((s) =>
      Animated.sequence([
        Animated.delay(s.at),
        // La hebra viaja…
        Animated.timing(s.line, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        // …y la red se abre con rebote al pegar.
        Animated.spring(s.web, { toValue: 1, damping: 9, stiffness: 180, mass: 0.6, useNativeDriver: true }),
      ])
    )
    anims.forEach((a) => a.start())
    const timers = shots.map((s) =>
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), s.at + 170)
    )
    return () => { anims.forEach((a) => a.stop()); timers.forEach(clearTimeout) }
  }, [shots])

  return (
    <>
      {shots.map((s, i) => {
        const tl = s.corner === 'tl'
        const cx = tl ? 0 : width
        const cy = tl ? 0 : height
        // La hebra: una línea de la "mano" a la esquina que se estira de
        // golpe y se desvanece cuando la red ya pegó.
        const dx = cx - s.from.x
        const dy = cy - s.from.y
        const len = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)
        return (
          <View key={i} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Animated.View
              style={{
                position: 'absolute',
                left: s.from.x,
                top: s.from.y - 1,
                width: len,
                height: 2,
                backgroundColor: 'rgba(255,255,255,0.9)',
                shadowColor: '#fff', shadowOpacity: 0.8, shadowRadius: 3, shadowOffset: { width: 0, height: 0 },
                transformOrigin: 'left center',
                opacity: s.web.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.4, 0] }),
                transform: [{ rotate: `${angle}rad` }, { scaleX: s.line }],
              }}
            />
            <Animated.View
              style={{
                position: 'absolute',
                left: tl ? 0 : width - WEB,
                top: tl ? 0 : height - WEB,
                width: WEB,
                height: WEB,
                transformOrigin: tl ? 'top left' : 'bottom right',
                opacity: s.web.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
                transform: [{ scale: s.web }],
              }}
            >
              <Svg width={WEB} height={WEB} style={tl ? undefined : { transform: [{ rotate: '180deg' }] }}>
                <Path d={WEB_D} stroke="rgba(255,255,255,0.88)" strokeWidth={1.3} fill="none" strokeLinecap="round" />
              </Svg>
            </Animated.View>
          </View>
        )
      })}
    </>
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

// ── Lluvia (DC) ──────────────────────────────────────────────────────────
// Llovizna en diagonal: trazos finos y rápidos, más tenues los lejanos.
function Rain({ count }: { count: number }) {
  const { width, height } = useWindowDimensions()
  const drops = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const near = Math.random() < 0.3
        return {
          x: rand(-60, width + 20),
          len: near ? rand(22, 34) : rand(12, 20),
          ms: near ? rand(480, 650) : rand(700, 950),
          opacity: near ? rand(0.35, 0.55) : rand(0.15, 0.3),
          start: Math.random(),
          v: new Animated.Value(0),
        }
      }),
    [count, width]
  )
  useEffect(() => {
    const anims = drops.map((d) => {
      d.v.setValue(d.start)
      return Animated.sequence([
        Animated.timing(d.v, { toValue: 1, duration: d.ms * (1 - d.start), easing: Easing.linear, useNativeDriver: true }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(d.v, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.timing(d.v, { toValue: 1, duration: d.ms, easing: Easing.linear, useNativeDriver: true }),
          ])
        ),
      ])
    })
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [drops])
  const slant = 0.22 // corrimiento lateral por punto de caída (viento)
  return (
    <>
      {drops.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            left: d.x,
            width: 1.2,
            height: d.len,
            borderRadius: 1,
            backgroundColor: '#C9DAFF',
            opacity: d.opacity,
            transform: [
              { translateY: d.v.interpolate({ inputRange: [0, 1], outputRange: [-d.len, height] }) },
              { translateX: d.v.interpolate({ inputRange: [0, 1], outputRange: [0, height * slant] }) },
              { rotate: `${-Math.atan(slant)}rad` },
            ],
          }}
        />
      ))}
    </>
  )
}

// ── Reflector (DC) ───────────────────────────────────────────────────────
// Un haz de luz cálida que sube desde abajo y barre el cielo despacio, con
// el círculo de luz donde pega en las nubes. Sin emblema: solo la luz.
function Searchlight() {
  const { width, height } = useWindowDimensions()
  const sweep = useRef(new Animated.Value(0)).current
  const on = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const a = Animated.parallel([
      Animated.timing(on, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 1, duration: 4600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])
    a.start()
    return () => a.stop()
  }, [])
  const beamH = height * 0.95
  const beamW = width * 0.9
  const topY = beamW * 0.16
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        // Base del haz abajo, un poco a la izquierda del centro.
        left: width * 0.42 - beamW / 2,
        top: height - beamH + 40,
        width: beamW,
        height: beamH,
        opacity: on,
        transformOrigin: 'bottom center',
        transform: [{ rotate: sweep.interpolate({ inputRange: [0, 1], outputRange: ['-24deg', '14deg'] }) }],
      }}
    >
      <Svg width={beamW} height={beamH}>
        <Defs>
          <SvgLinearGradient id="beam" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#FFF3C4" stopOpacity="0.22" />
            <Stop offset="0.7" stopColor="#FFF3C4" stopOpacity="0.07" />
            <Stop offset="1" stopColor="#FFF3C4" stopOpacity="0.02" />
          </SvgLinearGradient>
          <RadialGradient id="spot" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFF6D6" stopOpacity="0.55" />
            <Stop offset="0.6" stopColor="#FFF3C4" stopOpacity="0.22" />
            <Stop offset="1" stopColor="#FFF3C4" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Haz: angosto abajo, ancho arriba. Tres capas de distinto ancho
            y opacidad dan bordes suaves (un solo trapecio se veía como un
            bloque de bordes duros). */}
        {[0.16, 0.11, 0.06].map((half, i) => (
          <Path
            key={i}
            d={`M${beamW / 2 - 3 - i} ${beamH} L${beamW / 2 + 3 + i} ${beamH} L${beamW / 2 + beamW * half} ${topY} L${beamW / 2 - beamW * half} ${topY} Z`}
            fill="url(#beam)"
            opacity={0.45 + i * 0.25}
          />
        ))}
        {/* El círculo de luz en las nubes. */}
        <Ellipse cx={beamW / 2} cy={topY} rx={beamW * 0.2} ry={beamW * 0.11} fill="url(#spot)" />
      </Svg>
    </Animated.View>
  )
}

// ── Nubes que se abren (Los Simpson) ─────────────────────────────────────
// Al entrar, la parte de arriba está cubierta de nubes blancas y mullidas
// que se separan hacia los costados y se desvanecen, como el cielo que se
// abre al principio de la serie.
function Clouds({ count }: { count: number }) {
  const { width, height } = useWindowDimensions()
  const clouds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const left = i % 2 === 0
        const w = rand(width * 0.55, width * 0.85)
        return {
          w,
          x: rand(-w * 0.35, width - w * 0.65),
          y: rand(-20, height * 0.32),
          dx: (left ? -1 : 1) * rand(width * 0.6, width * 0.95),
          dy: rand(-30, 10),
          delay: rand(150, 650),
          ms: rand(1700, 2400),
          v: new Animated.Value(0),
        }
      }),
    [count, width, height]
  )
  useEffect(() => {
    const anims = clouds.map((c) =>
      Animated.sequence([
        Animated.delay(c.delay),
        Animated.timing(c.v, { toValue: 1, duration: c.ms, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ])
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [clouds])
  return (
    <>
      {clouds.map((c, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: c.x, top: c.y,
            opacity: c.v.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.97, 0.9, 0] }),
            transform: [
              { translateX: c.v.interpolate({ inputRange: [0, 1], outputRange: [0, c.dx] }) },
              { translateY: c.v.interpolate({ inputRange: [0, 1], outputRange: [0, c.dy] }) },
              { scale: c.v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
            ],
          }}
        >
          <CloudShape width={c.w} id={`cl${i}`} />
        </Animated.View>
      ))}
    </>
  )
}

// Nube de dibujo animado: bollos redondos sobre una base plana, blanca arriba
// y apenas celeste abajo.
function CloudShape({ width, id }: { width: number; id: string }) {
  return (
    <Svg width={width} height={width * 0.5} viewBox="0 0 200 100">
      <Defs>
        <SvgLinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.45" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#DCEBFA" />
        </SvgLinearGradient>
      </Defs>
      <Path
        d="M 22 86 C 4 86 2 62 20 58 C 16 36 44 28 56 42 C 60 18 98 10 110 34 C 122 14 160 20 158 46 C 182 42 196 62 184 78 C 182 84 176 86 170 86 Z"
        fill={`url(#${id}g)`}
      />
    </Svg>
  )
}

// ── Lámpara de escritorio (Pixar) ────────────────────────────────────────
// Una lámpara articulada de las de toda la vida (brazos con resortes, pantalla
// cónica, base redonda) que entra saltando desde la derecha como si estuviera
// viva: se agacha para tomar impulso, se estira en el aire, se aplasta al
// caer y rebota. Prende la luz con un parpadeo y mira la pantalla con
// curiosidad, ladeando la cabeza. Hápticos al caer y al prenderse.
//
// Geometría (en el cuadro de 170×180 del cuerpo, mirando a la izquierda):
// base en (110,156), codo en (134,94), cuello en (78,50). La cabeza es otro
// cuadro de 90×90 cuyo eje (60,30) cae justo en el cuello y gira sobre él.
const LAMP_B: [number, number] = [110, 156]
const LAMP_E: [number, number] = [134, 94]
const LAMP_P: [number, number] = [78, 50]
const LAMP_W = 170
const LAMP_H = 180

// Las dos varillas paralelas de un brazo.
function lampRods(a: [number, number], b: [number, number], off = 3) {
  const [ax, ay] = a
  const [bx, by] = b
  const len = Math.hypot(bx - ax, by - ay)
  const nx = -(by - ay) / len
  const ny = (bx - ax) / len
  return [-off, off].map((o) => [ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o])
}
// El resorte en zigzag al costado del brazo, en su tramo del medio.
function lampSpring(a: [number, number], b: [number, number], off: number, n = 9, amp = 3.2) {
  const [ax, ay] = a
  const dx = b[0] - ax
  const dy = b[1] - ay
  const len = Math.hypot(dx, dy)
  const nx = -dy / len
  const ny = dx / len
  const pts = Array.from({ length: n + 1 }, (_, k) => {
    const t = 0.25 + (0.5 * k) / n
    const s = k > 0 && k < n ? (k % 2 ? amp : -amp) : 0
    return `${(ax + dx * t + nx * (off + s)).toFixed(1)} ${(ay + dy * t + ny * (off + s)).toFixed(1)}`
  })
  return 'M ' + pts.join(' L ')
}

function LampBody() {
  const arms: [[number, number], [number, number], number][] = [[LAMP_B, LAMP_E, 9], [LAMP_E, LAMP_P, -9]]
  return (
    <Svg width={LAMP_W} height={LAMP_H} viewBox={`0 0 ${LAMP_W} ${LAMP_H}`}>
      <Defs>
        <SvgLinearGradient id="lampBase" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F4F4F6" />
          <Stop offset="1" stopColor="#B9BBC3" />
        </SvgLinearGradient>
      </Defs>
      <Path d="M 80 174 C 80 160 92 154 110 154 C 128 154 140 160 140 174 Z" fill="url(#lampBase)" />
      <Rect x={76} y={171} width={68} height={6} rx={3} fill="#B8B8C0" />
      {arms.map(([a, b, off], i) => (
        <G key={i}>
          {lampRods(a, b).map(([x1, y1, x2, y2], k) => (
            <Path key={k} d={`M ${x1} ${y1} L ${x2} ${y2}`} stroke="#D9D9DE" strokeWidth={3.4} strokeLinecap="round" />
          ))}
          <Path d={lampSpring(a, b, off)} stroke="#9EA0A8" strokeWidth={1.6} fill="none" strokeLinejoin="round" />
        </G>
      ))}
      {[LAMP_B, LAMP_E].map(([x, y], i) => (
        <G key={i}>
          <Circle cx={x} cy={y} r={6} fill="#A4A6AE" />
          <Circle cx={x} cy={y} r={2.4} fill="#6E7078" />
        </G>
      ))}
    </Svg>
  )
}

// La pantalla. `light` (0–1) prende la lamparita y el haz.
//
// Lo que hace que la luz se vea real:
//  · El haz son seis conos superpuestos, cada uno un poco más abierto y más
//    tenue: el borde se difumina de verdad, sin escalones.
//  · Se apaga con la distancia (fuerte en la boca, nada al final) y tiene un
//    resplandor caliente en la boca.
//  · Polvo flotando dentro del haz: motitas que brillan solo donde hay luz.
//  · La lamparita "calienta": primero naranja, después blanca.
//  · La luz ilumina la propia lámpara: el borde de la boca se enciende.
const BEAM_L = 380
const BEAM_C = 170 // centro vertical del cuadro del haz (ahí está la boca)
const BEAM_LAYERS = Array.from({ length: 6 }, (_, k) => {
  const t = k / 5
  return {
    mouth: 11 + t * 17, // semiancho en la boca
    end: BEAM_L * Math.tan(((7 + t * 20) * Math.PI) / 180), // semiancho al final
    o: 0.075 - t * 0.03,
  }
})
// Motitas de polvo dentro del cono interior.
const MOTES = Array.from({ length: 16 }, (_, k) => {
  const x = 50 + ((k * 137) % 250)
  const spread = x * Math.tan((9 * Math.PI) / 180)
  return {
    x,
    y: BEAM_C + (((k * 53) % 100) / 50 - 1) * spread,
    r: 0.8 + ((k * 31) % 10) / 10,
    ms: 2600 + ((k * 71) % 2000),
    dx: ((k % 3) - 1) * 10,
    dy: (((k * 7) % 3) - 1) * 8,
  }
})

function LampHead({ light }: { light: Animated.Value }) {
  // Posición al azar dentro del cono (con la fórmula fija quedaban en fila).
  const motes = useMemo(
    () =>
      MOTES.map((m) => {
        const x = rand(40, 300)
        const spread = x * Math.tan((9 * Math.PI) / 180)
        return { ...m, x, y: BEAM_C + rand(-spread, spread), v: new Animated.Value(Math.random()) }
      }),
    []
  )
  useEffect(() => {
    const anims = motes.map((m) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(m.v, { toValue: 1, duration: m.ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(m.v, { toValue: 0, duration: m.ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [motes])

  // Boca de la pantalla en (33,57), mirando abajo a la izquierda (135°).
  return (
    <View style={{ width: 90, height: 90 }}>
      <Animated.View
        style={{
          position: 'absolute', left: 33, top: 57 - BEAM_C, width: BEAM_L, height: BEAM_C * 2,
          transformOrigin: [0, BEAM_C, 0],
          transform: [{ rotate: '135deg' }],
          opacity: light,
        }}
      >
        <Svg width={BEAM_L} height={BEAM_C * 2}>
          <Defs>
            {BEAM_LAYERS.map((l, k) => (
              <SvgLinearGradient key={k} id={`lampBeam${k}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFE6B0" stopOpacity={l.o} />
                <Stop offset="0.25" stopColor="#FFE6B0" stopOpacity={l.o * 0.7} />
                <Stop offset="0.6" stopColor="#FFE9BE" stopOpacity={l.o * 0.25} />
                <Stop offset="1" stopColor="#FFE9BE" stopOpacity={0} />
              </SvgLinearGradient>
            ))}
            <RadialGradient id="lampHot" cx="0" cy={BEAM_C} r="140" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#FFF4D6" stopOpacity={0.42} />
              <Stop offset="0.35" stopColor="#FFE3A8" stopOpacity={0.12} />
              <Stop offset="1" stopColor="#FFE3A8" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {BEAM_LAYERS.map((l, k) => (
            <Path
              key={k}
              d={`M 0 ${BEAM_C - l.mouth} L ${BEAM_L} ${BEAM_C - l.end} L ${BEAM_L} ${BEAM_C + l.end} L 0 ${BEAM_C + l.mouth} Z`}
              fill={`url(#lampBeam${k})`}
            />
          ))}
          <Path d={`M 0 ${BEAM_C - 30} L ${BEAM_L} 0 L ${BEAM_L} ${BEAM_C * 2} L 0 ${BEAM_C + 30} Z`} fill="url(#lampHot)" />
        </Svg>
        {/* Polvo en el aire: más visible cerca de la boca, donde hay más luz */}
        {motes.map((m, k) => (
          <Animated.View
            key={k}
            style={{
              position: 'absolute', left: m.x, top: m.y,
              width: m.r * 2, height: m.r * 2, borderRadius: m.r, backgroundColor: '#FFF3D6',
              opacity: m.v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.75, 0.15] }).interpolate({
                inputRange: [0, 1], outputRange: [0, 1 - m.x / BEAM_L],
              }),
              transform: [
                { translateX: m.v.interpolate({ inputRange: [0, 1], outputRange: [0, m.dx] }) },
                { translateY: m.v.interpolate({ inputRange: [0, 1], outputRange: [0, m.dy] }) },
              ],
            }}
          />
        ))}
      </Animated.View>
      {/* Halo alrededor de la lamparita */}
      <Animated.View style={{ position: 'absolute', left: 35 - 42, top: 55 - 42, opacity: light }}>
        <SoftFlake size={84} id="lampHalo" color="#FFE2A6" />
      </Animated.View>
      <Svg width={90} height={90} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* Metal: luz arriba, una franja de brillo y sombra abajo */}
          <SvgLinearGradient id="lampShade" x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.35" stopColor="#E6E7EC" />
            <Stop offset="0.7" stopColor="#BFC1C9" />
            <Stop offset="1" stopColor="#8E909A" />
          </SvgLinearGradient>
          <RadialGradient id="lampCap" cx="35%" cy="30%" r="70%">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#A9ABB4" />
          </RadialGradient>
        </Defs>
        <Path d="M 53 23 L 14.8 38.8 A 26 8 45 0 0 51.2 75.2 L 67 37 A 10 10 0 0 0 53 23 Z" fill="url(#lampShade)" />
        {/* Brillo especular a lo largo de la pantalla */}
        <Path d="M 52 27 L 22 39.5" stroke="rgba(255,255,255,0.85)" strokeWidth={2} strokeLinecap="round" />
        {/* Boca apagada: el interior en sombra */}
        <Ellipse cx={33} cy={57} rx={26} ry={8} transform="rotate(45 33 57)" fill="#4A4C54" />
      </Svg>
      {/* Boca encendida: la lamparita calienta (naranja → blanca) y el
          interior de la pantalla se ilumina, con el borde encendido. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: light }]}>
        <Svg width={90} height={90}>
          <Ellipse cx={33} cy={57} rx={26} ry={8} transform="rotate(45 33 57)" fill="#FFE7B4" />
          <Ellipse cx={33} cy={57} rx={25.4} ry={7.6} transform="rotate(45 33 57)" fill="none" stroke="#FFF7E2" strokeWidth={1.2} />
          <Circle cx={35} cy={55} r={9.5} fill="#FFB75E" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: light.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.2, 1] }) }]}
      >
        <Svg width={90} height={90}>
          <Circle cx={35} cy={55} r={9.5} fill="#FFFDF5" />
          <Circle cx={35} cy={55} r={5} fill="#FFFFFF" />
        </Svg>
      </Animated.View>
      <Svg width={90} height={90} style={StyleSheet.absoluteFill}>
        <Circle cx={62} cy={28} r={12} fill="url(#lampCap)" />
        <Path d="M 55 21 A 9 9 0 0 1 64 18" stroke="rgba(255,255,255,0.9)" strokeWidth={1.6} strokeLinecap="round" fill="none" />
        <Circle cx={62} cy={28} r={4} fill="#A4A6AE" />
        <Circle cx={62} cy={28} r={1.6} fill="#6E7078" />
        <Circle cx={71} cy={18} r={3} fill="#BFC1C8" />
      </Svg>
    </View>
  )
}

export const PIXAR_LAMP_SIZE = { width: LAMP_W, height: LAMP_H }

// Hacia dónde tiene que girar la cabeza (en grados) para que el haz apunte a
// un punto: el haz pasa justo por el cuello (la boca está sobre su eje), así
// que alcanza con el ángulo desde el cuello. `tx`/`ty` en coordenadas del
// cuadro de la lámpara.
export function pixarLampAim(tx: number, ty: number) {
  return (Math.atan2(ty - LAMP_P[1], tx - LAMP_P[0]) * 180) / Math.PI - 135
}

// Dónde cruza el eje del haz la altura `ty` (en x, coordenadas del cuadro de
// la lámpara) para varios giros de cabeza: para que lo iluminado siga al haz.
export function pixarLampHits(ty: number, angles: number[]) {
  return angles.map((deg) => {
    const phi = ((135 + deg) * Math.PI) / 180
    const dy = ty - LAMP_P[1]
    return LAMP_P[0] + (dy * Math.cos(phi)) / Math.max(0.1, Math.sin(phi))
  })
}

// La lámpara de Pixar, parada sobre un piso. La ubica la pantalla (el estudio
// la pone sobre el título destacado): `style` posiciona su cuadro, cuyo borde
// de abajo es el piso; `screenLeft` es dónde queda ese cuadro en la pantalla
// (para que el piso cruce de lado a lado). `light` y `head` los crea la
// pantalla para que otras cosas reaccionen a la luz (el título se ilumina).
// `aim`: hacia dónde termina mirando.
export function PixarLamp({
  light, head, aim, screenLeft, style,
}: {
  light: Animated.Value
  head: Animated.Value
  aim: number
  screenLeft: number
  style?: object
}) {
  const { width } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const x = useRef(new Animated.Value(width * 0.6)).current // empieza fuera, a la derecha
  const y = useRef(new Animated.Value(0)).current
  const squash = useRef(new Animated.Value(0)).current // -1 estirada · 0 normal · 1 aplastada
  const left = screenLeft
  const floorY = LAMP_H - 3 // el piso, en coordenadas de la lámpara
  const floorIn = useRef(new Animated.Value(0)).current

  // Dónde pega el haz en el piso según hacia dónde mira la cabeza: la boca
  // está a (-27, 27) del cuello y gira con él; el haz sale a 135° + giro.
  // Se calcula para varios ángulos y se interpola entre ellos.
  const pool = useMemo(() => {
    const angles = [-25, -10, 0, 10, 20, 30, 38, 46]
    const hit = angles.map((deg) => {
      const r = (deg * Math.PI) / 180
      const mx = LAMP_P[0] + -27 * Math.cos(r) - 27 * Math.sin(r)
      const my = LAMP_P[1] + -27 * Math.sin(r) + 27 * Math.cos(r)
      const phi = ((135 + deg) * Math.PI) / 180
      const dist = (floorY - my) / Math.max(0.12, Math.sin(phi)) // largo del rayo hasta el piso
      return { x: mx + Math.cos(phi) * dist, dist }
    })
    return {
      angles,
      x: hit.map((h) => h.x),
      // Más lejos: el charco se estira y se apaga.
      scale: hit.map((h) => Math.min(2.4, 0.7 + h.dist / 220)),
      fade: hit.map((h) => Math.max(0.15, Math.min(1, 1.25 - h.dist / 420))),
    }
  }, [floorY])

  useEffect(() => {
    // Sin animaciones: la lámpara ya está en su lugar, prendida y mirando.
    if (reduceMotion) {
      x.setValue(0); light.setValue(1); head.setValue(aim); floorIn.setValue(1)
      return
    }
    head.setValue(-12)
    light.setValue(0)
    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
      Animated.timing(v, { toValue, duration, easing, useNativeDriver: true })
    // Agacharse → saltar estirada (la caída). Después, aplastarse y rebotar.
    const jump = (toX: number, ms: number, h: number) =>
      Animated.sequence([
        t(squash, 0.8, 130, Easing.out(Easing.quad)),
        Animated.parallel([
          t(x, toX, ms, Easing.inOut(Easing.sin)),
          Animated.sequence([t(y, -h, ms / 2, Easing.out(Easing.quad)), t(y, 0, ms / 2, Easing.in(Easing.quad))]),
          Animated.sequence([t(squash, -1, ms * 0.3, Easing.out(Easing.quad)), t(squash, 0, ms * 0.7)]),
          // La cabeza acompaña: mira arriba al subir y al piso al caer.
          Animated.sequence([t(head, -22, ms / 2), t(head, -6, ms / 2)]),
        ]),
      ])
    const land = () =>
      Animated.sequence([
        t(squash, 1, 70, Easing.out(Easing.quad)),
        Animated.spring(squash, { toValue: 0, speed: 20, bounciness: 12, useNativeDriver: true }),
      ])
    const tap = (style: Haptics.ImpactFeedbackStyle) => () => Haptics.impactAsync(style).catch(() => {})
    // Pasos en orden; el háptico va justo cuando arranca su paso (al tocar el
    // piso, al prender la luz), así coincide aunque el rebote dure lo que dure.
    const steps: [Animated.CompositeAnimation, (() => void)?][] = [
      [Animated.delay(250)],
      [jump(width * 0.28, 480, 70)],
      [land(), tap(Haptics.ImpactFeedbackStyle.Light)],
      [jump(0, 440, 55)],
      [land(), tap(Haptics.ImpactFeedbackStyle.Medium)],
      [Animated.delay(120)],
      // Prende con un parpadeo, como una lamparita de verdad.
      [Animated.sequence([t(light, 1, 60), t(light, 0.15, 70), t(light, 1, 80), t(light, 0.5, 50), t(light, 1, 140)]), tap(Haptics.ImpactFeedbackStyle.Soft)],
      [Animated.delay(200)],
      // Busca el título: se pasa un poco, ladea la cabeza con curiosidad y se
      // queda iluminándolo. Al rato te mira a vos, y vuelve al título.
      [Animated.sequence([
        t(head, aim + 14, 520, Easing.out(Easing.back(1.4))),
        Animated.delay(220),
        t(head, aim - 8, 260), t(head, aim + 6, 240), t(head, aim, 300),
        Animated.delay(1400),
        t(head, aim + 30, 520, Easing.out(Easing.back(1.6))),
        Animated.delay(500),
        t(head, aim, 600, Easing.inOut(Easing.cubic)),
      ])],
    ]
    let current: Animated.CompositeAnimation | null = null
    const run = (i: number) => {
      if (i >= steps.length) return
      const [anim, onStart] = steps[i]
      onStart?.()
      current = anim
      anim.start(({ finished }) => finished && run(i + 1))
    }
    Animated.timing(floorIn, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
    run(0)
    return () => current?.stop()
  }, [width, aim, reduceMotion])

  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: LAMP_W, height: LAMP_H }, style]}>
      {/* El piso: una superficie que va de lado a lado, con un filo de luz
          arriba y que se pierde hacia abajo. */}
      <Animated.View
        style={{ position: 'absolute', left: -left, top: floorY, width, height: 56, opacity: floorIn }}
      >
        <Svg width={width} height={56}>
          <Defs>
            <SvgLinearGradient id="lampFloor" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.07} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </SvgLinearGradient>
            <SvgLinearGradient id="lampEdge" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.28} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.12} />
            </SvgLinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={56} fill="url(#lampFloor)" />
          <Rect x={0} y={0} width={width} height={1} fill="url(#lampEdge)" />
        </Svg>
      </Animated.View>
      {/* Charco de luz donde el haz toca el piso: sigue a la cabeza */}
      <Animated.View
        style={{
          position: 'absolute', left: -110, top: floorY - 22, width: 220, height: 44,
          opacity: Animated.multiply(light, head.interpolate({ inputRange: pool.angles, outputRange: pool.fade, extrapolate: 'clamp' })),
          transform: [
            { translateX: Animated.add(x, head.interpolate({ inputRange: pool.angles, outputRange: pool.x, extrapolate: 'clamp' })) },
            { scaleX: head.interpolate({ inputRange: pool.angles, outputRange: pool.scale, extrapolate: 'clamp' }) },
          ],
        }}
      >
        <Svg width={220} height={44}>
          <Defs>
            <RadialGradient id="lampPool" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFEBC0" stopOpacity={0.5} />
              <Stop offset="0.5" stopColor="#FFE2A6" stopOpacity={0.18} />
              <Stop offset="1" stopColor="#FFE2A6" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={110} cy={22} rx={110} ry={22} fill="url(#lampPool)" />
        </Svg>
      </Animated.View>
      {/* Sombra en el piso: se achica y aclara cuando la lámpara está en el aire */}
      <Animated.View
        style={{
          position: 'absolute', left: 70, top: LAMP_H - 7, width: 80, height: 10, borderRadius: 40,
          backgroundColor: 'rgba(0,0,0,0.3)',
          opacity: y.interpolate({ inputRange: [-70, 0], outputRange: [0.35, 1] }),
          transform: [
            { translateX: x },
            { scaleX: y.interpolate({ inputRange: [-70, 0], outputRange: [0.55, 1] }) },
          ],
        }}
      />
      <Animated.View
        style={{
          width: LAMP_W, height: LAMP_H,
          // El aplastón nace en la base, no en el centro.
          transformOrigin: [LAMP_B[0], LAMP_H, 0],
          transform: [
            { translateX: x },
            { translateY: y },
            { scaleY: squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.1, 1, 0.8] }) },
            { scaleX: squash.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.94, 1, 1.12] }) },
          ],
        }}
      >
        <LampBody />
        <Animated.View
          style={{
            position: 'absolute', left: LAMP_P[0] - 60, top: LAMP_P[1] - 30,
            transformOrigin: [60, 30, 0],
            transform: [{ rotate: head.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] }) }],
          }}
        >
          <LampHead light={light} />
        </Animated.View>
      </Animated.View>
    </View>
  )
}

// ── Velas flotantes (Harry Potter) ───────────────────────────────────────
// Velas suspendidas en el aire en la mitad de arriba, cada una flotando
// arriba y abajo a su ritmo, con la llama titilando y un halo cálido. Las
// más chicas (lejanas) son más tenues: da profundidad, como el techo del
// Gran Comedor.
function Candles({ count }: { count: number }) {
  const { width, height } = useWindowDimensions()
  const candles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const depth = rand(0.55, 1.1)
        return {
          id: `cd${i}`,
          // Repartidas en columnas para que no se amontonen.
          x: ((i + rand(0.15, 0.85)) / count) * width,
          y: rand(height * 0.07, height * 0.42),
          depth,
          bobMs: rand(1800, 2800),
          bob: rand(4, 9),
          flickerMs: rand(110, 190),
          delay: rand(0, 900),
          inV: new Animated.Value(0),
          bobV: new Animated.Value(0),
          flick: new Animated.Value(0),
        }
      }),
    [count, width, height]
  )
  useEffect(() => {
    const anims = candles.flatMap((c) => [
      Animated.sequence([
        Animated.delay(c.delay),
        Animated.timing(c.inV, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.loop(
        Animated.sequence([
          Animated.timing(c.bobV, { toValue: 1, duration: c.bobMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(c.bobV, { toValue: 0, duration: c.bobMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(c.flick, { toValue: 1, duration: c.flickerMs, useNativeDriver: true }),
          Animated.timing(c.flick, { toValue: 0.35, duration: c.flickerMs * 1.3, useNativeDriver: true }),
          Animated.timing(c.flick, { toValue: 0.8, duration: c.flickerMs * 0.8, useNativeDriver: true }),
          Animated.timing(c.flick, { toValue: 0, duration: c.flickerMs * 1.1, useNativeDriver: true }),
        ])
      ),
    ])
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [candles])

  const W = 9 // ancho de la vela a escala 1
  const H = 30
  return (
    <>
      {candles.map((c) => (
        <Animated.View
          key={c.id}
          style={{
            position: 'absolute',
            left: c.x,
            top: c.y,
            alignItems: 'center',
            opacity: Animated.multiply(c.inV, 0.45 + (c.depth - 0.55) * 0.9),
            transform: [
              { translateY: c.bobV.interpolate({ inputRange: [0, 1], outputRange: [-c.bob, c.bob] }) },
              { scale: c.depth },
            ],
          }}
        >
          {/* Halo cálido alrededor de la llama */}
          <Animated.View
            style={{
              position: 'absolute', top: -22,
              opacity: c.flick.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.9] }),
            }}
          >
            <SoftFlake size={46} id={`${c.id}h`} color="#FFC861" />
          </Animated.View>
          {/* Llama */}
          <Animated.View
            style={{
              marginBottom: 1,
              transformOrigin: 'bottom center',
              transform: [
                { scaleY: c.flick.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.12] }) },
                { scaleX: c.flick.interpolate({ inputRange: [0, 1], outputRange: [1.05, 0.92] }) },
              ],
            }}
          >
            <Svg width={8} height={13} viewBox="0 0 8 13">
              <Defs>
                <RadialGradient id={`${c.id}f`} cx="50%" cy="70%" r="60%">
                  <Stop offset="0" stopColor="#FFFFFF" />
                  <Stop offset="0.35" stopColor="#FFE9A8" />
                  <Stop offset="1" stopColor="#FF9A2E" />
                </RadialGradient>
              </Defs>
              <Path d="M4 0 C5.6 3 8 5.6 8 8.6 C8 11 6.2 13 4 13 C1.8 13 0 11 0 8.6 C0 5.6 2.4 3 4 0 Z" fill={`url(#${c.id}f)`} />
            </Svg>
          </Animated.View>
          {/* Mecha y cuerpo de cera, con una gota chorreada */}
          <View style={{ width: 1.2, height: 2, backgroundColor: '#3A2A1A' }} />
          <View style={{ width: W, height: H, borderRadius: 1.5, backgroundColor: '#F1E6CC', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: W * 0.35, backgroundColor: 'rgba(120,90,50,0.18)' }} />
            <View style={{ position: 'absolute', left: 1.5, top: 0, width: 2, height: 9, borderRadius: 1, backgroundColor: '#FBF4E2' }} />
          </View>
        </Animated.View>
      ))}
    </>
  )
}

// ── Hechizo (Harry Potter) ───────────────────────────────────────────────
// Una estela de chispas doradas que sale de abajo a la izquierda, cruza la
// pantalla en arco y estalla arriba a la derecha. Cada chispa nace sobre la
// curva, se queda un instante y cae apagándose, como la estela de una varita.
function Spell({ at }: { at: number }) {
  const { width, height } = useWindowDimensions()
  const TRAVEL = 1100
  const sparks = useMemo(() => {
    const p0 = { x: width * 0.08, y: height * 0.82 }
    const c = { x: width * 0.32, y: height * 0.12 }
    const p1 = { x: width * 0.84, y: height * 0.3 }
    const bez = (t: number) => ({
      x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t ** 2 * p1.x,
      y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t ** 2 * p1.y,
    })
    const trail = Array.from({ length: 44 }, (_, i) => {
      const t = i / 43
      const pt = bez(t)
      return {
        ...pt,
        delay: t * TRAVEL,
        dx: rand(-10, 10),
        dy: rand(14, 40), // caen un poco al apagarse
        size: rand(5, 11),
        life: rand(650, 1000),
        color: pick(['#FFE7A3', '#FFD36B', '#FFFFFF', '#F5C542']),
        v: new Animated.Value(0),
      }
    })
    // Estallido final: chispas que salen en todas direcciones.
    const burst = Array.from({ length: 18 }, (_, i) => {
      const ang = (i / 18) * Math.PI * 2 + rand(-0.15, 0.15)
      const dist = rand(40, 95)
      return {
        ...p1,
        delay: TRAVEL,
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist + 20,
        size: rand(6, 12),
        life: rand(800, 1150),
        color: pick(['#FFE7A3', '#FFFFFF', '#F5C542']),
        v: new Animated.Value(0),
      }
    })
    return [...trail, ...burst]
  }, [width, height])

  useEffect(() => {
    const anims = sparks.map((s) =>
      Animated.sequence([
        Animated.delay(at + s.delay),
        Animated.timing(s.v, { toValue: 1, duration: s.life, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ])
    )
    anims.forEach((a) => a.start())
    const t1 = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), at)
    const t2 = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), at + TRAVEL)
    return () => { anims.forEach((a) => a.stop()); clearTimeout(t1); clearTimeout(t2) }
  }, [sparks])

  return (
    <>
      {sparks.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: s.x - s.size / 2,
            top: s.y - s.size / 2,
            opacity: s.v.interpolate({ inputRange: [0, 0.08, 0.6, 1], outputRange: [0, 1, 0.7, 0] }),
            transform: [
              { translateX: s.v.interpolate({ inputRange: [0, 1], outputRange: [0, s.dx] }) },
              { translateY: s.v.interpolate({ inputRange: [0, 1], outputRange: [0, s.dy] }) },
              { scale: s.v.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.3, 1.2, 0.4] }) },
            ],
          }}
        >
          <SymbolView name="sparkle" tintColor={s.color} style={{ width: s.size, height: s.size }} />
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
