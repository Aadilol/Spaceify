import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistorySnapshot } from '../domain/history.ts'
import { isSpotifyArtwork } from '../domain/public-chart.ts'
import type { CatalogArt } from '../domain/public-chart.ts'
import { demoArchive, privateArchive } from '../graph/archive.ts'
import type { MapArchive } from '../graph/archive.ts'
import { maxSatellites } from '../graph/draw.ts'
import { curatedGraph, focusNeighborhood, relatedAlbumIds } from '../graph/exploration.ts'
import { genreGroup, genreGroupLabel, supportsGenre } from '../graph/layout.ts'
import { discoveryLabel, exploreSuggestions, focusSuggestions, formatExactDuration, formatPublicBand } from '../graph/model.ts'
import type { ChartDensity, LayoutMode, MapNode, TimelineMode, View } from '../graph/model.ts'
import type { ImportReply } from '../import/history.worker.ts'
import HistoryWorker from '../import/history.worker.ts?worker&inline'
import { fetchDefaultChart } from '../import/public-default.ts'
import type { DefaultChart } from '../import/public-default.ts'
import { GraphCanvas } from './GraphCanvas.tsx'
import { SpotifyArtworkCredit } from './Artwork.tsx'
import { ControlBar } from './ControlBar.tsx'
import { Inspector } from './Inspector.tsx'
import type { Panel } from './Inspector.tsx'
import { Timeline } from './Timeline.tsx'
import { SpotifyLink, SuggestedLink } from './Discovery.tsx'
import { useStarAudio } from './useStarAudio.ts'
import { useCatalogArtwork } from './useCatalogArtwork.ts'

export default function App() {
  const demo = import.meta.env.MODE !== 'github-pages' && new URLSearchParams(window.location.search).has('demo')
  const preferPrivate = import.meta.env.DEV && new URLSearchParams(window.location.search).has('private')
  const [defaultChart, setDefaultChart] = useState<DefaultChart | null>(null)
  const [showDefault, setShowDefault] = useState(true)
  const [checkingDefault, setCheckingDefault] = useState(!demo)
  const [defaultError, setDefaultError] = useState(false)
  const [imported, setImported] = useState<{ history: HistorySnapshot; artworkTracks: Map<string, string>; version: number } | null>(null)
  const [reading, setReading] = useState(false)
  const [importError, setImportError] = useState('')
  const picker = useRef<HTMLDialogElement>(null)
  const worker = useRef<Worker | null>(null)
  const history = imported?.history ?? (showDefault ? defaultChart?.privateHistory : undefined)
  const archive = useMemo(() => {
    if (demo) return demoArchive
    if (imported) return privateArchive(imported.history, defaultChart?.catalogGenres, defaultChart?.catalogCredits, undefined, defaultChart?.artistCatalog)
    return showDefault ? defaultChart?.archive ?? null : null
  }, [demo, imported, defaultChart, showDefault])

  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    void fetchDefaultChart(controller.signal, preferPrivate).then((result) => {
      if (controller.signal.aborted) return
      setDefaultChart(result)
      setCheckingDefault(false)
    }, () => {
      if (controller.signal.aborted) return
      setDefaultError(true)
      setCheckingDefault(false)
    })
    return () => controller.abort()
  }, [demo, preferPrivate])

  useEffect(() => () => worker.current?.terminate(), [])

  function cancelImport() {
    worker.current?.terminate()
    worker.current = null
    setReading(false)
  }

  function importFiles(files: File[]) {
    if (!files.length) return
    cancelImport()
    setImportError('')
    try {
      const loader = new HistoryWorker()
      worker.current = loader
      setReading(true)
      loader.onmessage = ({ data }: MessageEvent<ImportReply>) => {
        if (worker.current !== loader) return
        cancelImport()
        if ('history' in data) setImported((prior) => ({ ...data, version: (prior?.version ?? 0) + 1 }))
        else setImportError(data.error)
      }
      loader.onerror = (event) => {
        event.preventDefault()
        if (worker.current !== loader) return
        cancelImport()
        setImportError('The audio files could not be read. Select them again to retry.')
      }
      loader.postMessage(files)
    } catch {
      cancelImport()
      setImportError('This browser could not start the local file reader.')
    }
  }

  const openHistory = () => picker.current?.showModal()
  return (
    <>
      {archive ? <Chart key={imported ? `files-${imported.version}` : demo ? 'demo' : 'default'} archive={archive} onHistory={demo ? undefined : openHistory}
        artworkTracks={import.meta.env.MODE === 'github-pages' ? undefined : imported?.artworkTracks}
        knownArtwork={imported ? defaultChart?.catalogArtwork : undefined} /> : (
        <main className="map-window startup" aria-label="Listening Map">
          <div>
            <h2>{checkingDefault ? 'Loading owner chart' : 'Open your listening map'}</h2>
            {defaultError && <p role="alert">The default chart could not be read. You can select the audio JSON files directly.</p>}
            {!checkingDefault && <button type="button" className="plain-button" onClick={openHistory}>Load history files</button>}
          </div>
        </main>
      )}
      {!demo && <dialog ref={picker} className="history-dialog" aria-labelledby="history-heading">
        <h2 id="history-heading">Listening history</h2>
        <p>Select the <strong>Streaming_History_Audio</strong> JSON files from your extracted Spotify Extended Streaming History export. Files you select are read in this browser. Reloading clears that selection.</p>
        <p>The map uses music titles, playback time, and UTC calendar years. Listening events include partial plays.</p>
        {archive?.publicChart && <p>The owner chart shows approximate listening time. Genres come from <a href="https://musicbrainz.org/doc/Genre" target="_blank" rel="noopener noreferrer">MusicBrainz</a>. Turning on Images loads catalog artwork from its credited providers.</p>}
        <label className="history-field">Audio history files
          <input type="file" multiple accept=".json,application/json" disabled={reading}
            onChange={(event) => { importFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
        </label>
        {reading && <p role="status">Reading audio files…</p>}
        {importError && <p role="alert">{importError}</p>}
        {history && <p role="status">{history.counts.events.toLocaleString('en-US')} music {history.counts.events === 1 ? 'event' : 'events'} · {history.years[0]}–{history.years.at(-1)} UTC.
          {' '}{history.counts.duplicates.toLocaleString('en-US')} duplicates and {(history.counts.ignored + history.counts.invalid).toLocaleString('en-US')} non-music or invalid rows skipped.</p>}
        <div className="history-actions">
          {reading && <button type="button" className="plain-button" onClick={cancelImport}>Cancel import</button>}
          {archive && !reading && <button type="button" className="plain-button" onClick={() => {
            if (imported) setImported(null)
            else setShowDefault(false)
            setImportError('')
          }}>{imported ? 'Clear imported data' : 'Hide default chart'}</button>}
          {!archive && defaultChart && !reading && <button type="button" className="plain-button" onClick={() => setShowDefault(true)}>Restore default chart</button>}
          {import.meta.env.DEV && archive?.draft && <a className="plain-button external-link" href="?private">Full private map</a>}
          {preferPrivate && <a className="plain-button external-link" href="?">Owner preview</a>}
          <form method="dialog"><button type="submit" className="plain-button">{archive ? 'View map' : 'Close'}</button></form>
        </div>
      </dialog>}
    </>
  )
}

interface ChartProps {
  archive: MapArchive
  onHistory?: () => void
  artworkTracks?: ReadonlyMap<string, string>
  knownArtwork?: ReadonlyMap<string, CatalogArt>
}

function Chart({ archive, onHistory, artworkTracks, knownArtwork }: ChartProps) {
  const [view, setView] = useState<View>('Album')
  const [density, setDensity] = useState<ChartDensity>('Explore')
  const [showImages, setShowImages] = useState(true)
  const [artworkConsent, setArtworkConsent] = useState<boolean>()
  const artworkPrompt = useRef<HTMLDialogElement>(null)
  const [scope, setScope] = useState<TimelineMode>('year')
  const [year, setYear] = useState(archive.firstYearShown)
  const [mode, setMode] = useState<LayoutMode>('Hours')
  const [selection, setSelection] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [suggestionSeed, setSuggestionSeed] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('Stars')
  const [expanded, setExpanded] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const audio = useStarAudio()
  const { stopPreview, play } = audio
  const full = useMemo(() => archive.graphAt(year, view, scope), [archive, year, view, scope])
  const overview = useMemo(() => density === 'Focus' ? curatedGraph(full, archive.publicChart) : full, [full, archive, density])
  const focusedAlbum = view === 'Album' && focusId ? full.nodes.find((node) => node.id === focusId && node.kind === 'listened') : undefined
  const albumLinks = useMemo(() => relatedAlbumIds(full, focusedAlbum), [full, focusedAlbum])
  const graph = useMemo(() => {
    if (view === 'Artist' && suggestionSeed && archive.artistSuggestions) {
      return archive.artistSuggestions(overview, suggestionSeed, density === 'Focus' ? focusSuggestions : exploreSuggestions)
    }
    if (density !== 'Focus' || !focusedAlbum || !full.complete) return overview
    const members = new Set(overview.nodes.map((node) => node.id))
    if (members.has(focusedAlbum.id) && [...albumLinks].every((id) => members.has(id))) return overview
    return curatedGraph(full, archive.publicChart, new Set([focusedAlbum.id, ...albumLinks]))
  }, [density, focusedAlbum, full, overview, albumLinks, archive, view, suggestionSeed])
  const selected = graph.nodes.find((node) => node.id === selection)
  const focus = graph.nodes.find((node) => node.id === focusId)
  const exploreArtwork = useMemo(() => density === 'Explore' && showImages ? archive.exploreArtworkIds?.(view) : undefined,
    [archive, density, showImages, view])
  const artworkNodes = useMemo(() => !showImages ? [] : density === 'Focus' ? graph.nodes :
    graph.nodes.filter((node) => exploreArtwork?.has(node.id)), [density, exploreArtwork, graph, showImages])
  const artworkTarget = focus && exploreArtwork?.has(focus.id) ? focus : undefined
  const priority = useMemo(() => {
    if (!artworkTracks || !showImages || !artworkConsent) return []
    if (density === 'Explore') return artworkTarget ? [artworkTarget] : []
    if (scope === 'year') return graph.nodes
    const annual = curatedGraph(archive.graphAt(year, view, 'year')).nodes
    return [...annual, ...graph.nodes]
  }, [archive, artworkTracks, showImages, artworkConsent, graph, density, artworkTarget, scope, view, year])
  const { byNode: resolvedArtwork, status: artworkStatus } = useCatalogArtwork(artworkNodes, priority, view, knownArtwork, artworkTracks,
    showImages && artworkConsent === true)
  const artFor = (node?: MapNode) => node ? resolvedArtwork.get(node.id) : undefined
  const selectedArt = artFor(selected)
  const focusArt = artFor(focus)
  const focusedIds = useMemo(() => focus ? focusNeighborhood(graph, focus.id, albumLinks) : undefined, [graph, focus, albumLinks])
  const indexNodes = useMemo(() => focusedIds ? graph.nodes.filter((node) => focusedIds.has(node.id)) : graph.nodes, [graph, focusedIds])
  const canGroup = supportsGenre(overview)
  const played = overview.nodes.filter((node) => node.kind === 'listened').length
  const discoveries = overview.nodes.length - played
  const total = full === overview ? played : full.nodes.filter((node) => node.kind === 'listened').length
  const count = played === total ? played.toLocaleString('en-US') : `${played.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`
  const graphMode = canGroup ? mode : 'Hours'
  const constellationCount = new Set(overview.nodes.flatMap((node) => node.kind === 'listened' && node.genre ? [node.genre] : [])).size
  const hasCatalogSimilarity = graph.edges.some((edge) => edge.basis === 'listenbrainz')

  const exitFocus = useCallback(() => {
    stopPreview()
    setFocusId(null)
    setSuggestionSeed(null)
  }, [stopPreview])
  const turnZoom = useCallback(() => { void play('zoom') }, [play])

  useEffect(() => {
    if (!expanded && !focusId) return
    function dismiss(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (expanded) {
        setExpanded(false)
        toggle.current?.focus()
      } else exitFocus()
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [expanded, focusId, exitFocus])

  function select(id: string) {
    if (focusedIds && !focusedIds.has(id)) return
    audio.stopPreview()
    void audio.play('inspect')
    setSelection(id)
    setFocusId(id)
    if (view === 'Artist' && archive.artistSuggestions && graph.nodes.some((node) => node.id === id && node.kind === 'listened')) setSuggestionSeed(id)
  }

  function changeView(next: View) {
    if (view === next) return
    audio.stopPreview()
    void audio.play('rocker')
    setView(next)
    setSelection(null)
    setFocusId(null)
    setSuggestionSeed(null)
  }

  function changeMode(next: LayoutMode) {
    if (!canGroup || next === graphMode) return
    setMode(next)
    void audio.play('rocker')
  }

  function changeDensity(next: ChartDensity) {
    if (density === next) return
    exitFocus()
    setSelection(null)
    setDensity(next)
    setPanel('Stars')
    void play('rocker')
  }

  function changeYear(next: number) {
    audio.stopPreview()
    const full = archive.graphAt(next, view, scope)
    const nextGraph = density === 'Focus' ? curatedGraph(full, archive.publicChart) : full
    setYear(next)
    if (!nextGraph.nodes.some((node) => node.id === selection)) setSelection(null)
    setFocusId(null)
    setSuggestionSeed(null)
  }

  function changeScope(next: TimelineMode) {
    if (scope === next) return
    stopPreview()
    setSelection(null)
    setFocusId(null)
    setSuggestionSeed(null)
    setScope(next)
  }

  return (
    <main className="map-window" aria-label="Listening Map">
      <ControlBar view={view} mode={graphMode} density={density} onDensity={changeDensity} canGroup={canGroup} volume={audio.volume} showImages={showImages}
        expanded={expanded} indexRef={toggle} onView={changeView} onMode={changeMode} onVolume={audio.setVolume}
        onImages={() => {
          void play('rocker')
          if (!showImages && artworkTracks?.size && artworkConsent !== true) artworkPrompt.current?.showModal()
          else setShowImages(!showImages)
        }}
        onIndex={() => setExpanded((value) => !value)} status={artworkStatus || (audio.error ? 'Local audio unavailable' : '')} />
      {Boolean(artworkTracks?.size) && <dialog ref={artworkPrompt} className="history-dialog" aria-labelledby="catalog-artwork-heading">
        <h2 id="catalog-artwork-heading">Load catalog artwork?</h2>
        <p>Looking up missing artwork sends one Spotify track ID per album or artist to the site and Spotify. Your files, play counts, and timestamps stay in this browser.</p>
        <form method="dialog" className="history-actions">
          <button className="plain-button" onClick={() => { setArtworkConsent(false); setShowImages(true) }}>Use available artwork</button>
          <button className="plain-button" onClick={() => { setArtworkConsent(true); setShowImages(true) }}>Look up artwork</button>
        </form>
      </dialog>}
      <div className="chart-focus">
        {focus && <>
          <div className="focus-label" role="status"><span>{focus.kind === 'listened' && canGroup ? genreGroupLabel(genreGroup(focus)) : focus.genre ?? 'Star'}</span><strong>{focus.name}</strong>
            {focus.kind === 'discovery' && <span>{discoveryLabel(focus)}</span>}
            {focus.tracks.length > 0 && <span>{Math.min(maxSatellites, focus.tracks.length)}{focus.tracks.length > maxSatellites ? ` of ${focus.tracks.length}` : ''} {focus.tracks[0].catalog ? 'catalog tracks' : focus.tracks[0].sharedTitle ? 'shared tracks' : 'tracks'}</span>}
            {focus.publicBand !== undefined && <span>{formatPublicBand(focus.publicBand, focus.publicBandYears)} listened</span>}
            {!archive.demo && focus.kind === 'listened' && focus.publicBand === undefined &&
              <span>{formatExactDuration(focus.minutes * 60_000)} listened</span>}
            {view === 'Album' && focus.publicBand !== undefined && !focus.tracks.length && <span>No track titles available</span>}
            {focus.rediscoveredAfter && <span>Rediscovered after {focus.rediscoveredAfter} quiet years</span>}
            {focus.reason && <p className="focus-reason">{focus.reason}</p>}
          </div>
          <div className="focus-actions">
            {archive.demo && focus.kind === 'listened' && <button className="plain-button" type="button" onClick={() => {
              if (audio.playing) audio.stopPreview()
              else void audio.play('preview', focus.tone)
            }}>{audio.playing ? 'Stop demo preview' : 'Play demo preview'}</button>}
            {focus.spotifyAlbumId && <>
              <SpotifyLink node={focus} />
              <button className="plain-button" type="button" onClick={() => { setPanel('Details'); setExpanded(true) }}>Spotify player</button>
            </>}
            {focus.recommendation && <SuggestedLink node={focus} />}
            {showImages && isSpotifyArtwork(focusArt) && <SpotifyArtworkCredit href={focusArt.source} album={view === 'Album'} artist={view === 'Artist'} />}
            {focus.tracks.length > 0 && !archive.demo && <button className="plain-button" type="button" onClick={() => {
              setPanel('Details')
              setExpanded(true)
            }}>All tracks</button>}
          </div>
        </>}
      </div>
      <Inspector expanded={expanded} nodes={indexNodes} selected={selected && selectedArt ? { ...selected, artwork: selectedArt } : selected} focused={Boolean(focus)} onExitFocus={exitFocus} onSelect={(id) => { select(id); setPanel('Details') }}
        onMove={() => { void audio.play('move') }} year={year} scope={scope} view={view} demo={archive.demo}
        showCatalogImages={showImages && (density === 'Focus' || Boolean(selected && exploreArtwork?.has(selected.id)))}
        active={panel} onPanel={setPanel} />
      <GraphCanvas graph={graph} overview={overview} archive={archive} mode={graphMode} density={density} year={year} scope={scope} view={view} focus={focus} focusedIds={focusedIds} albumLinks={albumLinks} showImages={showImages} resolvedArtwork={resolvedArtwork} onZoom={turnZoom}
        onSelect={(id) => { select(id); setExpanded(false) }} onExitFocus={exitFocus} />
      <footer className="atlas-footer">
        <div className="chart-key">
          <div className="legend" role="group" aria-label="Star chart legend">
            <span><i className="key-star" />{archive.demo ? `Demo ${view.toLowerCase()} played` : archive.publicChart ? archive.draft ? 'Owner preview · UTC' : 'Owner chart · UTC' : 'Spotify export · UTC'}</span>
            <span title={hasCatalogSimilarity ? 'ListenBrainz artist similarity and local matches' : archive.demo ? undefined :
              archive.publicChart ? 'Shared artist or genre tags' : 'Shared artist or heard together on at least two UTC dates'}>
              <i className="key-link" />{archive.demo || archive.publicChart || hasCatalogSimilarity ? 'Similarity' : 'Related listening'}</span>
            {discoveries > 0 && <span><i className="key-discovery" />{archive.demo ? 'Demo discovery' : `Suggested ${view.toLowerCase()}s`}</span>}
            {graph.nodes.some((node) => node.spotifyAlbumId) && <span><i className="key-catalog" />Spotify pick</span>}
            {showImages && graph.nodes.some((node) => isSpotifyArtwork(artFor(node))) && <SpotifyArtworkCredit />}
            {graph.nodes.some((node) => node.rediscoveredAfter) && <span><i className="key-comet" />Rediscovered</span>}
          </div>
          <p className="chart-count" role="status">{count} {view.toLowerCase()}{total === 1 ? '' : 's'}{canGroup && mode === 'Genre' ? ` / ${constellationCount} constellations` : ''}</p>
          {onHistory && <button type="button" className="plain-button history-toggle" aria-haspopup="dialog" onClick={onHistory}>History</button>}
        </div>
        <Timeline archive={archive} year={year} scope={scope} onYear={changeYear} onScope={changeScope} />
      </footer>
    </main>
  )
}
