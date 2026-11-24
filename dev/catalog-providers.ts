import { setTimeout as delay } from 'node:timers/promises'
import { recordingTitleKey } from '../src/domain/history.ts'
import { catalogMbid, maxCatalogCredits, maxCatalogTracks, safeCatalogUrl } from '../src/domain/public-chart.ts'
import type { CatalogArt, LegacySongSuggestion, PublicEntry, PublicRecommendation } from '../src/domain/public-chart.ts'

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const objects = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 256) : ''
const compareName = (value: unknown) => text(value).normalize('NFC').toLowerCase()
const id = (value: unknown): value is string => typeof value === 'string' && catalogMbid.test(value)
const quote = (value: string) => '"' + value.replace(/["\\]/g, '\\$&') + '"'

function imageUrl(value: unknown) {
  if (typeof value !== 'string') return
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:') parsed.protocol = 'https:'
    if (parsed.hostname === 'thumb.wikimedia.org' || parsed.hostname === 'upload.wikimedia.org') {
      for (const key of ['utm_source', 'utm_campaign', 'utm_content']) parsed.searchParams.delete(key)
    }
    if (safeCatalogUrl(parsed.href, 'image')) return parsed.href
  } catch { return }
}

const requests = new Map<string, { ok: number; failed: number }>()
let musicBrainzStart = 0
const headers = { Accept: 'application/json', 'User-Agent': 'ListeningMap/0.1 (personal listening chart catalog review)' }

async function paceMusicBrainz() {
  await delay(Math.max(0, musicBrainzStart + 1550 - Date.now()))
  musicBrainzStart = Date.now()
}

async function json(host: string, path: string, params?: URLSearchParams, retries = 1): Promise<JsonObject> {
  const url = new URL(path, `https://${host}`)
  if (params) url.search = params.toString()
  if (host === 'musicbrainz.org') {
    await paceMusicBrainz()
  }
  const summary = requests.get(host) ?? { ok: 0, failed: 0 }
  requests.set(host, summary)
  try {
    let result = await fetch(url, { headers, signal: AbortSignal.timeout(9000), redirect: 'manual' })
    for (let redirects = 0; host === 'coverartarchive.org' && result.status >= 300 && result.status < 400 && redirects < 3; redirects++) {
      const location = result.headers.get('location')
      await result.body?.cancel()
      if (!location) break
      const destination = new URL(location, result.url)
      if (destination.protocol !== 'https:' && destination.protocol !== 'http:') break
      if (destination.hostname !== 'archive.org' && !destination.hostname.endsWith('.archive.org')) break
      if (destination.username || destination.password || destination.port) break
      destination.protocol = 'https:'
      result = await fetch(destination, { headers, signal: AbortSignal.timeout(9000), redirect: 'manual' })
    }
    if (host === 'musicbrainz.org' && [429, 503].includes(result.status) && retries > 0) {
      await result.body?.cancel()
      summary.failed++
      const retryAfter = Number(result.headers.get('Retry-After'))
      await delay(Math.max(2200, Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 15_000)))
      return json(host, path, params, retries - 1)
    }
    if (!result.ok) { await result.body?.cancel(); summary.failed++; return {} }
    const value: unknown = await result.json()
    summary.ok++
    return object(value)
  } catch {
    summary.failed++
    return {}
  }
}

export const providerSummary = () => Object.fromEntries(requests)

function brainz(path: string, parameters: Record<string, string> = {}) {
  return json('musicbrainz.org', '/ws/2/' + path, new URLSearchParams({ fmt: 'json', ...parameters }))
}

async function coverArt(mbid: string): Promise<CatalogArt | undefined> {
  const cover = await json('coverartarchive.org', `/release-group/${mbid}`)
  const front = objects(cover.images).find((image) => image.front === true && image.approved === true)
  if (!front) return
  const image = imageUrl(object(front.thumbnails)['250'] || object(front.thumbnails).small)
  if (!image) return
  return { url: image, credit: 'Cover Art Archive', source: `https://musicbrainz.org/release-group/${mbid}` }
}

export async function addCatalogTracklist(entry: PublicEntry) {
  if (!entry.artist || !entry.artwork || (entry.catalogTracks && entry.creditedArtists)) return
  const cover = new URL(entry.artwork.url)
  const release = cover.hostname === 'coverartarchive.org' ? cover.pathname.split('/')[2] : undefined
  if (!id(release) || !cover.pathname.startsWith('/release/')) return
  const data = await brainz(`release/${release}`, { inc: 'recordings+artist-credits+release-groups' })
  applyMusicBrainzRelease(entry, data)
}

export function applyMusicBrainzRelease(entry: PublicEntry, data: JsonObject) {
  if (compareName(data.title) !== compareName(entry.name) && compareName(object(data['release-group']).title) !== compareName(entry.name)) return
  const names = (credits: unknown) => objects(credits).flatMap((credit) =>
    [text(credit.name), text(object(credit.artist).name)].filter(Boolean))
  const releaseArtists = names(data['artist-credit'])
  if (!entry.artist || (releaseArtists.length && !releaseArtists.some((artist) => compareName(artist) === compareName(entry.artist)))) return
  const mediaTracks = objects(data.media).flatMap((disc) => objects(disc.tracks))
  const tracks = mediaTracks.map((track) => text(track.title || object(track.recording).title))
  if (tracks.length && tracks.length <= maxCatalogTracks && tracks.every(Boolean)) entry.catalogTracks = tracks
  if (!mediaTracks.length) return
  const credits = [...new Set([...releaseArtists, ...mediaTracks.flatMap((track) =>
    [...names(track['artist-credit']), ...names(object(track.recording)['artist-credit'])])])]
  if (credits.length && credits.length <= maxCatalogCredits) entry.creditedArtists = credits
}

export function exactMusicBrainzMatch(entry: PublicEntry, results: unknown) {
  const matches = objects(results).filter((item) => {
    if (!id(item.id) || compareName(item[entry.artist ? 'title' : 'name']) !== compareName(entry.name)) return false
    return !entry.artist || objects(item['artist-credit']).some((credit) =>
      [credit.name, object(credit.artist).name].some((name) => compareName(name) === compareName(entry.artist)))
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function applyMusicBrainzGenres(entry: PublicEntry, values: unknown, vocabulary?: ReadonlySet<string>) {
  const votes = new Map<string, number>()
  for (const item of objects(values)) {
    const name = compareName(item.name)
    if (name && (!vocabulary || vocabulary.has(name)) && typeof item.count === 'number' && Number.isSafeInteger(item.count) && item.count > 0) {
      votes.set(name, Math.max(votes.get(name) ?? 0, item.count))
    }
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4)
  if (!ranked.length) return false
  entry.genres = ranked.map(([name]) => name)
  entry.primaryGenre = ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : undefined
  return true
}

function searchMusicBrainz(entry: PublicEntry) {
  const type = entry.artist ? 'release-group' : 'artist'
  const query = entry.artist ? `releasegroup:${quote(entry.name)} AND artistname:${quote(entry.artist)}` : `artist:${quote(entry.name)}`
  return brainz(type + '/', { query, limit: '12' }).then((result) => result[entry.artist ? 'release-groups' : 'artists'])
}

export async function lookupMusicBrainzArtist(entry: PublicEntry) {
  const results = await searchMusicBrainz(entry)
  const mbid = exactMusicBrainzMatch(entry, results)?.id
  return { failed: !Array.isArray(results), mbid: id(mbid) ? mbid.toLowerCase() : undefined }
}

export async function musicBrainzGenreVocabulary() {
  await paceMusicBrainz()
  const response = await fetch('https://musicbrainz.org/ws/2/genre/all?fmt=txt', {
    headers: { ...headers, Accept: 'text/plain' }, signal: AbortSignal.timeout(12_000), redirect: 'error',
  })
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/plain')) throw new Error('Genre vocabulary unavailable.')
  const names = await response.text()
  if (names.length > 128_000) throw new Error('Invalid genre vocabulary.')
  const vocabulary = new Set(names.split(/\r?\n/).map(compareName).filter(Boolean))
  if (vocabulary.size < 100) throw new Error('Invalid genre vocabulary.')
  return vocabulary
}

export async function enrichCatalogGenre(entry: PublicEntry, vocabulary: ReadonlySet<string>) {
  const results = await searchMusicBrainz(entry)
  if (!Array.isArray(results)) return 'unavailable'
  const match = exactMusicBrainzMatch(entry, results)
  return match && applyMusicBrainzGenres(entry, match.tags, vocabulary) ? 'tagged' : 'unmatched'
}

export async function enrichCatalogEntry(entry: PublicEntry): Promise<string | undefined> {
  const type = entry.artist ? 'release-group' : 'artist'
  const match = exactMusicBrainzMatch(entry, await searchMusicBrainz(entry))
  const mbid = match?.id
  if (!id(mbid)) return
  const detail = await brainz(`${type}/${mbid}`, { inc: 'genres' })
  applyMusicBrainzGenres(entry, detail.genres)
  if (entry.artist) entry.artwork = await coverArt(mbid) ?? entry.artwork
  else entry.artistMbid = mbid.toLowerCase()
  return mbid
}

export async function discoveryRecordings(seed: string, mbid: string) {
  const radio = await json('api.listenbrainz.org', `/1/lb-radio/artist/${mbid}`, new URLSearchParams({
    mode: 'medium', max_similar_artists: '8', max_recordings_per_artist: '3', pop_begin: '0', pop_end: '100',
  }))
  const candidates = [...new Set(Object.values(radio).flatMap(objects).flatMap((result) => id(result.recording_mbid) ? [result.recording_mbid] : []))]
  return candidates.map((recording) => ({ seed, recording }))
}

export async function catalogRecommendations(recordings: Pick<LegacySongSuggestion, 'seed' | 'recording'>[], catalog: PublicEntry[]): Promise<PublicRecommendation[]> {
  const artistKeys = new Set(catalog.filter((item) => !item.artist).map((item) => recordingTitleKey(item.name)))
  const albumKey = (artist: string, name: string) => `${recordingTitleKey(artist)}/${recordingTitleKey(name)}`
  const albumKeys = new Set(catalog.filter((item) => item.artist).map((item) => albumKey(item.artist!, item.name)))
  const ids = [...new Set(recordings.map((item) => item.recording).filter(id))]
  const metadata = new Map<string, JsonObject>()
  for (let start = 0; start < ids.length; start += 40) {
    const page = await json('api.listenbrainz.org', '/1/metadata/recording/', new URLSearchParams({
      recording_mbids: ids.slice(start, start + 40).join(','), inc: 'artist release',
    }))
    for (const [mbid, item] of Object.entries(page)) if (id(mbid)) metadata.set(mbid, object(item))
  }
  const used = new Set<string>()
  const counts = new Map<string, number>()
  const picks: PublicRecommendation[] = []
  const add = (pick: PublicRecommendation) => {
    const key = `${pick.seed}/${pick.kind}`
    const identity = `${key}/${pick.mbid}`
    const count = counts.get(key) ?? 0
    if (count >= 4 || used.has(identity) || picks.length >= 96) return
    used.add(identity)
    counts.set(key, count + 1)
    picks.push(pick)
  }
  for (const { seed, recording } of recordings) {
    const details = metadata.get(recording)
    if (!details) continue
    const artist = object(details.artist)
    for (const credit of objects(artist.artists)) {
      const name = text(credit.name)
      if (id(credit.artist_mbid) && name && !artistKeys.has(recordingTitleKey(name))) {
        add({ kind: 'artist', mbid: credit.artist_mbid, title: name, seed })
      }
    }
    const release = object(details.release)
    const album = text(release.name)
    const albumArtist = text(release.album_artist_name) || text(artist.name)
    if (id(release.release_group_mbid) && album && albumArtist && !albumKeys.has(albumKey(albumArtist, album))) {
      add({ kind: 'album', mbid: release.release_group_mbid, title: album, artist: albumArtist, seed })
    }
  }
  return picks
}
