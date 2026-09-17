import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import type { ReactVideoVLCProps } from './types/video'
import type { VideoVLCRef } from './types/video-ref'
import type { ReactVideoVLCSource } from './types/video'

/**
 * Motor VLC en web (Tizen / Samsung TV).
 *
 * libVLC no existe fuera de iOS/Android, así que en web caemos al <video> del
 * sistema. En Tizen ese elemento va contra el decodificador del TV, que sí saca
 * HLS/MP4/H264 y, según el modelo, HEVC — lo que no soporte va a disparar
 * `onError` y el player de arriba pasa a la siguiente fuente, igual que en
 * nativo. Mantiene la misma API (props + ref) que VideoVLC.tsx para que
 * `src/app/player.tsx` no tenga que ramificar por plataforma.
 *
 * Sin equivalente en web: cabeceras por request (Referer), selección de pistas
 * de audio/subtítulo embebidas y `textTrackDelay`. Los subtítulos españoles del
 * .srt los dibuja el propio player como overlay, así que eso no se pierde.
 */
const VideoVLC = forwardRef<VideoVLCRef, ReactVideoVLCProps>(function VideoVLC(
  {
    initialSource,
    repeat,
    resizeMode = 'none',
    paused = false,
    muted = false,
    volume = 100,
    progressUpdateInterval = 250,
    onLoad,
    onLoadStart,
    onProgress,
    onBuffer,
    onError,
    onEnd,
    onPlaybackStateChanged,
    style,
    ...viewProps
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [source, setSource] = useState<ReactVideoVLCSource | undefined>(initialSource)
  // `startPosition` se aplica una sola vez por fuente, cuando hay metadata.
  const pendingSeek = useRef<number>(
    typeof initialSource?.startPosition === 'number' ? initialSource.startPosition : 0,
  )

  useImperativeHandle(
    ref,
    () => ({
      seek: (time: number) => {
        const el = videoRef.current
        if (el) el.currentTime = time
      },
      setSource: (next) => {
        pendingSeek.current =
          typeof next?.startPosition === 'number' ? next.startPosition : 0
        setSource(next)
      },
    }),
    [],
  )

  const uri = typeof source?.uri === 'string' ? source.uri : undefined

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (paused) el.pause()
    else void el.play().catch(() => { /* autoplay bloqueado: el usuario reintenta */ })
  }, [paused, uri])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = muted
    el.volume = Math.min(1, Math.max(0, volume / 100))
  }, [muted, volume])

  // Progreso a intervalo fijo: `timeupdate` del navegador dispara ~4 veces por
  // segundo, más de lo que el HUD necesita y con re-render de más.
  useEffect(() => {
    if (!onProgress) return
    const id = setInterval(() => {
      const el = videoRef.current
      if (!el || !Number.isFinite(el.duration)) return
      onProgress({
        currentTime: el.currentTime,
        seekableDuration: el.duration,
        progress: el.duration > 0 ? el.currentTime / el.duration : 0,
      })
    }, progressUpdateInterval)
    return () => clearInterval(id)
  }, [onProgress, progressUpdateInterval])

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (pendingSeek.current > 0) {
      el.currentTime = pendingSeek.current
      pendingSeek.current = 0
    }
    const width = el.videoWidth
    const height = el.videoHeight
    onLoad?.({
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      naturalSize: {
        width,
        height,
        orientation:
          width === height ? 'square' : width > height ? 'landscape' : 'portrait',
      },
      // El <video> del navegador no expone las pistas embebidas de forma
      // portable; el player degrada a "sin pistas" y usa el .srt externo.
      videoTracks: [],
      audioTracks: [],
      textTracks: [],
    })
  }, [onLoad])

  const handleError = useCallback(() => {
    const code = videoRef.current?.error?.code ?? 0
    onError?.({
      error: {
        errorString: videoRef.current?.error?.message || `HTMLMediaError ${code}`,
        errorCode: code,
      },
    })
  }, [onError])

  return (
    <View style={style} {...viewProps}>
      {/* react-native-web deja pasar elementos DOM nativos en el árbol */}
      <video
        ref={videoRef}
        src={uri}
        loop={repeat}
        autoPlay={!paused}
        playsInline
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          objectFit: resizeMode === 'cover' ? 'cover' : 'contain',
        }}
        onLoadStart={() => onLoadStart?.()}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => onBuffer?.({ isBuffering: true })}
        onPlaying={() => {
          onBuffer?.({ isBuffering: false })
          onPlaybackStateChanged?.({ isPlaying: true, isSeeking: false })
        }}
        onPause={() => onPlaybackStateChanged?.({ isPlaying: false, isSeeking: false })}
        onSeeking={() => onPlaybackStateChanged?.({ isPlaying: !paused, isSeeking: true })}
        onEnded={() => onEnd?.()}
        onError={handleError}
      />
    </View>
  )
})

export default VideoVLC
