import { demoAsOf } from '../domain/demo.ts'
import { day } from '../domain/listening.ts'
import type { Point } from '../domain/listening.ts'
import { demoArchive } from './archive.ts'
import type { MapArchive } from './archive.ts'
import { denseMapSize, genreGroup, layoutGraph, supportsGenre } from './layout.ts'
import { focusSuggestions, listenedEdges, maxListened } from './model.ts'
import type { ChartDensity, ListeningGraph, LayoutMode, MapNode, TimelineMode, View } from './model.ts'

export type YearTrails = Map<string, Point[]>

const creditName = (name: string) => name.trim().normalize('NFC').toLowerCase()
const genericCredit = new Set(['', 'various artists', 'various', 'unknown artist'])

export function relatedAlbumIds(graph: ListeningGraph, selected?: MapNode) {
  const linked = new Set<string>()
  if (!selected?.artistName || selected.kind !== 'listened') return linked
  const artist = creditName(selected.artistName)
  if (genericCredit.has(artist)) return linked
  for (const node of graph.nodes) {
    if (node.id !== selected.id && node.kind === 'listened' && node.artistName &&
      (creditName(node.artistName) === artist || node.creditedArtists?.some((name) => creditName(name) === artist))) linked.add(node.id)
  }
  return linked
}

export function curatedGraph(graph: ListeningGraph, compareCatalogTags = false, expandedAlbums?: ReadonlySet<string>): ListeningGraph {
  if (!graph.complete) return graph
  const listened = graph.nodes.filter((node) => node.kind === 'listened').slice(0, maxListened)
  const included = new Set(listened.map((node) => node.id))
  const anchored = new Set(graph.edges.filter((edge) => edge.kind === 'discovery' && included.has(edge.source)).map((edge) => edge.target))
  const candidates = graph.nodes.filter((node) => node.kind === 'discovery')
  const suggestions = [...candidates.filter((node) => anchored.has(node.id)), ...candidates.filter((node) => !anchored.has(node.id))].slice(0, focusSuggestions)
  const selectedSuggestions = new Set(suggestions.map((node) => node.id))
  const providerLinks = new Set(graph.edges.filter((edge) => edge.basis === 'listenbrainz')
    .map((edge) => [edge.source, edge.target].sort().join('/')))
  const curatedEdges = compareCatalogTags ? listenedEdges(listened).filter((edge) => !providerLinks.has(`${edge.source}/${edge.target}`)) : []
  const additional = graph.nodes.filter((node) => expandedAlbums?.has(node.id) && !included.has(node.id))
  const extras = new Set(additional.map((node) => node.id))
  for (const node of additional) included.add(node.id)
  const edges = graph.edges.filter((edge) => included.has(edge.source) && (edge.kind === 'discovery'
    ? selectedSuggestions.has(edge.target)
    : included.has(edge.target) && (!compareCatalogTags || edge.basis === 'listenbrainz' || extras.has(edge.source) || extras.has(edge.target))))
  return { nodes: [...listened, ...additional, ...suggestions], edges: [...curatedEdges, ...edges], complete: true }
}

export function focusNeighborhood(graph: ListeningGraph, selected: string, albumLinks = relatedAlbumIds(graph, graph.nodes.find((node) => node.id === selected))) {
  const linked = graph.edges.flatMap((edge) => {
    const id = edge.source === selected ? edge.target : edge.target === selected ? edge.source : undefined
    return id ? [{ id, strength: edge.strength, kind: edge.kind, catalog: edge.basis === 'listenbrainz' }] : []
  })
  const suggestions = linked.filter((edge) => edge.kind === 'discovery')
  const similar = linked.filter((edge) => edge.kind === 'listened' && !albumLinks.has(edge.id))
  const closest = graph.nodes.length > denseMapSize ? similar
    .sort((a, b) => Number(b.catalog) - Number(a.catalog) || b.strength - a.strength || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, 15 - suggestions.length)) : similar
  return new Set([selected, ...albumLinks, ...closest.map((edge) => edge.id), ...suggestions.map((edge) => edge.id)])
}

export function telescopeScene(graph: ListeningGraph, mode: LayoutMode, zoom: number, focus?: string,
  focusedIds?: ReadonlySet<string>, albumLinks?: ReadonlySet<string>) {
  const dense = graph.nodes.length > denseMapSize
  const entries = dense ? graph.nodes : graph.nodes.filter((node) => node.kind === 'listened').sort((a, b) => (b.publicBand ?? b.events) - (a.publicBand ?? a.events) || a.id.localeCompare(b.id))
  const count = dense ? denseMapSize : Math.ceil(entries.length * (zoom < 0.9 ? 0.48 : zoom < 1.22 ? 0.72 : 1))
  const bright = new Set(entries.slice(0, count).map((node) => node.id))
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const genres = new Set<string>()
  const genreLeaders = new Set<string>()
  for (const node of entries) {
    if (node.rediscoveredAfter && zoom >= 0.9) bright.add(node.id)
    const group = genreGroup(node)
    if (mode !== 'Genre' || node.kind !== 'listened' || genres.has(group)) continue
    bright.add(node.id)
    genreLeaders.add(node.id)
    genres.add(group)
  }

  const emphasis = focusedIds ?? (focus && byId.has(focus) ? focusNeighborhood(graph, focus, new Set()) : new Set<string>())
  const nodes = dense || graph.complete ? new Set(byId.keys()) : new Set([...bright, ...emphasis])
  for (const edge of graph.edges) {
    if (byId.get(edge.target)?.recommendation && zoom >= 0.9) {
      nodes.add(edge.source)
      nodes.add(edge.target)
    }
    if (edge.kind === 'discovery' && bright.has(edge.source) && zoom >= 0.9) nodes.add(edge.target)
  }

  const candidates = graph.edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target) &&
    (!focusedIds || (edge.source !== focus && edge.target !== focus) || (focusedIds.has(edge.source) && focusedIds.has(edge.target))) &&
    (!dense || edge.kind === 'discovery' || (bright.has(edge.source) && bright.has(edge.target)) ||
      (emphasis.has(edge.source) && emphasis.has(edge.target))) && (
    mode !== 'Genre' || edge.basis === 'listenbrainz' || byId.get(edge.target)?.recommendation ||
    byId.get(edge.source)?.genre === byId.get(edge.target)?.genre || edge.source === focus || edge.target === focus
  ))
  if (focus && albumLinks?.size) {
    const connected = new Set(candidates.flatMap((edge) => edge.source === focus ? [edge.target] : edge.target === focus ? [edge.source] : []))
    for (const id of albumLinks) if (nodes.has(id) && !connected.has(id)) {
      candidates.push({ source: focus, target: id, strength: 1, kind: 'listened' })
    }
  }
  const primary = new Map<string, ListeningGraph['edges'][number]>()
  for (const edge of candidates) {
    if (edge.kind !== 'listened') continue
    for (const id of [edge.source, edge.target]) {
      if ((primary.get(id)?.strength ?? -1) < edge.strength) primary.set(id, edge)
    }
  }
  const chief = new Set(primary.values())
  const edges = candidates.filter((edge) => zoom >= 1.22 || edge.kind === 'discovery' || chief.has(edge) || edge.source === focus || edge.target === focus)
  return { nodes, edges, emphasis, primary: chief, focus, genreLeaders }
}

export type TelescopeScene = ReturnType<typeof telescopeScene>

export function recency(lastPlayed: number | undefined, asOf = demoAsOf): number {
  if (!lastPlayed || !Number.isFinite(lastPlayed) || !Number.isFinite(asOf) || lastPlayed > asOf) return 0
  return Math.exp(-(asOf - lastPlayed) / (day * 65))
}

export function earlierPositions(year: number, view: View, mode: LayoutMode, archive: MapArchive = demoArchive, scope: TimelineMode = 'year', density: ChartDensity = 'Explore'): YearTrails {
  if (!archive.years.includes(year)) return new Map()
  const trails: YearTrails = new Map()
  const pastYears = archive.years.filter((item) => item < year)
  for (const past of scope === 'through' ? pastYears.slice(-3) : pastYears) {
    const full = archive.graphAt(past, view, scope)
    const graph = density === 'Focus' ? curatedGraph(full, archive.publicChart) : full
    if (graph.nodes.length > denseMapSize) continue
    const positions = layoutGraph(graph, supportsGenre(graph) ? mode : 'Hours')
    for (const node of graph.nodes) {
      if (node.kind !== 'listened') continue
      const position = positions.get(node.id)
      if (!position) continue
      const path = trails.get(node.id) ?? []
      path.push(position)
      if (path.length > 3) path.shift()
      trails.set(node.id, path)
    }
  }
  return trails
}
