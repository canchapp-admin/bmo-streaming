import { View, Text, StyleSheet, Alert } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { SymbolView } from 'expo-symbols'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { backdropUrl, posterUrl, tmdb } from '@/lib/tmdb'
import { removeProgress, type Progress } from '@/lib/library'
import { prewarmTitle } from '@/lib/stream'
import { Touchable } from './Touchable'
import { TitleMenu } from './TitleMenu'
import { colors } from '@/lib/theme'

const CARD_WIDTH = 300

function remainingLabel(p: Progress, episodeName?: string | null) {
  const isTv = p.media_type === 'tv' && p.season
  // "Próximo a ver" (encolado al terminar el anterior): duration 0. Se dice
  // "Siguiente" y el nombre del episodio, no "Empezar": así se entiende que
  // es lo que sigue y no algo que dejaste sin arrancar.
  if (p.duration <= 0) {
    if (!isTv) return 'Empezar'
    const ep = `T${p.season}, E${p.episode}`
    return episodeName ? `Siguiente · ${ep} · ${episodeName}` : `Siguiente · ${ep}`
  }
  const rem = Math.max(0, p.duration - p.position)
  const mins = Math.round(rem / 60)
  const time = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`
  if (isTv) {
    return `T${p.season}, E${p.episode} · ${time}`
  }
  return time
}

export function ContinueCard({
  item,
  onRemove,
}: {
  item: Progress
  onRemove?: () => void
}) {
  const router = useRouter()
  // Tarjeta de 300pt → ~900px en 3x: w1280 la deja nítida (w780 quedaba blando).
  const img = backdropUrl(item.backdrop_path, 'w1280') ?? posterUrl(item.poster_path, 'w500')
  const ratio = item.duration > 0 ? item.position / item.duration : 0
  const upNext = item.media_type === 'tv' && item.duration <= 0 && item.season != null

  // Nombre del episodio que sigue: solo para las tarjetas "Siguiente" (pocas),
  // así no se pide la temporada de cada serie de la fila.
  const [episodeName, setEpisodeName] = useState<string | null>(null)
  useEffect(() => {
    if (!upNext) return
    let alive = true
    tmdb.season(String(item.id), item.season!)
      .then((s) => {
        const ep = s.episodes.find((e) => e.episode_number === item.episode)
        if (alive && ep?.name) setEpisodeName(ep.name)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [upNext, item.id, item.season, item.episode])
  const label = remainingLabel(item, episodeName)

  function resume() {
    router.push({
      pathname: '/player',
      params: {
        type: item.media_type,
        id: String(item.id),
        title: item.title,
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
        ...(item.media_type === 'tv'
          ? { season: String(item.season ?? 1), episode: String(item.episode ?? 1) }
          : {}),
      },
    })
  }

  async function removeFromContinue() {
    await removeProgress(item.id, item.media_type)
    onRemove?.()
  }

  function more() {
    Alert.alert(item.title, undefined, [
      {
        text: 'Quitar de Seguir viendo',
        style: 'destructive',
        onPress: removeFromContinue,
      },
      { text: 'Cancelar', style: 'cancel' },
    ])
  }

  // Toque corto: reanuda (no abre la ficha). Mantener apretado: vista previa
  // con el menú del sistema, que suma ir a la ficha y quitar de esta fila.
  return (
    <TitleMenu
      item={item}
      onPress={resume}
      extra={[
        { title: 'Ver detalles', icon: 'info.circle', onPress: () => router.push(`/title/${item.media_type}/${item.id}` as never) },
        { title: 'Quitar de Seguir viendo', icon: 'xmark.circle', destructive: true, onPress: removeFromContinue },
      ]}
    >
    <Touchable
      style={styles.card}
      haptic="light"
      onPressIn={() => prewarmTitle(item.id, item.media_type === 'tv', item.season, item.episode)}
      accessibilityRole="button"
      accessibilityLabel={`${upNext ? 'Ver' : 'Reanudar'} ${item.title}. ${label}`}
      accessibilityHint="Mantén presionado para más opciones"
    >
      {img ? (
        <Image source={img} style={styles.thumb} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={`${item.media_type}-${item.id}`} />
      ) : (
        <View style={[styles.thumb, styles.empty]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)']}
        style={styles.overlay}
      />

      <View style={styles.bottom}>
        <View style={styles.left}>
          <SymbolView name="play.fill" tintColor="#fff" style={styles.playIcon} />
          {/* Sin barra en "Siguiente": una barra vacía no informa nada. */}
          {!upNext && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
          )}
          <Text style={[styles.time, upNext && styles.timeNext]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Touchable scaleTo={0.85} haptic="light" onPress={more} hitSlop={12}>
          <SymbolView name="ellipsis" tintColor="#fff" style={styles.more} />
        </Touchable>
      </View>
    </Touchable>
    </TitleMenu>
  )
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 0.58,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
    backgroundColor: colors.surface,
  },
  thumb: { ...StyleSheet.absoluteFillObject },
  empty: { backgroundColor: colors.surface },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  bottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  playIcon: { width: 13, height: 13 },
  track: {
    width: 54,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  fill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  time: { color: '#fff', fontSize: 13, fontWeight: '600' },
  // Sin barra, el texto ocupa el ancho y se recorta con … si el nombre es largo.
  timeNext: { flex: 1 },
  more: { width: 20, height: 20 },
})
