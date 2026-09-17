import { Redirect } from 'expo-router'

/**
 * Ruta desconocida → al inicio.
 *
 * En nativo esto casi no se ve (no hay URLs sueltas), pero en el widget de
 * Samsung TV el documento se abre como `file:///…/index.html`, y esa ruta no
 * matchea ninguna pantalla: sin esto el arranque queda en la pantalla
 * "Unmatched Route" de expo-router en vez de entrar a la app.
 */
export default function NotFound() {
  return <Redirect href="/" />
}
