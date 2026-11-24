# Spotify API availability and compliance

Verified against Spotify's public developer documentation **November 18, 2026**. Recheck before coding each integration. An endpoint appearing in API reference does NOT prove a new Development Mode app can call it.

## Key restrictions
- Spotify stopped granting new API apps access to **Get Recommendations** and **Audio Features** in November 2024. Do not make these requirements foundational to the project.
- In February 2026, Development Mode removed **Get Several Tracks**, **Get Several Albums** and **Get Several Artists** endpoints. They are not valid default batch calls for a new app; evaluate single-item endpoints or a properly permitted alternative.
- Artist `genres` is deprecated and may be empty. Album `genres` is deprecated and documented as always empty. Use reviewed tags or a permitted metadata source for genre mode.
- Get User's Top Items returns affinity for artists or tracks over preset windows of roughly four weeks, six months, and one year. Use UTC play-end timestamps from Extended Streaming History for calendar-year listening totals.
- Development Mode app owners need Spotify Premium. The limit for authorized test users is generally five for new apps.
- In July 2026, the Development Mode Client ID limit increased to 25 per developer account and quotas became shared at the developer-account level. `429` responses can include `reason: QUOTA_EXCEEDED`.
- Availability of any given endpoint/field/scope must be confirmed with current docs and actual authorized test calls; no simulated API success states presented as real.
- Spotify’s single-track reference marks `preview_url` as deprecated and nullable. The developer policy limits preview clips to promoting the underlying content. The demo uses locally synthesized auditions and a separately labeled public catalog pick with a direct link and an explicitly loaded official Embed. The app delegates that pick’s playback availability to Spotify.

## Design consequence
- Extended Streaming History import and listening graph must not require Spotify OAuth.
- Recommend a provider adapter returning `{ source, fields, provenance, link }` with an explicit `unavailable` state.
- MVP clusters through optional user-tagged genre, same artist, session co-listening and other locally computed measures.
- Recommendations require an independent candidate pool and an honest explanation. A dashed node is not an official Spotify recommendation unless documented and authorized as such.

## OAuth if needed later
- Browser/public client: Authorization Code with PKCE; never embed Spotify client secret in shipped JS.
- Confidential server client: keep credentials server-side and protect sessions/tokens; request only necessary scopes.
- Follow Spotify's rate limit and quota guidance; cache only where Spotify's policies and relevant provider terms permit it, with appropriate expiration/deletion.

## Spotify visual branding
- Spotify-provided cover art must stay in original form: do not crop, dither, obscure, overlay or filter it. Use full artwork with an appropriate frame.
- Spotify metadata and artwork need attribution and a Spotify link per their current branding guidelines.
- Don't use Spotify content to train AI models; don't facilitate downloading Spotify-provided music/content.

## Optional owner artwork refresh

The local preparation command uses Spotify Client Credentials and single-track catalog lookups only when explicitly invoked with `--spotify-art`. It checks the associated album title and artist before storing the artwork URL and album link, and sends no play count, timestamp or duration. It stops on access/rate-limit errors and keeps existing matches. Genre tags still come from MusicBrainz and suggestions from ListenBrainz. A missing credential, denied endpoint, or unmatched album can leave artwork unavailable.

The default is a 60-entry run across albums and artists. Annual Focus entries, newest year first, take priority over cumulative Focus entries. Remaining missing artwork follows. Artist portraits use the matching album credit from Get Track and the single-artist endpoint. `--spotify-limit=<count>` selects a run size, and `--spotify-limit=all` checks the full eligible set. The importer paces requests and checkpoints every 60 completed entries. A rate-limit response reports Spotify's retry interval when provided.

The optional local visitor service accepts same-origin POST requests on loopback. It resolves one catalog ID at a time using the same verified response fields. A standalone static deployment can show prepared and exact matches from the owner chart. Live visitor lookup on a hosted deployment requires a same-origin server route and protected Spotify credentials.

Genre refresh uses MusicBrainz independently of Spotify credentials and artwork lookup. Run `npm run prepare:owner-chart -- --genres` against the local owner draft. It prioritizes Focus entries and checks up to 90 by default. `--genre-limit=<count>` changes the run size.

Album credit refresh uses the paginated Get Album Tracks endpoint for existing verified Spotify album links and the matching MusicBrainz release endpoint for known cover releases. Run `npm run prepare:owner-chart -- --credits` to update the local draft. It checks up to 60 pending Spotify albums by default with `--credit-limit=<count>` available. Spotify rate or access limits can leave credits incomplete. Only matched catalog IDs are sent, and the saved names are catalog credits.

## Primary references
- https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
- https://developer.spotify.com/documentation/web-api/references/changes/february-2026
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- https://developer.spotify.com/documentation/web-api/reference/get-an-artist
- https://developer.spotify.com/documentation/web-api/reference/get-an-album
- https://developer.spotify.com/documentation/web-api/reference/get-an-albums-tracks
- https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks
- https://developer.spotify.com/documentation/web-api/reference/get-track
- https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed
- https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates
- https://developer.spotify.com/documentation/design
- https://developer.spotify.com/policy
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
