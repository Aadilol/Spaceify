import { albumIdentity, artistIdentity } from './history.ts'
import type { ListeningGraph, View } from '../graph/model.ts'
import { isCatalogArt, isSpotifyArtwork } from './public-chart.ts'
import type { CatalogArt } from './public-chart.ts'

export const catalogArtworkPath = '/__listening-map/catalog-artwork'
export const spotifyId = /^[A-Za-z0-9]{22}$/
export const artworkIdentity = (name: string, artist?: string) => artist ? albumIdentity(artist, name) : artistIdentity(name)

export function exploreArtworkIds(view: View, annualGraphs: readonly ListeningGraph[]): ReadonlySet<string> {
  const minimumMs = (view === 'Album' ? 2 : 4) * 3_600_000
  const totals = new Map<string, number>()
  for (const graph of annualGraphs) {
    for (const node of graph.nodes) {
      if (node.kind === 'listened') totals.set(node.id, (totals.get(node.id) ?? 0) + Math.round(node.minutes * 60_000))
    }
  }
  return new Set([...totals].filter(([, total]) => total > minimumMs).map(([id]) => id))
}

export interface ArtworkLookup {
  track: string
  kind: 'album' | 'artist'
}

export interface CatalogArtworkMatch {
  name: string
  artists?: string[]
  art: CatalogArt
}

export function isArtworkLookup(value: unknown): value is ArtworkLookup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 2 && typeof item.track === 'string' && spotifyId.test(item.track) &&
    (item.kind === 'album' || item.kind === 'artist')
}

export function isArtworkMatch(value: unknown): value is CatalogArtworkMatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { name, art, artists } = value as Record<string, unknown>
  return typeof name === 'string' && name.length > 0 && name.length <= 256 &&
    isCatalogArt(art) && isSpotifyArtwork(art) &&
    (artists === undefined ? art.source.startsWith('https://open.spotify.com/artist/') :
      art.source.startsWith('https://open.spotify.com/album/') && Array.isArray(artists) && artists.length <= 32 &&
      artists.every((artist) => typeof artist === 'string' && artist.length > 0 && artist.length <= 256))
}

export function matchesArtwork(match: CatalogArtworkMatch, name: string, artist?: string) {
  return artist ? match.artists?.some((credit) => albumIdentity(credit, match.name) === albumIdentity(artist, name)) === true :
    match.artists === undefined && artistIdentity(match.name) === artistIdentity(name)
}
