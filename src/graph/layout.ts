import type { Point } from '../domain/listening.ts'
import type { ListeningGraph, LayoutMode, MapNode } from './model.ts'

export const denseMapSize = 100
export const hoursExtent = { x: 350, y: 184 }
const goldenAngle = Math.PI * (3 - Math.sqrt(5))

export interface GenreCell {
  center: Point
  halfWidth: number
  halfHeight: number
}

export function constellationNodes(graph: ListeningGraph, selected: MapNode): MapNode[] {
  if ((!selected.genre && selected.kind === 'listened') || selected.recommendation) {
    const neighbors = new Set<string>([selected.id])
    for (const edge of graph.edges) {
      if (edge.source === selected.id) neighbors.add(edge.target)
      if (edge.target === selected.id) neighbors.add(edge.source)
    }
    return graph.nodes.filter((node) => neighbors.has(node.id))
  }
  return graph.nodes.filter((node) => node.kind === 'listened' && (node.id === selected.id || (selected.genre && node.genre === selected.genre)))
}

export function supportsGenre(graph: ListeningGraph): boolean {
  const groups = new Set<string>()
  for (const node of graph.nodes) {
    if (node.kind !== 'listened') continue
    groups.add(genreGroup(node))
    if (groups.size > 1) return true
  }
  return false
}

const multipleGenres = '\0'
export const genreGroup = (node: MapNode) => node.genre ?? (node.tags.length ? multipleGenres : '')
export const genreGroupLabel = (group: string) => group === multipleGenres ? 'Multiple genres' : group || 'Untagged'

export function genreCells(graph: ListeningGraph): Map<string, GenreCell> {
  const counts = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.kind !== 'listened') continue
    const genre = genreGroup(node)
    counts.set(genre, (counts.get(genre) ?? 0) + 1)
  }
  const groups = [...counts].sort((a, b) => Number(!a[0]) - Number(!b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length * 1.65)))
  const rows = Math.max(1, Math.ceil(groups.length / columns))
  const width = 704 / columns
  const height = 368 / rows
  return new Map(groups.map(([genre], index) => {
    const row = Math.floor(index / columns)
    const inRow = Math.min(columns, groups.length - row * columns)
    const column = index % columns
    const offset = ((column + row * 2) % 3 - 1) * Math.min(24, height * 0.08)
    return [genre, {
      center: { x: (column - (inRow - 1) / 2) * width, y: (row - (rows - 1) / 2) * height + offset },
      halfWidth: Math.max(1, (width - Math.min(132, width * 0.66)) / 2),
      halfHeight: Math.max(1, Math.min(112, (height - Math.min(138, height * 0.7)) / 2 - Math.abs(offset))),
    }]
  }))
}

function hoursLayout(nodes: MapNode[]): Map<string, Point> {
  return new Map(nodes.map((node, index) => {
    if (index === 0) return [node.id, { x: 0, y: 0 }]
    const ratio = index / Math.max(1, nodes.length - 1)
    const radius = Math.sqrt(ratio)
    const stagger = ((node.tone % 37) / 37 - 0.5) * 0.46
    const angle = index * goldenAngle + stagger
    return [node.id, { x: Math.cos(angle) * hoursExtent.x * radius, y: Math.sin(angle) * hoursExtent.y * radius }]
  }))
}

function genreLayout(graph: ListeningGraph, nodes: MapNode[]): Map<string, Point> {
  const cells = genreCells(graph)
  const grouped = new Map<string, MapNode[]>()
  for (const node of nodes) {
    const key = genreGroup(node)
    const group = grouped.get(key) ?? []
    group.push(node)
    grouped.set(key, group)
  }
  const positions = new Map<string, Point>()
  for (const [key, group] of grouped) {
    const cell = cells.get(key)!
    for (const [index, node] of group.entries()) {
      const radius = Math.sqrt(index / Math.max(1, group.length - 1))
      const angle = index * goldenAngle + (node.tone % 23) * 0.035
      positions.set(node.id, {
        x: cell.center.x + Math.cos(angle) * cell.halfWidth * radius,
        y: cell.center.y + Math.sin(angle) * cell.halfHeight * radius,
      })
    }
  }
  return positions
}

export function layoutGraph(graph: ListeningGraph, mode: LayoutMode): Map<string, Point> {
  const listened = graph.nodes.filter((node) => node.kind === 'listened').sort((a, b) => {
    const rank = (a.rank ?? Infinity) - (b.rank ?? Infinity)
    return (a.publicBand !== undefined && b.publicBand !== undefined ? rank : b.minutes - a.minutes || rank) || a.id.localeCompare(b.id)
  })
  const positions = mode === 'Genre' ? genreLayout(graph, listened) : hoursLayout(listened)
  const orbit = graph.nodes.filter((node) => node.kind === 'discovery')
  for (const [index, node] of orbit.entries()) {
    const angle = index / orbit.length * Math.PI * 2 - 0.27 + ((node.tone % 19) - 9) * 0.013
    positions.set(node.id, { x: Math.cos(angle) * 384, y: Math.sin(angle) * 213 })
  }
  return positions
}
