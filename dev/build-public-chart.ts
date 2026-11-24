import { minutesPerBand } from '../src/domain/public-chart.ts'
import type { PublicChart, PublicEntry } from '../src/domain/public-chart.ts'
import type { HistorySnapshot } from '../src/domain/history.ts'
import { exploreArtworkIds } from '../src/domain/catalog-artwork.ts'

export function buildPublicChart(history: HistorySnapshot, includePlayedTitles = false): PublicChart {
  const catalog: PublicEntry[] = []
  const charts: PublicChart['charts'] = { Artist: {}, Album: {} }
  const throughRanks: NonNullable<PublicChart['throughRanks']> = { Artist: {}, Album: {} }
  for (const view of ['Artist', 'Album'] as const) {
    const display = (year: number) => history.graphs[view][year]?.nodes ?? []
    const imageEligible = exploreArtworkIds(view, history.years.flatMap((year) => history.graphs[view][year] ?? []))
    const entries = new Map(history.years.flatMap((year) => display(year).map((node) => [node.id, node] as const)))
    const titles = new Map<string, Set<string>>()
    if (view === 'Album' && includePlayedTitles) {
      for (const year of history.years) {
        for (const node of display(year)) {
          const names = titles.get(node.id) ?? new Set<string>()
          for (const track of node.tracks) names.add(track.name)
          titles.set(node.id, names)
        }
      }
    }
    const byHistoryId = new Map([...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.artistName ?? '').localeCompare(b.artistName ?? ''))
      .map((node, index) => {
        const id = `${view.toLowerCase()}-${index + 1}`
        const names = titles.get(node.id)
        catalog.push({ id, name: node.name, artist: node.artistName, exploreArtwork: imageEligible.has(node.id) ? true : undefined,
          playedTitles: names?.size ? [...names].sort((a, b) => a.localeCompare(b)) : undefined })
        return [node.id, id]
      }))
    const lifetime = new Map<string, number>()
    for (const year of history.years) {
      charts[view][year] = display(year).map((node) => {
        const id = byHistoryId.get(node.id)!
        lifetime.set(id, (lifetime.get(id) ?? 0) + Math.round(node.minutes * 60_000))
        return { id, band: Math.min(17_568, Math.floor(node.minutes / minutesPerBand)) }
      })
      throughRanks[view][year] = [...lifetime].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)
    }
  }
  return { version: 1, years: [...history.years], catalog, charts, throughRanks, suggestions: [] }
}
