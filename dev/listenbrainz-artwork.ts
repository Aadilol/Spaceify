import { catalogMbid, listenBrainzArtCredit, listenBrainzArtDirectory } from '../src/domain/public-chart.ts'
import type { CatalogArt } from '../src/domain/public-chart.ts'
import { boundedBody, listenBrainzCooldown, validListenBrainzContact } from './listenbrainz.ts'

const mbidPattern = catalogMbid.source.slice(1, -1)
const coverArchivePath = new RegExp(`^/release(?:-group)?/${mbidPattern}/(?:front-250|[0-9]{1,20}-250\\.jpg)$`, 'i')
const archivePath = new RegExp(`^/download/mbid-(${mbidPattern})/mbid-\\1-[0-9]{1,20}_thumb250\\.jpg$`, 'i')
const maxCoverBytes = 256 * 1024
export const maxArtistGridBytes = 4 * maxCoverBytes * 2

export const artistGridArtwork = (id: string): CatalogArt => ({
  url: `./${listenBrainzArtDirectory}/${id}.svg`,
  source: `https://listenbrainz.org/artist/${id}/`,
  credit: listenBrainzArtCredit,
})

function coverLinks(grid: string) {
  const links = new Set<string>()
  for (const [tag] of grid.matchAll(/<image\b[^>]*>/g)) {
    const href = /\s(?:xlink:)?href\s*=\s*["']([^"'\s]+)["']/.exec(tag)?.[1]
    if (!href) continue
    let url: URL
    try { url = new URL(href) } catch { continue }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) continue
    if ((url.hostname === 'coverartarchive.org' && coverArchivePath.test(url.pathname)) ||
      (url.hostname === 'archive.org' && archivePath.test(url.pathname))) links.add(url.href)
    if (links.size >= 4) break
  }
  return [...links]
}

function options(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000)
  return { redirect: 'manual' as const, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }
}

async function coverData(url: string, request: typeof fetch, signal?: AbortSignal) {
  const config = options(signal)
  let target = new URL(url)
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await request(target, config)
    if (response.ok) {
      const type = response.headers.get('Content-Type')?.split(';')[0]
      if (type !== 'image/jpeg' && type !== 'image/png') { await response.body?.cancel(); return }
      const image = await boundedBody(response, maxCoverBytes)
      const valid = type === 'image/jpeg' ? image.subarray(0, 3).equals(Buffer.from([255, 216, 255])) :
        image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      return valid ? `data:${type};base64,${image.toString('base64')}` : undefined
    }
    const location = response.headers.get('Location')
    await response.body?.cancel()
    if (response.status < 300 || response.status >= 400 || !location) return
    target = new URL(location, target)
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
      (target.hostname !== 'archive.org' && !target.hostname.endsWith('.archive.org'))) return
  }
}

export async function fetchListenBrainzGrid(id: string, contact: string, request: typeof fetch = fetch, signal?: AbortSignal) {
  if (!catalogMbid.test(id) || !validListenBrainzContact(contact)) throw new Error('Invalid artist grid configuration.')
  const url = new URL(`https://api.listenbrainz.org/1/art/artist-grid/${id}/2/0/250`)
  url.search = 'caption=false&skip-missing=true'
  const response = await request(url, {
    ...options(signal), redirect: 'error', headers: { Accept: 'image/svg+xml', 'User-Agent': `ListeningMap/0.1 (${contact})` },
  })
  const cooldown = listenBrainzCooldown(response)
  if (!response.ok) {
    await response.body?.cancel()
    return { cooldown, unavailable: response.status !== 400 && response.status !== 404 }
  }
  if (response.headers.get('Content-Type')?.split(';')[0] !== 'image/svg+xml') {
    await response.body?.cancel()
    return { cooldown, unavailable: true }
  }
  try {
    const input = await boundedBody(response, 256 * 1024)
    const links = coverLinks(input.toString('utf8'))
    const covers = (await Promise.all(links.map((link) => coverData(link, request, signal)))).filter(Boolean)
    if (!covers.length) return { cooldown, unavailable: links.length > 0 }
    const tile = covers.length === 1 ? 250 : 125
    const images = covers.map((uri, index) => `<image x="${index % 2 * tile}" y="${Math.floor(index / 2) * tile}" width="${tile}" height="${tile}" href="${uri}"/>`)
    const image = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250" width="250" height="250">${images.join('')}</svg>`
    return { cooldown, image }
  } catch {
    return { cooldown, unavailable: true }
  }
}
