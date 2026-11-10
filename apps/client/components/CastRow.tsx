import { View, Text, FlatList, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { type CastMember, profileUrl } from '@/lib/tmdb'
import { Touchable } from './Touchable'
import { rowHeading } from '@/lib/typography'
import { colors } from '@/lib/theme'

export function CastRow({ cast }: { cast: CastMember[] }) {
  const router = useRouter()
  const people = cast.slice(0, 15)
  if (!people.length) return null

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">Reparto</Text>
      <FlatList
        horizontal
        data={people}
        keyExtractor={(c) => String(c.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          // h632 y no el w185 por defecto: el círculo mide 80 pt, que en un
          // iPhone 3x son 240 px reales — w185 se quedaba corto y en una cara
          // la falta de nitidez se nota más que en cualquier otra imagen. TMDB
          // no ofrece nada entre medio (w45 / w185 / h632), y el salto son 49 KB
          // por foto contra 6 KB: por una fila de ~15 caras es asumible.
          const img = profileUrl(item.profile_path, 'h632')
          return (
            <Touchable
              style={styles.person}
              haptic="light"
              onPress={() => router.push(`/person/${item.id}` as never)}
            >
              {img ? (
                <Image source={img} style={styles.photo} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.photo, styles.empty]}>
                  <Text style={styles.initials}>{item.name.charAt(0)}</Text>
                </View>
              )}
              {/* Nombre en hasta dos líneas: en una sola, "Anne Hathaway" quedaba
                  en "Anne Hatha…". Debajo, el personaje en gris. */}
              <Text style={styles.name} numberOfLines={2} maxFontSizeMultiplier={1.4}>{item.name}</Text>
              {!!item.character && (
                <Text style={styles.character} numberOfLines={2} maxFontSizeMultiplier={1.4}>{item.character}</Text>
              )}
            </Touchable>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  heading: {
    ...rowHeading,
    marginBottom: 14,
  },
  list: { gap: 14 },
  person: { width: 92 },
  photo: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textMuted, fontSize: 24, fontWeight: '700' },
  name: { color: '#fff', fontSize: 13, fontWeight: '600', lineHeight: 16, marginTop: 8, textAlign: 'center' },
  character: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 15,
    marginTop: 2,
    textAlign: 'center',
  },
})
