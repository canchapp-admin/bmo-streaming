/**
 * Eventos de la cruceta. En nativo (Fire TV / Android TV / tvOS) es el hook de
 * react-native-tvos tal cual; la variante `.web.ts` lo reimplementa con teclado
 * para el widget de Samsung TV (Tizen), donde `useTVEventHandler` no existe.
 */
export { useTVEventHandler } from 'react-native'
