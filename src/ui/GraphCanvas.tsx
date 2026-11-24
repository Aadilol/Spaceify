import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Point } from '../domain/listening.ts'
import type { CatalogArt } from '../domain/public-chart.ts'
import type { MapArchive } from '../graph/archive.ts'
import { artworkForNode, artworkForTrack, artworkSide, drawGraph, nodePhase, projection, satellitePoints, satelliteSide, screenPoint } from '../graph/draw.ts'
import type { Camera, Size, VisualNode } from '../graph/draw.ts'
import { constellationNodes, denseMapSize, genreCells, genreGroup, layoutGraph } from '../graph/layout.ts'
import type { GenreCell } from '../graph/layout.ts'
import { earlierPositions, recency, telescopeScene } from '../graph/exploration.ts'
import type { TelescopeScene } from '../graph/exploration.ts'
import type { ChartDensity, ListeningGraph, LayoutMode, MapNode, TimelineMode, View } from '../graph/model.ts'

const homeCamera: Camera = { x: 0, y: 0, zoom: 1 }
const motionQuery = '(prefers-reduced-motion: reduce)'
const zoomStops = [0.6, 0.8, 1, 1.25, 1.56, 1.95, 2.44, 2.65]
const denseZoomStops = [...zoomStops, 3.3, 4.15, 5.2, 6.5, 8.1, 10.1, 12.6, 15.8, 19.75, 24.7]
const wheelThreshold = 54
const tweenDuration = 270

interface Drag {
  pointer: number
  start: Point
  camera: Camera
  id?: string
  satellite: boolean
  offset: Point
  cell?: GenreCell
  moved: boolean
}

const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const blend = (a: number, b: number, t: number) => a + (b - a) * t

function nextZoom(zoom: number, direction: number, stops: number[]): number {
  if (direction > 0) return stops.find((stop) => stop > zoom) ?? zoom
  return stops[stops.findIndex((stop) => stop >= zoom) - 1] ?? zoom
}

function zoomAt(camera: Camera, size: Size, from: Point, to: Point, zoom: number): Camera {
  const scale = zoom / camera.zoom
  const origin = projection(size, camera)
  return {
    zoom,
    x: camera.x + to.x - origin.x - (from.x - origin.x) * scale,
    y: camera.y + to.y - origin.y - (from.y - origin.y) * scale,
  }
}

interface Props {
  graph: ListeningGraph
  overview: ListeningGraph
  archive: MapArchive
  mode: LayoutMode
  density: ChartDensity
  year: number
  scope: TimelineMode
  view: View
  showImages: boolean
  resolvedArtwork?: ReadonlyMap<string, CatalogArt>
  focus?: MapNode
  focusedIds?: ReadonlySet<string>
  albumLinks: ReadonlySet<string>
  onSelect: (id: string) => void
  onExitFocus: () => void
  onZoom: () => void
}

export function GraphCanvas({ graph, overview, archive, mode, density, year, scope, view, showImages, resolvedArtwork, focus, focusedIds, albumLinks, onSelect, onExitFocus, onZoom }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frame = useRef(new Map<string, VisualNode>())
  const stillFrame = useRef(new Map<string, VisualNode>())
  const size = useRef<Size>({ width: 0, height: 0 })
  const pins = useRef(new Map<string, Point>())
  const camera = useRef(homeCamera)
  const overviewCamera = useRef<Camera | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ camera: Camera; center: Point; distance: number } | null>(null)
  const invalidate = useRef(() => {})
  const hover = useRef<string | null>(null)
  const visibleStars = useRef(new Set<string>())
  const artworkCache = useRef(new Map<string, HTMLImageElement | null>())
  const readyImages = useRef(new Map<string, HTMLImageElement>())
  const imageFade = useRef(0)
  const trailSession = useRef({ year, started: -Infinity })
  const [hovered, setHovered] = useState(false)
  const layout = useMemo(() => layoutGraph(graph, mode), [graph, mode])
  const cells = useMemo(() => mode === 'Genre' ? genreCells(graph) : undefined, [graph, mode])
  const dense = graph.nodes.length > denseMapSize
  const stops = dense ? denseZoomStops : zoomStops
  const history = useMemo(() => dense ? new Map() : earlierPositions(year, view, mode, archive, scope, density), [year, view, mode, archive, scope, density, dense])
  const previousLayout = useRef<typeof layout | null>(null)
  const isEmpty = graph.nodes.length === 0

  const updateCamera = useCallback((next: Camera) => {
    camera.current = next
    invalidate.current()
  }, [])

  const clearHover = useCallback(() => {
    hover.current = null
    setHovered(false)
    invalidate.current()
  }, [])

  const resetLayout = useCallback(() => {
    pins.current.clear()
    overviewCamera.current = null
    clearHover()
    updateCamera(homeCamera)
  }, [clearHover, updateCamera])

  const turnZoom = useCallback((direction: number, point: Point) => {
    const previous = camera.current
    const zoom = nextZoom(previous.zoom, direction, stops)
    if (zoom === previous.zoom) return
    updateCamera(zoomAt(previous, size.current, point, point, zoom))
    clearHover()
    onZoom()
  }, [clearHover, onZoom, stops, updateCamera])

  useLayoutEffect(() => {
    resetLayout()
  }, [overview, mode, resetLayout])

  useLayoutEffect(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    clearHover()
    if (!focus) {
      if (overviewCamera.current) updateCamera(overviewCamera.current)
      overviewCamera.current = null
      return
    }
    const members = constellationNodes(graph, focus)
    const point = pins.current.get(focus.id) ?? layout.get(focus.id)
    if (!point || members.length === 0) return

    overviewCamera.current ??= camera.current
    const narrow = rect.width < 660
    const zoom = Math.max(dense ? 3.3 : narrow ? 2.45 : 2.12, overviewCamera.current.zoom)
    if (graph.complete && albumLinks.size) {
      const bounds = { left: point.x, right: point.x, top: point.y, bottom: point.y }
      for (const id of albumLinks) {
        const related = pins.current.get(id) ?? layout.get(id)
        if (!related) continue
        bounds.left = Math.min(bounds.left, related.x)
        bounds.right = Math.max(bounds.right, related.x)
        bounds.top = Math.min(bounds.top, related.y)
        bounds.bottom = Math.max(bounds.bottom, related.y)
      }
      const baseScale = projection(rect, homeCamera).scale
      const fitted = Math.min(zoom, rect.width * 0.82 / (Math.max(1, bounds.right - bounds.left) * baseScale),
        rect.height * 0.66 / (Math.max(1, bounds.bottom - bounds.top) * baseScale))
      const scale = fitted * baseScale
      updateCamera({ x: -(bounds.left + bounds.right) / 2 * scale, y: -(bounds.top + bounds.bottom) / 2 * scale, zoom: fitted })
      return
    }
    const centroid = members.reduce((center, node) => {
      const item = pins.current.get(node.id) ?? layout.get(node.id) ?? point
      return { x: center.x + item.x / members.length, y: center.y + item.y / members.length }
    }, { x: 0, y: 0 })
    const { scale } = projection(rect, { ...homeCamera, zoom })
    const framing = dense ? 0 : narrow ? 0.12 : 0.34
    updateCamera({
      x: -blend(point.x, centroid.x, framing) * scale,
      y: -blend(point.y, centroid.y, framing) * scale,
      zoom,
    })
  }, [focus, graph, layout, dense, albumLinks, clearHover, updateCamera])

  useLayoutEffect(() => {
    const started = performance.now()
    const changedYear = trailSession.current.year !== year
    if (changedYear) trailSession.current = { year, started }
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      frame.current.clear()
      stillFrame.current.clear()
      previousLayout.current = null
      invalidate.current = () => {}
      return
    }

    const from = stillFrame.current
    const media = window.matchMedia(motionQuery)
    let animation = 0
    let lastFrame = -Infinity
    let assetView = ''
    let cached: { key: string; scene: TelescopeScene } | undefined
    const previousGraph = previousLayout.current
    previousLayout.current = layout
    const animate = graph.nodes.length <= 3000 && (changedYear || (previousGraph !== null && previousGraph !== layout))
    const shown = new Map<string, VisualNode>()
    const base = new Map<string, VisualNode>()
    const offsets = new Map(graph.nodes.map((node) => [node.id, {
      phase: nodePhase(node.id), recent: recency(node.lastPlayed, archive.referenceTime),
      item: { node, point: { x: 0, y: 0 }, radius: node.radius, twinkle: 0 },
    }]))
    const catalog = new Map<string, HTMLImageElement>()
    readyImages.current = catalog
    const imageResults = artworkCache.current
    const pending = new Map<string, HTMLImageElement>()
    const assets = showImages && resolvedArtwork ? Array.from(resolvedArtwork, ([nodeId, art]) => ({ nodeId, url: art.url })) : []

    function updateImages() {
      const { width, height } = size.current
      const { x, y, zoom } = camera.current
      const key = [width, height, x, y, zoom].join('/')
      if (key === assetView || !assets.length) return
      assetView = key
      const projectionAtCamera = projection(size.current, camera.current)
      catalog.clear()
      let shownAssets = 0
      for (const { nodeId, url } of assets) {
        if (focus && !focusedIds?.has(nodeId)) continue
        const position = shown.get(nodeId)?.point
        if (!position) continue
        const point = screenPoint(position, projectionAtCamera)
        if (density === 'Explore' && nodeId !== focus?.id &&
          (point.x < -40 || point.x > width + 40 || point.y < -40 || point.y > height + 40)) continue
        const loaded = imageResults.get(url)
        if (loaded) catalog.set(nodeId, loaded)
        if (imageResults.has(url) && !loaded) continue
        if (++shownAssets >= 160 && density === 'Explore') break
        if (loaded || pending.size >= 4 || pending.has(url)) continue
        const image = new Image()
        pending.set(url, image)
        image.referrerPolicy = 'no-referrer'
        image.decoding = 'async'
        const settled = () => {
          if (imageResults.size >= 320) imageResults.delete(imageResults.keys().next().value!)
          imageResults.set(url, image.naturalWidth && image.naturalHeight ? image : null)
          pending.delete(url)
          assetView = ''
          schedule()
        }
        image.onload = settled
        image.onerror = settled
        image.src = url
      }
    }

    function draw(now: number) {
      animation = 0
      if (!canvas || !context || document.hidden) return
      const floating = !media.matches && (density === 'Explore' || graph.nodes.length <= 25_000)
      const frameRate = graph.nodes.length > 25_000 ? 6 : graph.nodes.length > 3000 ? 12 : 32
      if (floating && now - lastFrame < 1000 / frameRate) {
        schedule()
        return
      }
      const fading = showImages ? Number(Boolean(hover.current)) : 0
      if (media.matches || !showImages) imageFade.current = fading
      else {
        const step = Math.min(1, (now - lastFrame) / 160)
        const previous = imageFade.current
        imageFade.current = previous < fading ? Math.min(fading, previous + step) : Math.max(fading, previous - step)
      }
      lastFrame = now
      const rect = canvas.getBoundingClientRect()
      size.current = { width: rect.width, height: rect.height }
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(rect.width * ratio)
      const height = Math.round(rect.height * ratio)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const trailElapsed = now - trailSession.current.started
      const showTrails = !dense && (trailElapsed < 2350 || (media.matches && Number.isFinite(trailElapsed)))
      const progress = animate && !media.matches ? Math.min(1, Math.max(0, (now - started) / (showTrails ? 510 : tweenDuration))) : 1
      const t = 1 - (1 - progress) ** 3
      const scale = Math.max(0.1, projection(size.current, camera.current).scale)
      for (const node of graph.nodes) {
        const end = layout.get(node.id)
        if (!end) continue
        const pin = pins.current.get(node.id)
        const moves = floating && (density === 'Explore' || !dense || (node.rank ?? 0) <= denseMapSize || focus?.id === node.id)
        if (progress === 1 && !pin) {
          const existing = base.get(node.id)
          const item = existing?.point === end ? existing : { node, point: end, radius: node.radius }
          base.set(node.id, item)
        } else {
          const prior = from.get(node.id)
          const path = history.get(node.id)
          const before = path?.at(-1) ?? end
          const enter = node.rediscoveredAfter && showTrails ? { x: before.x - 56, y: before.y + 24 } : before
          const start = prior?.point ?? (showTrails ? enter : end)
          const point = pin ?? { x: blend(start.x, end.x, t), y: blend(start.y, end.y, t) }
          base.set(node.id, { node, point, radius: blend(prior?.radius ?? node.radius * 0.6, node.radius, t) })
        }
        const item = base.get(node.id)!
        if (!moves) {
          shown.set(node.id, item)
          continue
        }
        const { phase, recent, item: motion } = offsets.get(node.id)!
        const magnitude = pin ? 0 : 2.6 / scale
        motion.radius = item.radius
        motion.twinkle = (0.1 + recent * 0.9) * (0.5 + 0.5 * Math.sin(now / (1650 - recent * 1120) + phase))
        motion.point.x = item.point.x + Math.sin(now / 1740 + phase) * magnitude
        motion.point.y = item.point.y + Math.cos(now / 2050 + phase) * magnitude * 0.78
        shown.set(node.id, motion)
      }
      stillFrame.current = base
      frame.current = shown
      const activeStar = focus?.id ?? (hover.current && shown.has(hover.current) ? hover.current : undefined)
      const zoom = camera.current.zoom
      const sceneKey = `${zoom < 0.9 ? 0 : zoom < 1.22 ? 1 : 2}/${activeStar ?? ''}`
      if (cached?.key !== sceneKey) cached = { key: sceneKey, scene: telescopeScene(graph, mode, zoom, activeStar, focusedIds, albumLinks) }
      const { scene } = cached
      visibleStars.current = scene.nodes
      updateImages()
      drawGraph(context, size.current, camera.current, scene, shown, mode, archive.demo, showImages ? view : undefined, focus, hover.current,
        showTrails ? { positions: history, age: media.matches ? 0 : Math.min(1, trailElapsed / 2350) } : undefined, catalog,
        imageFade.current, floating ? now : undefined)
      if (progress < 1 || floating || imageFade.current !== fading || (showTrails && !media.matches)) schedule()
    }

    function schedule() {
      if (!animation && !document.hidden) animation = requestAnimationFrame(draw)
    }

    function visibility() {
      if (document.hidden) {
        cancelAnimationFrame(animation)
        animation = 0
      } else schedule()
    }

    invalidate.current = schedule
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    media.addEventListener('change', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      for (const image of pending.values()) {
        image.onload = null
        image.onerror = null
      }
      cancelAnimationFrame(animation)
      observer.disconnect()
      media.removeEventListener('change', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [graph, archive, layout, mode, density, focus, focusedIds, albumLinks, year, history, showImages, resolvedArtwork, view, dense])

  useEffect(() => {
    if (isEmpty) return
    const canvas = canvasRef.current
    if (!canvas) return
    let pending = 0
    let lastScroll = -Infinity
    function wheel(event: WheelEvent) {
      if (!canvas || event.deltaY === 0) return
      event.preventDefault()
      const delta = event.deltaY
      const direction = Math.sign(delta)
      if (event.timeStamp - lastScroll > 180 || Math.sign(pending) !== direction) pending = 0
      lastScroll = event.timeStamp
      if (event.deltaMode === 0 && Math.abs(delta) < wheelThreshold) {
        pending += delta
        if (Math.abs(pending) < wheelThreshold) return
        pending -= direction * wheelThreshold
      } else pending = 0
      const rect = canvas.getBoundingClientRect()
      turnZoom(-direction, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [isEmpty, turnZoom])

  function pointerPosition(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function world(point: Point): Point {
    const view = projection(size.current, camera.current)
    return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale }
  }

  function pick(point: Point) {
    const mapPoint = world(point)
    const { scale } = projection(size.current, camera.current)
    let nearest: VisualNode | undefined
    let nearestDistance = Infinity
    let topArtwork: VisualNode | undefined
    for (const id of focusedIds ?? visibleStars.current) {
      const item = frame.current.get(id)
      if (!item) continue
      const away = distance(item.point, mapPoint)
      const image = showImages && artworkForNode(item.node, readyImages.current)
      const reach = image ? Math.max(12, artworkSide(item.radius, scale) / 2 + 2) / scale : Math.max(12 / scale, item.radius + 4 / scale)
      const hit = image ? Math.max(Math.abs(item.point.x - mapPoint.x), Math.abs(item.point.y - mapPoint.y)) <= reach : away <= reach
      if (!hit) continue
      if (image && (!topArtwork || (item.node.rank ?? Infinity) < (topArtwork.node.rank ?? Infinity))) topArtwork = item
      if (away < nearestDistance) {
        nearest = item
        nearestDistance = away
      }
    }
    return topArtwork ?? nearest
  }

  function pickSatellite(point: Point) {
    const star = focus && frame.current.get(focus.id)
    if (!star) return undefined
    const projected = projection(size.current, camera.current)
    const center = screenPoint(star.point, projected)
    const reach = Math.max(10, satelliteSide(projected.scale) / 2 + 2)
    const image = showImages && artworkForTrack(view, star.node, readyImages.current)
    return satellitePoints(size.current, center, star.node.tracks).find((item) => image
      ? Math.max(Math.abs(item.point.x - point.x), Math.abs(item.point.y - point.y)) <= reach
      : distance(item.point, point) < 10)?.track
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return
    const point = pointerPosition(event)
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    clearHover()
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()]
      pinch.current = { camera: camera.current, center: midpoint(first, second), distance: Math.max(1, distance(first, second)) }
      drag.current = null
      return
    }
    const satellite = Boolean(pickSatellite(point))
    const item = satellite ? undefined : pick(point)
    const pressed = world(point)
    setHovered(event.pointerType !== 'touch' && Boolean(item || satellite))
    drag.current = {
      pointer: event.pointerId, start: point, camera: camera.current, id: item?.node.id, satellite,
      cell: item?.node.kind === 'listened' ? cells?.get(genreGroup(item.node)) : undefined,
      offset: item ? { x: item.point.x - pressed.x, y: item.point.y - pressed.y } : { x: 0, y: 0 }, moved: false,
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event)
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point)
    if (pinch.current) {
      const [first, second] = [...pointers.current.values()]
      const gesture = pinch.current
      const ratio = Math.max(1, distance(first, second)) / gesture.distance
      const steps = Math.round(Math.log(ratio) / Math.log(1.25))
      let zoom = gesture.camera.zoom
      for (let step = 0; step < Math.min(Math.abs(steps), stops.length); step++) zoom = nextZoom(zoom, steps, stops)
      if (zoom !== camera.current.zoom) onZoom()
      updateCamera(zoomAt(gesture.camera, size.current, gesture.center, midpoint(first, second), zoom))
      return
    }
    const gesture = drag.current
    if (gesture?.pointer === event.pointerId) {
      if (!gesture.moved && distance(gesture.start, point) < 5) return
      gesture.moved = true
      if (gesture.id) {
        const next = world(point)
        const x = next.x + gesture.offset.x
        const y = next.y + gesture.offset.y
        const cell = gesture.cell
        pins.current.set(gesture.id, cell ? {
          x: Math.max(cell.center.x - cell.halfWidth, Math.min(cell.center.x + cell.halfWidth, x)),
          y: Math.max(cell.center.y - cell.halfHeight, Math.min(cell.center.y + cell.halfHeight, y)),
        } : { x, y })
        invalidate.current()
      } else {
        updateCamera({ ...gesture.camera, x: gesture.camera.x + point.x - gesture.start.x, y: gesture.camera.y + point.y - gesture.start.y })
      }
      return
    }
    if (pointers.current.size || event.pointerType === 'touch') return
    const id = pickSatellite(point)?.id ?? pick(point)?.node.id
    if (!id) {
      clearHover()
      return
    }
    hover.current = id
    setHovered(true)
    invalidate.current()
  }

  function pointerEnd(event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (!pointers.current.delete(event.pointerId)) return
    pinch.current = null
    const gesture = drag.current
    if (gesture?.pointer !== event.pointerId) return
    drag.current = null
    if (cancelled) {
      clearHover()
      return
    }
    if (gesture.moved) return
    if (gesture.id) onSelect(gesture.id)
    else if (focus && !gesture.satellite) onExitFocus()
  }

  function chartKeys(event: KeyboardEvent<HTMLElement>) {
    if (isEmpty || event.altKey || event.ctrlKey || event.metaKey) return
    switch (event.key) {
      case '+':
      case '=': turnZoom(1, projection(size.current, homeCamera)); break
      case '-': turnZoom(-1, projection(size.current, homeCamera)); break
      case '0': resetLayout(); onExitFocus(); break
      default: return
    }
    event.preventDefault()
  }

  return (
    <section className="map-stage" aria-label="Listening star chart" tabIndex={isEmpty ? undefined : 0} onKeyDown={chartKeys}
      aria-description="Press Plus or Minus to zoom, Escape to leave star focus, and 0 to reset. Open the Stars index to navigate the stars.">
      {!isEmpty && <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={hovered ? 'over-node' : ''}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onLostPointerCapture={(event) => pointerEnd(event, true)}
        onPointerLeave={clearHover}
      />}
      {isEmpty && (
        <div className="map-empty" role="status">
          <h2>{archive.demo ? 'No demo listens' : 'No music playback events'} {scope === 'through' ? 'through' : 'in'} {year}</h2>
          <p>Choose another year on the timeline.</p>
        </div>
      )}
    </section>
  )
}
