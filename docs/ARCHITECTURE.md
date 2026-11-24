# Architecture — local-first by default

## Separation of concerns
1. `import/`: client-side ZIP inspection, safe JSON parsing, streaming-history field validation; outputs normalized `PlayEvent[]`.
2. `domain/`: deterministic album/artist aggregation, normalization, year slicing, ranking, optional genre classification.
3. `graph/`: similarity heuristics, edge limits and deterministic graph layout configuration; independent of React.
4. `ui/`: React/TypeScript shell, HTML canvas rendering, inspector, keyboard-accessible list.
5. `integrations/`: optional provider adapters for legally available metadata and discovery, with a no-network fallback.
6. `storage/`: optional explicit local persistence; distinguish user history from third-party licensed metadata and honor each provider's terms.

## Dependency direction
`ui -> domain/graph -> normalized data`; provider integrations feed the normalized data interface. No UI component should directly parse ZIP entries or call Spotify endpoints.

## MVP data flow
`Extracted audio JSON -> safe local reader -> validated play events -> annual artist and album totals -> graph -> canvas + HTML list`

## Phase 0 implementation

`src/domain/demo.ts` supplies fictional annual album totals, track play counts, and a fictional discovery catalog. `src/graph/` builds and ranks the demo graph independently of React. Deterministic Hours and Genre layouts assign the base positions. The canvas applies a separate drift offset and uses the same rendered coordinates for marks, lines, labels, and hit testing. The accessible list and inspector consume the same node model.

React and Vite provide the local frontend. The Node test runner covers graph behavior and Playwright checks the production client. Runtime artwork is drawn locally. Browser state stays in memory and the app has no data API.

## Extracted-history implementation

The browser sends selected audio JSON files to a worker. The bounded reader validates music rows and aggregates one file at a time. The resulting private snapshot holds all annual artist and album entries and their track totals. Through-year charts are derived from those annual aggregates. The UI uses one archive interface for real history and the synthetic fixture available at `?demo`.

The Vite development server can preload the same snapshot from an explicitly configured directory outside the project. It serves the aggregate only for same-origin requests to a loopback-only development session. The browser import runs independently of this adapter, which is excluded from the production app.

## Public owner chart

A Node preparation command projects all annual artist and album entries and cumulative ranks into a validated JSON pack. Optional reviewed metadata comes from MusicBrainz, Cover Art Archive, ListenBrainz, and Spotify. Existing packs can also show previously credited Wikimedia Commons photos. ListenBrainz Radio results supply artist and album suggestions and are filtered against owner catalog identities across all imported years.

Explore artwork eligibility is computed from exact lifetime listening time. The owner pack stores only the eligibility marker so clients do not need exact durations. An older pack requires a rebuild from the export to display images in Explore. Focus can use its existing artwork immediately.

A same-origin runtime file supplies the approved owner default. The Vite production build contains the loader and a synthetic fixture. A loopback-only preview of the ignored review directory takes precedence in development. The map opens without a production database or catalog lookup. Image view can load prepared artwork from approved hosts.

The preparation command fetches ListenBrainz artist grids independently of the interactive map. It reads only image references from the provider SVG, fetches allowlisted thumbnail formats, and constructs a self-contained local SVG. The browser loads the resulting asset from the site alongside the approved owner pack.

A separate preparation pass caches ListenBrainz Similar Artists results for matched MusicBrainz artist IDs. The client resolves those matches against the currently loaded archive, preserves its existing local relationships, and excludes previously heard artists using its all-years artist set. No provider request is needed to inspect, scrub, or import listening history.

The local Vite preview service can resolve consented visitor artwork lookups with Spotify. The browser keeps representative track identities in memory and validates exact catalog matches before attaching artwork. Graph layout and playback data work independently of the lookup. A static production build uses its available catalog artwork until connected to a hosted lookup route.

## Optional integrations
An OAuth backend is not required for offline MVP. Add one only after verifying current API availability and a feature requiring it. If added: secure server-side session, restricted CORS, CSRF defenses, cookies with `HttpOnly`, `Secure`, `SameSite` as appropriate, least privilege and rate limiting. Authorization Code + PKCE for browser clients; never embed a client secret in frontend JS.

## Performance budget
- Import processing should not block the main UI for large archives: use a Worker where appropriate, batch/yield, cancel support, bounds on memory and archive size.
- Large charts keep every node in a deterministic layout, draw low-ranked nodes as points at overview scale, bound edge candidates, and page the accessible index.
- Focus derives a smaller presentation graph from the same archive, limited to the top 45 listened entries. Its owner chart matches across that set using the full genre and tag comparison. Explore retains the complete archive and the bounded edge candidate lookup.
- Animate only when needed and throttle rendering in background or invisible contexts.

## Decision gate
Do not add a database, deployment, or server until a concrete feature requires them. If local history persistence is added, make it opt-in and provide full deletion.
