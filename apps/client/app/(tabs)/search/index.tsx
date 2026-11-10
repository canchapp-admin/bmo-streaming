import { Stack } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import type { SearchBarCommands } from 'react-native-screens'
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native'
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { matchStudio, type StudioBrand } from '@/lib/studios'
import { useAsync } from '@/lib/useAsync'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { PosterCard } from '@/components/PosterCard'
import { SearchHome } from '@/components/SearchHome'
import { useAuth } from '@/lib/auth'
import { forProfile } from '@/lib/kidsFilter'
import { addRecentSearch, clearRecentSearches, getRecentSearches } from '@/lib/recentSearches'
import { PersonResultCard } from '@/components/PersonResultCard'
import { StudioBanner } from '@/components/StudioBanner'
import { EmptyState } from '@/components/EmptyState'
import { colors } from '@/lib/theme'

const { width } = Dimensions.get('window')
const RES_W = Math.floor((width - 32 - 24) / 3)

export default function SearchScreen() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaItem[]>([])
  const [people, setPeople] = useState<MediaItem[]>([])
  const [brand, setBrand] = useState<StudioBrand | null>(null)
  const [loading, setLoading] = useState(false)
  const { data: categories } = useAsync(() => tmdb.categories())
  const { data: home } = useAsync(() => tmdb.home())
  const { profile } = useAuth()
  const kids = !!profile?.is_kids
  const searchRef = useRef<SearchBarCommands>(null)

  // Búsquedas recientes del perfil. Se guarda una búsqueda cuando "cuenta":
  // al tocar Buscar en el teclado o al empezar a recorrer los resultados — no
  // cada texto a medio escribir.
  const [recent, setRecent] = useState<string[]>([])
  useFocusEffect(useCallback(() => {
    getRecentSearches(profile?.id).then(setRecent)
  }, [profile?.id]))
  const remember = (q: string) => addRecentSearch(profile?.id, q).then(setRecent)
  function pickRecent(q: string) {
    searchRef.current?.setText(q)
    setQuery(q)
  }

  const searching = query.trim().length >= 2

  // El texto se refleja al instante (lo local no espera a nadie) pero la
  // consulta a la red va sobre el valor demorado: antes salía un request por
  // cada tecla — escribir "breaking bad" eran doce.
  const debouncedQuery = useDebouncedValue(query, 300)

  // Marca reconocida (Disney, HBO...) → banner de catálogo especial. Se calcula
  // sobre el texto en vivo porque es local e instantáneo: no tiene por qué
  // esperar al debounce.
  useEffect(() => {
    setBrand(searching ? matchStudio(query) : null)
  }, [query, searching])

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (q.length < 2) { setResults([]); setPeople([]); setLoading(false); return }

    // Sin esto, una respuesta lenta de una consulta vieja puede llegar DESPUÉS
    // de la nueva y pisar los resultados correctos con los de un texto que el
    // usuario ya terminó de escribir.
    let cancelled = false
    setLoading(true)
    tmdb.search(q)
      .then((data) => {
        if (cancelled) return
        // Títulos (con póster) por un lado; personas (actores, con foto y
        // filmografía conocida) por otro — cada uno se muestra distinto.
        setResults(forProfile(data.results.filter((r) => r.media_type !== 'person' && r.poster_path), kids))
        setPeople(
          data.results
            .filter((r) => r.media_type === 'person' && r.profile_path)
            .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
            .slice(0, 3)
        )
      })
      .catch(() => { if (!cancelled) { setResults([]); setPeople([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [debouncedQuery])

  // Cabecera de resultados: banner de marca + personas encontradas, encima de
  // la cuadrícula de títulos.
  const hasExtras = !!brand || people.length > 0
  const Header = searching && hasExtras ? (
    <View style={styles.header}>
      {brand && <StudioBanner brand={brand} />}
      {people.length > 0 && (
        <View style={styles.peopleSection}>
          <Text style={styles.sectionLabel}>Personas</Text>
          <View style={styles.peopleList}>
            {people.map((p) => <PersonResultCard key={p.id} person={p} />)}
          </View>
        </View>
      )}
      {results.length > 0 && <Text style={styles.sectionLabel}>Títulos</Text>}
    </View>
  ) : null

  return (
    <>
      <Stack.Screen
        options={{
          // Título grande NATIVO de iOS: se ubica pegado a la barra de estado
          // y se achica al centro al hacer scroll. Antes el título era un Text
          // propio debajo de la barra de navegación vacía y quedaba un hueco
          // enorme arriba.
          title: 'Buscar',
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          headerLargeTitleStyle: { color: '#fff' },
          headerTitleStyle: { color: '#fff' },
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerSearchBarOptions: {
            placeholder: 'Películas, series, actores...',
            ref: searchRef as never,
            onChangeText: (e: any) => setQuery(e.nativeEvent.text),
            onSearchButtonPress: (e: any) => remember(e.nativeEvent.text),
            hideWhenScrolling: false,
            autoCapitalize: 'none',
            textColor: '#fff',
            tintColor: '#fff',
            hintTextColor: colors.textMuted,
          },
        }}
      />
      {!searching ? (
        <SearchHome
          recent={recent}
          onPickRecent={pickRecent}
          onClearRecent={() => { clearRecentSearches(profile?.id); setRecent([]) }}
          trending={forProfile(home?.trending.results ?? [], kids)}
          categories={categories ?? []}
          kids={kids}
        />
      ) : (
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={results}
        keyExtractor={(item) => `${item.media_type}-${item.id}`}
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        // Empezar a recorrer los resultados = la búsqueda sirvió: se guarda.
        onScrollBeginDrag={() => remember(query)}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={Header}
        // Ancho fijo en un View propio: PosterCard va dentro de TitleMenu y el
        // ancho no siempre llegaba — la tercera columna quedaba cortada.
        renderItem={({ item }) => (
          <View style={{ width: RES_W }}>
            <PosterCard item={item} width={RES_W} />
          </View>
        )}
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color="#fff" style={styles.spinner} />
            : hasExtras ? null : (
              // Si hay banner de marca o personas, no mostramos "sin resultados"
              // (el usuario sí encontró algo, solo que no títulos).
              <View style={styles.empty}>
                <EmptyState
                  icon="magnifyingglass"
                  title="Sin resultados"
                  subtitle="Prueba con otro título, actor o género."
                />
              </View>
            )
        }
      />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#000' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 },
  col: { gap: 12, marginBottom: 12, justifyContent: 'flex-start' },
  spinner: { marginTop: 80 },
  empty: { marginTop: 80, alignItems: 'center' },
  header: { marginBottom: 12, gap: 20 },
  peopleSection: { gap: 10 },
  peopleList: { gap: 8 },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
})
