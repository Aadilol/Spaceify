import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { loadHistory } from '../src/domain/history.ts'
import { isAudioHistory, maxFileBytes, maxHistoryFiles } from '../src/import/history-json.ts'
import { localHistoryHeader, localHistoryPath } from '../src/import/local-history.ts'
import { catalogMbid, draftChartPath, listenBrainzArtDirectory, maxPublicChartBytes, publicChartFile } from '../src/domain/public-chart.ts'
import { catalogArtworkMiddleware } from './catalog-artwork.ts'
import { maxArtistGridBytes } from './listenbrainz-artwork.ts'

export async function readHistoryDirectory(directory: string, root: string, artworkTracks?: Map<string, string>) {
  const path = await realpath(directory)
  const fromProject = relative(await realpath(root), path)
  if (!fromProject || (!isAbsolute(fromProject) && fromProject !== '..' && !fromProject.startsWith(`..${sep}`))) {
    throw new Error('The private history directory must be outside the project.')
  }
  const entries = (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile() && isAudioHistory(entry.name))
  if (entries.length > maxHistoryFiles) throw new Error('Too many audio files.')
  const files = await Promise.all(entries.map(async ({ name }) => {
    const location = join(path, name)
    const metadata = await stat(location)
    return {
      name,
      size: metadata.size,
      async read() {
        const file = await open(location, 'r')
        try {
          const before = await file.stat()
          if (!before.isFile() || before.size !== metadata.size || before.size > maxFileBytes) throw new Error('Invalid file.')
          const buffer = Buffer.alloc(before.size)
          const read = await file.read(buffer, 0, buffer.length, 0)
          if (read.bytesRead !== before.size || (await file.stat()).size !== before.size) throw new Error('File changed.')
          return buffer
        } finally {
          await file.close()
        }
      },
    }
  }))
  return loadHistory(files, undefined, artworkTracks)
}

function allowsLoopback(request: IncomingMessage) {
  const { remoteAddress, localPort } = request.socket
  const host = `127.0.0.1:${localPort}`
  return request.method === 'GET' && request.headers.host === host && remoteAddress === '127.0.0.1' &&
    request.headers['sec-fetch-site'] === 'same-origin' && request.headers[localHistoryHeader] === 'local' &&
    (!request.headers.origin || request.headers.origin === `http://${host}`)
}

async function readOwnerFile(root: string, name: string, maxBytes: number) {
  const draft = await open(join(root, '.owner-review', name))
  try {
    const info = await draft.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid local review file.')
    return await draft.readFile()
  } finally {
    await draft.close()
  }
}

export function privateHistory(): Plugin {
  return {
    name: 'listening-map-private-local-history',
    apply: 'serve',
    configureServer(server) {
      const directory = process.env.LISTENING_MAP_HISTORY_DIR
      const loopback = server.config.server.host === '127.0.0.1'
      server.middlewares.use(catalogArtworkMiddleware(server.config.root, loopback))
      let snapshot: Promise<string> | undefined
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith(`/${listenBrainzArtDirectory}/`)) {
          const id = request.url.slice(listenBrainzArtDirectory.length + 2, -4)
          const host = `127.0.0.1:${request.socket.localPort}`
          if (!loopback || request.method !== 'GET' || request.socket.remoteAddress !== '127.0.0.1' ||
            request.headers.host !== host || request.headers['sec-fetch-site'] !== 'same-origin' ||
            request.headers['sec-fetch-dest'] !== 'image' || !catalogMbid.test(id) || !request.url.endsWith('.svg')) {
            response.statusCode = 404
            response.end()
            return
          }
          void readOwnerFile(server.config.root, join(listenBrainzArtDirectory, id + '.svg'), maxArtistGridBytes).then((body) => {
            response.setHeader('Content-Type', 'image/svg+xml')
            response.setHeader('X-Content-Type-Options', 'nosniff')
            response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; sandbox")
            response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
            response.setHeader('Cache-Control', 'private, max-age=3600')
            response.end(body)
          }, () => {
            response.statusCode = 404
            response.end()
          })
          return
        }
        const draft = request.url === draftChartPath
        if (!draft && request.url !== localHistoryPath) { next(); return }
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (!loopback) { response.statusCode = 404; response.end(); return }
        if (!allowsLoopback(request)) {
          response.statusCode = 403
          response.end()
          return
        }
        if (draft) {
          void readOwnerFile(server.config.root, publicChartFile, maxPublicChartBytes).then((body) => {
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(body)
          }, (error: unknown) => {
            response.statusCode = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 422
            response.end()
          })
          return
        }
        if (!directory) { response.statusCode = 404; response.end(); return }
        snapshot ??= readHistoryDirectory(directory, server.config.root).then((data) => JSON.stringify(data))
        void snapshot.then((body) => {
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(body)
        }, () => {
          snapshot = undefined
          response.statusCode = 422
          response.end()
        })
      })
    },
  }
}
