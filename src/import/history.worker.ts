import { loadHistory } from '../domain/history.ts'
import type { HistorySnapshot } from '../domain/history.ts'
import { HistoryError } from './history-json.ts'

export type ImportReply = { history: HistorySnapshot; artworkTracks: Map<string, string> } | { error: string }

self.addEventListener('message', (event: MessageEvent<File[]>) => {
  const artworkTracks = new Map<string, string>()
  void loadHistory(event.data.map((file) => ({ name: file.name, size: file.size, read: () => file.arrayBuffer() })), undefined, artworkTracks)
    .then((history) => self.postMessage({ history, artworkTracks } satisfies ImportReply))
    .catch((error: unknown) => {
      self.postMessage({ error: error instanceof HistoryError ? error.message : 'The audio files could not be read. Select them again to retry.' } satisfies ImportReply)
    })
})
