import { catalogMbid, isSimilarArtist, maxSimilarArtists } from '../src/domain/public-chart.ts'
import type { SimilarArtist } from '../src/domain/public-chart.ts'

// This is the model used by ListenBrainz's public artist page.
const similarArtistModel = 'session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30'

export function validListenBrainzContact(value: string) {
  if (value.length > 256 || /[^\x21-\x7e]|[()]/.test(value)) return false
  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}

export async function boundedBody(response: Response, limit: number) {
  if (!response.body || Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel()
    throw new Error('Invalid catalog response size.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) {
      await reader.cancel()
      throw new Error('Invalid catalog response size.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function seconds(value: string | null) {
  return value && /^\d{1,8}$/.test(value) ? Number(value) : 0
}

export function listenBrainzCooldown(response: Response) {
  const exhausted = response.status === 429 || response.headers.get('X-RateLimit-Remaining') === '0'
  return exhausted ? seconds(response.headers.get('X-RateLimit-Reset-In')) || seconds(response.headers.get('Retry-After')) || 60 : 0
}

export function parseSimilarArtists(body: unknown, seed: string) {
  if (!Array.isArray(body) || body.length > 200) throw new Error('Invalid artist similarity response.')
  const accepted = new Map<string, SimilarArtist>()
  for (const item of body as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (typeof row.reference_mbid !== 'string' || row.reference_mbid.toLowerCase() !== seed) continue
    const candidate = {
      mbid: typeof row.artist_mbid === 'string' ? row.artist_mbid.toLowerCase() : undefined,
      name: typeof row.name === 'string' ? row.name.trim().normalize('NFC') : undefined,
      score: row.score,
    }
    if (isSimilarArtist(candidate) && candidate.mbid !== seed && (accepted.get(candidate.mbid)?.score ?? 0) < candidate.score) {
      accepted.set(candidate.mbid, candidate)
    }
  }
  return [...accepted.values()].sort((a, b) => b.score - a.score).slice(0, maxSimilarArtists)
}

export async function fetchListenBrainzSimilarArtists(id: string, contact: string, request: typeof fetch = fetch, signal?: AbortSignal) {
  if (!catalogMbid.test(id) || !validListenBrainzContact(contact)) throw new Error('Invalid similarity request.')
  const seed = id.toLowerCase()
  const url = new URL('https://labs.api.listenbrainz.org/similar-artists/json')
  url.search = new URLSearchParams({ artist_mbids: seed, algorithm: similarArtistModel }).toString()
  const timeout = AbortSignal.timeout(12_000)
  const response = await request(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error',
    headers: { Accept: 'application/json', 'User-Agent': `ListeningMap/0.1 (${contact})` },
  })
  const cooldown = listenBrainzCooldown(response)
  if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
    await response.body?.cancel()
    return { cooldown, status: response.status }
  }
  try {
    const body: unknown = JSON.parse((await boundedBody(response, 256 * 1024)).toString('utf8'))
    return { cooldown, status: response.status, rows: parseSimilarArtists(body, seed) }
  } catch {
    return { cooldown, status: response.status }
  }
}
