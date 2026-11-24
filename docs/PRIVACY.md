# Privacy commitments for a personal listening-history app

## Guiding principle
A Spotify Extended Streaming History export is sensitive behavioral data. The user should be able to experience the core graph without submitting it to a service or connecting Spotify.

## Defaults
- Process ZIP locally in the browser, in memory; do not upload to a backend by default.
- No accounts, server logs, telemetry, third-party analytics, sharing or cloud persistence required for MVP.
- Show a clear pre-import statement: what is read, what is excluded, what is stored, what is transmitted.
- Provide an unmistakable `Clear imported data` control. Clarify whether data disappears on refresh, close, or session end.
- Do not autofill example data from a real user's export. Fixtures must be synthetic.
- Local synthesis, search, and chart interaction perform no external requests. The curated Spotify link and player contact Spotify only through their explicit controls. The player receives a fixed public album identifier, with the page referrer suppressed.

## Extracted JSON and local default

- The file picker processes extracted audio JSON in a browser worker. Clearing or reloading drops the visitor's in-memory replacement. The import uses music titles, played time and UTC dates. Device and connection fields are discarded.
- An explicitly configured development session can preload the owner's derived chart over loopback. Raw files stay outside the project. The response is same-origin and non-cacheable. It contains top entries, their playback totals and dates, top-track summaries, and graph edges. The local default can be hidden for the current page session.
- The optional owner default relies on a reviewed release pack served at runtime. It includes the artist and album identities per UTC year, annual and cumulative listening ranks, half-hour listening bands, and catalog metadata and suggestions. Exact dates, durations, event counts, and device or connection metadata stay in the private archive.
- The published Explore artwork marker only indicates whether an artist or album exceeded its lifetime artwork cutoff. It carries no exact duration.
- Album credit refresh sends existing matched album IDs to catalog providers. Exact durations are computed in the private map from elapsed milliseconds in the export.
- A preparation command can send selected displayed artist and album names to MusicBrainz, then use catalog IDs for art and suggestions with the owner's approval. Raw files, timestamps, and listening counts stay local. The default image view may load previously matched artwork from credited providers. These requests suppress the page referrer. New catalog lookups for visitor imports require explicit opt-in.
- ListenBrainz artist grids are prepared with public MusicBrainz artist IDs and a maintainer contact in the User-Agent. The app uses no ListenBrainz user token for this request. Prepared grids are served as same-origin assets to the browser.
- Artist similarity preparation sends verified public artist IDs and the configured maintainer contact to ListenBrainz. An exact MusicBrainz catalog match may first use the name of a prioritized owner artist. The lifetime exclusion is computed in the app from the loaded archive. Visitor imports can reuse cached matches without sending names or listening details to a similarity provider.
- The genre-only command sends selected artist names and album titles from the owner draft to MusicBrainz. It stores digests of recent misses in the ignored review directory. Visitor imports reuse known matches locally.
- Visitor imports replace the chart only in that browser session. Clearing them restores the owner default. Files and listening statistics stay in the browser. Missing artwork lookups require an explicit choice after enabling Images.
- The full owner map is served through the loopback-only private-history route when configured. Public tracklists are MusicBrainz catalog titles where matched. With explicit approval, albums without a catalog tracklist can show alphabetical played-song titles across the archive. Titles have no year assignment, playback counts or timestamps.
- Explicit Spotify artwork preparation sends one track ID for each queued album or artist to Spotify. Larger runs require a separate limit option. Client credentials and the owner track-ID map stay in the preparation process. The ignored owner review directory keeps digests of recent unsuccessful matches for resumption and prunes them after seven days on the next run.
- In the local preview, visitor artwork requests contain a single representative track ID and an album or artist lookup type. Match verification happens in the browser. The loopback service uses its app credentials and a bounded, temporary catalog cache. Visitor files, names from the archive, play counts, and dates stay in the browser.

## If external metadata lookup is enabled
- Ask before sending Spotify IDs, artist/album names or other derived identifiers to third-party providers. Explain what the provider receives.
- Minimize sent data and retention. Do not contact metadata services on import without explicit action or informed setting.
- Distinguish fetched metadata from private history in caches and deletion logic; follow each provider's license/policy.

## If OAuth or hosted storage is added
- Explain requested scopes and why. Offer disconnection, token revocation instructions, full deletion and transparent retention.
- Do not store refresh tokens in browser localStorage. Prefer properly protected server-side sessions if a backend is used.
- Review Spotify's current Developer Terms and Policy: https://developer.spotify.com/terms and https://developer.spotify.com/policy

## Privacy testing
- Network tab during local import shows no outgoing history requests.
- Clear-data feature removes all app-created retained local data.
- No private metadata in URL query strings, console logs, error traces, public static assets or screenshots.
