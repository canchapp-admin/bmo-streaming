import { useSyncExternalStore } from 'react'
import { getMyList, toggleMyList, type LibraryItem } from '@/lib/library'

// Conjunto de títulos en Mi lista, compartido por todas las tarjetas.
//
// El menú contextual de cada tarjeta muestra "En Mi lista" con check, así que
// necesita saber el estado de cada título. Preguntarle a AsyncStorage desde
// cada tarjeta serían cientos de lecturas al abrir el Home; esto lee la lista
// una vez y avisa a los suscriptores cuando cambia.

const key = (id: number, type: 'movie' | 'tv') => `${type}:${id}`

let ids = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

// Relee la lista guardada. Se llama al enfocar el Home, así los cambios hechos
// desde otra pantalla (la ficha, el hero) se reflejan al volver.
export async function refreshMyList() {
  const list = await getMyList()
  ids = new Set(list.map((i) => key(i.id, i.media_type)))
  emit()
}

export async function toggleInMyList(item: LibraryItem): Promise<boolean> {
  const added = await toggleMyList(item)
  const next = new Set(ids)
  if (added) next.add(key(item.id, item.media_type))
  else next.delete(key(item.id, item.media_type))
  ids = next
  emit()
  return added
}

export function useInMyList(id: number, type: 'movie' | 'tv') {
  return useSyncExternalStore(subscribe, () => ids.has(key(id, type)))
}
