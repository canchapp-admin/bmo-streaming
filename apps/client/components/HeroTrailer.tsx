import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import YoutubePlayer, { PLAYER_STATES } from 'react-native-youtube-iframe'

// Tráiler de fondo del hero, como en la app Apple TV: en silencio, sin
// controles y sin recibir toques (el hero sigue respondiendo como siempre).
//
// No reusa InlineTrailer tal cual porque aquel es un reproductor para mirar
// (botonera, cerrar, progreso, arranca a pedido). Este es ambiente: si algo
// falla —video no embebible, red lenta— simplemente no aparece y queda la
// imagen, sin carteles de error.
//
// Se mantiene invisible hasta que YouTube avisa que está reproduciendo y un
// instante más: así no se ve el póster negro del embed ni el título de YouTube
// que asoma al cargar.
const REVEAL_DELAY_MS = 700

export function HeroTrailer({
  youtubeKey,
  width,
  height,
  onPlaying,
  onEnded,
}: {
  youtubeKey: string
  width: number
  height: number
  onPlaying?: (playing: boolean) => void
  onEnded?: () => void
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const [failed, setFailed] = useState(false)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    clearTimeout(revealTimer.current)
    onPlaying?.(false)
  }, [])

  function fade(to: number) {
    Animated.timing(opacity, { toValue: to, duration: to ? 900 : 400, useNativeDriver: true }).start()
  }

  function onState(state: PLAYER_STATES) {
    if (state === PLAYER_STATES.PLAYING) {
      clearTimeout(revealTimer.current)
      revealTimer.current = setTimeout(() => fade(1), REVEAL_DELAY_MS)
      onPlaying?.(true)
    }
    if (state === PLAYER_STATES.ENDED) {
      fade(0)
      onPlaying?.(false)
      onEnded?.()
    }
  }

  if (failed) return null

  // El hero es más alto que ancho; el video es 16:9. Se dibuja a 16:9 con el
  // alto del hero y centrado, para que cubra sin franjas negras (recorta los
  // costados, igual que la imagen con contentFit="cover").
  const videoW = Math.max(width, (height * 16) / 9)
  const videoH = (videoW * 9) / 16

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.clip, { opacity }]} pointerEvents="none">
      <View
        style={{
          position: 'absolute',
          width: videoW,
          height: videoH,
          left: (width - videoW) / 2,
          top: (height - videoH) / 2,
        }}
      >
        <YoutubePlayer
          videoId={youtubeKey}
          width={videoW}
          height={videoH}
          play
          mute
          onChangeState={onState}
          onError={() => { setFailed(true); onPlaying?.(false) }}
          initialPlayerParams={{ controls: false, rel: false, iv_load_policy: 3, preventFullScreen: true }}
          webViewProps={{
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
            scrollEnabled: false,
          }}
          webViewStyle={styles.web}
        />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', backgroundColor: '#000' },
  web: { backgroundColor: '#000', opacity: 0.99 },
})
