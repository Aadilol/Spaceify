import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { isListenBrainzArt, isPublicChart, isSpotifyArtwork, listenBrainzArtDirectory, maxPublicChartBytes, publicChartFile } from '../src/domain/public-chart.ts'
import type { PublicChart } from '../src/domain/public-chart.ts'
import { maxHistoryRows } from '../src/import/history-json.ts'
import { readHistoryDirectory } from './private-history.ts'
import { buildPublicChart } from './build-public-chart.ts'
import { addCatalogTracklist, catalogRecommendations, discoveryRecordings, enrichCatalogEntry, enrichCatalogGenre, lookupMusicBrainzArtist, musicBrainzGenreVocabulary, providerSummary } from './catalog-providers.ts'
import { addSpotifyCovers, creditedSpotifyAlbum, fetchSpotifyAlbumCredits, getSpotifyToken, spotifyCoverBatch, spotifyCredentials } from './spotify-cover.ts'
import { ownerArtworkOrder } from './artwork-priority.ts'
import { artistGridArtwork, fetchListenBrainzGrid, maxArtistGridBytes } from './listenbrainz-artwork.ts'
import { fetchListenBrainzSimilarArtists, validListenBrainzContact } from './listenbrainz.ts'

const folder = '.owner-review'
const missLifetime = 7 * 24 * 60 * 60 * 1000

function spotifyLimit(args: string[]) {
  const option = args.filter((arg) => arg === '--spotify-limit' || arg.startsWith('--spotify-limit='))
  if (option.length === 0) return spotifyCoverBatch
  if (option.length !== 1 || !args.includes('--spotify-art')) return
  const value = option[0].slice('--spotify-limit='.length)
  if (value === 'all') return Infinity
  return /^[1-9]\d*$/.test(value) && Number(value) <= maxHistoryRows ? Number(value) : undefined
}

async function loadLookupMisses(file: string) {
  const misses = new Map<string, number>()
  const handle = await open(file, 'r').catch(() => undefined)
  if (!handle) return misses
  try {
    if ((await handle.stat()).size > maxHistoryRows * 85 + 2) return misses
    const saved: unknown = JSON.parse(await handle.readFile('utf8'))
    if (!Array.isArray(saved) || saved.length > maxHistoryRows) return misses
    const now = Date.now()
    for (const row of saved) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !/^[a-f\d]{64}$/.test(row[0]) ||
        !Number.isSafeInteger(row[1]) || row[1] > now || row[1] <= now - missLifetime) continue
      misses.set(row[0], row[1])
    }
  } catch {
    // The miss list is optional. An unreadable list can be rebuilt.
  } finally {
    await handle.close()
  }
  return misses
}

async function saveJson(file: string, data: string) {
  const temporary = file + '.tmp'
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, file)
}

async function saveDraft(file: string, draft: PublicChart) {
  for (const album of draft.catalog) if (album.catalogTracks?.length) delete album.playedTitles
  const data = JSON.stringify(draft)
  if (Buffer.byteLength(data) > maxPublicChartBytes || !isPublicChart(JSON.parse(data))) throw new Error('The chart exceeds its publication schema.')
  await saveJson(file, data)
}

function listenBrainzContact() {
  try { loadEnvFile('.env.listenbrainz.local') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const contact = process.env.LISTENBRAINZ_CONTACT?.trim()
  if (contact && validListenBrainzContact(contact)) return contact
  console.error('Set LISTENBRAINZ_CONTACT to a maintainer email or HTTPS contact URL.')
  process.exitCode = 1
}

async function refreshArtistSimilarity(path: string, file: string, signal?: AbortSignal) {
  const contact = listenBrainzContact()
  if (!contact) return
  const option = process.argv.find((arg) => arg.startsWith('--similarity-limit='))?.slice('--similarity-limit='.length) ?? '30'
  const limit = Number(option)
  if (!/^[1-9]\d*$/.test(option) || !Number.isSafeInteger(limit) || limit > maxHistoryRows) throw new Error('Invalid artist similarity limit.')
  const draft: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isPublicChart(draft)) throw new Error('The existing review draft is invalid.')
  const retryPath = join(path, 'listenbrainz-similarity-retry.json')
  const retryAt = Number(await readFile(retryPath, 'utf8').catch(() => '0'))
  if (Number.isSafeInteger(retryAt) && retryAt > Date.now()) {
    console.log(`ListenBrainz similarity requests can resume in ${Math.ceil((retryAt - Date.now()) / 1000)} seconds.`)
    return
  }
  const missPath = join(path, 'listenbrainz-similarity-misses.json')
  const misses = await loadLookupMisses(missPath)
  const catalog = new Map(draft.catalog.filter((entry) => !entry.artist).map((entry) => [entry.id, entry]))
  const order = new Set([...ownerArtworkOrder(draft), ...catalog.keys()])
  let checked = 0
  let added = 0
  let matchingFailures = 0
  let lastRequest = -Infinity
  let stopped: string | undefined
  const save = async () => {
    await saveDraft(file, draft)
    await saveJson(missPath, JSON.stringify([...misses]))
  }
  for (const id of order) {
    if (signal?.aborted || checked >= limit) break
    const entry = catalog.get(id)
    if (!entry || entry.similarArtists) continue
    const digest = createHash('sha256').update(JSON.stringify(entry.name)).digest('hex')
    if (misses.has(digest)) continue
    checked++
    const lookup = entry.artistMbid ? { mbid: entry.artistMbid, failed: false } : await lookupMusicBrainzArtist(entry)
    if (lookup.failed) {
      if (++matchingFailures >= 3) { stopped = 'MusicBrainz lookup unavailable'; break }
      continue
    }
    matchingFailures = 0
    if (!lookup.mbid) misses.set(digest, Date.now())
    else if (!signal?.aborted) {
      entry.artistMbid = lookup.mbid
      try {
        await delay(Math.max(0, 1100 - (performance.now() - lastRequest)), undefined, { signal })
        lastRequest = performance.now()
        const result = await fetchListenBrainzSimilarArtists(lookup.mbid, contact, fetch, signal)
        if (result.rows) {
          entry.similarArtists = result.rows
          added += Number(result.rows.length > 0)
        }
        if (result.cooldown) {
          await saveJson(retryPath, String(Date.now() + result.cooldown * 1000))
          stopped = `ListenBrainz quota reset in ${result.cooldown} seconds`
        } else if (!result.rows) stopped = `ListenBrainz similarity unavailable (HTTP ${result.status})`
      } catch {
        stopped = signal?.aborted ? 'Cancelled' : 'ListenBrainz similarity request failed or timed out'
      }
      if (stopped) break
    }
    if (checked % 10 === 0) await save()
  }
  await save()
  console.log('ListenBrainz artist similarity refresh', JSON.stringify({ checked, added,
    totalSeeds: [...catalog.values()].filter((entry) => entry.similarArtists?.length).length, stopped }))
}

async function refreshArtistArtwork(path: string, file: string, signal?: AbortSignal) {
  const contact = listenBrainzContact()
  if (!contact) return
  const option = process.argv.find((arg) => arg.startsWith('--artist-art-limit='))?.slice('--artist-art-limit='.length) ?? '30'
  const limit = Number(option)
  if (!/^[1-9]\d*$/.test(option) || !Number.isSafeInteger(limit) || limit > maxHistoryRows) throw new Error('Invalid artist artwork limit.')
  const draft: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isPublicChart(draft)) throw new Error('The existing review draft is invalid.')

  const retryPath = join(path, 'listenbrainz-art-retry.json')
  const retryAt = Number(await readFile(retryPath, 'utf8').catch(() => '0'))
  if (Number.isSafeInteger(retryAt) && retryAt > Date.now()) {
    console.log(`ListenBrainz requests can resume in ${Math.ceil((retryAt - Date.now()) / 1000)} seconds.`)
    return
  }
  const artPath = join(path, listenBrainzArtDirectory)
  await mkdir(artPath, { recursive: true })
  const missesPath = join(path, 'listenbrainz-art-misses.json')
  const misses = await loadLookupMisses(missesPath)
  const focus = ownerArtworkOrder(draft, false)
  const ordered = new Set([...focus, ...draft.catalog.filter((entry) => entry.exploreArtwork).map((entry) => entry.id)])
  const entries = new Map(draft.catalog.map((entry) => [entry.id, entry]))
  let checked = 0
  let added = 0
  let lastRequest = 0
  let stopped: string | undefined
  const saveProgress = async () => {
    await saveDraft(file, draft)
    await saveJson(missesPath, JSON.stringify([...misses]))
  }
  for (const id of ordered) {
    if (signal?.aborted || checked >= limit) break
    const entry = entries.get(id)!
    if (entry.artist || isSpotifyArtwork(entry.artwork)) continue
    const art = entry.artwork
    if (art && isListenBrainzArt(art)) {
      const cached = await stat(join(path, art.url)).catch(() => undefined)
      if (cached?.isFile() && cached.size > 0 && cached.size <= maxArtistGridBytes) continue
    }
    const digest = createHash('sha256').update(JSON.stringify(entry.name)).digest('hex')
    if (misses.has(digest)) continue
    checked++
    const { mbid, failed } = entry.artistMbid ? { mbid: entry.artistMbid, failed: false } : await lookupMusicBrainzArtist(entry)
    if (failed) { stopped = 'MusicBrainz lookup unavailable'; break }
    if (mbid && !signal?.aborted) {
      entry.artistMbid = mbid
      const artwork = artistGridArtwork(mbid)
      try {
        await delay(Math.max(0, 1100 - (Date.now() - lastRequest)), undefined, { signal })
        lastRequest = Date.now()
        const result = await fetchListenBrainzGrid(mbid, contact, fetch, signal)
        if (result.cooldown) {
          await saveJson(retryPath, String(Date.now() + result.cooldown * 1000))
          stopped = `ListenBrainz quota reset in ${result.cooldown} seconds`
        }
        if (result.image) {
          await saveJson(join(artPath, mbid + '.svg'), result.image)
          entry.artwork = artwork
          added++
        } else if (result.unavailable) stopped ??= 'ListenBrainz artwork temporarily unavailable'
        else misses.set(digest, Date.now())
      } catch {
        stopped = signal?.aborted ? 'Cancelled' : 'ListenBrainz artwork temporarily unavailable'
      }
      if (stopped) break
    } else if (!mbid) misses.set(digest, Date.now())
    if (checked % 10 === 0) await saveProgress()
  }
  await saveProgress()
  console.log('ListenBrainz artist artwork refresh', JSON.stringify({ checked, added, stopped }))
}

function loadSpotifyEnvironment() {
  try { loadEnvFile('.env.spotify.local') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function refreshAlbumCredits(file: string, signal?: AbortSignal) {
  const option = process.argv.find((arg) => arg.startsWith('--credit-limit='))?.slice('--credit-limit='.length) ?? '60'
  const limit = Number(option)
  if (!/^[1-9]\d*$/.test(option) || !Number.isSafeInteger(limit) || limit > maxHistoryRows) throw new Error('Invalid credit limit.')
  const draft: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isPublicChart(draft)) throw new Error('The existing review draft is invalid.')
  const entries = new Map(draft.catalog.map((entry) => [entry.id, entry]))
  const ranked = ownerArtworkOrder(draft).map((id) => entries.get(id)!)
  const storedCredits = () => draft.catalog.filter((entry) => entry.creditedArtists).length
  for (const entry of ranked) {
    if (signal?.aborted) break
    if (!entry.creditedArtists) await addCatalogTracklist(entry)
  }
  await saveDraft(file, draft)
  loadSpotifyEnvironment()
  const credentials = spotifyCredentials()
  const queue = ranked.flatMap((entry) => {
    const album = creditedSpotifyAlbum(entry)
    return album ? [{ entry, album }] : []
  })
  let token: Awaited<ReturnType<typeof getSpotifyToken>> | undefined
  let checked = 0
  let stop: string | undefined
  if (queue.length && !credentials) stop = 'Spotify credentials unavailable'
  if (credentials) {
    for (const { entry, album } of queue.slice(0, limit)) {
      if (signal?.aborted) break
      try {
        if (checked > 0) await delay(250, undefined, { signal })
        if (!token || token.expires <= Date.now()) token = await getSpotifyToken(credentials, fetch, signal)
        checked++
        const result = await fetchSpotifyAlbumCredits(album, credentials.market, token.header, fetch, signal)
        if ('credits' in result && result.credits) entry.creditedArtists = result.credits
        else if (result.status !== 404) {
          const retry = result.retryAfter && /^\d{1,10}$/.test(result.retryAfter) ? result.retryAfter : undefined
          stop = result.status === 429 ? (retry ? `Spotify rate limit, retry after ${retry} seconds` : 'Spotify rate limit') :
            `Spotify album credits failed with HTTP ${result.status}`
          break
        }
      } catch {
        stop = signal?.aborted ? 'Cancelled' : 'Spotify album credits temporarily unavailable'
        break
      }
      if (checked % 15 === 0) await saveDraft(file, draft)
    }
  }
  await saveDraft(file, draft)
  console.log('Catalog album credit refresh', JSON.stringify({ checked, albumsWithCredits: storedCredits(),
    spotifyPending: queue.filter(({ entry }) => !entry.creditedArtists).length, stop, providers: providerSummary() }))
}

async function refreshGenres(path: string, file: string, signal?: AbortSignal) {
  const option = process.argv.find((arg) => arg.startsWith('--genre-limit='))?.slice('--genre-limit='.length) ?? '90'
  const limit = Number(option)
  if (!/^[1-9]\d*$/.test(option) || !Number.isSafeInteger(limit) || limit > maxHistoryRows) {
    console.error('Use a positive entry count for --genre-limit.')
    process.exitCode = 1
    return
  }
  const draft: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isPublicChart(draft)) throw new Error('The existing review draft is invalid.')
  const missesPath = join(path, 'musicbrainz-genre-misses.json')
  const misses = await loadLookupMisses(missesPath)
  const catalog = new Map(draft.catalog.map((entry) => [entry.id, entry]))
  const candidates = ownerArtworkOrder(draft).flatMap((id) => {
    const entry = catalog.get(id)!
    if (entry.primaryGenre) return []
    const digest = createHash('sha256').update(JSON.stringify([entry.name, entry.artist])).digest('hex')
    return misses.has(digest) ? [] : [{ entry, digest }]
  })
  if (!candidates.length) { console.log('No pending MusicBrainz genre entries.'); return }
  const vocabulary = await musicBrainzGenreVocabulary()
  let checked = 0
  let tagged = 0
  let failures = 0
  const save = async () => {
    await saveDraft(file, draft)
    await saveJson(missesPath, JSON.stringify([...misses]))
  }
  for (const { entry, digest } of candidates.slice(0, limit)) {
    if (signal?.aborted) break
    const result = await enrichCatalogGenre(entry, vocabulary)
    checked++
    failures = result === 'unavailable' ? failures + 1 : 0
    if (result === 'tagged') tagged++
    if (result === 'unmatched' || (result === 'tagged' && !entry.primaryGenre)) misses.set(digest, Date.now())
    if (checked % 15 === 0) {
      await save()
      console.log('MusicBrainz genre progress:', JSON.stringify({ checked, tagged }))
    }
    if (failures >= 3) {
      console.error('MusicBrainz is temporarily unavailable. Saved matches can be resumed later.')
      process.exitCode = 1
      break
    }
  }
  await save()
  console.log('MusicBrainz genre refresh:', JSON.stringify({ checked, tagged }))
}

async function prepareDraft(path: string, signal?: AbortSignal) {
  const root = process.cwd()
  const file = join(path, publicChartFile)
  if (process.argv.includes('--listenbrainz-similarity')) {
    await refreshArtistSimilarity(path, file, signal)
    return
  }
  if (process.argv.includes('--listenbrainz-art')) {
    await refreshArtistArtwork(path, file, signal)
    return
  }
  if (process.argv.includes('--credits')) {
    await refreshAlbumCredits(file, signal)
    return
  }
  if (process.argv.includes('--genres')) {
    await refreshGenres(path, file, signal)
    return
  }
  if (process.argv.includes('--tracklists')) {
    const draft: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!isPublicChart(draft)) throw new Error('The existing review draft is invalid.')
    for (const entry of draft.catalog) await addCatalogTracklist(entry)
    await saveDraft(file, draft)
    console.log(`Album tracklists in the review draft: ${draft.catalog.filter((entry) => entry.catalogTracks).length}.`)
    return
  }
  const source = process.env.LISTENING_MAP_HISTORY_DIR
  if (!source) throw new Error('Set LISTENING_MAP_HISTORY_DIR first.')
  const online = process.argv.includes('--catalog')
  const upgradeRecommendations = process.argv.includes('--recommendations')
  const spotify = process.argv.includes('--spotify-art')
  const limit = spotifyLimit(process.argv.slice(2))
  if (limit === undefined) {
    console.error('Use --spotify-art with --spotify-limit=all or a positive album count.')
    process.exitCode = 1
    return
  }
  if (spotify) loadSpotifyEnvironment()
  const credentials = spotify ? spotifyCredentials() : undefined
  if (spotify && !credentials) {
    console.error('Set SPOTIFY_CLIENT_ID and a rotated SPOTIFY_CLIENT_SECRET locally, with a valid SPOTIFY_MARKET if specified.')
    process.exitCode = 1
    return
  }
  const artworkTracks = credentials ? new Map<string, string>() : undefined
  const history = await readHistoryDirectory(source, root, artworkTracks)
  if (signal?.aborted) return
  const draft = buildPublicChart(history, process.argv.includes('--include-played-titles'))
  const latest = draft.years[draft.years.length - 1]
  const catalog = new Map(draft.catalog.map((entry) => [entry.id, entry]))
  const previous: unknown = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'))
  if (isPublicChart(previous)) {
      const key = (name: string, artist?: string) => JSON.stringify([name, artist])
      const entries = new Map(previous.catalog.map((entry) => [key(entry.name, entry.artist), entry]))
      const seeds = new Map<string, string>()
      for (const entry of draft.catalog) {
        const match = entries.get(key(entry.name, entry.artist))
        if (!match) continue
        const { artwork, primaryGenre, genres, catalogTracks, creditedArtists, playedTitles, artistMbid, similarArtists } = match
        Object.assign(entry, { artwork, primaryGenre, genres, catalogTracks, creditedArtists, artistMbid, similarArtists })
        entry.playedTitles ??= playedTitles
        seeds.set(match.id, entry.id)
      }
      draft.suggestions = previous.suggestions.flatMap((pick) => {
        const seed = seeds.get(pick.seed)
        return seed ? [{ ...pick, seed }] : []
      })
  }
  const save = () => saveDraft(file, draft)
  await save()
  console.log(`Local review draft prepared for ${draft.years.length} years.`)
  if (credentials && artworkTracks) {
    const ranked = ownerArtworkOrder(draft)
    const missedFile = join(path, 'spotify-cover-misses.json')
    const misses = await loadLookupMisses(missedFile)
    const checkpoint = async () => {
      await save()
      await saveJson(missedFile, JSON.stringify([...misses]))
    }
    try {
      const stats = await addSpotifyCovers(ranked.map((id) => catalog.get(id)!), artworkTracks, credentials, fetch, {
        limit, misses, signal, pace: () => delay(250, undefined, { signal }),
        checkpoint: async ({ spotifyEntriesChecked, spotifyEntriesRemaining }) => {
          await checkpoint()
          console.log(`Saved Spotify artwork progress after ${spotifyEntriesChecked} lookups. ${spotifyEntriesRemaining} eligible entries remain.`)
        },
      })
      await checkpoint()
      console.log(JSON.stringify({
        ...stats, spotifyCoversInDraft: draft.catalog.filter((entry) => entry.artwork?.credit === 'Spotify').length,
      }))
      if (stats.spotifyStopReason === 'cancelled') return
      if (stats.spotifyLookupInterrupted) {
        process.exitCode = 1
        if (stats.spotifyStopReason === 'rate-limited') {
          console.log(stats.spotifyRetryAfterSeconds === undefined ? 'Spotify paused further requests. Re-run when the quota resets.' :
            `Spotify paused further requests. Wait at least ${stats.spotifyRetryAfterSeconds} seconds before resuming.`)
        }
      }
    } catch {
      console.error('Spotify artwork could not be refreshed. Check app access and credentials.')
      process.exitCode = 1
    }
  }
  if (upgradeRecommendations || online) {
    const legacy = draft.suggestions.filter((pick) => 'recording' in pick)
    const migrated = await catalogRecommendations(legacy, draft.catalog)
    const retained = draft.suggestions.filter((pick) => 'kind' in pick)
    if (migrated.length) {
      draft.suggestions = [...new Map([...retained, ...migrated]
        .filter((pick) => 'kind' in pick).map((pick) => [`${pick.seed}/${pick.kind}/${pick.mbid}`, pick])).values()].slice(0, 96)
    }
    await save()
    console.log(JSON.stringify({
      artistRecommendations: draft.suggestions.filter((pick) => 'kind' in pick && pick.kind === 'artist').length,
      albumRecommendations: draft.suggestions.filter((pick) => 'kind' in pick && pick.kind === 'album').length,
    }))
  }
  if (online) {
    const seeds: [string, string][] = []
    const artistRows = draft.charts.Artist[latest].slice(0, 16)
    for (const row of artistRows) {
      const entry = catalog.get(row.id)!
      const mbid = await enrichCatalogEntry(entry)
      if (mbid && seeds.length < 6) seeds.push([entry.id, mbid])
    }
    const recordings = []
    for (const [seed, mbid] of seeds) recordings.push(...await discoveryRecordings(seed, mbid))
    const recommendations = await catalogRecommendations(recordings, draft.catalog)
    if (recommendations.length) draft.suggestions = recommendations
    await save()
    console.log('Artist metadata and discovery saved to the local review draft.')
    for (const row of draft.charts.Album[latest].slice(0, 16)) {
      const entry = catalog.get(row.id)!
      await enrichCatalogEntry(entry)
      await addCatalogTracklist(entry)
    }
    await save()
    console.log(JSON.stringify({
      tagged: draft.catalog.filter((entry) => entry.primaryGenre).length,
      artwork: draft.catalog.filter((entry) => entry.artwork).length,
      candidates: draft.suggestions.length,
      providers: providerSummary(),
    }))
  }
}

async function prepare() {
  const path = join(process.cwd(), folder)
  await mkdir(path, { recursive: true })
  const lockPath = join(path, 'prepare.lock')
  const lock = await open(lockPath, 'wx').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  if (!lock) {
    console.error('The owner draft is locked. If no preparation is running, remove .owner-review/prepare.lock and retry.')
    process.exitCode = 1
    return
  }
  const controller = process.argv.some((arg) => ['--spotify-art', '--genres', '--credits', '--listenbrainz-art', '--listenbrainz-similarity'].includes(arg)) ? new AbortController() : undefined
  const stop = () => controller?.abort()
  if (controller) process.on('SIGINT', stop)
  try {
    await prepareDraft(path, controller?.signal)
  } finally {
    if (controller) process.off('SIGINT', stop)
    await lock.close()
    await unlink(lockPath)
  }
}

void prepare().catch(() => {
  console.error('Could not prepare the local review draft. Check the export path, selected files, and publication schema.')
  process.exitCode = 1
})
