import { draftChartPath, isPublicChart, maxPublicChartBytes, publicChartFile } from '../domain/public-chart.ts'
import type { CatalogArt, PublicChart, PublicEntry } from '../domain/public-chart.ts'
import { artworkIdentity } from '../domain/catalog-artwork.ts'
import { fetchLocalHistory, localHistoryHeader } from './local-history.ts'
import { privateArchive } from '../graph/archive.ts'
import type { MapArchive } from '../graph/archive.ts'
import { publicArchive } from '../graph/public-archive.ts'
import type { HistorySnapshot } from '../domain/history.ts'
import { catalogGenreResolver } from '../graph/catalog-genres.ts'

export interface DefaultChart {
  archive: MapArchive
  privateHistory?: HistorySnapshot
  catalogArtwork?: Map<string, CatalogArt>
  catalogGenres?: ReturnType<typeof catalogGenreResolver>
  catalogCredits?: Map<string, string[]>
  artistCatalog?: readonly PublicEntry[]
}

function ownerDefault(chart: PublicChart, draft = false): DefaultChart {
  const catalogArtwork = new Map<string, CatalogArt>()
  const catalogCredits = new Map<string, string[]>()
  for (const entry of chart.catalog) {
    if (entry.artwork) catalogArtwork.set(artworkIdentity(entry.name, entry.artist), entry.artwork)
    if (entry.artist && entry.creditedArtists) catalogCredits.set(artworkIdentity(entry.name, entry.artist), entry.creditedArtists)
  }
  const artistCatalog = chart.catalog.some((entry) => entry.similarArtists?.length) ? chart.catalog.filter((entry) => !entry.artist) : undefined
  return { archive: publicArchive(chart, draft), catalogArtwork, catalogGenres: catalogGenreResolver(chart.catalog), catalogCredits, artistCatalog }
}

async function readChart(url: string | URL, signal: AbortSignal, draft = false): Promise<PublicChart | null> {
  const headers = draft ? { [localHistoryHeader]: 'local' } : undefined
  const response = await fetch(url, { signal, mode: 'same-origin', credentials: 'same-origin', headers, redirect: 'error' })
  if (response.status === 404) return null
  if (!response.ok || !response.body) throw new Error('Owner chart unavailable.')
  const type = response.headers.get('Content-Type')
  if (type?.startsWith('text/html')) return null
  if (!type?.startsWith('application/json')) throw new Error('Owner chart unavailable.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxPublicChartBytes) {
      await reader.cancel()
      throw new Error('Owner chart exceeds its size limit.')
    }
    text += decoder.decode(value, { stream: true })
  }
  const data: unknown = JSON.parse(text + decoder.decode())
  if (!isPublicChart(data)) throw new Error('Owner chart is invalid.')
  return data
}

export async function fetchDefaultChart(signal: AbortSignal, preferPrivate = false): Promise<DefaultChart | null> {
  if (import.meta.env.DEV && preferPrivate) {
    const [history, draft] = await Promise.all([
      fetchLocalHistory(signal), readChart(draftChartPath, signal, true).catch(() => null),
    ])
    if (!history) throw new Error('Private owner history is unavailable.')
    const { archive, catalogArtwork, catalogGenres, catalogCredits, artistCatalog } = draft ? ownerDefault(draft, true) : {}
    return { archive: privateArchive(history, catalogGenres, catalogCredits, archive, artistCatalog),
      privateHistory: history, catalogArtwork, catalogGenres, catalogCredits, artistCatalog }
  }
  if (import.meta.env.DEV) {
    const draft = await readChart(draftChartPath, signal, true)
    if (draft) return ownerDefault(draft, true)
  }
  const chart = await readChart(new URL(publicChartFile, document.baseURI), signal)
  if (chart) return ownerDefault(chart)
  if (import.meta.env.DEV) {
    const history = await fetchLocalHistory(signal)
    if (history) return { archive: privateArchive(history), privateHistory: history }
  }
  return null
}
