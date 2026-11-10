import { useCallback, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, Dimensions,
  Alert, Switch,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { SymbolView } from 'expo-symbols'
import {
  getMyList,
  getContinueWatching,
  removeFromMyList,
  type LibraryItem,
  type Progress,
} from '@/lib/library'
import {
  getDownloads,
  deleteDownload,
  onDownloadsChange,
  isSmartDownloadEnabled,
  setSmartDownload,
  type DownloadItem,
} from '@/lib/download'
import { PosterCard } from '@/components/PosterCard'
import { ContinueRow } from '@/components/ContinueRow'
import { Touchable } from '@/components/Touchable'
import { EmptyState } from '@/components/EmptyState'
import { RowHeading } from '@/components/RowHeading'
import { GlassMenu } from '@/components/GlassMenu'
import { Glass } from '@/components/Glass'
import { Segmented } from '@/components/Segmented'
import { screenTitle, rowHeading } from '@/lib/typography'
import { backdropUrl } from '@/lib/tmdb'
import type { MediaItem } from '@/lib/tmdb'
import { colors } from '@/lib/theme'

const PAD = 20
const GRID_GAP = 12
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - PAD * 2 - GRID_GAP * 2) / 3
)

type ListFilter = 'all' | 'movie' | 'tv'
type ListSort = 'recent' | 'az'

// Biblioteca, ordenada por lo que se usa más a menudo:
//
//  1. Seguir viendo — lo que se retoma hoy: la fila de tarjetas grandes, con
//     tope de 10 y "Ver todo" hacia la lista completa (app/continue.tsx).
//  2. Descargas — lista agrupada de iOS (como Ajustes): cada descarga es una
//     fila y "Descarga automática" es una fila más con su interruptor, en vez
//     de una pastilla suelta en el encabezado que no se entendía.
//  3. Mi lista — grilla real de 3 columnas, con un control segmentado para
//     filtrar Películas / Series y un menú para ordenar. Antes la grilla
//     calculaba 3 columnas pero se dibujaban 2 con un hueco a la derecha.
//
// Encabezados con el mismo componente que el resto de la app (RowHeading),
// y "Mi lista" con minúscula como en el Inicio.
export default function LibraryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [list, setList] = useState<LibraryItem[]>([])
  const [watching, setWatching] = useState<Progress[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [smartEnabled, setSmartEnabled] = useState(true)
  const [editingList, setEditingList] = useState(false)
  const [filter, setFilter] = useState<ListFilter>('all')
  const [sort, setSort] = useState<ListSort>('recent')

  const reload = useCallback(() => {
    getMyList().then(setList)
    getContinueWatching().then(setWatching)
    getDownloads().then(setDownloads)
    isSmartDownloadEnabled().then(setSmartEnabled)
  }, [])

  useFocusEffect(reload)

  // Suscripción en tiempo real a cambios de descargas
  useFocusEffect(useCallback(() => {
    return onDownloadsChange(() => getDownloads().then(setDownloads))
  }, []))

  async function removeFromList(item: LibraryItem) {
    await removeFromMyList(item.id, item.media_type)
    // Se re-lee del almacenamiento en vez de filtrar el estado: si el borrado
    // no llegó a aplicarse, la pantalla lo refleja en el momento.
    const fresh = await getMyList()
    setList(fresh)
    if (fresh.length === 0) setEditingList(false)
  }

  async function handleDeleteDownload(item: DownloadItem) {
    Alert.alert(
      'Eliminar descarga',
      `¿Eliminar "${item.title}"${item.episode ? ` T${item.season}:E${item.episode}` : ''}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            await deleteDownload(item.key)
            getDownloads().then(setDownloads)
          },
        },
      ]
    )
  }

  function playDownload(item: DownloadItem) {
    if (item.status !== 'done') return
    router.push({
      pathname: '/player',
      params: {
        type: item.media_type,
        id: String(item.id),
        title: item.episode
          ? `${item.title} · T${item.season}:E${item.episode}`
          : item.title,
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
        ...(item.media_type === 'tv' ? {
          season: String(item.season),
          episode: String(item.episode),
        } : {}),
        localPath: item.localPath ?? '',
      },
    })
  }

  async function toggleSmart(next: boolean) {
    setSmartEnabled(next)
    await setSmartDownload(next)
  }

  const movies = list.filter((i) => i.media_type === 'movie').length
  const series = list.length - movies
  const shown = list
    .filter((i) => filter === 'all' || i.media_type === filter)
    .slice()
    .sort((a, b) => (sort === 'az' ? a.title.localeCompare(b.title, 'es') : 0))

  const doneBytes = downloads.reduce((n, d) => n + (d.status === 'done' ? d.size ?? 0 : 0), 0)
  const empty = list.length === 0 && watching.length === 0 && downloads.length === 0

  return (
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior="never"
      // La barra de pestañas flota sobre el contenido: sin este colchón, la
      // última fila queda debajo y no se puede tocar.
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Biblioteca</Text>

      {empty ? (
        <View style={styles.emptyBox}>
          <EmptyState
            icon="bookmark"
            title="Tu biblioteca está vacía"
            subtitle="Guarda títulos en Mi lista, sigue viendo algo o descárgalo para verlo aquí."
          />
        </View>
      ) : (
        <>
          {/* Sin envolver en styles.section: ContinueRow ya trae su margen. */}
          <ContinueRow
            items={watching}
            onChange={reload}
            onSeeAll={() => router.push('/continue' as never)}
          />

          {downloads.length > 0 && (
            <View style={styles.section}>
              <RowHeading title="Descargas" />
              <View style={styles.group}>
                {downloads.map((item, i) => (
                  <View key={item.key}>
                    {i > 0 && <View style={styles.separator} />}
                    <DownloadRow
                      item={item}
                      onPlay={() => playDownload(item)}
                      onDelete={() => handleDeleteDownload(item)}
                    />
                  </View>
                ))}
                <View style={[styles.separator, styles.separatorFull]} />
                <View style={styles.settingRow}>
                  <SymbolView name="bolt.fill" tintColor={colors.warning} style={styles.settingIcon} />
                  <View style={styles.flex}>
                    <Text style={styles.settingLabel}>Descarga automática</Text>
                    <Text style={styles.settingHint}>Baja el siguiente episodio de lo que estás viendo.</Text>
                  </View>
                  <Switch value={smartEnabled} onValueChange={toggleSmart} accessibilityLabel="Descarga automática" />
                </View>
              </View>
              {doneBytes > 0 && (
                <Text style={styles.footnote}>{formatBytes(doneBytes)} usados en este iPhone</Text>
              )}
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.listHeader}>
              <Text style={styles.heading}>Mi lista</Text>
              {list.length > 0 && (
                <View style={styles.listActions}>
                  {!editingList && (
                    <GlassMenu
                      size="compact"
                      align="right"
                      label={sort === 'recent' ? 'Recientes' : 'A–Z'}
                      accessibilityLabel="Ordenar Mi lista"
                      options={[
                        { key: 'recent', label: 'Agregadas recientemente' },
                        { key: 'az', label: 'Por nombre (A–Z)' },
                      ]}
                      selectedKey={sort}
                      onSelect={(k) => setSort(k as ListSort)}
                    />
                  )}
                  <Touchable
                    scaleTo={0.94}
                    haptic="light"
                    onPress={() => setEditingList((v) => !v)}
                    accessibilityRole="button"
                  >
                    <Glass
                      radius={20}
                      interactive
                      tint={editingList ? '#fff' : undefined}
                      style={[styles.editBtn, editingList && styles.editBtnOn]}
                    >
                      <Text style={[styles.editText, editingList && styles.editTextOn]}>
                        {editingList ? 'Listo' : 'Editar'}
                      </Text>
                    </Glass>
                  </Touchable>
                </View>
              )}
            </View>

            {list.length === 0 ? (
              <Text style={styles.listEmpty}>
                Tocá + en cualquier título, o mantené apretado un póster, para guardarlo acá.
              </Text>
            ) : (
              <>
                {/* Filtro solo si hay de los dos tipos: con una sola clase de
                    título, el control no tendría nada que separar. */}
                {movies > 0 && series > 0 && (
                  <View style={styles.segmentedWrap}>
                    <Segmented<ListFilter>
                      value={filter}
                      onChange={setFilter}
                      options={[
                        { key: 'all', label: `Todo  ${list.length}` },
                        { key: 'movie', label: `Películas  ${movies}` },
                        { key: 'tv', label: `Series  ${series}` },
                      ]}
                    />
                  </View>
                )}
                <View style={styles.grid}>
                  {shown.map((item) => (
                    // Ancho fijo en un View propio: PosterCard va envuelto en el
                    // menú contextual, y sin este contenedor el flexWrap no
                    // respetaba su ancho y la grilla quedaba en 2 columnas.
                    <View key={`${item.media_type}-${item.id}`} style={{ width: GRID_CARD }}>
                      <PosterCard
                        item={item as MediaItem}
                        width={GRID_CARD}
                        // La X solo en modo edición: permanente ensuciaba cada
                        // póster y se tocaba sin querer al ir a abrir el título.
                        onRemove={editingList ? () => removeFromList(item) : undefined}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>
  )
}

function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} GB`
  return `${Math.max(1, Math.round(n / 1e6))} MB`
}

// ── Fila de descarga ──────────────────────────────────────────────────────────

function DownloadRow({
  item, onPlay, onDelete,
}: {
  item: DownloadItem
  onPlay: () => void
  onDelete: () => void
}) {
  const thumb = backdropUrl(item.backdrop_path ?? item.poster_path, 'w780')
  const isDone = item.status === 'done'
  const isLoading = item.status === 'downloading' || item.status === 'pending'

  const subtitle = item.media_type === 'tv' && item.season
    ? `T${item.season}:E${item.episode}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`
    : item.quality || ''

  // El detalle de segmentos era ruido para el usuario; el porcentaje basta.
  const statusLabel = isLoading
    ? `${Math.round(item.progress * 100)}% descargado`
    : item.status === 'error'
      ? `Error: ${item.error ?? 'desconocido'}`
      : item.quality

  return (
    <Touchable
      scaleTo={0.98}
      haptic="medium"
      style={styles.dlRow}
      onPress={isDone ? onPlay : undefined}
      disabled={!isDone}
    >
      <View style={styles.dlThumbWrap}>
        {thumb ? (
          <Image source={thumb} style={styles.dlThumb} contentFit="cover" />
        ) : (
          <View style={[styles.dlThumb, styles.dlThumbEmpty]} />
        )}
        {isDone && (
          <View style={styles.dlPlayBadge}>
            <SymbolView name="play.fill" tintColor="#fff" style={styles.dlPlayIcon} />
          </View>
        )}
        {isLoading && (
          <View style={styles.dlProgressOverlay}>
            <View style={[styles.dlProgressBar, { width: `${Math.round(item.progress * 100)}%` }]} />
          </View>
        )}
      </View>

      <View style={styles.dlInfo}>
        <Text style={styles.dlTitle} numberOfLines={1}>{item.title}</Text>
        {subtitle ? <Text style={styles.dlSub} numberOfLines={1}>{subtitle}</Text> : null}
        <Text style={[styles.dlStatus, item.status === 'error' && styles.dlError]} numberOfLines={1}>
          {statusLabel}
        </Text>
      </View>

      <Touchable scaleTo={0.85} haptic="light" style={styles.dlDelete} onPress={onDelete} hitSlop={10}>
        <SymbolView name="trash" tintColor="rgba(255,107,107,0.85)" style={styles.dlDeleteIcon} />
      </Touchable>
    </Touchable>
  )
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { paddingBottom: 130 },
  flex: { flex: 1 },
  title: { ...screenTitle, paddingHorizontal: PAD, paddingBottom: 20 },
  emptyBox: { paddingTop: 70, alignItems: 'center' },

  section: { marginBottom: 32 },
  heading: rowHeading,

  // Lista agrupada de iOS: tarjeta con separadores que arrancan después de la
  // miniatura, y la fila de ajuste al final con separador completo.
  group: {
    marginHorizontal: PAD,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: 130 },
  separatorFull: { marginLeft: 0 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  settingIcon: { width: 18, height: 18 },
  settingLabel: { color: colors.text, fontSize: 16, fontWeight: '500' },
  settingHint: { color: colors.textMuted, fontSize: 12.5, marginTop: 2 },
  footnote: { color: colors.textMuted, fontSize: 13, paddingHorizontal: PAD + 14, marginTop: 8 },

  listHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: PAD, marginBottom: 14, minHeight: 40,
  },
  listActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { height: 40, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  editBtnOn: { backgroundColor: '#fff' },
  editText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  editTextOn: { color: '#000' },
  listEmpty: { color: colors.textMuted, fontSize: 15, lineHeight: 21, paddingHorizontal: PAD },
  segmentedWrap: { paddingHorizontal: PAD, marginBottom: 16 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    columnGap: GRID_GAP, rowGap: 18, paddingHorizontal: PAD,
  },

  dlRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 11, gap: 12,
  },
  dlThumbWrap: { position: 'relative' },
  dlThumb: { width: 106, height: 60, borderRadius: 9, backgroundColor: colors.surface },
  dlThumbEmpty: { backgroundColor: colors.surface },
  dlProgressOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 3, backgroundColor: colors.border,
    borderBottomLeftRadius: 9, borderBottomRightRadius: 9, overflow: 'hidden',
  },
  dlProgressBar: { height: '100%', backgroundColor: '#fff' },
  dlPlayBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 9,
  },
  dlPlayIcon: { width: 18, height: 18 },
  dlInfo: { flex: 1, gap: 2 },
  dlTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  dlSub: { color: colors.textDim, fontSize: 13 },
  dlStatus: { color: colors.textMuted, fontSize: 12 },
  dlError: { color: colors.danger },
  dlDelete: { padding: 6 },
  dlDeleteIcon: { width: 17, height: 17 },
})
