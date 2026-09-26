# Negative Space — Extended Documentation

For architecture, engineering decisions, and known gotchas (the technical audit meant for whoever's touching the code), see [AUDIT.md](AUDIT.md). This file is the practical guide: every feature, and how to add a new neighborhood.

## Concept

Real buildings are extruded from Overture Maps footprint + height data. A bounding box the size of the whole site — footprint in X/Y, tallest building in Z — is built as one solid "mold." Every building is subtracted from that mold via CSG (Manifold). What's left is the negative space: the shape of the air around and above every building, bounded by the mold's own outer walls, floor, and roof.

Cut away a corner of that solid and you can see inside it — the voids between buildings read as a single continuous carved form, the way a lost-wax mold reads once the metal's poured and the wax is gone.

## Feature walkthrough

### Neighborhood

A dropdown, not a search box. Each entry is a real, pre-built site — its own `data/<id>/buildings.geojson`, `building_parts.geojson`, and `streets.json`, plus an independently-measured grid-tilt angle in the `NEIGHBORHOODS` config array in `index.html`. Switching neighborhoods tears down and rebuilds everything (buildings, negative space, cutaway state, streets, borough context) — nothing carries over between them.

### Buildings / Negative space

Two display layers, independent toggles — not either/or. Buildings shows the real extruded footprints as-is. Negative space shows the computed void (requires a compute to have run first). Both can be on together, useful for confirming the carve is accurate.

### Compute negative space

Runs the actual CSG subtraction. Takes under a second even for Chelsea's 1,226 buildings — Manifold guarantees a manifold (watertight, non-degenerate) boolean result, which is what makes this fast and correct; the project's early versions used a different CSG library that produced ~49% broken geometry and needed workarounds this version doesn't. A hint above the Neighborhood dropdown ("Pick a neighborhood below, then Compute negative space to get started") shows on every fresh page load and hides for the rest of that session once Compute succeeds — not persisted anywhere (v3.4.100, was permanently dismissed via `localStorage` the first time Compute was ever clicked, on any past session; meant a returning user opened the page to a fully rendered site with no explanation of the button left at all).

### Drawing a section (box-draw workflow, v3.4.0+)

The primary way to see inside the mold, and the Simple tab's default path. Click **Draw section box**, which switches to Plan view; drag a rectangle around the area you want to see in section; pick N/S/E/W (either the box panel's own picker or the top View compass — they call the same code, `applyPlanBoxDirection()`/`goToDirection()`) to cut through just that box, centered on it. **Full width** (appears once a box is active) clears it and reverts to the whole site's elevation. Recenter cutaway (Advanced tab, renamed from "Reset cutaway" in v3.4.103 to read less like a synonym for Full width) re-centers on the active box's own center rather than an arbitrary site-wide default, if one is active.

Internally this sets the same `xThreshold`/`yThreshold` state the Advanced sliders drive — drawing a box and dragging a slider are two ways to reach the same underlying section, not two separate systems.

### Cutaway sliders (Height / X / Y) — Advanced tab

Each slider moves a clipping plane along one axis. With no box active, this carves away one octant of the mold at a time — like pulling one corner off a cube. With a box active, the slab centers on the box instead. Flip X / Flip Y mirror which side gets carved, without moving the cut position itself.

### Simple / Advanced tabs

Simple (default) is Draw section box plus whatever it surfaces (the "Cropped to..." caption, Full width). Advanced reveals the original slider-driven precision controls (Height/X/Y Cutaway, Flip X/Y, Recenter cutaway, Show cutaway handles) for dialing an exact meter value or nudging with arrow keys — useful with or without a box drawn. Switching tabs doesn't change any actual state; the sliders keep whatever value they're at, visible or not. Turning Negative space on auto-switches to Advanced and opens the Display accordion below it too (v3.4.97) — a flat, uncut void shell doesn't show much by itself; cutting through it and seeing where it sits in context are the actual point, and both used to sit one extra click past turning the void on at all. Fires once, at the moment Negative space actually turns on (`viewNegative`'s click handler), not from any function that runs on unrelated state changes — so it never fights a later manual tab-switch or a manually-collapsed Display while Negative space stays on.

### Section fill (poché)

Shades the newly-exposed cut faces translucent — the real convention from architectural section drawings, where the poché (the solid material a cutting plane passes through) is filled in to distinguish "material the cut passed through" from "material behind the cut." Negative space's own fill (red) marks the boundary of the void itself. Buildings has its own fill too (v3.4.82) — a dark charcoal, deliberately a different color so the two stay distinguishable when both layers are shown together — without it, a cut building reads as a hollow open shell rather than solid cut material.

**Fill vs. outline (v3.4.99).** Negative space's own Height Cut face is unconditionally the full site rectangle whenever it's shown at all (its clip planes dropped the other two axes in v3.4.88), so a shallow cut anywhere near the ground fills the entire visible site — a solid wash rather than useful shading. `capQuadBounds()` computes each cap's real exposed rectangle directly from existing state (every one of a cap's clip planes is a single axis-aligned half-plane, so the shape is always a plain rectangle, no polygon math needed) and switches from a filled quad to a thin outline once the exposed area covers more than half the site (`POCHE_OUTLINE_COVERAGE_THRESHOLD`). Live as the sliders move (`refreshCapFillCoverage()`, called from `syncCapFillPlanes()`), not just at compute time. Buildings' own poché doesn't have this problem — see below.

Both layers' fill always shows in a locked N/S/E/W section (camera locked face-on to the cut plane, v3.2.34). Height Cut's own fill has always also shown in free Perspective/Plan. X/Y cutaway's fill originally didn't — v3.2.40 found that a full-site flat plane, viewed at a grazing/near-edge-on angle in free orbit, visually smears into what looks like a solid wall (real WebGL rendering artifact affecting negative space's own X/Y poché specifically, which still uses the stencil technique described just below — not a stencil bug itself: scattered stencil-passing pixels project onto adjacent screen pixels from a sufficiently oblique angle). Rather than hide it in Perspective entirely, v3.4.85 re-evaluates the camera's actual angle to each cut plane on every orbit (`capQuadFaceOnEnough()`, hooked to the same `controls` 'change' event the nav compass and street-label sizing already use) and only hides that plane's fill once the angle crosses a conservative grazing threshold — so most ordinary viewing angles keep the fill, and only the genuinely bad ones lose it, live, as you orbit toward them. Orthographic Plan view is excluded outright: a vertical X/Y cut plane is always edge-on from directly above, not just sometimes. Buildings' own X/Y/Z caps are built from real per-building footprint geometry instead (v3.4.93, see below) and don't share this grazing-angle artifact at the rendering level, but still respect the same `capQuadFaceOnEnough()` visibility gate for consistency between the two layers.

**Buildings' caps are real geometry, not a stencil test (v3.4.93).** Originally all three axes, for both layers, used a shared-geometry stencil-buffer technique (write the merged mesh into the stencil buffer, then draw a clip-restricted quad wherever the stencil test passes). That technique turned out to fail unpredictably for buildings specifically — 100% reproducible on Y across a whole district's real range, with no confirmed root cause after two separate live-diagnosis sessions (ruled out cross-axis `clearStencil()` interference, scene interference, a plane-sync bug). Buildings' X/Y/Z caps were rebuilt on `sliceFootprintAtLine()` (even-odd scanline edge-crossing against each building's real footprint polygon) + `buildBuildingXYCapGeometry()`/`buildBuildingZCapGeometry()` — the real cross-section computed directly, no stencil buffer involved. Negative space's own poché (all 3 axes) still uses the original stencil technique; it was never observed to have the same failure.

### 3D drag handles

Small cone handles sit at the corner where the three cutaway planes meet — drag them directly in the viewport instead of using the sliders. Always positioned on the real exposed edge, wherever that currently is. Rendered with an unlit material (v3.4.98, was a lit `MeshStandardMaterial`) so each handle shows its pure, saturated axis color regardless of the angle it happens to catch the scene's lights at — a lit handle could read faint/washed-out against the negative space shell or poché behind it even at full opacity, since its actual brightness varied with lighting rather than being genuinely transparent.

### High detail (slower)

Bumps supersampling to reduce fine-geometry aliasing (visible as faint mottling on distant cavity walls, from real building geometry finer than screen resolution) — a genuine frame-time cost, so it's opt-in. Lives in the Export accordion, not a general viewing setting — the one real use case is a crisp image (a screenshot, a portfolio shot), an export concern.

### Units (Metric / Imperial)

Switches every displayed length (Advanced-tab slider labels, drag-handle readouts). The underlying geometry always stays in meters. Only meaningful inside Advanced — nothing in Simple reads it, so it lives at the top of Advanced's own content rather than always-visible.

### Manhattan context

Zooms out to a real extruded Manhattan solid (from NYC Open Data borough boundaries) with the current neighborhood's real buildings visible in their true position on the island. Always switches to the free-orbit perspective camera and resets the View compass's current-view indicator, regardless of what was active before — a locked N/S/E/W/Plan elevation's rotate lock and stale label don't carry over (v3.4.69/70). A box-scoped elevation's cutaway state, on the other hand, deliberately does carry over — Manhattan context doesn't reset the actual clipping planes, just the camera and its indicator. Real major streets show through this view too, if that toggle is also on.

### Major streets

Real NYC Street Centerline data (every real named street, no width filter as of v3.4.75) for the current neighborhood, extruded to a thin schematic curb height so it reads from any camera angle, not just top-down. Each unique street name gets one label, placed along its longest real run in the current view — not one per block, to keep it legible. Because the dataset's own name field isn't purely streets (park drives, bike paths, bridge/tunnel access ramps carry real names too), a few non-street labels can show up alongside real streets — a known tradeoff of "every named street" over a width cutoff, not yet revisited.

### Navigation (top of the left panel)

- **N / S / E / W** — true flat orthographic elevations. No perspective foreshortening: a building's apparent height on screen is independent of camera distance, the way a real elevation drawing works. The camera always frames the whole current model (site or borough, whichever is active) — or, entering Plan to draw a box from an already-zoomed-in perspective view, roughly that same framing (v3.4.64).
- **P (Plan)** — true straight-down orthographic plan view, north-up. Also where a section box is drawn.
- **⌂ (Home)** — returns to the default 3/4 perspective view, free orbit. Also clears any box drawn via Draw section box (v3.4.94) — a box left active while looking free-orbit is a dead end no view actually shows (poché and drag handles both correctly, if confusingly, refuse to appear for it), not a state worth returning to.
- **Compass** — needle always points at real true north, corrected for the local street grid's own tilt (Manhattan's avenues run about 29° off true north — each neighborhood's exact tilt is measured independently from its own building data, not assumed).

### Export

Exports whichever layer is currently showing — Buildings massing, or the computed Negative space solid — as a binary STL file. Set "Model scale 1:N" first (default 1:500, the standard architectural-model convention) to control the physical size of the output; the app's geometry is real-world meters, converted to millimeters at that scale. Negative space must be computed first before it can be exported. Sits at the bottom of the left panel (v3.4.101, was right after Display) — a nice feature, but not the main idea behind the project, so it doesn't compete for attention with the actual cutting/viewing controls above it.

### Theme

Light / Blueprint (dark) toggle, top right. Defaults to Blueprint on a first visit; remembers an explicit choice either way via `localStorage`.

## Adding a new district

Not a live search-any-area system by design — every district is fetched, checked, and added by hand, one at a time. As of District 1, this means real NYC administrative boundaries, not hand-picked bounding boxes (the original three neighborhoods — Hudson Yards, Chelsea, Hell's Kitchen — used hand-picked bboxes and were superseded by District 4 once its real boundary turned out to cover all three as one continuous area; see CHANGELOG v3.2.7):

1. **Get the district's real boundary polygon** from NYC Open Data's Community Districts dataset (`data.cityofnewyork.us/resource/5crt-au7u.geojson?boro_cd=<code>`), not a hand-drawn box — take the largest ring by area if the result is a MultiPolygon (drops small offshore fragments like Governors/Ellis/Liberty Island where irrelevant).
2. **Fetch real Overture building + building_part data** for the polygon's bbox — decoding Overture's PMTiles vector tiles directly in-browser (see AUDIT.md's "Winding order" section for a real gotcha specific to this path: rings can come out clockwise, which a naive CSG library will silently treat as zero-area).
3. **Check ring winding** on every polygon; fix any clockwise ring before using the data.
4. **Dedupe tile-boundary duplicates** (largest-fragment-wins per id) and **filter outbuilding/roof** clutter, same as always.
5. **Clip to the real polygon** by building centroid, not just the fetch bbox — otherwise neighboring districts' buildings bleed across the boundary.
6. **Measure the real grid tilt** from the district's own building wall bearings (weighted circular mean, favoring longer walls) — never copy another district's value. Also worth computing R (circular-statistics concentration, `|resultant vector| / total weight`) alongside the angle: R close to 1 means a genuinely coherent single grid (District 4: 0.967); R well below that (District 2: 0.429) means the district doesn't really have one dominant grid direction, and the measured angle is a compromise, not a clean fact — worth flagging before shipping, not just measuring and moving on.
7. **Filter major streets** to the same real polygon, from NYC's Street Centerline dataset (`inkn-q76z`) — every real named street (`full_street_name` not null) as of v3.4.75, no width cutoff.
8. **Drop the three files** in `data/<new-id>/`: `buildings.geojson`, `building_parts.geojson`, `streets.json`.
9. **Add one entry** to the `NEIGHBORHOODS` array in `index.html`: `{ id, name, gridRotationDeg }`.

That's it — the sidebar dropdown, data loading, and camera framing are all generated from that config array.

## Troubleshooting

**Blank viewport, no error.** Check the browser console directly — a JS error anywhere in top-level script code (not inside a function) will silently abort the rest of boot. This has happened before (v3.0.14) from code that referenced `scene`/`renderer` before `initScene()` had run.

**"Fetch failed" toast on load or neighborhood switch.** The app must be served over http(s); `file://` doesn't work as of v3.1.0 (data is fetched live, not embedded). Confirm `data/<id>/buildings.geojson` etc. actually exist next to `index.html`.

**Hatching / mottling on cavity walls.** Expected at default resolution — real fine building geometry aliasing at distance, not a bug. Turn on "High detail" for a real (costlier) reduction.

**A thin triangular "wedge" building that doesn't correspond to anything real.** Confirmed real bug (v3.1.6), not user error — some Overture footprints are tagged `subtype: 'outbuilding'`, `class: 'roof'` (canopies, shed roofs, similar non-primary structures), and their real-world shapes can be long and thin, which extrudes into an obvious wedge when treated like a normal building. Fixed by excluding those at the data-fetch stage for all three current neighborhoods; if a future neighborhood shows the same thing, it likely wasn't filtered at fetch time — check for that tag combination in its `buildings.geojson`.

**Poché not showing on one axis.** For buildings' own caps (X/Y/Z), this shouldn't recur — v3.4.93 rebuilt all three from real per-building footprint geometry specifically because the old stencil technique failed unpredictably here with no confirmed root cause; there's no stencil buffer left to fail. For negative space's own poché, which still uses the original stencil technique, this exact symptom has had several different real root causes across this project's history (render-list ordering, stencil-buffer clear timing, epsilon bias direction) — check AUDIT.md's poché section first if it turns up there.
