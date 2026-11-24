import type { ListeningTrack, Point } from '../domain/listening.ts'
import { ink, isInk, mono, paper } from './dither.ts'
import { discoveryLabel, formatExactDuration, formatPublicBand } from './model.ts'
import { denseMapSize, genreGroup, genreGroupLabel } from './layout.ts'
import type { MapNode, LayoutMode, View } from './model.ts'
import type { TelescopeScene, YearTrails } from './exploration.ts'

export interface VisualNode { node: MapNode; point: Point; radius: number; twinkle?: number }
export interface Size { width: number; height: number }
export interface Camera { x: number; y: number; zoom: number }
interface ArtworkBounds { screen: Point; extent: number }
type ScreenNode = VisualNode & { screen: Point }
interface LabelBounds { x: number; y: number; width: number; height: number }
const selectedBlue = '#65b3ff'
const relatedBlue = '#9bb6d1'

export function projection(size: Size, camera: Camera) {
  return {
    x: size.width / 2 + camera.x,
    y: size.height * 0.475 + camera.y,
    scale: Math.min(size.width / 830, Math.max(size.height - 216, 64) / 480, 1.56) * camera.zoom,
  }
}

export function screenPoint(point: Point, view: ReturnType<typeof projection>): Point {
  return { x: view.x + point.x * view.scale, y: view.y + point.y * view.scale }
}

export function nodePhase(id: string): number {
  let hash = 7
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return (hash % 360) * Math.PI / 180
}

export const maxSatellites = 6

export function satellitePoints(size: Size, center: Point, tracks: ListeningTrack[]) {
  const visible = tracks.slice(0, maxSatellites)
  return visible.map((track, index) => {
    const angle = index / visible.length * Math.PI * 2 - 0.82
    const radius = Math.min(size.width * 0.235, 133) * (index % 2 ? 0.83 : 1)
    return { track, point: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * 0.76 } }
  })
}

export function artworkSide(radius: number, scale: number) {
  return Math.round(Math.max(18, Math.min(72, (15 + radius * 5) * Math.sqrt(scale))))
}

export function satelliteSide(scale: number) {
  return Math.round(Math.max(14, Math.min(24, 14 * Math.sqrt(scale))))
}

export function artworkForNode(node: MapNode, catalog: ReadonlyMap<string, HTMLImageElement>) {
  return node.recommendation ? undefined : catalog.get(node.id)
}

export function artworkForTrack(view: View, focus: MapNode, catalog: ReadonlyMap<string, HTMLImageElement>) {
  return view === 'Album' ? catalog.get(focus.id) : undefined
}

function drawArtwork(context: CanvasRenderingContext2D, point: Point, side: number, active: boolean, image: HTMLImageElement) {
  const left = Math.round(point.x - side / 2)
  const top = Math.round(point.y - side / 2)
  const scale = (side - 2) / Math.max(image.naturalWidth, image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.fillStyle = paper
  context.fillRect(left, top, side, side)
  context.fillStyle = ink
  context.imageSmoothingEnabled = true
  context.drawImage(image, point.x - width / 2, point.y - height / 2, width, height)
  context.imageSmoothingEnabled = false
  context.strokeRect(left + 0.5, top + 0.5, side - 1, side - 1)
  if (active) context.strokeRect(left - 2.5, top - 2.5, side + 5, side + 5)
}

const sky = Array.from({ length: 168 }, (_, index) => ({
  x: ((index * 347 + 59) % 1289) / 1289,
  y: ((index * index * 23 + index * 73 + 79) % 1327) / 1327,
  cross: index % 28 === 5,
}))

function drawSky(context: CanvasRenderingContext2D, size: Size, camera: Camera, dim: boolean) {
  const xOffset = camera.x * 0.065
  const yOffset = camera.y * 0.065
  for (const [index, star] of sky.entries()) {
    if (dim && index % 4 !== 1) continue
    if (size.width < 650 && index % 3 === 0) continue
    const x = Math.floor((star.x * size.width + xOffset) % size.width)
    const y = Math.floor((star.y * size.height + yOffset) % size.height)
    context.fillRect(x, y, 1, 1)
    if (star.cross && !dim) {
      context.fillRect(x - 2, y, 5, 1)
      context.fillRect(x, y - 2, 1, 5)
    }
  }
}

const halos = Array.from({ length: 4 }, (_, index) => {
  const radius = 13 + index * 7
  const points: Point[] = []
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const distance = Math.hypot(x, y)
      const density = Math.max(0, 1 - distance / radius) ** 2 * (0.13 + index * 0.043)
      if (distance > 4 && isInk(x, y, density)) points.push({ x, y })
    }
  }
  return points
})

function line(context: CanvasRenderingContext2D, from: Point, to: Point, spacing: number) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.floor(Math.hypot(dx, dy) / spacing)
  for (let i = 1; i <= steps; i++) {
    context.fillRect(Math.round(from.x + dx * i / steps), Math.round(from.y + dy * i / steps), 1, 1)
  }
}

function ring(context: CanvasRenderingContext2D, center: Point, radius: number) {
  for (let step = 0; step < 10; step++) {
    const angle = step / 10 * Math.PI * 2
    context.fillRect(Math.round(center.x + Math.cos(angle) * radius), Math.round(center.y + Math.sin(angle) * radius), 1, 1)
  }
}

function comet(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  for (let step = 1; step < 10; step++) {
    const tailX = x - radius - 5 - step * 4
    const tailY = y + Math.round(step * 1.45)
    context.fillRect(tailX, tailY, 1, 1)
    if (step < 5) context.fillRect(tailX - 1, tailY + 2, 1, 1)
  }
}

function star(context: CanvasRenderingContext2D, node: VisualNode, point: Point, scale: number, highlighted: boolean, dim: boolean) {
  const x = Math.round(point.x)
  const y = Math.round(point.y)
  if (dim) {
    context.fillRect(x, y, 1, 1)
    return
  }
  if (node.node.kind === 'discovery') {
    if (node.node.spotifyAlbumId) {
      for (let dx = -4; dx <= 4; dx++) {
        const dy = 4 - Math.abs(dx)
        context.fillRect(x + dx, y - dy, 1, 1)
        context.fillRect(x + dx, y + dy, 1, 1)
      }
    } else {
      context.fillRect(x - 1, y - 3, 3, 1)
      context.fillRect(x - 1, y + 3, 3, 1)
      context.fillRect(x - 3, y - 1, 1, 3)
      context.fillRect(x + 3, y - 1, 1, 3)
    }
    if (highlighted) ring(context, point, 10)
    return
  }
  const radius = Math.max(1, Math.min(8, Math.round(node.radius * Math.max(scale, 0.58) * 0.77)))
  const density = Math.min(halos.length - 1, Math.max(0, Math.round(node.radius) - 2))
  const twinkle = node.twinkle ?? 0
  if (node.radius > 2.5) {
    for (const [index, offset] of halos[density].entries()) {
      if (index % 5 !== 0 || twinkle > 0.28) context.fillRect(x + offset.x, y + offset.y, 1, 1)
    }
  }
  if (node.radius >= 4.5 || highlighted || twinkle > 0.68) {
    const length = radius * 2 + 4 + Math.round(twinkle * 3)
    context.fillRect(x - length, y, length * 2 + 1, 1)
    context.fillRect(x, y - length, 1, length * 2 + 1)
    context.fillRect(x - radius, y - 1, radius * 2 + 1, 3)
    context.fillRect(x - 1, y - radius, 3, radius * 2 + 1)
  } else {
    context.fillRect(x - 1, y - 1, radius + 1, radius + 1)
  }
  if (highlighted) ring(context, point, radius + 8)
  if (node.node.rediscoveredAfter) comet(context, x, y, radius)
}

function write(context: CanvasRenderingContext2D, text: string, x: number, y: number, color: string = ink) {
  const name = text.toUpperCase()
  context.fillStyle = paper
  context.fillRect(x - 2, y - 1, Math.ceil(context.measureText(name).width) + 4, 13)
  context.fillStyle = color
  context.fillText(name, x, y)
  context.fillStyle = ink
}

function annotation(context: CanvasRenderingContext2D, size: Size, point: Point, text: string, detail?: string, extent = 0,
  nearbyArt: ArtworkBounds[] = [], labelColor: string = ink, occupied?: LabelBounds[]) {
  context.font = `${detail ? 'bold ' : ''}${size.width < 560 ? 10 : 12}px ${mono}`
  const labelLimit = Math.min(size.width - 24, 265)
  if (context.measureText(text.toUpperCase()).width > labelLimit) {
    const characters = Array.from(text)
    while (characters.length > 1 && context.measureText(`${characters.join('').toUpperCase()}…`).width > labelLimit) characters.pop()
    text = `${characters.join('')}…`
  }
  const width = Math.max(context.measureText(text.toUpperCase()).width, detail ? context.measureText(detail.toUpperCase()).width : 0)
  const baseY = Math.min(size.height - 86, Math.max(91, point.y - Math.max(31, extent + 8)))
  const right = point.x + 37 + extent
  const left = point.x - 37 - extent - width
  const labelHeight = detail ? 28 : 13
  const rightBlocked = nearbyArt.some(({ screen, extent }) =>
    screen.x + extent >= right - 2 && screen.x - extent <= right + width + 2 &&
    screen.y + extent >= baseY - 1 && screen.y - extent <= baseY + labelHeight)
  const preferredSide = right + width >= size.width - 13 || (rightBlocked && left >= 9) ? -1 : 1
  const sides = occupied ? [preferredSide, -preferredSide] : [preferredSide]
  const offsets = occupied ? [0, -17, 17, -34, 34, -51, 51, -68, 68] : [0]
  const overlaps = (a: LabelBounds, b: LabelBounds) => a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
  const placements = offsets.flatMap((offset) => sides.map((side) => ({
    side, x: Math.min(size.width - width - 9, Math.max(9, side === 1 ? right : left)),
    y: Math.min(size.height - 86, Math.max(91, baseY + offset)), width: width + 4, height: labelHeight + 3,
  })))
  const place = placements.find((candidate) => !occupied?.some((other) => overlaps(candidate, other)) &&
    (!occupied || !nearbyArt.some(({ screen, extent }) => overlaps(candidate, {
      x: screen.x - extent, y: screen.y - extent, width: extent * 2, height: extent * 2,
    })))) ?? placements.find((candidate) => !occupied?.some((other) => overlaps(candidate, other)))
  if (!place) return
  occupied?.push(place)
  const { x, y, side } = place
  const elbow = { x: point.x + side * (19 + extent), y: y + 5 }
  line(context, { x: point.x + side * (6 + extent), y: point.y }, elbow, 1.5)
  line(context, elbow, { x: point.x + side * (32 + extent), y: elbow.y }, 1.5)
  write(context, text, x, y, labelColor)
  if (detail) {
    context.font = `11px ${mono}`
    write(context, detail, x, y + 15)
  }
}

export function drawGraph(
  context: CanvasRenderingContext2D, size: Size, camera: Camera, scene: TelescopeScene,
  frame: Map<string, VisualNode>, mode: LayoutMode, demo: boolean, imageView?: View, focus?: MapNode, hover?: string | null,
  trails?: { positions: YearTrails; age: number }, catalog = new Map<string, HTMLImageElement>(),
  hoverFade = 0, twinkleTime?: number,
) {
  context.clearRect(0, 0, size.width, size.height)
  const view = projection(size, camera)
  const eventUnit = demo ? 'plays' : 'events'
  if (view.scale <= 0) return
  context.fillStyle = ink
  context.strokeStyle = ink
  context.imageSmoothingEnabled = false
  context.textBaseline = 'top'
  drawSky(context, size, camera, scene.emphasis.size > 0)
  const dense = frame.size > denseMapSize
  const visible = new Map<string, ScreenNode>()
  const foreground = (id: string) => !imageView || !focus || scene.emphasis.has(id)
  for (const [id, item] of frame) {
    if (!scene.nodes.has(id)) continue
    const screen = screenPoint(item.point, view)
    if (dense && (screen.x < -85 || screen.y < -85 || screen.x > size.width + 85 || screen.y > size.height + 85)) continue
    if (dense && item.node.kind === 'listened' && (item.node.rank ?? 0) > denseMapSize && camera.zoom < 5 &&
      id !== scene.focus && !scene.emphasis.has(id) && !scene.genreLeaders.has(id) &&
      !(imageView && catalog.has(id)) && (!imageView || !focus)) {
      context.fillRect(Math.round(screen.x), Math.round(screen.y), 1, 1)
      continue
    }
    visible.set(id, { ...item, screen })
  }
  const isDim = (id: string) => scene.emphasis.size > 0 && !scene.emphasis.has(id)
  if (trails) {
    for (const [id, item] of visible) {
      const path = trails.positions.get(id)
      if (!path?.length || isDim(id)) continue
      const points = [...path, item.point].map((point) => screenPoint(point, view))
      for (let i = 1; i < points.length; i++) {
        line(context, points[i - 1], points[i], 5 + (points.length - i) * 2 + trails.age * 9)
      }
    }
  }
  function drawEdges(front: boolean) {
    for (const edge of scene.edges) {
      if ((foreground(edge.source) && foreground(edge.target)) !== front) continue
      const from = visible.get(edge.source)
      const to = visible.get(edge.target)
      if (!from || !to) continue
      const subdued = scene.focus && edge.source !== scene.focus && edge.target !== scene.focus
      const spacing = edge.kind === 'discovery' ? 7 : scene.primary.has(edge) ? 1.75 : 3.25
      line(context, from.screen, to.screen, subdued ? (edge.kind === 'discovery' ? 22 : 15) : spacing)
    }
  }
  drawEdges(false)
  if (imageView && focus) {
    for (const [id, item] of visible) {
      if (foreground(id)) continue
      const x = Math.round(item.screen.x)
      const y = Math.round(item.screen.y)
      context.fillRect(x, y, 1, 1)
      if (twinkleTime !== undefined && Math.sin(twinkleTime / 720 + item.node.tone) > 0.78) {
        context.fillRect(x - 1, y, 3, 1)
        context.fillRect(x, y - 1, 1, 3)
      }
    }
  }
  drawEdges(true)

  const engaged = focus && visible.get(focus.id)
  const satellites = engaged && !isDim(engaged.node.id) ? satellitePoints(size, engaged.screen, engaged.node.tracks) : []
  if (engaged) {
    for (const { point } of satellites) line(context, engaged.screen, point, 5)
  }
  const primaryByGenre = new Map<string, ArtworkBounds>()
  const nearbyArt: ArtworkBounds[] = []
  const imageExtents = new Map<string, number>()
  const artwork: { item: ScreenNode; image: HTMLImageElement }[] = []
  for (const item of visible.values()) {
    if (!foreground(item.node.id)) continue
    const dim = isDim(item.node.id)
    const active = item.node.id === scene.focus
    const image = imageView && artworkForNode(item.node, catalog)
    const side = image ? artworkSide(item.radius, view.scale) : 0
    if (image) {
      nearbyArt.push({ screen: item.screen, extent: side / 2 })
      imageExtents.set(item.node.id, side / 2)
      artwork.push({ item, image })
    } else star(context, item, item.screen, view.scale, active, dim)
    const genre = genreGroup(item.node)
    if (!focus && mode === 'Genre' && item.node.kind === 'listened' && !primaryByGenre.has(genre)) {
      primaryByGenre.set(genre, { screen: item.screen, extent: side / 2 })
    }
  }
  if (imageView) {
    for (let index = artwork.length - 1; index >= 0; index--) {
      const { item, image } = artwork[index]
      const { node } = item
      const extent = imageExtents.get(node.id)!
      context.globalAlpha = hover === node.id ? 1 : 1 - hoverFade * 0.8
      if (node.rediscoveredAfter && !isDim(node.id)) comet(context, Math.round(item.screen.x), Math.round(item.screen.y), extent)
      drawArtwork(context, item.screen, extent * 2, node.id === scene.focus, image)
    }
    context.globalAlpha = 1
  }
  if (!scene.focus && mode === 'Genre') {
    const hovered = hover ? visible.get(hover)?.node : undefined
    const hoveredGenre = hovered ? genreGroup(hovered) : undefined
    for (const [genre, { screen, extent }] of primaryByGenre) {
      if (genre !== hoveredGenre) annotation(context, size, screen, genreGroupLabel(genre), undefined, extent, nearbyArt)
    }
  }

  const trackImage = imageView && focus && artworkForTrack(imageView, focus, catalog)
  const trackSide = trackImage ? satelliteSide(view.scale) : 0
  const occupied: LabelBounds[] = []
  for (const { track, point } of satellites) {
    const active = track.id === hover
    if (trackImage) {
      context.globalAlpha = active ? 1 : 1 - hoverFade * 0.8
      drawArtwork(context, point, trackSide, active, trackImage)
      context.globalAlpha = 1
    } else context.fillRect(Math.round(point.x) - 1, Math.round(point.y) - 1, 3, 3)
    if (active) {
      if (!trackSide) ring(context, point, 7)
      annotation(context, size, point, track.name, track.catalog ? 'Catalog track' : track.sharedTitle ? 'Shared track title' :
        track.milliseconds !== undefined ? formatExactDuration(track.milliseconds) : `${track.events} ${eventUnit}`,
        trackSide / 2, nearbyArt, ink, occupied)
    } else if (size.width >= 720) {
      context.font = `10px ${mono}`
      const x = point.x + 7 + trackSide / 2
      const y = point.y + 5
      write(context, track.name, x, y)
      occupied.push({ x: x - 2, y: y - 1, width: context.measureText(track.name.toUpperCase()).width + 4, height: 14 })
    }
  }

  const drawLabel = (item: ScreenNode, summary: boolean, color: string, occupied?: LabelBounds[]) => {
    const { node, screen } = item
    const detail = !summary ? undefined : node.kind === 'discovery' ? discoveryLabel(node) : node.publicBand !== undefined
      ? formatPublicBand(node.publicBand, node.publicBandYears) : `${node.events.toLocaleString('en-US')} ${eventUnit}`
    annotation(context, size, screen, node.name, detail, imageExtents.get(node.id),
      nearbyArt, color, occupied)
  }
  if (engaged) {
    drawLabel(engaged, true, selectedBlue, occupied)
    const related = [...scene.emphasis].filter((id) => id !== focus?.id).sort((a, b) => Number(b === hover) - Number(a === hover))
    for (const id of related) {
      const item = visible.get(id)
      if (item && item.screen.x >= 0 && item.screen.x <= size.width && item.screen.y >= 0 && item.screen.y <= size.height) {
        drawLabel(item, id === hover, relatedBlue, occupied)
      }
    }
  } else if (!focus && hover) {
    const item = visible.get(hover)
    if (item) drawLabel(item, true, selectedBlue)
  }
}
