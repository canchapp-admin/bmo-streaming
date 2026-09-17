import { useEffect, useRef } from 'react'

/**
 * `useTVEventHandler` para el widget de Samsung TV (Tizen).
 *
 * react-native-web no tiene el hook: el control remoto del Samsung llega como
 * `keydown` normal del navegador del TV. Traducimos esos códigos a la misma
 * forma de evento que emite react-native-tvos ({ eventType }), así
 * `src/app/player.tsx` no ramifica por plataforma.
 *
 * Los códigos 415/19/412/417/413 son las teclas de transporte del control
 * Samsung (PLAY, PAUSE, REW, FF, STOP); las flechas y Enter/Backspace también
 * los manda el mando, y el teclado sirve para probar en el navegador.
 */
type TVEvent = { eventType: string }

const KEYS: Record<number, string> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'select',
  10009: 'menu', // RETURN del mando Samsung
  8: 'menu', // Backspace (equivalente en teclado)
  415: 'playPause', // MediaPlay
  19: 'playPause', // MediaPause
  10252: 'playPause', // MediaPlayPause
  412: 'rewind',
  417: 'fastForward',
  413: 'stop',
}

export function useTVEventHandler(handler: (evt: TVEvent) => void) {
  // El handler se re-crea en cada render del player; guardarlo en una ref evita
  // desenganchar y volver a enganchar el listener a cada frame del HUD.
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const eventType = KEYS[e.keyCode]
      if (!eventType) return
      // El TV mueve el foco solo (navegación espacial del WebView); si el
      // player consume la tecla, evitamos además el scroll del documento.
      e.preventDefault()
      ref.current({ eventType })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
