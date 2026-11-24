# Spotify Listening Map

Listening Map charts Spotify Extended Streaming History with React, TypeScript, and Canvas. It reads extracted audio JSON files, then builds an artist and album chart for each UTC calendar year.

## Run locally

Use Node.js 22.13+ on the 22.x line or Node.js 24+.

```sh
npm ci
npm run dev
```

Open the Local URL that Vite prints. Windows PowerShell users can invoke `npm.cmd` if the PowerShell execution policy blocks the npm shim.

Choose **Load history files** or open **History** from the owner chart and select the `Streaming_History_Audio_*.json` files from the extracted Spotify archive. The import stays in browser memory until cleared or reloaded. Clearing an import restores the default chart when available. Private charts include every imported artist and album. Select an album to see its exact listening time and use **All tracks** for the exact time on each played track. **Year** and **Through year** share the selected year.

Switch between **Year** and **Through year** above the timeline. Each mode remembers its own slider position. Year shows that UTC calendar year's activity. Through year combines activity from the beginning of the archive through the selected year. On the public chart, the cumulative view covers the shared entries and their approximate listening bands.

### Hosting on GitHub Pages

1. Push the source to a GitHub repository. Keep local environment files, listening exports, and `.owner-review/` out of Git.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy Listening Map to GitHub Pages** and run it from the default branch.

The workflow builds the static site with `npm run build:pages` and publishes the generated HTML and assets. This build supports browser-local history import and can open a separately supplied public owner chart. Live Spotify lookup and the synthetic demo are unavailable in hosted builds. [GitHub Pages publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

### Hosting the owner map on Vercel

1. Run `npm run prepare:public-chart` locally. Review `.owner-review/public-candidate.json` before sharing it. It contains your artist and album names, calendar years, approximate listening ranges, ranks, suggestions and reviewed catalog metadata. It omits played-track titles and local-only artist grids. Verified catalog tracklists and eligible remote artwork remain.
2. If you approve that file for public viewing, upload just the candidate to a public Vercel Blob store. Anyone with that URL can read it. Keep the draft and your streaming export local. [Vercel public Blob storage](https://vercel.com/docs/vercel-blob/public-storage)
3. In Vercel, set `LISTENING_MAP_APPROVED_CHART_URL` to the candidate's public Blob URL. Use `npm run build:owner` as the build command if the project has an existing override, and `dist` as the output directory. The build validates the candidate and serves it from the site as `owner-chart.json`.
4. Deploy the updated source. Visitors land on your owner map and can use **History** to load their own JSON files. **Clear imported data** returns them to your chart.

### Public owner default

Run `npm run prepare:owner-chart` with `LISTENING_MAP_HISTORY_DIR` set to the extracted export. This prepares a local draft in `.owner-review/owner-chart.json` with all eligible artists and albums. With approval for sending selected names and IDs to catalog providers, append `-- --catalog` to fetch metadata and discovery candidates for selected high-ranked entries. Use `-- --tracklists` to update MusicBrainz catalog tracklists for existing matched cover releases. With the owner's approval, `-- --include-played-titles` adds alphabetical played-song titles across the archive for albums without a catalog tracklist. Later rebuilds retain those approved titles where applicable.

Review the visible artists and albums, time bands, artwork rights and credits, and discovery picks before releasing the draft. To publish an approved pack, have the deployment serve it as `owner-chart.json` next to the app's `index.html` with `Content-Type: application/json`. The application fetches it at runtime. The build has no dependency on the local review directory.

The pack includes annual and cumulative entry ranks, half-hour listening bands, catalog metadata, and separate artist and album suggestions. Exact durations, counts and timestamps stay with the owner. The chart can fetch credited artwork when **Images** is enabled. The [MusicBrainz catalog license](https://musicbrainz.org/doc/About/Data_License) and each image's source terms apply to the deployed pack.

Run `npm run prepare:owner-chart -- --credits` to refresh album and track credits for existing catalog matches in the local review draft. Selecting an album includes all releases in the current period by its primary artist and releases with a verified track credit for that artist.

Run `npm run prepare:owner-chart -- --genres` to refresh genres in the existing owner draft. This checks up to 90 selected entries, prioritizes Focus, and sends the selected names and album titles to MusicBrainz. Use `--genre-limit=<count>` to change the batch size. The refresh saves progress as it goes and skips recent misses on later runs.

For optional Spotify artwork, set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in the local environment or ignored `.env.spotify.local`, then run `npm run prepare:owner-chart -- --spotify-art`. It checks up to 60 new albums or artists by default. Add `--spotify-limit=300` to check up to 300 entries, or `--spotify-limit=all` to check every eligible entry missing artwork. Each lookup starts with one track ID. The optional `SPOTIFY_MARKET` defaults to `CA`. Spotify artwork links to its catalog entry.

The refresh prioritizes missing album covers and artist portraits in annual Focus views, newest year first, then in Through Year Focus views. Remaining entries follow. It saves every 60 completed lookups and on a graceful stop. If Spotify rate-limits the run, wait for the printed interval and run the same command again. Saved artwork and recent misses are skipped. The command reports additions, the total saved, and eligible entries still queued.

For ListenBrainz artist artwork, set `LISTENBRAINZ_CONTACT` in the ignored `.env.listenbrainz.local` file to a maintainer email address or HTTPS contact page. Run `npm run prepare:owner-chart -- --listenbrainz-art`. It queues annual Focus artists before cumulative Focus artists, then artists eligible for Explore. It checks up to 30 pending entries per run by default. Use `--artist-art-limit=<count>` to change the batch size. The public artist-grid endpoint needs no user token. The refresh spaces API calls at least 1.1 seconds apart and saves the quota reset time when the provider's limit is reached. [ListenBrainz artist art](https://listenbrainz.readthedocs.io/en/latest/users/api/art.html#get--1-art-artist-grid-(uuid-artist_mbid)-(int-dimension)-(int-layout)-(int-image_size)) [ListenBrainz rate limits](https://listenbrainz.readthedocs.io/en/latest/users/api/index.html#rate-limiting)

ListenBrainz artist grids contain album covers and replace previously credited Wikimedia Commons photos as matches are saved. Existing Spotify portraits continue to work. The generated files are in `.owner-review/artist-art/`. For a public release, review the artwork rights and serve approved files in the `artist-art/` folder alongside the approved chart.

Run `npm run prepare:owner-chart -- --listenbrainz-similarity` to cache ListenBrainz Similar Artists data for up to 30 pending owner artists, with Focus entries first. Use `--similarity-limit=<count>` to set a batch size. The refresh uses the existing local maintainer contact, spaces requests by at least 1.1 seconds and respects quota pauses. Successful seeds are kept when the draft is rebuilt. The public similarity endpoint works without a user token. [ListenBrainz Similar Artists](https://labs.api.listenbrainz.org/similar-artists)

Related artists played in the selected period can be linked in Artist view. An artist already in the full loaded archive is excluded from suggestions even when absent from the selected year. On selection, the map prioritizes the selected artist's unheard matches. Existing ListenBrainz Radio suggestions can fill the remaining slots.

### Private default for local development

To preload your own archive during development, set `LISTENING_MAP_HISTORY_DIR` to the extracted folder outside the project. In PowerShell:

```powershell
$env:LISTENING_MAP_HISTORY_DIR = 'C:\path\to\extracted-history'
npm.cmd run dev -- --port 5174 --strictPort
```

Vite serves the owner review draft over loopback when present. Open **History → Full private map** or add `?private` to open the configured private archive with full listening details. Browser imports can replace either view.

### Exploring a chart

The chart opens in **Album**, **Hours**, and **Explore**, with images enabled for the latest calendar year in **Year** mode. **Focus** shows the 45 most-listened artists or albums for the active period. In **Hours**, the most-listened entry sits at the center, with lower ranks spreading toward the edge. **Genre** separates tagged groups and gives untagged entries their own group.

In Explore, Images loads available covers for albums with more than two hours of lifetime listening and artwork for artists with more than four hours. These cutoffs apply to the entire archive, even when viewing an early year. Focus keeps its artwork priority at every duration.

Entries without a loaded image appear as stars. Select **Star** to switch to star view or **Image** to switch back. After an import, switch to star view and back to image view to open the optional catalog lookup prompt.

Select a star to reveal tracks as satellites. Its name stays blue while linked stars use a lighter blue. Only the selected star, its linked stars and its satellites respond while selected. Click empty sky or press **Escape** to restore your previous zoom and pan. In the **Index**, use the arrow keys in **Stars** and **Enter** to inspect. **Back to chart overview** restores browsing for the current mode.

Hover or selection keeps the star and its direct links bright. Telescope zoom reveals fainter stars and secondary connections. Changing years briefly draws each visible star’s previous chart positions. A comet tail marks a return with at least 120 play events after two or more complete years without listening to that entry. Twinkle reflects recency relative to the newest playback in the import.

Use **Find a star** to search names and tracks. Drag the top **Volume** knob to adjust local control sounds in 25% steps. Up or right increases the volume. Down or left decreases it. Click a half of the knob or use the arrow keys to move one step. For local development and testing, add `?demo` to open the synthetic chart.

Drag a node to pin it or drag the background to pan. Scroll, pinch, or focus the chart and press **+** or **−** to zoom in fixed steps. Zoom steps play a mechanical click when volume is above zero. Press **0** on the chart to restore positions and zoom.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

The browser suite uses the production build. Set `PLAYWRIGHT_CHANNEL=msedge` to run it with an installed Microsoft Edge instead of installing Chromium. Screenshots go to the ignored `test-results/` folder.

## Documentation
- `AGENTS.md` — durable instructions Codex recognizes automatically.
- `docs/PRODUCT.md` — product contract and acceptance criteria.
- `docs/DESIGN_SYSTEM.md` — UI aesthetic and accessibility.
- `docs/INTERACTIONS.md` — map behavior, animations, control semantics.
- `docs/ARCHITECTURE.md` — isolation of UI, parsing, graph and integrations.
- `docs/DATA_PIPELINE.md` — history parsing, normalization and similarity.
- `docs/SECURITY.md` — threat model and security controls.
- `docs/PRIVACY.md` — personal listening-history handling.
- `docs/SPOTIFY_INTEGRATION.md` — API restrictions, rights and fallback design.
- `docs/TEST_PLAN.md` — test cases and release gates.
- `docs/BUILD_PLAN.md` — incremental implementation tasks.

Direct ZIP import remains future work. In the local Vite preview, visitors can opt in to artwork lookup after import. Hosted static builds can reuse exact matches from the owner chart. [Spotify integration](docs/SPOTIFY_INTEGRATION.md)
