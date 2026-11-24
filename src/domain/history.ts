import { day } from './listening.ts'
import { listenedEdges, rankListened } from '../graph/model.ts'
import type { ListeningGraph, MapNode, View } from '../graph/model.ts'
import { HistoryError, isAudioHistory, maxFileBytes, maxHistoryBytes, maxHistoryFiles, maxHistoryRows, musicEvent, parseHistoryJson } from '../import/history-json.ts'
import type { MusicEvent } from '../import/history-json.ts'

export interface HistorySnapshot {
  years: number[]
  referenceTime: number
  counts: { events: number; duplicates: number; ignored: number; invalid: number }
  graphs: Record<View, Record<number, ListeningGraph>>
}

export interface HistoryFile {
  name: string
  size: number
  read(): Promise<Uint8Array | ArrayBuffer>
}

interface Entity {
  id: string
  name: string
  artist?: string
  seed: number
  years: Map<number, AnnualTotals>
}

interface TrackTotals { id: string; name: string; events: number; milliseconds: number; coverTone: number }
interface AnnualTotals {
  events: number
  milliseconds: number
  lastPlayed: number
  days: Set<number>
  tracks: Map<string, TrackTotals>
}

const identity = (name: string) => name.toLowerCase().normalize('NFC')
export const albumIdentity = (artist: string, album: string) => JSON.stringify([identity(artist), identity(album)])
export const artistIdentity = (artist: string) => JSON.stringify([identity(artist)])
export const compareTracks = (a: { milliseconds?: number; events: number; name: string }, b: typeof a) =>
  (b.milliseconds ?? 0) - (a.milliseconds ?? 0) || b.events - a.events || a.name.localeCompare(b.name)

function hash(value: string) {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619)
  return result >>> 0
}

function entityFor(entities: Map<string, Entity>, key: string, name: string, artist?: string): Entity {
  const previous = entities.get(key)
  if (previous) return previous
  const next = { id: `${artist ? 'album' : 'artist'}-${entities.size + 1}`, name, artist, seed: hash(key), years: new Map() }
  entities.set(key, next)
  return next
}

function addPlay(entity: Entity, event: MusicEvent, trackKey: string, coverTone: number) {
  let totals = entity.years.get(event.year)
  if (!totals) {
    totals = { events: 0, milliseconds: 0, lastPlayed: 0, days: new Set(), tracks: new Map() }
    entity.years.set(event.year, totals)
  }
  totals.events++
  totals.milliseconds += event.milliseconds
  totals.lastPlayed = Math.max(totals.lastPlayed, event.timestamp)
  if (event.milliseconds > 0) totals.days.add(Math.floor(event.timestamp / day))
  const track = totals.tracks.get(trackKey) ?? { id: trackKey, name: event.track, events: 0, milliseconds: 0, coverTone }
  track.events++
  track.milliseconds += event.milliseconds
  totals.tracks.set(trackKey, track)
}

function daysOverlap(left: Set<number>, right: Set<number>) {
  let common = 0
  for (const date of left) if (right.has(date)) common++
  return common >= 2 ? common / (left.size + right.size - common) : 0
}

function historyEdges(nodes: MapNode[], days: Map<string, Set<number>>) {
  const byDay = new Map<number, MapNode[]>()
  const byArtist = new Map<string, MapNode[]>()
  for (const node of nodes) {
    for (const date of days.get(node.id)!) {
      const shortlist = byDay.get(date) ?? []
      if (shortlist.length < 12) shortlist.push(node)
      byDay.set(date, shortlist)
    }
    if (node.artistName) {
      const key = identity(node.artistName)
      const shortlist = byArtist.get(key) ?? []
      if (shortlist.length < 3) shortlist.push(node)
      byArtist.set(key, shortlist)
    }
  }
  return listenedEdges(nodes, (left, right) => {
    if (left.artistName && right.artistName && identity(left.artistName) === identity(right.artistName)) return 1
    return daysOverlap(days.get(left.id)!, days.get(right.id)!)
  }, (node) => {
    const matches = new Set<MapNode>(node.artistName ? byArtist.get(identity(node.artistName)) : undefined)
    for (const date of days.get(node.id)!) for (const item of byDay.get(date)!) matches.add(item)
    return matches
  })
}

function graphFor(entries: { entity: Entity; totals: AnnualTotals }[], year: number): ListeningGraph {
  const nodes = rankListened(entries.map(({ entity, totals }): MapNode => {
    const { id, name, artist, seed, years } = entity
    const previous = [...years.keys()].filter((heard) => heard < year).sort((a, b) => b - a)[0]
    const tracks = [...totals.tracks.values()].sort(compareTracks)
    return {
      id, name, artistName: artist, kind: 'listened', tags: [], radius: 0, tracks, tone: seed % 360,
      minutes: totals.milliseconds / 60_000, events: totals.events, lastPlayed: totals.lastPlayed,
      point: { x: (seed % 601) - 300, y: ((seed >>> 11) % 361) - 180 },
      rediscoveredAfter: totals.events >= 120 && previous !== undefined && year - previous >= 3 ? year - previous - 1 : undefined,
    }
  }), Infinity)
  if (nodes[0]) nodes[0].point = { x: 0, y: 0 }
  const days = new Map(entries.map(({ entity, totals }) => [entity.id, totals.days]))
  const edges = historyEdges(nodes, days)
  return { nodes, edges, complete: true }
}

function graphsFor(entities: Map<string, Entity>): Record<number, ListeningGraph> {
  const byYear = new Map<number, { entity: Entity; totals: AnnualTotals }[]>()
  for (const entity of entities.values()) {
    for (const [year, totals] of entity.years) {
      const entries = byYear.get(year) ?? []
      entries.push({ entity, totals })
      byYear.set(year, entries)
    }
  }
  return Object.fromEntries([...byYear].map(([year, entries]) => [year, graphFor(entries, year)]))
}

export function recordingTitleKey(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export async function loadHistory(files: readonly HistoryFile[], recordingTitles?: Set<string>, artworkTracks?: Map<string, string>): Promise<HistorySnapshot> {
  const audio = files.filter((file) => isAudioHistory(file.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (!audio.length) throw new HistoryError('Choose the Streaming_History_Audio_*.json files from an extracted Spotify Extended Streaming History export.')
  if (audio.some((file) => !Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxFileBytes)) {
    throw new HistoryError('Each audio JSON file must be 16 MB or smaller.')
  }
  if (audio.length > maxHistoryFiles || audio.reduce((sum, file) => sum + file.size, 0) > maxHistoryBytes) {
    throw new HistoryError('Choose up to 64 audio files with a combined size of 256 MB or less.')
  }
  const albums = new Map<string, Entity>()
  const artists = new Map<string, Entity>()
  const seen = new Set<string>()
  const trackIds = new Map<string, string>()
  const activeYears = new Set<number>()
  const counts = { events: 0, duplicates: 0, ignored: 0, invalid: 0 }
  let referenceTime = 0
  let countedRows = 0
  for (const file of audio) {
    const bytes = await file.read()
    if (bytes.byteLength !== file.size) throw new HistoryError('An audio file changed while it was being read. Select the files again.')
    const rows = parseHistoryJson(bytes)
    countedRows += rows.length
    if (countedRows > maxHistoryRows) throw new HistoryError('The selected files contain more than 500,000 rows.')
    for (const raw of rows) {
      const event = musicEvent(raw)
      if (typeof event === 'string') { counts[event]++; continue }
      const artistKey = identity(event.artist)
      const albumKey = albumIdentity(event.artist, event.album)
      const trackKey = event.trackUri ?? identity(event.track)
      const signature = JSON.stringify([event.timestamp, event.milliseconds, albumKey, trackKey])
      if (seen.has(signature)) { counts.duplicates++; continue }
      seen.add(signature)
      recordingTitles?.add(recordingTitleKey(event.track))
      if (artworkTracks && event.trackUri && !artworkTracks.has(albumKey)) {
        artworkTracks.set(albumKey, event.trackUri.slice('spotify:track:'.length))
      }
      if (artworkTracks && event.trackUri) {
        const key = artistIdentity(event.artist)
        if (!artworkTracks.has(key)) artworkTracks.set(key, event.trackUri.slice('spotify:track:'.length))
      }
      counts.events++
      activeYears.add(event.year)
      referenceTime = Math.max(referenceTime, event.timestamp)
      const key = event.trackUri ?? JSON.stringify([albumKey, trackKey])
      const trackId = trackIds.get(key) ?? `track-${trackIds.size + 1}`
      trackIds.set(key, trackId)
      const album = entityFor(albums, albumKey, event.album, event.artist)
      addPlay(album, event, trackId, album.seed % 360)
      addPlay(entityFor(artists, artistKey, event.artist), event, trackId, album.seed % 360)
    }
  }
  if (!counts.events) throw new HistoryError('No usable music playback events were found in these files.')
  const ends = [...activeYears].sort((a, b) => a - b)
  const years = Array.from({ length: ends[ends.length - 1] - ends[0] + 1 }, (_, index) => ends[0] + index)
  return { years, referenceTime, counts, graphs: { Artist: graphsFor(artists), Album: graphsFor(albums) } }
}
