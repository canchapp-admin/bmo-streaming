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
  Animated,
  Dimensions,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { tmdb, type MediaItem } from '@/lib/tmdb'
import { matchStudio, type StudioBrand } from '@/lib/studios'
import { matchTheme } from '@/lib/themes'
import { mix, withAlpha } from '@/lib/color'
import { useReduceMotion } from '@/lib/useReduceMotion'
import { ThemeBanner } from '@/components/ThemeCards'
import { PosterRow } from '@/components/PosterRow'
import { useRouter } from 'expo-router'
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
  const router = useRouter()
  const reduceMotion = useReduceMotion()

  // Tema (Navidad, Halloween, Terror…): se detecta en vivo sobre el texto, es
  // local e instantáneo. Cambia el ambiente de la pantalla y trae una vista
  // previa de la colección (misma caché que la pantalla del tema).
  const theme = searching ? matchTheme(query, { kids }) : null
  const { data: themeData } = useAsync(
    () => (theme ? tmdb.theme(theme.key) : Promise.resolve(null)),
    [theme?.key],
    theme ? `theme:${theme.key}` : undefined
  )
  const themePreview = theme && themeData?.key === theme.key
    ? forProfile(
        (themeData.rows[0]?.results ?? []).map((x) => ({ ...x, media_type: themeData.rows[0].type }) as MediaItem),
        kids
      )
    : []

  // El ambiente entra con un fundido corto (sin animación con Reduce Motion).
  const ambient = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!theme) { ambient.setValue(0); return }
    if (reduceMotion) { ambient.setValue(1); return }
    ambient.setValue(0)
    Animated.timing(ambient, { toValue: 1, duration: 450, useNativeDriver: true }).start()
  }, [theme?.key, reduceMotion])

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
  const hasExtras = !!brand || !!theme || people.length > 0
  const Header = searching && hasExtras ? (
    <View style={styles.header}>
      {theme && (
        // Ambiente del tema: va DENTRO de la cabecera (y no encima de la
        // lista) para quedar detrás de los resultados; sube por debajo de la
        // barra y se apaga a negro. Dos capas: el baño en los dos colores del
        // tema, en diagonal, y el fundido vertical a negro.
        <Animated.View pointerEvents="none" style={[styles.ambient, { opacity: ambient }]}>
          <LinearGradient
            colors={[withAlpha(theme.colors[0], 0.55), withAlpha(mix(theme.colors[1], 0.8), 0.45)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.7 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', '#000']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
      {theme && <ThemeBanner theme={theme} />}
      {theme && themePreview.length > 0 && (
        <View style={styles.bleed}>
          <PosterRow
            title={themeData!.rows[0].title}
            items={themePreview}
            onPressTitle={() => router.push(`/theme/${theme.key}` as never)}
          />
        </View>
      )}
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
  // Sube 360 pt por debajo de la barra de búsqueda y se extiende a los bordes.
  ambient: { position: 'absolute', top: -360, left: -16, right: -16, height: 820 },
  // La fila trae su propio margen de 20; anula el de 16 de la lista.
  bleed: { marginHorizontal: -16, marginBottom: -28 },
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
