import { demoAsOf, demoYears } from '../domain/demo.ts'
import type { HistorySnapshot } from '../domain/history.ts'
import type { ListeningTrack } from '../domain/listening.ts'
import { compareTracks } from '../domain/history.ts'
import { artworkIdentity, exploreArtworkIds } from '../domain/catalog-artwork.ts'
import { buildDemoGraph, rankListened } from './model.ts'
import type { ListeningGraph, MapNode, TimelineMode, View } from './model.ts'
import type { catalogGenreResolver } from './catalog-genres.ts'
import type { PublicEntry } from '../domain/public-chart.ts'
import { catalogArtistSimilarity } from './artist-similarity.ts'

export interface MapArchive {
  demo: boolean
  publicChart?: boolean
  draft?: boolean
  years: readonly number[]
  firstYearShown: number
  referenceTime: number
  hasMusic: (year: number, scope?: TimelineMode) => boolean
  exploreArtworkIds?: (view: View) => ReadonlySet<string>
  artistSuggestions?: (graph: ListeningGraph, id: string, limit: number) => ListeningGraph
  graphAt: (year: number, view: View, scope?: TimelineMode) => ListeningGraph
}

function throughGraph(years: readonly number[], annual: (year: number, view: View) => ListeningGraph, complete?: true) {
  const latest = new Map<View, { year: number; graph: ListeningGraph }>()
  return (year: number, view: View, scope: TimelineMode = 'year'): ListeningGraph => {
    if (scope === 'year') return annual(year, view)
    const previous = latest.get(view)
    if (previous?.year === year) return previous.graph
    const entries = new Map<string, { node: MapNode; tracks: Map<string, ListeningTrack> }>()
    const edges = new Map<string, ListeningGraph['edges'][number]>()
    for (const past of years) {
      if (past > year) break
      const graph = annual(past, view)
      for (const node of graph.nodes) {
        if (node.kind !== 'listened') continue
        let entry = entries.get(node.id)
        if (!entry) {
          entry = { node: { ...node, minutes: 0, events: 0, tracks: [], rediscoveredAfter: undefined }, tracks: new Map() }
          entries.set(node.id, entry)
        }
        entry.node.minutes += node.minutes
        entry.node.events += node.events
        entry.node.lastPlayed = node.lastPlayed ?? entry.node.lastPlayed
        for (const track of node.tracks) {
          const earlier = entry.tracks.get(track.id)
          if (earlier) {
            earlier.events += track.events
            earlier.milliseconds = (earlier.milliseconds ?? 0) + (track.milliseconds ?? 0)
          } else entry.tracks.set(track.id, { ...track })
        }
      }
      for (const edge of graph.edges) {
        if (edge.kind !== 'listened') continue
        const key = `${edge.source}/${edge.target}`
        if ((edges.get(key)?.strength ?? -1) < edge.strength) edges.set(key, edge)
      }
    }
    const nodes = rankListened([...entries.values()].map(({ node, tracks }) => ({
      ...node, tracks: [...tracks.values()].sort(compareTracks),
    })), Infinity)
    const graph = { nodes, edges: [...edges.values()], complete }
    latest.set(view, { year, graph })
    return graph
  }
}

const demoHasMusic = (year: number) => buildDemoGraph(year, 'Album').nodes.length > 0
export const demoArchive: MapArchive = {
  demo: true, years: demoYears, firstYearShown: demoYears.at(-1)!, referenceTime: demoAsOf,
  hasMusic: (year, scope) => scope === 'through' ? demoYears.some((past) => past <= year && demoHasMusic(past)) : demoHasMusic(year),
  graphAt: throughGraph(demoYears, buildDemoGraph),
}

const emptyGraph: ListeningGraph = { nodes: [], edges: [] }

export function privateArchive(history: HistorySnapshot, resolveGenre?: ReturnType<typeof catalogGenreResolver>,
  catalogCredits?: ReadonlyMap<string, string[]>, ownerSuggestions?: MapArchive, artistCatalog?: readonly PublicEntry[]): MapArchive {
  const hasYear = (year: number) => Boolean(history.graphs.Album[year]?.nodes.length)
  const graphAt = throughGraph(history.years, (year, view) => history.graphs[view][year] ?? emptyGraph, true)
  const tagged = new WeakMap<ListeningGraph, ListeningGraph>()
  const imageEligible = new Map<View, ReadonlySet<string>>()
  const artistSimilarity = artistCatalog && catalogArtistSimilarity(artistCatalog,
    history.years.flatMap((year) => history.graphs.Artist[year]?.nodes.map((node) => node.name) ?? []))
  return {
    demo: false,
    years: history.years,
    firstYearShown: history.years[history.years.length - 1],
    referenceTime: history.referenceTime,
    artistSuggestions: artistSimilarity && ((graph, id, limit) => artistSimilarity(graph, false, { id, limit })),
    exploreArtworkIds(view) {
      const ids = imageEligible.get(view) ?? exploreArtworkIds(view, history.years.map((year) => history.graphs[view][year] ?? emptyGraph))
      imageEligible.set(view, ids)
      return ids
    },
    hasMusic: (year, scope) => scope === 'through' ? history.years.some((past) => past <= year && hasYear(past)) : hasYear(year),
    graphAt(year, view, scope) {
      const graph = graphAt(year, view, scope)
      if (!ownerSuggestions && !resolveGenre && (!catalogCredits?.size || view !== 'Album') && !(artistSimilarity && view === 'Artist')) return graph
      const prior = tagged.get(graph)
      if (prior) return prior
      const nodes: MapNode[] = graph.nodes.map((node) => {
        const creditedArtists = node.artistName ? catalogCredits?.get(artworkIdentity(node.name, node.artistName)) : undefined
        return { ...node, ...resolveGenre?.(node.name, node.artistName), creditedArtists }
      })
      let edges = graph.edges
      if (ownerSuggestions && nodes.length) {
        const candidates = ownerSuggestions.graphAt(year, view, scope)
        const picks = candidates.nodes.filter((node) => node.recommendation)
        const anchors = new Map(candidates.nodes.filter((node) => node.kind === 'listened').map((node) => [node.id, node]))
        const matching = new Map(nodes.map((node) => [artworkIdentity(node.name, node.artistName), node.id]))
        edges = [...edges]
        for (const edge of candidates.edges) {
          if (edge.kind !== 'discovery') continue
          const anchor = anchors.get(edge.source)
          const source = anchor && matching.get(artworkIdentity(anchor.name, anchor.artistName))
          if (source) edges.push({ ...edge, source })
        }
        nodes.push(...picks)
      }
      const base = { ...graph, nodes, edges }
      const result = view === 'Artist' && artistSimilarity ? artistSimilarity(base, Boolean(ownerSuggestions)) : base
      tagged.set(graph, result)
      return result
    },
  }
}
