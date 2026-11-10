import { useRef } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import * as Haptics from 'expo-haptics'

// Un toque suave al llegar al final de una fila horizontal: confirma que no
// hay más sin tener que mirar el borde. Suena una vez por llegada; se rearma
// cuando la fila se aleja del final.
const REARM_PX = 60

export function useRowEndHaptic() {
  const atEnd = useRef(false)
  return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    if (contentSize.width <= layoutMeasurement.width) return
    const remaining = contentSize.width - (contentOffset.x + layoutMeasurement.width)
    if (remaining <= 1 && !atEnd.current) {
      atEnd.current = true
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {})
    } else if (remaining > REARM_PX) {
      atEnd.current = false
    }
  }
}
