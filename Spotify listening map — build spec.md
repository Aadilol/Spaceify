# Spotify listening map — build spec

*A detailed build brief, written to hand directly to a coding assistant.*

## Overview

Build a single-user web app that visualizes a person's Spotify listening history as an interactive node-link canvas. The most-played album sits at the center; albums similar to each other are connected by solid lines and cluster organically; a toggle switches the view between albums and artists; a year slider scrubs through how listening habits changed over time; and an outer ring of recommended (not-yet-listened) albums connects to the cluster via dotted lines.

The data source is the user's Spotify **Extended Streaming History** export (requested from Spotify's privacy page, arrives as a ZIP of JSON files after a few days) — not the live API's limited "top tracks" endpoints, which only cover rolling 4-week/6-month/all-time windows.

## Step 1: parse the Extended Streaming History export

- Input: a ZIP containing files like `Streaming_History_Audio_2021-2022_0.json`, each an array of play events.
- Each event has fields including `ts` (timestamp), `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `spotify_track_uri`, `episode_name` (present for podcasts), `skipped`, `shuffle`.
- Filter out podcast/episode entries (where `episode_name` is not null or `master_metadata_track_name` is null).
- Group remaining events by `spotify_track_uri`. For each track, sum `ms_played` and count plays, and bucket both by calendar year (derived from `ts`) to support the year slider later.
- Normalize album identity as (album name, primary artist) so deluxe/reissue variants of the same album don't fragment into duplicates — fuzzy-match on normalized lowercase strings if needed.

## Step 2: enrich with metadata and audio features

The raw export has no genre or audio-feature data, so enrich it via the Spotify Web API (requires OAuth; keep the client secret server-side, never in the frontend):

- Batch the unique track URIs through `Get Several Tracks` (max 50 per call) to resolve album ID, album art URL, and release year.
- Batch album IDs through `Get Several Albums` to resolve genre tags (Spotify attaches genres at the artist level, so pull from `Get Several Artists` too) and artist IDs.
- Batch track IDs through `Get Several Audio Features` to get `tempo`, `energy`, `valence`, `danceability`, and `acousticness` per track, then average these per album.
- Cache all enriched results locally (a JSON file or SQLite row per album) so re-running the pipeline doesn't re-hit rate limits.

Resulting data model per album:

```
Album {
  id, name, artistNames[], imageUrl, releaseYear,
  genres[], primaryGenre,
  audioFeatures: { tempo, energy, valence, danceability, acousticness },
  totalMsPlayed, playCount,
  msPlayedByYear: { [year]: number }
}
```

Build an equivalent `Artist` aggregation (sum/average the same fields across all of the artist's albums) to support the Album/Artist view toggle.

## Step 3: compute similarity and build the listened-album graph

- For the MVP, compute a similarity score between every pair of listened albums as a weighted combination of (a) genre tag overlap (Jaccard similarity on the `genres[]` sets) and (b) audio-feature distance (cosine or Euclidean distance on the averaged feature vector).
- For each album, connect it to its 1–2 most similar other listened albums with a solid line. This nearest-neighbor graph is what produces the organic clustering — don't connect every pair, only nearest neighbors, or the canvas becomes an unreadable mesh.
- Store the similarity score on each edge; it will later control edge length/strength in the force layout, not just presence.

## Step 4: generate recommendations

- For each outer-cluster album (one with few/no internal connections, i.e. a "frontier" node), call Spotify's `Get Recommendations` endpoint seeded with that album's top tracks and target audio-feature values (its averaged `audioFeatures`).
- Filter out any returned track whose album is already in the listened set.
- Attach each recommended album to the frontier album that generated it via a dotted-line edge. Cap total recommendations shown (e.g. one per frontier node, max \~15 total) to avoid clutter.

## Step 5: layout and rendering

- Use a force-directed simulation (`d3-force` is the standard choice) with: `forceManyBody` for node repulsion, `forceLink` for edges (set solid-edge distance inversely proportional to similarity score — more similar albums pull closer together), `forceCollide` sized to each node's radius to prevent overlap, and a strong custom centering force pinning the single most-played album (by `totalMsPlayed`) at the canvas center.
- Render on an HTML `<canvas>` rather than SVG once node counts climb past \~50–100 — far better performance for drag/zoom/pan.
- Node radius: scale by `Math.sqrt(totalMsPlayed)` or `Math.log(totalMsPlayed)`, clamped to a sane min/max pixel range. Do not scale linearly — listening time is typically power-law distributed, so a linear scale makes the #1 album a giant blob and everything else invisible.
- Edge styling: solid teal-ish strokes for listened-similarity edges (opacity scaled by similarity strength), dashed gray strokes for recommendation edges.
- "Floating" motion: once the simulation's alpha decays near zero and the layout has settled, stop the simulation and apply a small independent per-node sinusoidal position offset on every animation frame (a few pixels, a few seconds per cycle) so nodes drift gently without the layout itself reshuffling.

## Step 6: UI controls

- **Album / Artist toggle**: switches the active node set between the per-album graph and the per-artist aggregation; re-run the layout (steps 3–5) against whichever dataset is active.
- **Sort control — "None" vs "Genre"**: "None" is the similarity-driven organic layout from step 5, centered on the most-played item. "Genre" mode adds an invisible gravity anchor point per distinct `primaryGenre`, and each node is additionally pulled toward its genre's anchor — nodes still connect via their similarity edges, but now cluster spatially by genre first.
- **Year slider**: a scrub control spanning the years present in `msPlayedByYear`. On change, recompute the active node set as the top N albums (by that year's `msPlayedByYear[year]`, cap N at \~30–50) and re-run layout. Use stable keys (album ID) so nodes entering/leaving the top N fade and scale in/out via tweened transitions rather than popping.
- **Node click**: opens a detail panel showing album art, artist, total time played, play count, and — for recommended nodes — a one-line "why this was recommended" explanation (e.g. "similar energy and tempo to \[X\]").
- **Zoom and pan**: standard `d3-zoom` behavior over the canvas.

## Tech stack

- **Frontend**: React + TypeScript, `d3-force` for physics, HTML canvas for rendering (or `react-force-graph` as a faster-to-ship alternative to hand-rolling the canvas loop), Tailwind for the surrounding UI chrome (toggle, slider, detail panel).
- **Backend**: a small Node/Express service (or serverless functions) that handles Spotify OAuth, proxies the batched `Get Several Tracks` / `Get Several Audio Features` / `Get Several Albums` / `Get Recommendations` calls so the API client secret never reaches the browser, and runs the one-time ETL job that turns the uploaded Extended Streaming History ZIP into the enriched album/artist dataset.
- **Storage**: this is a personal, single-user app — a local JSON file or SQLite database for the enriched dataset is sufficient; no hosted multi-user database is needed unless the scope expands later.

## Build order

1. Parse the Extended Streaming History export and compute `totalMsPlayed`/`playCount` per album, enriched with just artist name, album art, and genre (skip audio features for now). Render a static force-directed cluster of listened albums only, sized by `totalMsPlayed`, connected by genre-overlap similarity. No recommendations, no year slider yet.
2. Add audio-feature-based similarity (step 3's full version) to improve clustering quality beyond genre overlap alone.
3. Add the outer recommendation ring (step 4).
4. Add the year slider with tweened enter/exit transitions.
5. Add the Album/Artist toggle and the Sort-by-genre mode.
6. Polish: idle floating animation, click-to-detail panel, zoom/pan, responsive sizing.

## Constraints and edge cases

- Filter podcasts/episodes out of the raw export before any processing.
- Normalize album identity carefully — deluxe editions, remasters, and regional re-releases of the same album should merge, not fragment.
- Cap the number of nodes rendered per view (configurable, default \~30–50) for heavy listeners with thousands of distinct albums; aggregate anything beyond the cap into a single "+N more" ghost node rather than rendering everything and killing performance.
- Respect Spotify API rate limits — always batch requests at the maximum allowed size and cache enriched results so re-runs don't re-fetch unchanged data.
- For genre-sort mode, albums tagged with multiple genres need a tiebreak rule: use the single most frequent genre tag for primary placement, or blend multiple anchors weighted by tag frequency if two genres are roughly equally dominant.
- Track `msPlayedByYear` per album from the start (not just lifetime totals) — the year slider depends on it and it's much harder to retrofit later.
