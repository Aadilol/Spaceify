import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { discoveryLabel, formatDuration, formatExactDuration, formatPublicBand } from '../graph/model.ts'
import type { MapNode, TimelineMode, View } from '../graph/model.ts'
import { ArtworkStar, CatalogArtwork } from './Artwork.tsx'
import { DiscoveryDetails } from './Discovery.tsx'

const tabs = ['Stars', 'Details'] as const
const pageSize = 80
export type Panel = (typeof tabs)[number]

interface Props {
  nodes: MapNode[]
  selected: MapNode | undefined
  focused: boolean
  onExitFocus: () => void
  onSelect: (id: string) => void
  onMove: () => void
  expanded: boolean
  year: number
  scope: TimelineMode
  view: View
  demo: boolean
  showCatalogImages: boolean
  active: Panel
  onPanel: (panel: Panel) => void
}

function NodeDetails({ node, period, view, demo, showCatalogImages }: { node: MapNode; period: string; view: View; demo: boolean; showCatalogImages: boolean }) {
  const publicBand = node.publicBand
  const [shownTracks, setShownTracks] = useState(60)
  const catalog = node.tracks[0]?.catalog
  return (
    <>
      {node.artwork && showCatalogImages ? <CatalogArtwork key={node.artwork.url} art={node.artwork} view={view} /> :
        !node.spotifyAlbumId && !node.recommendation && <ArtworkStar
          caption={showCatalogImages && !demo ? 'Catalog artwork unavailable' : undefined} />}
      <div className="item-heading">
        <p className="item-kind">
          {node.kind === 'discovery' ? discoveryLabel(node) : node.rank === 1 ? publicBand === undefined ? 'Most played' : 'Most listened' : `#${node.rank} by time listened`}
        </p>
        <h2>{node.name}</h2>
        {node.artistName && <p className="item-artist">{node.artistName}{node.release && <><span aria-hidden="true"> · </span>{node.release}</>}</p>}
      </div>
      {node.kind === 'discovery' ? (
        <DiscoveryDetails key={node.id} node={node} />
      ) : (
        <dl className="listening-stats" aria-label={`Listening statistics ${period}`}>
          <div><dt>{publicBand === undefined ? 'Time listened' : 'Approx. time listened'}</dt><dd>{publicBand === undefined ?
            demo ? formatDuration(node.minutes) : formatExactDuration(node.minutes * 60_000) : formatPublicBand(publicBand, node.publicBandYears)}</dd></div>
          {publicBand === undefined && <div><dt>Play events</dt><dd>{node.events.toLocaleString('en-US')}</dd></div>}
        </dl>
      )}
      {(node.genre || node.tags.length > 0) && <p className="item-genre">
        <span className="quiet">{demo ? 'Genre' : node.genreFromReleases ? 'Genre inferred from tagged releases' :
          node.usesArtistGenres ? 'Artist genres via MusicBrainz' : 'MusicBrainz genres'}</span>
        <span>{demo ? node.genre : [...new Set([node.genre, ...node.tags])].filter(Boolean).join(', ')}</span>
      </p>}
      {node.lastPlayed ? <p className="item-genre"><span>{demo ? 'Last heard in demo archive' : 'Last heard in this period (UTC)'}</span><time dateTime={new Date(node.lastPlayed).toISOString().slice(0, 10)}>{new Date(node.lastPlayed).toISOString().slice(0, 10)}</time></p> : null}
      {node.rediscoveredAfter && <p className="rediscovery-note">Rediscovered after {node.rediscoveredAfter} quiet years</p>}
      {node.tracks.length > 0 && <div className="track-index">
        <h3>{catalog ? 'Catalog tracklist' : node.tracks[0].sharedTitle ? 'Played tracks across the archive' : demo ? 'Track satellites' : 'Tracks played'}</h3>
        <ul>{node.tracks.slice(0, shownTracks).map((track) => <li key={track.id}><span>{track.name}</span>
          {!track.catalog && !track.sharedTitle && <span className="track-listening">
            {track.milliseconds !== undefined && !demo && <span>{formatExactDuration(track.milliseconds)}</span>}
            <span>{track.events} {demo ? 'plays' : 'events'}</span>
          </span>}</li>)}</ul>
        {shownTracks < node.tracks.length && <button className="plain-button" type="button" onClick={() => setShownTracks((count) => count + 60)}>
          Show more tracks ({shownTracks.toLocaleString()} of {node.tracks.length.toLocaleString()})
        </button>}
      </div>}
      {view === 'Album' && publicBand !== undefined && node.tracks.length === 0 && <p className="item-genre">No track titles available.</p>}
    </>
  )
}

export function Inspector({ nodes, selected, focused, onExitFocus, onSelect, onMove, expanded, year, scope, view, demo, showCatalogImages, active, onPanel }: Props) {
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const id = useId()
  const tabButtons = useRef(new Map<Panel, HTMLButtonElement>())
  const nodeRows = useRef(new Map<string, HTMLLIElement>())
  const details = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const focusDetails = useRef(false)
  const pendingRowFocus = useRef<string | null>(null)
  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return nodes
    return nodes.filter((node) => {
      const searchable = [node.name, node.artistName, node.genre, ...node.tags, ...node.tracks.map((item) => item.name)].join(' ').toLocaleLowerCase()
      return words.every((word) => searchable.includes(word))
    })
  }, [nodes, query])
  const current = filtered.find((node) => node.id === cursor) ?? filtered.find((node) => node.id === selected?.id) ?? filtered[0]
  const currentIndex = Math.max(0, filtered.indexOf(current))
  const page = Math.floor(currentIndex / pageSize)
  const pageCount = Math.ceil(filtered.length / pageSize)
  const period = scope === 'through' ? `through ${year}` : `in ${year}`

  useLayoutEffect(() => {
    if (!pendingRowFocus.current || current?.id !== pendingRowFocus.current) return
    nodeRows.current.get(current.id)?.focus()
    pendingRowFocus.current = null
  }, [current])

  function focusRow(node: MapNode) {
    const row = nodeRows.current.get(node.id)
    if (row) row.focus()
    else pendingRowFocus.current = node.id
    setCursor(node.id)
  }

  useEffect(() => {
    if (active === 'Details' && focusDetails.current) {
      details.current?.focus()
      focusDetails.current = false
    }
  }, [active])

  function chooseTab(tab: Panel) {
    if (tab === 'Stars') setCursor(selected?.id ?? null)
    onPanel(tab)
  }

  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, tab: Panel) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1]
      : tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]
    chooseTab(next)
    tabButtons.current.get(next)?.focus()
  }

  function inspect(node: MapNode) {
    focusDetails.current = true
    onSelect(node.id)
  }

  function listKeys(event: KeyboardEvent<HTMLUListElement>) {
    if (!current) return
    let next: MapNode | undefined
    switch (event.key) {
      case 'ArrowDown': next = filtered[Math.min(currentIndex + 1, filtered.length - 1)]; break
      case 'ArrowUp': next = filtered[Math.max(currentIndex - 1, 0)]; break
      case 'Home': next = filtered[0]; break
      case 'End': next = filtered.at(-1); break
      case 'Enter':
      case ' ':
        event.preventDefault()
        inspect(current)
        return
      default: return
    }
    if (!next) return
    event.preventDefault()
    if (next !== current) onMove()
    focusRow(next)
  }

  return (
    <aside className="inspector" id="graph-inspector" aria-label="Star index" hidden={!expanded}>
      <div className="inspector-tabs" role="tablist" aria-label="Star index panels">
        {tabs.map((tab) => (
          <button key={tab} type="button" role="tab" id={`${id}-${tab}-tab`}
            aria-controls={`${id}-${tab}`} aria-selected={active === tab} tabIndex={active === tab ? 0 : -1}
            ref={(element) => { if (element) tabButtons.current.set(tab, element); else tabButtons.current.delete(tab) }}
            onClick={() => chooseTab(tab)} onKeyDown={(event) => tabKeys(event, tab)}>
            {tab}
          </button>
        ))}
      </div>
      <div ref={details} className="inspector-content" role="tabpanel" tabIndex={0}
        aria-labelledby={`${id}-Details-tab`} id={`${id}-Details`} hidden={active !== 'Details'}>
        {expanded && active === 'Details' && (selected ? (
          <>
            <div className="inspector-scope"><span>{view} details</span><span>{scope === 'through' ? `Through ${year}` : year}</span></div>
            <NodeDetails key={`${selected.id}/${scope}/${year}`} node={selected} period={period} view={view} demo={demo} showCatalogImages={showCatalogImages} />
          </>
        ) : (
          <div className="inspector-empty">
            <h2>{nodes.length ? 'No item selected' : 'No items to inspect'}</h2>
            {nodes.length > 0 && <p>Select an item on the chart or in Stars.</p>}
          </div>
        ))}
      </div>
      <div className="node-panel" role="tabpanel" aria-labelledby={`${id}-Stars-tab`} id={`${id}-Stars`} hidden={active !== 'Stars'}>
        {nodes.length ? (
          <>
            <label className="star-search" htmlFor={`${id}-search`}>
              <span>Find a star</span>
              <input ref={search} id={`${id}-search`} type="search" value={query} onChange={(event) => { setCursor(null); setQuery(event.currentTarget.value) }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' || !filtered[0]) return
                  event.preventDefault()
                  onMove()
                  focusRow(filtered[0])
                }} placeholder="Name, genre or track" />
            </label>
            {focused && <button type="button" className="plain-button index-overview" onClick={() => {
              onExitFocus()
              search.current?.focus()
            }}>Back to chart overview</button>}
            <p id={`${id}-help`} className="node-help">Use the arrow keys to browse and Enter to inspect.</p>
            {filtered.length ? <ul className="node-list" role="listbox" aria-label={`${view} nodes ${period}`} aria-describedby={`${id}-help`} onKeyDown={listKeys}>
              {filtered.slice(page * pageSize, (page + 1) * pageSize).map((node, index) => (
                <li key={node.id} role="option" aria-selected={node.id === selected?.id} tabIndex={node.id === current?.id ? 0 : -1}
                  aria-posinset={page * pageSize + index + 1} aria-setsize={filtered.length}
                  aria-label={node.kind === 'discovery' ? `${node.name}, ${discoveryLabel(node)}` : node.publicBand !== undefined
                    ? `${node.name}, rank ${node.rank}, ${formatPublicBand(node.publicBand, node.publicBandYears)} listened`
                    : `${node.name}, rank ${node.rank}, ${formatDuration(node.minutes)}, ${node.events} play events${node.rediscoveredAfter ? ', rediscovered' : ''}`}
                  ref={(element) => { if (element) nodeRows.current.set(node.id, element); else nodeRows.current.delete(node.id) }}
                  onFocus={() => setCursor(node.id)} onClick={() => inspect(node)}>
                  <span className={`node-marker ${node.kind}`} />
                  <span><strong>{node.name}</strong><small>{node.kind === 'discovery' ? discoveryLabel(node) : node.artistName ?? node.genre}</small></span>
                  {node.kind === 'listened' && <span className="node-duration">{node.publicBand === undefined ? formatDuration(node.minutes) : formatPublicBand(node.publicBand, node.publicBandYears)}</span>}
                </li>
              ))}
            </ul> : <p className="node-help" role="status">No stars match your search.</p>}
            {pageCount > 1 && <div className="node-pages">
              <button type="button" className="plain-button" disabled={page === 0} onClick={() => focusRow(filtered[(page - 1) * pageSize])}>Previous page</button>
              <span>{page + 1} / {pageCount}</span>
              <button type="button" className="plain-button" disabled={page === pageCount - 1} onClick={() => focusRow(filtered[(page + 1) * pageSize])}>Next page</button>
            </div>}
          </>
        ) : <p className="node-help" role="status">No nodes in {year}.</p>}
      </div>
    </aside>
  )
}
