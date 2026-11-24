import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { projection, satellitePoints, screenPoint } from '../src/graph/draw.ts'
import { constellationNodes, layoutGraph } from '../src/graph/layout.ts'
import { buildDemoGraph } from '../src/graph/model.ts'
import { albumSuggestionMbid, artistSimilarityFixture, fixtureAlbumArtwork, fixtureAlbumLink, fixtureArtwork, ownerFixture, suggestionMbid } from './public-fixture.ts'

const home = { x: 0, y: 0, zoom: 1 }
const canvasFor = (page: Page) => page.locator('.map-stage canvas')
const indexFor = (page: Page) => page.getByRole('complementary', { name: 'Star index' })
const openIndex = (page: Page) => page.getByRole('button', { name: 'Open star index' })
const focusLabel = (page: Page) => page.locator('.focus-label')

async function waitForDraw(canvas: Locator, frames = 3) {
  await canvas.evaluate((_, count) => new Promise<void>((resolve) => {
    let finished = 0
    function frame() {
      if (++finished >= count) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }), frames)
}

async function openMap(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  test.skip(Boolean(process.env.LISTENING_MAP_TEST_PAGES), 'The synthetic chart is for local testing.')
  await page.emulateMedia({ reducedMotion })
  await page.goto('/?demo')
  await expect(canvasFor(page)).toBeVisible()
  const year = page.getByRole('slider', { name: 'Listening year' })
  await expect(year).toHaveValue('2026')
  await year.press('ArrowLeft')
  await year.press('ArrowLeft')
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await page.getByRole('button', { name: 'Genre', exact: true }).click()
  await waitForDraw(canvasFor(page))
}

async function nodePoint(canvas: Locator, id: string) {
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Missing chart canvas')
  const point = layoutGraph(buildDemoGraph(2024, 'Artist'), 'Genre').get(id)
  if (!point) throw new Error(`Missing synthetic star ${id}`)
  return screenPoint(point, projection(box, home))
}

async function fingerprint(canvas: Locator) {
  const image = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())
  return createHash('sha256').update(image).digest('hex')
}

async function hasLabelColor(canvas: Locator, color: [number, number, number]) {
  return canvas.evaluate((element: HTMLCanvasElement, [red, green, blue]) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] === red && pixels[offset + 1] === green && pixels[offset + 2] === blue) return true
    }
    return false
  }, color)
}

async function starInk(canvas: Locator, point: { x: number; y: number }) {
  return canvas.evaluate((element: HTMLCanvasElement, position) => {
    const scale = element.width / element.clientWidth
    const pixels = element.getContext('2d')!.getImageData(Math.round((position.x - 8) * scale), Math.round((position.y - 8) * scale), 16 * scale, 16 * scale).data
    let ink = 0
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] === 255) ink++
    return ink
  }, point)
}

test('the artist atlas fills the viewport, preserves the timeline, and works offline', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await openMap(page)
  const canvas = canvasFor(page)
  expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  await expect(page.getByRole('main', { name: 'Listening Map' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Listening Map' })).toHaveCount(0)
  await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Demo artist played')).toBeVisible()
  await expect(page.getByText('10 artists / 3 constellations')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Artist', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(indexFor(page)).toBeHidden()
  const year = page.getByRole('slider', { name: 'Listening year' })
  await expect(year).toHaveValue('2024')
  await expect(year).toHaveCSS('cursor', 'pointer')
  await page.screenshot({ path: 'test-results/starfield-desktop.png' })
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Star', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Image', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await expect(page.getByText('12 albums / 3 constellations')).toBeVisible()
  await year.press('Home')
  await expect(page.getByText('1 album', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Genre', exact: true })).toBeDisabled()
  await year.press('ArrowRight')
  await year.press('ArrowRight')
  await expect(page.getByRole('heading', { name: 'No demo listens in 2018' })).toBeVisible()
  await year.press('End')
  await expect(canvas).toBeVisible()
  await expect(year).toHaveValue('2026')
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true)
  expect(errors).toEqual([])
})

test('hover draws an annotation and selecting a star zooms to its track satellites', async ({ page }) => {
  await openMap(page)
  const canvas = canvasFor(page)
  const star = await nodePoint(canvas, 'artist-aster')
  const unrelated = await nodePoint(canvas, 'artist-bloom')
  const overview = await fingerprint(canvas)
  const unrelatedInk = await starInk(canvas, unrelated)
  const skyCursor = await canvas.evaluate((element) => getComputedStyle(element).cursor)
  expect(decodeURIComponent(skyCursor)).toMatch(/#ff4a50|sky-pointer\.svg/)
  await expect(page.getByRole('button', { name: 'Artist', exact: true })).toHaveCSS('cursor', 'pointer')
  await page.mouse.move(star.x, star.y)
  await expect(canvas).toHaveClass('over-node')
  await expect.poll(() => hasLabelColor(canvas, [101, 179, 255])).toBe(true)
  const starCursor = await canvas.evaluate((element) => getComputedStyle(element).cursor)
  expect(decodeURIComponent(starCursor)).toMatch(/#50ff82|star-pointer\.svg/)
  await expect.poll(() => fingerprint(canvas)).not.toBe(overview)
  await expect.poll(() => starInk(canvas, unrelated)).toBeLessThan(unrelatedInk / 3)
  await page.mouse.click(star.x, star.y)
  const annotation = page.locator('.focus-label')
  await expect(annotation).toContainText('Ambient electronic')
  await expect(annotation).toContainText('Aster Signal')
  await expect(annotation).toContainText('6 tracks')
  await expect(indexFor(page)).toBeHidden()
  await waitForDraw(canvas)
  await page.screenshot({ path: 'test-results/starfield-constellation.png' })
  const size = page.viewportSize()!
  const graph = buildDemoGraph(2024, 'Artist')
  const focus = graph.nodes.find((node) => node.id === 'artist-aster')!
  const layout = layoutGraph(graph, 'Genre')
  const members = constellationNodes(graph, focus)
  const point = layout.get(focus.id)!
  const center = members.reduce((sum, node) => {
    const position = layout.get(node.id)!
    return { x: sum.x + position.x / members.length, y: sum.y + position.y / members.length }
  }, { x: 0, y: 0 })
  const zoom = 2.12
  const { scale } = projection(size, { x: 0, y: 0, zoom })
  const camera = { zoom, x: -(point.x * 0.66 + center.x * 0.34) * scale, y: -(point.y * 0.66 + center.y * 0.34) * scale }
  await expect.poll(() => hasLabelColor(canvas, [101, 179, 255])).toBe(true)
  await expect.poll(() => hasLabelColor(canvas, [155, 182, 209])).toBe(true)
  const stillFocused = await fingerprint(canvas)
  const isolated = screenPoint(layout.get('artist-mira')!, projection(size, camera))
  await page.mouse.move(isolated.x, isolated.y)
  await expect(canvas).toHaveCSS('cursor', skyCursor)
  await waitForDraw(canvas)
  expect(await fingerprint(canvas)).toBe(stillFocused)
  const related = screenPoint(layout.get('artist-orbit')!, projection(size, camera))
  await page.mouse.move(related.x, related.y)
  await expect(canvas).toHaveCSS('cursor', starCursor)
  await expect.poll(() => hasLabelColor(canvas, [101, 179, 255])).toBe(true)
  const [satellite] = satellitePoints(size, screenPoint(point, projection(size, camera)), focus.tracks)
  await page.mouse.move(satellite.point.x, satellite.point.y)
  await expect(canvas).toHaveCSS('cursor', starCursor)
  await page.mouse.click(satellite.point.x, satellite.point.y)
  await expect(annotation).toBeVisible()
  await page.mouse.move(700, 130)
  await page.mouse.down()
  await page.mouse.move(730, 145)
  await page.mouse.up()
  await expect(annotation).toBeVisible()
  await page.mouse.click(700, 130)
  await expect(annotation).toBeHidden()
  await page.mouse.move(720, 755)
  await expect(canvas).toHaveCSS('cursor', skyCursor)
  await expect.poll(() => starInk(canvas, unrelated)).toBeGreaterThan(unrelatedInk * 0.8)
  await expect.poll(() => starInk(canvas, star)).toBeGreaterThan(5)
})

test('mouse drag, pan, wheel and keyboard-accessible map controls remain usable', async ({ page }) => {
  await openMap(page)
  const canvas = canvasFor(page)
  const star = await nodePoint(canvas, 'artist-aster')
  const overview = await fingerprint(canvas)
  await page.mouse.move(star.x, star.y)
  await page.mouse.down()
  await page.mouse.move(star.x + 34, star.y + 35, { steps: 5 })
  await page.mouse.up()
  await page.mouse.move(star.x + 35, star.y + 35)
  await expect(canvas).toHaveClass('over-node')
  await expect(focusLabel(page)).toBeHidden()
  await page.mouse.move(120, 180)
  await page.mouse.down()
  await page.mouse.move(190, 191, { steps: 4 })
  await page.mouse.up()
  await waitForDraw(canvas)
  const panned = await fingerprint(canvas)
  expect(panned).not.toBe(overview)
  await page.mouse.wheel(0, -220)
  await expect.poll(() => fingerprint(canvas)).not.toBe(panned)
  const chart = page.getByRole('region', { name: 'Listening star chart' })
  await chart.press('0')
  await expect.poll(() => fingerprint(canvas)).toBe(overview)
  await chart.press('Equal')
  await expect.poll(() => fingerprint(canvas)).not.toBe(overview)
})

test('zoom snaps through fixed stops and empty sky restores the exact pre-focus view', async ({ page }) => {
  await openMap(page)
  const canvas = canvasFor(page)
  const homeStar = await nodePoint(canvas, 'artist-aster')
  await page.mouse.move(110, 150)
  await page.mouse.down()
  await page.mouse.move(145, 177)
  await page.mouse.up()
  await waitForDraw(canvas)
  const panned = await fingerprint(canvas)
  const anchor = { x: 720, y: 170 }
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -220)
  await expect.poll(() => fingerprint(canvas)).not.toBe(panned)
  const overview = await fingerprint(canvas)
  await page.mouse.wheel(0, 95)
  await expect.poll(() => fingerprint(canvas)).toBe(panned)

  const trackpad = (deltas: number[]) => canvas.evaluate((element, { deltas, anchor }) => {
    for (const deltaY of deltas) element.dispatchEvent(new WheelEvent('wheel', {
      clientX: anchor.x, clientY: anchor.y, deltaY, cancelable: true,
    }))
  }, { deltas, anchor })
  await trackpad([-20, -20])
  await waitForDraw(canvas)
  expect(await fingerprint(canvas)).toBe(panned)
  await trackpad([-10, -20, -24])
  await expect.poll(() => fingerprint(canvas)).toBe(overview)

  await page.mouse.click(anchor.x + (homeStar.x + 35 - anchor.x) * 1.25, anchor.y + (homeStar.y + 27 - anchor.y) * 1.25)
  await expect(focusLabel(page)).toContainText('Aster Signal')
  await expect(page.getByRole('button', { name: /zoom out/i })).toHaveCount(0)
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -100)
  await page.mouse.click(anchor.x, anchor.y)
  await expect(focusLabel(page)).toBeHidden()
  await expect.poll(() => fingerprint(canvas)).toBe(overview)
})

test('missing artwork remains a star and keeps star and satellite interactions', async ({ page }) => {
  await openMap(page)
  const canvas = canvasFor(page)
  const stars = page.getByRole('button', { name: 'Star', exact: true })
  const images = page.getByRole('button', { name: 'Image', exact: true })
  const artist = await nodePoint(canvas, 'artist-aster')
  const starInkCount = await starInk(canvas, artist)
  await stars.press('Enter')
  await expect(images).toBeVisible()
  await expect.poll(() => starInk(canvas, artist)).toBe(starInkCount)
  await images.press('Enter')
  await expect(stars).toBeVisible()
  await page.mouse.move(artist.x, artist.y)
  await expect(canvas).toHaveClass('over-node')
  await page.mouse.click(artist.x, artist.y)
  await expect(focusLabel(page)).toContainText('Aster Signal')
  await page.mouse.click(700, 130)
  await expect(focusLabel(page)).toBeHidden()

  await page.getByRole('button', { name: 'Album', exact: true }).click()
  const graph = buildDemoGraph(2024, 'Album')
  const layout = layoutGraph(graph, 'Genre')
  const focus = graph.nodes.find((node) => node.name === 'Night Drive')!
  const point = layout.get(focus.id)!
  const size = page.viewportSize()!
  const album = screenPoint(point, projection(size, home))
  await waitForDraw(canvas)
  await page.screenshot({ path: 'test-results/starfield-images.png' })
  await page.mouse.click(album.x, album.y)
  await expect(focusLabel(page)).toContainText('Night Drive')
  const members = constellationNodes(graph, focus)
  const centroid = members.reduce((sum, node) => {
    const item = layout.get(node.id)!
    return { x: sum.x + item.x / members.length, y: sum.y + item.y / members.length }
  }, { x: 0, y: 0 })
  const zoom = 2.12
  const { scale } = projection(size, { ...home, zoom })
  const camera = { zoom, x: -(point.x * 0.66 + centroid.x * 0.34) * scale, y: -(point.y * 0.66 + centroid.y * 0.34) * scale }
  const [satellite] = satellitePoints(size, screenPoint(point, projection(size, camera)), focus.tracks)
  await page.mouse.move(satellite.point.x, satellite.point.y)
  await expect(canvas).toHaveClass('over-node')
  await page.mouse.click(satellite.point.x, satellite.point.y)
  await expect(focusLabel(page)).toContainText('Night Drive')
  await stars.press('Enter')
  await expect(images).toBeVisible()
  await expect(focusLabel(page)).toContainText('Night Drive')
  await page.mouse.move(satellite.point.x, satellite.point.y)
  await expect(canvas).toHaveClass('over-node')
})

test('the keyboard index exposes star and track data without placeholder artwork', async ({ page }) => {
  await page.setViewportSize({ width: 966, height: 747 })
  await openMap(page)
  await page.screenshot({ path: 'test-results/starfield-window.png' })
  await openIndex(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: 'Map' })).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tab', { name: 'Stars' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('searchbox', { name: 'Find a star' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: /Aster Signal/ })).toBeFocused()
  await page.keyboard.press('Enter')
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByRole('heading', { name: 'Aster Signal' })).toBeVisible()
  await expect(details.getByText('Blue mile')).toBeVisible()
  await expect(details.locator('.artwork canvas, img.catalog-cover')).toHaveCount(0)
  await expect(details.getByText('✦')).toBeVisible()
  await page.screenshot({ path: 'test-results/starfield-index.png' })
  await page.keyboard.press('Escape')
  await expect(indexFor(page)).toBeHidden()
  await expect(openIndex(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(focusLabel(page)).toBeHidden()
})

test('mobile canvas and timeline fit and support tap and pinch', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await openMap(page)
  const canvas = canvasFor(page)
  expect(await canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBe(780)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: 'test-results/starfield-mobile.png' })
  const star = await nodePoint(canvas, 'artist-aster')
  await page.touchscreen.tap(star.x, star.y)
  await expect(page.locator('.focus-label')).toContainText('6 tracks')
  await page.touchscreen.tap(80, 685)
  await expect(focusLabel(page)).toBeHidden()
  await waitForDraw(canvas)
  const beforePinch = await fingerprint(canvas)
  const touch = await context.newCDPSession(page)
  const fingers = (spread: number) => [{ x: 195 - spread, y: 410, id: 1 }, { x: 195 + spread, y: 410, id: 2 }]
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(35) })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(57) })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => fingerprint(canvas)).not.toBe(beforePinch)
  await page.getByRole('slider', { name: 'Listening year' }).press('End')
  await expect(page.locator('.timeline-years .current')).toHaveText('2026')
  await context.close()
})

test('twinkle and drift run by default, stop for reduced motion, and resume when the preference changes', async ({ page }) => {
  await openMap(page, 'no-preference')
  const canvas = canvasFor(page)
  const first = await fingerprint(canvas)
  await expect.poll(() => fingerprint(canvas)).not.toBe(first)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await waitForDraw(canvas, 5)
  const reduced = await fingerprint(canvas)
  await waitForDraw(canvas, 15)
  expect(await fingerprint(canvas)).toBe(reduced)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => fingerprint(canvas)).not.toBe(reduced)
  await expect(page.getByRole('button', { name: 'Star drift' })).toHaveCount(0)
})

test('a delayed or failed chart bundle displays loading and error states and recovers', async ({ page }) => {
  const chunk = '**/assets/App-*.js'
  let release!: () => void
  const paused = new Promise<void>((resolve) => { release = resolve })
  await page.route(chunk, async (route) => { await paused; await route.abort() })
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: ownerFixture }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  try {
    await expect(page.getByRole('status').getByRole('heading', { name: 'Loading listening map' })).toBeVisible()
  } finally {
    release()
  }
  await expect(page.getByRole('alert').getByRole('heading', { name: 'The map couldn’t load' })).toBeVisible()
  await page.unroute(chunk)
  await page.getByRole('button', { name: 'Reload map' }).click()
  await expect(page.getByRole('slider', { name: 'Listening year' })).toBeVisible()
})

test('search safely filters the star index and a long-gap album returns with a rediscovery marker', async ({ page }) => {
  await openMap(page)
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await openIndex(page).click()
  const search = page.getByRole('searchbox', { name: 'Find a star' })
  await search.fill('<img src=x onerror=alert(1)>')
  await expect(page.getByText('No stars match your search.')).toBeVisible()
  await search.fill('Light leak')
  await expect(page.getByRole('option')).toHaveCount(1)
  await search.press('ArrowDown')
  await expect(page.getByRole('option', { name: /Slow Exposure.*rediscovered/ })).toBeFocused()
  const year = page.getByRole('slider', { name: 'Listening year' })
  await year.press('ArrowLeft')
  await expect(page.getByText('No stars match your search.')).toBeVisible()
  await year.press('ArrowRight')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tabpanel', { name: 'Details' }).getByText('Rediscovered after 2 quiet years')).toBeVisible()
})

test('demo audition starts at the first audible detent and turning to zero stops it', async ({ page }) => {
  await openMap(page)
  const star = await nodePoint(canvasFor(page), 'artist-aster')
  await page.mouse.click(star.x, star.y)
  const volume = page.getByRole('slider', { name: 'Volume' })
  await expect(volume).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('button', { name: 'Play demo preview' }).click()
  await expect(page.getByRole('button', { name: 'Stop demo preview' })).toBeVisible()
  await expect(volume).toHaveAttribute('aria-valuenow', '25')
  await volume.press('Home')
  await expect(volume).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByRole('button', { name: 'Play demo preview' })).toBeVisible()
})

test('matching toolbar rockers snap and the volume knob advances in weighted detents', async ({ page }) => {
  await page.addInitScript(() => {
    const pitches: number[] = []
    Object.defineProperty(window, 'testPitches', { value: pitches })
    const create = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this)
      const start = oscillator.start.bind(oscillator)
      oscillator.start = (time) => { pitches.push(oscillator.frequency.value); start(time) }
      return oscillator
    }
  })
  await openMap(page, 'no-preference')
  const toolbar = page.locator('.atlas-header')
  const album = toolbar.getByRole('button', { name: 'Album', exact: true })
  const genre = toolbar.getByRole('button', { name: 'Genre', exact: true })
  const hours = toolbar.getByRole('button', { name: 'Hours', exact: true })
  await expect(genre).toHaveAttribute('aria-pressed', 'true')
  await hours.press('Enter')
  await expect(hours).toHaveAttribute('aria-pressed', 'true')
  await expect(genre).toHaveAttribute('aria-pressed', 'false')
  expect((await genre.boundingBox())?.width).toBe((await album.boundingBox())?.width)
  const pitches = () => page.evaluate(() => (window as unknown as { testPitches: number[] }).testPitches)
  expect(await pitches()).toEqual([])
  await expect(page.getByRole('button', { name: /Export/ })).toHaveCount(0)
  const volume = toolbar.getByRole('slider', { name: 'Volume' })
  await expect(volume).toHaveCSS('cursor', 'pointer')
  const readout = toolbar.locator('.volume-readout')
  const box = (await volume.boundingBox())!
  const readoutBox = (await readout.boundingBox())!
  expect(readoutBox.x).toBeLessThan(box.x + box.width)
  expect(readoutBox.x + readoutBox.width).toBeGreaterThan(box.x + box.width)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 15, y)
  await expect(volume).toHaveAttribute('aria-valuenow', '0')
  await page.mouse.move(x + 25, y)
  await expect(volume).toHaveAttribute('aria-valuenow', '25')
  await expect(volume.locator('.volume-face')).toHaveCSS('animation-name', 'volume-detent')
  await page.mouse.move(x + 49, y)
  await expect(volume).toHaveAttribute('aria-valuenow', '50')
  await page.mouse.move(x + 74, y)
  await expect(volume).toHaveAttribute('aria-valuenow', '75')
  await expect(readout).toHaveText('75%')
  await page.mouse.move(x + 49, y)
  await expect(volume).toHaveAttribute('aria-valuenow', '75')
  await page.mouse.move(x + 47, y)
  await expect(volume).toHaveAttribute('aria-valuenow', '50')
  await page.mouse.up()
  await album.hover()
  await page.mouse.down()
  await expect(album).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 2, 2)')
  await expect(album).toHaveCSS('box-shadow', 'none')
  await page.mouse.up()
  await expect(album).toHaveAttribute('aria-pressed', 'true')
  await genre.press('Enter')
  await expect(genre).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(pitches).toEqual([146, 410, 146, 410, 146, 410, 146, 410, 560, 240, 560, 240])
  await volume.press('End')
  await expect(volume).toHaveAttribute('aria-valuenow', '100')
  await volume.press('ArrowDown')
  await expect(volume).toHaveAttribute('aria-valuenow', '75')
  await volume.press('Home')
  await expect(volume).toHaveAttribute('aria-valuenow', '0')
  await volume.click({ position: { x: box.width * 0.7, y: box.height / 2 } })
  await expect(volume).toHaveAttribute('aria-valuenow', '25')
  const beforeZoom = (await pitches()).length
  await page.mouse.move(700, 350)
  await page.mouse.wheel(0, -130)
  await expect.poll(async () => (await pitches()).slice(beforeZoom)).toEqual([115, 630])
  await page.mouse.wheel(0, 130)
  await expect.poll(async () => (await pitches()).slice(beforeZoom)).toEqual([115, 630, 115, 630])
  await volume.press('Home')
  await page.mouse.wheel(0, -130)
  await waitForDraw(canvasFor(page), 5)
  expect((await pitches()).slice(beforeZoom)).toEqual([115, 630, 115, 630])
})

test('discovery explains its tag match and the curated Spotify player is explicitly loaded', async ({ page }) => {
  let embedRequests = 0
  await page.route('https://open.spotify.com/embed/**', async (route) => {
    embedRequests++
    await route.fulfill({ contentType: 'text/html', body: '<title>Test player</title>' })
  })
  await openMap(page)
  await openIndex(page).click()
  const search = page.getByRole('searchbox', { name: 'Find a star' })
  await search.fill('Mono Weather')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByText('Shares the fictional Synthwave tag with Static Bloom.')).toBeVisible()
  await expect(details.getByRole('link', { name: /Spotify/ })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Stars' }).click()
  await search.fill('Tycho')
  await expect(page.getByText('No stars match your search.')).toBeVisible()
  await page.getByRole('button', { name: 'Back to chart overview' }).click()
  await expect(search).toBeFocused()
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(details.getByRole('link', { name: 'Open Dive in Spotify' })).toHaveAttribute('href', 'https://open.spotify.com/album/6sLUang2W5cQIWM6J4PjJu')
  expect(embedRequests).toBe(0)
  await page.getByRole('button', { name: 'Load Spotify player' }).click()
  await expect.poll(() => embedRequests).toBe(1)
  await page.getByRole('button', { name: 'Close Spotify player' }).click()
  await expect(page.getByTitle('Spotify player for Dive by Tycho')).toHaveCount(0)
})

test('extracted audio files work offline, use actual UTC years and can be cleared', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Load history files' }).click()
  const dialog = page.getByRole('dialog', { name: 'Listening history' })
  const files = dialog.getByLabel('Audio history files')
  const name = 'Streaming_History_Audio_2024.json'
  await page.context().setOffline(true)
  const requestsBeforeImport = requests.length
  await files.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from('{bad') })
  await expect(dialog.getByRole('alert')).toContainText('valid UTF-8 JSON array')
  const playback = (ts: string, artist: string, album: string, track: string, ms_played: number) => ({
    ts, ms_played, master_metadata_album_artist_name: artist, master_metadata_album_album_name: album, master_metadata_track_name: track,
  })
  const hostile = '<img src=x onerror=alert(1)>'
  const rows = [
    playback('2022-12-31T23:59:59Z', 'Other Artist', 'Earlier Album', 'Earlier Song', 12_000),
    playback('2024-01-02T10:00:00Z', hostile, 'A Synthetic Album', 'A Synthetic Song', 95_000),
    playback('2024-01-02T10:01:00Z', hostile, 'A Synthetic Album', 'A Synthetic Song', 15_000),
  ]
  await files.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rows)) })
  await expect(dialog.getByRole('status')).toContainText('3 music events')
  await dialog.getByRole('button', { name: 'View map' }).click()
  await expect(canvasFor(page)).toBeVisible()
  await expect(page.getByText('Spotify export · UTC')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Genre', exact: true })).toBeDisabled()
  const year = page.getByRole('slider', { name: 'Listening year' })
  await expect(year).toHaveValue('2024')
  await year.press('ArrowLeft')
  await expect(page.getByRole('heading', { name: 'No music playback events in 2023' })).toBeVisible()
  await year.press('ArrowRight')
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await openIndex(page).click()
  const search = page.getByRole('searchbox', { name: 'Find a star' })
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByRole('heading', { name: hostile, exact: true })).toBeVisible()
  await expect(details.getByText('1m 50s', { exact: true })).toHaveCount(2)
  await expect(details.getByText('Last heard in this period (UTC)')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Album', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await dialog.getByRole('button', { name: 'Clear imported data' }).click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: 'Load history files' })).toBeVisible()
  expect(requests.slice(requestsBeforeImport).filter((url) => /^https?:/.test(url))).toEqual([])
})

test('the public owner chart opens first and a local visitor import replaces and restores it', async ({ page }) => {
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: ownerFixture }))
  let imageRequests = 0
  await page.route((url) => [fixtureArtwork, fixtureAlbumArtwork].includes(url.href), (route) => {
    imageRequests++
    expect(route.request().headers().referer).toBeUndefined()
    return route.fulfill({ contentType: 'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=', 'base64',
    ) })
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByText('Owner chart · UTC')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Album', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Hours', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await page.getByRole('button', { name: 'Genre', exact: true }).click()
  await expect(page.getByText('Suggested artists')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Genre', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(imageRequests).toBe(0)
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await expect.poll(() => imageRequests).toBeGreaterThan(0)
  await openIndex(page).click()
  const search = page.getByRole('searchbox', { name: 'Find a star' })
  await search.fill('Outside Artist')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByText('Source: ListenBrainz Radio')).toBeVisible()
  await expect(details.getByRole('link', { name: 'Find artist on MusicBrainz' }))
    .toHaveAttribute('href', `https://musicbrainz.org/artist/${suggestionMbid}`)
  await page.getByRole('tab', { name: 'Stars' }).click()
  await search.fill('Example Artist')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(details.getByText('Approx. time listened')).toBeVisible()
  await expect(details.getByText('Play events')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await openIndex(page).click()
  await page.getByRole('tab', { name: 'Stars' }).click()
  await search.fill('Public Album')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(details.getByRole('heading', { name: 'Catalog tracklist' })).toBeVisible()
  await expect(details.getByText('Catalog opener')).toBeVisible()
  await expect(details.getByRole('link', { name: 'Spotify Open album' })).toHaveAttribute('href', fixtureAlbumLink)
  await expect.poll(() => details.getByRole('img', { name: 'Catalog artwork' }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  await page.getByRole('tab', { name: 'Stars' }).click()
  await page.getByRole('button', { name: 'Back to chart overview' }).click()
  await search.fill('Shared Album')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(details.getByRole('heading', { name: 'Played tracks across the archive' })).toBeVisible()
  await expect(details.getByText('Shared title')).toBeVisible()
  await expect(details.getByText('Catalog artwork unavailable')).toBeVisible()
  await expect(details.getByText('0 events')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Stars' }).click()
  await page.getByRole('button', { name: 'Back to chart overview' }).click()
  await search.fill('Outside Album')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(details.getByRole('link', { name: 'Find album on MusicBrainz' }))
    .toHaveAttribute('href', `https://musicbrainz.org/release-group/${albumSuggestionMbid}`)
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog', { name: 'Listening history' })
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.context().setOffline(true)
  const visitor = [{ ts: '2026-08-09T10:11:12Z', ms_played: 64_000, master_metadata_album_artist_name: 'Visitor Artist',
    master_metadata_album_album_name: 'Visitor Album', master_metadata_track_name: 'Visitor Song' }]
  visitor.push({ ...visitor[0], master_metadata_album_artist_name: 'Example Artist', master_metadata_album_album_name: 'Public Album' })
  await dialog.getByLabel('Audio history files').setInputFiles({ name: 'Streaming_History_Audio_2026.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(visitor)) })
  await expect(dialog.getByRole('status')).toContainText('2 music events')
  await dialog.getByRole('button', { name: 'View map' }).click()
  await expect(page.getByText('Spotify export · UTC')).toBeVisible()
  await expect(page.getByText('Suggested albums')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hours', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await openIndex(page).click()
  await search.fill('post-rock')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(details.getByText('experimental rock, post-rock')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await dialog.getByRole('button', { name: 'Clear imported data' }).click()
  await dialog.getByRole('button', { name: 'View map' }).click()
  await expect(page.getByText('Owner chart · UTC')).toBeVisible()
})

test('a malformed public pack leaves the visitor import available', async ({ page }) => {
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: { ...ownerFixture, listeningEvents: [] } }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('default chart could not be read')
  await expect(page.getByRole('button', { name: 'Load history files' })).toBeVisible()
})

test('the hosted map opens the owner chart even with the old demo URL', async ({ page }) => {
  test.skip(!process.env.LISTENING_MAP_TEST_PAGES, 'The hosted build excludes the demo entry point.')
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: ownerFixture }))
  await page.goto('/?demo')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /script-src 'self'/)
  await expect(page.getByText('Owner chart · UTC')).toBeVisible()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByLabel('Audio history files')).toBeVisible()
})

test('artist focus exposes cached ListenBrainz links and suggestions without contacting their API', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: artistSimilarityFixture }))
  const remote: string[] = []
  await page.route('https://**', (route) => {
    remote.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await openIndex(page).click()
  const list = page.getByRole('listbox', { name: 'Artist nodes in 2024' })
  await list.getByRole('option', { name: /^Example Artist,/ }).click()
  await page.getByRole('tab', { name: 'Stars' }).click()
  await expect(list.getByRole('option', { name: /^Another Artist,/ })).toBeVisible()
  await expect(list.getByRole('option', { name: /Previous/ })).toHaveCount(0)
  await list.getByRole('option', { name: /^Unheard Artist,/ }).click()
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByRole('heading', { name: 'Unheard Artist' })).toBeVisible()
  await expect(details.getByText('Source: ListenBrainz Similar Artists')).toBeVisible()
  await expect(details.getByText('ListenBrainz lists this artist as similar to Example Artist.')).toBeVisible()
  expect(remote).toEqual([])
})

test('Explore only fetches eligible lifetime artwork and Focus still fetches lower-listened entries', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const artistGrid = '/artist-art/8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11.svg'
  const otherAlbum = 'https://i.scdn.co/image/aa23456789abcdef'
  const artPaths = [artistGrid, fixtureArtwork, fixtureAlbumArtwork, otherAlbum]
  const requested = new Set<string>()
  await page.route((url) => artPaths.includes(url.href) || url.pathname === artistGrid, (route) => {
    const url = new URL(route.request().url())
    requested.add(url.pathname === artistGrid ? artistGrid : url.href)
    if (url.href === otherAlbum) return route.fulfill({ status: 404 })
    return route.fulfill(url.pathname === artistGrid ? {
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/></svg>',
    } : {
      contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=', 'base64'),
    })
  })
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: {
    ...ownerFixture,
    catalog: ownerFixture.catalog.map((entry) => {
      if (entry.id === 'artist-1') return { ...entry, exploreArtwork: true, artwork: {
        url: '.' + artistGrid, source: 'https://listenbrainz.org/artist/8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11/', credit: 'ListenBrainz · Cover Art Archive',
      } }
      if (entry.id === 'artist-2') return { ...entry, artwork: ownerFixture.catalog[0].artwork }
      if (entry.id === 'album-1') return { ...entry, exploreArtwork: true }
      return { ...entry, artwork: { url: otherAlbum, source: fixtureAlbumLink, credit: 'Spotify' } }
    }),
    charts: {
      Artist: { ...ownerFixture.charts.Artist, 2023: [{ id: 'artist-1', band: 0 }, { id: 'artist-2', band: 0 }] },
      Album: { ...ownerFixture.charts.Album, 2023: [{ id: 'album-1', band: 0 }, { id: 'album-2', band: 0 }] },
    },
  } }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Explore', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Year', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Star', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Listening year' })).toHaveValue('2024')
  await expect.poll(() => [...requested]).toEqual([fixtureAlbumArtwork])
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await page.getByRole('slider', { name: 'Listening year' }).press('Home')
  await expect.poll(() => [...requested]).toEqual([fixtureAlbumArtwork, artistGrid])
  await openIndex(page).click()
  let list = page.getByRole('listbox', { name: 'Artist nodes in 2023' })
  await list.getByRole('option', { name: /^Example Artist,/ }).click()
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByRole('link', { name: 'ListenBrainz · Cover Art Archive' })).toBeVisible()
  await page.getByRole('tab', { name: 'Stars' }).click()
  await page.getByRole('button', { name: 'Back to chart overview' }).click()
  await list.getByRole('option', { name: /^Another Artist,/ }).click()
  await expect(details.getByRole('img', { name: 'Catalog artwork' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Through year', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Listening through year' })).toHaveValue('2023')
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await expect.poll(() => [...requested]).toEqual([fixtureAlbumArtwork, artistGrid])
  await page.getByRole('tab', { name: 'Stars' }).click()
  list = page.getByRole('listbox', { name: 'Album nodes through 2023' })
  await list.getByRole('option', { name: /^Shared Album,/ }).click()
  await expect(details.getByRole('img', { name: 'Catalog artwork' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await expect.poll(() => requested.has(otherAlbum)).toBe(true)
  await list.getByRole('option', { name: /^Shared Album,/ }).click()
  await expect(details.getByText('Catalog artwork could not load')).toBeVisible()
  await expect(details.getByText('✦')).toBeVisible()
  await expect(details.getByRole('img', { name: 'Catalog artwork' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await expect.poll(() => requested.has(fixtureArtwork)).toBe(true)
})

test('imported artwork waits for consent and loads annual entries before cumulative artwork', async ({ page }) => {
  const earlier = 'b'.repeat(22)
  const recent = 'c'.repeat(22)
  const requests: { kind: string; track: string }[] = []
  await page.route('**/__listening-map/catalog-artwork', async (route) => {
    const query = route.request().postDataJSON() as { kind: string; track: string }
    expect(Object.keys(query).sort()).toEqual(['kind', 'track'])
    requests.push(query)
    const period = query.track === recent ? 'Recent' : 'Earlier'
    await route.fulfill({ json: {
      name: period + (query.kind === 'artist' ? ' Artist' : ' Album'),
      ...(query.kind === 'album' ? { artists: [period + ' Artist'] } : {}),
      art: { url: fixtureAlbumArtwork, credit: 'Spotify', source: 'https://open.spotify.com/' + query.kind + '/' + 'd'.repeat(22) },
    } })
  })
  await page.route(fixtureAlbumArtwork, (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=', 'base64',
  ) }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Load history files' }).click()
  const picker = page.getByRole('dialog', { name: 'Listening history' })
  const row = (year: number, period: string, track: string) => ({
    ts: year + '-06-01T12:00:00Z', ms_played: 90_000, spotify_track_uri: 'spotify:track:' + track,
    master_metadata_track_name: 'Synthetic song', master_metadata_album_album_name: period + ' Album',
    master_metadata_album_artist_name: period + ' Artist',
  })
  await picker.getByLabel('Audio history files').setInputFiles({
    name: 'Streaming_History_Audio_2024.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([row(2023, 'Earlier', earlier), row(2024, 'Recent', recent)])),
  })
  await picker.getByRole('button', { name: 'View map' }).click()
  await page.getByRole('button', { name: 'Artist', exact: true }).click()
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  const stars = page.getByRole('button', { name: 'Star', exact: true })
  const images = page.getByRole('button', { name: 'Image', exact: true })
  await expect(stars).toBeVisible()
  expect(requests).toHaveLength(0)
  await stars.click()
  await images.click()
  const consent = page.getByRole('dialog', { name: 'Load catalog artwork?' })
  if (process.env.LISTENING_MAP_TEST_PAGES) {
    await expect(stars).toBeVisible()
    await expect(consent).toHaveCount(0)
    expect(requests).toHaveLength(0)
    return
  }
  await expect(consent).toBeVisible()
  expect(requests).toHaveLength(0)
  await consent.getByRole('button', { name: 'Use available artwork' }).click()
  await expect(stars).toBeVisible()
  expect(requests).toHaveLength(0)
  await stars.click()
  await images.click()
  await consent.getByRole('button', { name: 'Look up artwork' }).click()
  await expect.poll(() => requests).toEqual([{ kind: 'artist', track: recent }])
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await expect.poll(() => requests.at(-1)).toEqual({ kind: 'album', track: recent })
  await page.getByRole('button', { name: 'Through year', exact: true }).click()
  await expect.poll(() => requests.at(-1)).toEqual({ kind: 'album', track: earlier })
  await openIndex(page).click()
  const search = page.getByRole('searchbox', { name: 'Find a star' })
  await search.fill('Earlier Album')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tabpanel', { name: 'Details' }).getByRole('img', { name: 'Catalog artwork' })).toBeVisible()
})

test('private import exposes albums beyond the first page and shares the chosen timeline year', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Load history files' }).click()
  const dialog = page.getByRole('dialog', { name: 'Listening history' })
  const rows = Array.from({ length: 105 }, (_, i) => ({
    ts: '2024-07-20T02:00:00Z', ms_played: 120_000 - 500 * i, master_metadata_album_artist_name: `Artist ${i}`,
    master_metadata_album_album_name: `Album ${i}`, master_metadata_track_name: `Track ${i}`,
  }))
  rows.push({ ...rows[0], ts: '2022-12-29T02:00:00Z', master_metadata_album_album_name: 'Out-of-year album' })
  await dialog.getByLabel('Audio history files').setInputFiles({
    name: 'Streaming_History_Audio_2024.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rows)),
  })
  await expect(dialog.getByRole('status')).toContainText('106 music events')
  await dialog.getByRole('button', { name: 'View map' }).click()
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  const density = page.getByRole('group', { name: 'Chart density' })
  const focus = density.getByRole('button', { name: 'Focus', exact: true })
  const explore = density.getByRole('button', { name: 'Explore', exact: true })
  await expect(explore).toHaveAttribute('aria-pressed', 'true')
  await focus.click()
  await expect(focus).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('45 of 105 albums', { exact: true })).toBeVisible()
  await explore.press('Enter')
  await expect(explore).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('105 albums', { exact: true })).toBeVisible()
  await openIndex(page).click()
  const list = page.getByRole('listbox', { name: 'Album nodes in 2024' })
  await expect(list.getByRole('option')).toHaveCount(80)
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(list.getByRole('option').first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(list.getByRole('option', { name: /Album 104, rank 105/ })).toBeFocused()
  await page.keyboard.press('Enter')
  const details = page.getByRole('tabpanel', { name: 'Details' })
  await expect(details.getByText('Track 104')).toBeVisible()
  await expect(details.getByText('1m 8s', { exact: true })).toHaveCount(2)
  await page.keyboard.press('Escape')

  const annual = page.getByRole('slider', { name: 'Listening year', exact: true })
  await annual.press('Home')
  await expect(annual).toHaveValue('2022')
  await page.getByRole('button', { name: 'Through year', exact: true }).click()
  const through = page.getByRole('slider', { name: 'Listening through year' })
  await expect(through).toHaveValue('2022')
  await expect(page.getByText('1 album', { exact: true })).toBeVisible()
  await through.press('End')
  await expect(through).toHaveValue('2024')
  await expect(page.getByText('106 albums', { exact: true })).toBeVisible()
  await focus.click()
  await expect(page.getByText('45 of 106 albums', { exact: true })).toBeVisible()
  await expect(through).toHaveValue('2024')
  await explore.click()
  await through.press('ArrowLeft')
  await expect(through).toHaveValue('2023')
  await expect(page.getByText('1 album', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Year', exact: true }).click()
  await expect(annual).toHaveValue('2023')
  await expect(page.getByRole('heading', { name: 'No music playback events in 2023' })).toBeVisible()
  await page.getByRole('button', { name: 'Through year', exact: true }).click()
  await expect(through).toHaveValue('2023')
})

test('selecting an album adds verified guest releases to the Focus index', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const extras = Array.from({ length: 46 }, (_, index) => ({
    id: `album-${index + 3}`, name: `Extra Album ${index}`, artist: 'Another Artist',
    creditedArtists: index === 45 ? ['Example Artist'] : undefined,
  }))
  await page.route('**/owner-chart.json', (route) => route.fulfill({ json: {
    ...ownerFixture, catalog: [...ownerFixture.catalog, ...extras],
    charts: { ...ownerFixture.charts, Album: { ...ownerFixture.charts.Album,
      2024: [...ownerFixture.charts.Album[2024], ...extras.map(({ id }) => ({ id, band: 0 }))] } },
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await page.getByRole('button', { name: 'Album', exact: true }).click()
  await openIndex(page).click()
  const list = page.getByRole('listbox', { name: 'Album nodes in 2024' })
  const guest = list.getByRole('option', { name: /Extra Album 45/ })
  await expect(guest).toHaveCount(0)
  await list.getByRole('option', { name: /^Public Album,/ }).click()
  await page.getByRole('tab', { name: 'Stars' }).click()
  await expect(guest).toBeVisible()
  await page.getByRole('button', { name: 'Back to chart overview' }).click()
  await expect(guest).toHaveCount(0)
})

