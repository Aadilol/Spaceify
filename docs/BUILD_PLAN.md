# Build plan — small verified steps

## Phase 0 — Starfield + synthetic graph
- [x] Scaffold React + strict TypeScript, UI/CSS tools only as needed.
- [x] Implement a viewport-sized star chart, legend, view controls, timeline, and keyboard index.
- [x] Add monochrome constellations, subtle drift, and fictional track satellites on zoom.
- [x] Render fake but explicitly labelled `DEMO` album/artist data; accessibility list and keyboard behavior.
- [x] Screenshot comparison and UI testing; no real user ZIP yet.

## Phase 1 — safe offline history import
- [x] Load bounded extracted audio JSON in the browser and support a private development default.
- [ ] Implement browser-side bounded ZIP reader and runtime event validation.
- [ ] Aggregate by year and entity; disclose UTC convention and counting definition.
- [ ] Test malformed/malicious archives and privacy network behavior.
- [ ] Provide clear/delete and import diagnostic summary.

## Phase 2 — real graph behaviors
- [ ] Deterministic similarity signals available locally, sparse edges, node ranks/sizing.
- [ ] Album/Artist mode, year slider, pan/zoom, drag, stable IDs and inspector.
- [ ] Genre mode only if tagged data available; no empty fabricated genres.
- [ ] Canvas performance / mobile / keyboard mirror and reduced-motion settings.

## Phase 3 — optional enrichment
- [x] Prepare an owner-default runtime pack and local review preview with MusicBrainz genres and credited art.
- [ ] Confirm current allowed Spotify APIs and provider terms BEFORE coding.
- [ ] Implement provider adapter and permissions/consent UI; support offline failure.
- [ ] Add metadata, cover art, attribution and Spotify links without image alteration.

## Phase 4 — discovery ring
- [x] Render bounded ListenBrainz artist and album suggestions with seed explanations and catalog links.
- [ ] Define a legal/available candidate source and explicit ranking/reasons.
- [ ] Label heuristic suggestions distinctly from official Spotify results.
- [ ] Cap count and test 'no recommendation' state.

## Phase 5 — release review
- [ ] Security, privacy, accessibility and performance audits with evidence.
- [ ] Verify production browser behavior and exported assets.
- [ ] If hosted, conduct threat model update and deployment-specific controls.


