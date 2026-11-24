import { day } from '../domain/listening.ts'

export const maxHistoryFiles = 64
export const maxFileBytes = 16 * 1024 * 1024
export const maxHistoryBytes = 256 * 1024 * 1024
export const maxHistoryRows = 500_000
export const maxTitleLength = 256
export const firstSupportedYear = 2006
export const lastSupportedYear = 2100
export const isAudioHistory = (name: string) => /^Streaming_History_Audio_[0-9][0-9_-]{0,30}\.json$/i.test(name)

export interface MusicEvent {
  timestamp: number
  year: number
  milliseconds: number
  artist: string
  album: string
  track: string
  trackUri?: string
}

export class HistoryError extends Error {}

function title(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > maxTitleLength) return undefined
  const cleaned = Array.from(value, (character) => {
    const code = character.codePointAt(0)!
    return code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) ? ' ' : character
  }).join('').replace(/\s+/gu, ' ').trim().normalize('NFC')
  return cleaned || undefined
}

export function musicEvent(value: unknown): MusicEvent | 'ignored' | 'invalid' {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'invalid'
  const row = value as Record<string, unknown>
  if (row.episode_name != null || row.spotify_episode_uri != null || row.audiobook_uri != null || row.audiobook_chapter_uri != null) return 'ignored'
  const artist = title(row.master_metadata_album_artist_name)
  const album = title(row.master_metadata_album_album_name)
  const track = title(row.master_metadata_track_name)
  const milliseconds = row.ms_played
  const date = row.ts
  if (!artist || !album || !track || typeof milliseconds !== 'number' || !Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > day ||
    typeof date !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(date)) return 'invalid'

  const timestamp = Date.parse(date)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== date.slice(0, 19)) return 'invalid'
  const year = Number(date.slice(0, 4))
  if (year < firstSupportedYear || year > lastSupportedYear) return 'invalid'
  const uri = row.spotify_track_uri
  const trackUri = typeof uri === 'string' && /^spotify:track:[a-z0-9]{22}$/i.test(uri) ? uri : undefined
  return { timestamp, year, milliseconds, artist, album, track, trackUri }
}

export function parseHistoryJson(bytes: Uint8Array | ArrayBuffer): unknown[] {
  if (bytes.byteLength > maxFileBytes) throw new HistoryError('Each audio JSON file must be 16 MB or smaller.')
  try {
    const file = new TextDecoder('utf-8', { fatal: true }).decode(bytes as Uint8Array<ArrayBuffer>)
    let depth = 0
    let quoted = false
    let escaped = false
    for (let i = 0; i < file.length; i++) {
      const code = file.charCodeAt(i)
      if (quoted) {
        if (escaped) escaped = false
        else if (code === 92) escaped = true
        else if (code === 34) quoted = false
      } else if (code === 34) quoted = true
      else if (code === 123 || code === 91) {
        if (++depth > 8) throw new HistoryError('The history JSON contains too many levels of nesting.')
      } else if (code === 125 || code === 93) depth--
    }
    const rows: unknown = JSON.parse(file)
    if (Array.isArray(rows)) return rows
  } catch (error) {
    if (error instanceof HistoryError) throw error
  }
  throw new HistoryError('An audio file is not a valid UTF-8 JSON array.')
}
