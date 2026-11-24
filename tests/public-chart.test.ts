import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPublicChart } from '../dev/build-public-chart.ts'
import { fetchApprovedChart, publicReleaseChart } from '../dev/release-owner-chart.ts'
import { addSpotifyCovers, fetchSpotifyAlbumCredits, matchSpotifyCover } from '../dev/spotify-cover.ts'
import { ownerArtworkOrder } from '../dev/artwork-priority.ts'
import { artistGridArtwork, fetchListenBrainzGrid } from '../dev/listenbrainz-artwork.ts'
import { fetchListenBrainzSimilarArtists } from '../dev/listenbrainz.ts'
import { applyMusicBrainzGenres, applyMusicBrainzRelease, exactMusicBrainzMatch } from '../dev/catalog-providers.ts'
import { catalogGenreResolver } from '../src/graph/catalog-genres.ts'
import { privateArchive } from '../src/graph/archive.ts'
import { albumIdentity, artistIdentity, loadHistory, recordingTitleKey } from '../src/domain/history.ts'
import { isArtworkLookup, isArtworkMatch } from '../src/domain/catalog-artwork.ts'
import type { PublicEntry } from '../src/domain/public-chart.ts'
import { isCatalogArt, isPublicChart, safeCatalogUrl } from '../src/domain/public-chart.ts'
import { curatedGraph, focusNeighborhood, relatedAlbumIds, telescopeScene } from '../src/graph/exploration.ts'
import { formatPublicBand } from '../src/graph/model.ts'
import { constellationNodes, genreGroup, genreGroupLabel, layoutGraph, supportsGenre } from '../src/graph/layout.ts'
import { publicArchive } from '../src/graph/public-archive.ts'
import { albumSuggestionMbid, artistSimilarityFixture, ownerFixture, suggestionMbid } from './public-fixture.ts'

test('hosted builds require a reviewed public chart and reject private fields or arbitrary download hosts', async () => {
  const draft = { ...ownerFixture, catalog: ownerFixture.catalog.map((entry) => entry.artist
    ? { ...entry, playedTitles: ['Private recording'] } : entry) }
  const candidate = publicReleaseChart(draft)
  assert.ok(candidate.catalog.every((entry) => !entry.playedTitles))
  assert.ok(draft.catalog.some((entry) => entry.playedTitles))
  const url = 'https://example.public.blob.vercel-storage.com/reviewed-chart.json'
  const fetchCandidate: typeof fetch = async (address, options) => {
    assert.equal(String(address), url)
    assert.equal(options?.redirect, 'error')
    return Response.json(candidate)
  }
  assert.deepEqual(await fetchApprovedChart(url, fetchCandidate), candidate)
  await assert.rejects(fetchApprovedChart('http://127.0.0.1/owner-chart.json', fetchCandidate), /public Vercel Blob/)
  await assert.rejects(fetchApprovedChart(url, async () => Response.json(draft)), /prepared public candidate/)
  await assert.rejects(fetchApprovedChart(url, async () => Response.json({ ...candidate, playEvents: [] })), /Invalid owner chart/)
})

test('public projection drops tracks, dates, exact counts, and private identifiers', async () => {
  const row = { ts: '2024-10-12T01:02:03Z', ms_played: 1_890_000, ip_addr: '192.0.2.33', platform: 'example-device',
    master_metadata_album_artist_name: 'A Public Artist', master_metadata_album_album_name: 'A Public Album',
    master_metadata_track_name: 'Private Song', spotify_track_uri: 'spotify:track:1234567890123456789012' }
  const bytes = new TextEncoder().encode(JSON.stringify([row]))
  const titles = new Set<string>()
  const lookupIds = new Map<string, string>()
  const history = await loadHistory([{ name: 'Streaming_History_Audio_2024.json', size: bytes.length, read: async () => bytes }], titles, lookupIds)
  assert.equal(lookupIds.get(albumIdentity('A Public Artist', 'A Public Album')), '1234567890123456789012')
  assert.equal(lookupIds.get(artistIdentity('A Public Artist')), '1234567890123456789012')
  const projection = buildPublicChart(history)
  assert.ok(titles.has(recordingTitleKey('Prívate Song')))
  assert.deepEqual(projection.charts.Album[2024], [{ id: 'album-1', band: 1 }])
  const serialized = JSON.stringify(projection)
  assert.equal(isPublicChart(JSON.parse(serialized)), true)
  assert.doesNotMatch(serialized, /"(?:ts|ms_played|events|counts|tracks|lastPlayed|spotify_track_uri)"|Private Song|2024-10|192\.0\.2\.33|example-device|1234567890123456789012/i)
  const approved = buildPublicChart(history, true)
  assert.equal(isPublicChart(JSON.parse(JSON.stringify(approved))), true)
  assert.deepEqual(approved.catalog.find((item) => item.id === 'album-1')!.playedTitles, ['Private Song'])
})

test('owner artwork prioritizes ranked annual Focus entries before cumulative Focus entries', () => {
  const albumRows = Array.from({ length: 46 }, (_, index) => ({ id: 'album-' + (index + 1), band: 0 }))
  const chart = {
    ...ownerFixture,
    charts: {
      Artist: { 2023: [{ id: 'artist-2', band: 2 }], 2024: [{ id: 'artist-1', band: 1 }] },
      Album: { 2023: [{ id: 'album-50', band: 4 }], 2024: albumRows },
    },
    throughRanks: {
      Artist: { 2023: ['artist-2'], 2024: ['artist-1', 'artist-2'] },
      Album: { 2023: ['album-50'], 2024: ['album-46', 'album-50', ...albumRows.slice(0, 45).map(({ id }) => id)] },
    },
  }
  const order = ownerArtworkOrder(chart)
  assert.deepEqual(order.slice(0, 3), ['album-1', 'artist-1', 'album-2'])
  assert.deepEqual(order.slice(-3), ['album-50', 'artist-2', 'album-46'])
  assert.equal(order.length, new Set(order).size)
})

test('Spotify artist lookups resolve a verified album credit and reject unsafe artwork request data', async () => {
  const trackId = 'b'.repeat(22)
  const artistId = 'c'.repeat(22)
  const artist = { id: 'artist-1', name: 'Synthetic Artist' }
  const url = 'https://i.scdn.co/image/abcdef'
  const lookup = new Map([[artistIdentity(artist.name), trackId]])
  const credentials = { id: 'mock-app-id', secret: 'mock-secret', market: 'CA' }
  const fakeFetch: typeof fetch = async (input) => {
    const request = new URL(String(input))
    if (request.host === 'accounts.spotify.com') return Response.json({ access_token: 'synthetic-token' })
    if (request.pathname === '/v1/tracks/' + trackId) return Response.json({ album: { artists: [{ name: artist.name, id: artistId }] } })
    assert.equal(request.pathname, '/v1/artists/' + artistId)
    return Response.json({ id: artistId, name: artist.name, images: [{ url, width: 300 }] })
  }
  const artists: PublicEntry[] = [artist]
  assert.equal((await addSpotifyCovers(artists, lookup, credentials, fakeFetch)).spotifyCoversAdded, 1)
  assert.deepEqual(artists[0].artwork, { url, source: 'https://open.spotify.com/artist/' + artistId, credit: 'Spotify' })
  assert.equal(isArtworkMatch({ name: artist.name, art: artists[0].artwork }), true)
  assert.equal(isArtworkMatch({ name: 'Spoof', art: { ...artists[0].artwork, url: 'https://i.scdn.co.evil.test/image/aa' } }), false)
  assert.equal(isArtworkLookup({ kind: 'artist', track: trackId }), true)
  assert.equal(isArtworkLookup({ kind: 'artist', track: '../accounts' }), false)
  assert.equal(isArtworkLookup({ kind: 'artist', track: trackId, ts: '2024-01-01' }), false)
})

test('owner charts retain every annual entry and rank cumulative time before applying privacy bands', async () => {
  const playback = (year: number, index: number, time: number) => ({ ts: year + '-01-01T00:00:00Z', ms_played: time,
    master_metadata_album_artist_name: 'Artist ' + index, master_metadata_album_album_name: 'Album ' + index,
    master_metadata_track_name: 'Song ' + index })
  const rows = [...Array.from({ length: 60 }, (_, index) => playback(2023, index, index + 400)), playback(2024, 60, 900)]
  const bytes = new TextEncoder().encode(JSON.stringify(rows))
  const pack = buildPublicChart(await loadHistory([{ name: 'Streaming_History_Audio_2023.json', size: bytes.length, read: async () => bytes }]))
  assert.equal(isPublicChart(JSON.parse(JSON.stringify(pack))), true)
  for (const view of ['Artist', 'Album'] as const) {
    const archive = publicArchive(pack)
    const annual = archive.graphAt(2023, view)
    assert.equal(annual.nodes.length, 60)
    assert.equal(annual.nodes[0].name, view + ' 59')
    assert.equal(telescopeScene(annual, 'Hours', 0.6).nodes.size, 60)
    const curated = curatedGraph(annual, true)
    assert.equal(curated.nodes.length, 45)
    assert.deepEqual(curated.nodes, annual.nodes.slice(0, 45))
    assert.equal(telescopeScene(curated, 'Hours', 0.6).nodes.size, 45)
    const through = archive.graphAt(2024, view, 'through').nodes
    assert.equal(through.length, 61)
    assert.equal(through[0].name, view + ' 60')
    assert.equal(through[1].name, view + ' 59')
    assert.equal(curatedGraph(archive.graphAt(2024, view, 'through'), true).nodes.length, 45)
    assert.ok(through.every((node) => node.publicBand === 0))
  }
})

test('Explore eligibility uses exact lifetime totals with strict album and artist cutoffs', async () => {
  const row = (year: number, artist: string, album: string, duration: number) => ({
    ts: `${year}-01-01T00:00:00Z`, ms_played: duration, master_metadata_album_artist_name: artist,
    master_metadata_album_album_name: album, master_metadata_track_name: 'Song',
  })
  const twoHours = 7_200_000
  const rows = ['Exact', 'Above'].flatMap((name) => [
    row(2023, name, name + ' Album', 1),
    row(2024, name, name + ' Album', twoHours - Number(name === 'Exact')),
    row(2024, name, name + ' Side Album', twoHours),
  ])
  const bytes = new TextEncoder().encode(JSON.stringify(rows))
  const history = await loadHistory([{ name: 'Streaming_History_Audio_2023.json', size: bytes.length, read: async () => bytes }])
  const chart = buildPublicChart(history)
  assert.ok(isPublicChart(chart))
  assert.equal(isPublicChart({ ...chart, catalog: chart.catalog.map((entry) => ({ ...entry, exploreArtwork: 42 })) }), false)
  for (const archive of [privateArchive(history), publicArchive(chart)]) {
    for (const view of ['Artist', 'Album'] as const) {
      const expected = view === 'Artist' ? ['Above'] : ['Above Album']
      const eligible = archive.exploreArtworkIds!(view)
      for (const [year, scope] of [[2023, 'year'], [2024, 'year'], [2024, 'through']] as const) {
        assert.deepEqual(archive.graphAt(year, view, scope).nodes.filter((node) => eligible.has(node.id)).map((node) => node.name), expected)
      }
    }
  }
})

test('ListenBrainz grids are static local artwork and honor quota cooldowns', async () => {
  const mbid = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11'
  const art = artistGridArtwork(mbid)
  assert.equal(isCatalogArt(art), true)
  assert.equal(isCatalogArt({ ...art, url: './artist-art/../private.svg' }), false)
  assert.equal(isCatalogArt({ ...art, source: 'https://listenbrainz.org.evil.test/artist/' + mbid + '/' }), false)
  assert.equal(isPublicChart({ ...ownerFixture, catalog: ownerFixture.catalog.map((entry) => entry.artist ? { ...entry, artwork: art } : entry) }), false)
  const coverUrl = `https://archive.org/download/mbid-${mbid}/mbid-${mbid}-123456_thumb250.jpg`
  const image = Buffer.from([255, 216, 255, 217])
  const sources: string[] = []
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input))
    sources.push(url.href)
    if (url.host === 'api.listenbrainz.org') {
      assert.equal(url.pathname, `/1/art/artist-grid/${mbid}/2/0/250`)
      assert.match(new Headers(options?.headers).get('User-Agent')!, /maintainer@example.test/)
      assert.equal(new Headers(options?.headers).has('Authorization'), false)
      return new Response(`<svg><script>throw 1</script><image href="https://archive.org.evil.test/file.jpg"/>
        <image href="https://archive.org/download/mbid-${mbid}/mbid-wrong_thumb250.jpg"/>
        <image xlink:href="${coverUrl}" onload="throw 1"/><image href="${coverUrl}"/></svg>`,
      { headers: { 'Content-Type': 'image/svg+xml', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-In': '12' } })
    }
    assert.equal(url.href, coverUrl)
    return new Response(image, { headers: { 'Content-Type': 'image/jpeg' } })
  }
  const result = await fetchListenBrainzGrid(mbid, 'maintainer@example.test', request)
  assert.equal(result.cooldown, 12)
  assert.match(result.image!, /href="data:image\/jpeg;base64,\/9j\/2Q=="/)
  assert.doesNotMatch(result.image!, /<script|onload|archive\.org|<\/script>/)
  assert.equal(sources.length, 2)
  assert.deepEqual(await fetchListenBrainzGrid(mbid, 'maintainer@example.test', async () =>
    new Response(null, { status: 429, headers: { 'Retry-After': '30' } })), { cooldown: 30, unavailable: true })
  assert.deepEqual(await fetchListenBrainzGrid(mbid, 'maintainer@example.test', async () =>
    new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } })), { cooldown: 0, unavailable: true })
  await assert.rejects(fetchListenBrainzGrid('../private', 'maintainer@example.test', request), /Invalid artist grid configuration/)
})

test('genre matching keeps a clear release tag and falls back to the matching artist when needed', () => {
  const entries = ownerFixture.catalog.map((item) => item.id === 'album-2'
    ? { ...item, artist: 'another ARTIST', genres: ['indie pop', 'soul'] }
    : item.id === 'album-1' ? { ...item, genres: ['jazz'], primaryGenre: 'jazz' } : item)
  const chart = publicArchive({ ...ownerFixture, catalog: entries }).graphAt(2024, 'Album')
  const [release, inherited] = chart.nodes
  assert.equal(release.genre, 'jazz')
  assert.equal(Boolean(release.usesArtistGenres), false)
  assert.equal(inherited.genre, 'soul')
  assert.deepEqual(inherited.tags, ['indie pop', 'soul'])
  assert.equal(inherited.usesArtistGenres, true)
})

test('genre classification distinguishes tied tags, inferred artist genres and unknown entries', () => {
  const resolve = catalogGenreResolver([
    { id: 'artist-1', name: 'Example Artist' },
    { id: 'album-1', name: 'First', artist: 'Example Artist', genres: ['Jazz'], primaryGenre: 'Jazz' },
    { id: 'album-2', name: 'Second', artist: 'Example Artist', genres: ['jazz'], primaryGenre: 'jazz' },
    { id: 'album-3', name: 'Mixed', artist: 'Example Artist', genres: ['rock', 'blues'] },
  ])
  assert.deepEqual(resolve('EXAMPLE ARTIST'), { genre: 'jazz', tags: ['jazz'], genreFromReleases: true })
  assert.equal(resolve('Third', 'Example Artist').usesArtistGenres, true)
  const chart = publicArchive(ownerFixture).graphAt(2024, 'Album')
  const sample = chart.nodes[0]
  assert.equal(genreGroupLabel(genreGroup({ ...sample, ...resolve('Mixed', 'Example Artist') })), 'Multiple genres')
  assert.equal(genreGroupLabel(genreGroup({ ...sample, ...resolve('Unknown', 'Different Artist'), genre: undefined })), 'Untagged')
  assert.equal(supportsGenre({
    nodes: [{ ...sample, ...resolve('Third', 'Example Artist') }, { ...sample, id: 'untagged', genre: undefined, tags: [] }], edges: [],
  }), true)
})

test('MusicBrainz matching rejects ambiguous identities and filters arbitrary tags and invalid votes', () => {
  const entry: PublicEntry = { id: 'album-1', name: 'Example Album', artist: 'Example Artist', genres: ['old'], primaryGenre: 'old' }
  const match = { id: '12345678-1234-1234-1234-123456789012', title: 'Example Album', 'artist-credit': [{ name: 'Example Artist' }] }
  assert.equal(exactMusicBrainzMatch(entry, [{ ...match, title: 'Another Album' }]), undefined)
  assert.equal(exactMusicBrainzMatch(entry, [match, { ...match, id: '87654321-1234-1234-1234-123456789012' }]), undefined)
  assert.deepEqual(exactMusicBrainzMatch(entry, [match]), match)
  assert.equal(applyMusicBrainzGenres(entry, [
    { name: 'favorite', count: 99 }, { name: 'Jazz', count: 4 }, { name: 'rock', count: 4 },
    { name: 'Rock', count: 1 }, { name: 'soul', count: Infinity }, { name: 'blues', count: -2 },
  ], new Set(['jazz', 'rock', 'soul', 'blues'])), true)
  assert.deepEqual(entry.genres, ['jazz', 'rock'])
  assert.equal(entry.primaryGenre, undefined)
})

test('Spotify artwork validates exact catalog matches and sends only the selected track ID', async () => {
  const albumId = 'a'.repeat(22)
  const trackId = 'b'.repeat(22)
  const entry: PublicEntry = { id: 'album-1', name: 'Example Album', artist: 'Example Artist' }
  const url = 'https://i.scdn.co/image/abcdef'
  const album = { id: albumId, name: entry.name, artists: [{ name: entry.artist }], images: [
    { url: 'https://i.scdn.co/image/aaaa', width: 64 }, { url, width: 300 },
  ] }
  assert.equal(matchSpotifyCover({ album: { ...album, name: 'Example Album (Live)' } }, entry), undefined)
  assert.equal(matchSpotifyCover({ album: { ...album, images: [{ url: 'https://i.scdn.co.evil.test/image/abcdef', width: 300 }] } }, entry), undefined)
  const origins: string[] = []
  const fakeFetch: typeof fetch = async (input, options) => {
    const endpoint = new URL(String(input))
    origins.push(endpoint.origin)
    assert.equal(options?.redirect, 'error')
    const headers = new Headers(options?.headers)
    if (endpoint.host === 'accounts.spotify.com') {
      assert.match(headers.get('Authorization') ?? '', /^Basic /)
      assert.equal(options?.body, 'grant_type=client_credentials')
      return Response.json({ access_token: 'synthetic-token' })
    }
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-token')
    assert.equal(endpoint.pathname, '/v1/tracks/' + trackId)
    assert.equal(endpoint.search, '?market=CA')
    assert.equal(options?.body, undefined)
    return Response.json({ album })
  }
  const lookupIds = new Map([[albumIdentity(entry.artist!, entry.name), trackId]])
  assert.equal((await addSpotifyCovers([entry], lookupIds, { id: 'mock-app-id', secret: 'mock-secret', market: 'CA' }, fakeFetch)).spotifyCoversAdded, 1)
  assert.deepEqual(origins, ['https://accounts.spotify.com', 'https://api.spotify.com'])
  assert.deepEqual(entry.artwork, { url, source: 'https://open.spotify.com/album/' + albumId, credit: 'Spotify' })
  assert.doesNotMatch(JSON.stringify(entry), /synthetic-token|mock-secret|b{22}/)
})

test('Spotify artwork can pass 60 lookups and resume after a rate limit', async () => {
  const entries: PublicEntry[] = Array.from({ length: 64 }, (_, index) => ({
    id: 'album-' + (index + 1), name: 'Synthetic album ' + index, artist: 'Synthetic artist',
  }))
  const trackId = (index: number) => index.toString().padStart(22, 'b')
  const lookup = new Map(entries.map((entry, index) => [albumIdentity(entry.artist!, entry.name), trackId(index)]))
  const misses = new Map<string, number>()
  const credentials = { id: 'mock-app-id', secret: 'mock-secret', market: 'CA' }
  const asked: number[] = []
  let pauseOnce = true
  const fakeFetch: typeof fetch = async (input) => {
    const endpoint = new URL(String(input))
    if (endpoint.host === 'accounts.spotify.com') return Response.json({ access_token: 'synthetic-token' })
    const index = Number(endpoint.pathname.slice('/v1/tracks/'.length).replace(/^b+/, ''))
    asked.push(index)
    if (index === 0) return new Response(null, { status: 404 })
    if (index === 63 && pauseOnce) {
      pauseOnce = false
      return new Response(null, { status: 429, headers: { 'Retry-After': '45' } })
    }
    return Response.json({ album: {
      id: 'a'.repeat(22), name: entries[index].name, artists: [{ name: entries[index].artist }],
      images: [{ url: 'https://i.scdn.co/image/abcdef', width: 300 }],
    } })
  }
  const checkpoints: number[] = []
  const first = await addSpotifyCovers(entries, lookup, credentials, fakeFetch, {
    limit: Infinity, misses, checkpoint: async (stats) => { checkpoints.push(stats.spotifyEntriesChecked) },
  })
  assert.deepEqual(checkpoints, [60])
  assert.equal(first.spotifyEntriesChecked, 64)
  assert.equal(first.spotifyCoversAdded, 62)
  assert.equal(first.spotifyEntriesUnmatched, 1)
  assert.equal(first.spotifyEntriesRemaining, 1)
  assert.equal(first.spotifyStopReason, 'rate-limited')
  assert.equal(first.spotifyRetryAfterSeconds, 45)
  assert.match([...misses.keys()][0], /^[a-f\d]{64}$/)
  assert.equal(misses.size, 1)
  asked.length = 0
  const resumed = await addSpotifyCovers(entries, lookup, credentials, fakeFetch, { limit: Infinity, misses })
  assert.deepEqual(asked, [63])
  assert.equal(resumed.spotifyCoversAdded, 1)
  assert.equal(resumed.spotifyEntriesRemaining, 0)
  assert.equal(resumed.spotifyLookupInterrupted, false)
})

test('a malformed or cancelled Spotify lookup leaves the album eligible to retry', async () => {
  const entry = { id: 'album-1', name: 'Synthetic Album', artist: 'Synthetic Artist' }
  const lookup = new Map([[albumIdentity(entry.artist, entry.name), 'b'.repeat(22)]])
  const credentials = { id: 'mock-app-id', secret: 'mock-secret', market: 'CA' }
  const misses = new Map<string, number>()
  const fakeFetch: typeof fetch = async (input) => new URL(String(input)).host === 'accounts.spotify.com'
    ? Response.json({ access_token: 'synthetic-token' }) : Response.json({ album: ['malformed'] })
  const malformed = await addSpotifyCovers([entry], lookup, credentials, fakeFetch, { misses })
  assert.equal(malformed.spotifyStopReason, 'request-failed')
  assert.equal(malformed.spotifyEntriesRemaining, 1)
  assert.equal(misses.size, 0)
  const cancelled = await addSpotifyCovers([entry], lookup, credentials, fakeFetch, { misses, signal: AbortSignal.abort() })
  assert.equal(cancelled.spotifyStopReason, 'cancelled')
  assert.equal(cancelled.spotifyEntriesChecked, 0)
  assert.equal(cancelled.spotifyEntriesRemaining, 1)
})

test('public pack rejects private fields, invalid references, and untrusted destinations', () => {
  assert.equal(isPublicChart(ownerFixture), true)
  for (const url of ['javascript:alert(1)', 'https://upload.wikimedia.org.evil.test/wikipedia/commons/a.png',
    'http://upload.wikimedia.org/wikipedia/commons/a.png', 'https://evil.test@upload.wikimedia.org/wikipedia/commons/a.png',
    'https://upload.wikimedia.org/wikipedia/commons/a.png?private=1']) assert.equal(safeCatalogUrl(url, 'image'), false)
  assert.equal(isPublicChart({ ...ownerFixture, referenceTime: 1 }), false)
  assert.equal(isPublicChart({ ...ownerFixture, suggestions: [{ ...ownerFixture.suggestions[0], seed: 'artist-998' }] }), false)
  assert.equal(isPublicChart({ ...ownerFixture, catalog: [{ ...ownerFixture.catalog[0], tracks: [] }, ...ownerFixture.catalog.slice(1)] }), false)
  assert.equal(isPublicChart({ ...ownerFixture, catalog: [{ ...ownerFixture.catalog[0], catalogTracks: ['Unexpected'] }, ...ownerFixture.catalog.slice(1)] }), false)
  assert.equal(isPublicChart({ ...ownerFixture, catalog: [{ ...ownerFixture.catalog[0], creditedArtists: ['Album artist'] }, ...ownerFixture.catalog.slice(1)] }), false)
  for (const creditedArtists of [[], [{ name: 'Artist', timestamp: 1 }], ['a'.repeat(257)]]) {
    assert.equal(isPublicChart({ ...ownerFixture, catalog: ownerFixture.catalog.map((entry) => entry.artist ? { ...entry, creditedArtists } : entry) }), false)
  }
  assert.equal(isPublicChart({ ...ownerFixture, charts: { ...ownerFixture.charts, Album: { 2023: [], 2024: [{ id: 'artist-1', band: 2 }] } } }), false)
})

test('cumulative owner bands cover all included years and catalog tracks stay separate from private plays', () => {
  const data = {
    ...ownerFixture,
    charts: { ...ownerFixture.charts, Album: { 2023: [{ id: 'album-1', band: 1 }], 2024: ownerFixture.charts.Album[2024] } },
  }
  const album = publicArchive(data).graphAt(2024, 'Album', 'through').nodes[0]
  assert.equal(album.publicBand, 3)
  assert.equal(album.publicBandYears, 2)
  assert.equal(formatPublicBand(album.publicBand, album.publicBandYears), '1h 30m to 2h 30m')
  assert.deepEqual(album.tracks.map((track) => [track.name, track.catalog]), [['Catalog opener', true], ['Catalog closer', true]])
})

test('public suggestions are bounded, attached to an applicable seed, and visible at the rim', () => {
  const extras = Array.from({ length: 10 }, (_, index) => ({
    kind: 'artist' as const, title: 'Catalog Artist', mbid: `87654321-1234-1234-1234-${String(index).padStart(12, '0')}`,
  }))
  const archive = publicArchive({
    ...ownerFixture, suggestions: [...ownerFixture.suggestions, ...extras.map((item, index) => ({ ...item, seed: index % 2 ? 'artist-1' : 'artist-2' }))],
  })
  const graph = archive.graphAt(2024, 'Artist')
  assert.equal(supportsGenre(graph), true)
  assert.equal(graph.nodes.filter((node) => node.recommendation).length, 8)
  assert.equal(curatedGraph(graph, true).nodes.filter((node) => node.recommendation).length, 4)
  assert.ok(graph.nodes.filter((node) => node.recommendation).every((node) => node.recommendation?.kind === 'artist'))
  const selected = graph.nodes.find((node) => node.recommendation?.mbid === suggestionMbid)!
  assert.deepEqual(constellationNodes(graph, selected).map((node) => node.id), ['artist-1', selected.id])
  const position = layoutGraph(graph, 'Genre').get(selected.id)!
  assert.ok(Math.abs(position.x) > 300)
  assert.equal(telescopeScene(graph, 'Genre', 1).nodes.has(selected.id), true)
  const albums = archive.graphAt(2024, 'Album')
  const suggested = albums.nodes.filter((node) => node.recommendation)
  assert.equal(suggested.length, 1)
  assert.equal(suggested[0].recommendation?.mbid, albumSuggestionMbid)
  assert.equal(albums.edges.some((edge) => edge.source === 'album-1' && edge.target === suggested[0].id), true)
  const focusedIds = focusNeighborhood(albums, 'album-1')
  assert.deepEqual(focusedIds, new Set(['album-1', suggested[0].id]))
  assert.deepEqual(telescopeScene(albums, 'Genre', 1, 'album-1', focusedIds).emphasis, focusedIds)
  assert.deepEqual(albums.nodes.find((node) => node.id === 'album-2')?.tracks.map((track) => [track.name, track.sharedTitle]), [['Shared title', true]])
  assert.deepEqual(archive.graphAt(2023, 'Artist').nodes, [])
})

test('album focus includes every matching release beyond the normal Focus cutoff and across genres', () => {
  const extras = Array.from({ length: 58 }, (_, index): PublicEntry => ({
    id: `album-${index + 3}`, name: `Release ${index}`,
    artist: index === 57 ? 'Example Artist' : 'Another Artist',
    creditedArtists: index >= 44 && index < 57 ? [' Example Artist '] : undefined,
  }))
  const graph = publicArchive({ ...ownerFixture, catalog: [...ownerFixture.catalog, ...extras],
    charts: { ...ownerFixture.charts, Album: { 2023: [], 2024: [...ownerFixture.charts.Album[2024], ...extras.map(({ id }) => ({ id, band: 0 }))] } },
  }).graphAt(2024, 'Album')
  const selected = graph.nodes[0]
  const credits = relatedAlbumIds(graph, selected)
  assert.deepEqual([...credits], extras.slice(44).map(({ id }) => id))
  assert.deepEqual([...relatedAlbumIds(graph, { ...selected, artistName: 'Various Artists' })], [])
  const overview = curatedGraph(graph, true)
  assert.ok([...credits].every((id) => !overview.nodes.some((node) => node.id === id)))
  const expanded = curatedGraph(graph, true, new Set([selected.id, ...credits]))
  const neighborhood = focusNeighborhood(expanded, selected.id, credits)
  const scene = telescopeScene(expanded, 'Genre', 0.8, selected.id, neighborhood, credits)
  for (const id of credits) {
    assert.ok(scene.emphasis.has(id))
    assert.ok(scene.edges.some((edge) => (edge.source === selected.id && edge.target === id) || (edge.target === selected.id && edge.source === id)))
  }
})

test('track credits validate catalog matches, paginate explicitly and reject malformed or interrupted responses', async () => {
  const entry: PublicEntry = { id: 'album-1', name: 'Catalog Release', artist: 'Main Artist' }
  const credit = (name: string) => ({ name })
  const recording = { title: 'Track', 'artist-credit': [credit('Guest From Recording')] }
  const response = { title: entry.name, 'artist-credit': [credit('Main Artist')], media: [
    { tracks: [{ recording, 'artist-credit': [credit('Guest From Track')] }] },
  ] }
  applyMusicBrainzRelease(entry, { ...response, 'artist-credit': [credit('Wrong Artist')] })
  assert.equal(entry.creditedArtists, undefined)
  applyMusicBrainzRelease(entry, response)
  assert.deepEqual(entry.creditedArtists, ['Main Artist', 'Guest From Track', 'Guest From Recording'])

  const id = 'a'.repeat(22)
  const paths: string[] = []
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input))
    paths.push(url.href)
    return Response.json({ total: 2, next: 'https://example.net/untrusted', items: [
      { artists: [credit(url.searchParams.get('offset') === '0' ? 'Main Artist' : 'Featured Artist')] },
    ] })
  }
  const result = await fetchSpotifyAlbumCredits(id, 'CA', 'Bearer fixture', request)
  assert.deepEqual(result, { status: 200, credits: ['Main Artist', 'Featured Artist'] })
  assert.deepEqual(paths, [0, 1].map((offset) => `https://api.spotify.com/v1/albums/${id}/tracks?market=CA&limit=50&offset=${offset}`))
  await assert.rejects(fetchSpotifyAlbumCredits(id, 'CA', 'Bearer fixture', async () =>
    Response.json({ total: 1, items: [{ artists: [credit(' ')] }] })), /Invalid Spotify artist credit/)
  assert.deepEqual(await fetchSpotifyAlbumCredits(id, 'CA', 'Bearer fixture', async () =>
    new Response(null, { status: 429, headers: { 'Retry-After': '60' } })), { status: 429, retryAfter: '60' })
})

test('the private owner chart can reuse public suggestions without replacing private playback totals', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify([{
    ts: '2024-10-12T01:02:03Z', ms_played: 1789, master_metadata_album_artist_name: 'Example Artist',
    master_metadata_album_album_name: 'Public Album', master_metadata_track_name: 'Private Song',
  }]))
  const history = await loadHistory([{ name: 'Streaming_History_Audio_2024.json', size: bytes.length, read: async () => bytes }])
  const archive = privateArchive(history, undefined, undefined, publicArchive(ownerFixture))
  const graph = archive.graphAt(2024, 'Album')
  assert.equal(graph.nodes[0].tracks[0].milliseconds, 1789)
  assert.equal(graph.nodes[0].publicBand, undefined)
  const suggested = graph.nodes.find((node) => node.recommendation?.mbid === albumSuggestionMbid)!
  assert.ok(graph.edges.some((edge) => edge.source === graph.nodes[0].id && edge.target === suggested.id))
  assert.equal(privateArchive(history).graphAt(2024, 'Album').nodes.length, 1)
})

test('ListenBrainz artists link only when present in the period and are suggested only when absent in the full archive', async () => {
  const fixture = artistSimilarityFixture
  assert.ok(isPublicChart(fixture))
  const archive = publicArchive(fixture)
  const annual = archive.graphAt(2024, 'Artist')
  const liked = annual.edges.find((edge) => edge.basis === 'listenbrainz')
  assert.deepEqual(liked, { source: 'artist-1', target: 'artist-2', kind: 'listened', strength: 1, basis: 'listenbrainz' })
  assert.ok(!annual.nodes.some(({ name }) => name.startsWith('Previous')))
  assert.ok(archive.graphAt(2024, 'Artist', 'through').edges.some((edge) => edge.basis === 'listenbrainz' && edge.target === 'artist-3'))
  const curated = curatedGraph(annual, true)
  assert.ok(telescopeScene(curated, 'Genre', 1).edges.includes(liked!))
  const suggestion = annual.nodes.find((node) => node.name === 'Unheard Artist')!
  assert.equal(suggestion.recommendation?.source, 'artist-similarity')
  assert.equal(annual.edges.filter((edge) => edge.target === suggestion.id && edge.kind === 'discovery').length, 2)
  const focused = archive.artistSuggestions!(curated, 'artist-2', 1)
  assert.deepEqual(focused.nodes.filter((node) => node.recommendation).map((node) => node.name), ['Unheard Artist'])
  assert.ok(focused.edges.some((edge) => edge.source === 'artist-2' && edge.target === suggestion.id))
  assert.equal(archive.graphAt(2024, 'Album').nodes.find((node) => node.recommendation)?.recommendation?.source, undefined)

  const bytes = new TextEncoder().encode(JSON.stringify([
    { ts: '2024-02-01T00:00:00Z', ms_played: 1000, master_metadata_album_artist_name: 'Example Artist',
      master_metadata_album_album_name: 'Example Album', master_metadata_track_name: 'Example Track' },
    { ts: '2023-02-01T00:00:00Z', ms_played: 1000, master_metadata_album_artist_name: 'Unheard Artist',
      master_metadata_album_album_name: 'Visitor Album', master_metadata_track_name: 'Visitor Track' },
  ]))
  const history = await loadHistory([{ name: 'Streaming_History_Audio_2024.json', size: bytes.length, read: async () => bytes }])
  const visitor = privateArchive(history, undefined, undefined, undefined, fixture.catalog).graphAt(2024, 'Artist')
  assert.deepEqual(visitor.nodes.filter((node) => node.recommendation).map((node) => node.name), ['Another Artist', 'Previous Canonical Artist'])
})

test('artist similarity validates the seed, response bounds, scores and quota retries', async () => {
  const seed = artistSimilarityFixture.catalog[0].artistMbid!
  const target = artistSimilarityFixture.catalog[1].artistMbid!
  const reply = (score: number, name = 'External Artist', reference_mbid = seed) => ({ artist_mbid: target, name, score, reference_mbid })
  const fetchRows: typeof fetch = async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://labs.api.listenbrainz.org')
    assert.equal(url.pathname, '/similar-artists/json')
    assert.equal(url.searchParams.get('artist_mbids'), seed)
    assert.equal(options?.redirect, 'error')
    assert.equal(new Headers(options?.headers).has('Authorization'), false)
    return Response.json([reply(25), reply(60), reply(100, 'Wrong source', target), reply(101, '\u202eHidden'),
      reply(-1), { ...reply(200), artist_mbid: seed }, { ...reply(250), artist_mbid: '../private' }])
  }
  const contact = 'maintainer@example.test'
  assert.deepEqual(await fetchListenBrainzSimilarArtists(seed, contact, fetchRows),
    { status: 200, cooldown: 0, rows: [{ mbid: target, name: 'External Artist', score: 60 }] })
  assert.deepEqual(await fetchListenBrainzSimilarArtists(seed, contact, async () =>
    new Response(null, { status: 429, headers: { 'X-RateLimit-Reset-In': '23' } })), { status: 429, cooldown: 23 })
  assert.deepEqual(await fetchListenBrainzSimilarArtists(seed, contact, async () =>
    Response.json(Array.from({ length: 201 }, () => reply(25)))), { status: 200, cooldown: 0 })
  const poisoned = { ...artistSimilarityFixture, catalog: artistSimilarityFixture.catalog.map((entry) =>
    entry.id === 'artist-1' ? { ...entry, similarArtists: [{ mbid: target, name: 'Invalid Artist', score: NaN }] } : entry) }
  assert.equal(isPublicChart(poisoned), false)
})
