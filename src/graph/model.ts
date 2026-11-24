import { demoAlbums, demoDiscoveries, demoTracks, demoYears, lastDemoPlay, spotifyPick } from '../domain/demo.ts'
import type { DemoAlbum } from '../domain/demo.ts'
import type { Listening, ListeningTrack, Point } from '../domain/listening.ts'
import { minutesPerBand } from '../domain/public-chart.ts'
import type { CatalogArt, PublicRecommendation } from '../domain/public-chart.ts'

export type View = 'Album' | 'Artist'
export type LayoutMode = 'Hours' | 'Genre'
export type ChartDensity = 'Explore' | 'Focus'
export type TimelineMode = 'year' | 'through'

export interface MapNode extends Listening {
  id: string
  name: string
  artistName?: string
  creditedArtists?: string[]
  genre?: string
  release?: number
  tags: string[]
  point: Point
  tone: number
  radius: number
  rank?: number
  kind: 'listened' | 'discovery'
  tracks: ListeningTrack[]
  reason?: string
  spotifyAlbumId?: typeof spotifyPick.albumId
  lastPlayed?: number
  rediscoveredAfter?: number
  publicBand?: number
  publicBandYears?: number
  usesArtistGenres?: boolean
  genreFromReleases?: boolean
  artwork?: CatalogArt
  recommendation?: Pick<PublicRecommendation, 'kind' | 'mbid'> & { source?: 'artist-similarity' }
}

interface ListeningEdge { source: string; target: string; strength: number; kind: MapNode['kind']; basis?: 'listenbrainz' }
export interface ListeningGraph { nodes: MapNode[]; edges: ListeningEdge[]; complete?: true }

export const maxListened = 45
export const exploreSuggestions = 8
export const focusSuggestions = 4

export function rediscoveryGap(year: number, eventsIn: (year: number) => number): number | undefined {
  if (!demoYears.includes(year) || eventsIn(year) < 120) return undefined
  const previous = demoYears.filter((item) => item < year && eventsIn(item) > 0).at(-1)
  return previous !== undefined && year - previous >= 3 ? year - previous - 1 : undefined
}

function albumNode(album: DemoAlbum, year: number): MapNode {
  return {
    ...album.years[year],
    id: album.id, name: album.name, artistName: album.artistName, genre: album.genre,
    release: album.release, tags: album.tags, point: album.point, tone: album.tone,
    kind: 'listened', radius: 0, tracks: demoTracks(album, year), lastPlayed: lastDemoPlay(album),
    rediscoveredAfter: rediscoveryGap(year, (item) => album.years[item].events),
  }
}

function artistNodes(albums: DemoAlbum[], year: number): MapNode[] {
  const groups = new Map<string, DemoAlbum[]>()
  for (const album of albums) {
    const group = groups.get(album.artist) ?? []
    group.push(album)
    groups.set(album.artist, group)
  }
  return [...groups].map(([artist, releases]) => {
    const totals = new Map<string, number>()
    const tags = new Set<string>()
    let minutes = 0
    let events = 0
    for (const album of releases) {
      const listening = album.years[year]
      minutes += listening.minutes
      events += listening.events
      for (const tag of album.tags) tags.add(tag)
      totals.set(album.genre, (totals.get(album.genre) ?? 0) + listening.minutes)
    }
    const rankedGenres = [...totals].sort((a, b) => b[1] - a[1])
    const genre = rankedGenres[0][1] > (rankedGenres[1]?.[1] ?? 0) ? rankedGenres[0][0] : undefined
    const { artistName, point, tone } = releases[0]
    const tracks = releases.flatMap((release) => demoTracks(release, year)).sort((a, b) => b.events - a.events)
    const catalog = demoAlbums.filter((item) => item.artist === artist)
    return {
      id: `artist-${artist}`, name: artistName, genre, tags: [...tags], point, tone, minutes, events, radius: 0, tracks, kind: 'listened',
      lastPlayed: Math.max(...catalog.map(lastDemoPlay)),
      rediscoveredAfter: rediscoveryGap(year, (item) => catalog.reduce((sum, album) => sum + album.years[item].events, 0)),
    }
  })
}

function similarity(left: MapNode, right: MapNode): number {
  const common = left.tags.filter((tag) => right.tags.includes(tag)).length
  const overlap = common / (left.tags.length + right.tags.length - common || 1)
  const sameArtist = Boolean(left.artistName && left.artistName === right.artistName)
  if (sameArtist) return 0.8 + 0.2 * overlap
  return left.genre && left.genre === right.genre ? 0.55 + 0.45 * overlap : overlap * 0.55
}

export function listenedEdges(nodes: MapNode[], score = similarity, neighbors?: (node: MapNode) => Iterable<MapNode>): ListeningEdge[] {
  const edges = new Map<string, ListeningEdge>()
  for (const node of nodes) {
    const nearest = (neighbors ? [...neighbors(node)] : nodes).filter((candidate) => candidate !== node)
      .map((candidate) => ({ candidate, strength: score(node, candidate) }))
      .filter(({ strength }) => strength > 0)
      .sort((a, b) => b.strength - a.strength || a.candidate.id.localeCompare(b.candidate.id))
      .slice(0, 2)
    for (const { candidate, strength } of nearest) {
      const [source, target] = [node.id, candidate.id].sort()
      edges.set(`${source}/${target}`, { source, target, strength, kind: 'listened' })
    }
  }
  return [...edges.values()]
}

export function rankListened(entries: MapNode[], limit = maxListened): MapNode[] {
  const ranked = entries.sort((a, b) => b.minutes - a.minutes || b.events - a.events || a.id.localeCompare(b.id)).slice(0, limit)
  const peakEvents = ranked.reduce((peak, node) => Math.max(peak, node.events), 1)
  return ranked.map((node, index) => ({
    ...node, rank: index + 1,
    radius: 1.25 + 4.5 * Math.sqrt(node.events / peakEvents),
  }))
}

export function buildDemoGraph(year: number, view: View): ListeningGraph {
  const played = demoAlbums.filter((album) => album.years[year]?.minutes > 0)
  const entries = view === 'Album' ? played.map((album) => albumNode(album, year)) : artistNodes(played, year)
  const nodes = rankListened(entries)
  const edges = listenedEdges(nodes)
  const discoveries: MapNode[] = []
  for (const demo of demoDiscoveries) {
    const album = played.find((item) => item.id === demo.anchor)
    if (!album) continue
    const id = view === 'Album' ? album.id : `artist-${album.artist}`
    const anchor = nodes.find((node) => node.id === id)
    if (!anchor) continue
    const isArtist = view === 'Artist'
    const name = isArtist ? demo.artistName : demo.name
    const reason = isArtist ? `Shares the fictional ${demo.genre} tag with ${anchor.name}.` : demo.reason
    discoveries.push({
      id: `demo-${demo.id}`, name, artistName: isArtist ? undefined : demo.artistName,
      release: isArtist ? undefined : demo.release, genre: demo.genre, tone: demo.tone, point: demo.point,
      tags: [demo.genre], minutes: 0, events: 0, radius: 3.5, tracks: [], kind: 'discovery', reason,
    })
    edges.push({ source: anchor.id, target: `demo-${demo.id}`, strength: 0, kind: 'discovery' })
  }
  const guide = view === 'Album' ? spotifyPick.anchor : 'artist-relay'
  const guideNode = nodes.find((node) => node.id === guide)
  if (guideNode) {
    discoveries.push({
      id: spotifyPick.id, name: view === 'Album' ? spotifyPick.name : spotifyPick.artistName,
      artistName: view === 'Album' ? spotifyPick.artistName : undefined, genre: spotifyPick.genre,
      point: spotifyPick.point, tone: spotifyPick.tone, tags: [spotifyPick.genre], minutes: 0, events: 0, radius: 3.5,
      kind: 'discovery', tracks: [], spotifyAlbumId: spotifyPick.albumId,
      reason: `Dive by Tycho is a manually curated downtempo reference for the demo cluster around ${guideNode.name}.`,
    })
    edges.push({ source: guide, target: spotifyPick.id, strength: 0, kind: 'discovery' })
  }
  return { nodes: [...nodes, ...discoveries], edges }
}

export function formatDuration(minutes: number): string {
  minutes = Math.round(minutes * 60_000) / 60_000
  if (minutes > 0 && minutes < 1) {
    const seconds = Math.floor(minutes * 60)
    return seconds === 0 ? '<1s' : `${seconds}s`
  }
  minutes = Math.floor(minutes)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder}m`
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

export function formatPublicBand(band: number, years = 1): string {
  const upper = formatDuration((band + years) * minutesPerBand)
  return band === 0 ? `Under ${upper}` : `${formatDuration(band * minutesPerBand)} to ${upper}`
}

export function formatExactDuration(milliseconds: number): string {
  const time = Math.round(milliseconds)
  const hours = Math.floor(time / 3_600_000)
  const minutes = Math.floor(time / 60_000) % 60
  const seconds = (time % 60_000) / 1000
  const parts = [hours && hours + 'h', (hours || minutes) ? minutes + 'm' : '', seconds + 's']
  return parts.filter(Boolean).join(' ')
}

export function discoveryLabel(node: MapNode): string {
  return node.recommendation ? `Suggested ${node.recommendation.kind}` : node.spotifyAlbumId ? 'Curated Spotify pick' : 'Demo discovery'
}
