import AsyncStorage from '@react-native-async-storage/async-storage'

// Búsquedas recientes, por perfil (lo que busca un chico no tiene por qué
// aparecerle a otro). Las últimas 8, sin repetir, la más nueva primero.
const MAX = 8
const key = (profileId?: string | null) => `bmo:recent-searches:${profileId ?? 'default'}`

export async function getRecentSearches(profileId?: string | null): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key(profileId))
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export async function addRecentSearch(profileId: string | null | undefined, q: string) {
  const term = q.trim()
  if (term.length < 2) return getRecentSearches(profileId)
  const prev = await getRecentSearches(profileId)
  const next = [term, ...prev.filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, MAX)
  await AsyncStorage.setItem(key(profileId), JSON.stringify(next)).catch(() => {})
  return next
}

export async function clearRecentSearches(profileId?: string | null) {
  await AsyncStorage.removeItem(key(profileId)).catch(() => {})
}
