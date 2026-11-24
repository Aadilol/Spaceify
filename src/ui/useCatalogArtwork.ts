import { useEffect, useMemo, useRef, useState } from 'react'
import { artworkIdentity, catalogArtworkPath, isArtworkMatch, matchesArtwork } from '../domain/catalog-artwork.ts'
import type { CatalogArt } from '../domain/public-chart.ts'
import type { MapNode, View } from '../graph/model.ts'

function waitForRetry(seconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, seconds * 1000)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export function useCatalogArtwork(nodes: MapNode[], priority: MapNode[], view: View, known?: ReadonlyMap<string, CatalogArt>,
  tracks?: ReadonlyMap<string, string>, enabled = false) {
  const [found, setFound] = useState(new Map<string, CatalogArt>())
  const [status, setStatus] = useState('')
  const finished = useRef(new Set<string>())
  const byNode = useMemo(() => {
    const artworks = new Map<string, CatalogArt>()
    for (const node of nodes) {
      const identity = known || found.size ? artworkIdentity(node.name, node.artistName) : undefined
      const art = node.artwork ?? (identity && node.kind === 'listened' ? known?.get(identity) ?? found.get(identity) : undefined)
      if (art) artworks.set(node.id, art)
    }
    return artworks
  }, [nodes, known, found])

  useEffect(() => {
    if (!enabled || !tracks || priority.length === 0) return
    const controller = new AbortController()
    const { signal } = controller
    async function resolve() {
      for (const node of priority) {
        if (signal.aborted) return
        if (node.kind !== 'listened' || node.artwork) continue
        const identity = artworkIdentity(node.name, node.artistName)
        const track = tracks?.get(identity)
        if (!track || known?.has(identity) || finished.current.has(identity)) continue
        const request = () => fetch(catalogArtworkPath, {
          method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', 'X-Listening-Map': 'artwork' },
          body: JSON.stringify({ kind: view.toLowerCase(), track }),
        })
        setStatus('Loading catalog artwork')
        let response = await request()
        if (response.status === 429) {
          const retry = Number(response.headers.get('Retry-After'))
          if (!Number.isFinite(retry) || retry <= 0 || retry > 20) throw new Error('Artwork rate-limited.')
          await waitForRetry(retry, signal)
          if (signal.aborted) return
          response = await request()
        }
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Artwork unavailable.')
        const match: unknown = await response.json()
        if (signal.aborted) return
        finished.current.add(identity)
        if (isArtworkMatch(match) && matchesArtwork(match, node.name, node.artistName)) {
          setFound((previous) => new Map(previous).set(identity, match.art))
        }
      }
      if (!signal.aborted) setStatus('')
    }
    void resolve().catch(() => { if (!signal.aborted) setStatus('Catalog artwork temporarily unavailable') })
    return () => controller.abort()
  }, [enabled, known, priority, tracks, view])

  return { byNode, status: enabled && priority.length ? status : '' }
}
