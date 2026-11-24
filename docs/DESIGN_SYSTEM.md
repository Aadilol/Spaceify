# Design system — Starfield

The graph is an unbounded night sky. Related listening forms small, asymmetric constellations with ample room between them. Instrumentation sits along the viewport edges.

## Palette and type

- Use near-black `#0a0a0a` and off-white `#f0f0f0`. Draw density with one-bit stipple. Use no CSS gradients, blur, drop shadows, or translucent fills.
- Use Consolas or the system monospace. Use uppercase for chart annotations and instrument labels.
- Use square corners and one-pixel rules. The star index opens as an optional panel. Star clicks operate directly on the chart.
- The view, layout, and density rockers share the same two-position faces. The volume knob has five marked detents, a knurled Bayer-textured face, solid offsets that collapse on a turn, and an attached percentage readout.
- Use a red double-circle cursor across the page, a standard hand on toolbar controls and the year slider, and a green double-square cursor over nodes and satellites.

## Chart marks

- Listened artists and albums are stars. Their nonlinear size reflects play-event count in private and demo charts, and listening-time bands on the owner chart.
- Image view displays loaded catalog artwork at the same positions. Nodes without artwork stay as stars in Explore and Focus. Selected album satellites use the album image when available and remain points otherwise.
- During image hover, the artwork layer dims non-hovered tiles to 20% opacity. During selection, the selected neighborhood stays in front of a field of subtle star marks.
- Related entries have fine point-sampled links. Demo discoveries use hollow marks and dotted links. Decorative distant stars carry no listening data.
- Offset labels from the point and connect them by a thin leader. Hover shows the node name in blue and its listening summary in off-white. A selected star keeps its blue label, and linked stars use a less saturated blue.
- Apply the shared ordered Bayer threshold to the density marks. Spotify-sourced cover art must remain unmodified.

## Accessibility and responsive behavior

- Keep the native year slider, visible keyboard focus, and a synchronized keyboard star index with track lists. A focused chart accepts Plus, Minus, and 0 for zoom and reset.
- Idle drift and twinkle stay active throughout normal viewing. Drift stays below 3 CSS pixels. `prefers-reduced-motion` disables drift, twinkle, and the volume knob kick. Camera zoom snaps between fixed stops.
- The canvas fills the viewport. On small screens, the index opens above the timeline as a bottom sheet. Hover annotations supplement the tap-to-zoom interaction and keyboard index.
