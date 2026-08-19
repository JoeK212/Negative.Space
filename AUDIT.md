# Negative Space — Technical Audit

Rewritten at v3.0.36, updated through v3.0.42; architecture section updated
for v3.1.0's neighborhood switcher. See CHANGELOG.md for the full
version-by-version history; this file is architecture + current state +
open items + working methodology -- the technical doc for whoever's
editing the code. For a plain-language feature walkthrough and the
"how to add a neighborhood" workflow, see EXTENDED.md instead (added
v3.1.3, alongside a short README.md and an in-app help modal).

## What this is

A single-file (`index.html`) Three.js app that computes and displays the
**negative space** of real buildings for a chosen NYC neighborhood: take a
bounding "mold" volume the size of the whole site (footprint × tallest
building height), subtract every real building solid from it via CSG, and
what's left is a solid representation of the *void* — the shape of the air
around and above every building, capped by the mold's own outer boundary.
Real Overture Maps building/building_part footprint + height data, one
neighborhood active at a time, switchable via the sidebar's Neighborhood
picker. As of v3.1.0: **Hudson Yards** (497 buildings, the original site)
and **Chelsea** (1,226 buildings, added as a proof-of-concept that the
whole pipeline scales past a single site).

Live at `axisbim.io` (Joe's own domain); developed against
`http://localhost:8888` (a local static server). **As of v3.1.0, `file://`
no longer works at all** — this is a real regression from earlier versions,
a deliberate tradeoff for neighborhood switching. Data now lives in
per-neighborhood files (`data/<id>/buildings.geojson`,
`data/<id>/building_parts.geojson`, and — as of v3.1.1 —
`data/<id>/streets.json`), fetched live by `loadData()` rather than
embedded in the page — embedding was the whole reason `file://` used
to work (v1.0.1 routed around Chrome's file:// fetch() block by inlining
the GeoJSON as `<script type="application/json">` tags), but embedding
doesn't scale to N neighborhoods without the HTML file ballooning every
time one is added. Must be served over http(s) now, same requirement
Manifold's wasm-from-unpkg already had. As of v3.1.1: **Hudson Yards**
(497 buildings), **Chelsea** (1,226 buildings), and **Hell's Kitchen**
(438 buildings, core bbox W44th–W50th St between 9th–10th Ave).

## Data pipeline

1. **Buildings**: Overture Maps `building` + `building_part` footprints,
   fetched live (not embedded, as of v3.1.0) from
   `data/<neighborhoodId>/buildings.geojson` and
   `data/<neighborhoodId>/building_parts.geojson`. Each footprint is
   extruded to its real height. Adding a neighborhood means fetching its
   data (Overture PMTiles + vector-tile decode, see the Chelsea
   proof-of-concept in CHANGELOG v3.1.0 for the exact method and a real
   gotcha — see "Winding order" below), winding-correcting it, measuring
   its own real grid tilt, dropping the two files in a new `data/<id>/`
   folder, and adding one entry to the `NEIGHBORHOODS` config array —
   deliberately NOT a live search-any-area system (see "Neighborhood
   switching" below for why).
2. **Manhattan borough outline**: real NYC Open Data Borough Boundaries
   (via a public click_that_hood redistribution), simplified to ~350
   points, embedded as `#boroughsData` (this one stays embedded — it's
   shared, not per-neighborhood). Manhattan only as of v3.0.22 —
   Queens/Brooklyn data stays embedded but unused (cheap to revisit).
3. **Major streets**: real NYC Street Centerline data (Socrata resource
   `inkn-q76z`, `streetwidth>=60`). **As of v3.1.1**, fetched live per
   neighborhood from `data/<id>/streets.json` (same pattern as
   buildings/building_parts) instead of a single shared embedded
   `#streetsData` tag — each neighborhood now shows its own real streets,
   not Hudson Yards' set repositioned under it. `buildStreetsLayer()` is
   now async; `loadData()` awaits it before syncing the toggle.
4. **Projection**: `project(lon, lat)` converts real lon/lat to local
   meters via an equirectangular approximation centered on the site's own
   centroid (`setProjectionOrigin`), THEN rotates the result by
   `GRID_ROTATION_DEG` so local +Y aligns with the neighborhood's actual
   street grid instead of true geographic north. **As of v3.1.0,
   `GRID_ROTATION_DEG` is a mutable `let`, not a const** — each
   neighborhood in `NEIGHBORHOODS` carries its own independently-measured
   `gridRotationDeg` (same v3.0.27 weighted-circular-mean-of-wall-bearings
   method, run fresh against that neighborhood's own real building data,
   never assumed or copied from another neighborhood — Hudson Yards
   28.96°, Chelsea 28.55°, genuinely different values). `setGridRotation()`
   updates both `GRID_ROTATION_DEG` and the derived `GRID_ROTATION_RAD`
   together, called by `loadData()` before `project()` is ever invoked for
   that neighborhood's data. **Every** piece of geometry in this app —
   buildings, boroughs, streets, the site's own bounding box — goes
   through this one function, so everything stays mutually consistent
   automatically. `updateCompass()` corrects for the fact that
   local +Y is no longer true north.

## Winding order — a real gotcha for any future PMTiles-sourced neighborhood

If a future neighborhood's data comes from decoding Overture's PMTiles
vector tiles (via `@mapbox/vector-tile`'s `toGeoJSON()`, the method used
for Chelsea) rather than the Python `overturemaps` CLI or DuckDB, **check
ring winding before trusting the data**. Chelsea's extraction produced
every single ring (1226/1226) wound clockwise; Manifold's `CrossSection`
under its default Positive fill rule silently treats a CW ring as
zero-area, so `Manifold.extrude()` returns `InvalidConstruction` status for
every single building — not a thrown error, just a bad status that reads
downstream as either "nothing renders" (if checked) or, worse, a very
long, confusing near-hang in `Manifold.union()` being fed hundreds of
invalid manifolds (if not checked; this is what actually happened live in
Joe's browser before the root cause was found via an isolated Node
harness). Fix: compute the ring's shoelace signed area; if negative
(clockwise), reverse the point order before constructing the
`CrossSection`. Not an issue for Hudson Yards' original data (sourced
differently, already correct winding) — this is specific to the
PMTiles/vector-tile extraction path.

## Tile-boundary fragment dedup — a second real PMTiles gotcha (v3.1.8)

A more subtle bug than winding order, found after it: fetching multiple
adjacent PMTiles tiles to cover a neighborhood's bbox, a real building
that spans two tiles gets a DIFFERENT clipped fragment under the SAME
`id` in each tile — standard vector-tile clipping behavior, not a bug in
the tile source. If the fetch code dedupes by "first id seen wins," it
can keep a small tile-edge sliver fragment instead of the fragment
containing most of the real footprint, silently dropping the rest of
that building from the fetched data entirely — not mis-rendered, never
fetched. Renders as an obvious wedge/pie-slice shape sitting where a
normal building should be.

**Diagnostic signature, worth remembering**: several small triangular
buildings clustered at (or within ~30-50m of) the exact same latitude or
longitude, despite being spread across a much larger area (hundreds of
meters, multiple avenues) — real independent buildings can't do that,
but two tiles clipping the same features along one shared boundary edge
produces exactly that pattern. Confirm by computing the real z14 tile-row
latitude via the standard `tile2lat(y, z) = atan(sinh(π - 2πy/2^z))`
formula and checking it against the suspicious buildings' latitude.

**Fix**: when deduping fetched features by id across multiple tiles,
always keep the LARGEST-area fragment seen for that id, never simply the
first one encountered. Applies to both `building` and `building_part`
layers. This is now baked into the standard fetch pattern for this
project — any future neighborhood's fetch code should use it from the
start, not rediscover the bug.

## Grid-tilt circular mean must fold to mod-90, not mod-180 (found District 7, v3.2.15)

The weighted-circular-mean-of-wall-bearings method (referenced above and
in v3.0.27) has a real failure mode when implemented as a naive axial
mean: folding each wall bearing to mod-180 and doubling it (the standard
technique for undirected line data) treats a rectangular building's two
PERPENDICULAR wall families as unrelated data. Since 90° doubled is 180°
— i.e. exactly opposite on the doubled circle from 0° doubled — a
building's long walls and short walls (correctly 90° apart in reality)
cancel each other out in the vector sum instead of reinforcing a shared
grid direction. Caught when this produced a nonsensical R=0.177 for
District 7 (Upper West Side), a district with one of Manhattan's most
famously regular grids — a result that should have been close to
Hudson Yards' 0.947 or District 4's 0.967, not near-zero.

**Fix**: fold each wall bearing to mod-90 (not mod-180) FIRST — this
correctly merges a wall and its 90°-rotated partner into the same value,
since `(θ) mod 90 === (θ+90) mod 90`. THEN quadruple the folded angle
(not double) before the circular mean, to correctly handle the mod-90
wraparound the same way doubling handles mod-180. Divide the resulting
mean angle by 4 to get back the real tilt.

**Resolved (checked directly, Aug 2026)**: re-ran the corrected mod-90
method against each of Districts 1-6's real building data in a fresh
Node harness, and ran the flawed mod-180 method against the same data
for contrast. Districts 2-6's shipped R values were already computed
correctly — the independent mod-90 re-measurement landed within
~0.01-0.015 of each shipped value (e.g. District 4: shipped 0.967 vs
re-measured 0.954; District 2: shipped 0.429 vs re-measured 0.422),
well within method-precision noise (haversine approx, degenerate-segment
cutoff, building_parts inclusion). The mod-180 method, run for real
rather than assumed, produces obviously-degenerate output (R≈0.03-0.07
and a *different* mean angle entirely, not just a smaller R) — so if
Districts 2-6 had shipped under that bug it would have been just as
visible as District 7's 0.177 was. Tilt angles agree closely under both
methods, confirming the earlier guess that angle survives the flaw even
though R doesn't. District 1 never had an R value recorded at ship
time (predates R being tracked at all) — now measured at **R=0.528**,
meaningfully weaker than District 4-6's 0.93-0.97 range, consistent
with FiDi's colonial-era irregular streets diluting TriBeCa's regular
grid (the concern flagged when District 1 shipped, now confirmed
numerically rather than just suspected). No shipped tilt/R values or
index.html data need to change as a result of this check.

## Streets must be clipped to the real polygon, not just a buffered bbox (found District 7, v3.2.15)

The documented streets step ("filter major streets to the same real
polygon," EXTENDED.md's "adding a district" instructions) means exactly
what it says — clip to the polygon (buffered by the standard ~350-400m),
not to a buffered rectangular bounding box. A rectangular buffer around
a district's bbox can reach much farther than intended when the
district's real boundary is a tilted line (as most Manhattan community
district boundaries are, following the ~29°-tilted street grid) — a
buffered bbox's corners extend past the buffer distance from the actual
boundary line, sometimes by hundreds of extra meters. Concretely: CD7's
east boundary runs along Central Park West, and a 380m-buffered
rectangular bbox around CD7 reached across the ~800m width of Central
Park and picked up real East Side avenues (3rd/2nd/1st/York) that have
no business appearing in a west-side district's streets file — 28
spurious-inclusive unique street names instead of the real 20.

**Fix**: after the initial `within_box` fetch (a generous rectangular
candidate pool is fine and expected — it just needs to be big enough to
contain the real buffered polygon), filter each street segment by real
point-to-polygon distance (point-in-polygon OR distance from the segment
midpoint to the nearest polygon boundary edge, in meters via the same
lon/lat-to-meters conversion used elsewhere) against the ~350-400m
threshold — not against the bbox itself. This is now the standard
pattern for any future district's streets fetch.

## Streets near a borough line: polygon-distance clip alone isn't enough (found District 10, v3.2.18)

A distinct, later problem than the one above — this one only shows up
for districts whose Manhattan shoreline runs close to another borough.
The real point-to-polygon-distance clip (previous section) correctly
solved the "buffer reaches past the district's own edge" problem, but
it says nothing about WHICH borough is on the other side of that edge.
Where the Harlem River narrows (roughly CD10/CD11's stretch), a
correctly-computed ~380m buffer can genuinely reach across the water
and pick up real BRONX streets — not a geometry bug, an accurate
distance measurement of a real narrow crossing. Found in District 10:
Jerome Ave, E 149th St, and the Major Deegan Expressway service road
all measured genuinely within 380m of CD10's real polygon boundary,
correctly passing the distance clip, while being on the wrong side of
the water for a Manhattan-only project.

**Fix**: NYC Street Centerline's own `boroughcode` field (`1` =
Manhattan, `2` = Bronx, standard citywide borough codes) is the correct
filter here, applied per-segment alongside (not instead of) the
polygon-distance clip — checking the street NAME alone isn't reliable
(e.g. Manhattan's own real E 135th St happens to share its name with a
separate Bronx street across the river; filtering by name would either
wrongly drop the real Manhattan segment or wrongly keep the Bronx one,
depending on which direction the mistake ran). Applying the borough
filter per-segment, before grouping fetched segments by street name,
handles this correctly either way. Worth checking for any future
district with a similar narrow-water or land-bridge crossing (District
11's Wards Island/Randalls Island connections to Queens/the Bronx via
the Triborough/RFK Bridge are a likely candidate) — not yet checked.

## Neighborhood switching (v3.1.0)
entry), not a database or live search index. The sidebar's Neighborhood
row is generated from it (one button per entry) rather than hardcoded
HTML, so adding a neighborhood needs zero HTML changes. `switchNeighborhood(id)`
calls `loadData(id)`, which now does real cleanup before loading the new
data — this didn't exist before v3.1.0 since `loadData()` only ever ran
once, at boot:
- Removes and disposes the previous neighborhood's `solidGroup`,
  `negativeMesh`, `capFillGroups`, and the three cut-line meshes.
- Resets `siteMinX/Y`, `siteMaxX/Y`, `siteCapHeight` to `undefined` and
  hides `#sectionRow` (the cutaway sliders) until the new neighborhood is
  computed — a stale cutaway range from the PREVIOUS neighborhood's
  dimensions must never be shown or usable against a different
  neighborhood's geometry.
- Rebuilds `boroughsGroup`/`streetsGroup` fresh rather than reusing the
  first-load versions — both are re-projected through the CURRENT
  `project()` origin, which changes per neighborhood, so a "build once"
  version would be correctly positioned only for whichever neighborhood
  loaded first and silently wrong for every neighborhood after that.
- Re-syncs Manhattan-context/streets toggle visibility to whatever the
  user already had set (a cheap visibility-only sync, not a full
  camera-reframe — if Manhattan context was on with a specific pan/zoom
  before switching, the camera position itself is left alone).

Live-verified for precision (not just "doesn't crash"), in both switch
directions, by reading real numbers off `window.__NS` and the actual
slider DOM elements after a fresh compute on each neighborhood — see
CHANGELOG v3.1.0 for the exact figures (395m/13,802 tri for Hudson Yards,
123m/39,278 tri for Chelsea, both matching known-correct values with zero
cross-contamination between switches).

## Geometry engine: Manifold (not three-bvh-csg)

Swapped in v3.0.0 after three-bvh-csg was found to produce ~49%
non-manifold edges on its boolean output (root cause of a long hatching/
gap-artifact saga in v1.x–v2.x — see CHANGELOG). `manifold-3d` (WASM,
loaded from unpkg) guarantees manifold output for well-formed input, and
in practice gets there for the vast majority of any real neighborhood's
geometry — but NOT unconditionally: v3.2.1 found real, small-scale
non-manifold residuals (0.15–0.24% of edges, all three neighborhoods)
from degenerate input cases Manifold's own guarantee doesn't cover —
buildings touching the mold boundary exactly, and buildings sharing an
exact corner vertex. See "Open / not yet started" below for the current
state of that investigation. Full 497-building
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

## Camera system: perspective (default) + orthographic (N/S/E/W + Plan)

Two camera objects exist: `camera` (the original `THREE.PerspectiveCamera`,
used for the default 3/4 view and Manhattan context) and `orthoCamera` (a
`THREE.OrthographicCamera`, added in v3.0.42, used ONLY while an N/S/E/W
flat elevation or the v3.1.2 true Plan (top-down) view is active). A module-level `activeCamera` variable tracks
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

**Plan view (v3.1.2, live-tested before shipping).** `setOrthogonalView('plan')`
positions `orthoCamera` directly above the target (offset purely along
+Z, this scene's own up axis) — the "pole" of `OrbitControls`' internal
spherical position math. The first draft here added a horizontal
up-vector swap (`(0,1,0)` instead of the normal `(0,0,1)`) on the theory
that the final camera orientation would hit a degenerate `lookAt` case
with `up` parallel to a straight-down view direction. That turned out to
be an untested guess — live-tested it directly (before writing the
shipped version, not after) by building an isolated throwaway
`OrthographicCamera` + `OrbitControls` instance in a real running
session, positioning it at the exact same pole with the scene's ORDINARY
`up=(0,0,1)` left untouched: the result came back clean on its own —
forward vector `(0,0,-1)` (straight down, correct), local screen-up
mapping to world `(0,1,0)` (north-up, correct) — no special-casing
needed at all. A follow-up test nudging the camera slightly off that
pole (simulating a small orbit drag away from Plan) also came back
stable, no NaN or gimbal-lock blowup. Shipped the simpler version:
`orthoCamera.up` never changes, for Plan or any other direction. Worth
remembering for future camera work in this app: don't assume a
three.js/OrbitControls edge case behaves the way the docs or general
graphics-programming intuition suggest — check the actual library
behavior directly, the way this was (and the way v3.0.42's own
orthographic-camera prototype was, per the paragraph above).

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

**Orbit target must be the SITE's center, not the borough's (found +
fixed v3.2.23)**: `zoomToBoroughContext()` originally anchored both the
initial camera position AND the OrbitControls target on
`boroughsGroup`'s own bounding-box center. That's fine for the very
first framing (it centers the whole island), but wrong as an ongoing
orbit target — every zoom-in dollies the camera toward
`controls.target`, and Manhattan's own centroid has no relationship to
whichever district is actually loaded. Confirmed live in Joe's session
(District 1, ~9000m from Manhattan's centroid): after a real zoom-in,
`camera.position` had landed within 0.004 units of the borough box
center — i.e. dollied almost exactly ONTO the empty target point, deep
inside/behind real geometry along the way, tripping `BOROUGH_CAMERA_NEAR`
(30 units) and slicing most of the scene away mid-shape (real per-
triangle near-plane clipping — see the frustum-culling-is-all-or-nothing
note above for why this rules out culling as the cause). Fixed by
keeping the framing DISTANCE derived from the borough's size (whole
island still fits on initial toggle) but anchoring both camera position
and `controls.target` on `solidGroup`'s own bounding-box center instead
— `solidGroup` is always populated once a district loads, unlike
`siteMinX` etc. which only exist post-compute. Verified against Joe's
real live data before shipping: recomputed the corrected position from
his session's actual `boroughsGroup`/`solidGroup` boxes, confirmed a
simulated deep zoom-in now lands ~900 units from the real district
(not ~0.004 units from empty space), and screenshotted the corrected
initial full-island framing directly in his session.

**The cutaway-editing extras are no longer force-hidden in this view
(also v3.2.23)**: `heightHandle`/`xHandle`/`yHandle`/cut-line meshes/
cap-fill groups used to be unconditionally hidden whenever Manhattan
context was on (the v3.0.24 design intent below). Joe's actual usage —
zoomed in close on the district with Manhattan context still enabled —
needs the handles working in exactly that state. Removed the forced
hides; `refreshViewToggles()` already gates their visibility correctly
on the Negative-space toggle + section-row state, so they now behave
identically with Manhattan context on or off. **This changes the
"Always live-verify" note below** — the old assumption that Manhattan
context deliberately hides them no longer holds; see the corrected
note.

**The SAME borough-centroid-as-target bug existed in a second place —
the orthographic N/S/E/W/Plan views (found v3.2.24)**: v3.2.23 only
fixed `zoomToBoroughContext()` (the perspective camera). `currentTargetAndSpan()`
— used by `setOrthogonalView()` for all N/S/E/W/Plan buttons — had the
identical bug: anchored on `boroughsGroup`'s box center instead of the
site's when Manhattan context is on. Joe reported v3.2.23 as still
broken; live re-diagnosis found his original screenshots most plausibly
came from the Plan view (flat, no perspective foreshortening), which
this second bug — untouched by v3.2.23 — still fully explains. Confirmed
live: District 1 site center is 9146.99 units from `boroughsGroup`'s
center, essentially identical to the perspective-camera gap v3.2.23
found. **The failure mode looks different here** because an orthographic
camera's scroll-to-zoom only changes `camera.zoom` (frustum scale) —
it never moves the camera's position, unlike perspective's dolly. So
this isn't a near-plane clip: zooming in on a Plan/N/S/E/W view with
Manhattan context on zooms toward Manhattan's geometric middle, and for
a district far from that middle, a handful of ordinary scroll ticks
lands the frustum over a stretch of the borough's flat context plate
with no buildings on it — a solid, textureless gray fill, the real
content just gone. Reproduced directly (District 1, Plan view): 15
zoom-in ticks still showed the correct island silhouette; 30 ticks was
already total flat gray fill that stayed broken zooming further in
either direction (confirms the frustum CENTER was wrong throughout, not
just "too far zoomed" — a correctly-centered frustum recovers the whole
island on zooming back out, this didn't). Fixed the same way: SPAN
still from `boroughsGroup` (whole-island framing on first toggle), but
TARGET now from `solidGroup`'s own box center.

**Separate bug found by inspection while auditing this code path,
not yet reported by Joe (also v3.2.24)**: `orthoCamera.zoom` was never
reset between `setOrthogonalView()` calls. Since ortho zoom never moves
the camera, a leftover zoom value from a previous N/S/E/W/Plan view
(e.g. zoomed in tight on a ~2000m site) would silently over/under-zoom
the very first frame of a freshly recomputed borough-scale frustum —
before any new scrolling. Now reset to 1 on every call.

**`orthoCamera` is NOT exposed on `window.__NS`** (only `camera`, the
perspective one, is) — this made v3.2.24 harder to live-verify than
v3.2.23; verification here has to be screenshot/UI-interaction based
rather than direct camera-state reads. Worth adding `orthoCamera` to
the debug hook in a future pass so this class of bug is checkable the
same way for both cameras.

## Working methodology notes for future sessions

- **`node audit_deploy.js` (added v3.1.5) before calling any change
  done.** Not a linter — project-specific invariant checks, most keyed
  to a real bug from this project's own history (a second, testable
  copy of CHANGELOG.md). Growth pattern: every time a real bug is found
  and fixed, add a `check()` for it in the same edit that fixes it,
  under a `sectionHeader()` named after the version that fixed it. The
  scanner it uses for the v3.0.14 top-level-call check is itself a case
  study in verifying a check before trusting it — see the v3.1.5
  CHANGELOG entry for the real regex-literal bug that shipped in that
  scanner's first draft and how it was caught before release.
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
  still be wrong once real-world context geometry is in the scene. As of
  v3.2.23, the poché quads/cut-lines/drag handles are NO LONGER force-
  hidden when Manhattan context is on (that was a v3.0.24 design choice,
  removed once Joe's real workflow — zoomed in close on the district with
  Manhattan context still enabled — showed it was blocking the handles
  from working exactly when he needed them). A poché/handle-related fix
  now needs checking with Manhattan context ON too, not just Major
  streets while zoomed to the site — don't assume it's hidden there.
  Also worth re-testing after any camera/zoom change: v3.2.23's own bug
  was in this exact view (orbit target anchored on the wrong point),
  found only by checking real zoomed-in behavior, not just the initial
  toggle-on framing.

## Open / not yet started

- **All 12 Manhattan Community Districts are now shipped** (as of v3.2.20) **and all have been live-verified** in Joe's actual running browser as of a follow-up session with his local dev server up (Districts 1-6 were already live-verified during their original shipping sessions; Districts 7-12 were checked in this follow-up pass, split across two sessions). Every district's real `Compute negative space` run in-browser matched its Node-harness triangle count almost exactly (D7: 161,900 vs 161,894; D9: 94,730 vs 94,740; D10: 137,854 vs 137,854 exact; D11: 100,548 vs 100,546; D12: 139,702 vs 139,682), and District 8/11's multi-part boundaries (Roosevelt Island, Wards/Randalls Island) were confirmed rendering as real separate landmasses in Manhattan-context view. No artifacts, missing geometry, or misplacement found anywhere. This item is now closed.
- **Districts 1-6's grid-tilt R re-check under the corrected mod-90 method — resolved, closed** (see "Grid-tilt circular mean must fold to mod-90" above): re-ran the real corrected method against Districts 1-6's actual data. Districts 2-6's shipped R values were already correct (within ~0.01-0.015 of independent re-measurement). District 1's R, never recorded at ship time, is now measured at R=0.528. No shipped data changed.
- **Multi-part district boundaries**: confirmed for District 8 (UES mainland + Roosevelt Island) and District 11 (East Harlem mainland + joined Wards/Randalls Island). Districts 9, 10, and 12 confirmed single-part. All 12 districts now checked — closed.
- **Cross-borough street leakage near water**: confirmed and fixed for District 10 (Bronx streets near the Harlem River), District 11 (Queens/Bronx streets near the RFK/145th St/3rd Ave bridges), and District 12 (Bronx streets near Spuyten Duyvil/the Harlem River, 115 segments excluded) via the `boroughcode` filter. All 12 districts now checked — closed.
- **A smaller, still-unresolved cut-line artifact** (found while investigating
  v3.2.14's degenerate-segment fix, immediately below): a handful of small
  red dots remain visible along cut-line boundaries even after filtering out
  genuinely-degenerate (near-zero-length) segments, sitting at regular
  intervals right on an otherwise-continuous boundary edge -- confirmed real
  and NOT introduced by the v3.2.14 filter (reproduced against a fresh,
  completely unfiltered recompute first). Best working theory, not yet
  confirmed: many short segments from adjacent triangles converging at a
  single shared vertex (e.g. where several buildings' corners touch),
  rendering as a small but visible cluster due to overlapping line draws at
  that exact point -- but this wasn't verified the way the main v3.2.14 fix
  was, so treat it as a real hypothesis, not a diagnosis. Minor relative to
  the degenerate-segment issue (visible only on close zoom, not at normal
  viewing distance) -- worth a real investigation next time, not guessed at
  further this round.
- **CSG output is NOT fully watertight** (found v3.2.1, real STL export
  run through `trimesh`, an external mesh library — not this app's own
  claims). A small mold-boundary margin (v3.2.1) fixed part of it for
  Hudson Yards specifically (66→51 non-manifold edges) but made zero
  difference for Chelsea or Hell's Kitchen.
  Real footprint-erosion test (v3.2.2 investigation, not shipped): built a
  Node harness reproducing the app's real pipeline exactly (same
  project/extrude/union/difference code, real per-neighborhood data),
  eroding every building footprint inward via `CrossSection.offset()`
  before `Manifold.union()`, at 0.02/0.05/0.08/0.12m, then writing a real
  binary STL through the app's own `exportSTL()` dedup logic and
  re-checking it with `trimesh` at every value — the same tool and method
  that found the original defect, not a theory. Two real findings:
  (1) The prior "exact corner vertex" hypothesis was never actually
  verified — checked here directly, and the raw indexed Manifold mesh
  (pre-STL) is confirmed to have **zero** non-manifold edges at every
  erosion value tested, including zero erosion, for all three
  neighborhoods (`Manifold.difference()` returning `NoError` genuinely
  guarantees a manifold result, as the library's own name promises — the
  defect does not exist at that stage). The non-manifold edges only
  appear after STL export (an inherently indexless triangle-soup format)
  and `trimesh`'s own reload/re-weld pass, so the real mechanism is a
  precision/quantization artifact of that round-trip, not a genuine
  geometric coincidence between adjacent buildings' source data.
  (2) Given that, footprint erosion does NOT reliably reduce the
  post-export defect: it cut Hell's Kitchen substantially (114→9 edges at
  0.05m) and helped Chelsea somewhat (94→44 at 0.02m), but for Hudson
  Yards results were non-monotonic and inconsistent across the same
  erosion sweep (58/49/58/43 non-manifold edges at 0.02/0.05/0.08/0.12m,
  against a 44-edge baseline) — sometimes better, sometimes worse, with
  no erosion value that helped all three neighborhoods at once. Shipping
  an erosion value chosen to help two neighborhoods would be introducing
  a real (if tiny) footprint-accuracy tradeoff for an unreliable,
  unexplained benefit — not done. Root cause of the actual STL-export
  quantization defect remains open; still very likely low real-world
  impact (most slicers auto-repair a defect this small: 0.02–0.13% of
  edges across all tests), but the export should not be described as
  guaranteed watertight until the real mechanism is found.
- A handful of `building_part` sub-features (8 total across all three
  neighborhoods, see v3.1.6) still measure as geometrically thin by the
  same test used to catch the outbuilding/roof wedge bug, but are real
  sub-components of buildings that have actual substance (not
  freestanding wedges) and `building_part` doesn't carry the same
  `subtype`/`class` tags used to filter the top-level case. Not chased
  further yet — worth a look if a similarly odd shape gets reported
  again.
- More neighborhoods beyond Hudson Yards + Chelsea + Hell's Kitchen — the
  pipeline is proven (fetch, winding-correct, measure tilt, filter
  streets, add one `NEIGHBORHOODS` entry), so this is now pure
  per-neighborhood data work, not architecture work.
- Poché fill boundary line — actually resolved, see v3.0.37 (same fix as
  the cut-line scattered-dots symptom below).
- Cut-line "scattered dots" — resolved in v3.0.37 (EdgesGeometry replaced
  with an exact triangle/plane cross-section).
