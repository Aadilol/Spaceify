# Data import and graph correctness

## ZIP parsing
- Accept only documented Extended Streaming History JSON structure; other entry types ignored or rejected with reasons.
- Enforce compressed-size, uncompressed-size, entry-count, nesting, total-record-count and JSON-depth/field-length limits.
- Reject traversal names, symlinks, absolute paths, encrypted entries and nested archives unless explicitly supported. Avoid writing extracted names to the filesystem.
- Validate timestamp ISO date and finite nonnegative `ms_played`, cap implausible values, parse nullable metadata and explain dropped records in a safe summary.
- Filter podcasts when episode fields indicate podcast content or music track fields are missing.
- Retain year buckets in UTC by default; optionally permit user-selected timezone with clear labeling. Test New Year's boundary.

## Identity
- Prefer stable Spotify identifiers where available, but an album cannot be identified from `spotify_track_uri` alone without metadata resolution.
- Initial fallback album key: normalized album-name + primary-artist name with case folding, Unicode normalization and whitespace cleanup.
- Do NOT indiscriminately merge deluxe/live/remaster/reissue variants via fuzzy matching: preserve an audit mapping, show ambiguous merges for review and allow manual overrides.
- Artist key: stable artist ID if resolved, otherwise normalized artist name with collision-handling strategy.

## Analytics
- Per event aggregate `ms_played` and play-event count, by year and lifetime; display event count honestly (a partial play is still an event).
- Nonlinear node size `clamp(a + b * sqrt(duration), min, max)` or logarithmic alternative with tests.
- Deterministic tie-breaking for ranking, selected-center and edge choice.
- Missing metadata MUST be represented as `unknown`, not guessed.

## Similarity MVP without unavailable Spotify endpoints
- Candidate signals: same artist, user-reviewed genre tags, repeated co-listening in time windows, user-provided labels and optional licensed external metadata.
- Normalize each signal; derive 1–2 nearest-neighbor links per item (and deduplicate edges). Handle singleton/disconnected graphs and zero-length history.
- An edge implies computed similarity, not causal influence. Show sources/strength where defensible.
- Optional audio features only if a licensed, approved, working source actually exists. Do not invent numerical energy/tempo/valence.

## Discovery ring
- Not feasible to infer unknown unheard albums solely from listening-history ZIP. Requires separate candidate catalog/provider, user input or demonstrably available API.
- Label candidates as `Suggested discovery`, with a `source` and `reason`. Demo suggestions use fake/synthetic data and prominent `DEMO` state.

## Schema
`Album { id, name, primaryArtist, artistNames[], totalMsPlayed, playEventCount, msPlayedByYear, playEventsByYear, optionalGenreTags, optionalArtworkUrl, optionalExternalLink, sourceInfo }`

Keep original raw archive out of logs and analytics. Avoid sending personal song lists to third-party services without meaningful disclosure and consent.

## Current extracted JSON pipeline

The reader accepts up to 64 audio JSON files of at most 16 MiB each, with a combined cap of 256 MiB and 500,000 rows. It accepts valid UTF-8 JSON arrays with at most eight levels of nesting. Video, podcast and audiobook records are excluded. Missing or invalid music metadata is reported in aggregate.

The importer counts valid music rows, including zero-duration events, and deduplicates by UTC timestamp, milliseconds played, normalized album and artist, and track URI where available. IDs remain stable across years within the archive. Normalization preserves deluxe and other distinct editions. Same-day links require at least two shared UTC dates with positive listening. Album focus links the selected primary artist to releases where they are the primary artist or have a verified track credit. A local draft refresh uses existing catalog album matches for these credits.

Private views keep every eligible artist, album, and track. Annual graphs rank entries by listening duration. Cumulative graphs sum annual time and play events, merge tracks by private track IDs, and preserve entries across year gaps. Focus displays up to six satellites. Details and the index make the full lists available in pages. The public pack includes all artist and album ranks, calculated before banding, and uses approved played-song titles where a verified catalog tracklist is unavailable.

The owner genre refresh reads the review pack. It searches MusicBrainz by the selected artist name or album title and credited artist. It validates identity matches, filters positive tag votes through MusicBrainz's genre vocabulary, and groups by the leading genre when there is a clear winner. In a visitor import, the browser can reuse exact matches from the owner catalog without sending visitor names or listening data.
