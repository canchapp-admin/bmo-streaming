// Temas del buscador: palabras como "navidad", "halloween" o "terror" no
// buscan un título, buscan un ESTADO DE ÁNIMO. Cuando el texto coincide con un
// tema, el buscador cambia de ambiente (su color) y ofrece la colección del
// tema, armada en la API con las palabras clave de TMDB (no con el texto del
// título: "navidad" por título no trae "Mi pobre angelito" ni "El Grinch").
//
// Las `key` deben coincidir con THEMES del servidor (apps/api/src/tmdb/tmdb.routes.ts).

export type SearchTheme = {
  key: string
  name: string // corto, para el banner y el menú: "Navidad"
  tagline: string // una línea que vende el especial
  // Alias SIN tildes y en minúscula (la búsqueda se normaliza igual).
  aliases: string[]
  // [principal, secundario]: el principal tiñe el ambiente; el secundario le
  // da el segundo tono (rojo + verde en Navidad, naranja + violeta en Halloween).
  colors: [string, string]
  symbol: string // SF Symbol del banner
  // Imagen fija del tema (backdrop de TMDB sin texto, de un título icónico):
  // las tarjetas se reconocen por la imagen antes que por el color.
  art: string
  // Opcionales, para temas que son una FRANQUICIA con identidad propia
  // (RuPaul's Drag Race): su logo real reemplaza al nombre escrito, y el hero
  // usa una imagen elegida a mano en vez del primer título.
  logo?: string
  heroArt?: string
  // Se muestra como franquicia ("Franquicia", en la fila de Franquicias) y no
  // en la fila de Especiales.
  franchise?: boolean
  // Temas que no se ofrecen a perfiles infantiles (igual, todo resultado pasa
  // por el filtro infantil). No es un juicio sobre el tema: es contenido para
  // otras edades (terror, o realities TV-14 como Drag Race).
  adult?: boolean
  // Mes(es) en que el tema está "de temporada" (1–12): sube al principio de
  // la fila de Especiales en esas fechas.
  season?: number[]
}

export const SEARCH_THEMES: SearchTheme[] = [
  {
    key: 'rupaul',
    name: "RuPaul's Drag Race",
    tagline: 'Start your engines… ¡y que gane la mejor!',
    aliases: [
      'rupaul', 'ru paul', 'rupauls', 'rupaul s drag race', 'rupauls drag race', 'rupaul drag race',
      'drag race', 'dragrace', 'drag queen', 'drag queens', 'reinas del drag', 'carrera de drags',
      'sashay away', 'untucked', 'drag race mexico',
    ],
    colors: ['#FF2E93', '#8A2BE2'],
    symbol: 'crown.fill',
    art: '/hEtBwhqAzHKihQ1H9QD2kj8bJ5.jpg', // RuPaul con casco, bandera a cuadros
    heroArt: '/jNV9cnBRukyzUdBb1kw1UXY2l9R.jpg', // RuPaul de lentejuelas entre rayos rosas
    logo: '/9sSyE71HAlNLwaReiLIey6L7tYc.png', // logo dorado/rosa cromado
    franchise: true,
    adult: true,
  },
  {
    key: 'navidad',
    name: 'Navidad',
    tagline: 'Clásicos navideños, comedias y para ver en familia',
    aliases: ['navidad', 'navidena', 'navidenas', 'navideno', 'navidenos', 'christmas', 'xmas', 'santa claus', 'papa noel', 'nochebuena', 'noche buena', 'el grinch'],
    colors: ['#D4202C', '#1E7A46'],
    symbol: 'snowflake',
    art: '/ih2xVgeMS8R5WUetYE8Mr9hVTlB.jpg', // Mi pobre angelito
    season: [11, 12],
  },
  {
    key: 'halloween',
    name: 'Halloween',
    tagline: 'Brujas, vampiros y noches de dulce o truco',
    aliases: ['halloween', 'noche de brujas', 'brujas', 'bruja', 'dulce o truco', 'calabaza', 'vampiros', 'vampiro'],
    colors: ['#FF7A1A', '#6B2FA3'],
    symbol: 'moon.stars.fill',
    art: '/ncr6KR7bBF8cps6yZKiTAwClpn1.jpg', // Abracadabra
    season: [10],
  },
  {
    key: 'diademuertos',
    name: 'Día de Muertos',
    tagline: 'Ofrendas, cempasúchil y cine hecho en México',
    aliases: ['dia de muertos', 'dia de los muertos', 'day of the dead', 'catrina', 'ofrenda', 'cempasuchil', 'muertos'],
    colors: ['#FF9F1C', '#C2185B'],
    symbol: 'flame.fill',
    art: '/g7CHF8gTLGooTbP4GznIGwaqAGL.jpg', // Coco
    season: [10, 11],
  },
  {
    key: 'terror',
    name: 'Terror',
    tagline: 'Para ver con la luz prendida',
    aliases: ['terror', 'horror', 'miedo', 'de miedo', 'peliculas de miedo', 'peliculas de terror', 'susto', 'sustos', 'scary', 'fantasmas', 'fantasma', 'casa embrujada'],
    colors: ['#B3060F', '#2A0005'],
    symbol: 'eye.fill',
    art: '/ecKQlAEG95k62SMGhvX83oEqANK.jpg', // El conjuro
    adult: true,
    season: [10],
  },
  {
    key: 'sanvalentin',
    name: 'San Valentín',
    tagline: 'Romances para ver en pareja (o para llorar solo)',
    aliases: ['san valentin', 'valentin', 'dia del amor', '14 de febrero', 'romance', 'romanticas', 'romantica', 'romanticos', 'amor', 'enamorados', 'comedias romanticas', 'comedia romantica'],
    colors: ['#F0457E', '#8E1F4F'],
    symbol: 'heart.fill',
    art: '/nlPCdZlHtRNcF6C9hzUH4ebmV1w.jpg', // La La Land
    season: [2],
  },
  {
    key: 'zombies',
    name: 'Zombies',
    tagline: 'El apocalipsis, en todas sus versiones',
    aliases: ['zombie', 'zombies', 'zombi', 'zombis', 'muertos vivientes', 'apocalipsis zombie', 'walking dead'],
    colors: ['#7FA33A', '#24310F'],
    symbol: 'figure.walk',
    art: '/rAOjnEFTuNysY7bot8zonhImGMh.jpg', // The Walking Dead
    adult: true,
  },
  {
    key: 'superheroes',
    name: 'Superhéroes',
    tagline: 'Capas, poderes y universos enteros',
    aliases: ['superheroe', 'superheroes', 'super heroe', 'super heroes', 'superpoderes'],
    colors: ['#2463EB', '#D4202C'],
    symbol: 'bolt.fill',
    art: '/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg', // Avengers: Endgame
  },
  {
    key: 'anime',
    name: 'Anime',
    tagline: 'Lo más visto de Japón, en series y películas',
    aliases: ['anime', 'animes', 'manga', 'animacion japonesa', 'otaku'],
    colors: ['#FF4F8B', '#5B3CC4'],
    symbol: 'wand.and.stars',
    art: '/m4TUa2ciEWSlk37rOsjiSIvZDXE.jpg', // El viaje de Chihiro
  },
  {
    key: 'dinosaurios',
    name: 'Dinosaurios',
    tagline: 'Del Jurásico a tu pantalla',
    aliases: ['dinosaurio', 'dinosaurios', 'dino', 'dinos', 'jurasico', 'jurassic', 't rex', 'trex'],
    colors: ['#5FA032', '#7A4A1E'],
    symbol: 'lizard.fill',
    art: '/f082quUW2kAtZXFZVGEfhwacZoG.jpg', // Jurassic Park
  },
  {
    key: 'espacio',
    name: 'El espacio',
    tagline: 'Astronautas, planetas y lo que hay allá afuera',
    aliases: ['espacio', 'el espacio', 'espacial', 'astronauta', 'astronautas', 'galaxia', 'planetas', 'aliens', 'extraterrestres', 'space'],
    colors: ['#4257E8', '#0B1140'],
    symbol: 'sparkles',
    art: '/8sNiAPPYU14PUepFNeSNGUTiHW.jpg', // Interstellar
  },
]

// Minúsculas, sin tildes ni signos, espacios simples: "¡Navideñas!" → "navidenas".
export function normalizeQuery(q: string) {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Coincide si el texto CONTIENE un alias como palabra(s) completa(s)
// ("pelis de navidad" → Navidad) o, mientras se escribe, si el texto es el
// comienzo de un alias, con 5+ letras ("navid" → Navidad; con 4, "anim" ya pintaba Anime mientras se escribía "animales"). Entre varios gana el
// alias más largo: "muertos vivientes" es Zombies, no Día de Muertos.
export function matchTheme(query: string, opts: { kids?: boolean } = {}): SearchTheme | null {
  const q = normalizeQuery(query)
  if (q.length < 3) return null
  let best: { theme: SearchTheme; len: number } | null = null
  for (const theme of SEARCH_THEMES) {
    for (const alias of theme.aliases) {
      const contains = ` ${q} `.includes(` ${alias} `)
      const typing = q.length >= 5 && alias.startsWith(q)
      if ((contains || typing) && (!best || alias.length > best.len)) {
        best = { theme, len: alias.length }
      }
    }
  }
  // El filtro infantil va DESPUÉS de elegir: si gana un tema adulto, no hay
  // tema (y no "el siguiente que coincida": "muertos vivientes" no es Día de
  // Muertos).
  if (!best || (opts.kids && best.theme.adult)) return null
  return best.theme
}

// Temas ordenados para la fila "Especiales": primero los de temporada.
export function themesForNow(kids = false, now = new Date()): SearchTheme[] {
  const month = now.getMonth() + 1
  const list = SEARCH_THEMES.filter((t) => !t.franchise && !(kids && t.adult))
  const inSeason = (t: SearchTheme) => !!t.season?.includes(month)
  return [...list.filter(inSeason), ...list.filter((t) => !inSeason(t))]
}

export function isInSeason(theme: SearchTheme, now = new Date()) {
  return !!theme.season?.includes(now.getMonth() + 1)
}
