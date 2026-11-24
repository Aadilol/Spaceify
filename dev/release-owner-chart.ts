import { open, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isListenBrainzArt, isPublicChart, maxPublicChartBytes, publicChartFile } from '../src/domain/public-chart.ts'
import type { PublicChart } from '../src/domain/public-chart.ts'

export function publicReleaseChart(chart: PublicChart): PublicChart {
  return {
    ...chart,
    catalog: chart.catalog.map((item) => {
      const entry = { ...item }
      delete entry.playedTitles
      if (entry.artwork && isListenBrainzArt(entry.artwork)) delete entry.artwork
      return entry
    }),
  }
}

function parseChart(bytes: Uint8Array): PublicChart {
  const chart: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!isPublicChart(chart)) throw new Error('Invalid owner chart.')
  return chart
}

export async function fetchApprovedChart(source: string, request: typeof fetch = fetch): Promise<PublicChart> {
  const url = new URL(source)
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash || !url.pathname.endsWith('.json')) {
    throw new Error('Expected a public Vercel Blob JSON URL.')
  }
  const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > maxPublicChartBytes) {
    await response.body?.cancel()
    throw new Error('Approved chart unavailable or too large.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxPublicChartBytes) {
      await reader.cancel()
      throw new Error('Approved chart too large.')
    }
    chunks.push(value)
  }
  const chart = parseChart(Buffer.concat(chunks))
  if (chart.catalog.some((item) => item.playedTitles || (item.artwork && isListenBrainzArt(item.artwork)))) {
    throw new Error('The approved chart must be a prepared public candidate.')
  }
  return chart
}

async function run() {
  if (process.argv[2] === '--prepare') {
    const draft = await open('.owner-review/' + publicChartFile, 'r')
    try {
      if ((await draft.stat()).size > maxPublicChartBytes) throw new Error('Owner draft too large.')
      const chart = publicReleaseChart(parseChart(await draft.readFile()))
      await writeFile('.owner-review/public-candidate.json', JSON.stringify(chart), { mode: 0o600 })
      console.log('Public candidate saved for review.')
    } finally {
      await draft.close()
    }
  } else if (process.argv[2] === '--publish') {
    const source = process.env.LISTENING_MAP_APPROVED_CHART_URL
    if (!source) throw new Error('Set LISTENING_MAP_APPROVED_CHART_URL to your reviewed public candidate URL.')
    const chart = await fetchApprovedChart(source).catch(() => {
      throw new Error('The approved chart could not be fetched or validated.')
    })
    await writeFile('dist/' + publicChartFile, JSON.stringify(chart), { flag: 'wx' })
    console.log('Reviewed owner chart staged for the static deployment.')
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void run().catch((error: unknown) => {
    console.error(error instanceof Error && (error.message.startsWith('Set LISTENING_MAP_') || error.message.startsWith('The approved chart'))
      ? error.message : 'Could not prepare the owner chart.')
    process.exitCode = 1
  })
}
