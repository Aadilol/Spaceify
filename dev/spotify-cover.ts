import { createHash } from 'node:crypto'
import { albumIdentity, artistIdentity } from '../src/domain/history.ts'
import { matchesArtwork, spotifyId } from '../src/domain/catalog-artwork.ts'
import type { CatalogArtworkMatch } from '../src/domain/catalog-artwork.ts'
import { isSpotifyArtwork, maxCatalogCredits, safeCatalogUrl } from '../src/domain/public-chart.ts'
import type { CatalogArt, PublicEntry } from '../src/domain/public-chart.ts'

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const spotifyCoverBatch = 60
const requestOptions = (signal?: AbortSignal) => ({
  redirect: 'error' as const,
  signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
})

function spotifyArtwork(id: unknown, images: unknown, kind: 'album' | 'artist'): CatalogArt | undefined {
  if (typeof id !== 'string' || !spotifyId.test(id) || !Array.isArray(images)) return
  const covers = images.filter((image: unknown): image is { url: string; width: number } =>
    record(image) && safeCatalogUrl(image.url, 'image') && new URL(image.url).hostname === 'i.scdn.co' &&
    typeof image.width === 'number' && Number.isFinite(image.width) && image.width > 0)
  covers.sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300))
  if (covers[0]) return { url: covers[0].url, source: 'https://open.spotify.com/' + kind + '/' + id, credit: 'Spotify' }
}

export function matchSpotifyCover(data: unknown, entry: PublicEntry): CatalogArt | undefined {
  if (!record(data) || !record(data.album) || !entry.artist) return
  const { id, name, artists, images } = data.album
  if (typeof name !== 'string' ||
    !Array.isArray(artists) || !artists.some((artist: unknown) => record(artist) && typeof artist.name === 'string' &&
      albumIdentity(artist.name, name) === albumIdentity(entry.artist!, entry.name))) return
  return spotifyArtwork(id, images, 'album')
}

export function spotifyCredentials() {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_MARKET: market = 'CA' } = process.env
  return id && /^[a-f\d]{32}$/i.test(id) && secret && /^[a-f\d]{32}$/i.test(secret) && /^[A-Z]{2}$/.test(market)
    ? { id, secret, market } : undefined
}

type Credentials = NonNullable<ReturnType<typeof spotifyCredentials>>

export async function getSpotifyToken(credentials: Credentials, request: typeof fetch, signal?: AbortSignal) {
  const { id, secret } = credentials
  const response = await request('https://accounts.spotify.com/api/token', {
    ...requestOptions(signal), method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('Spotify authentication unavailable.')
  }
  const token: unknown = await response.json()
  if (!record(token) || typeof token.access_token !== 'string' || !/^[a-z\d._~+/-]{1,2048}={0,2}$/i.test(token.access_token)) {
    throw new Error('Invalid Spotify token response.')
  }
  const lifetime = typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in > 5
    ? Math.min(3600, token.expires_in) - 5 : 3000
  return { header: 'Bearer ' + token.access_token, expires: Date.now() + lifetime * 1000 }
}

export function creditedSpotifyAlbum(entry: PublicEntry) {
  if (!entry.artist || entry.creditedArtists || !isSpotifyArtwork(entry.artwork)) return
  return /^https:\/\/open\.spotify\.com\/album\/([a-z\d]{22})$/i.exec(entry.artwork.source)?.[1]
}

export async function fetchSpotifyAlbumCredits(album: string, market: string, header: string, request: typeof fetch = fetch, signal?: AbortSignal) {
  if (!spotifyId.test(album) || !/^[A-Z]{2}$/.test(market)) throw new Error('Invalid catalog album.')
  const credits = new Set<string>()
  const limit = 50
  let offset = 0
  let count: number | undefined
  do {
    const url = new URL('https://api.spotify.com/v1/albums/' + album + '/tracks')
    url.search = new URLSearchParams({ market, limit: String(limit), offset: String(offset) }).toString()
    const response = await request(url, { ...requestOptions(signal), headers: { Authorization: header } })
    if (!response.ok) {
      await response.body?.cancel()
      return { status: response.status, retryAfter: response.headers.get('Retry-After') }
    }
    const page: unknown = await response.json()
    if (!record(page) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 1 || page.total > 1500 ||
      (count !== undefined && page.total !== count) || !Array.isArray(page.items) || page.items.length < 1 ||
      page.items.length > Math.min(limit, page.total - offset)) throw new Error('Invalid Spotify album tracks response.')
    count = page.total
    for (const track of page.items as unknown[]) {
      if (!record(track) || !Array.isArray(track.artists) || !track.artists.length) throw new Error('Invalid Spotify track credits.')
      for (const artist of track.artists as unknown[]) {
        if (!record(artist) || typeof artist.name !== 'string' || !artist.name.trim() || artist.name.length > 256) {
          throw new Error('Invalid Spotify artist credit.')
        }
        credits.add(artist.name.trim())
        if (credits.size > maxCatalogCredits) throw new Error('Too many Spotify artist credits.')
      }
    }
    offset += page.items.length
  } while (offset < count)
  return { status: 200, credits: [...credits] }
}

export async function fetchSpotifyArtwork(track: string, kind: 'album' | 'artist', market: string, header: string,
  request: typeof fetch, signal?: AbortSignal, artistName?: string) {
  const get = (path: string) => request('https://api.spotify.com/v1/' + path, { ...requestOptions(signal), headers: { Authorization: header } })
  const response = await get('tracks/' + track + '?market=' + market)
  if (!response.ok) return { response }
  const payload: unknown = await response.json()
  if (!record(payload) || !record(payload.album)) throw new Error('Invalid Spotify track response.')
  const album = payload.album
  const credits = (Array.isArray(album.artists) ? album.artists : []).filter((item: unknown): item is { name: string; id?: string } =>
    record(item) && typeof item.name === 'string')
  if (kind === 'album') {
    const art = spotifyArtwork(album.id, album.images, 'album')
    const match: CatalogArtworkMatch | undefined = art && typeof album.name === 'string'
      ? { name: album.name, artists: credits.map((credit) => credit.name), art } : undefined
    return { response, match }
  }
  const credit = artistName ? credits.find((candidate) => artistIdentity(candidate.name) === artistIdentity(artistName)) :
    credits.length === 1 ? credits[0] : undefined
  if (typeof credit?.id !== 'string' || !spotifyId.test(credit.id)) return { response }
  const artistResponse = await get('artists/' + credit.id)
  if (!artistResponse.ok) return { response: artistResponse }
  const artist: unknown = await artistResponse.json()
  if (!record(artist)) throw new Error('Invalid Spotify artist response.')
  const art = artist.id === credit.id ? spotifyArtwork(artist.id, artist.images, 'artist') : undefined
  const match: CatalogArtworkMatch | undefined = art && typeof artist.name === 'string' ? { name: artist.name, art } : undefined
  return { response: artistResponse, match }
}

interface CoverRun {
  limit?: number
  misses?: Map<string, number>
  signal?: AbortSignal
  pace?: () => Promise<void>
  checkpoint?: (stats: CoverStats) => Promise<void>
}

interface CoverStats {
  spotifyCoversAdded: number
  spotifyEntriesChecked: number
  spotifyEntriesRemaining: number
  spotifyEntriesUnmatched: number
  spotifyLookupInterrupted: boolean
  spotifyStopReason?: 'cancelled' | 'rate-limited' | 'access-denied' | 'request-failed'
  spotifyRetryAfterSeconds?: number
}

export async function addSpotifyCovers(entries: PublicEntry[], artworkTracks: ReadonlyMap<string, string>,
  credentials: Credentials, request: typeof fetch = fetch, options: CoverRun = {}) {
  const { market } = credentials
  const { limit = spotifyCoverBatch, misses, signal, pace, checkpoint } = options
  const queue = entries.flatMap((entry) => {
    if (entry.artwork) return []
    const identity = entry.artist ? albumIdentity(entry.artist, entry.name) : artistIdentity(entry.name)
    const track = artworkTracks.get(identity)
    if (!track || !spotifyId.test(track)) return []
    const key = createHash('sha256').update(JSON.stringify([market, track, identity])).digest('hex')
    return misses?.has(key) ? [] : [{ entry, track, key }]
  })
  const stats: CoverStats = {
    spotifyCoversAdded: 0, spotifyEntriesChecked: 0, spotifyEntriesRemaining: queue.length,
    spotifyEntriesUnmatched: 0, spotifyLookupInterrupted: false,
  }
  let token: Awaited<ReturnType<typeof getSpotifyToken>> | undefined
  for (const { entry, track, key } of queue) {
    if (stats.spotifyEntriesChecked >= limit) break
    if (signal?.aborted) { stats.spotifyStopReason = 'cancelled'; break }
    let matched: CatalogArt | undefined
    try {
      if (stats.spotifyEntriesChecked > 0) await pace?.()
      if (!token || token.expires <= Date.now()) token = await getSpotifyToken(credentials, request, signal)
      stats.spotifyEntriesChecked++
      const { response, match } = await fetchSpotifyArtwork(track, entry.artist ? 'album' : 'artist', market, token.header, request, signal, entry.artist ? undefined : entry.name)
      if (response.ok) {
        if (match && matchesArtwork(match, entry.name, entry.artist)) matched = match.art
      } else {
        await response.body?.cancel()
        if (response.status !== 404) {
          stats.spotifyStopReason = response.status === 429 ? 'rate-limited' :
            response.status === 401 || response.status === 403 ? 'access-denied' : 'request-failed'
          const seconds = Number(response.headers.get('Retry-After') ?? NaN)
          if (response.status === 429 && Number.isSafeInteger(seconds) && seconds >= 0) stats.spotifyRetryAfterSeconds = seconds
          break
        }
      }
    } catch {
      stats.spotifyStopReason = signal?.aborted ? 'cancelled' : 'request-failed'
      break
    }
    if (matched) {
      entry.artwork = matched
      stats.spotifyCoversAdded++
    } else {
      misses?.set(key, Date.now())
      stats.spotifyEntriesUnmatched++
    }
    stats.spotifyEntriesRemaining--
    if (stats.spotifyEntriesRemaining && stats.spotifyEntriesChecked < limit && stats.spotifyEntriesChecked % spotifyCoverBatch === 0) {
      await checkpoint?.(stats)
    }
  }
  stats.spotifyLookupInterrupted = stats.spotifyStopReason !== undefined
  return stats
}
