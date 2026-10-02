# Negative Space -- handoff for a new chat (v3.4.135, 2026-10-02)

## What this package is
Full project zip, v3.4.132. `audit_deploy.js` 380/380. v3.4.131 (Home -> N/S/E/W context/streets fix) passed `runSmokeBothSides()` 327/327 on Joe's localhost (context OFF 158, ON 169, incl. Phase 10). v3.4.130 (before this fix) passed `runSmokeBothSides()` 295/295 and `runSoakTest({cycles:300})` 0 violations (no box, and with a drawn box + Manhattan context ON) on district-1, in Joe's own foreground tab. v3.4.131 itself has NOT been run through smoke/soak or confirmed on Joe's reload; its fix was checked live only by patching the same two lines into the served v3.4.130 HTML in memory.

## v3.4.135 -- Grand Central Terminal exempted
`TRANSIT_KEEP_IDS` (index.html) lists Overture building ids the street rule never drops; it has Grand Central only. Joe may want Port Authority (district-4 f78c98b4) and the two Park Ave parts (district-5 66393436, 34623232) added. See CHANGELOG.md v3.4.135.

## v3.4.134 -- station/transport footprints over streets
Midtown showed building masses where streets should be. Cause: Overture `train_station`/`transportation` footprints drawn over the streets above stations. Joe chose to drop those covering > 50 m of street; implemented as dropTransitOverStreets() (bridge_structure exempt). It also removes Grand Central Terminal, Port Authority and two tall Park Ave parts in Midtown, by design. `?transit=keep` disables it. Details: CHANGELOG.md v3.4.134.

## STATUS v3.4.133 (Terrain) -- read first
New **Terrain** toggle (Display, off by default). Full details in CHANGELOG.md v3.4.133. Verified on Joe's localhost ONLY by patching the same edits into the served v3.4.132 page in memory (hidden Claude-in-Chrome tab): Terrain on for district-1 (TriBeCa/FiDi) and Inwood, compute with terrain (143k / 243k triangles), N/S/E/W with the terrain-following skyline, `runSmokeBothSides` on Inwood WITH terrain on: 153/153 (context OFF) + 169/169 (context ON). NOT yet confirmed on Joe's own reload, not yet run in a foreground tab, and no visual sign-off.
Known gaps: no earth poche under the ground line in sections (the red line is the ground); ~16 m grid; terrain compute is slower than flat; stage timings are in window.__tt after each compute.
Grid-rotation bug FIXED in 133 (GRID_COS/GRID_SIN now follow each district's angle; every district other than ~28.96deg is rotated slightly differently than in 132, streets now axis-aligned). Check a couple of districts visually.
Test with terrain: click Terrain, (wait), Compute, then `await runSmokeBothSides('x')` -- smoke does not click the Terrain button itself.

## Known pre-existing test finding (not caused by 133)
Greenwich Village, context ON, smoke Phase 6 "gap box, stale threshold, compass nav*": `section is not empty (skyline maxZ > 0) -- maxZ=0` (4 distinct checks, 5 failures). Reproduced identically on the UNFIXED served v3.4.132 (A/B), so it predates the grid-rotation fix and terrain. Context OFF passes 158/158 there. Cause not investigated: most likely the "gap midpoint" box lands in a stretch with no buildings in that district (a legitimate empty section, a test-premise problem) -- but if the app should still show something in that case, it is a real "stranded user" bug. Other districts (district-1, Midtown, Upper East Side, Inwood, Chelsea) pass 158 + 169.

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
