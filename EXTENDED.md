# Negative Space — Extended Documentation

For architecture, engineering decisions, and known gotchas (the technical audit meant for whoever's touching the code), see [AUDIT.md](AUDIT.md). This file is the practical guide: every feature, and how to add a new neighborhood.

## Concept

Real buildings are extruded from Overture Maps footprint + height data. A bounding box the size of the whole site — footprint in X/Y, tallest building in Z — is built as one solid "mold." Every building is subtracted from that mold via CSG (Manifold). What's left is the negative space: the shape of the air around and above every building, bounded by the mold's own outer walls, floor, and roof.

Cut away a corner of that solid and you can see inside it — the voids between buildings read as a single continuous carved form, the way a lost-wax mold reads once the metal's poured and the wax is gone.

## Feature walkthrough

### Neighborhood

A dropdown, not a search box. Each entry is a real, pre-built site — its own `data/<id>/buildings.geojson`, `building_parts.geojson`, and `streets.json`, plus an independently-measured grid-tilt angle in the `NEIGHBORHOODS` config array in `index.html`. Switching neighborhoods tears down and rebuilds everything (buildings, negative space, cutaway state, streets, borough context) — nothing carries over between them.

### Buildings / Negative space

Two display layers. Buildings shows the real extruded footprints as-is. Negative space shows the computed void (requires a compute to have run first).

### Compute negative space

Runs the actual CSG subtraction. Takes under a second even for Chelsea's 1,226 buildings — Manifold guarantees a manifold (watertight, non-degenerate) boolean result, which is what makes this fast and correct; the project's early versions used a different CSG library that produced ~49% broken geometry and needed workarounds this version doesn't.

### Cutaway sliders (Height / X / Y)

Each slider moves a clipping plane along one axis, carving away one octant of the mold at a time — like pulling one corner off a cube. Flip X / Flip Y mirror which side gets carved, without moving the cut position itself.

### Section fill (poché)

Shades the newly-exposed cut faces translucent red — the real convention from architectural section drawings, where the poché (the solid material a cutting plane passes through) is filled in to distinguish "material the cut passed through" from "material behind the cut." Here it marks the boundary of the void itself.

### 3D drag handles

Small cone handles sit at the corner where the three cutaway planes meet — drag them directly in the viewport instead of using the sliders. Always positioned on the real exposed edge, wherever that currently is.

### High detail (slower)

Bumps supersampling to reduce fine-geometry aliasing (visible as faint mottling on distant cavity walls, from real building geometry finer than screen resolution) — a genuine frame-time cost, so it's opt-in.

### Units (Metric / Imperial)

Switches every displayed length (slider labels, drag-handle readouts). The underlying geometry always stays in meters.

### Manhattan context

Zooms out to a real extruded Manhattan solid (from NYC Open Data borough boundaries) with the current neighborhood's real buildings visible in their true position on the island. Real major streets show through this view too, if that toggle is also on.

### Major streets

Real NYC Street Centerline data (avenue-width and up, ≥60ft) for the current neighborhood, extruded to a thin schematic curb height so it reads from any camera angle, not just top-down.

### Navigation (bottom-right panel)

- **N / S / E / W** — true flat orthographic elevations. No perspective foreshortening: a building's apparent height on screen is independent of camera distance, the way a real elevation drawing works. The camera always frames the whole current model (site or borough, whichever is active).
- **P (Plan)** — true straight-down orthographic plan view, north-up.
- **⌂ (Home)** — returns to the default 3/4 perspective view.
- **Compass** — needle always points at real true north, corrected for the local street grid's own tilt (Manhattan's avenues run about 29° off true north — each neighborhood's exact tilt is measured independently from its own building data, not assumed).

### Theme

Light / Blueprint (dark) toggle, top right. Defaults to Blueprint on a first visit; remembers an explicit choice either way via `localStorage`.

## Adding a new neighborhood

Not a live search-any-area system by design — every neighborhood is fetched, checked, and added by hand, one at a time:

1. **Pick a bounding box.** A few blocks is plenty (Hudson Yards is ~300 buildings, Hell's Kitchen's core is ~440).
2. **Fetch real Overture building + building_part data** for that bbox — either via the `overturemaps` CLI/DuckDB, or by decoding Overture's PMTiles vector tiles directly (see AUDIT.md's "Winding order" section for a real gotcha specific to the PMTiles path: rings can come out clockwise, which a naive CSG library will silently treat as zero-area).
3. **Check ring winding** on every polygon; fix any clockwise ring before using the data.
4. **Measure the real grid tilt** from the neighborhood's own building wall bearings (weighted circular mean, favoring longer walls) — never copy another neighborhood's value, even a nearby one; they're genuinely different by tenths of a degree.
5. **Filter major streets** (≥60ft width) to the same bbox, from NYC's Street Centerline dataset.
6. **Drop the three files** in `data/<new-id>/`: `buildings.geojson`, `building_parts.geojson`, `streets.json`.
7. **Add one entry** to the `NEIGHBORHOODS` array in `index.html`: `{ id, name, gridRotationDeg }`.

That's it — the sidebar dropdown, data loading, and camera framing are all generated from that config array.

## Troubleshooting

**Blank viewport, no error.** Check the browser console directly — a JS error anywhere in top-level script code (not inside a function) will silently abort the rest of boot. This has happened before (v3.0.14) from code that referenced `scene`/`renderer` before `initScene()` had run.

**"Fetch failed" toast on load or neighborhood switch.** The app must be served over http(s); `file://` doesn't work as of v3.1.0 (data is fetched live, not embedded). Confirm `data/<id>/buildings.geojson` etc. actually exist next to `index.html`.

**Hatching / mottling on cavity walls.** Expected at default resolution — real fine building geometry aliasing at distance, not a bug. Turn on "High detail" for a real (costlier) reduction.

**A thin triangular "wedge" building that doesn't correspond to anything real.** Confirmed real bug (v3.1.6), not user error — some Overture footprints are tagged `subtype: 'outbuilding'`, `class: 'roof'` (canopies, shed roofs, similar non-primary structures), and their real-world shapes can be long and thin, which extrudes into an obvious wedge when treated like a normal building. Fixed by excluding those at the data-fetch stage for all three current neighborhoods; if a future neighborhood shows the same thing, it likely wasn't filtered at fetch time — check for that tag combination in its `buildings.geojson`.

**Poché not showing on one axis.** If this recurs, it's worth checking AUDIT.md's poché section first — this exact symptom has had several different real root causes across this project's history (render-list ordering, stencil-buffer clear timing, epsilon bias direction), not a single recurring bug.
