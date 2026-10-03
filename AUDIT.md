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
   `inkn-q76z`). **As of v3.4.75, every real named street** (`full_street_name`
   not null) — no width cutoff; the original `streetwidth>=60` rule (from
   when this was a single citywide-then-trimmed embedded payload, v3.0.26)
   silently excluded Fifth/Park/Madison/Lexington Ave (54/44/46/50ft in this
   dataset) among others, and had outlived the payload-size reason it
   existed for once v3.1.1 moved to small per-district files. Tradeoff:
   the dataset's name field also covers some non-street features (park
   drives, bike paths, bridge/tunnel ramps) that the old width filter had
   incidentally screened out too — left in per Joe's explicit choice, not
   yet revisited. **As of v3.1.1**, fetched live per
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

**Handle geometry must be offset off the cut plane, base-flush, not
centered on it (found + fixed v3.2.27)**: `ConeGeometry` is centered on
its own local origin — half its height above, half below — so
positioning a handle's coordinate directly AT the cut plane along its
own drag axis (the original behavior since v3.0.11) always buried half
the cone inside the surface. Joe marked this up directly on a
screenshot: "base of cone should be on the face of the plane, not
submerged." The fix is NOT just a position offset — `xHandle`/`yHandle`
rotation (which way the tip points) was fixed at construction, always
toward +X/+Y regardless of `flipXCutaway`/`flipYCutaway`, which never
looked wrong before because the cone was symmetric about the plane
either way. Doing a position-only fix without ALSO making rotation
flip-aware would put the fix in the wrong direction on the flipped
side — tip flush with the plane, base floating in open air, i.e. the
identical bug relocated rather than fixed. Verify base/tip world-space
mapping by hand for every flip combination (4 for X+Y, plus Height
which has no flip control) before trusting cone-rotation math — this
project's `HANDLE_CONE_HEIGHT`-based offset in `syncHandlePositions()`
does that per-call, matching current flip state each time.

**Handles need a bigger visual cue than depthTest:false alone provides
(found + fixed v3.2.28)**: the cone handles already render with
`depthTest: false` (always on top, never actually hidden by geometry),
but Joe reported them getting "lost graphically... when submerged into
a lot of building forms." That's a legibility problem, not an occlusion
bug — a small cone against a visually busy, similarly-colored building
mass is hard to pick out even when technically always-visible. Fixed
with `heightGuideLine`/`xGuideLine`/`yGuideLine`: thin lines, same axis
color as their handle, same depthTest:false/high-renderOrder pattern,
spanning the FULL site extent (not just the cavity) on their own axis —
reads as a real reference line through the whole model, easy to trace
back to the handle regardless of clutter. Kept in sync with handle
position/visibility in the same two functions (`syncHandlePositions()`,
`refreshViewToggles()`) rather than a separate parallel update path.

**"Show cutaway handles" checkbox added, v3.2.29**: the same guide lines
that help in a dense district read as clutter in a flat N/S/E/W
elevation view (a line spans the FULL site extent, so at that camera
angle it can run the entire width of the screen) — Joe flagged this
directly off a screenshot. `showHandles` (module-level, default true)
folds into `handlesOn` in `refreshViewToggles()` alongside `showNegative`
and the section-row check, so toggling it off hides both the cones and
their guide lines together with one flag, no separate code path. Cutaway
VALUES stay fully adjustable while hidden — slider, number input, and
keyboard nudge (`activeCutawayAxis` tracking doesn't care whether the
handle mesh is visible) all still work; only dragging naturally becomes
unavailable, and only because the existing pointerdown hit-test already
filters to `.visible` handles, not because of anything new.

**Keyboard arrow-key nudging must not depend on DOM focus (found + fixed
v3.2.28)**: a focused `<input type="range">` already responds to arrow
keys natively — but Joe reported them working "then get stuck", which
traces to focus being lost the moment the 3D viewport is interacted with
(orbiting, dragging a handle) with nothing sending focus back to the
slider afterward. The fix is `activeCutawayAxis` (module-level, set by
clicking/focusing a cutaway row OR dragging its handle in the viewport)
plus one global `keydown` listener that nudges whichever axis is
currently active regardless of what element actually has DOM focus. A
genuinely-focused slider or number input still gets native browser
arrow-key handling first — the global listener explicitly early-returns
when `document.activeElement` is one of the app's own cutaway controls,
so there's no double-nudging, only a fallback for when focus has drifted
away entirely (the exact "gets stuck" case). Don't be tempted to fix
this by re-focusing the slider programmatically after every handle drag
instead — that fights the browser's own focus model and breaks the
moment any other interaction (clicking a different button, tabbing)
intervenes; tracking "which axis is logically active" independent of DOM
focus is the more robust fix.

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

**Cap-fill quads must be bounded on ALL sides by real site geometry, not
just the cut-corner side (found + fixed v3.2.25)**: `makeCapQuad()`
builds each quad 3x oversized relative to the site so it always covers
the exposed cross-section regardless of slider position (see the
`quadSize` comment in `buildCapFillGroups()`) — but each quad's
`restrictPlanes` originally only bounded the CUT CORNER side (the 2
axis-threshold planes, e.g. `[sectionPlaneNeg, yClipPlaneNeg]` for the X
quad), never the far sides. The far sides relied entirely on the quad's
own oversized-but-finite edge happening to fall outside whatever was
actually visible. That held at normal district zoom (the excess ran off
the edge of the screen) and was moot before v3.2.23 (`capFillGroups`
were force-hidden whenever Manhattan context was on) — so a small,
correctly-cut quad extending into a much larger surrounding context,
with nothing else hiding the excess, never had a chance to actually
happen until v3.2.23 correctly stopped hiding them. Confirmed live in
Joe's session (District 1, X=665m/Y=306m cutaway, Major streets +
Manhattan context on): the Z cap-fill quad rendered as a large floating
translucent plate hovering over the wider island — Joe's "red box
artifact" / ghosted-skyline report. Diagnostic note: `javascript_exec`'s
return-value channel (~1-1.5KB) was too small for the full scene-graph
dump needed to find this — used the DOM-write + `get_page_text`
workaround documented below instead. Verified the quads' clip planes
were numerically correct (`localClippingEnabled: true`, constants
exactly matching the slider values) before concluding the clip was
incomplete rather than broken — don't skip that check; an "unbounded on
the far side" bug and a "clipping silently not applying at all" bug
would look identical from a screenshot alone. Fixed with 4 new
persistent planes (`siteBoundMinX/MaxX/MinY/MaxY`, declared near
`sectionPlaneNeg`, kept in sync with `siteMinX` etc. in
`computeNegativeSpace()`) added to all three quads' `restrictPlanes` —
bounds every cap quad to the real site footprint on every side,
permanently and view-independently, rather than patching Manhattan
context specifically.

**Quad recompile-discards-uniforms bug, v3.4.26 — same class as negMat's
v3.4.11 fix, extended to the poché quads.** The active axis's quad
(`xQuadMat`/`yQuadMat`) has its `clippingPlanes` array rebuilt every time
`applySectionMode()` runs, and that array's PLANE COUNT changes whenever
a quad becomes (or stops being) the active axis — 3 planes for the
inactive branch, 2 for the active one. A plane-count change forces a
fresh `onBeforeCompile` on whatever frame renders next, which builds a
brand-new uniforms object and repoints `mat.userData.skyUniforms` at it
— discarding whatever `refreshActiveSectionProfile()` (called moments
later in the same function) had just written into the OLD object, since
the recompile is asynchronous relative to this function and can land
before the next paint. Symptom: entering any section view for the first
time shows the quad with `uSkyDiscardOn` stuck at its recompile default
(0 = no discard = fills solid, full local-ceiling height, ignoring the
real per-column roofline profile) — until any later threshold change
calls `refreshActiveSectionProfile()` again, by which point the
recompile has already happened and the write finally lands on the real
object. Fixed the same way `negMat` was in v3.4.11: a synchronous
`renderer.compile(scene, activeCamera)` — but the FIRST attempt at this
(v3.4.26) placed the call right after the quads' `clippingPlanes`
reassignment, still inside the `if (capFillGroups){...}` block, which is
ABOVE `refreshViewToggles()` in this same function. `refreshViewToggles()`
(via `refreshCapFillVisibility()`) is what actually sets the active
quad's `.visible = true` for the first time on a given axis — and
`renderer.compile()` skips invisible objects during its own scene
traversal, identical to a real `render()` call. So v3.4.26's compile
call was a no-op every time; the real first compile still happened
later regardless, and Joe's own screenshots (straight out of a fresh
box-draw-then-N/S, on a v3.4.26 build) proved it. **v3.4.27** moved the
call to run immediately after `refreshViewToggles()` instead — same
mechanism, same fix, just actually in effect this time. **This bug
class (plane-count change → deferred recompile → discarded uniform
write) has now hit three different materials in this file
(`negMat` v3.4.11, `capFillGroups` quads v3.4.26/27) — any FUTURE
material added to this scene that both uses `onBeforeCompile`-based
custom uniforms AND has its `clippingPlanes` array's LENGTH change at
runtime needs this same synchronous-compile treatment, not just a
`needsUpdate` flag — AND that compile call must run AFTER whatever sets
the material's mesh visible, not before, or it's silently a no-op.**

**v3.4.30 — a fourth instance, and the one Joe kept actually seeing.**
Even with v3.4.27's fix correctly in place, the quads' *sky-discard*
uniforms (`uSkyDiscardOn`, distinct from `clippingPlanes`) had their own
separate write ordering bug. `syncSectionSkyUniforms(axis)` — which sets
`uSkyDiscardOn = 1.0` for the active axis's quad — was called right
after the FIRST `renderer.compile()` in `applySectionMode()`, which only
settles `negMat`'s own clippingPlanes change. The quads' `clippingPlanes`
reassignment and `refreshViewToggles()`'s visibility flip both happen
AFTER that point, and the SECOND `renderer.compile()` (v3.4.27's fix)
settles the recompile those trigger — but nothing re-wrote
`uSkyDiscardOn` into whatever fresh uniforms object that second compile
produced. `uSkyDiscardOn` is the master switch for the ENTIRE discard
block in the fragment shader (`if (uSkyDiscardOn > 0.5) { ... if
(uSkyRoofDiscardOn > 0.5) {...} }`), so with it stuck at its recompile
default of 0, NEITHER the box-crop discard NOR the roofline discard ran
at all — the active quad rendered its full geometric extent solid,
regardless of `clippingPlanes` being perfectly correct. This is exactly
why the bug survived two rounds of fixing the plane-count trigger: the
plane-count fix was real and necessary, but this was a SEPARATE write
landing on the same doomed uniforms object via a different path. Live-
confirmed the mechanism on Joe's actual broken tab before touching code
— manually setting the live `uSkyDiscardOn` to 1 immediately fixed the
render with nothing else changed. Fix: moved the `syncSectionSkyUniforms(axis)`
call to run after the SECOND compile instead of the first — the same
principle `refreshActiveSectionProfile()` already used correctly for the
height-texture half of this same sync (call it after the state it
depends on has actually settled, not just after *some* compile call).
**Any uniform written by a function that runs between two
`renderer.compile()` calls in this file is written into a value that's
about to be thrown away — always call these AFTER the LAST relevant
compile, not the first one that happens to appear on the way there.**

## Section mode — a real architectural section for N/S/E/W elevation views (v3.2.30)

Joe: "I need the elevation to look like an actual section cut, currently
graphically it's a bit messy." Previously N/S/E/W were true flat
orthographic ELEVATIONS (see the camera system section below) — showing
the whole model from outside, which is architecturally a different
drawing type from a SECTION (a cut slice, everything nearer than the cut
removed). Clarified scope with Joe before building rather than guessing,
given real design ambiguity: (1) ghosted context behind the cut plane,
not hidden entirely — `negMat`'s existing 0.15-opacity translucent shell
already reads as "ghost," so this needed no change; (2) reuse the
existing Height/X/Y cutaway sliders rather than add a 4th dedicated
"section depth" control.

**The octant cutaway's stencil poché already computes the TRUE full
cross-section — the corner-only look is a separate, purely cosmetic
mask.** `createPlaneStencilGroup()` (see the Poché section above) tests
each axis's cut against the real, unclipped solid geometry, completely
independent of the other two axes. What restricts the visible result to
just the excavated octant corner is `restrictPlanes` on each quad's
material (and, separately, on each cut-line mesh's material) — a masking
step layered on top, not part of the stencil test itself. So a real
full-width section needed no new geometry, no new stencil pass: only the
ACTIVE axis's material-level restriction needed loosening.

**`sectionModeAxis`** (`'x' | 'y' | null`) tracks which axis is the
current section plane — `'y'` for N/S views, `'x'` for E/W, `null` for
Plan or the perspective camera. Set in `setOrthogonalView()`, cleared in
`recenterCamera()` (Home always exits section mode). `applySectionMode(axis)`
does the actual work:
- `negMat.clippingPlanes` becomes JUST the one matching plane
  (`xClipPlane` or `yClipPlane`) instead of the normal 3-plane octant
  intersection — a genuine full section on that axis, `clipIntersection`
  irrelevant with one plane.
- The active axis's poché quad AND cut-line mesh both drop their
  octant-corner restriction (`sectionPlaneNeg` + the perpendicular axis's
  `*ClipPlaneNeg`), bounded instead only by `SITE_BOUND_PLANES` (v3.2.25)
  — both were already computed against the full real geometry, so this
  is the exact same fix shape applied to two different mesh types.
- The INACTIVE axis (and Plan/perspective) get their original
  octant-restricted `restrictPlanes` back untouched.

**Height Cut is deliberately EXCLUDED from the section-mode clip — this
was a real bug caught before shipping, not after.** An earlier version
of this unioned Height Cut into the clip too (`clippingPlanes: [axisPlane,
sectionPlane]`, `clipIntersection: false` — removed if past EITHER
threshold), reasoning that "reuse existing sliders" might mean all three
staying simultaneously active. But Height Cut's default/reset value is 0,
and `sectionPlane` keeps only `z<=constant` — unioning it in at that
default would clip away the ENTIRE building above ground on every fresh
section view, defeating the feature by default rather than starting from
a clean full section. Caught by re-deriving what `sectionPlane.constant`
actually equals at the slider's own default before shipping, not just
trusting the "reuse sliders" framing literally. Height Cut and the
perpendicular (non-view-direction) axis simply have no effect on the
shell while in section mode; if a future request wants Height Cut to
also trim a section, that needs to be a deliberate, explicit toggle, not
folded into the default union.

**Must re-run after every recompute.** `buildCapFillGroups()` and
`buildCutLineMeshes()` both rebuild their meshes' materials from scratch
on every compute, with the normal octant `restrictPlanes` — if a
recompute happens while a section view is already active, the freshly
built meshes would silently revert to corner-only unless
`applySectionMode(sectionModeAxis)` runs again afterward. It's called at
the end of `computeNegativeSpace()`, after BOTH rebuild calls (it touches
meshes from each, so it can't run between them).

**Real regression, v3.2.31: `applySectionMode()` must use
`negativeMesh.material`, never `negMat` directly.** `negMat` is a `const`
declared LOCAL to `computeNegativeSpace()` — `applySectionMode()` is a
separate top-level function, and referencing `negMat` there threw
`ReferenceError: negMat is not defined` on every call. Since this
function is called from INSIDE `computeNegativeSpace()` itself (the
re-apply-after-recompute call above), that uncaught error aborted
`computeNegativeSpace()` mid-execution — silently skipping everything
after it, including the line that reveals `#sectionRow`. Symptom in the
UI: "control handles are missing" (Joe's exact words) — but the real
failure was much bigger than the handles specifically; the ENTIRE
cutaway panel never appeared, because compute() itself never finished.
This is the same failure shape as v3.0.37's near-identical case
(documented in the Section cut-line section below) — an uncaught error
partway through `computeNegativeSpace()` leaves whatever ran BEFORE the
throw visibly working (buildings/stats/negativeMesh all render fine),
which makes the bug look smaller and more specific than it is. **Found
via `read_console_messages`, not guesswork or re-reading the code
harder** — the stack trace pointed directly at the exact line. When a
"some UI element is missing" report doesn't match a targeted code
read, check the browser console for an uncaught error before assuming
the described symptom is the actual scope of the bug. Fixed by using
`negativeMesh.material` (the exact same object — `negativeMesh = new
THREE.Mesh(cleanedGeo, negMat)` — but module-level and reachable from
outside `computeNegativeSpace()`) instead of `negMat`. When adding a
NEW top-level function that reads state set up inside
`computeNegativeSpace()`, verify each referenced variable is actually
declared at module scope, not just check that the name exists
somewhere in the file — `negMat`, `cleanedGeo`, and other `const`s
declared with `computeNegativeSpace(){ const x = ... }` look identical
to a real module-level `const` at a glance, but aren't reachable the
same way.

**Real graphical bug, v3.2.32: the active axis's quad/cut-line must
KEEP `sectionPlaneNeg`, only drop the PERPENDICULAR axis's plane.**
v3.2.30 dropped `sectionPlaneNeg` from the active quad/cut-line
entirely, reasoning (mistakenly, by pattern-matching to the negMat fix
right above it in the same function) that it carried the same "Height
Cut defaults to 0" destructive-default risk. It doesn't — that risk is
specific to `negMat`'s `clipIntersection:false` UNION semantics
(removed if past EITHER threshold); a quad's `restrictPlanes` is an
ordinary AND-ed bound with no union interaction, identical to how every
OTHER axis's poché quad has always used `sectionPlaneNeg`. Symptom,
caught by Joe from a screenshot: a stray gray band floating above the
skyline, and a red band along the ground that ignored Height Cut
entirely — both are the quad's full 3x-oversized raw height (v3.2.25)
rendering completely unbounded once its one remaining vertical
constraint was removed. Lesson: two clip-scope fixes living in the same
function, solving genuinely different problems, can look like the same
pattern and don't automatically transfer — re-derive the actual risk
for each site rather than applying an adjacent fix's reasoning by
proximity. Also added `sectionPlaneNeg`/`xClipPlaneNeg`/`yClipPlaneNeg`/
`SITE_BOUND_PLANES`/`sectionModeAxis` to the `window.__NS` debug hook —
this specific bug lived at a level the hook didn't expose before (shell
clipping was checkable, quad/cut-line restrictPlanes weren't), which is
part of why it wasn't caught live before the first ship.

**Real graphical bug, v3.2.33: the INACTIVE axis's quad/cut-line must be
HIDDEN in section mode, not just left with its old restrictPlanes.**
v3.2.30/32 correctly re-bounded the ACTIVE axis's quad into a true full
section, but never addressed the OTHER (perpendicular) axis's quad at
all — it kept rendering fully visible with its old octant
`restrictPlanes`, and since its stencil test runs against the real
geometry completely independent of section mode, it kept showing its
own genuine poché wherever real solid happened to cross ITS OWN
threshold. Confirmed directly via the debug hook before writing the fix
(not guessed): `sectionModeAxis: "y"` (an N view) but
`capFillGroups.x.visible: true` — with the X cutaway slider sitting at
an extreme site-edge value, that's exactly enough real building edge
crossing the plane to render a second, visually disconnected poché
rectangle, with a real gap between it and the true section (Joe's
screenshot: two red rectangles side by side). Fixed in
`refreshCapFillVisibility()`/`refreshViewToggles()` — the existing,
single owners of all cap-fill/cut-line visibility — by making both
check `sectionModeAxis`, showing only the matching axis's quad while a
section view is active. `applySectionMode()` now calls
`refreshViewToggles()` itself at the end so this actually takes effect
on every transition, rather than relying on some OTHER code path to
happen to call it afterward.

**Running tally for this feature: v3.2.30 (shipped) → v3.2.31 (my own
scoping bug) → v3.2.32 (my own reasoning-by-proximity bug) → v3.2.33
(a real gap in what v3.2.30 covered in the first place).** Section mode
touches negMat's shell clip, two quads' restrictPlanes, two cut-line
meshes' restrictPlanes, AND now visibility across four objects — a
genuinely wide surface area for a single feature. Before touching this
code again, re-read the whole `applySectionMode()` function in one pass
and check each of clippingPlanes / restrictPlanes / visible is handled
consistently for BOTH the active and inactive axis, rather than fixing
one reported symptom and assuming the rest was already right.



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

**`zCutLineMesh` visibility gating, v3.4.25.** `xCutLineMesh`/
`yCutLineMesh` (the true per-building CSG cross-section outline) were
retired back in v3.4.11/14 — always `.visible=false` now, fully
superseded by `skylineProfileLine`. `zCutLineMesh` is the same kind of
mesh for the Height axis, and is genuinely still used (Plan/perspective
view), but its visibility rule was never updated to match: it stayed
`showNegative` with no `sectionModeAxis` check, so it kept rendering
EVERY building's real ground-level (Height Cut) cross-section across
the full site width even while locked into an N/S/E/W elevation, where
Height is inert. At district scale that reads as a dense band of red
noise at street level, unrelated to whichever axis is actually being
adjusted. Now `showNegative && sectionModeAxis === null` — same
suppression rule the other two already had, just applied to the third
axis. `refreshViewToggles()` (which owns this line) already reruns via
`applySectionMode()` on every view switch, so no other wiring changed.

## Panel consolidation / IA redesign phase 1 (v3.4.34)

Joe: the workflow was scattered across three places -- neighborhood/
compute in the left `#controls` panel, view-switching in the right
`#navPanel`, and the box-draw direction picker in a THIRD, temporary
floating panel (`#planBoxPanel`) that only existed mid-workflow. Getting
from "just computed" to "looking at a cropped elevation" meant bouncing
left → right → drag in the viewport → right again → right again for
Advanced controls.

**Approach**: relocate, don't rebuild. Every moved element
(`navHome`/`navPlan`/`navN`/`navS`/`navE`/`navW`, `drawBoxBtn`,
`planBoxPanel` and its own `boxViewN/S/E/W`/`boxCancelBtn`) kept its
exact `id` and every existing event listener untouched — only DOM
position and CSS changed, into a new `#exploreExtras` wrapper inside
`#controls`, gated at the same two toggle points `#sectionRow` already
used (shown once a compute has run, hidden on district switch).
`updateCurrentViewIndicator()` (v3.4.33) needed no changes since it
already looks buttons up by id. `positionPlanBoxPanel()` — which used
to anchor the floating panel to `#navPanel`'s own
`getBoundingClientRect()` — is now a documented no-op; an inline block
just flows in the document. `#navPanel` still exists, now holding only
the compass rose + `#currentViewLabel` as a spatial-orientation
reference, not the primary way to switch views.

Manhattan-context/Major-streets and Export moved into native
`<details class="accordion">` elements, collapsed by default — no new
JS, the browser's own disclosure widget, styled to match `.label`'s
existing uppercase/letter-spaced convention.

**This was preceded by an approved mockup** — a standalone interactive
HTML artifact using the real dark "Blueprint" palette/fonts, built and
shown to Joe *before* any of the real 5000-line file was touched.
Worth repeating for any future IA-level change to this file: a
throwaway mockup is cheap; restructuring working DOM/JS wiring blind
is not.

**Verification for a structural change looks different from the
live-browser-uniform-state method used for every rendering/uniform bug
this session** — this can't be diagnosed by reading a shader uniform,
and it can't be pushed to Joe's server directly. What was actually
checked before shipping: a duplicate-`id` sweep across the whole file;
a reverse check that every `getElementById()` call in the script still
resolves to a real element; a jsdom-based structural test confirming
the real parent/child relationships (not just trusting the source
read); and the full pre-existing `audit_deploy.js` suite passing
unchanged. **None of that is equivalent to clicking through the real
thing in a browser** — say so plainly rather than implying it's been
proven the way a live-verified rendering fix has been.

## Panel consolidation / IA redesign phase 2 (v3.4.66-68)

**Redundant controls, not new features.** Three small, independent
follow-ups from Joe's screenshots, none touching rendering/geometry:

- **v3.4.66**: the top View compass's N/S/E/W and the box panel's own
  "Box drawn — view it from:" N/S/E/W were doing the exact same thing —
  `goToDirection()` (the compass's handler) has forwarded to
  `applyPlanBoxDirection()` whenever `pendingPlanBox` is set since the
  v3.4.40 fix (see the box-draw section below), just never surfaced as a
  visible duplication until Joe's screenshot showed both sets stacked.
  `setCompassDirectionsVisible(visible)` hides/shows just `navN/S/E/W`
  (never `navHome`, a genuinely different action) — called `false` the
  moment `planBoxPanel` shows, `true` in `cancelPlanBox()` (covers both
  Cancel and a direction actually being picked, since
  `applyPlanBoxDirection()` calls `cancelPlanBox()` once it's done).
- **v3.4.67**: Units (Metric/Imperial) only ever affects the Advanced
  tab's slider labels/values — confirmed back at v3.4.35, just gated
  behind a compute (`#exploreExtras`) rather than behind the specific
  tab that reads it. Relocated to the top of `#advancedCutawayControls`
  itself. Pure DOM move, same ids/listeners.
- **v3.4.68**: `navHome`'s tooltip said "Recenter," but `recenterCamera()`
  (its handler) does more — `activeCamera = camera` switches back to the
  perspective camera and undoes whichever locked N/S/E/W/Plan
  orthographic view is active, on top of the actual fit-to-bounds. Text
  fix only (`title="Home (3D view)"`), already correctly labeled
  `'Perspective'` in `VIEW_LABELS` internally (v3.4.33).

**Stale-check maintenance, not new risk**: v3.4.67's move broke two
pre-existing v3.4.34 audit checks and one v3.4.35 check that used
`<p class="label">Units` as a text boundary/anchor for unrelated
assertions (the nav-compass and `planBoxPanel` DOM-nesting checks) — all
three re-pointed at stable anchors rather than weakened or dropped; see
`audit_deploy.js`'s own v3.4.67 section comments for the specifics. Same
thing happened once already at v3.4.65 (a `cancelPlanBox()` length-window
check) — worth remembering any time a change touches DOM/code a nearby
check happens to string-match against, even unintentionally.

## Plan-view box-draw section workflow (v3.4.0)

**Plan itself never respected a drawn box until v3.4.28 — a real, separate
gap, not the same bug as anything above.** Everything below this heading
concerns what an N/S/E/W elevation shows once a box is active. Plan view
is a completely different code path: `setOrthogonalView('plan')` and
`resetToDefaultView()` both pass `axis=null` to `applySectionMode()`,
and for `axis===null` that function has ALWAYS meant "ignore
`activeSectionBox` entirely, restore the plain octant (dollhouse-corner)
cutaway" — `negMat.clippingPlanes = [sectionPlane, xClipPlane,
yClipPlane]; clipIntersection=true`, three independent half-spaces
AND-ed together, geometrically nothing like a box. So a box drawn and
committed to an elevation would center `xThreshold`/`yThreshold` on the
box's own midpoint (correct, per `applyPlanBoxDirection()`), but going
back to Plan reused those same recentered VALUES inside the totally
different corner-cutaway INTERPRETATION — same numbers, unrelated
shape, which is exactly what made Joe's screenshot look like "close but
not even close": a large corner region sharing a coordinate or two with
the box, nothing else. Confirmed live via `window.__NS` before touching
any code (`activeSectionBox` held the real box the whole time;
`negMat.clippingPlanes` were the 3-plane corner regardless) — see
v3.4.28's CHANGELOG entry for the full mechanism and the live-verified
fix. A second, independent bug compounded this: `capFillGroups.z` (the
Height-cut cap quad, the actual visible poché fill in Plan) had its
`clippingPlanes` set ONCE in `buildCapFillGroups()` and never rebuilt
anywhere after — confirmed by grep, no other reference in the file — so
even the corner-vs-box fix alone wouldn't have moved what was actually
on screen.

**Fix shape**: `applySectionMode()` gained an `isPlanView` boolean param
(→ module flag `isPlanViewActive`) because `axis===null` alone can't
tell Plan and the free perspective/Home view apart — both need it, and
only Plan should ever box-scope. When `isPlanViewActive &&
activeSectionBox`, `negativeMesh`, `buildingMat` (via
`syncBuildingClipping()`, given the same param), and the Z cap quad all
switch to `getPlanBoxClipPlanes()` — a real two-sided rectangle from the
box's own `xMin/xMax/yMin/yMax`, AND-ed, plus the existing Height Cut
plane. Free perspective/Home passes `isPlanView` as its default
`false`, so it's byte-for-byte the same corner cutaway it's always
been. The existing "Full width" button (previously wired only for a
locked N/S/E/W view) now also covers Plan as the "extend" option —
`clearActiveSectionBox()`'s old guard (`if (sectionModeAxis)`) silently
no-op'd there since `sectionModeAxis` is always null in Plan; now also
checks `isPlanViewActive`.

**v3.4.29 correction**: the Z cap quad's own clippingPlanes rebuild
(mentioned above) originally lived in the unconditional `if
(capFillGroups){...}` block further down in `applySectionMode()` — which
runs on EVERY call, not just when `axis===null`. Since the box-scoped
branch is 10 planes and the fallback is 8, that meant leaving Plan for
any locked N/S/E/W elevation (with the same box still active) silently
changed this quad's clip-plane COUNT on every transition — the exact
deferred-recompile-discards-uniforms trigger already fixed twice before
for `negMat` (v3.4.11) and the x/y quads (v3.4.26/27), reintroduced
fresh for a third material by v3.4.28 itself, in the same session it
shipped. Moved into the `axis===null` branch alongside `negMat`'s own
box-scoping, where it belongs — the Z quad has no relationship to
N/S/E/W at all. **Any future addition to this function should live in
the SAME branch as the state it depends on (`axis===null` for
Plan-only concerns, the per-axis branches for elevation concerns) —
touching a material's clippingPlanes unconditionally, "just to be
safe," is exactly how this happened.**

A second, more direct way to set the SAME inputs the section engine
(above) already takes — which slab (cut-axis depth) and how wide a crop
(plotted-axis width) — by drawing a rectangle in Plan view instead of
dialing the Height/X/Y sliders. Doesn't replace v3.3.0's engine; feeds it.

**`getSectionRanges(axis)`** is the single function both
`refreshActiveSectionProfile()` and `applySectionMode()`'s sky-uniform
setup read from — the one place that decides what range is in play, so
the profile texture that gets built and the shader that samples it can
never disagree. Returns `{ plotLo, plotHi, slabLo, slabHi }`:
- No box drawn (`activeSectionBox === null`): reproduces the exact
  v3.3.0 behavior — `plotLo/plotHi` span the full site on the plotted
  axis, `slabLo/slabHi` are a fixed `±SECTION_SLAB_HALF_WIDTH` (2m)
  around the live `xThreshold`/`yThreshold`.
- Box active: `plotLo/plotHi` come directly from the box's own bounds on
  the plotted axis (the crop). `slabLo/slabHi` are centered on the LIVE
  threshold with the box's own extent as the width — this is
  deliberate, not an oversight: it's what makes the sliders still useful
  after drawing a box (see below), rather than freezing the cut at
  wherever it was drawn.

**`buildSectionProfile()`'s signature changed** from a single
`cutThreshold` to explicit `slabLo`/`slabHi`, so it can express an
arbitrary-width slab (the box's real extent), not just a fixed one
centered on a point. The one call site (`refreshActiveSectionProfile()`)
was updated to pass `getSectionRanges()`'s output through.

**Genuinely cropping the visible width needed a real shader change, not
just a smaller texture domain.** The sky-discard fragment shader
(`addSkyDiscard()`) previously *clamped* world position to `[uSkyLo,
uSkyHi]` before sampling the height-profile texture — meaning anything
past that domain kept re-sampling the nearest edge column forever, so a
poché/skyline built from a cropped-range texture would still render
(using stale edge data) everywhere outside the box, silently ignoring
the crop entirely. Added a `uSkyCropOn` uniform: when on, the shader
hard-discards any fragment with `freeCoord < uSkyLo || freeCoord >
uSkyHi` before the clamp/sample even runs. Off by default (the plain
v3.3.0 case, where clamping to the site edge is exactly the desired
behavior, not a crop) — only set to `1.0` in `applySectionMode()`/
`makeCapQuad()`'s `applySkyConfig()` when `activeSectionBox` is set.

**Screen-to-world unprojection** (`screenToWorldGround()`) reuses the
same raycaster pattern the cutaway-handle drag listeners already use —
`Raycaster.setFromCamera()` against `activeCamera`, intersected with a
`z=0` plane. Valid regardless of camera roll/angle because Plan is a
genuine top-down orthographic view (v3.1.2/v3.0.42) — no new camera math
needed, this is exactly the same technique `attachHandleDragListeners()`
already established for the 3D drag handles.

**Camera framing** (`setOrthogonalView()`): when `activeSectionBox` is
set and the requested direction is N/S/E/W (never Plan/Home), the
target/span computed by `currentTargetAndSpan()` are overridden with the
box's own center and extent — the point of drawing a box is to see just
that block, not a full-width elevation with it buried in the middle of
the frame.

**Sliders stay live after drawing a box, deliberately.** Because
`getSectionRanges()` reads the box's WIDTH but the LIVE threshold for
the slab's CENTER, dragging X/Y (or E/W's flip buttons, etc.) after
drawing a box translates the slab while keeping its drawn depth — matches
the box "setting" the sliders rather than replacing them outright. The
crop (plotted-axis width) does NOT move with the slider — it stays fixed
to what was drawn until cleared via the "Full width" button
(`clearActiveSectionBox()`, sets `activeSectionBox = null` and re-runs
`applySectionMode(sectionModeAxis)` to restore the v3.3.0 default).

**Reset on neighborhood switch.** `activeSectionBox` is cleared in the
same block that resets `siteMinX`/`siteMaxX`/etc. in `loadData()` — box
coordinates are specific to the previous district's real geometry and
would silently misbehave (or reference empty areas) against a newly loaded
site otherwise.

**Live-verified (v3.4.1) against Joe's real running session, in the
Compute → Negative space ON → draw box → pick direction order**: the
unprojection lands a clean world-space rectangle, the crop visibly
narrows the skyline silhouette to the drawn box's width (not just the
slab depth), the direction popup positions correctly relative to
`navPanel`, and the caption/grayed-row/Full-width-button state all match
`activeSectionBox`. Two real bugs surfaced from testing OTHER orderings,
both fixed in v3.4.1 (see CHANGELOG's v3.4.1 entry for the full story):
(1) drawing a box and picking a direction BEFORE ever running Compute
divided by an `undefined siteCapHeight`, producing a NaN camera position
and a silently blank viewport with no console error -- fixed by gating
both the camera-framing override and `setBoxDrawMode()`'s own entry
point on a compute having actually run; (2) entering a section view
BEFORE toggling "Negative space" on meant the ghost/poché shader's
`onBeforeCompile` hadn't fired yet, so the sky-discard uniforms silently
never received the section/crop state once the shader did finally
compile (on the later visibility toggle) -- fixed by extracting the
uniform-push into `syncSectionSkyUniforms()`, callable both on axis
change and from `refreshViewToggles()` when visibility flips on mid-
section-view. The v3.4.1 fixes themselves are not yet re-confirmed live.

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

**Lighting: `sun` (perspective) vs `orthoLight` (N/S/E/W/Plan), v3.4.24.**
The scene has always had exactly one `DirectionalLight` (`sun`), fixed at
world position `(400,300,700)`. That's invisible in the free-orbiting
perspective view — you naturally orbit toward whichever side happens to
be lit — but every locked N/S/E/W elevation shows exactly ONE fixed
facade, and `sun`'s fixed direction lights north/east-facing walls while
leaving south/west-facing walls at ambient-only. Confirmed by hand: with
`L = normalize(400,300,700) = (0.457,0.343,0.820)`, the wall shown in N
view (normal `(0,-1,0)`) gets `N·L=-0.343`; E view's wall (normal
`(-1,0,0)`) gets `N·L=-0.465` — both negative, both read as flat black.
S/W read positive and looked fine, which is why only N had been
reported before E also would have been.

Fix: a second `DirectionalLight`, `orthoLight`, created hidden alongside
`sun`. `updateOrthoLight(direction, target, camDist)` (called at the end
of `setOrthogonalView()`) repositions it on the SAME side as whichever
elevation camera is active, so the visible facade is always front-lit —
same technique as a camera-mounted headlight, just swapped in only for
N/S/E/W/Plan rather than tracking free orbit continuously.
`setOrthogonalView()` sets `sun.visible=false; orthoLight.visible=true`
on entry; `resetToDefaultView()` sets it back on the way to perspective.
`sun` itself is never modified — the established default-view look is
unchanged. **If a future light is added to the scene, remember there are
now two lights that need to swap together, not one to just retune.**

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

**The Manhattan ground plate must include Randalls/Wards Island and
Roosevelt Island as their own separate rings, not just the mainland
(found + fixed v3.2.26)**: `boroughsData`'s "Manhattan" entry (the
`<script id="boroughsData">` JSON) used to be a single flat ring tracing
only Manhattan Island's own mainland coastline. Randalls/Wards Island
(District 11) and Roosevelt Island (District 8) are legally part of
Manhattan borough but are physically separate landmasses a single ring
can't represent, so their real buildings — correctly positioned in
real-world space — had no land drawn under them at all in Manhattan
context, reading as floating in open water (Joe's report, District 11).
Confirmed the building data itself was never wrong before touching any
code: pulled District 11's real building lat/lon bounds directly and
cross-checked them against Randalls/Wards Island's known real-world
center — matched exactly. Confirmed the OTHER thing Joe flagged in the
same screenshot (a coastline notch near the Harlem River mouth) was
real, correct geography, not a bug, by inspecting the ring's own points
in that area before assuming it needed fixing.

Fixed by fetching both islands' real coastlines from OSM's Overpass API
via the connected browser session (the sandbox itself can't reach
general internet — same reason NYC Street Centerline is fetched this
way, see the pipeline gotchas). Each island is an OSM multipolygon
relation assembled from several ways (6 each here); stitch them into a
single closed ring by repeatedly matching the current ring's tail
against the nearest remaining way's head OR tail (reversing if it
matched the tail), and verify with a zero-distance closure check before
trusting the result — do this for ANY new OSM-sourced ring, not just
these two. Roosevelt Island's OSM relation name collides with two
unrelated islands (Antarctica, Virginia); disambiguate by wikidata id,
not name alone (`Q909777` here). `boroughsData`'s Manhattan entry is
now an ARRAY of rings (mainland first, then each additional island) —
`buildBoroughsLayer()` accepts either the old flat-ring format or the
new array format (checks whether the first element is itself an array),
and extrudes every ring as its own independently-positioned piece of
the same Manhattan group, so island buildings now sit on real land the
same way mainland buildings do. This same pattern (array-of-rings, one
extruded piece per ring) is the template for adding any further
non-contiguous NYC islands later (Mill Rock, Governors Island, etc.) if
a future district needs one.

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
- **The GitHub repo (`JoeK212/Negative.Space`, deployed via Netlify to
  `negativespace212.netlify.app`) is a SEPARATE deployment target from
  `localhost:8888`, and can drift far out of sync with it** — discovered
  2026-08-19 when Joe reported a fix as "not fixed" and the real
  explanation turned out to be that the public Netlify site was still
  running a single-neighborhood "Hudson Yards" build from before the
  entire 12-district system existed (pre-v3.2.7), months of work behind
  local. Every deliverable handed off via `present_files` (the full-repo
  zip, `negative-space-vX_Y_Z-full.zip`) is for Joe to unzip and
  overwrite his ENTIRE repo with, including `data/` — there is no
  "just update index.html" shortcut for a GitHub/Netlify push the way
  there sometimes might seem to be for localhost, because the repo may
  not have current district data at all. **As of the v3.2.24 handoff
  (2026-08-19), Joe confirmed the GitHub repo now has the current
  `index.html` and all 12 districts' real `data/` folders, matching
  localhost.** Going forward: don't assume the GitHub/Netlify copy is
  current just because localhost is — ask, or check the live Netlify
  URL's footer version / neighborhood list directly (`negativespace212.netlify.app`,
  fetchable via `web_fetch`) before assuming it reflects recent work.
  If Joe reports a bug "still" present after a fix was shipped, check
  which deployment he's actually looking at before re-diagnosing the
  same code path — this exact confusion cost real time on 2026-08-19.
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

- **A "reset UI state" line placed at the TOP of an async function runs
  synchronously on every call, including before that function's own first
  `await`.** Found live (v3.2.42): `loadData()` force-reset
  `computeBtn.disabled = false` as its first UI-touching line, predating
  `switchNeighborhood()`'s v3.2.41 race guard, which disables `computeBtn`
  immediately before calling `await loadData(id)`. The reset ran on entry,
  before `loadData()`'s own `await fetch(...)`, and silently undid the
  guard for that one button only — reopening the exact race v3.2.41 closed,
  worse than before since a Compute click in that window ran against the
  previous district's still-live data with no error and no visible tell.
  When adding a guard that wraps an `await`-ing call, check the callee's
  own body for anything that touches the same guarded state before its
  first `await` — a guard set right before the call is not proof the
  callee can't undo it partway through.

- **A "looks plausible at default settings" profile can hide a total lack of
  position-dependence for an entire session.** v3.2.39's skyline silhouette
  looked like a real architectural section for two full sessions (v3.2.39
  through v3.2.43) because it was only ever tested right after Compute, when
  the cutaway sliders sit at their default (near-center) position and the
  static citywide envelope happens to resemble a plausible section there.
  The gap (zero depth-dependence) only became visible once Joe actually
  dragged the slider far from that default and compared before/after. When
  a feature claims to respond to a live control, verify by moving the
  control to an EXTREME value and diffing the result, not just confirming
  it renders something reasonable-looking at the default.

## Open / not yet started

- **Intermittent N/S/E/W rendering bug (no box drawn) — still unconfirmed
  either way.** Long-standing item: solid unclipped block / flat-empty
  skyline / stray band, last confirmed recurring by Joe on his own
  machine as of v3.4.47, despite `enforceSectionRenderState()`'s per-frame
  self-healing mitigation looking structurally sound on code review.
  Investigating this (Joe's ask) surfaced a real, different bug in the
  BOX-DRAWN case instead — `capQuadBounds()` wasn't box-aware, fixed
  v3.4.107 (see condensed history below) — but that fix is scoped
  specifically to `activeSectionBox` being set; the classic no-box
  symptom's own code path (`flipYCutaway`/`yThreshold`/site-wide) is
  untouched. Genuinely unknown whether v3.4.107 was actually the same
  bug wearing a different hat, or two separate things that happen to
  look similar (both are "N/S/E/W renders something clearly wrong").
  Needs a live repro of the CLASSIC case — no box ever drawn, just
  toggling N/S/E/W and/or dragging the cutaway sliders repeatedly — to
  know if it's still real.

- **Pre-compute cutaway thresholds aren't site-relative, v3.4.105.**
  Buildings-only N/S/E/W/Plan nav now applies the same octant clip
  Buildings gets everywhere else (see the condensed history below), but
  `xThreshold`/`yThreshold` sit at their literal `0` init value until a
  slider is touched or a real compute seeds them from site bounds (both
  paths still gated behind Compute) — so the pre-compute octant cut isn't
  necessarily centered on the site in any meaningful way. Cosmetic, not a
  blocker. `minX`/`maxX`/`minY`/`maxY` are already computed straight from
  `buildingsGeo.features`, independent of the CSG step (confirmed
  live-checking this exact question) — a lightweight pre-compute
  site-bounds pass could seed real thresholds if this needs fixing later.

- **Shareable URL state, v3.4.104** — district + Height/X/Y cutaway +
  flips + which layer(s) round-trip through the URL via
  `syncUrlFromState()`/`applyUrlState()`, plus a Copy link button.
  Camera view/orientation and a drawn box deliberately not included yet
  (real additional scope — box-drawn state + `setOrthogonalView()`'s
  framing math). Not yet live-tested end to end — needs an actual reload
  + a real round-trip (change values, copy link, open fresh, confirm it
  matches).

- **First UI/UX audit pass, v3.4.103** — Joe asked for a gaps/redundancies
  review of the actual shipped panel. Fixed the two lowest-risk items:
  min/max endpoint labels under each cutaway slider (read directly from
  each slider's own attributes, no second copy of site bounds), and
  renamed "Reset cutaway" to "Recenter cutaway" since it sat next to
  "Full width" and both read as a generic undo. Two bigger findings, at
  the time not yet started: full navigation (View compass, Draw section
  box, Display) gated behind a Compute a Buildings-only user doesn't
  need, since buildings already render pre-compute (fixed v3.4.105 for
  the View compass/N/S/E/W/Plan nav itself — Draw section box is
  unaffected, still correctly requires real site bounds); no
  configuration (neighborhood, cutaway, view) lives in the URL, so
  nothing can be shared or returned to directly (fixed v3.4.104, minus
  camera/box state).

- **Docs/tooltips updated for v3.4.93-101, v3.4.102** — audited every
  tooltip, the help modal, and EXTENDED.md against real shipped behavior.
  Fixed a genuinely stale claim ("fill instead of hollow outline" as an
  absolute — contradicted by v3.4.99's coverage-based outline switch) and
  an outdated technical explanation (stencil-buffer troubleshooting notes
  that no longer apply to buildings' own caps, real geometry since
  v3.4.93). Documented three previously-undocumented behaviors:
  Negative-space-on auto-exposing Advanced+Display (v3.4.97), Home
  clearing an active box (v3.4.94), the first-run hint no longer being
  localStorage-permanent (v3.4.100).

- **Export relocated to panel bottom, v3.4.101** — Joe's call that Export
  is secondary to the tool's actual point. Moved from right after Display
  (v3.4.38's placement) to genuinely last in `#controls`, after Height/X/Y
  Cutaway, Flip X/Y, Reset cutaway, and Section fill (poché). Still gated
  behind the same `#decisionStage` resolve, just relocated within the
  gated area. Pure DOM move — no ids/listeners touched.

- **First-run hint disappeared for returning users, resolved v3.4.100** —
  v3.4.22 permanently dismissed `firstRunHint` via `localStorage` the
  first time Compute was ever clicked, for every future session on that
  browser. Meant a returning user opened the page with no explanation of
  the Compute button left at all. `ns_computedOnce` removed entirely —
  `computeNegativeSpace()` still hides the hint for the rest of the
  current session once it succeeds, but every fresh page load now shows
  it again regardless of history.

- **Large poché caps read as overwhelming, resolved v3.4.99** — Z's own
  cap (Height Cut) is unconditionally the full site rectangle whenever
  shown (its restrictPlanes dropped the other two axes in v3.4.88), so
  the fill covered the entire view at any Height Cut. `capQuadBounds()`
  now computes each cap's real rectangle + a 0-1 coverage ratio directly
  from existing state (every cap constraint is a single axis-aligned
  half-plane, so no polygon-clipping needed); `refreshCapFillCoverage()`
  switches from a filled quad to a thin outline once ratio exceeds 0.5,
  live as thresholds change. Scoped to negative space's own poché for
  now — buildings' charcoal cap uses a different technique and wasn't
  touched.

- **Cutaway handles read as faint/transparent, resolved v3.4.98** — never
  actually transparent (opacity always 1), but `MeshStandardMaterial` is
  lit, so its rendered brightness varies with the angle each face catches
  the scene's lights at — a handle facing away from the light reads dim
  against a busy, already-translucent scene. Switched to unlit
  `MeshBasicMaterial`: renders the handle's pure, saturated axis color
  every time regardless of lighting. `depthTest:false` and the colors
  themselves unchanged; `setHandleHighlight()` needed no changes
  (`MeshBasicMaterial` has the same `.color` property).

- **Negative space on now exposes Advanced + Display, v3.4.97** — a flat,
  uncut void shell didn't show much on its own; turning Negative space
  on (either the toggle or the "See the void" onboarding card, both
  funnel through `viewNegative`'s click handler) now also calls
  `setUiMode('advanced')` and opens the Display `<details>` accordion
  (gave it an id, `displayAccordion`) on the off→true transition only —
  never re-fights a later manual tab-switch/collapse.

- **Zoomed-out clipping, resolved v3.4.95, formula corrected v3.4.96** —
  `camera.far`/`controls.maxDistance` for the site-scale (non-Manhattan-
  context) view were fixed constants (`ORIGINAL_CAMERA_FAR = 4000`,
  `ORIGINAL_MAX_DISTANCE = 3500`) applied to every district regardless of
  real size. Chelsea/Clinton/Hudson Yards' real site diagonal (~4191m
  including height) left almost no safety margin, and real geometry
  corners ended up well past `far` from the camera at normal zoomed-out
  angles — live-confirmed at 5335 units, 1335 past the far plane. v3.4.95
  fixed this with `far = siteDiagonal * 1.5`, `maxDistance = far - 500`,
  but that only accounted for the one camera angle it was tested from —
  re-verifying v3.4.95 live (per Joe's "local host live") at a corner-
  opposite angle found real clipping again (7640 units from camera vs.
  `far` of 6294.6). v3.4.96 corrected the formula to the real worst case:
  `controls.maxDistance` bounds distance from the orbit target, but the
  farthest site point can sit up to another full diagonal beyond that
  target on the opposite side, so `siteAwareMaxDistance` now scales with
  the site directly (`Math.max(ORIGINAL_MAX_DISTANCE, siteDiagonal *
  1.2)`) and `siteAwareCameraFar` is built from ITS worst case
  (`maxDistance + siteDiagonal + 500`), not a flat multiple of `far`.
  Re-ran the exact position that clipped under v3.4.95 against the new
  formula (far=9720.2) — confirmed clean with real margin.
  `exitBoroughContext()` restores these same recomputed values instead
  of the fixed constants.

- **Home view after a box-draw left poché/handles permanently disabled,
  resolved v3.4.94** — `resetToDefaultView()` (the real Home/⌂ button
  handler) never cleared `activeSectionBox` after drawing a section box
  and picking a direction, despite an existing v3.2.23 comment claiming
  it did. So Plan → draw box → pick direction → Home landed in a state
  every poché/handle visibility formula in the file reads as "nothing
  can show" (a guard written for mid-draw, not-yet-committed states, not
  a permanent dead end) — `capFillToggle` disabled, no handles, correct
  behavior everywhere else (toggling Negative space directly, with no
  box drawn) untouched. Fixed by calling the already-existing
  `clearActiveSectionBox()` (same function "Full width" already used)
  at the start of `resetToDefaultView()`, rather than a bare
  `activeSectionBox = null` — it also clears any stale Plan-view box
  outline overlay. `zoomToBoroughContext()` (Manhattan context) still
  deliberately preserves the box per the original v3.2.23 intent,
  unaffected since the new call lives in `resetToDefaultView()` itself,
  not the shared `resetSharedViewState()` both call.

- **Buildings' X/Y cutaway poché, resolved v3.4.93** — the stencil-buffer
  technique (`createPlaneStencilGroup()`/`makeCapQuad()`, shared with
  negative space's own poché) was found to fail unpredictably for
  buildings specifically: 100% reproducible on Y across Chelsea's full
  range (real content confirmed via `AlwaysStencilFunc` bypass, but the
  real `NotEqualStencilFunc` test showed almost nothing, at every value
  tested), while X was inconsistent (worked at some values, not others).
  No root cause was ever confirmed after two separate live-diagnosis
  sessions — cross-axis `clearStencil()` interference, scene
  interference, and a plane-sync bug were each ruled out directly. Fixed
  by retiring the stencil technique for buildings' X/Y caps entirely,
  same move already made for Z in v3.4.91: `sliceFootprintAtLine()` +
  `buildBuildingXYCapGeometry()` compute the real cross-section directly
  from each building's own footprint polygon (standard even-odd
  scanline edge-crossing), no GPU state involved. Negative space's own
  poché (all 3 axes) is untouched — this only ever affected buildings'
  cap.

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

### v3.4.126 state (2026-10-01)

- ViewCube TOP: camera epsilon on the -Y side (screen-up = +Y, north-up). TOP's label rotDeg is 0 again.
- refreshCapFillCoverage(): box-scoped caps always fill (`!activeSectionBox && ratio > threshold`); applyPlanBoxDirection() re-runs it after setOrthogonalView().
- resetSharedViewState() sets showBuildings = true (Home + Manhattan context); zoomToBoroughContext() calls refreshViewToggles().
- Display accordion open by default; High detail (slower) lives in Display, not Export.
- Still open: soak_test.js not yet run successfully (needs a foreground tab); the original missing-fill report was not reproduced by hand; the intermittent N/S/E/W rendering bug (see above) remains open until Joe's own local testing says otherwise.
- smoke_test.js Phase 9 re-enables Buildings + Negative space after each box-direction click and checks only the active axis's building cap material.

### v3.4.127-130 (2026-10-01)

- **127** appended a continuous z=0 ground-line segment to buildSkylineProfileLine(). Joe saw the poché pale gray-blue in several N/S/E/W elevations on 127. **Removed in 128** (A/B build). The poché stayed pale on 128 without the segment, so the segment was not the cause; it stays out. If a ground line is wanted later it must be its own mesh, not part of the skyline LineSegments.
- **129** updateContextLayerVisibility() sets `groundMesh.visible = !boroughsGroup.visible`. zoomToBoroughContext() hid the tan ground plate when Manhattan context went on, and nothing restored it when a locked elevation then hid the context layer, so context-ON elevations had no base. Plan/Perspective with context ON still hide the plate.
- **130** makeCapQuad() builds the poché from MeshBasicMaterial (unlit) instead of MeshStandardMaterial. Clipping planes, stencil ops, polygonOffset, opacity and addSkyDiscard are unchanged.
- **Pale poché, unresolved cause.** On 127/128 the Y quad was visible, #b23a2e at 0.4 opacity, negative-space shell hidden, no other translucent mesh drawn. Hiding the Y cap group or either light removed the pale fill, so the on-screen colour depended on lighting. 130 removes that dependency; it does not prove it was the only cause. If a pale poché recurs on 130+, run the pixel-readout diagnostic in HANDOFF.md while it is on screen.

**Local live testing on v3.4.130 (district-1, TriBeCa / Battery Park City / FiDi):**
- `runSmokeBothSides()` 295/295 (context OFF 142, ON 153), no failures.
- `runSoakTest({ cycles: 300 })`: 0 violations, run in Joe's own foreground tab, once with no box and once with a drawn box and Manhattan context ON.
- Pixel check (red vs pale pixels, N/S/E/W, context OFF and ON): seven of eight views red. One reading in N with context ON, taken 700 ms after switching context on, was mostly pale (red 247, pale 4064). Three retries after a 1500 ms wait were all red. Not reproduced; may be a transition-timing artifact. The replay that tried to reproduce it froze the browser connection.

**Still open:** the single pale reading above; the wide-box N/S fill fix (diagnosed from the code path, no confirmed wide-box test); street-name labels at ground level in a South view with no box, and that view framing tiny; GitHub/Netlify not updated. The intermittent N/S/E/W bug is not reproduced in 600 soak cycles on one district; it is not declared fixed.

### v3.4.131 (2026-10-02)

- **Bug:** Manhattan context ON, then N/S/E/W entered from the perspective/Home view left the island slab, the MANHATTAN label and the street layer visible in the elevation. Readout in that state: `sectionModeAxis 'y'`, `activeCamera` Orthographic, `boroughsGroup.visible` true, `streetsGroup.visible` true.
- **Cause:** ordering in setOrthogonalView(). applySectionMode() ends with updateContextLayerVisibility() and updateStreetLabelVisibility(); both call inLockedElevation() (`sectionModeAxis !== null && activeCamera === orthoCamera`). `activeCamera = orthoCamera` is set later in the function, so they saw the perspective camera. From Plan the camera is already ortho, which is why smoke Phase 3/5/8 and the soak (always via Plan) never hit it.
- **Fix:** both functions are called again right after `activeCamera = orthoCamera`.
- **Checked live** (Joe's localhost, v3.4.130 served): before the fix, Home -> N/S/E/W with context ON gave boroughs true / streets true in all four. With the identical two lines patched into the served HTML in memory: boroughs false / streets false in all four directions; Plan and Home with context ON still show both; context OFF unchanged. The packaged file itself has not been run on Joe's reload.
- **Test added:** smoke_test.js Phase 10 starts every elevation from Home (perspective) and checks ortho camera, context layer hidden, streets hidden. It fails on v3.4.130.
- **Lesson:** any test that always enters an elevation through Plan cannot see a bug that depends on the previous camera. Vary the starting view.

### v3.4.132 (2026-10-02)

- **Request:** Joe -- south faces of buildings are always dark (perspective/Home view).
- **Cause:** the only directional light in perspective is `sun` at (400, 300, 700). Its light vector has N.L -0.34 against south walls and -0.46 against west walls, so they receive only the HemisphereLight. Elevations avoid this because orthoLight follows the camera.
- **Change:** `fillLight`, DirectionalLight (-400, -300, 150), intensity 0.5, swapped with `sun` (hidden in setOrthogonalView(), shown in resetSharedViewState()). South walls N.L about +0.57, west about +0.77, roofs +0.29. Elevations and the unlit poche are unchanged.
- **Previewed live** on district-1 by adding the same light at intensity 0 vs 0.5: dark faces read mid-gray with form at 0.5. 0.5 is a judgment call (one constant).
- **Audit:** 3 new checks; three older checks that pinned `sun.visible`/`orthoLight.visible` on adjacent lines now allow the fillLight line between them.

### Open items closed as "not reproduced" (2026-10-02)

Joe, who could not recall which areas he had been testing, chose to close the remaining open items and watch for them to return. None is declared fixed:
- Intermittent N/S/E/W rendering bug: 600 soak cycles / 0 violations on v3.4.130 (district-1); smoke 327/327 on v3.4.132. Last confirmed recurring at v3.4.47.
- Pale poché in elevations: poché unlit since v3.4.130; one pale reading with context ON (v3.4.130) not reproduced in three retries.
- Wide-box N/S fill (v3.4.126 change): Midtown 808 x 354 m box, S and N, context OFF, maroon fill on screen; never reproduced the original failure by hand.
- Street labels at ground level in a South view with no box / tiny unframed view: never reproduced. May relate to the v3.4.131 context/street visibility ordering bug (unconfirmed).
Reopen with exact steps if any of these is seen again.

### Regression pass on v3.4.132 (2026-10-02)

- Smoke (`runSmokeBothSides`): district-1 327/327; Midtown, Upper East Side, Inwood / Washington Heights and Chelsea each 158/158 (context OFF) + 169/169 (context ON). Phase 10 (elevations entered from Home) included.
- Soak with `navHome` added to the move list and a "Manhattan context layer visible in a locked elevation" invariant (soak_test.js, test-only): Midtown, Manhattan context ON, `runSoakTest({cycles:300})` in Joe's own foreground tab: 0 violations.
- Not covered by scripts: how the fill light looks (Joe's visual check), the hosted Netlify build.

### v3.4.133 Terrain (2026-10-02)

- Data: Terrarium tiles (AWS), z14, fetched live; bit-exact PNG decode (canvas decode corrupted R by 256 m on Joe's machine). Grid >= 16 m in the district's rotated frame via the exact inverse of project(). Datum: lowest ground in the padded site minus 1 m = z 0.
- Buildings stand on the lowest footprint terrain; roof = base + Overture height; 0.5 m footing. Compute = mold - earth heightfield solid - buildings. Ground mesh keeps groundMesh identity; streets draped.
- Sections: section profile gaps = ground height (highest terrain across the slab), terrain surface clipped to the cut slab in locked elevations (terrainGroundClipPlanes, re-applied from refreshActiveSectionProfile).
- Verified live (in-memory patch of served 132): smoke 153/153 + 169/169 on Inwood with terrain on. Note OFF-pass count is 153 when the district was already computed (Phases 1-2 are skipped), 158 when it is not.
- Not done: earth poche under the ground line; per-district grid rotation bug (see CHANGELOG); foreground-tab run; visual sign-off.

### Grid rotation fix (v3.4.133)

GRID_COS/GRID_SIN were `const` from the page-load default (28.96deg) and never followed setGridRotation(); every district was projected at 28.96deg. Now `let`, updated in setGridRotation(). Live check on Greenwich Village: weighted wall bearing +3.89deg -> -0.89deg (shift 4.78deg = 28.96 - 24.18). Residual < 1deg is the data's own bias.

### Greenwich Village smoke, context ON (found 2026-10-02, predates 133)
`runSmokeBothSides` on Greenwich Village with the grid fix: OFF 158/158, ON 164/169. The 5 failures are all Phase 6 "gap box, stale threshold, compass nav{N,S,E,W}: section is not empty (skyline maxZ > 0) -- maxZ=0". The same ON pass on the unfixed v3.4.132 fails the same 4 distinct checks, so it is not from the grid fix or terrain. Not investigated further.

### v3.4.134 transit footprints over streets (2026-10-02)
Cause (Midtown screenshots): Overture train_station / transportation footprints drawn over the streets above stations. Rule: drop any covering > 50 m of street centreline (parts judged individually, bridge_structure exempt). Midtown drops: ef5effa2 (no height, never drawn), a35c1295 (Herald Sq, 56 m), 76fa88dd (Grand Central Terminal, 46 m), and two Park Ave station-complex parts (150 m, 65 m); JS result matches a shapely cross-check (a35c1295 857 m vs 856 m). Live smoke on Midtown with the rule (in-memory patch of served 133): OFF 158/158, ON 169/169.

### v3.4.135 Grand Central exemption (2026-10-02)
Joe reported GCT missing; it was dropped by the v3.4.134 rule (411 m of Park Ave viaduct centreline). TRANSIT_KEEP_IDS now exempts 76fa88dd-a26d-4716-9261-ffd8ba2a9a0c. Live check on Midtown (in-memory patch of served 134): GCT not in droppedTransit, flat-fallback 2561 (was 2560).

### v3.4.136 (2026-10-02)
- Greenwich Village context-ON Phase 6 failures: test bug (stale projection after the Draw-box click re-framed Plan). Measured the drawn box at 1421..2698 x 1322..2599 vs the intended gap 121..301 x 178..358 (scale error = the zoom, 7.09). Fixed in smoke_test.js; Greenwich ON 175/175 live.
- Earth fill under the ground line: updateEarthSection(), own mesh, earth tone, locked elevations with terrain only.

### v3.4.137 (2026-10-03)
- Ground line in elevations with Terrain off: updateEarthSection() flat branch, own LineSegments mesh, unlit, depthTest off, renderOrder 11. Not part of the skyline or poche.
- updateStreetLabelScale(): min(max(0.045*view, 120), 0.135*view). Superseded the v3.4.79 audit check.
- Audit checks for the v3.4.136 earth strip updated (visibility no longer terrain-only; applyTerrainGround rebuilds instead of disposing).
- Not live-verified; needs Joe's reload.

### v3.4.138 (2026-10-03)
- Flat site, locked elevation: groundMesh hidden (updateContextLayerVisibility). Live-diagnosed with groundMesh.visible=false in Midtown and Harlem. Supersedes the v3.4.129 check. Not live-verified as code.

### v3.4.139 (2026-10-03)
- addThickOverlay(): LineSegments2 child (1.5 CSS px) on the skyline line and the flat ground line; hairline parent kept as data carrier (material.visible=false) so smoke_test still reads it. Cause confirmed by Joe's console test (all lines hidden -> no flicker). Not live-verified; module parses (node --check). Loads three/addons/lines/* from the same unpkg host.

### v3.4.140 (2026-10-03)
- TRANSIT_KEEP_IDS += Port Authority (footprint) and two Park Ave parts (matched per part id in dropTransitOverStreets). Ids taken from data/district-4/buildings.geojson and data/district-5/building_parts.geojson. Not live-verified.
- Smoke v3.4.139 on Joe's Midtown (Terrain off): 324/324 (OFF+ON), 0 fail; 3 fewer than the 327 baseline, per-phase counts not yet seen.

### v3.4.141 (2026-10-03)
- X/Y cutaway display offset (Option A): number inputs + end labels read from the slider min; internal coordinates, URL and smoke unchanged. Not live-verified. Default start (centre) unchanged, open question to Joe.

### v3.4.142 (2026-10-03)
- updateNegativeSliverHide(): negativeMesh Group hidden in non-elevation views while the kept slab is < 5 m on all three axes. Live-diagnosed (negativeMesh.visible=false). Skips locked elevations and box sections. Not live-verified; module parses.

### v3.4.143 (2026-10-03)
- Terrain ground line on the earth strip top; groundMesh hidden in all locked elevations; the v3.4.138 ground-plate audit check rewritten to the new rule. Cause diagnosed from Joe's readout (strip 0..9.4, skyline 24.3..173). Not live-verified; module parses.

### v3.4.144 (2026-10-03)
- terrainGroundAcrossSlab(): shared ground height for the skyline floor and the earth strip + ground line (fixes the E/W gap under the red base with deep box slabs). Not live-verified.
- Export image (PNG): exportImage() re-renders the current view at 1x/2x/4x (GPU-capped), toBlob in the same task, restores state. Not live-verified (could not run WebGL here; module parses).

### v3.4.145 (2026-10-03)
- Export DXF: dxfNew() R12 writer verified with ezdxf; exportDxfElevation()/exportDxfPlan() not browser-tested. Envelope (bbox) skyline, not exact cross-section.
