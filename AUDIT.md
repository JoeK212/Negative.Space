# Negative Space — Technical Audit

Rewritten at v3.0.36, updated through v3.0.38. See CHANGELOG.md for the full
version-by-version history; this file is architecture + current state +
open items + working methodology.

## What this is

A single-file (`index.html`) Three.js app that computes and displays the
**negative space** of real Hudson Yards buildings: take a bounding "mold"
volume the size of the whole site (footprint × tallest building height),
subtract every real building solid from it via CSG, and what's left is a
solid representation of the *void* — the shape of the air around and above
every building, capped by the mold's own outer boundary. Real Overture Maps
building/building_part footprint + height data for 497 Hudson Yards
buildings, embedded directly in the page (no server, works from `file://`
or a static host).

Live at `axisbim.io` (Joe's own domain); developed against
`http://localhost:8888` (a local static server) because `file://` blocks
`fetch()` of local assets — all real data is embedded as
`<script type="application/json">` blocks specifically to route around
that restriction, so it still works standalone if someone double-clicks
the file.

## Data pipeline

1. **Buildings**: Overture Maps `building` + `building_part` footprints
   (embedded GeoJSON, `#buildingsData` / `#buildingPartsData` script tags).
   Each footprint is extruded to its real height. 497 buildings, 254 with
   real per-part massing from Overture's own building_part data, 243
   falling back to a flat single-height extrusion where part data isn't
   available.
2. **Manhattan borough outline**: real NYC Open Data Borough Boundaries
   (via a public click_that_hood redistribution), simplified to ~350
   points, embedded as `#boroughsData`. Manhattan only as of v3.0.22 —
   Queens/Brooklyn data stays embedded but unused (cheap to revisit).
3. **Major streets**: real NYC Street Centerline data (Socrata resource
   `inkn-q76z`, `streetwidth>=60`), embedded as `#streetsData`. Trimmed to
   a ~1.1km radius around Hudson Yards (151 segments) rather than
   citywide, since this app is site-scoped.
4. **Projection**: `project(lon, lat)` converts real lon/lat to local
   meters via an equirectangular approximation centered on the site's own
   centroid (`setProjectionOrigin`), THEN rotates the result by
   `GRID_ROTATION_DEG` (28.96°, measured directly from the real building
   data — see v3.0.27) so local +Y aligns with Manhattan's actual street
   grid instead of true geographic north. **Every** piece of geometry in
   this app — buildings, boroughs, streets, the site's own bounding box —
   goes through this one function, so everything stays mutually
   consistent automatically. `updateCompass()` corrects for the fact that
   local +Y is no longer true north.

## Geometry engine: Manifold (not three-bvh-csg)

Swapped in v3.0.0 after three-bvh-csg was found to produce ~49%
non-manifold edges on its boolean output (root cause of a long hatching/
gap-artifact saga in v1.x–v2.x — see CHANGELOG). `manifold-3d` (WASM,
loaded from unpkg) guarantees manifold boolean output. Full 497-building
site computes in well under a second (was ~240s with the grid-chunking
workaround the old engine needed). **Needs a live internet connection**
even when the page itself is opened via `file://`, since the WASM engine
loads from a CDN — if `initManifold()` fails (no network), `boot()`
catches it, shows a toast, and the app never loads data at all. This has
been the root cause of at least one full "nothing renders" report.

`computeNegativeSpace()` (the main pipeline, triggered by the "Compute
negative space" button):
1. Builds `siteBox = Manifold.cube([siteWidth, siteDepth, capHeight])`,
   positioned to cover the real building footprint bounds, capped at
   exactly the tallest building's real height (no padding — this was a
   deliberate v2.2.0 fix; padding the cap height means the mold never
   gets fully punched through anywhere, and the whole "mold" concept
   stops reading).
2. Unions all building solids together first (ADDITION, cheap), then does
   **one** final SUBTRACTION of that merged solid from `siteBox`. (Doing
   497 sequential subtractions instead compounds floating-point drift —
   this was a real, fixed bug in v1.1.1.)
3. Extracts the result as a flat, non-indexed triangle soup
   (`rawPositions`) directly from Manifold's own mesh output — genuinely
   watertight, no cleanup/welding pass needed (that's the whole point of
   using Manifold over the old engine).
4. `positions = rawPositions` as of v3.0.31 — **the full, unfiltered
   geometry is what's rendered**. (v3.0.30 tried filtering out the mold
   box's own static outer-shell faces, reasoning they were just a
   bounding container, not part of the real concept. Joe's reference
   images made clear that reasoning was wrong: the negative space IS the
   whole mold-minus-buildings solid, shell included, shown as one
   coherent translucent volume. v3.0.31 reverted the filtering and fixed
   the ACTUAL underlying complaint — opaque walls blocking views — by
   making the material translucent instead of deleting geometry. Don't
   reintroduce shell-filtering without re-reading that whole arc in
   CHANGELOG.md, v3.0.29–v3.0.32.)
5. `buildCoplanarPatchNormals(positions)` — unions triangles across real
   shared edges into coplanar patches (5cm vertex match, 2° angle
   tolerance) and assigns one averaged normal per patch, rather than
   relying on per-vertex smoothing or `flatShading`. This is a real,
   verified improvement to the long-running rasterization "hatching"
   issue (see below) but does NOT fully fix it — that's a rendering-
   resolution limitation, not a mesh/normal bug (confirmed by testing
   with a fully unlit material, where hatching persisted identically).

`negativeMesh` is a single `THREE.Mesh` using one `MeshStandardMaterial`
(`negMat`) with an `onBeforeCompile` shader hack that colors front-facing
fragments as the "outer skin" tone (`0x8798A6`, cool steel-blue-gray,
matching Joe's SPIRA tool) and back-facing fragments dark (a cavity's
interior wall, only visible when looking into a hollow). **Translucent**
(`transparent:true, opacity:0.15` as of v3.0.32) so the mold's own outer
shell never blocks a view from any angle, while still reading as a real
volume. `renderOrder = 0` (draws before the poché cap-fill quads) so those
composite cleanly on top instead of getting washed out underneath the
shell's own translucency — this exact ordering bug ("no poché on X/Y")
cost a full round to find.

## The cutaway system (dollhouse-corner octant removal)

Three independent axis sliders (Height Cut / X Cutaway / Y Cutaway), each
a `THREE.Plane`. `clipIntersection=true` on `negMat` means a fragment is
only clipped away where **all three** conditions are exceeded
simultaneously — so instead of each plane independently slicing off a
slab, together they remove exactly one corner octant, "dollhouse" style,
revealing the interior from that one corner while the rest of the mold
stays sealed (now translucent, not opaque, since v3.0.31/32).

**No padding on any slider as of v3.0.36** — all three reach their true
geometric extremes (real site min/max for X/Y, real 0/capHeight for
height). This was NOT always safe — see the stencil section below for
why, and don't casually remove protections there without re-reading
v3.0.10 and v3.0.34–v3.0.36 in CHANGELOG.md.

Draggable 3D handles (small steel-blue cones, one per axis) let you push/
pull the cut directly in the viewport instead of only via the 2D sliders
— standard single-axis gizmo technique (raycast against a camera-facing
plane containing the drag axis). Both input paths (slider, handle) run
through shared `setHeightCut`/`setXCutaway`/`setYCutaway` functions, one
update path, never two to keep in sync.

**Flip X / Flip Y (v3.0.41)**: two toggle buttons let X and Y each
independently reverse WHICH corner gets excavated at a given slider
position, rather than just how much. `xThreshold`/`yThreshold` (module-
level, NOT `xClipPlane.constant`/`yClipPlane.constant` directly) are now
the single source of truth for "where the cut sits" — a natural,
always-real-world value completely independent of flip state, and
exactly what the slider/label/poché quad/drag handle all read. `xClipPlane`/
`yClipPlane`'s actual `.normal`/`.constant` (and their negated copies
`xClipPlaneNeg`/`yClipPlaneNeg`, and their epsilon-nudged stencil copies
`xClipPlaneStencil`/`yClipPlaneStencil`) are DERIVED from threshold+flip
inside `syncCapFillPlanes()`, never written to directly anywhere else.
**Any code that needs "the real X/Y cut position" must read
`xThreshold`/`yThreshold`, never `xClipPlane.constant`/`yClipPlane.constant`
directly** — the latter is sign-flipped when `flipXCutaway`/`flipYCutaway`
is active and will silently display/position things wrong otherwise (a
real bug caught mid-implementation: the Metric/Imperial unit-toggle label
refresh still read `.constant` directly and would have shown a wrong,
sign-flipped number while flipped, if not caught before shipping).
A v3.0.40 first attempt only mirrored the SLIDER's raw value around the
site midpoint before calling `setXCutaway()` — live-tested and confirmed
it only changed how MUCH got cut at a given position, never which corner,
since it never touched the plane's actual direction. Don't repeat that
approach; the real fix requires the plane's own normal to flip.

## Poché (section-cut fill) — the stencil-capping technique

Clipping planes only discard fragments; they don't generate a cap surface
at the cut. To make a cut plane read as "material was sliced here"
(architectural section poché convention) rather than the cavity looking
like it's hanging in space with no floor, this uses the standard
three.js stencil-capping technique (`createPlaneStencilGroup`, adapted
from three.js's own `webgl_clipping_stencil` example): for each axis, the
real (watertight) geometry is rendered twice into the stencil buffer only
— front/back faces, increment/decrement, clipped to that one plane — so
the stencil ends up non-zero exactly where real solid crosses the plane.
Then a large flat quad is drawn with a `NotEqual(0)` stencil test, so it
only paints where solid was actually cut.

**Render order matters and is non-obvious**: as of v3.0.34, the three
axes' stencil/quad passes run in **X, Y, Z order** (not the more natural
Z/X/Y) — Z's own pass, at its own extreme (height=0, where nearly every
building's base ring in the whole site crosses simultaneously), was
found to corrupt the shared stencil buffer in a way that broke the
*next* axis's test if Z ran first. Running X and Y first, before Z's
dense pass ever touches the buffer, fixed it. If you ever reorder these
again, re-test all three axes at their own extremes individually, not
just at comfortable mid-range values — this bug was completely invisible
except right at Z's own extreme.

**STENCIL_EPSILON sign must be biased toward the interior of each axis'
range** — this is the real fix from v3.0.36, and it's subtle enough to
re-break if touched carelessly. The stencil test's plane needs a tiny
offset from the real slider value to avoid landing exactly on real
geometry (which makes the parity count ambiguous). A FIXED-sign epsilon
(always added) is correct near a minimum — it nudges the test position
further into the site, where real solid exists — but is exactly backwards
near a maximum: adding epsilon there pushes the test position *past*
every real building coordinate on that axis, into genuinely empty space
beyond the whole site, where the parity count can only ever read "no
solid." `syncCapFillPlanes()` now computes, for each axis, whether the
current value sits below or above that axis' own midpoint
`(siteMin+siteMax)/2`, and flips the epsilon sign accordingly — always
nudging toward the interior, never past either edge. **Any future
epsilon/stencil change needs to be verified at all 6 true extremes
individually** (X min, X max, Y min, Y max, Z=0, Z=capHeight), with a
real camera positioned to actually see each one (a straight-down-the-axis
camera view will make a perpendicular wall look invisible for purely
geometric reasons unrelated to any bug — this cost real debugging time
once already).

**The 6 stencil-write meshes must be `transparent:true`, even though they
draw no visible pixels (`colorWrite:false`) — this is load-bearing, not
cosmetic.** Discovered and fixed in v3.0.38: three.js renders its entire
OPAQUE object list, THEN its entire TRANSPARENT list, as two hard-separated
passes — `renderOrder` only sorts objects WITHIN each of those two lists,
it has zero effect on ordering ACROSS them (confirmed directly against
three.js's own render-list source). The 3 poché quads are `transparent:true`
(needed for their 0.4-opacity look, since v3.0.29); if the 6 stencil-write
meshes are left as plain opaque materials, ALL THREE axes' stencil writes
complete first as one opaque batch, and only THEN do the quads render in
sequence — X's quad (rendering first) reads correctly, but its
`onAfterRender` clearStencil() wipes the ENTIRE shared stencil buffer
(WebGL has no way to clear just one axis's share), so Y's quad reads an
all-zero buffer and draws nothing, and Z is cleared a second time over
before its own turn. Symptom looked exactly like "poché only shows on one
axis" and was live-confirmed with a bypass test (no-op'd X's clearStencil
directly on the running page — Y immediately started rendering). Fix: set
`transparent = true` on the base stencil material too, which moves all 6
meshes into the SAME render list as the 3 quads, so the single per-list
renderOrder sort finally produces the intended atomic sequence per axis
(X-write → X-quad read+clear → Y-write → Y-quad read+clear → Z-write →
Z-quad read+clear). If this project ever adds a 4th axis or any other
object that needs to interleave with a stencil read/write/clear sequence,
remember this rule: **stencil writes and their corresponding read/clear
step must be in the SAME opaque-vs-transparent list, or renderOrder cannot
enforce the order between them.**

## Section cut-line (exact plane/triangle cross-section) — also IS poché's boundary

As of v3.0.37, the red line tracing where a cutaway plane crosses the solid
is computed as an **exact triangle/plane intersection** (`computePlaneCrossSectionFast`),
not extracted from the mesh's existing edges. The earlier technique
(`THREE.EdgesGeometry`) only ever found the mesh's real hard edges (corners,
setbacks) — a flat wall has none running through its own interior, so a cut
through open flat material produced only a handful of stray triangulation
seams ("scattered dots", noted v3.0.9, unfixed for a long time). Edge-
extraction structurally cannot produce a plane's true cross-section, no
matter how the threshold is tuned.

The new method: for each triangle, test which of its 3 edges cross the
plane (opposite-sign distance), linearly interpolate the exact crossing
point — a sliced triangle always yields exactly 0 or 2 such points, i.e.
one line segment. Recomputed fresh on every slider/handle-drag update
(`updateCutLinePlanes`), not built once and re-clipped, since the
cross-section's actual shape changes as the plane moves. This same
cross-section, restricted to the removed octant via the negated planes
already shared with the poché quads, **is** the poché fill's true
boundary — no separate implementation, they're provably the same line.

Two things worth knowing if you touch this again:
- **Performance**: a naive version (JS-array `push()` per crossing point)
  measured ~9.8ms for a full 3-plane recompute at this model's ~13,800
  triangles — too much of a 16.7ms frame budget during a drag. The real
  cost was allocation/push overhead, not the math — rewritten to (1) skip
  a triangle immediately if all 3 vertices are on the same side (no
  interpolation work for most triangles), and (2) write into a
  pre-allocated, reused `Float32Array` (sized once per mesh at
  `triCount*6`, worst case) paired with `geometry.setDrawRange()` instead
  of swapping the BufferAttribute every frame. ~2.3ms after.
- **Same exact-coincidence degeneracy as the poché stencil (v3.0.36)**:
  Height Cut=0 sits exactly on the cavity's own real floor (~31% of all
  vertices coincide there) — a raw-plane cross-section finds ZERO
  crossings there (every triangle either fully on one side or exactly
  coincident, never a strict sign change). Fixed by reusing the SAME
  epsilon-biased `sectionPlaneStencil`/`xClipPlaneStencil`/`yClipPlaneStencil`
  planes the poché stencil test already uses, rather than a second
  epsilon mechanism — one shared fix for both systems. `syncCapFillPlanes()`
  must run before `updateCutLinePlanes()` (not after) at every call site
  so these epsilon planes reflect the CURRENT slider value, not the
  previous frame's.



- **The "hatching" artifact**: fine per-triangle rasterization noise
  visible on some large flat walls, especially at a distance or grazing
  angle from inside the excavated void. Root-caused (v3.0.9) as genuine
  rasterization aliasing of real fine geometric detail (many thin
  setback walls/small building parts) — NOT a mesh, material, or normal
  bug (verified by testing with a fully unlit material; hatching
  persisted identically). No further mesh/material patch will fix this;
  the lever is rendering resolution. A "High detail (slower)" checkbox
  bumps the renderer's pixel ratio as an opt-in mitigation (real
  frame-time cost). The v3.0.29 poché translucency change also helps
  incidentally, since a translucent surface blends with what's behind it
  rather than showing the aliasing as a stark opaque silhouette.
- **Translucent single-mesh limitation**: `negativeMesh` is one
  `DoubleSide` mesh rendered with `transparent:true`. This does NOT do
  proper order-independent transparency — at extreme angles you may see
  minor back/front face ordering artifacts. Acceptable tradeoff so far;
  a real fix would need depth-peeling or a two-pass sorted-transparency
  technique, meaningfully more complex.
- **WebGL dithering**: disabled directly on the context
  (`gl.disable(gl.DITHER)`) after v3.0.7 found it was adding a 1-level
  per-pixel color alternation on flat surfaces. If a genuine smooth
  gradient somewhere in the scene ever shows visible banding instead of
  smoothness, this is why — traded dithering noise for potential banding
  deliberately, on the reasoning that banding is rarer and more legible
  than the noise it replaced.

## Camera system: perspective (default) + orthographic (N/S/E/W only)

Two camera objects exist: `camera` (the original `THREE.PerspectiveCamera`,
used for the default 3/4 view and Manhattan context) and `orthoCamera` (a
`THREE.OrthographicCamera`, added in v3.0.42, used ONLY while an N/S/E/W
flat elevation is active). A module-level `activeCamera` variable tracks
which one is actually live — `animate()`'s `renderer.render(scene,
activeCamera)`, `onResize()`, `updateCompass()`, and the drag-handle
raycasting (`dragRaycaster.setFromCamera(..., activeCamera)`) all read
this rather than hardcoding `camera`. **Any new code that reads the
camera directly (raycasting, framing math, anything screen-space) needs
to use `activeCamera`, not `camera` — hardcoding `camera` will silently
misbehave (wrong raycasts, wrong compass) whenever an N/S/E/W view is
active.**

Both cameras share the SAME single `OrbitControls` instance — `controls`
— rather than maintaining two independent controls objects. Switching
views reassigns `controls.object` (`camera` or `orthoCamera`) and calls
`controls.update()`; this is a standard, well-supported three.js pattern
(used in three.js's own multi-camera examples), and avoids two sets of
mouse/touch listeners competing for the same DOM events. `setOrthogonalView()`
switches to `orthoCamera`; `recenterCamera()` (the Home button) and
`zoomToBoroughContext()` (Manhattan context always uses the perspective
camera — see below) switch back to `camera`.

**Why orthographic at all**: Joe reported the N/S/E/W nav buttons were
"isometric, not flat 2D views" — they were real, if subtle, perspective
foreshortening (buildings shrinking with distance from the camera), since
`setOrthogonalView()` just repositioned the single perspective camera to
look along an axis. There's no FOV or distance trick that removes
perspective foreshortening — a genuine architectural elevation/plan
drawing (parallel projection, apparent size independent of distance)
needs an actual orthographic camera. `orthoCamera` is created once in
`initScene()` and reused/repositioned every time `setOrthogonalView()`
runs, rather than rebuilt from scratch.

`setOrthogonalView(direction)` frames via `currentTargetAndSpan()` (NOT
`currentTargetAndDistance()`, which no longer exists as of v3.0.42) — an
orthographic frustum's half-height needs a real-world characteristic
size of the model, not whatever distance the perspective camera happened
to be parked at. This is a deliberate behavior change from the old
perspective-based N/S/E/W: pressing N/S/E/W now ALWAYS frames the full
model consistently (`span * 0.55` half-height, both site- and
borough-scale aware via the same `showBoroughs` check the v3.0.39 fix
established), rather than preserving whatever zoom level you'd
perspective-orbited to. Also deliberately NO vertical lift (the old
perspective version added an 18% lift so a purely edge-on view didn't
read as a flat line) — reading perfectly flat, perpendicular to the
labeled axis, is the entire point of a true elevation.

**Manhattan context always forces the perspective camera.** `zoomToBoroughContext()`
repositions `camera` directly; if an ortho N/S/E/W view were active when
Manhattan context is toggled on, the renderer would keep showing
`orthoCamera` and silently not reflect the new borough framing until Home
was also pressed — `zoomToBoroughContext()` explicitly resets
`activeCamera`/`controls.object` to `camera` at its start to prevent
that. There is currently no orthographic Manhattan-context view; N/S/E/W
while zoomed to the borough uses `orthoCamera` (fully supported, tested),
but there's no ortho equivalent of the borough's own steep aerial angle —
not asked for, not built.

Live-verification note specific to this feature: the core projection
mechanism (does an orthographic camera actually eliminate foreshortening
here) was prototyped and confirmed FIRST directly against a live running
session — building a second camera + controls, intercepting
`renderer.render` to force it through — before any file changes, then
re-verified a second time against the actual shipped code (reading real
post-compute site bounds off the live sliders, not guessed values) before
calling it done. The drag-handle raycasting switch to `activeCamera` uses
the same standard `Raycaster.setFromCamera()` API for both camera types
and was NOT separately live-tested — lower risk than the camera-switching
mechanism itself, but worth a real check if handle-dragging from an N/S/E/W
view ever gets reported as behaving oddly.

## Manhattan context view

A separate camera mode (`zoomToBoroughContext()`/`exitBoroughContext()`),
toggled via the "Manhattan context" button, pulling the camera back to
see the real Manhattan outline the site sits within. Real buildings and
the negative-space mesh stay visible throughout (a real fix in v3.0.24,
after earlier versions hid them to avoid an opaque platform burying the
tiny site models — the platform itself was reworked to be thin instead).
Manhattan is rendered as a thin ground PLATE (top surface at z=0,
matching where real buildings' own bases already sit), not a tall
platform — extruded downward, not upward. Uses its own camera near/far/
`maxDistance` values (steep 68° aerial angle, much larger near plane)
since the site-scale camera settings produce severe depth-buffer
precision loss and an unrealistically low/grazing viewing angle at
~30km city scale — this was a real, confirmed bug (v3.0.21), not just a
style preference.

## Working methodology notes for future sessions

- **This project has a long history of shipping fixes that turned out to
  be wrong or incomplete on first guess.** Nearly every real fix in
  CHANGELOG.md from v3.0.9 onward was found by live-connecting to Joe's
  actual browser session (`localhost:8888`, via Claude-in-Chrome) and
  directly inspecting real WebGL/DOM state (`window.__NS` debug hook:
  exposes `scene`, `renderer`, `camera`, `THREE`, `negativeMesh`,
  `solidGroup`, `capFillGroups`, cut-line meshes, clip planes as live
  getters) — not by reasoning from a screenshot alone, and not by
  guessing from code inspection alone. Screenshot-only diagnosis has
  repeatedly led to wrong fixes in this project (the entire v3.0.29-32
  poché/shell saga, the v2.4.0-era hatching saga). **Always verify a fix
  live, on the actual reported condition, before calling it done.**
- **A camera positioned to look straight down one axis will make a wall
  perpendicular to that axis look invisible for purely geometric reasons**
  (viewing a flat plane exactly edge-on). This has been mistaken for a
  rendering bug at least twice. Cross-check with a `Box3` and/or an NDC
  projection of the object's world position before concluding something
  isn't rendering.
- **Bypass tests are useful but can mislead**: setting a stencil
  material's `stencilFunc` to `AlwaysStencilFunc` shows whether the QUAD
  itself is positioned/sized correctly, independent of the stencil test —
  useful for isolating "is this a geometry bug or a stencil-logic bug,"
  but a positive bypass result doesn't mean the real (non-bypassed)
  behavior is correct.
- **Pixel-color automated tests need real calibration**: translucent
  materials blend differently against different backgrounds (sky vs.
  ground vs. another translucent layer) — a fixed RGB threshold that
  works in one scene region can produce false negatives elsewhere. A
  direct visual screenshot check caught a false "broken" reading from
  exactly this kind of automated test once already (v3.0.36).
- **Background async calls can outlive a CDP timeout.** If a
  `javascript_exec` call times out but the underlying page-side promise
  chain keeps running, subsequent "clean" test calls can get silently
  contaminated by the still-running old one (slider values changing
  underneath you mid-test). If a test result looks inexplicable, do a
  full `location.reload()` before trusting it.
- **The `localhost:8888` server is Joe's own local process**, not
  something reachable or writable from this environment directly. There
  is no way to push a file update to it — the workflow is always: hand
  off `index.html` via `present_files`, Joe saves it over his local copy,
  Joe reloads. This project's own sandbox `python3 -m http.server` is
  NOT reachable from Joe's real browser (different machine/network
  namespace) — don't confuse "I started a local server" with "Joe can
  see it."
- **`javascript_tool` return-value channel truncates around ~1-1.5KB.**
  For any data transfer larger than that (e.g. pulling real data out of a
  connected browser session), write it into the target page's own DOM and
  read it back via `get_page_text`, which has no comparable limit (used
  successfully for the major-streets data pull, v3.0.26).
- **Always live-verify a fix with the "Manhattan context" and "Major
  streets" toggles both ON, in addition to the default state.** These are
  independent, non-mutually-exclusive overlays that stay active across
  compute/recompute — a fix that only gets tested in the default view can
  still be wrong once real-world context geometry is in the scene. Note
  that "Manhattan context" ON deliberately hides the poché quads/cut-lines/
  drag handles (a documented v3.0.24 design choice — those are a close-up
  cutaway workflow, not meaningful at city scale), so a poché-related fix
  can only be meaningfully checked against "Major streets" while zoomed to
  the site; checking "Manhattan context" for a poché fix means confirming
  it hides everything as designed and restores correctly on exit, not
  that poché itself still renders while zoomed out (it won't, on purpose).

## Open / not yet started

- Manhattan-scale expansion beyond Hudson Yards (paused) — worth
  reassessing given Manifold's real speed (497 buildings computes in
  well under a second; a 10x-denser quadrant may still compute live
  in-browser with no offline pipeline needed).
