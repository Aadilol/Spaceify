import assert from 'node:assert/strict'
import test from 'node:test'
import { formatExactDuration } from '../src/graph/model.ts'
import { loadHistory } from '../src/domain/history.ts'
import type { HistoryFile } from '../src/domain/history.ts'
import { privateArchive } from '../src/graph/archive.ts'
import { supportsGenre } from '../src/graph/layout.ts'
import { telescopeScene } from '../src/graph/exploration.ts'
import { isAudioHistory, maxFileBytes, maxHistoryBytes, musicEvent, parseHistoryJson } from '../src/import/history-json.ts'

const encode = (value: string) => new TextEncoder().encode(value)
const audioFile = (value: unknown, name = 'Streaming_History_Audio_2024.json'): HistoryFile => {
  const bytes = encode(JSON.stringify(value))
  return { name, size: bytes.length, read: async () => bytes }
}

function playback(ts: string, artist: string, album: string, track: string, ms_played = 100_000) {
  return {
    ts, ms_played, master_metadata_album_artist_name: artist, master_metadata_album_album_name: album,
    master_metadata_track_name: track, ip_addr: '192.0.2.11', platform: 'test device',
  }
}

test('audio chunks aggregate UTC years and deduplicate repeated music rows', async () => {
  const first = playback('2022-12-31T23:59:59Z', 'Example Artist', 'One Record', 'First Track')
  const second = playback('2024-01-01T00:00:00Z', ' example artist ', 'One\u00a0Record', 'First Track', 8000)
  const other = playback('2024-01-02T00:00:00Z', 'Example Artist', 'One Record (Deluxe)', 'First Track', 30_000)
  const data = await loadHistory([
    audioFile([first, second, other, { ...other, spotify_episode_uri: 'spotify:episode:example' }, { ...first, ms_played: -1 }]),
    audioFile([first, { ...second, ts: '2024-01-01T01:00:00Z', ms_played: 0 }], 'Streaming_History_Audio_2024_1.json'),
  ])
  assert.deepEqual(data.years, [2022, 2023, 2024])
  assert.deepEqual(data.counts, { events: 4, duplicates: 1, ignored: 1, invalid: 1 })
  const archive = privateArchive(data)
  const albums = archive.graphAt(2024, 'Album').nodes
  assert.equal(albums.length, 2)
  assert.equal(albums[0].name, 'One Record (Deluxe)')
  assert.equal(albums[1].events, 2)
  assert.equal(albums[1].minutes, 8000 / 60_000)
  assert.equal(albums[1].id, archive.graphAt(2022, 'Album').nodes[0].id)
  assert.equal(archive.graphAt(2024, 'Artist').nodes[0].events, 3)
  assert.equal(archive.graphAt(2023, 'Artist').nodes.length, 0)
  assert.equal(supportsGenre(archive.graphAt(2024, 'Album')), false)
  assert.equal(archive.graphAt(2024, 'Album').edges[0].strength, 1)
  const transport = JSON.stringify(data)
  assert.doesNotMatch(transport, /ip_addr|192\.0\.2\.11|test device|spotify_track_uri/)
})

test('artist edges need repeated co-listening on the same UTC day', async () => {
  const listening = [
    playback('2024-01-01T01:00:00Z', 'A', 'One', 'Track A'),
    playback('2024-01-02T01:00:00Z', 'A', 'One', 'Track A'),
    playback('2024-01-01T02:00:00Z', 'B', 'Two', 'Track B'),
    playback('2024-01-02T02:00:00Z', 'B', 'Two', 'Track B'),
    playback('2024-01-01T03:00:00Z', 'C', 'Three', 'Track C'),
    playback('2024-01-02T03:00:00Z', 'C', 'Three', 'Track C', 0),
  ]
  const { graphs } = await loadHistory([audioFile(listening)])
  const graph = graphs.Artist[2024]
  assert.equal(graph.edges.length, 1)
  assert.deepEqual(graph.edges.map(({ source, target }) => [source, target]), [[graph.nodes[0].id, graph.nodes[1].id]])
  assert.ok(graph.nodes.every((node) => node.kind === 'listened' && node.genre === undefined))
})

test('malformed JSON, hostile filenames, oversized inputs and malformed fields are bounded', async () => {
  const badNames = ['../Streaming_History_Audio_2024.json', 'C:/Streaming_History_Audio_2024.json', 'Streaming_History_Video_2024.json', 'Spotify.zip']
  for (const name of badNames) {
    assert.equal(isAudioHistory(name), false)
    await assert.rejects(loadHistory([audioFile([], name)]), /Choose the Streaming_History/)
  }
  for (const bytes of [encode('unexpected'), encode('{}'), new Uint8Array([0xff, 0xfe]), encode('['.repeat(12) + '0' + ']'.repeat(12))]) {
    assert.throws(() => parseHistoryJson(bytes), /valid UTF-8 JSON array|too many levels/)
  }
  const large = { name: 'Streaming_History_Audio_2024.json', size: maxFileBytes + 1, async read() { throw new Error('Should not read') } }
  await assert.rejects(loadHistory([large]), /16 MB/)
  await assert.rejects(loadHistory(Array.from({ length: maxHistoryBytes / maxFileBytes + 1 }, () => ({ ...large, size: maxFileBytes }))), /256 MB/)
  const wrong = (ts: string, duration?: number) => playback(ts, 'A', 'B', 'T', duration)
  assert.equal(musicEvent(wrong('2024-02-30T04:00:00Z')), 'invalid')
  assert.equal(musicEvent(wrong('2024-03-01T00:00:00-07:00')), 'invalid')
  assert.equal(musicEvent(wrong('2024-03-01T00:00:00Z', Infinity)), 'invalid')
  assert.equal(musicEvent(playback('2024-01-01T01:00:00Z', 'x'.repeat(257), 'B', 'T')), 'invalid')
  await assert.rejects(loadHistory([audioFile([])]), /No usable music/)
})

test('full years and cumulative years retain late-ranked albums and merge played tracks', async () => {
  const rows = Array.from({ length: 120 }, (_, index) => playback(
    '2024-06-04T00:00:00Z', `Artist ${index}`, `Album ${index}`, `Song ${index}`, 130000 - index * 1000,
  ))
  const shared = playback('2022-12-30T00:00:00Z', 'Artist 119', 'Album 119', 'Song 119', 49_000)
  const old = playback('2022-12-29T00:00:00Z', 'Earlier Artist', 'Earlier Album', 'Earlier Song')
  const secondSong = playback('2024-06-04T00:10:00Z', 'Artist 119', 'Album 119', 'Extra Song', 1500)
  const archive = privateArchive(await loadHistory([audioFile([...rows, shared, old, secondSong])]))
  const annual = archive.graphAt(2024, 'Album')
  assert.equal(annual.nodes.length, 120)
  const rare = annual.nodes.find((node) => node.name === 'Album 119')!
  assert.ok(rare.rank! > 45)
  assert.equal(telescopeScene(annual, 'Hours', 1).nodes.has(rare.id), true)
  assert.equal(archive.graphAt(2023, 'Album').nodes.length, 0)
  assert.equal(archive.graphAt(2023, 'Album', 'through').nodes.length, 2)
  const through = archive.graphAt(2024, 'Album', 'through')
  assert.equal(through.nodes.length, 121)
  const merged = through.nodes.find((node) => node.id === rare.id)!
  assert.equal(merged.events, 3)
  assert.equal(merged.minutes, (11_000 + 49_000 + 1_500) / 60_000)
  assert.equal(merged.tracks.length, 2)
  assert.equal(merged.tracks[0].events, 2)
  assert.equal(merged.tracks[0].milliseconds, 60_000)
  assert.equal(formatExactDuration(merged.minutes * 60_000), '1m 1.5s')
  assert.equal(formatExactDuration(merged.tracks[0].milliseconds!), '1m 0s')
  assert.equal(formatExactDuration(merged.tracks[1].milliseconds!), '1.5s')
  assert.equal(rare.events, 2)
})
