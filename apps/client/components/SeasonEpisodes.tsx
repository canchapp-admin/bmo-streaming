import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter, useFocusEffect } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { tmdb, stillUrl, isReleased, type Season, type Episode } from '@/lib/tmdb'
import { useAsync } from '@/lib/useAsync'
import { getWatchedEpisodes, getEpisodeProgress, toggleEpisodeWatched, setSeasonWatched } from '@/lib/library'
import { prewarmTitle } from '@/lib/stream'
import { DownloadButton } from './DownloadButton'
import { Touchable } from './Touchable'
import { SeasonPicker } from './SeasonPicker'
import { colors } from '@/lib/theme'

export function SeasonEpisodes({
  tvId,
  title,
  seasons,
  poster,
  backdrop,
  nextUp,
}: {
  tvId: string
  title: string
  seasons: Season[]
  poster: string | null
  backdrop: string | null
  // El episodio que retoma el botón grande de la ficha ("Continuar T2:E4").
  // La lista abre en esa temporada y lo destaca.
  nextUp?: { season: number; episode: number; fresh: boolean } | null
}) {
  const real = seasons
    .filter((s) => s.season_number >= 1 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)

  const [selected, setSelected] = useState(nextUp?.season ?? real[0]?.season_number ?? 1)
  // El punto de retomar llega async: si aparece después de montar, se salta a
  // su temporada — salvo que el usuario ya haya elegido otra a mano.
  const userPicked = useRef(false)
  useEffect(() => {
    if (!nextUp || userPicked.current) return
    if (real.some((s) => s.season_number === nextUp.season)) setSelected(nextUp.season)
  }, [nextUp?.season])

  function pick(n: number) {
    userPicked.current = true
    setSelected(n)
  }

  const { data, loading } = useAsync(() => tmdb.season(tvId, selected), [selected])

  // Episodios vistos de esta serie ("season:episode")
  const [watched, setWatched] = useState<Set<string>>(new Set())
  // Y los empezados a medias, para la barra de progreso de cada miniatura.
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  const reloadWatched = useCallback(() => {
    getWatchedEpisodes(tvId).then(setWatched)
    getEpisodeProgress(tvId).then(setProgress)
  }, [tvId])
  useFocusEffect(reloadWatched)

  async function toggle(season: number, episode: number) {
    await toggleEpisodeWatched(tvId, season, episode)
    reloadWatched()
  }

  // Episodios estrenados de la temporada cargada
  const releasedEps = (data?.episodes ?? [])
    .filter((e) => isReleased(e.air_date))
    .map((e) => e.episode_number)
  const allWatched =
    releasedEps.length > 0 &&
    releasedEps.every((e) => watched.has(`${selected}:${e}`))

  async function toggleSeason() {
    await setSeasonWatched(tvId, selected, releasedEps, !allWatched)
    reloadWatched()
  }

  const seasonComplete = (s: Season) => {
    let n = 0
    watched.forEach((k) => { if (k.startsWith(`${s.season_number}:`)) n++ })
    return n > 0 && n >= s.episode_count
  }
  const watchedHere = releasedEps.filter((e) => watched.has(`${selected}:${e}`)).length
  const summary = data
    ? [
        `${data.episodes.length} episodios`,
        watchedHere > 0 ? (allWatched ? 'Todos vistos' : `${watchedHere} vistos`) : null,
      ].filter(Boolean).join('  ·  ')
    : ''

  return (
    <View style={styles.wrap}>
      {/* Selector desplegable a la izquierda; "Marcar vista" a la derecha. */}
      <View style={styles.seasonHeader}>
        <SeasonPicker
          options={real.map((s) => ({ number: s.season_number, episodes: s.episode_count, done: seasonComplete(s) }))}
          selected={selected}
          onSelect={pick}
        />
        {/* Acción en línea y no en un menú: es una sola, y tocándola otra
            vez se deshace, así que no hace falta pedir confirmación. */}
        {releasedEps.length > 0 && (
          <Touchable
            scaleTo={0.94}
            haptic="medium"
            onPress={toggleSeason}
            hitSlop={10}
            style={styles.markAll}
            accessibilityRole="button"
            accessibilityLabel={allWatched ? `Desmarcar la temporada ${selected}` : `Marcar la temporada ${selected} como vista`}
          >
            <SymbolView
              name={allWatched ? 'checkmark.circle.fill' : 'checkmark.circle'}
              tintColor={allWatched ? colors.success : colors.textDim}
              style={styles.markAllIcon}
            />
            <Text style={[styles.markAllText, allWatched && styles.markAllTextOn]}>
              {allWatched ? 'Vista' : 'Marcar vista'}
            </Text>
          </Touchable>
        )}
      </View>

      {!!summary && <Text style={styles.summary}>{summary}</Text>}

      {loading && <ActivityIndicator color="#fff" style={styles.spinner} />}

      {data?.episodes.map((ep) => (
        <EpisodeRow
          key={ep.id}
          tvId={tvId}
          title={title}
          season={selected}
          ep={ep}
          poster={poster}
          backdrop={backdrop}
          watched={watched.has(`${selected}:${ep.episode_number}`)}
          next={
            nextUp && nextUp.season === selected && nextUp.episode === ep.episode_number
              ? (nextUp.fresh ? 'Siguiente' : 'Continuar')
              : null
          }
          progress={progress.get(`${selected}:${ep.episode_number}`) ?? 0}
          onToggleWatched={() => toggle(selected, ep.episode_number)}
        />
      ))}
    </View>
  )
}

function EpisodeRow({
  tvId,
  title,
  season,
  ep,
  poster,
  backdrop,
  watched,
  next,
  progress,
  onToggleWatched,
}: {
  tvId: string
  title: string
  season: number
  ep: Episode
  poster: string | null
  backdrop: string | null
  watched: boolean
  // Es el episodio que retoma "Continuar": se destaca para encontrarlo sin buscar.
  next: 'Siguiente' | 'Continuar' | null
  progress: number // 0–1; 0 = sin empezar
  onToggleWatched: () => void
}) {
  const router = useRouter()
  // Se queda en w300 (el default) a propósito. La miniatura mide 130x74 pt, o
  // sea 390 px en 3x, así que w300 queda algo corto — pero TMDB no tiene nada
  // entre w300 y 'original', y ese salto son 284 KB por imagen contra 10 KB.
  // En una temporada de veinte episodios serían ~5.7 MB y bitmaps enormes al
  // decodificar, para ganar nitidez en un recuadro del tamaño de una estampilla:
  // el "mejor tamaño" acá empeora la app.
  const still = stillUrl(ep.still_path)
  const released = isReleased(ep.air_date)

  function open() {
    router.push({
      pathname: '/player',
      params: {
        type: 'tv',
        id: tvId,
        season: String(season),
        episode: String(ep.episode_number),
        title: `${title} · T${season}:E${ep.episode_number}`,
        poster: poster ?? '',
        backdrop: backdrop ?? '',
      },
    })
  }

  const remaining =
    released && ep.runtime && progress > 0 && !watched
      ? Math.max(1, Math.round(ep.runtime * (1 - progress)))
      : null

  // Miniatura grande + título (2 líneas) y duración, con descarga y visto a
  // la derecha. Sin sinopsis: la lista se recorre por imagen y título.
  return (
    <Touchable
      scaleTo={0.98}
      haptic="light"
      style={[styles.epRow, next && styles.epRowNext, !released && styles.epRowSoon]}
      onPressIn={released ? () => prewarmTitle(Number(tvId), true, season, ep.episode_number) : undefined}
      onPress={released ? open : undefined}
      disabled={!released}
      accessibilityRole="button"
      accessibilityLabel={`Episodio ${ep.episode_number}, ${ep.name}${watched ? ', visto' : ''}`}
    >
      <View style={styles.epTop}>
        <View style={styles.thumbWrap}>
          {still ? (
            <Image source={still} style={[styles.thumb, watched && styles.thumbWatched]} contentFit="cover" transition={150} />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]} />
          )}
          {/* Play centrado y grande: deja claro que tocar reproduce. */}
          <View style={styles.playCenter} pointerEvents="none">
            <View style={styles.playBadge}>
              <SymbolView name={released ? 'play.fill' : 'clock'} tintColor="#fff" style={styles.playBadgeIcon} />
            </View>
          </View>
          {/* Hasta dónde se vio. Solo en los empezados y no terminados: al pasar
              del 92% el episodio se marca como visto. */}
          {progress > 0 && !watched && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          )}
        </View>

        <View style={styles.epInfo}>
          {/* Etiqueta solo en el episodio para retomar; en el resto el número va
              en el título y no hace falta otra línea. */}
          {next && <Text style={[styles.epKicker, styles.nextLabel]}>{next.toUpperCase()}</Text>}
          <Text style={[styles.epTitle, watched && styles.epTitleWatched]} numberOfLines={2}>
            {ep.episode_number}. {ep.name}
          </Text>
          {/* Duración (o fecha, si no salió): saber si son 22 o 58 minutos
              decide si "uno más" entra antes de dormir. */}
          <Text style={styles.epMeta} numberOfLines={1}>
            {!released
              ? soonLabel(ep.air_date)
              : remaining
                ? `Quedan ${remaining} min`
                : ep.runtime
                  ? `${ep.runtime} min`
                  : ''}
          </Text>
        </View>

        {released && (
          <View style={styles.rowActions}>
          <DownloadButton
            id={Number(tvId)}
            media_type="tv"
            title={title}
            poster_path={poster}
            backdrop_path={backdrop}
            season={season}
            episode={ep.episode_number}
            episodeTitle={ep.name}
            size={24}
            tintColor={colors.textDim}
          />
          {/* Visto: solo ícono (check), sin texto. Relleno en verde = visto. */}
          <Touchable
            scaleTo={0.85}
            haptic="selection"
            onPress={onToggleWatched}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={watched ? 'Desmarcar como visto' : 'Marcar como visto'}
          >
            <SymbolView
              name={watched ? 'checkmark.circle.fill' : 'checkmark.circle'}
              tintColor={watched ? colors.success : colors.textMuted}
              style={styles.watchedIcon}
            />
          </Touchable>
          </View>
        )}
      </View>


    </Touchable>
  )
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// "Disponible el 12 mar" en vez de un "Próximamente" sin fecha.
function soonLabel(date: string | null) {
  if (!date) return 'Próximamente'
  const [, m, d] = date.split('-').map(Number)
  if (!m || !d) return 'Próximamente'
  return `Disponible el ${d} ${MONTHS[m - 1]}`
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  // La tira va de borde a borde de la pantalla: una pastilla que se corta
  // contra el borde se lee como "hay más, deslizá" (como en Apple TV).
  seasonHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summary: { color: colors.textMuted, fontSize: 13, fontWeight: '500', marginTop: 10, marginBottom: 14 },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  markAllIcon: { width: 16, height: 16 },
  markAllText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  markAllTextOn: { color: colors.success },
  spinner: { marginVertical: 30 },
  epRow: { padding: 10, marginHorizontal: -10, marginBottom: 4, borderRadius: 18, borderCurve: 'continuous' },
  // El episodio para retomar va sobre una superficie: se encuentra de un vistazo.
  epRowNext: { backgroundColor: colors.surface },
  epRowSoon: { opacity: 0.5 },
  epTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 156, height: 88, borderRadius: 12, backgroundColor: colors.surface },
  thumbWatched: { opacity: 0.55 },
  thumbEmpty: { backgroundColor: colors.surface },
  playCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadgeIcon: { width: 13, height: 13, marginLeft: 2 },
  progressTrack: {
    position: 'absolute', left: 8, right: 8, bottom: 7, height: 3, borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff' },
  epInfo: { flex: 1, justifyContent: 'center', gap: 3 },
  epKicker: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  // Sin color de acento: lo destaca el fondo de la fila, no la etiqueta.
  nextLabel: { color: colors.textDim },
  epTitle: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 20 },
  epTitleWatched: { color: colors.textDim },
  epMeta: { color: colors.textDim, fontSize: 13, fontWeight: '500' },
  // En columna y no en fila: con la miniatura grande, dos íconos lado a lado
  // le dejaban al título menos de 100 pt en un iPhone de 390.
  rowActions: { alignItems: 'center', gap: 16 },
  watchedIcon: { width: 24, height: 24 },
})
