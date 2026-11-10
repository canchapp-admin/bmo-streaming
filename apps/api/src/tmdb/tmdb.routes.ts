import { Elysia, t } from 'elysia'
import { tmdbService } from './tmdb.service'
import { TTLCache } from '../resolver/cache'

const CATALOG_TTL = 30 * 60_000   // 30 min
const cache = new TTLCache<unknown>(CATALOG_TTL)

// Marcas/estudios reconocidos en el buscador. Cada marca puede traer catálogo
// DUAL (pelis + series):
//   · `providerId`  = plataforma de streaming (watch provider) → aporta pelis Y
//                     series de lo disponible en la plataforma (mezcla MX + US).
//   · `movieCompanies` / `tvCompanies` = productora(s) para franquicias; varias
//                     con OR para no dejar títulos fuera.
//   · `primary`     = tipo que mejor representa la marca (hero/carrusel).
// IDs verificados contra la API de TMDB (conteos reales de discover). Las claves
// deben coincidir con STUDIO_BRANDS del cliente (lib/studios.ts).
const STUDIOS: Record<
  string,
  {
    name: string
    primary: 'movie' | 'tv'
    providerId?: number
    movieCompanies?: number[]
    tvCompanies?: number[]
  }
> = {
  // Plataformas: pelis + series por watch provider (MX + US).
  netflix: { name: 'Netflix', primary: 'tv', providerId: 8 },
  disney: { name: 'Disney+', primary: 'movie', providerId: 337 },
  hbo: { name: 'HBO Max', primary: 'tv', providerId: 1899 },
  prime: { name: 'Prime Video', primary: 'movie', providerId: 9 },
  appletv: { name: 'Apple TV+', primary: 'tv', providerId: 350 },
  // Peacock es sobre todo catálogo de EE.UU.: sin la región US queda casi vacío
  // (en MX su contenido se reparte entre otras plataformas).
  peacock: { name: 'Peacock', primary: 'tv', providerId: 386 },
  // 2303 = Paramount Plus Premium: el 531 histórico quedó casi vacío en US.
  paramountplus: { name: 'Paramount+', primary: 'tv', providerId: 2303 },
  // Franquicias con pelis Y series (Marvel Studios / DC / Lucasfilm).
  marvel: { name: 'Marvel', primary: 'movie', movieCompanies: [420], tvCompanies: [420] },
  dc: { name: 'DC', primary: 'movie', movieCompanies: [429], tvCompanies: [429] },
  starwars: { name: 'Star Wars', primary: 'movie', movieCompanies: [1], tvCompanies: [1] },
  // Estudios sobre todo de cine (su catálogo de TV en TMDB es marginal).
  pixar: { name: 'Pixar', primary: 'movie', movieCompanies: [3] },
  paramount: { name: 'Paramount', primary: 'movie', movieCompanies: [4] },
  warner: { name: 'Warner Bros.', primary: 'movie', movieCompanies: [174] },
  universal: { name: 'Universal', primary: 'movie', movieCompanies: [33] },
  dreamworks: { name: 'DreamWorks', primary: 'movie', movieCompanies: [521] },
  // Franquicias del Home ("Franquicias"). IDs y conteos verificados contra TMDB.
  disneyanimation: { name: 'Disney Animation', primary: 'movie', movieCompanies: [6125] },
  illumination: { name: 'Illumination', primary: 'movie', movieCompanies: [6704] },
  ghibli: { name: 'Studio Ghibli', primary: 'movie', movieCompanies: [10342] },
  blumhouse: { name: 'Blumhouse', primary: 'movie', movieCompanies: [3172] },
}

// Géneros que se prueban en el catálogo de cada marca, según su tipo
// principal. Solo quedan los que traen suficientes títulos de esa marca (una
// fila de 3 pósters se ve vacía).
const STUDIO_GENRES: Record<'movie' | 'tv', [string, number][]> = {
  movie: [
    ['Acción', 28], ['Aventura', 12], ['Comedia', 35], ['Animación', 16],
    ['Ciencia ficción', 878], ['Drama', 18], ['Terror', 27], ['Familia', 10751],
    ['Fantasía', 14], ['Suspenso', 53], ['Romance', 10749], ['Crimen', 80],
  ],
  tv: [
    ['Drama', 18], ['Comedia', 35], ['Crimen', 80], ['Acción y aventura', 10759],
    ['Ciencia ficción y fantasía', 10765], ['Misterio', 9648], ['Animación', 16],
    ['Documentales', 99], ['Reality', 10764], ['Familia', 10751],
  ],
}
const STUDIO_GENRE_MIN = 8
const STUDIO_GENRE_MAX = 7


// ── Temas del buscador ──────────────────────────────────────────────────
// Cada tema es una lista de filas; cada fila, un discover de TMDB con
// palabras clave (`with_keywords`, `|` = OR), géneros u origen. IDs de
// keywords verificados contra la API de TMDB (search/keyword + conteos de
// discover). Las claves coinciden con SEARCH_THEMES de packages/core/src/themes.ts.
type ThemeRow = {
  title: string
  type: 'movie' | 'tv'
  sort?: 'popular' | 'top' | 'recent'
  // Fila con números (Top 10) o con imágenes horizontales; por defecto, pósters.
  style?: 'poster' | 'backdrop' | 'ranked'
  params?: Record<string, string | number>
  // Fila curada a mano: estos títulos, en este orden (en vez de un discover).
  ids?: number[]
  // Igual, pero mezclando pelis y series: [tipo, id].
  items?: ['movie' | 'tv', number][]
  // Nombres a mano para títulos que TMDB no tiene en español ni en inglés
  // (Drag Race Thailand venía en tailandés).
  names?: Record<number, string>
}
const KW = {
  christmas: '207317|1991|5570|260365', // christmas, santa claus, christmas tree, christmas eve
  halloween: '3335|9694|232795', // halloween, halloween party, halloween night
  witch: '616',
  vampire: '3133',
  dayOfTheDead: '209789',
  ghost: '3358|162846', // haunted house, ghost
  slasher: '12339',
  valentine: '160404',
  zombie: '12377|186565', // zombie, zombie apocalypse
  superhero: '9715|155030', // superhero, superhero team
  dinosaur: '12616',
  kaiju: '161791',
  space: '252634|3801', // outer space, space travel
  alien: '9951',
}
const NOT_HORROR = { without_genres: 27 }
const FAMILY = { with_genres: '16|10751' }

const THEMES: Record<string, { name: string; rows: ThemeRow[] }> = {
  navidad: {
    name: 'Navidad',
    rows: [
      { title: 'Lo más visto en Navidad', type: 'movie', params: { with_keywords: KW.christmas, ...NOT_HORROR } },
      { title: 'Clásicos navideños', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: KW.christmas, ...NOT_HORROR, 'vote_count.gte': 800 } },
      { title: 'Para ver en familia', type: 'movie', style: 'backdrop', params: { with_keywords: KW.christmas, ...FAMILY, ...NOT_HORROR } },
      { title: 'Comedias navideñas', type: 'movie', params: { with_keywords: KW.christmas, with_genres: 35, ...NOT_HORROR } },
      { title: 'Romances de Navidad', type: 'movie', params: { with_keywords: KW.christmas, with_genres: 10749, ...NOT_HORROR } },
      { title: 'Series y especiales', type: 'tv', params: { with_keywords: KW.christmas } },
      { title: 'Navidad de terror', type: 'movie', style: 'backdrop', params: { with_keywords: KW.christmas, with_genres: 27 } },
    ],
  },
  halloween: {
    name: 'Halloween',
    rows: [
      { title: 'Noche de Halloween', type: 'movie', params: { with_keywords: KW.halloween } },
      { title: 'Halloween en familia', type: 'movie', style: 'backdrop', params: { with_keywords: KW.halloween, ...FAMILY } },
      { title: 'Las de culto', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: KW.halloween, 'vote_count.gte': 800 } },
      { title: 'Series para Halloween', type: 'tv', params: { with_keywords: KW.halloween } },
      { title: 'Brujas', type: 'movie', params: { with_keywords: KW.witch } },
      { title: 'Vampiros', type: 'movie', style: 'backdrop', params: { with_keywords: KW.vampire } },
      { title: 'Casas embrujadas', type: 'movie', params: { with_keywords: KW.ghost, with_genres: 27 } },
    ],
  },
  diademuertos: {
    name: 'Día de Muertos',
    rows: [
      { title: 'Día de Muertos', type: 'movie', style: 'backdrop', params: { with_keywords: KW.dayOfTheDead, 'vote_count.gte': 5 } },
      { title: 'Cine mexicano aclamado', type: 'movie', sort: 'top', style: 'ranked', params: { with_origin_country: 'MX', without_genres: 99, 'vote_count.gte': 150 } },
      { title: 'Hecho en México', type: 'movie', params: { with_origin_country: 'MX', without_genres: 99, 'vote_count.gte': 40 } },
      { title: 'Fantasmas para toda la familia', type: 'movie', params: { with_keywords: KW.ghost, ...FAMILY } },
      { title: 'Series mexicanas', type: 'tv', params: { with_origin_country: 'MX', without_genres: '99|10764|10767', 'vote_count.gte': 20 } },
    ],
  },
  terror: {
    name: 'Terror',
    rows: [
      { title: 'Lo más visto en terror', type: 'movie', params: { with_genres: 27 } },
      { title: 'Clásicos del terror', type: 'movie', sort: 'top', style: 'ranked', params: { with_genres: 27, 'vote_count.gte': 1500 } },
      { title: 'Recién salidas', type: 'movie', sort: 'recent', style: 'backdrop', params: { with_genres: 27, 'vote_count.gte': 60 } },
      { title: 'Casas embrujadas y fantasmas', type: 'movie', params: { with_keywords: KW.ghost, with_genres: 27 } },
      { title: 'Slashers', type: 'movie', params: { with_keywords: KW.slasher, with_genres: 27 } },
      { title: 'Series para no dormir', type: 'tv', style: 'backdrop', params: { with_keywords: `${KW.ghost}|${KW.zombie}|${KW.halloween}` } },
    ],
  },
  sanvalentin: {
    name: 'San Valentín',
    rows: [
      { title: 'Para San Valentín', type: 'movie', params: { with_keywords: KW.valentine } },
      { title: 'Comedias románticas', type: 'movie', style: 'backdrop', params: { with_genres: '10749,35', 'vote_count.gte': 300 } },
      { title: 'Grandes historias de amor', type: 'movie', sort: 'top', style: 'ranked', params: { with_genres: 10749, 'vote_count.gte': 1500 } },
      { title: 'Para llorar', type: 'movie', params: { with_genres: '10749,18', 'vote_count.gte': 500 } },
      { title: 'Romance animado', type: 'movie', params: { with_genres: '10749,16' } },
    ],
  },
  zombies: {
    name: 'Zombies',
    rows: [
      { title: 'Lo más visto', type: 'movie', params: { with_keywords: KW.zombie } },
      { title: 'Series de zombies', type: 'tv', style: 'backdrop', params: { with_keywords: KW.zombie } },
      { title: 'Las mejores', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: KW.zombie, 'vote_count.gte': 500 } },
      { title: 'Zombies con humor', type: 'movie', params: { with_keywords: KW.zombie, with_genres: 35 } },
      { title: 'Recién salidas', type: 'movie', sort: 'recent', params: { with_keywords: KW.zombie, 'vote_count.gte': 30 } },
    ],
  },
  superheroes: {
    name: 'Superhéroes',
    rows: [
      { title: 'Lo más visto', type: 'movie', params: { with_keywords: KW.superhero } },
      { title: 'Las mejor valoradas', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: KW.superhero, 'vote_count.gte': 3000 } },
      { title: 'Series de superhéroes', type: 'tv', style: 'backdrop', params: { with_keywords: KW.superhero } },
      { title: 'Animadas', type: 'movie', params: { with_keywords: KW.superhero, with_genres: 16 } },
      { title: 'Recién llegadas', type: 'movie', sort: 'recent', params: { with_keywords: KW.superhero, 'vote_count.gte': 100 } },
    ],
  },
  anime: {
    name: 'Anime',
    rows: [
      { title: 'Series de anime populares', type: 'tv', params: { with_genres: 16, with_original_language: 'ja' } },
      { title: 'Películas de anime', type: 'movie', style: 'backdrop', params: { with_genres: 16, with_original_language: 'ja' } },
      { title: 'Obras maestras', type: 'movie', sort: 'top', style: 'ranked', params: { with_genres: 16, with_original_language: 'ja', 'vote_count.gte': 800 } },
      { title: 'Anime de acción', type: 'tv', params: { with_genres: '16,10759', with_original_language: 'ja' } },
      { title: 'Studio Ghibli', type: 'movie', params: { with_companies: 10342 } },
      { title: 'Las mejor valoradas', type: 'tv', sort: 'top', params: { with_genres: 16, with_original_language: 'ja', 'vote_count.gte': 500 } },
    ],
  },
  dinosaurios: {
    name: 'Dinosaurios',
    rows: [
      { title: 'Lo más visto', type: 'movie', params: { with_keywords: KW.dinosaur } },
      { title: 'Para los más chicos', type: 'movie', style: 'backdrop', params: { with_keywords: KW.dinosaur, ...FAMILY } },
      { title: 'Series y documentales', type: 'tv', params: { with_keywords: KW.dinosaur } },
      { title: 'Monstruos gigantes', type: 'movie', params: { with_keywords: KW.kaiju } },
      { title: 'Las mejor valoradas', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: KW.dinosaur, 'vote_count.gte': 300 } },
    ],
  },
  espacio: {
    name: 'El espacio',
    rows: [
      { title: 'Lo más visto', type: 'movie', params: { with_keywords: KW.space } },
      { title: 'Las mejor valoradas', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: KW.space, 'vote_count.gte': 1500 } },
      { title: 'Series espaciales', type: 'tv', style: 'backdrop', params: { with_keywords: KW.space } },
      { title: 'Extraterrestres', type: 'movie', params: { with_keywords: KW.alien } },
      { title: 'Para toda la familia', type: 'movie', params: { with_keywords: KW.space, ...FAMILY } },
    ],
  },
}
const THEME_ROW_MIN = 6

// ── Harry Potter / el mundo mágico ───────────────────────────────────────
// Curada a mano: la saga en orden, lo que vino después (Animales fantásticos,
// el reencuentro, la serie de HBO), y para seguir: películas y series con
// magia. IDs de TMDB verificados uno por uno.
THEMES.harrypotter = {
  name: 'Harry Potter',
  rows: [
    {
      title: 'La saga completa', type: 'movie',
      // De la piedra filosofal a las reliquias de la muerte, en orden.
      ids: [671, 672, 673, 674, 675, 767, 12444, 12445],
    },
    {
      title: 'Más del mundo mágico', type: 'movie', style: 'backdrop',
      // Animales fantásticos 1–3, la serie de HBO, Regreso a Hogwarts, Una
      // historia de magia, Wizards of Baking y el Torneo de las Casas.
      items: [
        ['movie', 259316], ['movie', 338952], ['movie', 338953], ['tv', 224377],
        ['movie', 899082], ['movie', 482408], ['tv', 254514], ['tv', 133723],
      ],
    },
    {
      title: 'Si te gusta Harry Potter', type: 'movie',
      // Narnia, Percy Jackson, La brújula dorada, Spiderwick, Miss Peregrine,
      // Stardust, El aprendiz de brujo, Terabithia, La casa con un reloj…,
      // Wicked, Matilda.
      ids: [411, 32657, 2268, 8204, 283366, 2270, 27022, 1265, 463821, 402431, 10830],
    },
    {
      title: 'Series con magia', type: 'tv', style: 'backdrop',
      // His Dark Materials, Sombra y hueso, Magicians, El descubrimiento de las
      // brujas, Percy Jackson, Merlina, Sabrina, La peor bruja.
      ids: [68507, 85720, 64432, 77236, 103540, 119051, 79242, 69581],
    },
    { title: 'Fantasía que hechiza', type: 'movie', sort: 'top', style: 'ranked', params: { with_genres: 14, 'vote_count.gte': 5000 } },
    // wizard, sorcery, magic school
    { title: 'Magos y escuelas de magia', type: 'movie', params: { with_keywords: '177912|5147|291549', 'vote_count.gte': 300 } },
  ],
}

// ── RuPaul's Drag Race ───────────────────────────────────────────────────
// La franquicia, curada a mano: primero el universo original, después cada
// versión del mundo (México primero), y alrededor el cine, el ballroom y lo
// imperdible LGBTQ+. IDs de TMDB verificados uno por uno.
THEMES.rupaul = {
  name: "RuPaul's Drag Race",
  rows: [
    {
      title: 'El universo Drag Race', type: 'tv',
      // Original, All Stars, Global All Stars, Untucked, AS Untucked,
      // Secret Celebrity, Live Untucked.
      ids: [8514, 67482, 232821, 38409, 67564, 98888, 251306],
    },
    {
      title: 'Drag Race por el mundo', type: 'tv', style: 'backdrop',
      // México, España, UK, Canadá, Down Under, Francia, Italia, Brasil,
      // Filipinas, Tailandia, Holanda, Bélgica, Suecia, Alemania.
      ids: [226082, 124045, 92611, 94038, 122692, 152261, 127841, 216276, 139203, 77233, 108934, 200865, 200870, 231807],
      names: { 77233: 'Drag Race Thailand' },
    },
    { title: 'Más competencias drag', type: 'tv', params: { with_keywords: '824|305127', 'vote_count.gte': 5 } },
    {
      // Curada: la palabra clave "drag" sola traía comedias de disfraces y
      // títulos explícitos que no son de este mundo.
      title: 'Películas con drag queens', type: 'movie',
      // Priscilla, The Birdcage, To Wong Foo, Hairspray, Kinky Boots, Todos
      // hablan de Jamie, Hurricane Bianca, Dumplin', La Cage aux folles,
      // Hedwig, Stage Mother, Flawless.
      ids: [2759, 11000, 9090, 2976, 16367, 624899, 400547, 472734, 4484, 13403, 626020, 31582],
    },
    {
      title: 'Ballroom y voguing', type: 'tv', style: 'backdrop',
      // Pose, Paris Is Burning, Legendary, Kiki, My House, Saturday Church,
      // Port Authority, Tangerine.
      items: [['tv', 79084], ['movie', 31225], ['tv', 99595], ['movie', 373480], ['tv', 78758], ['movie', 450608], ['movie', 572404], ['movie', 308084]],
    },
    { title: 'Imperdibles del orgullo', type: 'movie', sort: 'top', style: 'ranked', params: { with_keywords: 158718, 'vote_count.gte': 1500 } },
    { title: 'Más de World of Wonder', type: 'tv', params: { with_companies: '1421|218794', 'vote_count.gte': 3 } },
  ],
}

async function themeRow(row: ThemeRow) {
  const curated: ['movie' | 'tv', number][] | undefined =
    row.items ?? row.ids?.map((id) => [row.type, id] as ['movie' | 'tv', number])
  if (curated?.length) {
    const settled = await Promise.allSettled(curated.map(([type, id]) => tmdbService.basic(type, id)))
    const results = settled.flatMap((r, i) => {
      if (r.status !== 'fulfilled' || !r.value?.poster_path) return []
      const [type, id] = curated[i]
      const fixed = row.names?.[id]
      return [{
        ...r.value,
        media_type: type,
        ...(fixed ? (type === 'tv' ? { name: fixed } : { title: fixed }) : {}),
      }]
    })
    return { title: row.title, type: row.type, style: row.style ?? 'poster', results }
  }
  const isMovie = row.type === 'movie'
  const sortBy =
    row.sort === 'top' ? 'vote_average.desc'
    : row.sort === 'recent' ? (isMovie ? 'primary_release_date.desc' : 'first_air_date.desc')
    : 'popularity.desc'
  const params: Record<string, string | number> = {
    // Piso de votos: sin esto aparecen rarezas sin póster ni sinopsis.
    'vote_count.gte': row.sort === 'top' ? 300 : 20,
    ...(row.params ?? {}),
  }
  // "Recientes" sin tope trae estrenos futuros sin arte.
  if (row.sort === 'recent') {
    params[isMovie ? 'primary_release_date.lte' : 'first_air_date.lte'] = new Date().toISOString().slice(0, 10)
  }
  const res: any = await tmdbService.discoverSorted(row.type, sortBy, params)
  const results = (res?.results ?? [])
    .filter((r: any) => r.poster_path)
    .map((r: any) => ({ ...r, media_type: row.type }))
  return { title: row.title, type: row.type, style: row.style ?? 'poster', results }
}

async function safeGenres(
  genres: [string, number][],
  type: 'movie' | 'tv'
): Promise<{ name: string; results: any[] }[]> {
  const results = await Promise.allSettled(
    genres.map(([, id]) => tmdbService.discoverByGenre(id, type))
  )
  return genres
    .map(([name], i) => ({
      name,
      results: results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<any>).value.results ?? [] : [],
    }))
    .filter((g) => g.results.length > 0)
}

// Filas por plataforma. Devuelve además la `key` del estudio para que el
// cliente pueda enlazar el título de la fila al catálogo de esa marca
// (ver STUDIOS y /tmdb/studio/:key).
async function safeProviders(
  providers: [string, string, number][],
  type: 'movie' | 'tv'
): Promise<{ name: string; key: string; results: any[] }[]> {
  const results = await Promise.allSettled(
    providers.map(([, , id]) => tmdbService.discoverByProvider(id, type))
  )
  return providers
    .map(([name, key], i) => ({
      name,
      key,
      results: results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<any>).value.results ?? [] : [],
    }))
    .filter((p) => p.results.length > 0)
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export const tmdbRoutes = new Elysia({ prefix: '/tmdb' })
  // Inicio: varias filas en una sola llamada
  .get('/home', () =>
    cache.resolve('home', async () => {
      // topSeries es una quinta fuente REAL. El Home dibuja unas diez filas y
      // sólo había cuatro listas para alimentarlas: "Top 10 películas" y
      // "Mejor valoradas" terminaban mostrando exactamente el mismo array, que
      // es información repetida por diseño y no por un descuido del cliente.
      const [trending, popularMovies, popularSeries, topMovies, topSeries] =
        await Promise.all([
          tmdbService.trending(),
          tmdbService.popularMovies(),
          tmdbService.popularSeries(),
          tmdbService.topRatedMovies(),
          tmdbService.topRatedSeries(),
        ])
      return { trending, popularMovies, popularSeries, topMovies, topSeries }
    })
  )

  // Películas: tendencias + populares + mejor valoradas + filas por género
  .get('/movies', () =>
    cache.resolve('movies', async () => {
      const GENRES: [string, number][] = [
        ['Acción', 28],
        ['Comedia', 35],
        ['Terror', 27],
        ['Ciencia ficción', 878],
        ['Animación', 16],
        ['Drama', 18],
        ['Romance', 10749],
        ['Aventura', 12],
        ['Suspenso', 53],
        ['Fantasía', 14],
        ['Crimen', 80],
        ['Familia', 10751],
      ]
      const PROVIDERS: [string, string, number][] = [
        ['Netflix', 'netflix', 8],
        ['Disney+', 'disney', 337],
        ['Prime Video', 'prime', 9],
        ['HBO Max', 'hbo', 1899],
      ]
      const [trending, popular, topRated, recent, classics, providers, genres] =
        await Promise.all([
          tmdbService.trendingMovies(),
          tmdbService.popularMovies(),
          tmdbService.topRatedMovies(),
          // Estrenadas ya (lte hoy) — sin el tope de fecha se llenaba de
          // títulos futuros sin pósters ni valoraciones.
          tmdbService.discoverSorted('movie', 'primary_release_date.desc', {
            'primary_release_date.lte': todayISO(),
            'vote_count.gte': 30,
          }),
          tmdbService.discoverSorted('movie', 'vote_average.desc', {
            'primary_release_date.lte': '2005-12-31',
            'vote_count.gte': 1500,
          }),
          safeProviders(PROVIDERS, 'movie'),
          safeGenres(GENRES, 'movie'),
        ])
      return { trending, popular, topRated, recent, classics, providers, genres }
    })
  )

  // Series: tendencias + populares + mejor valoradas + filas por género
  .get('/series', () =>
    cache.resolve('series', async () => {
      const GENRES: [string, number][] = [
        ['Drama', 18],
        ['Comedia', 35],
        ['Crimen', 80],
        ['Sci-Fi y Fantasía', 10765],
        ['Acción y Aventura', 10759],
        ['Animación', 16],
        ['Misterio', 9648],
        ['Documental', 99],
        ['Familia', 10751],
        ['Infantil', 10762],
        ['Reality', 10764],
        ['Guerra y política', 10768],
      ]
      const PROVIDERS: [string, string, number][] = [
        ['Netflix', 'netflix', 8],
        ['HBO Max', 'hbo', 1899],
        ['Disney+', 'disney', 337],
        ['Apple TV+', 'appletv', 350],
      ]
      const [trending, popular, topRated, recent, classics, providers, genres] =
        await Promise.all([
          tmdbService.trendingSeries(),
          tmdbService.popularSeries(),
          tmdbService.topRatedSeries(),
          tmdbService.discoverSorted('tv', 'first_air_date.desc', {
            'first_air_date.lte': todayISO(),
            'vote_count.gte': 30,
          }),
          tmdbService.discoverSorted('tv', 'vote_average.desc', {
            'first_air_date.lte': '2010-12-31',
            'vote_count.gte': 800,
          }),
          safeProviders(PROVIDERS, 'tv'),
          safeGenres(GENRES, 'tv'),
        ])
      return { trending, popular, topRated, recent, classics, providers, genres }
    })
  )

  // Colecciones por plataforma (Netflix, Apple TV+, HBO Max, Disney+, Prime)
  .get('/collections', () =>
    cache.resolve('collections', async () => {
      const [netflix, appletv, hbo, disney, prime] = await Promise.all([
        tmdbService.discoverByProvider(8),
        tmdbService.discoverByProvider(350, 'tv'),
        tmdbService.discoverByProvider(1899),
        tmdbService.discoverByProvider(337),
        tmdbService.discoverByProvider(9),
      ])
      return { netflix, appletv, hbo, disney, prime }
    })
  )

  // Catálogo especial de un estudio / marca (Disney, HBO, Marvel...). La misma
  // forma que /genre (hero + populares + top + recientes) para reusar el
  // layout de catálogo en el cliente. `type` indica si la marca se representa
  // mejor con pelis o series.
  .get(
    '/studio/:key',
    ({ params }) =>
      cache.resolve(`studio:${params.key.toLowerCase()}`, async () => {
        const s = STUDIOS[params.key.toLowerCase()]
        if (!s) {
          return {
            name: params.key, type: 'movie', primary: 'movie', hero: null,
            popular: [], topRated: [], recent: [],
            movies: [], moviesTop: [], series: [], seriesTop: [], genres: [],
          }
        }
        const wantMovies = !!(s.providerId || s.movieCompanies?.length)
        const wantSeries = !!(s.providerId || s.tvCompanies?.length)
        const recentSort = s.primary === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc'
        const empty = Promise.resolve<any[]>([])
        const brand = (type: 'movie' | 'tv', sortBy: string) =>
          tmdbService.discoverBrand({
            type,
            sortBy,
            providerId: s.providerId,
            companies: type === 'movie' ? s.movieCompanies : s.tvCompanies,
          })

        // Catálogo dual: pelis (populares + top) y series (populares + top), más
        // "recientes" del tipo primario. allSettled para que una fila que falle
        // (o una marca sin series) no tire todo el catálogo.
        const settled = await Promise.allSettled([
          wantMovies ? brand('movie', 'popularity.desc') : empty,
          wantMovies ? brand('movie', 'vote_average.desc') : empty,
          wantSeries ? brand('tv', 'popularity.desc') : empty,
          wantSeries ? brand('tv', 'vote_average.desc') : empty,
          brand(s.primary, recentSort),
        ])
        // Filas por género del tipo principal, para que el catálogo de la
        // marca tenga de dónde explorar y no se acabe en cuatro filas.
        const genreSettled = await Promise.allSettled(
          STUDIO_GENRES[s.primary].map(([, id]) =>
            tmdbService.discoverBrand({
              type: s.primary,
              sortBy: 'popularity.desc',
              providerId: s.providerId,
              companies: s.primary === 'movie' ? s.movieCompanies : s.tvCompanies,
              genre: id,
            })
          )
        )
        const genres = STUDIO_GENRES[s.primary]
          .map(([name, id], i) => ({
            name,
            id,
            type: s.primary,
            results: genreSettled[i].status === 'fulfilled'
              ? (genreSettled[i] as PromiseFulfilledResult<any[]>).value
              : [],
          }))
          .filter((g) => g.results.length >= STUDIO_GENRE_MIN)
          .slice(0, STUDIO_GENRE_MAX)
        const val = (i: number): any[] =>
          settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<any[]>).value : []
        const movies = val(0), moviesTop = val(1), series = val(2), seriesTop = val(3), recent = val(4)

        const primaryPop = s.primary === 'movie' ? movies : series
        const primaryTop = s.primary === 'movie' ? moviesTop : seriesTop
        const hero = primaryPop.find((x: any) => x.backdrop_path)?.backdrop_path ?? null

        return {
          name: s.name,
          primary: s.primary,
          hero,
          // Nuevo catálogo dual (cliente móvil).
          movies, moviesTop, series, seriesTop,
          genres,
          // Legacy (apps/tv y clientes viejos leen esta forma tipo-género).
          type: s.primary,
          popular: primaryPop,
          topRated: primaryTop,
          recent,
        }
      }),
    { params: t.Object({ key: t.String() }) }
  )

  // Detalle de persona (actor) con filmografía
  .get('/person/:id', ({ params }) => tmdbService.personDetails(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  // Logo (PNG) del título para el hero — prioriza español, luego inglés
  .get(
    '/images/:type/:id',
    async ({ params }) => {
      const type = params.type === 'tv' ? 'tv' : 'movie'
      const data: any = await tmdbService.images(type, Number(params.id))
      const logos: any[] = data?.logos ?? []
      const pick =
        logos.find((l) => l.iso_639_1 === 'es') ??
        logos.find((l) => l.iso_639_1 === 'en') ??
        logos[0]
      return { logo: pick?.file_path ?? null }
    },
    { params: t.Object({ type: t.String(), id: t.String() }) }
  )

  // Categorías para la pantalla de Buscar (género + arte representativo)
  .get('/categories', () =>
    cache.resolve('categories', async () => {
      const CATS: [string, 'movie' | 'tv', number][] = [
        ['Acción', 'movie', 28],
        ['Comedia', 'movie', 35],
        ['Terror', 'movie', 27],
        ['Ciencia ficción', 'movie', 878],
        ['Animación', 'movie', 16],
        ['Drama', 'movie', 18],
        ['Crimen', 'tv', 80],
        ['Romance', 'movie', 10749],
        ['Aventura', 'movie', 12],
        ['Documentales', 'movie', 99],
        ['Familia', 'movie', 10751],
        ['Suspenso', 'movie', 53],
        ['Fantasía', 'movie', 14],
        ['Misterio', 'movie', 9648],
        ['Historia', 'movie', 36],
        ['Música', 'movie', 10402],
        ['Bélico', 'movie', 10752],
        ['Western', 'movie', 37],
        ['Reality', 'tv', 10764],
        ['Series acción', 'tv', 10759],
        ['Sci-Fi & Fantasy', 'tv', 10765],
        ['Infantil', 'tv', 10762],
        ['Guerra y política', 'tv', 10768],
        ['Telenovelas', 'tv', 10766],
      ]
      // Marcas navegables (Marvel, Apple TV+, DC, Peacock...). Antes sólo se
      // llegaba a ellas ESCRIBIENDO el nombre en el buscador; acá se muestran
      // como tarjetas junto a los géneros. Llevan `studioKey` en vez de
      // `genreId`: el cliente las enruta a /studio/:key y no a /browse.
      const BRANDS: string[] = [
        'netflix', 'disney', 'hbo', 'prime', 'appletv', 'peacock',
        'marvel', 'dc', 'starwars', 'pixar',
        'paramount', 'warner', 'universal', 'dreamworks',
      ]

      const [genreResults, brandResults] = await Promise.all([
        Promise.allSettled(CATS.map(([, type, id]) => tmdbService.discoverByGenre(id, type))),
        Promise.allSettled(
          BRANDS.map((key) => {
            const s = STUDIOS[key]
            return tmdbService.discoverBrand({
              type: s.primary,
              sortBy: 'popularity.desc',
              providerId: s.providerId,
              companies: s.primary === 'movie' ? s.movieCompanies : s.tvCompanies,
            })
          })
        ),
      ])

      const settledList = (r: PromiseSettledResult<any>): any[] => {
        if (r.status !== 'fulfilled') return []
        // discoverByGenre devuelve {results}; discoverBrand devuelve el array.
        return Array.isArray(r.value) ? r.value : (r.value?.results ?? [])
      }

      // Sin esto la misma portada aparecía en tres tarjetas: cada categoría
      // elegía por su cuenta el primer título con backdrop, y los títulos
      // populares (Spider-Man, Moana) encabezan varios géneros a la vez. Se
      // lleva registro de lo ya usado y cada tarjeta toma el primero libre.
      const usedIds = new Set<number>()
      const pickArt = (list: any[]) => {
        const fresh = list.find((x: any) => x.backdrop_path && !usedIds.has(x.id))
        // Si TODO el listado ya se usó, se repite antes que dejar la tarjeta
        // vacía — pero recién como último recurso.
        const art = fresh ?? list.find((x: any) => x.backdrop_path)
        if (art?.id != null) usedIds.add(art.id)
        return art?.backdrop_path ?? null
      }

      // Las marcas van primero: son el atajo más buscado y tienen el arte más
      // reconocible, así se quedan con las mejores portadas del reparto.
      const brands = BRANDS.map((key, i) => ({
        name: STUDIOS[key].name,
        type: STUDIOS[key].primary,
        studioKey: key,
        genreId: null,
        backdrop_path: pickArt(settledList(brandResults[i])),
      })).filter((c) => c.backdrop_path)

      const genres = CATS.map(([name, type, genreId], i) => ({
        name,
        type,
        studioKey: null,
        genreId,
        backdrop_path: pickArt(settledList(genreResults[i])),
      })).filter((c) => c.backdrop_path)

      return [...brands, ...genres]
    })
  )

  // Secciones para la pantalla de categoría estilo Apple TV
  .get(
    '/genre/:type/:id',
    async ({ params }) => {
      const type = params.type === 'tv' ? 'tv' : 'movie'
      const genreId = Number(params.id)
      const recentSort = type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc'
      const [popular, topRated, recent] = await Promise.all([
        tmdbService.discoverByGenre(genreId, type),
        tmdbService.discoverByGenreSorted(genreId, type, 'vote_average.desc'),
        tmdbService.discoverByGenreSorted(genreId, type, recentSort),
      ])
      const pop = (popular as any).results as any[]
      const hero = pop.find((x: any) => x.backdrop_path)?.backdrop_path ?? null
      return {
        hero,
        popular: pop,
        topRated: (topRated as any).results,
        recent: (recent as any).results,
      }
    },
    { params: t.Object({ type: t.String(), id: t.String() }) }
  )

  // Colección de un tema del buscador (Navidad, Halloween, Terror…). Filas
  // que no llegan al mínimo de títulos no se mandan: una fila de 3 se ve rota.
  .get(
    '/theme/:key',
    ({ params, set }) => {
      const key = params.key.toLowerCase()
      const theme = THEMES[key]
      if (!theme) {
        set.status = 404
        return { key, name: params.key, rows: [] }
      }
      return cache.resolve(`theme:${key}`, async () => {
        const settled = await Promise.allSettled(theme.rows.map(themeRow))
        const rows = settled
          .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
          .filter((r) => r.results.length >= THEME_ROW_MIN)
        return { key, name: theme.name, rows }
      })
    },
    { params: t.Object({ key: t.String() }) }
  )

  // "Una peli cortita" del Home: películas populares de hora y media o menos.
  // El piso de 60 min deja afuera cortos y especiales; el de votos, rarezas.
  .get('/short-movies', () =>
    tmdbService.discoverSorted('movie', 'popularity.desc', {
      'with_runtime.gte': 60,
      'with_runtime.lte': 95,
      'vote_count.gte': 300,
    })
  )

  // Discover por género (cuadrícula de una categoría)
  .get(
    '/discover/:type/:genreId',
    ({ params }) =>
      tmdbService.discoverByGenre(
        Number(params.genreId),
        params.type === 'tv' ? 'tv' : 'movie'
      ),
    { params: t.Object({ type: t.String(), genreId: t.String() }) }
  )

  // Búsqueda
  .get(
    '/search',
    ({ query }) => tmdbService.searchMulti(query.q ?? '', Number(query.page ?? 1)),
    { query: t.Object({ q: t.String(), page: t.Optional(t.String()) }) }
  )

  // Detalle de película
  .get('/movie/:id', ({ params }) => tmdbService.movieDetails(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  // Detalle de serie
  .get('/tv/:id', ({ params }) => tmdbService.tvDetails(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  // Temporada de serie (capítulos)
  .get(
    '/tv/:id/season/:season',
    ({ params }) =>
      tmdbService.tvSeason(Number(params.id), Number(params.season)),
    { params: t.Object({ id: t.String(), season: t.String() }) }
  )
