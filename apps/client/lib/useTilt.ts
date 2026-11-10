import {
  SensorType, useAnimatedReaction, useAnimatedSensor, useReducedMotion, useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

// Inclinación del teléfono, para el relieve de los hero (como los pósters de
// Apple TV que se mueven en capas). Devuelve x/y entre -1 y 1, suavizados.
//
// Todo corre en el hilo de UI (Reanimated): el sensor de gravedad, el cálculo
// y el movimiento de las capas, sin pasar por JS.
//
// · Es RELATIVO a cómo lo estás sosteniendo: el "centro" sigue despacio tu
//   postura, así que acostado o sentado arranca quieto, y si te quedás en una
//   posición, vuelve solo al centro.
// · Se normaliza el vector de gravedad: funciona igual venga en g o en m/s².
// · Con Reducir movimiento se queda en 0 (sin relieve).
export type Tilt = { x: SharedValue<number>; y: SharedValue<number> }

const RANGE = 0.22 // ~13° de inclinación = recorrido completo
const FOLLOW = 0.015 // qué tan rápido el centro sigue tu postura
const SMOOTH = 0.16 // suavizado de cada lectura

export function useTilt(enabled = true): Tilt {
  const reduceMotion = useReducedMotion()
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: 16 })
  const base = useSharedValue<{ x: number; y: number } | null>(null)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const on = enabled && !reduceMotion

  useAnimatedReaction(
    () => sensor.sensor.value,
    (g) => {
      if (!on) { x.value = 0; y.value = 0; return }
      const n = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z)
      if (n < 0.0001) return
      const gx = g.x / n
      const gy = g.y / n
      const b = base.value
      if (!b) { base.value = { x: gx, y: gy }; return }
      const bx = b.x + (gx - b.x) * FOLLOW
      const by = b.y + (gy - b.y) * FOLLOW
      base.value = { x: bx, y: by }
      const tx = Math.max(-1, Math.min(1, (gx - bx) / RANGE))
      const ty = Math.max(-1, Math.min(1, (gy - by) / RANGE))
      x.value += (tx - x.value) * SMOOTH
      y.value += (ty - y.value) * SMOOTH
    },
    [on]
  )
  return { x, y }
}
