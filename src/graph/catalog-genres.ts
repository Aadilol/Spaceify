import { albumIdentity, artistIdentity } from '../domain/history.ts'
import type { PublicEntry } from '../domain/public-chart.ts'

interface AssignedGenre {
  genre?: string
  tags: string[]
  usesArtistGenres?: boolean
  genreFromReleases?: boolean
}

export function catalogGenreResolver(catalog: readonly PublicEntry[]) {
  const artists = new Map<string, AssignedGenre>()
  const albums = new Map<string, AssignedGenre>()
  const releaseVotes = new Map<string, Map<string, number>>()
  const empty: AssignedGenre = { tags: [] }
  for (const entry of catalog) {
    const tags = [...new Set((entry.genres ?? []).map((value) => value.trim().normalize('NFC').toLowerCase()).filter(Boolean))]
    const genre = entry.primaryGenre?.trim().normalize('NFC').toLowerCase() || (tags.length === 1 ? tags[0] : undefined)
    if (!tags.length) continue
    if (entry.artist) {
      albums.set(albumIdentity(entry.artist, entry.name), { genre, tags })
      if (genre) {
        const key = artistIdentity(entry.artist)
        const votes = releaseVotes.get(key) ?? new Map<string, number>()
        votes.set(genre, (votes.get(genre) ?? 0) + 1)
        releaseVotes.set(key, votes)
      }
    } else artists.set(artistIdentity(entry.name), { genre, tags })
  }
  for (const [artist, votes] of releaseVotes) {
    const direct = artists.get(artist)
    if (direct?.genre) continue
    const [top, second] = [...votes].sort((a, b) => b[1] - a[1])
    if (top[1] >= 2 && top[1] > (second?.[1] ?? 0) && (!direct || direct.tags.includes(top[0]))) {
      artists.set(artist, { genre: top[0], tags: direct?.tags ?? [top[0]], genreFromReleases: true })
    }
  }
  return (name: string, artist?: string): AssignedGenre => {
    if (!artist) return artists.get(artistIdentity(name)) ?? empty
    const album = albums.get(albumIdentity(artist, name))
    if (album?.genre) return album
    const artistGenre = artists.get(artistIdentity(artist))
    if (!artistGenre || (album && (!artistGenre.genre || !album.tags.includes(artistGenre.genre)))) return album ?? empty
    return { ...artistGenre, tags: album?.tags ?? artistGenre.tags, usesArtistGenres: true }
  }
}
