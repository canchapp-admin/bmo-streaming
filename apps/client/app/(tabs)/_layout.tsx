import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { colors } from '@/lib/theme'

export default function TabsLayout() {
  return (
    // tintColor: la pestaña activa en blanco, no en el azul de sistema. Sobre el
    // vidrio oscuro el blanco se lee mejor y deja el color para el contenido.
    // minimizeBehavior (iOS 26+): al bajar, la barra de vidrio se encoge y deja
    // el catálogo a pantalla completa; al subir vuelve. Es lo que hacen Apple
    // TV, Música y Safari.
    <NativeTabs tintColor={colors.text} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="house.fill" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="series">
        <NativeTabs.Trigger.Icon sf="tv" />
        <NativeTabs.Trigger.Label>Series</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="peliculas">
        <NativeTabs.Trigger.Icon sf="film" />
        <NativeTabs.Trigger.Label>Películas</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>Buscar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Icon sf="bookmark.fill" />
        <NativeTabs.Trigger.Label>Biblioteca</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
