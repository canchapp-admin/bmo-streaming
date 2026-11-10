import { useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { SymbolView } from 'expo-symbols'
import { Touchable } from './Touchable'
import { Glass } from './Glass'
import { colors } from '@/lib/theme'

export type MenuOption = { key: string; label: string; meta?: string }

// Menú desplegable al estilo iOS (pull-down): un botón de vidrio con texto y
// chevron; al tocarlo, la lista aparece anclada al botón y crece desde él —
// no una hoja que sube desde abajo. Lo usan el selector de temporadas y el de
// géneros de los catálogos.
//
// Va en un Modal transparente solo para dibujar encima de todo y cerrar
// tocando afuera; visualmente es un popover, no una pantalla nueva.
const MENU_W = 250
const ROW_H = 48
const MAX_ROWS = 7.5 // el medio renglón final indica que hay más para desplazar

export function GlassMenu({
  label,
  options,
  selectedKey,
  onSelect,
  align = 'left',
  size = 'regular',
  accessibilityLabel,
}: {
  label: string
  options: MenuOption[]
  selectedKey: string
  onSelect: (key: string) => void
  // Hacia dónde se abre la lista: alineada al borde izquierdo o derecho del botón.
  align?: 'left' | 'right'
  size?: 'regular' | 'compact'
  accessibilityLabel?: string
}) {
  const btnRef = useRef<View>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const anim = useRef(new Animated.Value(0)).current
  const { height: screenH, width: screenW } = useWindowDimensions()
  const single = options.length < 2

  function open() {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h })
      anim.setValue(0)
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 260, mass: 0.7 }).start()
    })
  }

  function close(then?: () => void) {
    Animated.timing(anim, { toValue: 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
      setAnchor(null)
      then?.()
    })
  }

  const listH = Math.min(options.length, MAX_ROWS) * ROW_H
  const below = anchor ? anchor.y + anchor.h + 8 : 0
  // Si no entra debajo (botón al fondo de la pantalla), se abre hacia arriba.
  const openUp = anchor ? below + listH + 40 > screenH : false
  const top = anchor ? (openUp ? anchor.y - 8 - listH : below) : 0
  const left = anchor
    ? Math.min(Math.max(12, align === 'right' ? anchor.x + anchor.w - MENU_W : anchor.x), screenW - MENU_W - 12)
    : 0
  const origin = `${openUp ? 'bottom' : 'top'} ${align}`
  const selectedIdx = options.findIndex((o) => o.key === selectedKey)
  const compact = size === 'compact'

  return (
    <>
      <Touchable
        scaleTo={0.96}
        haptic="selection"
        onPress={single ? undefined : open}
        disabled={single}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <View ref={btnRef} collapsable={false}>
          <Glass radius={compact ? 20 : 22} interactive style={[styles.button, compact && styles.buttonCompact]}>
            <Text style={[styles.buttonText, compact && styles.buttonTextCompact]} numberOfLines={1}>
              {label}
            </Text>
            {!single && (
              <SymbolView name="chevron.down" weight="semibold" tintColor={colors.text} style={styles.chevron} />
            )}
          </Glass>
        </View>
      </Touchable>

      <Modal visible={!!anchor} transparent animationType="none" onRequestClose={() => close()}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Cerrar">
          <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: anim }]} />
        </Pressable>

        {anchor && (
          <Animated.View
            style={[
              styles.menu,
              {
                top,
                left,
                height: listH,
                // Sin `opacity`: Liquid Glass no se dibuja si algún contenedor
                // tiene la opacidad animada (quedaba la lista sin fondo, el
                // texto flotando sobre los pósters). Entra solo creciendo
                // desde el botón, como los menús de iOS.
                transformOrigin: origin,
                transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
              },
            ]}
          >
            {/* Tinte oscuro sobre el vidrio: el menú lleva texto y a veces se
                abre sobre pósters claros; sin tinte no se leía. */}
            <Glass radius={18} tint="rgba(18,18,20,0.55)" style={StyleSheet.absoluteFill}>
              <ScrollView
                bounces={options.length > MAX_ROWS}
                showsVerticalScrollIndicator={false}
                // Abre con la opción elegida a la vista.
                contentOffset={{ x: 0, y: Math.max(0, (selectedIdx - 2) * ROW_H) }}
              >
                {options.map((o, i) => {
                  const active = o.key === selectedKey
                  return (
                    <Pressable
                      key={o.key}
                      onPress={() => close(() => { if (!active) onSelect(o.key) })}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, i > 0 && styles.rowDivider]}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: active }}
                    >
                      <View style={styles.checkSlot}>
                        {active && <SymbolView name="checkmark" weight="semibold" tintColor={colors.text} style={styles.check} />}
                      </View>
                      <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>
                        {o.label}
                      </Text>
                      {!!o.meta && <Text style={styles.rowMeta}>{o.meta}</Text>}
                    </Pressable>
                  )
                })}
              </ScrollView>
            </Glass>
          </Animated.View>
        )}
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
  },
  buttonCompact: { height: 40, paddingHorizontal: 16, gap: 6 },
  buttonText: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  buttonTextCompact: { fontSize: 15, fontWeight: '600' },
  chevron: { width: 13, height: 13 },
  dim: { backgroundColor: 'rgba(0,0,0,0.25)' },
  menu: {
    position: 'absolute',
    width: MENU_W,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', paddingRight: 16 },
  rowPressed: { backgroundColor: colors.fill },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  checkSlot: { width: 38, alignItems: 'center' },
  check: { width: 14, height: 14 },
  rowText: { flex: 1, color: colors.text, fontSize: 16 },
  rowTextActive: { fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 14, marginLeft: 8 },
})
