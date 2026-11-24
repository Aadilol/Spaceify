import type { PublicChart } from '../src/domain/public-chart.ts'
import { maxListened } from '../src/graph/model.ts'

export function ownerArtworkOrder(chart: PublicChart, includeRemainder = true) {
  const ordered = new Set<string>()
  const years = [...chart.years].reverse()
  function addFocus(albums: readonly string[], artists: readonly string[]) {
    for (let rank = 0; rank < maxListened; rank++) {
      if (albums[rank]) ordered.add(albums[rank])
      if (artists[rank]) ordered.add(artists[rank])
    }
  }
  for (const year of years) {
    addFocus(chart.charts.Album[year].slice(0, maxListened).map(({ id }) => id),
      chart.charts.Artist[year].slice(0, maxListened).map(({ id }) => id))
  }
  for (const year of years) addFocus(chart.throughRanks?.Album[year] ?? [], chart.throughRanks?.Artist[year] ?? [])
  if (!includeRemainder) return [...ordered]
  const latest = years[0]
  for (const view of ['Album', 'Artist'] as const) {
    for (const id of chart.throughRanks?.[view][latest] ?? []) ordered.add(id)
  }
  return [...ordered]
}
