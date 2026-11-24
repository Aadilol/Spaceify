# Product specification and acceptance criteria

## Users and outcome
Single user imports their Spotify Extended Streaming History ZIP and discovers how their listening tastes changed over calendar years through an interactive node-link map. Upload is user-initiated and import works without a Spotify account connection.

The current version accepts extracted audio JSON files. An approved owner chart can be served as the public default. Visitors can replace it with an in-memory browser import, and clearing their import restores the default. The owner's public chart includes all eligible entries, listening bands, catalog artwork and genres where matched, and suggestions for the active Artist or Album view.

## Core UI
- Starfield is a monochrome artist atlas. Sparse clusters of listened stars are connected by fine lines, with hollow demo discoveries on dotted links.
- The canvas fills the viewport with a legend and bottom timeline spanning the **available data years**. Click a star to zoom into its constellation and show track satellites. Click empty sky to restore the previous overview framing. The optional index holds the searchable star list and details. View, layout, the Stars/Images switch, and volume sit in the top toolbar.
- **Hours** puts the most-listened entry in the center and spreads lower ranks irregularly toward the edge. **Genre** assigns groups separate regions when useful genre metadata is available.
- **Focus** starts with the 45 most-listened entries in the current artist or album period and their available suggestions. **Explore** includes the full period, including in Through year.
- Zoom, pan, drag, select, details, filtering, and an accessible index for every artist and album in Explore. During a star selection, the index and chart both follow the selected star's direct links.
- Star size reflects play-event count using a clamped nonlinear scale. Node identities remain stable across year changes.

## What counts as success (MVP)
1. Import a valid synthetic Extended Streaming History ZIP without an API call.
2. Ignore podcast/episode records; validate all required fields and tolerate nullable metadata where possible.
3. Show all imported artists and albums for the active period and rank by summed `ms_played`. Let visitors switch between annual and cumulative totals.
4. Show listening duration and play-event count for a selected album.
5. Recompute graph and year slider as calendar year changes.
6. Graph remains usable on a moderate laptop and offers an accessible list for keyboard users.
7. No unapproved persistence or transmission of imported history.

## Follow-on features
- Artist toggle and audited album consolidation behavior.
- Optional metadata enrichment and genre layout via a supported source.
- Discovery ring only with a documented candidate source and honest label/explanation.
- Motion polish, export of privacy-safe visual snapshots, responsive panel variations.

## Definitions requiring explicit UI labels
- `playCount`: number of qualifying streaming events (NOT verified full listens); optionally add separate qualifying-play threshold.
- `totalMsPlayed`: actual milliseconds played in imported history.
- 'Never played': absent from the **imported history**, not proof the person never listened elsewhere.
- 'Recommended': only when grounded in a legitimate suggestion algorithm/source; otherwise label 'Suggested discovery' or 'Demo'.
