import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { colors } from '@/lib/theme'

// Ojo: GlassView no se dibuja si él o algún contenedor tiene `opacity`
// animada o menor a 1. Para aparecerlo, animar escala o posición, no opacidad.
//
// Se resuelve una vez: no cambia mientras la app corre.
const LIQUID_GLASS = isLiquidGlassAvailable()

// Superficie de Liquid Glass para CONTROLES (teclas, botones flotantes), nunca
// para contenido: es la regla de Apple en las HIG de Materials — el vidrio
// forma la capa funcional que flota sobre el contenido, y usarlo en todo le
// quita el sentido. Por eso este componente se usa con cuentagotas.
//
// En iOS 26+ es el material real del sistema (refracta lo que tiene detrás,
// reacciona al toque con `interactive`, y respeta "Reducir transparencia" y
// "Aumentar contraste" solo). En iOS anteriores cae a un blur oscuro del
// sistema, que es lo más parecido sin el material nuevo.
export function Glass({
  style,
  radius,
  interactive = false,
  tint,
  variant = 'regular',
  children,
}: {
  style?: StyleProp<ViewStyle>
  radius: number
  interactive?: boolean
  tint?: string
  // 'clear' solo sobre fondos ricos (pósters, video): deja ver más la imagen.
  // 'regular' para todo lo demás, sobre todo si lleva texto. Regla de las HIG.
  variant?: 'regular' | 'clear'
  children?: React.ReactNode
}) {
  const shape = { borderRadius: radius, overflow: 'hidden' as const }

  if (LIQUID_GLASS) {
    return (
      <View style={[shape, style]}>
        <GlassView
          style={[StyleSheet.absoluteFill, shape]}
          glassEffectStyle={variant}
          colorScheme="dark"
          isInteractive={interactive}
          tintColor={tint}
        />
        {children}
      </View>
    )
  }

  return (
    <View style={[shape, styles.fallbackEdge, style]}>
      <BlurView style={StyleSheet.absoluteFill} intensity={60} tint="systemThinMaterialDark" />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  // Sin el material nuevo no hay borde de luz: un pelo blanco lo insinúa.
  fallbackEdge: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
})
