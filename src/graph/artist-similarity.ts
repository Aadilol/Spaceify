import { artistIdentity } from '../domain/history.ts'
import type { PublicEntry, SimilarArtist } from '../domain/public-chart.ts'
import { exploreSuggestions, maxListened } from './model.ts'
import type { ListeningGraph, MapNode } from './model.ts'

export function catalogArtistSimilarity(catalog: readonly PublicEntry[], lifetimeNames?: Iterable<string>) {
  const artists = catalog.filter((entry) => !entry.artist)
  if (!artists.some((entry) => entry.similarArtists?.length)) return
  const history = new Set(Array.from(lifetimeNames ?? artists.map((entry) => entry.name), artistIdentity))
  const namesByMbid = new Map(artists.flatMap((entry) => entry.artistMbid && history.has(artistIdentity(entry.name))
    ? [[entry.artistMbid.toLowerCase(), artistIdentity(entry.name)] as const] : []))
  const allSeeds = artists.filter((entry) => entry.similarArtists?.length && history.has(artistIdentity(entry.name)))
  if (!allSeeds.length) return
  const heard = (name: string, mbid: string) => namesByMbid.has(mbid.toLowerCase()) || history.has(artistIdentity(name))

  return (graph: ListeningGraph, includeArchiveSeeds = false, selected?: { id: string; limit: number }): ListeningGraph => {
    const listened = graph.nodes.filter((node) => node.kind === 'listened')
    if (!listened.length) return graph
    const period = new Map(listened.map((node) => [artistIdentity(node.name), node]))
    const sources = allSeeds.flatMap((seed) => {
      const anchor = period.get(artistIdentity(seed.name))
      if (selected && anchor?.id !== selected.id) return []
      return anchor || includeArchiveSeeds ? [{ seed, anchor }] : []
    }).sort((a, b) => (a.anchor?.rank ?? Infinity) - (b.anchor?.rank ?? Infinity))
    if (selected && !sources.length) return graph
    const limit = selected?.limit ?? exploreSuggestions
    const edges = new Map<string, ListeningGraph['edges'][number]>()
    const outside = new Map<string, { candidate: SimilarArtist; name: string; anchors: Set<string>; archived: boolean }>()
    const pools = sources.map(({ seed, anchor }) => {
      const candidates = seed.similarArtists!
      const peak = Math.max(...candidates.map((candidate) => candidate.score))
      const picks: string[] = []
      for (const candidate of candidates) {
        const key = candidate.mbid.toLowerCase()
        const peer = period.get(namesByMbid.get(key) ?? artistIdentity(candidate.name))
        if (anchor && peer && peer.id !== anchor.id) {
          const [source, target] = [anchor.id, peer.id].sort()
          const id = `${source}/${target}`
          const strength = 0.75 + 0.25 * (candidate.score / peak)
          if ((edges.get(id)?.strength ?? 0) < strength) edges.set(id, { source, target, strength, kind: 'listened', basis: 'listenbrainz' })
        }
        if (peer || heard(candidate.name, key)) continue
        const suggestion = outside.get(key) ?? { candidate, name: seed.name, anchors: new Set<string>(), archived: !anchor }
        if (anchor) suggestion.anchors.add(anchor.id)
        outside.set(key, suggestion)
        picks.push(key)
      }
      return { anchor, picks }
    })
    const ids = new Set<string>()
    const groups = [
      pools.filter(({ anchor }) => anchor && (anchor.rank ?? Infinity) <= maxListened),
      pools.filter(({ anchor }) => anchor && (anchor.rank ?? Infinity) > maxListened),
      pools.filter(({ anchor }) => !anchor),
    ]
    for (const group of groups) {
      const depth = group.reduce((largest, { picks }) => Math.max(largest, picks.length), 0)
      for (let index = 0; index < depth && ids.size < limit; index++) {
        for (const { picks } of group) if (ids.size < limit && picks[index]) ids.add(picks[index])
      }
    }
    const suggestions: MapNode[] = []
    const discoveryEdges: ListeningGraph['edges'] = []
    for (const key of ids) {
      const { candidate, name, anchors, archived } = outside.get(key)!
      const id = `suggested-artist-${key}`
      suggestions.push({ id, name: candidate.name, tracks: [], radius: 3.5, events: 0, minutes: 0, tags: [],
        kind: 'discovery', tone: 0, point: { x: 0, y: 0 },
        recommendation: { kind: 'artist', mbid: key, source: 'artist-similarity' },
        reason: `ListenBrainz lists this artist as similar to ${name}${archived ? ' from the wider archive' : ''}.`,
      })
      for (const source of anchors) discoveryEdges.push({ source, target: id, kind: 'discovery', strength: 0 })
    }
    if (suggestions.length < limit) {
      for (const node of graph.nodes) {
        const pick = node.recommendation
        if (pick?.kind !== 'artist' || ids.has(pick.mbid.toLowerCase()) || heard(node.name, pick.mbid)) continue
        ids.add(pick.mbid.toLowerCase())
        suggestions.push(node)
        if (suggestions.length >= limit) break
      }
    }
    const suggestionsInView = new Set(suggestions.map((node) => node.id))
    const retained = graph.edges.filter((edge) => {
      if (edge.kind === 'discovery') return suggestionsInView.has(edge.target) && !discoveryEdges.some((item) => item.target === edge.target)
      const endpoints = [edge.source, edge.target].sort().join('/')
      return !edges.has(endpoints)
    })
    return { ...graph, nodes: [...listened, ...suggestions], edges: [...edges.values(), ...retained, ...discoveryEdges] }
  }
}
