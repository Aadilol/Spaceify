import type { View } from '../graph/model.ts'
import { firstSupportedYear, lastSupportedYear, maxHistoryRows } from '../import/history-json.ts'

export const publicChartFile = 'owner-chart.json'
export const draftChartPath = '/__listening-map/owner-draft'
export const maxPublicChartBytes = 32 * 1024 * 1024
export const minutesPerBand = 30
export const maxCatalogTracks = 150
export const maxCatalogCredits = 512
export const maxSimilarArtists = 18
export const listenBrainzArtDirectory = 'artist-art'
export const listenBrainzArtCredit = 'ListenBrainz · Cover Art Archive'

export interface CatalogArt {
  url: string
  credit: string
  source: string
}

export interface PublicEntry {
  id: string
  name: string
  artist?: string
  genres?: string[]
  primaryGenre?: string
  artwork?: CatalogArt
  exploreArtwork?: true
  catalogTracks?: string[]
  creditedArtists?: string[]
  playedTitles?: string[]
  artistMbid?: string
  similarArtists?: SimilarArtist[]
}

export interface SimilarArtist { mbid: string; name: string; score: number }

export interface LegacySongSuggestion {
  recording: string
  title: string
  artist: string
  seed: string
}

export interface PublicRecommendation {
  kind: 'artist' | 'album'
  mbid: string
  title: string
  artist?: string
  seed: string
}

export interface PublicChart {
  version: 1
  years: number[]
  catalog: PublicEntry[]
  charts: Record<View, Record<number, { id: string; band: number }[]>>
  throughRanks?: Record<View, Record<number, string[]>>
  suggestions: (LegacySongSuggestion | PublicRecommendation)[]
}

export const catalogMbid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i
const listenBrainzArtist = /^https:\/\/listenbrainz\.org\/artist\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/$/
export const isListenBrainzArt = (art: CatalogArt): boolean => {
  const mbid = listenBrainzArtist.exec(art.source)?.[1]
  return Boolean(mbid && art.credit === listenBrainzArtCredit && art.url === `./${listenBrainzArtDirectory}/${mbid}.svg`)
}
const id = /^(album|artist)-[1-9]\d{0,5}$/
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key))
const isMbid = (value: unknown): value is string => typeof value === 'string' && catalogMbid.test(value)

export function isSimilarArtist(value: unknown): value is SimilarArtist {
  return record(value) && only(value, ['mbid', 'name', 'score']) && isMbid(value.mbid) &&
    text(value.name) && !/[\p{Cc}\p{Bidi_Control}]/u.test(value.name) &&
    integer(value.score, 1, 2_147_483_647)
}

export function safeCatalogUrl(input: unknown, kind: 'image' | 'credit'): input is string {
  if (typeof input !== 'string' || input.length > 2048) return false
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false
    const host = url.hostname
    if (kind === 'image') {
      if (host === 'upload.wikimedia.org' || host === 'thumb.wikimedia.org') return /^\/wikipedia\/commons\/.+/i.test(url.pathname)
      if (host === 'coverartarchive.org') return /^\/release(?:-group)?\/[a-f\d-]+\/(?:front(?:-250)?|\d+(?:-250)?\.jpg)$/i.test(url.pathname)
      if (host === 'archive.org') return /^\/download\/mbid-[a-f\d-]+\//i.test(url.pathname)
      if (host === 'i.scdn.co') return /^\/image\/[a-f\d]+$/i.test(url.pathname)
      return false
    }
    return (host === 'commons.wikimedia.org' && /^\/wiki\/File:/i.test(url.pathname)) ||
      (host === 'creativecommons.org' && /^\/(licenses|publicdomain)\//.test(url.pathname)) ||
      (host === 'musicbrainz.org' && /^\/(artist|release-group)\/[a-f\d-]+$/i.test(url.pathname)) ||
      (host === 'open.spotify.com' && /^\/(?:album|artist)\/[a-z\d]{22}$/i.test(url.pathname))
  } catch { return false }
}

export function isCatalogArt(value: unknown): value is CatalogArt {
  if (!record(value) || !only(value, ['url', 'credit', 'source']) || !text(value.credit) ||
    typeof value.url !== 'string' || typeof value.source !== 'string') return false
  if (isListenBrainzArt({ url: value.url, source: value.source, credit: value.credit })) return true
  if (!safeCatalogUrl(value.url, 'image') || !safeCatalogUrl(value.source, 'credit')) return false
  const spotify = new URL(value.url).hostname === 'i.scdn.co'
  return spotify === (new URL(value.source).hostname === 'open.spotify.com') && (!spotify || value.credit === 'Spotify')
}

export const isSpotifyArtwork = (art?: CatalogArt): art is CatalogArt & { credit: 'Spotify' } =>
  art?.credit === 'Spotify' && /^https:\/\/open\.spotify\.com\/(?:artist|album)\//.test(art.source)

function isEntry(value: unknown): value is PublicEntry {
  if (!record(value) || !only(value, ['id', 'name', 'artist', 'genres', 'primaryGenre', 'artwork', 'exploreArtwork', 'catalogTracks', 'creditedArtists', 'playedTitles', 'artistMbid', 'similarArtists']) ||
    typeof value.id !== 'string' || !id.test(value.id) || !text(value.name) ||
    (value.id.startsWith('album-') ? !text(value.artist) : value.artist !== undefined)) return false
  const { genres, primaryGenre, artwork, catalogTracks, playedTitles } = value
  const { creditedArtists } = value
  if (value.artistMbid !== undefined && (value.artist !== undefined || !isMbid(value.artistMbid))) return false
  if (value.similarArtists !== undefined) {
    if (!isMbid(value.artistMbid) || !Array.isArray(value.similarArtists) || value.similarArtists.length > maxSimilarArtists) return false
    const seen = new Set([value.artistMbid.toLowerCase()])
    for (const row of value.similarArtists) {
      if (!isSimilarArtist(row) || seen.has(row.mbid.toLowerCase())) return false
      seen.add(row.mbid.toLowerCase())
    }
  }
  if (value.exploreArtwork !== undefined && value.exploreArtwork !== true) return false
  if (creditedArtists !== undefined && (!value.id.startsWith('album-') || !Array.isArray(creditedArtists) ||
    creditedArtists.length < 1 || creditedArtists.length > maxCatalogCredits || !creditedArtists.every(text))) return false
  if (genres !== undefined && (!Array.isArray(genres) || genres.length > 4 || !genres.every(text))) return false
  if (catalogTracks !== undefined && (!value.id.startsWith('album-') || !Array.isArray(catalogTracks) ||
    catalogTracks.length < 1 || catalogTracks.length > maxCatalogTracks || !catalogTracks.every(text))) return false
  if (playedTitles !== undefined && (!value.id.startsWith('album-') || !Array.isArray(playedTitles) ||
    playedTitles.length < 1 || playedTitles.length > maxHistoryRows || !playedTitles.every(text))) return false
  return (primaryGenre === undefined || (typeof primaryGenre === 'string' && Array.isArray(genres) && genres.includes(primaryGenre))) &&
    (artwork === undefined || (isCatalogArt(artwork) && (!isListenBrainzArt(artwork) || !value.artist) && (!isSpotifyArtwork(artwork) ||
      artwork.source.startsWith(value.artist ? 'https://open.spotify.com/album/' : 'https://open.spotify.com/artist/'))))
}

export function isPublicChart(value: unknown): value is PublicChart {
  if (!record(value) || !only(value, ['version', 'years', 'catalog', 'charts', 'throughRanks', 'suggestions']) || value.version !== 1 ||
    !Array.isArray(value.years) || value.years.length < 1 || value.years.length > lastSupportedYear - firstSupportedYear + 1 ||
    !Array.isArray(value.catalog) || value.catalog.length < 1 || value.catalog.length > maxHistoryRows * 2 ||
    !record(value.charts) || !only(value.charts, ['Artist', 'Album']) ||
    !Array.isArray(value.suggestions) || value.suggestions.length > 96) return false
  const through = value.throughRanks
  if (through !== undefined && (!record(through) || !only(through, ['Artist', 'Album']))) return false
  const years: unknown[] = value.years
  if (!years.every((year, index) => integer(year, firstSupportedYear, lastSupportedYear) && (index === 0 || year === Number(years[index - 1]) + 1))) return false
  const catalog = new Set<string>()
  for (const entry of value.catalog as unknown[]) {
    if (!isEntry(entry) || catalog.has(entry.id)) return false
    catalog.add(entry.id)
  }
  const used = new Set<string>()
  for (const view of ['Artist', 'Album'] as const) {
    const chart = value.charts[view]
    if (!record(chart) || Object.keys(chart).length !== years.length) return false
    const rankings = through?.[view]
    if (through && (!record(rankings) || Object.keys(rankings).length !== years.length)) return false
    const known = new Set<string>()
    for (const year of years) {
      const rows = chart[String(year)]
      if (!Array.isArray(rows) || rows.length > maxHistoryRows) return false
      const rowIds = new Set<string>()
      for (const row of rows as unknown[]) {
        if (!record(row) || !only(row, ['id', 'band']) || typeof row.id !== 'string' ||
          !row.id.startsWith(view.toLowerCase() + '-') || !catalog.has(row.id) || rowIds.has(row.id) || !integer(row.band, 0, 17_568)) return false
        rowIds.add(row.id)
        known.add(row.id)
        used.add(row.id)
      }
      if (record(rankings)) {
        const order = rankings[String(year)]
        if (!Array.isArray(order) || order.length !== known.size || new Set(order).size !== known.size ||
          !order.every((item) => typeof item === 'string' && known.has(item))) return false
      }
    }
  }
  if (used.size !== catalog.size) return false
  const pairs = new Set<string>()
  for (const suggestion of value.suggestions as unknown[]) {
    if (!record(suggestion) || !text(suggestion.title) || typeof suggestion.seed !== 'string' ||
      !suggestion.seed.startsWith('artist-') || !catalog.has(suggestion.seed)) return false
    const legacy = suggestion.kind === undefined && only(suggestion, ['recording', 'title', 'artist', 'seed']) && text(suggestion.artist)
    const typed = (suggestion.kind === 'artist' || suggestion.kind === 'album') && only(suggestion, ['kind', 'mbid', 'title', 'artist', 'seed']) &&
      (suggestion.kind === 'album' ? text(suggestion.artist) : suggestion.artist === undefined)
    const mbid = typed ? suggestion.mbid : legacy ? suggestion.recording : undefined
    if (typeof mbid !== 'string' || !catalogMbid.test(mbid)) return false
    const key = `${suggestion.seed}/${suggestion.kind ?? 'song'}/${mbid}`
    if (pairs.has(key)) return false
    pairs.add(key)
  }
  return true
}
