import { minutesPerBand } from '../domain/public-chart.ts'
import type { PublicChart, PublicEntry, PublicRecommendation } from '../domain/public-chart.ts'
import { exploreSuggestions, listenedEdges, maxListened } from './model.ts'
import type { ListeningGraph, MapNode, TimelineMode, View } from './model.ts'
import type { MapArchive } from './archive.ts'
import { catalogGenreResolver } from './catalog-genres.ts'
import { catalogArtistSimilarity } from './artist-similarity.ts'

const artistKey = (name: string) => name.trim().normalize('NFC').toLowerCase()

function chartRecords(chart: PublicChart, year: number, view: View, scope: TimelineMode) {
  if (scope === 'year') return (chart.charts[view][year] ?? []).map((row) => ({ ...row, bandYears: 1 }))
  const totals = new Map<string, { id: string; band: number; bandYears: number }>()
  for (const past of chart.years) {
    if (past > year) break
    for (const row of chart.charts[view][past] ?? []) {
      const entry = totals.get(row.id) ?? { id: row.id, band: 0, bandYears: 0 }
      entry.band += row.band
      entry.bandYears++
      totals.set(row.id, entry)
    }
  }
  const rank = chart.throughRanks?.[view][year]
  return rank ? rank.map((id) => totals.get(id)!) : [...totals.values()].sort((a, b) => b.band - a.band || a.id.localeCompare(b.id))
}

function discoveriesFor(entries: MapNode[], chart: PublicChart, catalog: ReadonlyMap<string, PublicEntry>, year: number, view: View, scope: TimelineMode): { nodes: MapNode[]; edges: ListeningGraph['edges'] } {
  const picksBySeed = new Map<string, PublicRecommendation[]>()
  for (const pick of chart.suggestions) {
    if (!('kind' in pick) || pick.kind !== view.toLowerCase()) continue
    const picks = picksBySeed.get(pick.seed) ?? []
    picks.push(pick)
    picksBySeed.set(pick.seed, picks)
  }
  if (picksBySeed.size === 0) return { nodes: [], edges: [] }
  const anchors = new Map<string, MapNode>()
  for (const node of entries) {
    const key = view === 'Artist' ? node.id : node.artistName?.toLowerCase()
    if (key && !anchors.has(key)) anchors.set(key, node)
  }
  const ranked = chartRecords(chart, year, 'Artist', scope)
  if (!entries.length) return { nodes: [], edges: [] }
  const seeds = new Set([...ranked.map(({ id }) => id), ...picksBySeed.keys()])
  const sources = [...seeds].flatMap((id) => {
    const picks = picksBySeed.get(id)
    if (!picks) return []
    const artist = catalog.get(id)?.name
    const anchor = anchors.get(view === 'Artist' ? id : artist?.toLowerCase() ?? '')
    return artist && picks.length ? [{ anchor, artist, picks }] : []
  })
  const nodes: MapNode[] = []
  const edges: ListeningGraph['edges'] = []
  const seen = new Set<string>()
  const add = (pick: PublicRecommendation, anchor: MapNode | undefined, artist: string) => {
    if (seen.has(pick.mbid) || nodes.length >= exploreSuggestions) return
    seen.add(pick.mbid)
    const id = `suggested-${pick.kind}-${pick.mbid}`
    nodes.push({
      id, name: pick.title, artistName: pick.artist, minutes: 0, events: 0, radius: 3.5, tags: [], tone: 0,
      point: { x: 0, y: 0 }, kind: 'discovery', tracks: [], recommendation: { kind: pick.kind, mbid: pick.mbid },
      reason: `This ${pick.kind} was discovered via ListenBrainz Radio using ${artist} as a seed${anchor ? '' : ' from the wider archive'}.`,
    })
    if (anchor) edges.push({ source: anchor.id, target: id, kind: 'discovery', strength: 0 })
  }
  const groups = [
    sources.filter(({ anchor }) => anchor && (anchor.rank ?? Infinity) <= maxListened),
    sources.filter(({ anchor }) => anchor && (anchor.rank ?? Infinity) > maxListened),
    sources.filter(({ anchor }) => !anchor),
  ]
  for (const group of groups) {
    const depth = Math.max(0, ...group.map(({ picks }) => picks.length))
    for (let index = 0; index < depth && nodes.length < exploreSuggestions; index++) {
      for (const { anchor, artist, picks } of group) if (picks[index]) add(picks[index], anchor, artist)
    }
  }
  return { nodes, edges }
}

function publicChartEdges(entries: MapNode[]) {
  const groups = new Map<string, MapNode[]>()
  const keys = (node: MapNode) => [
    ...(node.artistName ? [`artist:${artistKey(node.artistName)}`] : []),
    ...(node.genre ? [`genre:${node.genre}`] : []),
    ...node.tags.map((tag) => `tag:${tag}`),
  ]
  for (const node of entries) {
    for (const key of keys(node)) {
      const group = groups.get(key) ?? []
      if (group.length < 3) group.push(node)
      groups.set(key, group)
    }
  }
  return listenedEdges(entries, undefined, (node) => new Set(keys(node).flatMap((key) => groups.get(key) ?? [])))
}

export function publicArchive(chart: PublicChart, draft = false): MapArchive {
  const catalog = new Map(chart.catalog.map((entry) => [entry.id, entry]))
  const resolveGenre = catalogGenreResolver(chart.catalog)
  const artistSimilarity = catalogArtistSimilarity(chart.catalog)
  const cache = new Map<string, ListeningGraph>()
  return {
    demo: false, publicChart: true, draft, years: chart.years, firstYearShown: chart.years[chart.years.length - 1], referenceTime: 0,
    artistSuggestions: artistSimilarity && ((graph, id, limit) => artistSimilarity(graph, false, { id, limit })),
    exploreArtworkIds(view) {
      const prefix = view.toLowerCase() + '-'
      return new Set(chart.catalog.flatMap((entry) => entry.exploreArtwork && entry.id.startsWith(prefix) ? [entry.id] : []))
    },
    hasMusic: (year, scope) => chart.years.some((past) => (scope === 'through' ? past <= year : past === year) &&
      Boolean(chart.charts.Album[past]?.length || chart.charts.Artist[past]?.length)),
    graphAt(year, view, scope = 'year') {
      const key = `${year}/${view}/${scope}`
      const prior = cache.get(key)
      if (prior) return prior
      const records = chartRecords(chart, year, view, scope)
      const peak = records.reduce((largest, row) => Math.max(largest, row.band + 1), 1)
      const entries = records.map(({ id, band, bandYears }, index): MapNode => {
        const item = catalog.get(id)!
        const seed = Math.imul(Number(id.split('-')[1]), 2654435761) >>> 0
        return {
          id, name: item.name, artistName: item.artist, creditedArtists: item.creditedArtists, ...resolveGenre(item.name, item.artist),
          artwork: item.artwork, point: { x: (seed % 601) - 300, y: ((seed >>> 11) % 361) - 180 }, tone: seed % 360,
          minutes: band * minutesPerBand, events: 0, publicBand: band, publicBandYears: bandYears, rank: index + 1,
          radius: 1.25 + 4.5 * Math.sqrt((band + 1) / peak), kind: 'listened',
          tracks: (item.catalogTracks ?? item.playedTitles ?? []).map((name, index) => ({
            id: `${id}-track-${index}`, name, events: 0, coverTone: seed % 360,
            catalog: item.catalogTracks ? true : undefined, sharedTitle: item.catalogTracks ? undefined : true,
          })),
        }
      })
      const suggestions = discoveriesFor(entries, chart, catalog, year, view, scope)
      const base: ListeningGraph = { nodes: [...entries, ...suggestions.nodes], edges: [...publicChartEdges(entries), ...suggestions.edges], complete: true }
      const graph = view === 'Artist' && artistSimilarity ? artistSimilarity(base, true) : base
      if (cache.size >= 4) cache.delete(cache.keys().next().value!)
      cache.set(key, graph)
      return graph
    },
  }
}
