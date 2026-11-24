import { useState } from 'react'
import type { MapNode } from '../graph/model.ts'

export function SpotifyLink({ node }: { node: MapNode }) {
  if (!node.spotifyAlbumId) return null
  return <a className="plain-button external-link" href={`https://open.spotify.com/album/${node.spotifyAlbumId}`}
    target="_blank" rel="noopener noreferrer">Open Dive in Spotify</a>
}

export function SuggestedLink({ node }: { node: MapNode }) {
  const pick = node.recommendation
  if (!pick) return null
  const resource = pick.kind === 'artist' ? 'artist' : 'release-group'
  return <a className="plain-button external-link" href={`https://musicbrainz.org/${resource}/${pick.mbid}`}
    target="_blank" rel="noopener noreferrer">Find {pick.kind} on MusicBrainz</a>
}

export function DiscoveryDetails({ node }: { node: MapNode }) {
  const [player, setPlayer] = useState(false)
  return (
    <div className="discovery-reason">
      <h3>Why it’s here</h3>
      <p>{node.reason}</p>
      {node.spotifyAlbumId ? (
        <div className="discovery-actions">
          <SpotifyLink node={node} />
          <button className="plain-button" type="button" aria-expanded={player} onClick={() => setPlayer((value) => !value)}>
            {player ? 'Close Spotify player' : 'Load Spotify player'}
          </button>
          {player && <iframe className="spotify-player" title="Spotify player for Dive by Tycho"
            src={`https://open.spotify.com/embed/album/${node.spotifyAlbumId}`} referrerPolicy="no-referrer" allow="encrypted-media" />}
        </div>
      ) : node.recommendation ? (
        <div className="discovery-actions"><p>Source: {node.recommendation.source === 'artist-similarity' ? 'ListenBrainz Similar Artists' : 'ListenBrainz Radio'}</p><SuggestedLink node={node} /></div>
      ) : <p>Source: fictional demo catalog</p>}
    </div>
  )
}
