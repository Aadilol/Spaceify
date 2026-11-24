import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'
import { catalogArtworkPath, isArtworkLookup, isArtworkMatch } from '../src/domain/catalog-artwork.ts'
import type { CatalogArtworkMatch } from '../src/domain/catalog-artwork.ts'
import { fetchSpotifyArtwork, getSpotifyToken, spotifyCredentials } from './spotify-cover.ts'

export function catalogArtworkMiddleware(root: string, loopback: boolean) {
  let token: Awaited<ReturnType<typeof getSpotifyToken>> | undefined
  let inFlight = false
  let retryAt = 0
  const cache = new Map<string, { match: CatalogArtworkMatch | null; expires: number }>()

  async function serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const host = '127.0.0.1:' + request.socket.localPort
    if (!loopback || request.method !== 'POST' || request.socket.remoteAddress !== '127.0.0.1' ||
      request.headers.host !== host || request.headers['sec-fetch-site'] !== 'same-origin' ||
      request.headers.origin !== 'http://' + host || request.headers['x-listening-map'] !== 'artwork') {
      response.writeHead(403).end()
      return
    }
    const length = Number(request.headers['content-length'])
    if (!Number.isSafeInteger(length) || length < 1 || length > 128 || request.headers['content-type'] !== 'application/json') {
      response.writeHead(400).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += String(chunk)
    let lookup: unknown
    try { lookup = JSON.parse(body) } catch { response.writeHead(400).end(); return }
    if (!isArtworkLookup(lookup)) { response.writeHead(400).end(); return }
    const key = lookup.kind + '/' + lookup.track
    const cached = cache.get(key)
    const reply = (match: CatalogArtworkMatch | null) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(match))
    if (cached && cached.expires > Date.now()) { reply(cached.match); return }
    if (inFlight || Date.now() < retryAt) {
      response.writeHead(429, { 'Retry-After': String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))) }).end()
      return
    }
    inFlight = true
    try {
      try { loadEnvFile(join(root, '.env.spotify.local')) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const credentials = spotifyCredentials()
      if (!credentials) { response.writeHead(503).end(); return }
      if (!token || token.expires <= Date.now()) token = await getSpotifyToken(credentials, fetch)
      const result = await fetchSpotifyArtwork(lookup.track, lookup.kind, credentials.market, token.header, fetch)
      if (!result.response.ok) await result.response.body?.cancel()
      if (result.response.status === 429) {
        const retry = Number(result.response.headers.get('Retry-After'))
        const seconds = Number.isSafeInteger(retry) && retry > 0 ? retry : 30
        retryAt = Date.now() + seconds * 1000
        response.writeHead(429, { 'Retry-After': String(seconds) }).end()
        return
      }
      if (!result.response.ok && result.response.status !== 404) { response.writeHead(503).end(); return }
      const match = isArtworkMatch(result.match) ? result.match : null
      if (cache.size >= 256) cache.delete(cache.keys().next().value!)
      cache.set(key, { match, expires: Date.now() + 600_000 })
      reply(match)
    } finally {
      inFlight = false
    }
  }
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url !== catalogArtworkPath) { next(); return }
    void serve(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
  }
}
