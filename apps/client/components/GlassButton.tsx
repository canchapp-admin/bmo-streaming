import { useRef } from 'react'
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Glass } from './Glass'

// Botón de Liquid Glass de verdad. No usa Touchable porque Touchable baja la
// OPACIDAD al apretar, y el vidrio no se dibuja con opacidad animada (se
// apaga mientras lo tocás). Acá el toque se siente con escala y vibración.
//
// SIN `interactive`: el vidrio interactivo de iOS 26 trae sus propios
// reconocedores de gestos que se quedan con el toque (o lo cancelan) y el
// Pressable nunca recibía el onPress — la X del reproductor no cerraba y los
// botones se sentían trabados. Por lo mismo el vidrio va con
// pointerEvents="none": el toque lo recibe siempre el Pressable.
export function GlassButton({
  radius,
  style,
  variant = 'clear',
  tint,
  haptic = 'light',
  scaleTo = 0.92,
  children,
  onPress,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  radius: number
  style?: StyleProp<ViewStyle>
  variant?: 'regular' | 'clear'
  tint?: string
  haptic?: 'light' | 'medium' | 'selection' | false
  scaleTo?: number
  children?: React.ReactNode
}) {
  const anim = useRef(new Animated.Value(0)).current
  const to = (v: number) =>
    Animated.spring(anim, { toValue: v, speed: 40, bounciness: v ? 0 : 10, useNativeDriver: true }).start()
  return (
    <Pressable
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      onPress={(e) => {
        if (haptic === 'selection') Haptics.selectionAsync().catch(() => {})
        else if (haptic) Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress?.(e)
      }}
      {...rest}
    >
      <Animated.View
        pointerEvents="none"
        style={{ transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }] }}
      >
        <Glass radius={radius} variant={variant} tint={tint} style={style}>
          {children}
        </Glass>
      </Animated.View>
    </Pressable>
  )
}
