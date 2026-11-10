import type { MediaItem } from '@/lib/tmdb'

// Filtro para perfiles infantiles. Las listas de TMDB del Home no traen la
// clasificación por edad (eso solo viene en el detalle de cada título, y pedir
// un detalle por tarjeta serían cientos de llamadas), pero sí los géneros.
// Criterio: tiene que ser animación, familia o infantil, y no puede tener
// ningún género claramente adulto. Es conservador a propósito: preferimos
// que falte una película apta a que se cuele una de terror.
const KIDS = new Set([16, 10751, 10762]) // Animación, Familia, Kids (TV)
const ADULT = new Set([27, 53, 80, 10752, 10768]) // Terror, Suspenso, Crimen, Bélica, Guerra y política

export function isKidsSafe(item: MediaItem) {
  const g = item.genre_ids ?? []
  return g.some((id) => KIDS.has(id)) && !g.some((id) => ADULT.has(id))
}

export function forProfile(items: MediaItem[], kids: boolean) {
  return kids ? items.filter(isKidsSafe) : items
}
