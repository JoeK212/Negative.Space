# Negative Space -- handoff for a new chat (v3.4.130, 2026-10-01)

## What this package is
Full project zip, v3.4.130. `audit_deploy.js` 376/376. `runSmokeBothSides()` passed 290/290 (Manhattan context OFF 137, ON 153) with the unlit poché patched into the page in memory. NOT yet confirmed on Joe's own reload.

## What to do first (Joe)
1. Extract the zip and swap it into the folder served at http://localhost:8888/ . Hard-refresh (Ctrl+Shift+R). The footer should read **v3.4.130**.
2. Eyeball the poché in every view: Plan, Home, and N/S/E/W elevations, with Manhattan context ON and OFF. It should be red everywhere. Before 130 it was sometimes pale gray-blue in elevations (v3.4.127/128).
3. In an elevation with Manhattan context ON, the tan ground plate should be the base under the section (v3.4.129).
4. Run in your own FOREGROUND tab: `await runSoakTest({ cycles: 300 })` (paste soak_test.js first). Send any violations.
5. Run `runSmokeBothSides()` (paste smoke_test.js first) and send the totals.

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

## Still open
- Intermittent N/S/E/W rendering bug: open until Joe's own local testing says otherwise (soak test not yet returned a result).
- Wide-box N/S fill fix: diagnosed from the code path, not reproduced by hand.
- Possible, unconfirmed: street-name labels visible at ground level in a South view with no box drawn; that same view came out tiny/unframed.
- Not done: GitHub/Netlify not updated; AUDIT.md only has a short v3.4.126 entry (127-130 are in CHANGELOG.md).

## Standing rules (Joe)
- Ask before packaging; when he says yes, deliver the FULL zip (entire project).
- Never call something fixed on code review alone -- only Joe's local live testing (or a direct repro on his connected browser) confirms it.
- Any change touching section/box/view code needs `runSmokeBothSides()` (Manhattan context ON and OFF).
- Sections follow architectural convention: solid cut fill, continuous ground at the base, streets as open gaps at grade, no street layer in elevations (Major streets stay hidden there). Apply by default; do not ask again.
- Keep Randalls/Wards/Roosevelt Island buildings as they are.
- Joe's focus is the island of Manhattan, not other boroughs.
- Keep answers short and direct.
- The Claude-in-Chrome tab runs on Joe's own machine: ask before connecting, and note that navigating reloads his page.
