# AGENTS.md — Spotify Listening Map

## Goal
Build a beautiful, accessible, **single-user** listening-history explorer based on Spotify's Extended Streaming History JSON export. The Starfield design uses a sparse monochrome atlas where artists form constellations and track satellites appear on zoom. Function over decoration.

## Before every code task
1. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, `docs/INTERACTIONS.md` as relevant.
2. For ZIP import, auth, network, persistence or remote data, also read `docs/SECURITY.md`, `docs/PRIVACY.md`, `docs/SPOTIFY_INTEGRATION.md`.
3. Identify the smallest testable change. Do not rewrite unrelated features.
4. Check the existing project scripts instead of inventing commands.
5. Explain any dependency, API limitation, or change in behavior that affects the product.

## Nonnegotiable rules
- **Never** include API credentials, user listening history, tokens, or uploaded ZIPs in source control, client bundles, logs, screenshots, sample fixtures or error telemetry.
- Do not assume Spotify Audio Features, Recommendations, or batch metadata endpoints are available to a new Development Mode app.
- Uploads are hostile input. Apply limits, validate content, reject traversal and bombs, sanitize/escape strings, and test malformed files.
- Local-first: ZIP import, playback aggregation, graph layout, timeline, and inspection must work without OAuth or a backend.
- Use synthetic fixtures for automated tests. Real datasets are private.
- Distinguish real recommendations, heuristic discovery suggestions, and demo placeholders in both code and UI.
- Do not alter, crop, dither or overlay Spotify-sourced album art. Show required attribution and links if Spotify data is presented.
- Preserve the canvas's visual hierarchy and use keyboard-accessible alternative navigation for all nodes.
- Respect `prefers-reduced-motion`. Avoid forced motion and unnecessary animations.
- Use TypeScript strict mode and validate external data at runtime.
- Never claim tests, scans or API checks passed unless actually executed.

## Completion criteria for every task
- Implement only the requested scope; note any unresolved assumptions.
- Run available lint, typecheck and focused tests; summarize actual results.
- For UI changes, check loading, empty, error, mouse, keyboard, small screen and reduced-motion states.
- For data or security changes, add regression tests including malicious and malformed input.
- Update documentation when contracts, behavior or decisions change.

## References
- `docs/BUILD_PLAN.md` — milestones
- `docs/TEST_PLAN.md` — test matrix
