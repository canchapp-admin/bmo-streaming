import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs'
import { colors } from '@/lib/theme'

export default function TabsLayout() {
  return (
    // tintColor: la pestaña activa en blanco, no en el azul de sistema. Sobre el
    // vidrio oscuro el blanco se lee mejor y deja el color para el contenido.
    // minimizeBehavior (iOS 26+): al bajar, la barra de vidrio se encoge y deja
    // el catálogo a pantalla completa; al subir vuelve. Es lo que hacen Apple
    // TV, Música y Safari.
    <NativeTabs tintColor={colors.text}minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <Icon sf="house.fill" />
        <Label>Inicio</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="series">
        <Icon sf="tv" />
        <Label>Series</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="peliculas">
        <Icon sf="film" />
        <Label>Películas</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <Icon sf="magnifyingglass" />
        <Label>Buscar</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <Icon sf="bookmark.fill" />
        <Label>Biblioteca</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
