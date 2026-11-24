import { useState } from 'react'
import { isSpotifyArtwork } from '../domain/public-chart.ts'
import type { CatalogArt } from '../domain/public-chart.ts'
import type { View } from '../graph/model.ts'
import spotifyMark from './spotify-mark.svg'

export function SpotifyArtworkCredit({ href = 'https://open.spotify.com/', album = false, artist = false }: { href?: string; album?: boolean; artist?: boolean }) {
  return <a className="spotify-art-credit" href={href} target="_blank" rel="noopener noreferrer">
    <img src={spotifyMark} alt="Spotify" width={21} height={21} /> {album ? 'Open album' : artist ? 'Open artist' : 'Spotify artwork'}
  </a>
}

export function ArtworkStar({ caption }: { caption?: string }) {
  return <p className="item-genre"><span aria-hidden="true">✦</span>{caption && <span>{caption}</span>}</p>
}

export function CatalogArtwork({ art, view }: { art: CatalogArt; view: View }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <ArtworkStar caption="Catalog artwork could not load" />
  return (
    <figure className="artwork catalog-artwork">
      <img className="catalog-cover" src={art.url} alt="Catalog artwork" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      <figcaption>{isSpotifyArtwork(art) ? <SpotifyArtworkCredit href={art.source} album={view === 'Album'} artist={view === 'Artist'} /> :
        <a href={art.source} target="_blank" rel="noopener noreferrer">{art.credit}</a>}</figcaption>
    </figure>
  )
}
