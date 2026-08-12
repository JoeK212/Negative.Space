# Negative Space — Project Audit & Handoff

**Current version:** v3.0.8
**Site:** Hudson Yards, NYC
**Single file:** `index.html` (~630 KB, ~1,700 lines — data, styles, and script are all inline)
**Author:** Joe K. · axisbim.io
**Served via:** `http://localhost:8888/` (a local server Joe runs — no longer opened directly via `file://`; see §3)

---

## 1. What this is

A browser-based tool that computes the **architectural negative space** of a real city block: take the actual building volumes at Hudson Yards, build a solid site mass up to the height of the tallest tower, and boolean-subtract every building from it. What remains is a literal "mold" — solid everywhere except where a building stood, exactly as if you'd poured concrete over the site up to the tallest roofline and pulled every building back out.

The user can toggle between the source buildings and the negative-space solid, and use three sliders (height / X / Y) to cut away a "dollhouse corner" of the solid and see inside it. A red line traces the real edges of the solid wherever the current cut crosses them, and a dark "poché" fill (architectural section-cut convention) shows solid material actually sliced through by the cut, not just an empty cavity hanging in space.

## 2. Data & pipeline (current, v3.0.0+)

- **Source data:** Overture Maps `buildings` and `building_parts` layers for the Hudson Yards site, embedded directly in `index.html` as `<script type="application/json">` blocks (497 building solids total: 254 built from multi-part `building_parts` decompositions, 243 as flat single-footprint fallbacks). Embedded rather than fetched because Chrome blocks `fetch()` of local files from a page opened via `file://`, even for same-folder assets.
- **Geometry:** each footprint is built TWICE per part — once as a `THREE.ExtrudeGeometry` mesh (feeds the "Buildings" display layer only) and once as a Manifold solid via `Manifold.extrude()` (feeds the CSG compute). Coordinate system is **Z-up** (X/Y horizontal, Z = elevation), matching Revit and the rest of Joe's AEC toolchain.
- **CSG engine: Manifold** (`manifold-3d`, a WASM library, loaded from unpkg via the page's importmap). This replaced `three-bvh-csg` at v3.0.0 — see §4 for why. Manifold's entire design goal is *guaranteed*-manifold (watertight) boolean output; there is no cleanup pass afterward because none is needed.
- **Compute algorithm:** union all 497 building solids into one Manifold (`Manifold.union`), build the site's bounding box as a Manifold cube, and do ONE `Manifold.difference(siteBox, mergedBuildings)`. No grid-chunking, no per-cell subtraction, no cell-seam merging — all of that existed only to work around `three-bvh-csg`'s performance pathology and is gone. **Full 497-building compute: ~0.2–0.8 seconds**, down from ~240s.
- **Section-cut highlight:** `THREE.EdgesGeometry` (hard-edge/silhouette extraction, built once from the final mesh) drawn as `LineSegments`, clipped to a thin band around each active cutaway plane, restricted to the *negated* clip planes of the other two axes so it traces only the real removed-corner boundary (see §4, v3.0.5/v3.0.6).
- **Poché cap fill:** a stencil-buffer capping technique (three.js's own `webgl_clipping_stencil` pattern, adapted for this app's intersection-mode octant cutaway) — draws a solid dark quad only where the stencil buffer confirms real solid material was sliced through.

## 3. How to run it

**Must be served over `http://`, not opened via `file://`.** Joe runs a local server (`http://localhost:8888/`); any static file server pointed at this folder works (`python3 -m http.server 8888`, etc.). This changed at v3.0.0 when the CSG engine moved to Manifold — while Manifold's own wasm load works fine under `file://` (it resolves relative to its own unpkg URL, not the local page), `file://` was already a source of friction all project long (blocked `fetch()`, blocked Web Workers), and localhost removes that whole class of problem going forward, including if `.glb` loading is ever needed for the Manhattan-scale work (see §6).

No build step. No npm install. Just serve the folder and open `index.html`.

## 4. Version history — the real story

The full changelog is in `CHANGELOG.md` (same folder). The important throughline, condensed:

### v1.0.0 – v1.6.0: first working version
Built the extrude → CSG-subtract pipeline, fixed `file://` loading, added a section-height slider, fixed CSG float-drift artifacts, fixed the "voids look like solid buildings" ambiguity (front/back materials), added the quadrant "dollhouse corner" cutaway, added a reset button.

### v2.2.0 – v2.6.0: mold-height fix, Z-up, the freeze, the hatching (three-bvh-csg era)
- **Mold-height bug fixed:** cap height was tallest-building+20m padding, so the tallest tower never reached the top face and the subtraction never visibly punched through. Fixed to exactly the tallest building's height.
- **Z-up conversion**, verified via Node harness.
- **The freeze, diagnosed properly:** `three-bvh-csg`'s `SUBTRACTION` got progressively, catastrophically slower as the accumulator geometry got messier from prior sequential cuts — about *accumulated chain complexity*, not building count (one ordinary building measured 143s as the 19th cut in a chain vs 0.04s alone). Fixed at the time with a 90m grid-chunking scheme so no single subtraction chain got long enough to hit the pathology.
- **Hatching, round 1:** the grid-chunking fix introduced duplicate coincident cell-seam geometry, z-fighting wherever a cutaway exposed the interior. Fixed with proper CSG-`ADDITION` merging of the 130 cells plus a near-duplicate-triangle-pair cleanup pass.
- Added section-cut lines (v2.5.0) and a stencil-based poché dark cut-fill (v2.7.0).

**All of the grid-chunking, cell-seam-merging, and triangle-cleanup machinery from this era is gone as of v3.0.0** — it was working around a broken CSG library, not a real architectural requirement. See below.

### v2.8.0 → v3.0.0: the real root cause, and the CSG engine swap
Joe found a new gap artifact ("two competing masses") in the poché fill on top of leftover hatching. Traced via a Node harness to the actual root cause: **`three-bvh-csg`'s boolean output was ~49% non-manifold edges** — proven independent of the grid-chunking (identical result on the same buildings chunked vs. not) and independent of the source data (raw pre-CSG extrusions were 0% non-manifold; the library itself was breaking the geometry).

**Fix:** swapped the CSG engine to **Manifold** (`manifold-3d`, a WASM library built specifically to guarantee watertight boolean output). This eliminated the entire grid-chunking scheme and cleanup-pass chain — none of it was needed once the boolean op was actually correct. Verified: full 497-building site computes in 0.7–0.8s (was ~240s), 0% hole edges (was 49%), 13,806 triangles (was 44,404, mostly duplicate seam geometry that no longer exists).

### v3.0.1 → v3.0.8: line/fill bugs found via live browser debugging
Once Joe moved to serving over localhost, a `window.__NS` debug hook was added (exposes `scene`/`renderer`/`camera`/`negativeMesh`/cut-line meshes/clip planes as live getters — ES module internals aren't reachable from outside the page any other way) and a live Claude-in-Chrome browser connection was used to actually inspect and bisect problems instead of guessing from screenshots.

- **v3.0.3 — cut-line depth-test bug:** the red cut-line polygons were losing the depth test against the coincident surface beneath them. A polygon offset of `-4` (fine for a normal-scale scene) does essentially nothing at this site's 1000m+ scale with the camera ~800m out — live-bisected the actual magnitude needed (`-5000` fully closed the gap) via `gl.readPixels` pixel counting, shipped `-6000` for margin.
- **v3.0.4 — slider dead-zone confusion:** each of the 3 cutaway sliders has an extreme value where the removal condition becomes mathematically impossible to satisfy (e.g. height cut at exactly the model's own cap height — nothing is ever taller than the model's own ceiling). Padded each slider's usable max back so the dead zone isn't reachable from the UI.
- **v3.0.5 — the real cut-line bug:** the highlight was restricting itself to the *wrong side* of the other two axes' clip planes (unnegated instead of negated) — the same mistake the poché fill had before its own v2.7.0 fix. Invisible until v3.0.3's depth-test fix let anything render at all. Fixed by reusing the already-existing negated planes. Verified live: old restriction matched 45 triangles scattered across most of the site; fixed restriction matched exactly 4, the two exterior wall faces meeting at the real removed corner.
- **v3.0.6 — filled highlight → real edge outline:** the cut-line highlight was a filled, clipped slab, which meant it fully covered any large flat surface the cut plane happened to coincide with (the roof, and separately — no slider value could avoid this one — the floor of the excavated cavity, which is a genuinely large flat surface by design). Replaced with a real `THREE.EdgesGeometry` extraction drawn as clipped `LineSegments`.
- **v3.0.7 / v3.0.8 — the hatching, for real this time (v3.0.8 not yet confirmed):** pixel sampling on the trivial ground plane found genuine GL dithering (v3.0.7 fix: disable `GL_DITHER` on the WebGL context — confirmed live via before/after pixel sampling). But the same-looking pattern on the more complex cavity-wall mesh turned out denser/more irregular than dithering's signature — likely `computeVertexNormals()` smoothing normals across shared vertices where a nominally-flat wall meets a genuinely different-angle face, leaking bad normals onto triangles that should render flat. v3.0.8 added `flatShading: true` to the relevant materials. **Not yet visually confirmed** — the browser/localhost connection was intermittently unreachable for the last couple of rounds.

## 5. Known open items

- **v3.0.8's flatShading fix is unverified.** Needs a live look to confirm the hatching is actually gone and didn't introduce a faceted/blocky look nobody wants.
- **Poché fill has no boundary line of its own.** Joe asked for the red cut-line to also trace the poché fill's silhouette, not just real mesh edges. The poché quad is a separate GPU-stencil-clipped surface with no edge geometry to extract a line from — this needs either a true mesh-plane cross-section/slicing algorithm, or a stencil-based edge-detection post-process pass. Scoped, not built.
- **Manhattan-scale expansion** (neighborhood-grouped quadrants — Lower Manhattan / Midtown / UWS+UES / Harlem+Washington Heights, per Joe's confirmed grouping) is the next planned direction, paused to finish stabilizing Hudson Yards first. Worth reassessing given Manifold's speed: 497 buildings computing in under a second suggests even a quadrant with 10x the building count might compute live in-browser with no workflow change, rather than needing the offline-precompute-to-`.glb` pipeline that was originally assumed necessary.

## 6. Working methodology notes (for whoever picks this up)

- **This project has a long history of shipping fixes based on a plausible-sounding theory that turned out wrong on inspection.** The throughline that actually worked, especially from v3.0.0 onward: build a Node.js harness against the *real* embedded data (not synthetic test cases) and verify claims with actual numbers before shipping. Several "confirmed" fixes earlier in the project had to be revisited when live testing contradicted the original diagnosis.
- **When browser access is available (Claude-in-Chrome connected to Joe's machine), use it to inspect live state directly** rather than iterating on screenshots. The `window.__NS` debug hook exists specifically to make this possible — `gl.readPixels` pixel-level checks, live GL state inspection, and direct manipulation of scene objects (clip plane constants, material properties) before committing a fix to the source file have caught several bugs that screenshot-only debugging missed or misdiagnosed.
- **The localhost server and the browser connection have both been intermittently unreachable across sessions** — don't assume either is available; check before relying on live verification, and be explicit in the changelog when a fix ships unverified.
- **Don't guess at rendering artifacts that look similar but occur on different geometry.** The "hatching" bug looked like one consistent artifact for most of the project but turned out to be at least two distinct mechanisms (GPU dithering on simple geometry, per-vertex normal smoothing on complex geometry) that needed separate diagnoses and separate fixes.
