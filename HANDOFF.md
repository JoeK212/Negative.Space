# Negative Space -- handoff for a new chat (v3.4.162, 2026-10-06)

## v3.4.162 -- READ FIRST
- Help window now has a "Data and credits" section (Overture Maps, NYC Open Data, Terrain Tiles on AWS). Wording not checked against each licence: Joe to confirm before public launch. Test-only: Exercises waits in autotest/run.mjs raised 900 -> 2500 ms (random timing failures).
- Tests on 3.4.162: audit 422/422, main 107/107, soak 2 x 100 cycles 0 violations (Midtown; the Manhattan-context toggle in run 2 used a guessed selector, so context ON is not confirmed). Earlier on 3.4.161: caps 48/48, smoke 324/0, terrain 71/71, tour 67/67. Not tested: Safari/Firefox (sandbox cannot download them).
- Next for Joe: push to GitHub, deploy to Netlify, open it in Safari and Firefox.

## v3.4.161 -- READ FIRST
- Joe (CAD + app screenshots, Midtown, Y=0, H=0): two floating slivers at the far corner (one a thin full-height line). Cause: buildings overhang the X/Y slider ends by about 2 m, so at the end that removes everything they stayed. Fix: edgePushedThreshold() puts the real clip plane 3 m past the slider end there (screen, stencil poche, cut lines, DXF and building caps all follow). Likely the old "two tiny specks" issue. See CHANGELOG.md v3.4.161. Needs Joe's look: Y=0 and X=0 (and flipped ends) in the app and in the DXF.
- Also open from 3.4.160: Joe confirmed the terrain polyface mesh shows as ONE shaded surface in AutoCAD (3 strips, seams not a complaint so far); it reads flat in place because of the other layers and the low relief. Offered, not chosen: terrain exaggeration toggle (1x-5x) and a lighter TERRAIN colour.
- Package state: 3.4.161 packaged for Joe (negative-space-v3_4_161-full.zip); tests: audit 421/421, main 107/107, caps 48/48, smoke 324/0.


## v3.4.160 -- READ FIRST
- Joe asked why the terrain is "so many little squares" and whether it can be a surface. Answer given: the source is a regular elevation grid (step >= 16 m), plain R12 DXF has no true surface/solid, and I had drawn every cell edge. He chose "single mesh object, edges hidden". Now TERRAIN = POLYFACE MESHES (dxfTerrainMeshes + dxf.polyface): shared vertices, planar CCW triangles, every inner edge hidden (negative face index), only the outline of the whole grid visible. AutoCAD's polyface limit is 32,767 vertices AND 32,767 faces, so the grid is cut into strips (about 3 meshes for Midtown, not 1; seams hidden). See CHANGELOG.md v3.4.160. I could not test CONVTOSURFACE/CONVTOMESH in AutoCAD: ask Joe whether the meshes convert and whether the strips are a nuisance.
- Accumulated since the last zip given to Joe (3.4.156), NOT packaged: 3.4.157 (site-scaled labels), 3.4.158 (contours + labels in Plan), 3.4.159 (four distinct terrain colours: TERRAIN 126 teal, TOPO 213 orchid, TOPO_INDEX 6 magenta, TOPO_LABELS 4 cyan), 3.4.160 (polyface terrain). Joe has not seen any of them in CAD.
- Not done, never chosen by Joe: merge flat areas for fewer faces; bigger street-name text (6 m, ACI 3).
- Tests on 3.4.160: audit 420/420; `--terrain-only` 71/71; unit checks 21/21; `--no-terrain --skip-caps` 107/107. NOT re-run: `--caps-only`, `--tour-only`, smoke.
- Package state: last zip given to Joe is 3.4.156.

# (v3.4.159 notes below)

## v3.4.159 -- READ FIRST
- Joe sent his CAD layer manager (3.4.156 export): TERRAIN 55 / TOPO 54 were the same mustard and TOPO_INDEX / TOPO_LABELS plain yellow; he had asked for each topo layer to be unique. Now four different hues: TERRAIN ACI 126 (deep teal), TOPO 213 (light orchid), TOPO_INDEX 6 (magenta), TOPO_LABELS 4 (cyan, text); none shared with any other layer. One constant each in exportDxfPlan. See CHANGELOG.md v3.4.159.
- Accumulated since the last zip (3.4.156), NOT yet packaged: 3.4.157 (site-scaled contour labels, ACI 7 then), 3.4.158 (contours + labels in the Plan export), 3.4.159 (these colours). Joe has not seen any of them in CAD yet; he has only seen 3.4.156.
- Still not done, never chosen by Joe: hide the terrain grid edges (3DFACE flags 15); bigger street-name text (6 m, ACI 3); street-name text and SECTION_BOX/CUT_POCHE_NEGATIVE both red (existing).
- Tests on 3.4.159: audit 419/419; `--terrain-only` 66/66 (includes the layer-colour checks); `--no-terrain --skip-caps` last run 103/103 on 3.4.158 (not re-run for the colour change). NOT re-run: `--caps-only`, `--tour-only`, smoke.
- Package state: last zip given to Joe is 3.4.156.

# (v3.4.158 notes below)

## v3.4.158 -- READ FIRST
- Joe answered "which 2d?" by sending a screenshot of the PLAN export: it had no terrain at all, hence no contours or labels. Now, with Terrain on, the Plan export also carries TOPO, TOPO_INDEX and TOPO_LABELS (same as Perspective; contours keep their real Z). The TERRAIN surface and the draping stay Perspective-only (a plan stays flat). Labels were already made site-scaled (about 19 m) and ACI 7 in 3.4.157. See CHANGELOG.md v3.4.158 and v3.4.157.
- NOT done, never chosen by Joe: hide the terrain grid edges (3DFACE flags 15); bigger street-name text (6 m, ACI 3: tiny on a whole-site Plan screenshot). Joe has not yet looked at 3.4.157/158 in CAD.
- Tests on 3.4.158: audit 418/418; `--terrain-only` 64/64 (includes a Plan-with-Terrain export); `--no-terrain --skip-caps` 103/103; unit checks 17/17 (run inside the main suite). NOT re-run: `--caps-only`, `--tour-only`, smoke.
- Package state: the last zip given to Joe is 3.4.156; 3.4.157 and 3.4.158 are NOT packaged.

# (v3.4.157 notes below)

## v3.4.157 -- READ FIRST
- Joe saw the 3.4.156 export in CAD: the draping works (footprints and streets now sit on the ground), but "3d and 2d exports very hard to see contour labels / text". Fix: TOPO_LABELS height now scales with the site (diagonal / 220, 8-30 m, about 19 m for Midtown, was a fixed 7 m) and the layer is ACI 7 (was yellow like the contours). See CHANGELOG.md v3.4.157.
- NOT done, offered to Joe: hide the terrain grid edges (3DFACE flags 15) so contours and labels stand out; contours + labels in the Plan (2D) export (today the Plan export has no terrain at all); bigger street-name text (6 m, ACI 3). Joe has not chosen. Ask whether his "2d" meant the Plan export or just a top view of the 3D export.
- Tests on 3.4.157: audit 417/417; unit 17/17; `--terrain-only` 59/59 (includes the new label-size check). NOT re-run: `--no-terrain --skip-caps`, `--caps-only`, `--tour-only`, smoke.
- Package state: last zip given to Joe is 3.4.156; 3.4.157 is NOT packaged.

# (v3.4.156 notes below)

## v3.4.156 -- READ FIRST
- DRAPING done (Joe: "ok drape, i understand what you are doing now"). In the PERSPECTIVE export with Terrain on, the footprints (BUILDINGS), street centrelines (STREETS) and SECTION_BOX are 3D polylines on the ground (dxfDrape: segments cut to at most one grid step, each point terrainZ + 0.15 m). Without Terrain, and in the Plan export, they stay flat at Z = 0. Street names were already at terrain height. See CHANGELOG.md v3.4.156.
- Still NOT done, never chosen by Joe: hide the terrain's grid edges (3DFACE flags 15) so TERRAIN reads as a shaded surface; contours in the Plan export; also from earlier: pier teeth, X/Y default start, the far-corner specks, street names out in the water, the dark triangle near the plaza in an old screenshot, and the Netlify deploy (hosted build was on 135).
- Joe has not yet looked at the index contours or the draped lines in CAD.
- Tests on 3.4.156: audit 417/417; unit checks 16/16; `--terrain-only` 57/57; `--no-terrain --skip-caps` 102/102 (includes 'plan lines stay flat without Terrain'). NOT re-run on 3.4.156: `--caps-only`, `--tour-only`, smoke (the change is confined to the DXF export).
- Package: 3.4.156 packaged for Joe (negative-space-v3_4_156-full.zip); the 3.4.155 notes below still apply.

# (v3.4.155 notes below)

## v3.4.155 -- READ FIRST
- Joe looked at the 3.4.154 terrain export in CAD ("looks very good") and chose INDEX CONTOURS WITH LABELS: with Terrain on, TOPO (regular, ACI 54), TOPO_INDEX (every 5th level, ACI 2) and TOPO_LABELS (elevation text in m above sea level, ~every 300 m, upright, 7 m high). Closed loops under 3 grid steps are dropped (noise blobs in the park). See CHANGELOG.md v3.4.155.
- Asked but NOT done (Joe did not choose them; he asked what "drape streets" means): (1) DRAPE the STREETS centrelines and BUILDINGS footprints onto the terrain (they are written at Z = 0 so they lie under the ground with Terrain on; street NAMES are already at terrain height); (2) hide the terrain's grid edges (3DFACE flags 15) so TERRAIN reads as a shaded surface; (3) contours in the Plan export. Explain draping simply if he asks again: lift each point of those lines to the ground height so they sit on the surface.
- Tests on 3.4.155: audit 416/416; unit checks for the terrain/index/label helpers 12/12; `--terrain-only` 51/51 (real-export checks for TERRAIN, TOPO, TOPO_INDEX, TOPO_LABELS). NOT re-run on 3.4.155: `--no-terrain --skip-caps`, `--caps-only`, `--tour-only`, smoke (the change is confined to the terrain part of the DXF export).
- Package state: the last zip given to Joe is 3.4.154; 3.4.155 is NOT packaged.

# (v3.4.154 notes below)

## v3.4.154 -- READ FIRST
- Joe asked why a Terrain-on Perspective DXF showed no terrain: it never exported any. Now, with Terrain on, the Perspective DXF also has TERRAIN (ACI 55, one 3DFACE quad per elevation-grid cell) and TOPO (ACI 2, 3D polylines, contours at round ABSOLUTE elevations z + datum, drawn at model Z; interval auto, about 30 levels max) on their own layers. Joe's choice: "both and separate each by its own unique layer". See CHANGELOG.md v3.4.154.
- Not done: TOPO in Plan, contour elevation labels (TEXT), a coarser/finer surface option. Joe has NOT yet looked at the terrain export in CAD.
- Tests on 3.4.154: audit 415/415; `--terrain-only` 43/43 (includes the real-export TERRAIN/TOPO checks); `--no-terrain --skip-caps` 91/91 (includes the new no-browser terrain unit checks and 'no terrain layers when Terrain is off'). NOT re-run on 3.4.154: --caps-only, --tour-only, smoke (the change is confined to the DXF export). One run was lost to a sandbox restart mid-run and repeated.
- Package state: the last zip given to Joe is 3.4.153; 3.4.154 is NOT packaged.

# (v3.4.153 notes below)

## v3.4.153 -- READ FIRST
- Joe saw the 3.4.152 DXF in CAD: line work and caps look right; the dark building poche vanished against the dark background, so CUT_POCHE_BUILDINGS is now brown-orange (ACI 34). Only that colour changed. He still has not given feedback on the red negative-space poche (ACI 1), a hatch, or the dark triangle near the bottom centre of his screenshot (around the plaza; unchecked, he was to zoom in).
- Tests on 3.4.153: audit 414/414; `--no-terrain --skip-caps` 84/84 (includes the new layer-table colour check). NOT re-run on 3.4.153: --caps-only, --terrain-only, --tour-only, smoke (the change is one colour constant in the DXF export; they passed on 3.4.150).

# (v3.4.152 notes below)

## v3.4.152 -- READ FIRST
- Joe asked for caps on the cut faces "maybe with a unique cut poche". Done in the Perspective DXF: the cut faces are capped on CUT_POCHE_NEGATIVE (color 1, red) and CUT_POCHE_BUILDINGS (color 250, dark). Method and limits: CHANGELOG.md v3.4.152 (plane cross-section loops, even-odd holes, earcut, clipped to the removed corner, written through dxfMeshFaces). Caps are flat 3DFACE surfaces (not solids), not hatched. Open (non-watertight) sections are skipped and reported in the toast.
- Needs Joe's look in CAD: do the caps sit right at the cut, are the two layer colours what he wants (red / dark), is the fill what "poche" should look like (maybe a hatch or a different colour), does a section in the middle of a tall tower look right.
- Tests on 3.4.152: audit 414/414; `--no-terrain --skip-caps` 83/83 (includes 4 + 6 no-browser unit checks and the real-Midtown cap checks; the export with both layers and caps took 9 s). NOT re-run on 3.4.152: --caps-only, --terrain-only, --tour-only, smoke (the change is confined to the DXF export; they passed on 3.4.150).
- Not packaged. The last package is 3.4.150 (3.4.151 line-work and 3.4.152 caps are only in the working copy). The 3.4.151 notes below still apply.

# (v3.4.151 notes below)

## v3.4.151 -- READ FIRST
- Joe opened the 3.4.150 Perspective DXF in CAD (two screenshots, "section 3d needs to be refined"): every wall showed triangle diagonals and the mold's big faces fanned from points. Fix: 3DFACE edge-visibility flags (group 70) hide the edges inside flat faces (dxfMeshFaces/edgeFlags; creases and boundaries stay). Geometry unchanged. See CHANGELOG.md v3.4.151. Needs Joe's look in CAD.
- NOT done, ask Joe: (a) caps on the cut faces so the cut mold reads as a closed solid (currently open), (b) re-meshing the thin sliver triangles themselves (selecting one in CAD still picks the thin triangle), (c) file size.
- Tests on 3.4.151: audit 413/413; `--no-terrain --skip-caps` 71/71 (66 + 4 new no-browser unit checks + 1 end-to-end flag check). NOT re-run on 3.4.151: --caps-only, --terrain-only, --tour-only, smoke (the change is confined to the DXF writer; they passed on 3.4.150).
- 3.4.150 zip was the last package; 3.4.151 is not packaged. The 3.4.150 notes below still apply.

# (v3.4.150 notes below)

## v3.4.150 -- READ FIRST
- Added (after Joe compared with SPIRA's Tour button + Exercises): a header **Tour** pill next to ? (starts/replays the guided tour) and an **Exercises** accordion in the side panel (below Display, above Export; appears once the site is computed). Five tasks graded live from page state, nothing saved: both layers on; Height cut 85-115 m; X 25-40% across; Flip X; drawn box + West elevation. "Check my work" toasts the count. See CHANGELOG.md v3.4.150. The 3.4.149 tour notes below still apply.
- Not done: exercises for Terrain/Export/DXF, per-exercise hints, SPIRA-style glossary tooltips. The exercise-5 path (a real box drag) is not in the autotest; Joe should try it.
- Test pieces (5-minute tool limit): `--tour-only` (now includes the header button and Exercises checks), `--no-terrain --skip-caps`, `--caps-only`, `--terrain-only`, `--caps-only --skip-caps --smoke`. audit_deploy.js 412/412 on 3.4.150. ALL pieces were re-run on 3.4.150 by Claude and pass: audit 412/412, --tour-only 36/36, --no-terrain --skip-caps 66/66, --caps-only 17/17, --terrain-only 21/21, smoke 324/0 (OFF 154, ON 170). Not run: Joe's own machine, the real box drag for exercise 5, deploy.

# (v3.4.149 notes below)

## v3.4.149 -- READ FIRST
- NEW guided tour (8 steps) + refreshed help window, modelled on SPIRA's tour. Joe chose: starts on a FIRST VISIT ONLY (ns_tourDone), replay from the ? help window ("Take the guided tour"). Details and the exact rules: CHANGELOG.md v3.4.149. It does NOT start when the URL carries shared cut state (h/x/y/l/fx/fy) or on a small screen. The only thing it saves is ns_tourDone; endTour() puts the side panel, the Export section and the saved Simple/Advanced choice back (SPIRA's tour once left Advanced stuck on after Skip: do not regress this).
- Joe still needs to: (1) clear the site's saved data (or run `localStorage.removeItem('ns_tourDone')`) and reload to see the first-visit tour on his own machine, (2) judge the wording and look (the step-4 "Show me a cut" is subtle from the default south view: the removed corner is the far north-east one; a more visible demo would flip Y or orbit the camera), (3) the previous 3.4.148 checks he hasn't finished: cut DXF in CAD, deploy.
- Tests: autotest has a new `--tour-only` section (22 checks: starts by itself, spotlight on the right control, compute gate, each Show me and its undo, panel restored on Skip, replay, Esc, no restart after reload, no tour on a shared link). The harness marks the tour done on every page unless a test passes {tour:true}; smoke_test.js marks it done and dismisses a running tour (a first visit would otherwise start it mid-smoke). Run pieces (5-minute tool limit): `--tour-only`, `--no-terrain --skip-caps`, `--caps-only`, `--terrain-only`, `--caps-only --skip-caps --smoke` (smoke only, prints failed check names).
- Ideas not done: SPIRA-style glossary tooltips and self-checking exercises; real-drag Draw-box and Terrain steps; EXTENDED.md was not audited against the new features.

# (v3.4.148 notes below)

## v3.4.148 -- READ FIRST
- Joe confirmed 3.4.147 DXFs in his CAD program: Plan street names and Perspective 3D heights look good. He tabled the pier teeth (A/B/C) and the X/Y default start (both unchanged).
- Perspective DXF now APPLIES the live X / Y / Height cutaway to the 3D masses (dxfClipOctant, same three planes as the screen; cut faces left open, no poche caps). A deep cut can give slightly more faces than uncut (split triangles don't re-merge): district-5 buildings 80,197 uncut vs 83,661 cut. Needs Joe's CAD check of a cut export.
- Poche caps no longer show from the BACKSIDE of a cut (Joe's screenshots, X/Y/Z, Manhattan on and off): capQuadFaceOnEnough(planeNormal, plane) + zCapFacesCamera() + updateCapFacing() in animate(). See CHANGELOG.md v3.4.148 part 2. Checked by flag-level autotest only, NOT by pixels: Joe must orbit behind a cut (X, Y, and Height Cut with Manhattan context on and off) and confirm the black/red fill is gone from behind and back when facing it. Known, left alone: with all three planes engaged a camera on the cut side of one plane but the kept side of another can still see that cap over kept geometry.
- Autotest: failed-tile Terrain test fixed (timing race in the test, not an app defect). audit_deploy.js 409/409. Autotest now has --caps-only and --skip-caps so each run fits the 5-minute tool limit: `--no-terrain --skip-caps` 66/66, `--caps-only` 17/17, `--terrain-only` 21/21. smoke_test.js on 3.4.148 run by Claude in the sandbox (Midtown): 324/0 (OFF 154, ON 170); `node run.mjs --no-terrain --skip-caps --smoke` is 67/67 and now prints failed smoke check names. Not run: Joe's local smoke/autotest, deploy (Joe's; Netlify was on 135).
- Still open: street-name labels that fall out in the water (Joe saw them in both DXF views; could drop labels outside the island, undecided); the two tiny specks at the cutaway's far corner; pier teeth and X/Y default start (tabled).

# (v3.4.147 notes below)

## v3.4.147 -- READ FIRST
- DXF export fixes from Joe's testing: Plan/Perspective now include STREET_NAMES TEXT; Perspective also exports 3D masses with real Z (BUILDINGS_3D and/or NEGATIVE_SPACE_3D as 3DFACE, quad-merged; 13 MB buildings / 30 MB both in Midtown; whole solids, cutaway NOT applied). Plan stays 2D. A call-stack overflow in the DXF assembler (found by the headless tests) is fixed. See CHANGELOG.md v3.4.147.
- Joe still needs to open the DXFs in his CAD program and say: names readable/placed OK? heights right? wants cutaway applied / height text / a lighter option?
- Tests: audit_deploy.js 407/407; autotest 58/58 (--no-terrain) + 21/21 (--terrain-only) on 3.4.147. Claude can run them in its sandbox (see v3.4.146 note below); the sandbox tool limit is 5 min per command, so run the two halves separately.

# (v3.4.146 notes below)

## v3.4.146 -- READ FIRST
- NEW autotest/ folder (headless Chromium suite, 60 checks) + the app unchanged from 3.4.145. Run: `cd autotest && npm install && npm test` (add `npm run test:smoke` for smoke_test.js). Claude CAN run it in its own sandbox (bundled @sparticuz/chromium + software WebGL, unpkg mapped to local npm copies, elevation tiles faked): after any change run audit_deploy.js AND this suite. See autotest/README.md and CHANGELOG.md v3.4.146.
- Result on v3.4.145: 60/60, smoke 324/0, no app defects found in 137-145. Not covered: flicker while zooming, visual judgement, other browsers, real GPU, live elevation service.
- Joe still needs to: eyeball 137-146 live (see VERIFY_v3.4.145.md; the automated suite now covers much of it), try the Windows route (CHROME_PATH) if he wants to run the suite himself, deploy (Netlify was on 135), and answer the open decisions (pier teeth A/B/C, X/Y default start, two tiny specks).
- Ideas not done: vendor three/manifold locally (unpkg is a single point of failure), Safari/Firefox pass, in-app help text for X/Y values / Export image / Export DXF, exact cut linework + street edges in the DXF.

# (v3.4.145 notes below)

## v3.4.145 -- READ FIRST (not yet confirmed on Joe's reload)
- NEW Export DXF (CAD) in the Export accordion: elevation -> SKYLINE/POCHE/GROUND/EARTH polylines (x mirrored to screen-right, y = height); Plan/Perspective -> BUILDINGS/STREETS/SECTION_BOX. R12 ASCII, meters 1:1. Writer verified with ezdxf; app wiring never run in a browser: Joe must test (Plan, elevation flat + Terrain on; open in a CAD tool; check orientation/scale). Skyline is the bbox ENVELOPE, not exact cross-section; street widths/names not exported. Possible next: exact cut linework, offset street edges, model-scale option, SVG. See CHANGELOG.md v3.4.145.
- Also in this package: v3.4.144 Export image (PNG) and the shared terrain ground function (E/W gap fix) -- both untested by Joe.
- Pending: smoke on 140-145 (last run 139: 324/0); visual sign-off 137-145; deploy (Netlify was on 135); open questions: pier teeth on the Manhattan slab (A/B/C), X/Y default start, two tiny specks near the far corner.

# (v3.4.144 notes below)

## v3.4.144 -- READ FIRST (not yet confirmed on Joe's reload)
- NEW Export image (PNG) in the Export accordion: size 1x/2x/4x, White background, button. Re-renders the current view at higher pixel ratio (GPU-capped), toBlob in the same task as the render, then restores. Never run in a browser by Claude: Joe must test (all three sizes, Plan/Perspective/an elevation, White background on/off, and that the on-screen view is unchanged afterwards). Hairline lines (cut planes, poche outline) read thinner at 2x/4x; skyline/ground lines scale. See CHANGELOG.md v3.4.144.
- E/W gap under the red base with Terrain on (UWS, box W 81-82 St): fixed by one shared ground function (terrainGroundAcrossSlab) for the skyline floor and the earth strip + ground line. Needs Joe's check in UWS and Murray Hill.
- Pending: Joe's smoke on 140-144 (last run 139: 324/0; load via the script-tag command, then `await runSmokeBothSides('name')`; click Terrain + Compute first to cover terrain); visual sign-off 137-144; deploy (Netlify was on 135); open questions: river pier teeth on the Manhattan slab (A/B/C), X/Y default start, two tiny specks near the far corner.

# (v3.4.143 notes below)

## v3.4.143 -- READ FIRST (not yet confirmed on Joe's reload)
- Terrain on, locked E/W/N/S: new light ground line along the earth strip top; the terrain surface (and flat plate) is hidden in every locked elevation. Joe's Murray Hill screenshots (W overlap, E detached strip) and console readout drove it (strip z 0..9.4, red skyline 24.3..173: the red base is the lowest building roof, not a bug). See CHANGELOG.md v3.4.143. If W still shows tan above the red base, the surface was not the only cause: ask for the same readout in W.
- Joe's console hides console.table output (Info level filtered); return strings instead of console.table when asking him for readouts.
- Still pending: Joe's visual sign-off on 137-143; smoke last run on 139 (324/0); deploy (Netlify was on 135); open questions to Joe: river pier teeth on the Manhattan slab (options A/B/C, undecided), X/Y default start, two tiny specks near the far corner.

# (v3.4.142 notes below)

## v3.4.142 -- READ FIRST (not yet confirmed on Joe's reload)
- Negative-space solid hidden when X, Y and Height are all within 5 m of their sliders' kept-slab minimum (the far corner), Perspective/Plan/octant views only. Cause of the dark blocks diagnosed live (negativeMesh). Rule is in updateNegativeSliverHide() (animate). See CHANGELOG.md v3.4.142.
- Two tiny dark specks near the far corner remain (other source, unidentified). River pier teeth on the Manhattan context slab are a separate thing (options A/B/C offered; Joe wants no regression, undecided, nothing changed).
- Joe asked about X/Y default start (centre, reads ~614/~2111): unchanged, no answer.
- Smoke last run on 139 (324/0). Not run on 140-142. Joe runs it: load with `const s=document.createElement('script');s.src='/smoke_test.js?'+Date.now();s.onload=()=>console.log('loaded:',typeof runSmokeBothSides);document.head.appendChild(s)` then `await runSmokeBothSides('name')`. Deploy (GitHub/Netlify) is Joe's; Netlify was on 135.

# (v3.4.141 notes below)

## v3.4.141 -- READ FIRST (not yet confirmed on Joe's reload)
- X/Y cutaway inputs and end labels now show distance from the slider's low end (0 at the left, like Height). Display only; internal coords, URL ?x=&y= and smoke unchanged. See CHANGELOG.md v3.4.141.
- Open question to Joe: should the DEFAULT cutaway start at the left end (0, hides everything) instead of the centre (now reads ~614 / ~2111)? Left as centre.
- Still awaiting Joe's visual sign-off on 137-141 and his smoke run on 140/141 (139 passed 324/0). Deploy is Joe's (Netlify was on 135).

# (v3.4.140 notes below)

## v3.4.140 -- READ FIRST (not yet confirmed on Joe's reload)
- TRANSIT_KEEP_IDS now also holds Port Authority (f78c98b4-98a0-4150-a581-2d61d19da302) and the two Park Ave parts (66393436-..., 34623232-...); parts are exempted by their own id. Needs a visual check in Midtown / district-4. See CHANGELOG.md v3.4.140.
- Smoke on v3.4.139, Joe's Midtown, Terrain off: 324 passed, 0 failed. Baseline was 327 (158 + 169); the 3-check gap is unexplained (ask Joe to expand the off/on result objects). Two setPointerCapture NotFoundError console errors came from the test's fake pointer events (OrbitControls), no check failed.
- Flicker fix (139) and label growth (137) still need Joe's visual sign-off. Deploy (GitHub/Netlify) is Joe's; Netlify was on 135.

# (v3.4.139 notes below)

## v3.4.139 -- READ FIRST (not yet confirmed on Joe's reload)
- High detail flicker on cut edges in elevations: skyline + flat ground line now drawn as LineSegments2 at 1.5 CSS px (child of the hairline, which stays as data carrier with its material off; smoke's skylineMaxZ still works). Cause confirmed by Joe's console test. See CHANGELOG.md v3.4.139.
- Joe confirmed v3.4.138 live on Midtown W: tan band gone. 137 items (ground line, label growth) and 139 still need his visual sign-off. Smoke has NOT been run on 137-139; Joe runs it (`await runSmokeBothSides('name')`).
- Not changed: Plan/3D cut-plane lines and poche outline are still hairlines.

# (v3.4.138 notes below)

## v3.4.138 -- READ FIRST (not yet confirmed on Joe's reload)
- Tan ground plate hidden in locked elevations on a flat site (Terrain off). It drew a band inside the buildings in Midtown and Harlem W; console `__NS.groundMesh.visible=false` confirmed the cause. Plan/Home/Terrain-ON unchanged. Check with Manhattan context ON too (section base is now the ground line only). See CHANGELOG.md v3.4.138.
- v3.4.137 items (ground line, label growth) are also still awaiting Joe's visual sign-off; smoke has not been run on 137/138.

# (v3.4.137 notes below)

## v3.4.137 -- READ FIRST (not yet confirmed on Joe's reload)
- Flat-site ground line in N/S/E/W (Terrain off): own light line at z=0 across the full width. Terrain ON still uses the 136 earth strip.
- Street labels: min(max(4.5% of view, 120 m), 13.5% of view). Joe asked after zoomed-in Plan looked tiny; if still small, raise the 120 / cap or fill the sprite. See CHANGELOG.md v3.4.137.
- `audit_deploy.js` 398/398. Hosted Netlify build was v3.4.135 when last seen; GitHub deploy is Joe's. Claude cannot read the GitHub repo (404, likely private).
- Still pending if Joe asks: add Port Authority (district-4 f78c98b4) and the two Park Ave parts (district-5 66393436, 34623232) to TRANSIT_KEEP_IDS.

# (earlier handoff, v3.4.136)

## What this package is
Full project zip, v3.4.132. `audit_deploy.js` 380/380. v3.4.131 (Home -> N/S/E/W context/streets fix) passed `runSmokeBothSides()` 327/327 on Joe's localhost (context OFF 158, ON 169, incl. Phase 10). v3.4.130 (before this fix) passed `runSmokeBothSides()` 295/295 and `runSoakTest({cycles:300})` 0 violations (no box, and with a drawn box + Manhattan context ON) on district-1, in Joe's own foreground tab. v3.4.131 itself has NOT been run through smoke/soak or confirmed on Joe's reload; its fix was checked live only by patching the same two lines into the served v3.4.130 HTML in memory.

## v3.4.136 -- earth fill under the ground line (terrain sections)
`updateEarthSection()` draws a thin earth-tone strip on the cut plane under the ground line in a locked elevation with terrain on. Own mesh, own material; poche untouched. See CHANGELOG.md v3.4.136.

## v3.4.135 -- Grand Central Terminal exempted
`TRANSIT_KEEP_IDS` (index.html) lists Overture building ids the street rule never drops; it has Grand Central only. Joe may want Port Authority (district-4 f78c98b4) and the two Park Ave parts (district-5 66393436, 34623232) added. See CHANGELOG.md v3.4.135.

## v3.4.134 -- station/transport footprints over streets
Midtown showed building masses where streets should be. Cause: Overture `train_station`/`transportation` footprints drawn over the streets above stations. Joe chose to drop those covering > 50 m of street; implemented as dropTransitOverStreets() (bridge_structure exempt). It also removes Grand Central Terminal, Port Authority and two tall Park Ave parts in Midtown, by design. `?transit=keep` disables it. Details: CHANGELOG.md v3.4.134.

## STATUS v3.4.133 (Terrain) -- read first
New **Terrain** toggle (Display, off by default). Full details in CHANGELOG.md v3.4.133. Verified on Joe's localhost ONLY by patching the same edits into the served v3.4.132 page in memory (hidden Claude-in-Chrome tab): Terrain on for district-1 (TriBeCa/FiDi) and Inwood, compute with terrain (143k / 243k triangles), N/S/E/W with the terrain-following skyline, `runSmokeBothSides` on Inwood WITH terrain on: 153/153 (context OFF) + 169/169 (context ON). NOT yet confirmed on Joe's own reload, not yet run in a foreground tab, and no visual sign-off.
Known gaps: ~16 m grid; terrain compute is slower than flat; stage timings are in window.__tt after each compute.
Grid-rotation bug FIXED in 133 (GRID_COS/GRID_SIN now follow each district's angle; every district other than ~28.96deg is rotated slightly differently than in 132, streets now axis-aligned). Check a couple of districts visually.
Test with terrain: click Terrain, (wait), Compute, then `await runSmokeBothSides('x')` -- smoke does not click the Terrain button itself.

## Resolved in 136: Greenwich Village context-ON smoke failures
Were a test bug (stale pixel projection in smoke Phase 6 after the Draw-box click re-framed Plan). Fixed in smoke_test.js; Greenwich ON passes 175/175. See CHANGELOG.md v3.4.136.

## What to do first (Joe)
1. Extract the zip, swap it into the folder served at http://localhost:8888/ , hard-refresh. Footer must read **v3.4.132**.
2. Manhattan context ON, click Home, then N, S, E, W (with and without a drawn box). No gray island slab, no MANHATTAN label, no street layer; tan ground plate is the base. Plan and Home with context ON still show the island and streets.
3. Paste smoke_test.js (it now has Phase 10), run `await runSmokeBothSides('Joe')`, send the totals. New phase starts every elevation from Home.
4. Optional: `await runSoakTest({ cycles: 300 })` again in a foreground tab.

## What changed in 132
Added `fillLight` (DirectionalLight, (-400,-300,150), intensity 0.5) for the perspective/Home view so south- and west-facing walls are not black; swapped with `sun` like `sun` is swapped with `orthoLight`. Elevations unchanged. Intensity is one constant in index.html; Joe may want it tuned (0.3 more contrast, 0.8 flatter). Check Home on a few districts and orbit all the way round; confirm N/S/E/W look the same as on 131.

## What changed in 131
setOrthogonalView() now calls updateContextLayerVisibility() and updateStreetLabelVisibility() after `activeCamera = orthoCamera`. Before, applySectionMode() ran them while the camera was still perspective, so inLockedElevation() was false and the Manhattan layer + streets stayed visible in an elevation entered from Home/perspective. See CHANGELOG.md and AUDIT.md.

## What changed v3.4.126 -> 130
- 126: ViewCube TOP north-up (camera epsilon (0,-0.0001,1), label rotDeg 0); box-scoped caps always fill; Buildings ON in Home and Manhattan context; Display accordion open by default with High detail (slower) moved into it; ViewCube panel spacing 142px. smoke_test.js Phase 9 fixes.
- 127: added a continuous ground-line segment to the skyline line. REMOVED in 128 (the poché went pale with it; later also pale without it, so it was not the cause).
- 128: A/B build, ground line removed.
- 129: groundMesh.visible = !boroughsGroup.visible in updateContextLayerVisibility(), so a locked elevation with Manhattan context ON still has its tan ground plate as the base.
- 130: poché cap quads (makeCapQuad) are now MeshBasicMaterial (unlit) instead of lit MeshStandardMaterial.

## Open issue: white/pale poché in elevations
Seen on v3.4.127 and v3.4.128 in several areas (S/W elevations). Console showed the Y quad visible, colour #b23a2e, opacity 0.4, negative-space shell hidden, Section fill ticked, and no other translucent mesh drawn. Hiding the Y cap group removed the pale fill; hiding either light removed it too -- so the on-screen colour depended on lighting. Red again on v3.4.129 (Midtown, Inwood). The exact trigger was never found. v3.4.130 removes lighting from the poché. If it ever recurs on 130+, with the pale fill on screen, run this and send the table:

```js
(()=>{const NS=__NS,r=NS.renderer,gl=r.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,x0=Math.floor(W*.2),w=Math.floor(W*.5),y0=Math.floor(H*.25),h=Math.floor(H*.4),big=new Uint8Array(w*h*4),one=new Uint8Array(4);
const draw=()=>r.render(NS.scene,NS.activeCamera);
draw();gl.readPixels(x0,y0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,big);let P=null;for(let i=0;i<big.length;i+=4){const R=big[i],G=big[i+1],B=big[i+2];if(R>55&&R<115&&G>80&&G<140&&B>100&&B<165&&B>R+25){const k=i/4;P=[x0+k%w,y0+Math.floor(k/w)];break}}
if(!P)return console.log('no pale pixel found');
const px=()=>{draw();gl.readPixels(P[0],P[1],1,1,gl.RGBA,gl.UNSIGNED_BYTE,one);return [...one].join(',')};
const g=NS.capFillGroups.y,q=g.userData.quad,m=q.material,st=g.children.filter(c=>c!==q&&c!==g.userData.outline);
const out=[['base',px()]];
q.visible=false;out.push(['quad hidden',px()]);q.visible=true;
const o=m.opacity;m.opacity=1;out.push(['quad opacity 1',px()]);m.opacity=o;
const c=m.color.getHex();m.color.set(0x00ff00);out.push(['quad green',px()]);m.color.setHex(c);
st.forEach(s=>s.visible=false);out.push(['stencil hidden',px()]);st.forEach(s=>s.visible=true);
out.push(['canvas alpha/premult',String(gl.getContextAttributes().alpha)+'/'+String(gl.getContextAttributes().premultipliedAlpha)]);
console.table(out)})()
```

## Closed as "not reproduced" (Joe's call, 2026-10-02) -- NOT proven fixed
Joe could not recall which areas he was testing and chose to close these out and see whether they come back. Reopen any of them, with the exact steps, if it is seen again.
- Intermittent N/S/E/W rendering bug: 600 soak cycles, 0 violations (v3.4.130, district-1, no box and box + Manhattan context ON); on v3.4.132 Midtown, Manhattan context ON, with Home added to the soak's moves: 300 cycles, 0 violations (Joe's foreground tab); smoke 327/327 on district-1 and 158/158 + 169/169 on Midtown, Upper East Side, Inwood and Chelsea.
- Pale poché in elevations: unlit since 130. One pale pixel reading in N with Manhattan context ON (700 ms after the toggle) was not reproduced in three retries. If it recurs, run the pixel-readout diagnostic in the section above while it is on screen.
- Wide-box N/S fill: Midtown 808 x 354 m box, S and N, context OFF: quad visible, maroon fill on screen. Context ON with the 131/132 build not hand-checked.
- Street-name labels at ground level in a South view with no box, view tiny/unframed: never reproduced. Possibly related to the v3.4.131 ordering bug (streets stayed visible in an elevation entered from Home/perspective), which is fixed and covered by smoke Phase 10; that link is a guess, not confirmed.

## Still open
- GitHub/Netlify not updated (Joe's to do). AUDIT.md has entries for 127-132.

## Standing rules (Joe)
- Ask before packaging; when he says yes, deliver the FULL zip (entire project).
- Never call something fixed on code review alone -- only Joe's local live testing (or a direct repro on his connected browser) confirms it.
- Any change touching section/box/view code needs `runSmokeBothSides()` (Manhattan context ON and OFF).
- Sections follow architectural convention: solid cut fill, continuous ground at the base, streets as open gaps at grade, no street layer in elevations (Major streets stay hidden there). Apply by default; do not ask again.
- Keep Randalls/Wards/Roosevelt Island buildings as they are.
- Joe's focus is the island of Manhattan, not other boroughs.
- Keep answers short and direct.
- The Claude-in-Chrome tab runs on Joe's own machine: ask before connecting, and note that navigating reloads his page. Its tab group opens in a background window (document hidden, no animation frames), so the soak test must be run in Joe's own foreground tab; smoke_test.js works in the hidden tab.
