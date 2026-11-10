import { Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { backdropUrl, posterUrl, yearOf, type MediaItem } from '@/lib/tmdb'
import { toLibraryItem, type LibraryItem } from '@/lib/library'
import { toggleInMyList, useInMyList } from '@/lib/myListStore'
import { colors } from '@/lib/theme'

export type TitleMenuItem = LibraryItem & {
  overview?: string
  year?: string
}

export type TitleMenuAction = {
  title: string
  icon: React.ComponentProps<typeof Link.MenuAction>['icon']
  onPress: () => void
  destructive?: boolean
}

// Menú contextual nativo de iOS para cualquier tarjeta de título: al mantener
// apretado aparece la vista previa del título (imagen, nombre, sinopsis) con
// el menú del sistema debajo — el mismo gesto que en Fotos, Música o Apple TV.
// Tocar la vista previa abre la ficha.
//
// La tarjeta va como hijo y ya NO navega sola: el toque normal lo resuelve el
// Link (abre la ficha), así el gesto corto y el largo llevan al mismo lugar.
// `onPressIn` de la tarjeta (precalentar el stream) sigue funcionando.
//
// `primary` reemplaza el destino del toque corto (Seguir viendo reanuda en vez
// de abrir la ficha) y `extra` agrega acciones propias de esa fila.
export function TitleMenu({
  item,
  children,
  extra,
  onPress,
}: {
  item: TitleMenuItem
  children: React.ReactElement
  extra?: TitleMenuAction[]
  // Toque corto propio (p. ej. reanudar). Sin esto, el toque abre la ficha.
  onPress?: () => void
}) {
  const router = useRouter()
  const inList = useInMyList(item.id, item.media_type)
  const isTv = item.media_type === 'tv'
  const href = `/title/${item.media_type}/${item.id}` as const

  function play() {
    router.push({
      pathname: '/player',
      params: {
        type: 'movie',
        id: String(item.id),
        title: item.title,
        poster: item.poster_path ?? '',
        backdrop: item.backdrop_path ?? '',
      },
    })
  }

  async function toggleList() {
    const added = await toggleInMyList({
      id: item.id,
      media_type: item.media_type,
      title: item.title,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
    })
    Haptics.notificationAsync(
      added ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {})
  }

  function share() {
    const year = item.year ? ` (${item.year})` : ''
    Share.share({
      message: `${item.title}${year}\nhttps://www.themoviedb.org/${item.media_type}/${item.id}`,
    }).catch(() => {})
  }

  // Lista plana: Link.Menu solo acepta MenuAction directos, no arrays anidados.
  const actions = [
    // Series: no hay un "reproducir" obvio (¿qué episodio?), así que la acción
    // principal lleva a los episodios.
    isTv ? (
      <Link.MenuAction key="main" title="Ver episodios" icon="list.bullet.rectangle" onPress={() => router.push(href as never)} />
    ) : (
      <Link.MenuAction key="main" title="Reproducir" icon="play.fill" onPress={play} />
    ),
    <Link.MenuAction
      key="list"
      title={inList ? 'En Mi lista' : 'Agregar a Mi lista'}
      icon={inList ? 'checkmark' : 'plus'}
      isOn={inList}
      onPress={toggleList}
    />,
    <Link.MenuAction key="share" title="Compartir" icon="square.and.arrow.up" onPress={share} />,
    ...(extra ?? []).map((a) => (
      <Link.MenuAction
        key={a.title}
        title={a.title}
        icon={a.icon}
        destructive={a.destructive}
        onPress={a.onPress}
      />
    )),
  ]

  return (
    <Link
      href={href as never}
      asChild
      // preventDefault frena la navegación del Link: el toque hace lo que pidió
      // la tarjeta y la vista previa sigue abriendo la ficha.
      onPress={(e) => {
        if (onPress) { e.preventDefault(); onPress() }
      }}
      // Sin un onLongPress, Pressable dispara onPress al soltar aunque el dedo
      // haya estado apretado un rato: el menú se abría y, al soltar, el Link
      // navegaba a la ficha por detrás. Con este handler vacío el toque largo
      // queda "consumido" y solo lo maneja el menú nativo.
      onLongPress={() => {}}
    >
      {/* Zoom nativo de iOS 18 (como Apple TV / Fotos): la tarjeta crece hasta
          ser el hero de la ficha (Link.AppleZoomTarget allá) y vuelve a su
          lugar al salir, también con el gesto. Lo anima el sistema, no JS.
          Solo cuando el toque navega a la ficha. En iOS < 18, push normal. */}
      <Link.Trigger withAppleZoom={!onPress}>{children}</Link.Trigger>
      <Link.Preview style={previewSize()}>
        <TitlePreview item={item} />
      </Link.Preview>
      <Link.Menu>{actions}</Link.Menu>
    </Link>
  )
}

// Adaptador para las tarjetas que reciben un MediaItem de TMDB.
export function menuItemFrom(item: MediaItem): TitleMenuItem {
  return { ...toLibraryItem(item), overview: item.overview, year: yearOf(item) || undefined }
}

// Vista previa vertical, con el póster 2:3 a todo el alto (como las fichas de
// la app Apple TV): el póster es el arte pensado para el título, la imagen
// horizontal suele ser una escena cualquiera. Nombre, datos y sinopsis van
// encima del póster, sobre un degradado. iOS puede ajustar el tamaño.
const PREVIEW_W = 300
function previewSize() {
  return { width: PREVIEW_W, height: PREVIEW_W * 1.5 }
}

function TitlePreview({ item }: { item: TitleMenuItem }) {
  const { width } = useWindowDimensions()
  const w = Math.min(PREVIEW_W, width - 48)
  // Póster primero; si no hay, la horizontal (recortada) antes que nada.
  const img = posterUrl(item.poster_path, 'w500') ?? backdropUrl(item.backdrop_path, 'w780')
  const meta = [item.media_type === 'tv' ? 'Serie' : 'Película', item.year].filter(Boolean).join('  ·  ')

  return (
    <View style={[styles.preview, { width: w, height: w * 1.5 }]}>
      {img && <Image source={img} style={StyleSheet.absoluteFill} contentFit="cover" />}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
        locations={[0.35, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.previewBody}>
        <Text style={styles.previewTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.previewMeta}>{meta}</Text>
        {!!item.overview && (
          <Text style={styles.previewOverview} numberOfLines={4}>{item.overview}</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  preview: { backgroundColor: colors.surface, justifyContent: 'flex-end' },
  previewBody: { paddingHorizontal: 18, paddingBottom: 18, gap: 6 },
  previewTitle: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  previewMeta: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  previewOverview: { color: colors.text, fontSize: 14, lineHeight: 19, opacity: 0.9, marginTop: 2 },
})
