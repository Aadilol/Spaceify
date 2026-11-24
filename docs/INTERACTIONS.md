# Interaction contract

## Map
- Charts open in Album, Hours, and Explore, with images enabled for the latest UTC year in Year mode. Star switches to star view. Image switches back.
- Stars drift around their base positions.
- The owner default opens at its latest UTC year. Genre layout uses clear primary tags from MusicBrainz. An album without a clear primary tag can use a clear tag for its matching artist, with that source shown in Details. Images displays credited catalog art with intact proportions. Details identifies a missing or failed image when Images is enabled.
- Fine lines represent locally scored similarity among listened nodes. Widely dotted lines connect explicitly labeled demo discoveries.
- The owner maps show eight ListenBrainz suggestions in Explore and four in Focus when sufficient candidates are available. They suggest artists in Artist view and albums in Album view. Suggestions seeded by active listening show dotted links. Archive-wide suggestions can fill open slots and identify their seed in Details.
- In Artist view, cached ListenBrainz Similar Artists results link artists present in the active period. Artists already present anywhere in the loaded archive are excluded from suggestions. Selecting an artist prioritizes its own unheard matches. Visitor imports can reuse cached results for matching artists and apply the same lifetime check to their own archive.
- Pointer hover draws a leader with the name in blue and a listening summary. Click a star to zoom into its constellation and reveal its track satellites. Click empty sky or press Escape to restore the overview’s previous pan and zoom. Dragging the sky pans the current view.
- While a star is selected, its name stays blue. Directly linked stars and suggestions have lighter blue names. Dense charts prioritize the strongest listening links. The selected star, the highlighted links' endpoints, and track satellites respond to the pointer. Other marks behave like empty sky.
- Selecting an album adds every release in the active period by that album's primary artist, including releases with a verified track credit for that artist. In Focus, those releases can appear beyond the top 45 and are available in the Index.
- Open the collapsed Index to navigate the Stars list with arrow keys. Enter selects the star and opens Details. The list is limited to the selected star and its visible neighborhood during selection. Back to chart overview in Stars returns to the full list for the current mode. Escape closes the index and returns focus to its toggle.
- Explore keeps all listening entries as marks at overview zoom and applies idle drift at every rank, with a lower redraw rate for large charts. Reduced motion keeps all entries still. Detail zoom reveals secondary links. The small demo can also vary which stars are visible by zoom.
- Dragging a node temporarily pins it. Focus the chart and press 0 to reset the view and pins. Scroll, pinch, or press Plus or Minus on the focused chart to zoom in fixed steps. Each step sounds a mechanical click when volume is above zero. Pan and zoom do not scrub the year slider.
- Node type, selected state and ranking must be visible without relying only on color.
- Physics coordinates are distinct from rendered idle offsets; offsets must not corrupt hit testing or link anchors.

## Timeline
- Slider limits computed from actual imported years; empty years are allowed and display an intentional empty state.
- Year shows activity within the selected UTC calendar year. Through year totals the beginning of the archive through that year, including entries from prior years. Both modes retain the same selected year. The public range combines only published entry bands.
- Year change recalculates listened duration, ranking, and similarity. Stable IDs carry entries across years, and an item outside the active period clears the selection.
- `playCount` and `totalMsPlayed` must correspond to the currently labelled year/lifetime view.
- Scrubbing briefly shows up to three earlier positions from the selected view and layout. Reduced motion presents the path as a still chart. A rediscovery uses at least 120 play events in the year after two or more complete quiet years with earlier listening. It enters along a comet path and retains a stippled tail.
- In real charts, twinkle compares the last play for the selected year with the latest timestamp in the export. The demo uses its fixed synthetic archive date. The annual event count still determines star size.

## Album/Artist and Genre modes
- The top rockers switch between Artist and Album or Hours and Genre. Hours uses listening rank as radial distance and varies the angle of each successive point.
- The Explore and Focus rocker switches between the full archive and the top 45 listened entries for the current period with their available suggestions. Changing density exits star selection and preserves the active timeline period.
- Toggle recomputes node identity and aggregates; restore pan/zoom to a sensible state when graph changes.
- The Images switch keeps the same positions and camera. Explore loads artwork only for albums with over two hours of listening or artists with over four hours, based on the entire archive across all years. Other entries and eligible entries without available artwork remain stars. Focus artwork priority is independent of duration. Explore stacks overlapping images by listening rank. Hover fades other images to 20% opacity. Selection draws the selected neighborhood in front and returns unrelated images to twinkling stars. Reduced motion makes the fade immediate and keeps those stars still.
- Album track satellites reuse the selected album cover when it is available. The image layer preserves the cover's proportions.
- In a visitor import, image view starts with already known matches. Switching to Star and back to Image offers the lookup choice. After explicit consent, Focus looks up missing covers or portraits for the active view, putting that year's annual entries before its Through Year entries. Explore looks up missing artwork for the selected node only if it exceeds the lifetime threshold.
- Genre mode places each genre in a separate region and keeps dragged nodes inside their region. Tied tags appear under Multiple genres. Entries without catalog evidence appear under Untagged. Genre becomes available when there are at least two groups, including a known genre and an Untagged group.
- Direct MusicBrainz release tags take priority. An album can inherit its artist's genre when its own tags are missing or compatible. An artist without a clear genre can use the uniquely dominant genre of at least two tagged releases, with the inference identified in Details.

## Details panel
- Album/artist name, listening duration, event count, available genre, cover art if licensed/sourced, release year if known.
- The private map shows played tracks and exact album and track duration from the export, including fractional seconds when present. The public map shows listening-time ranges and a verified catalog tracklist or, with the owner's approval, shared song titles across the archive. Album focus exposes up to six satellites and an All tracks action.
- If showing Spotify metadata, link to corresponding Spotify content with proper branding and keep artwork unmodified.
- Discovery detail explains provenance and reason ('same artist', 'tag overlap', etc); never fabricate a numerical audio-feature claim.
- A demo discovery shows its fictional tag match on selection. A separately marked Spotify pick provides the direct album link and lets the user explicitly load an official Spotify player from Details.

## Volume

- The local volume knob starts at 0% and moves in 25% steps. Drag up or right to increase, or down or left to decrease. Clicking either half moves one step. Arrow keys step, and Home and End jump to 0% and 100%.
- Audible detents produce a low mechanical click. Returning to 0% stops local playback. An explicit audition from mute begins at 25%. Spotify's player has its own controls.

## Low-level quality
- Use device-pixel-ratio-aware canvas rendering, resize observer and animation-frame scheduling.
- Stop work on unmount and remove event handlers.
- Build an accessible HTML mirror of the map's meaningful content.
