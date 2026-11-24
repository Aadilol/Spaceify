import type { HistorySnapshot } from '../domain/history.ts'
import { firstSupportedYear, lastSupportedYear, maxHistoryRows, maxTitleLength } from './history-json.ts'

export const localHistoryPath = '/__listening-map/local-history'
export const localHistoryHeader = 'x-listening-map'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= maxTitleLength
const entityId = (id: unknown): id is string => typeof id === 'string' && /^(?:artist|album)-[1-9]\d{0,5}$/.test(id)

function validGraph(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.nodes) || value.nodes.length > maxHistoryRows || !Array.isArray(value.edges) || value.edges.length > value.nodes.length * 2) return false
  const ids = new Set<string>()
  for (const node of value.nodes as unknown[]) {
    if (!record(node) || !entityId(node.id) || ids.has(node.id) || !text(node.name) || (node.artistName !== undefined && !text(node.artistName)) ||
      node.kind !== 'listened' || !Array.isArray(node.tags) || node.tags.length !== 0 || node.genre !== undefined || node.spotifyAlbumId !== undefined ||
      !nonnegative(node.minutes) || !nonnegative(node.events) || !nonnegative(node.tone) || !nonnegative(node.rank) || !nonnegative(node.radius) ||
      !nonnegative(node.lastPlayed) || node.lastPlayed > Date.UTC(2101, 0, 1) ||
      (node.rediscoveredAfter !== undefined && !nonnegative(node.rediscoveredAfter)) ||
      !record(node.point) || typeof node.point.x !== 'number' || Math.abs(node.point.x) > 300 ||
      typeof node.point.y !== 'number' || Math.abs(node.point.y) > 180 || !Array.isArray(node.tracks) || node.tracks.length > node.events) return false
    if (!(node.tracks as unknown[]).every((track) => record(track) && text(track.id) && text(track.name) &&
      nonnegative(track.events) && nonnegative(track.coverTone) && (track.milliseconds === undefined || nonnegative(track.milliseconds)))) return false
    ids.add(node.id)
  }
  return (value.edges as unknown[]).every((edge) => record(edge) && edge.kind === 'listened' && entityId(edge.source) &&
    entityId(edge.target) && edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target) && nonnegative(edge.strength) && edge.strength <= 1)
}

function isHistory(value: unknown): value is HistorySnapshot {
  if (!record(value) || !Array.isArray(value.years) || !value.years.length || value.years.length > lastSupportedYear - firstSupportedYear + 1 ||
    !nonnegative(value.referenceTime) || !record(value.counts) || !record(value.graphs)) return false
  const years: unknown[] = value.years
  if (!years.every((year, index) => nonnegative(year) && Number.isInteger(year) && year >= firstSupportedYear && year <= lastSupportedYear &&
    (index === 0 || year - (years[index - 1] as number) === 1))) return false
  if (![value.counts.events, value.counts.duplicates, value.counts.ignored, value.counts.invalid].every((count) => nonnegative(count) && Number.isSafeInteger(count))) return false
  for (const graph of [value.graphs.Artist, value.graphs.Album]) {
    if (!record(graph) || !Object.entries(graph).every(([year, entry]) => years.includes(Number(year)) && validGraph(entry))) return false
  }
  return true
}

export async function fetchLocalHistory(signal: AbortSignal): Promise<HistorySnapshot | null> {
  const response = await fetch(localHistoryPath, {
    signal, mode: 'same-origin', cache: 'no-store', headers: { [localHistoryHeader]: 'local' },
  })
  if (response.status === 404) return null
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('Local history could not be read.')
  const value: unknown = await response.json()
  if (!isHistory(value)) throw new Error('Local history could not be read.')
  return value
}
