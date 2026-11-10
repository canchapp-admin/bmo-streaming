import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

// "Reducir movimiento" de Ajustes > Accesibilidad. Se escucha en vivo: si el
// usuario lo activa con la app abierta, el Home lo respeta sin reiniciar.
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v))
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => { alive = false; sub.remove() }
  }, [])
  return reduce
}
