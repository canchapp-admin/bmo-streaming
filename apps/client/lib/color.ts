// Utilidades de color para los ambientes (pantallas de marca y de tema).

// Mezcla un color #RRGGBB con negro: `amount` 1 = el color, 0 = negro.
// Devuelve un color OPACO: es lo que permite que el final de un hero y el
// fondo que sigue empalmen sin costura.
export function mix(hex: string, amount: number) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const c = (shift: number) => Math.round(((n >> shift) & 255) * amount)
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`
}

// Mismo color con transparencia: acepta #RRGGBB o rgb(...).
export function withAlpha(color: string, a: number) {
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${a})`)
  const n = parseInt(color.replace('#', '').slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Fundido largo, con varias paradas para que no se vean escalones, desde
// transparente hasta `color` opaco. Para el final de un hero.
export function fadeTo(color: string) {
  return {
    colors: [withAlpha(color, 0), withAlpha(color, 0.35), withAlpha(color, 0.75), withAlpha(color, 0.94), color] as const,
    locations: [0.3, 0.5, 0.7, 0.86, 1] as const,
  }
}
