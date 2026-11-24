# Testing plan and release criteria

## Unit tests — parsing and business logic
- Empty ZIP, missing JSON, valid multi-year import, mixed music/podcast data, null fields, negative/nonfinite play duration, malformed dates, duplicate events.
- Year boundary tests; lifetime = sum of annual totals; play-event count independent of duration threshold; all-zero duration and tie scores.
- Same album with case/Unicode variations; deluxe/reissue ambiguity must not collapse without review.
- Similarity score bounds, deterministic top-N order and neighbor edges; no self-links, duplicate links or invalid radius.
- For extracted JSON, check duplicate chunks, exclusion of non-music, malformed UTF-8 and dates, nesting, input size caps, hostile filenames, and removal of device and connection fields from the chart snapshot.

## Security tests
- ZIP Slip paths and absolute paths; symlink entries; ZIP bombs or high ratio; excessive entries; corrupted ZIP; JSON payload exceeding limits.
- XSS strings in names, URI-like strings, poisoned image URLs and invalid external links.
- Test deletion of in-memory/opt-in persistent data. Inspect local import network calls.
- If backend/OAuth exists: cookie/session protections, CSRF, access control, token redaction, malicious request body limits and rate handling.

## UI tests
- Dark canvas readable; Chrome surfaces don't obscure nodes; legend accurately explains edge patterns.
- Keyboard-only navigate nodes and timeline; canvas and accessible list yield same selected details.
- Mobile/desktop layouts, missing art, absent genres, no recommendations, year with no plays, 1-node graphs, 50-node graph.
- Reduced motion disables idle floating; screen reader receives meaningful item summary.
- Zoom/pan and node hit-testing at different device-pixel ratios.
- Fixed zoom steps and a cue at audible volume. Blank-sky exit restores the exact chart framing from before focus. Stars and Images share placement, selection, and satellite interactions.
- Import a synthetic dataset offline, render hostile titles as text, traverse a UTC year gap, inspect playback totals by keyboard, and clear the import.
- Load a synthetic owner default, reject unexpected pack fields and unsafe URLs, inspect a suggested track, and restore the default after clearing a visitor import.
- Compare the top-45 Focus view with full Explore in annual and cumulative charts. Inspect catalog and approved fallback tracklists and navigate the paged index by keyboard.
- Verify that selected and related names keep their separate blue tones, unrelated marks behave like empty sky, and Stars restores overview browsing on exit.
- Check Hours radial ranking, separated Genre regions, blue hover annotation, and artist versus album suggestions. Exercise Spotify artwork response validation without live credentials.
- Exercise exact and ambiguous MusicBrainz matches, recognized genres and malformed vote counts, compatible artist fallback, inferred artist grouping, and distinct Multiple genres and Untagged groups.
- Exercise an artwork run above 60 lookups, checkpoint/resume after a rate limit, temporary misses, and cancellation or malformed responses with mocked requests.
- Verify the annual and cumulative artwork priority, artist credits, album art on track satellites, rank-based layering, hover opacity, and visitor lookup consent.
- Check that the same selected year survives switching timeline modes, exact track and album totals remain private, and album selection brings in credited releases beyond the Focus cutoff. Exercise paginated and malformed catalog credit responses and Explore and Focus suggestion counts.
- Check strict Explore artwork thresholds at exactly two and four hours and one millisecond over, regardless of year. Verify below-cutoff image requests are skipped in Explore and still run in Focus. Check ListenBrainz quota handling, hostile references in provider SVGs and same-origin artwork paths.
- Verify that ListenBrainz similarity survives Focus and Genre layout, suppresses suggestions for artists heard in a different year, and applies the exclusion to a visitor's own history. Validate malformed similarity payloads, spoofed seed IDs, and quota cooldown headers.

## Performance and reliability
- Test synthetic histories at 10k, 100k, and (if feasible) 500k events; profile memory, main-thread responsiveness and cancellation.
- Test repeated view switching and resizing for leaks and detached animation loops.
- Test offline operation of core app; optionally metadata errors/429/403 without breaking map.

## Release checklist
- [ ] Typecheck, lint, tests and production build succeed.
- [ ] No secrets/private fixtures in tracked files or built assets.
- [ ] Security and privacy review passed for the actual deployment architecture.
- [ ] API functionality verified; unavailable features gracefully disabled.
- [ ] Basic accessibility and responsive checks passed.
- [ ] Product labels distinguish factual, inferred and demo results.
