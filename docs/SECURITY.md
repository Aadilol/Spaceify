# Security and threat model

Documentation is not proof of security. Verify controls with implementation, tests and review.

## Assets to protect
Private listening history, optional Spotify tokens, personally identifying export metadata, user device storage, optional cached data and API credentials.

## Attack surfaces and requirements

### Untrusted ZIP uploads (highest priority)
- Check magic/signature and expected file naming/JSON schemas; extension and Content-Type are not security boundaries.
- Bound compressed and decompressed bytes, entry count, compression ratio, JSON depth and row count.
- Block path traversal (`../`), absolute paths, symlinks, non-JSON and unexpected nested archives; do not extract into web-served directories.
- Reject malformed UTF-8, invalid timestamps, nonfinite numbers and unexpectedly huge strings; handle errors without exposing private data.
- Use maintained ZIP/JSON libraries; test ZIP bombs, ZIP Slip, invalid JSON and malicious filenames.

### Browser and UI
- Treat imported album/artist/track names as untrusted strings; render as text, never `innerHTML`.
- Validate and allowlist external image/link protocols and hosts as relevant; avoid unsanitized navigations and script/data URLs.
- Apply restrictive CSP and security headers where hosted; avoid unnecessary third-party scripts and trackers.
- Keep dependencies updated; commit lockfile; run audit and review high-risk findings.

### Optional OAuth/backend
- Only use OAuth if required by an actual feature; use minimum scopes.
- No client secrets in frontend, repository or logs. Use environment variables or a secret manager for server-side secrets.
- Use Authorization Code + PKCE for public clients; validate state, redirect URI and token exchanges.
- Protect backend endpoints with session authorization, CSRF controls where applicable, bounded requests, rate limits and strict CORS.
- Never expose an upload or analysis endpoint that lets anonymous outsiders read another person's history.
- Encrypt sensitive data in transit; choose storage protections appropriate to deployment.

### Persistence and privacy
- Prefer in-memory client processing. If persistence exists, opt-in, encrypted/permission-protected as applicable, deletable and not publicly served.
- No raw archives, tokens, identifiers, or track-level history in application logs, crash reports or third-party analytics.
- `.gitignore` must exclude `.env*` (except intentionally safe example), raw exports, caches, SQLite files and private generated fixtures.
- Validate the owner pack against an exact field allowlist and bounded size. Serve only the reviewed pack from the production deployment. Deny direct Vite file access to the ignored review directory and serve the draft through the guarded loopback endpoint.
- Rebuild ListenBrainz artist grids from bounded, allowlisted raster covers. Do not serve provider SVG markup or follow arbitrary image URLs. Serve only the reviewed generated assets with their owner pack.

## Security acceptance gate
- Malicious archives cannot write outside target area, hang processing indefinitely, trigger unbounded memory consumption, or be published.
- XSS test with hostile names; token/secret scanning; authorization checks for any hosted read API.
- Manual review is mandatory before public deployment; a Markdown file cannot enforce protection by itself.

## GitHub Pages release

- The Pages workflow builds from the default branch on manual dispatch. The build job can read the repository. Only the deployment job can write to Pages and request an identity token.
- The Pages build excludes the public input directory. A post-build check limits the artifact to the entry page and generated assets. The workflow also rejects files tracked against the repository ignore rules.
- The Pages HTML declares a content security policy that allows same-origin scripts, blob-based import workers, approved artwork hosts, and the Spotify player. Inline styles support the dynamic controls. The meta policy does not enforce framing protection. A host that supports custom headers can supply `frame-ancestors` and `X-Content-Type-Options` at the HTTP layer.
- The standalone Pages build offers browser-local import. The Vercel owner build stages a schema-validated, explicitly approved public candidate. The local development API and private owner review data are outside both hosted artifacts.

References: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html and https://wstg.owasp.org/
