import type { PublicChart } from '../src/domain/public-chart.ts'

export const suggestionMbid = '87654321-1234-1234-1234-abcdabcdabcd'
export const albumSuggestionMbid = '87654321-1234-1234-1234-abc00000abcd'
export const fixtureArtwork = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png'
export const fixtureAlbumArtwork = 'https://i.scdn.co/image/0123456789abcdef'
export const fixtureAlbumLink = 'https://open.spotify.com/album/' + 'a'.repeat(22)
export const ownerFixture: PublicChart = {
  version: 1,
  years: [2023, 2024],
  catalog: [
    { id: 'artist-1', name: 'Example Artist', genres: ['experimental rock', 'post-rock'], primaryGenre: 'experimental rock',
      artwork: { url: fixtureArtwork, source: 'https://commons.wikimedia.org/wiki/File:Example.png', credit: 'Example author · CC BY-SA 4.0' } },
    { id: 'artist-2', name: 'Another Artist', genres: ['soul'], primaryGenre: 'soul' },
    { id: 'album-1', name: 'Public Album', artist: 'Example Artist', genres: ['experimental rock'], primaryGenre: 'experimental rock',
      catalogTracks: ['Catalog opener', 'Catalog closer'], artwork: { url: fixtureAlbumArtwork, source: fixtureAlbumLink, credit: 'Spotify' } },
    { id: 'album-2', name: 'Shared Album', artist: 'Another Artist', playedTitles: ['Shared title'] },
  ],
  charts: {
    Artist: { 2023: [], 2024: [{ id: 'artist-1', band: 2 }, { id: 'artist-2', band: 0 }] },
    Album: { 2023: [], 2024: [{ id: 'album-1', band: 2 }, { id: 'album-2', band: 1 }] },
  },
  suggestions: [
    { kind: 'artist', mbid: suggestionMbid, title: 'Outside Artist', seed: 'artist-1' },
    { kind: 'album', mbid: albumSuggestionMbid, title: 'Outside Album', artist: 'Outside Artist', seed: 'artist-1' },
    { recording: '87654321-1234-1234-1234-000000000000', title: 'Legacy Song', artist: 'Outside Artist', seed: 'artist-1' },
  ],
}

const artistMbid = (index: number) => `12345678-1234-1234-1234-${String(index).padStart(12, '0')}`

export const artistSimilarityFixture: PublicChart = {
  ...ownerFixture,
  catalog: [
    { ...ownerFixture.catalog[0], artistMbid: artistMbid(1), similarArtists: [
      { mbid: artistMbid(2), name: 'Another Artist', score: 400 },
      { mbid: artistMbid(3), name: 'Previous Canonical Artist', score: 350 },
      { mbid: artistMbid(4), name: 'Unheard Artist', score: 320 },
    ] },
    { ...ownerFixture.catalog[1], artistMbid: artistMbid(2), similarArtists: [
      { mbid: artistMbid(4), name: 'Unheard Artist', score: 120 },
      { mbid: artistMbid(5), name: 'Another Unheard Artist', score: 95 },
    ] },
    ...ownerFixture.catalog.slice(2),
    { id: 'artist-3', name: 'Previous Artist Alias', artistMbid: artistMbid(3) },
  ],
  charts: { ...ownerFixture.charts, Artist: { ...ownerFixture.charts.Artist, 2023: [{ id: 'artist-3', band: 1 }] } },
}
