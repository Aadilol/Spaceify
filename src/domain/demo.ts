import type { Listening, ListeningTrack, Point } from './listening.ts'
import { day } from './listening.ts'

export { day } from './listening.ts'

export const demoYears = Array.from({ length: 11 }, (_, index) => 2016 + index)
export const initialYear = 2024
export const demoAsOf = Date.UTC(2026, 10, 18)

const artists = {
  aster: 'Aster Signal',
  relay: 'Soft Relay',
  orbit: 'Lunar Relay',
  bloom: 'Static Bloom',
  copper: 'Copper Hours',
  mira: 'Mira Phase',
  north: 'North of Static',
  echo: 'Echo Lattice',
  field: 'Field Theory',
  vapor: 'Vapor Index',
} as const

export interface DemoAlbum {
  id: string
  name: string
  artist: keyof typeof artists
  artistName: string
  genre: string
  tags: string[]
  release: number
  point: Point
  tone: number
  years: Record<number, Listening>
}

function album(
  id: string, name: string, artist: keyof typeof artists, genre: string, tags: string[],
  release: number, x: number, y: number, tone: number, minutes: number[],
): DemoAlbum {
  return {
    id, name, artist, artistName: artists[artist], genre, tags: [genre, ...tags],
    release, point: { x, y }, tone,
    years: Object.fromEntries(demoYears.map((year, index) => {
      const duration = minutes[index] ?? 0
      return [year, { minutes: duration, events: Math.round(duration * 0.2948) }]
    })),
  }
}

export const demoAlbums = [
  album('night-drive', 'Night Drive', 'aster', 'Ambient electronic', ['Atmospheric', 'Analog', 'Late night'], 2021, 0, 0, 166,
    [0, 0, 0, 0, 0, 188, 988, 1640, 2178, 1745, 1298]),
  album('glass-current', 'Glass Current', 'relay', 'Downtempo', ['Atmospheric', 'Late night'], 2017, -191, -93, 190,
    [0, 365, 0, 710, 1261, 1411, 802, 921, 1122, 995, 490]),
  album('low-orbit', 'Low Orbit', 'orbit', 'Ambient electronic', ['Atmospheric', 'Drone'], 2019, 22, -145, 208,
    [0, 0, 0, 210, 680, 544, 912, 741, 926, 695, 820]),
  album('afterimage', 'Afterimage', 'bloom', 'Synthwave', ['Analog', 'Late night'], 2019, 194, -94, 286,
    [0, 0, 0, 306, 760, 910, 650, 1244, 800, 2270, 1880]),
  album('velvet-static', 'Velvet Static', 'copper', 'Synthwave', ['Analog', 'Late night'], 2022, 185, 98, 26,
    [0, 0, 0, 0, 0, 0, 194, 610, 680, 1120, 875]),
  album('tide-memory', 'Tide Memory', 'relay', 'Downtempo', ['Atmospheric', 'Late night'], 2020, -209, 94, 220,
    [0, 0, 0, 0, 280, 712, 1066, 581, 510, 350, 477]),
  album('quiet-circuits', 'Quiet Circuits', 'aster', 'Ambient electronic', ['Atmospheric', 'Analog'], 2023, -44, 145, 151,
    [0, 0, 0, 0, 0, 0, 0, 260, 365, 622, 280]),
  album('slow-exposure', 'Slow Exposure', 'mira', 'Ambient electronic', ['Drone'], 2016, -112, -160, 253,
    [230, 291, 0, 304, 355, 220, 0, 0, 635, 0, 0]),
  album('blue-meridian', 'Blue Meridian', 'north', 'Downtempo', ['Atmospheric'], 2023, 80, 151, 201,
    [0, 0, 0, 0, 0, 0, 0, 98, 185, 267, 680]),
  album('small-hours', 'Small Hours', 'echo', 'Ambient electronic', ['Drone', 'Atmospheric'], 2024, -156, 56, 174,
    [0, 0, 0, 0, 0, 0, 0, 0, 346, 208, 240]),
  album('second-tide', 'Second Tide', 'field', 'Downtempo', ['Late night', 'Atmospheric'], 2024, 85, 65, 194,
    [0, 0, 0, 0, 0, 0, 0, 0, 330, 410, 244]),
  album('sunblind', 'Sunblind', 'vapor', 'Synthwave', ['Analog', 'Late night'], 2024, 118, -136, 52,
    [0, 0, 0, 0, 0, 0, 0, 0, 268, 445, 512]),
] satisfies DemoAlbum[]

const trackTitles: Record<string, readonly [string, string, string]> = {
  'night-drive': ['Blue mile', 'Headlights', 'Last exit'],
  'glass-current': ['Surface tension', 'Tidal glass', 'Slow water'],
  'low-orbit': ['Free fall', 'Umbra', 'Departure burn'],
  afterimage: ['Residual light', 'Scan line', 'White phosphor'],
  'velvet-static': ['Coil', 'Dead channel', 'After midnight'],
  'tide-memory': ['Slack tide', 'Driftwood', 'Moon pull'],
  'quiet-circuits': ['Open loop', 'Hiss', 'Foldback'],
  'slow-exposure': ['Still frame', 'Darkroom', 'Light leak'],
  'blue-meridian': ['A quiet north', 'Longitude', 'Between tides'],
  'small-hours': ['Window signal', 'Four thirty', 'Empty streets'],
  'second-tide': ['Silt', 'Wading', 'Undercurrent'],
  sunblind: ['Daystar', 'Solar flare', 'Color burn'],
}

export function demoTracks(album: DemoAlbum, year: number): ListeningTrack[] {
  const events = album.years[year].events
  const first = Math.floor(events * 0.46)
  const second = Math.floor(events * 0.33)
  const counts = [first, second, events - first - second]
  return trackTitles[album.id].flatMap((name, index) => counts[index] > 0
    ? [{ id: `${album.id}-${index}`, name, events: counts[index], coverTone: album.tone }] : [])
}

export function lastDemoPlay(album: DemoAlbum): number {
  const year = demoYears.filter((item) => album.years[item].events > 0).at(-1)
  if (!year) return 0
  const daysAgo = album.id === 'night-drive' ? 4 : album.id === 'afterimage' ? 13 : 28 + album.tone % 200
  return year === 2026 ? demoAsOf - daysAgo * day : Date.UTC(year, album.tone % 11, 12)
}

export const demoDiscoveries = [
  { id: 'wire-garden', name: 'Wire Garden', artistName: 'Aerial Form', genre: 'Downtempo', release: 2022, tone: 180,
    anchor: 'glass-current', point: { x: -327, y: -48 }, reason: 'Shares the fictional Downtempo tag with Glass Current.' },
  { id: 'paper-satellite', name: 'Paper Satellite', artistName: 'Aerial Dial', genre: 'Ambient electronic', release: 2024, tone: 212,
    anchor: 'low-orbit', point: { x: 99, y: -195 }, reason: 'Shares the fictional Ambient electronic tag with Low Orbit.' },
  { id: 'polar-echo', name: 'Polar Echo', artistName: 'Mono Weather', genre: 'Synthwave', release: 2023, tone: 253,
    anchor: 'afterimage', point: { x: 340, y: -137 }, reason: 'Shares the fictional Synthwave tag with Afterimage.' },
  { id: 'terminal-glow', name: 'Terminal Glow', artistName: 'Delta Index', genre: 'Synthwave', release: 2025, tone: 40,
    anchor: 'velvet-static', point: { x: 331, y: 137 }, reason: 'Shares the fictional Synthwave tag with Velvet Static.' },
]

// Fixed, public album destination selected by hand. It is not part of the demo listening archive.
export const spotifyPick = {
  id: 'tycho-dive', albumId: '6sLUang2W5cQIWM6J4PjJu', name: 'Dive', artistName: 'Tycho',
  genre: 'Downtempo', anchor: 'glass-current', point: { x: -47, y: -206 }, tone: 192,
} as const
