# Negative Space -- handoff for a new chat (v3.4.147, 2026-10-03)

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
