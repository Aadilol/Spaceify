import assert from 'node:assert/strict'
import { test } from 'node:test'
import { day, demoAlbums, demoAsOf, demoYears, initialYear } from '../src/domain/demo.ts'
import { constellationNodes, genreCells, hoursExtent, layoutGraph, supportsGenre } from '../src/graph/layout.ts'
import { isInk } from '../src/graph/dither.ts'
import { buildDemoGraph, formatDuration, rediscoveryGap } from '../src/graph/model.ts'
import { earlierPositions, recency, telescopeScene } from '../src/graph/exploration.ts'
import { drawGraph, maxSatellites } from '../src/graph/draw.ts'

test('album artwork follows rank, fades on hover, and stays with its satellites on selection', () => {
  const [top, second, background, missing] = buildDemoGraph(initialYear, 'Album').nodes
  const nodes = [top, second, background, missing]
  const graph = { nodes, edges: [{ source: top.id, target: second.id, strength: 1, kind: 'listened' as const }], complete: true as const }
  const frame = new Map(nodes.map((node, index) => [node.id, { node, radius: node.radius, point: { x: 8 * index, y: 0 } }]))
  const image = (id: string) => ({ id, naturalWidth: 100, naturalHeight: 100 }) as HTMLImageElement
  const catalog = new Map(nodes.slice(0, 3).map((node) => [node.id, image(node.id)]))
  const draws: { id: string; alpha: number }[] = []
  const fake = {
    globalAlpha: 1,
    clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {},
    measureText(text: string) { return { width: text.length * 6 } },
    drawImage(item: HTMLImageElement) { draws.push({ id: item.id, alpha: Math.round(this.globalAlpha * 10) / 10 }) },
  }
  const context = fake as unknown as CanvasRenderingContext2D
  const size = { width: 800, height: 600 }
  const camera = { x: 0, y: 0, zoom: 1 }
  drawGraph(context, size, camera, telescopeScene(graph, 'Hours', 1, top.id), frame, 'Hours', false, 'Album',
    undefined, top.id, undefined, catalog, 1)
  assert.deepEqual(draws, [{ id: background.id, alpha: 0.2 }, { id: second.id, alpha: 0.2 }, { id: top.id, alpha: 1 }])
  draws.length = 0
  drawGraph(context, size, camera, telescopeScene(graph, 'Hours', 1, top.id), frame, 'Hours', false, 'Album',
    top, null, undefined, catalog, 0, 500)
  assert.deepEqual(draws.map(({ id }) => id), [second.id, top.id, ...top.tracks.slice(0, maxSatellites).map(() => top.id)])
})

test('albums are ranked by the selected year and keep stable identities', () => {
  const first = buildDemoGraph(initialYear, 'Album')
  const next = buildDemoGraph(2025, 'Album')
  assert.equal(first.nodes[0].id, 'night-drive')
  assert.equal(next.nodes[0].id, 'afterimage')
  const night = next.nodes.find((node) => node.id === 'night-drive')!
  assert.equal(night.minutes, 1745)
  assert.equal(night.events, demoAlbums[0].years[2025].events)
  assert.equal(formatDuration(first.nodes[0].minutes), '36h 18m')
  assert.equal(formatDuration(0), '0m')
})

test('artist totals match annual album totals and exclude demo discoveries', () => {
  for (const year of demoYears) {
    const albums = buildDemoGraph(year, 'Album').nodes
    const artists = buildDemoGraph(year, 'Artist').nodes
    assert.equal(artists.reduce((total, node) => total + node.minutes, 0), albums.reduce((total, node) => total + node.minutes, 0))
    assert.equal(artists.reduce((total, node) => total + node.events, 0), albums.reduce((total, node) => total + node.events, 0))
  }
  const { nodes } = buildDemoGraph(2024, 'Artist')
  assert.equal(nodes.find((node) => node.id === 'artist-aster')?.minutes, 2543)
  assert.ok(nodes.some((node) => node.kind === 'discovery' && node.reason?.includes('Soft Relay')))
})

test('sparse links have valid endpoints, bounded scores and distinct discovery provenance', () => {
  for (const year of demoYears) {
    const graph = buildDemoGraph(year, 'Album')
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
    const edges = new Set<string>()
    assert.ok(graph.edges.filter((edge) => edge.kind === 'listened').length <= graph.nodes.filter((node) => node.rank).length * 2)
    for (const edge of graph.edges) {
      const key = [edge.source, edge.target].sort().join('/')
      assert.ok(!edges.has(key))
      edges.add(key)
      assert.ok(nodes.has(edge.source) && nodes.has(edge.target))
      assert.notEqual(edge.source, edge.target)
      assert.equal(nodes.get(edge.source)?.kind, 'listened')
      assert.equal(nodes.get(edge.target)?.kind, edge.kind)
      assert.ok(edge.strength >= 0 && edge.strength <= 1)
      if (edge.kind === 'discovery') assert.ok(nodes.get(edge.target)?.reason)
    }
  }
})

test('Hours radii follow listening rank and Genre groups have disjoint bounds', () => {
  const graph = buildDemoGraph(initialYear, 'Album')
  const natural = layoutGraph(graph, 'Hours')
  const grouped = layoutGraph(graph, 'Genre')
  assert.deepEqual(natural, layoutGraph(graph, 'Hours'))
  assert.notDeepEqual(natural, grouped)
  assert.ok(supportsGenre(graph))
  for (const positions of [natural, grouped]) {
    for (const node of graph.nodes) {
      const point = positions.get(node.id)!
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
      assert.ok(node.radius >= 1.25 && node.radius <= 5.75)
      for (const other of graph.nodes.filter((item) => item.id !== node.id)) {
        const target = positions.get(other.id)!
        assert.ok(Math.hypot(point.x - target.x, point.y - target.y) >= node.radius + other.radius)
      }
    }
  }
  const top = graph.nodes[0]
  assert.deepEqual(natural.get(top.id), { x: 0, y: 0 })
  const radii = graph.nodes.filter((node) => node.kind === 'listened').map((node) => {
    const point = natural.get(node.id)!
    return Math.hypot(point.x / hoursExtent.x, point.y / hoursExtent.y)
  })
  assert.ok(radii.slice(1).every((radius, index) => radius > radii[index]))
  const cells = [...genreCells(graph).values()]
  for (const [index, first] of cells.entries()) {
    for (const second of cells.slice(index + 1)) {
      assert.ok(Math.abs(first.center.x - second.center.x) - first.halfWidth - second.halfWidth > 50 ||
        Math.abs(first.center.y - second.center.y) - first.halfHeight - second.halfHeight > 50)
    }
  }
  const origin = grouped.get(top.id)!
  const distance = (id: string) => {
    const point = grouped.get(id)!
    return Math.hypot(origin.x - point.x, origin.y - point.y)
  }
  assert.ok(distance('low-orbit') < distance('afterimage'))
  assert.ok(constellationNodes(graph, top).every((node) => node.genre === top.genre))
})

test('track satellites account for the parent play events and discovered stars have no playback', () => {
  for (const year of demoYears) {
    for (const view of ['Artist', 'Album'] as const) {
      for (const node of buildDemoGraph(year, view).nodes) {
        assert.equal(node.tracks.reduce((total, track) => total + track.events, 0), node.events)
        assert.equal(new Set(node.tracks.map((track) => track.id)).size, node.tracks.length)
      }
    }
  }
})

test('an ordered 8 by 8 dither cell maps brightness to ink coverage', () => {
  const count = (density: number) => Array.from({ length: 64 }, (_, pixel) => isInk(pixel % 8, Math.floor(pixel / 8), density)).filter(Boolean).length
  assert.deepEqual([count(0), count(0.25), count(0.5), count(1)], [0, 16, 32, 64])
})

test('telescope levels reveal fainter stars and secondary links, and focus restores direct neighbors', () => {
  const graph = buildDemoGraph(2024, 'Album')
  const wide = telescopeScene(graph, 'Genre', 0.7)
  const overview = telescopeScene(graph, 'Genre', 1)
  const detail = telescopeScene(graph, 'Genre', 1.6)
  assert.ok(wide.nodes.size < overview.nodes.size && overview.nodes.size < detail.nodes.size)
  assert.ok(overview.edges.length < detail.edges.length)
  const focus = 'slow-exposure'
  const expected = new Set([focus, ...graph.edges.flatMap((edge) => edge.source === focus ? [edge.target] : edge.target === focus ? [edge.source] : [])])
  const focused = telescopeScene(graph, 'Genre', 0.7, focus)
  assert.deepEqual(focused.emphasis, expected)
  assert.ok([...expected].every((id) => focused.nodes.has(id)))
  assert.equal(telescopeScene(graph, 'Genre', 1, '<svg onload=alert(1)>').emphasis.size, 0)
})

test('demo recency and rediscovery use play dates and a substantial return after a real gap', () => {
  assert.ok(recency(demoAsOf - 9 * day) > recency(demoAsOf - 180 * day))
  assert.ok(recency(demoAsOf - 2 * 365 * day) < 0.01)
  for (const invalid of [undefined, NaN, -Infinity, demoAsOf + day]) assert.equal(recency(invalid), 0)
  const demo = buildDemoGraph(2024, 'Album').nodes.find((node) => node.id === 'slow-exposure')
  assert.equal(demo?.rediscoveredAfter, 2)
  assert.ok(earlierPositions(2024, 'Album', 'Genre').get('slow-exposure')?.length)
  assert.equal(earlierPositions(2016, 'Album', 'Genre').size, 0)
  assert.equal(earlierPositions(NaN, 'Album', 'Genre').size, 0)
  const minorReturn = (year: number) => year === 2024 ? 19 : year === 2019 ? 150 : 0
  assert.equal(rediscoveryGap(2024, minorReturn), undefined)
  assert.equal(rediscoveryGap(2015, () => 200), undefined)
})

test('empty, unsupported and singleton years have safe, intentional output', () => {
  for (const year of [2018, 2000, Number.NaN, Infinity]) {
    const empty = buildDemoGraph(year, 'Album')
    assert.deepEqual(empty, { nodes: [], edges: [] })
    assert.equal(layoutGraph(empty, 'Hours').size, 0)
    assert.equal(supportsGenre(empty), false)
  }
  const one = buildDemoGraph(2016, 'Album')
  assert.equal(one.nodes.length, 1)
  assert.equal(one.edges.length, 0)
  assert.equal(supportsGenre(one), false)
  assert.deepEqual(layoutGraph(one, 'Hours').get('slow-exposure'), { x: 0, y: 0 })
})
