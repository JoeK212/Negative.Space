/* ============================================================================
   Negative Space -- live smoke test
   ============================================================================
   v3.4.111 (rewritten v3.4.112). Joe: "we need to catch these issues upfront before deployment,"
   after four separate bugs (v3.4.105-110) each lived in a COMBINATION of
   states -- compute status x display mode x view direction x box-or-not x
   Major Streets -- that nothing had exercised together before shipping.
   Every one of those four was a cell in this exact matrix that hadn't been
   visited yet:
     - v3.4.105/106: pre-compute x Buildings x N/S/E/W/Plan
     - v3.4.107: post-compute x a drawn box x E/W
     - v3.4.109: post-compute x a drawn box x N/S (a box whose auto-picked
       threshold happened to miss every real building on that axis)
     - v3.4.110: post-compute x a locked elevation x Major Streets on

   This is that matrix, automated. Unlike audit_deploy.js (which runs under
   plain Node against the static index.html source, checking that specific
   lines of code exist), this file runs INSIDE the live browser page --
   Node has no THREE.js scene, no compute pipeline, no DOM to click. Paste
   it into the console of a running instance (or have Claude run it via
   Claude-in-Chrome's javascript_exec), one district at a time.

   ---------------------------------------------------------------------------
   USAGE
   ---------------------------------------------------------------------------
   1. Load the app fresh (a throwaway tab, not whatever session Joe is
      actively using -- this clicks buttons and draws boxes for real).
   2. Pick a district from the neighborhood dropdown (any real one; the
      default TriBeCa/Battery Park/FiDi on first load is fine).
   3. Paste this whole file into the console, or:
        await runSmokeTest()
      It returns a summary object and also prints a pass/fail report in the
      same style as audit_deploy.js's console output.
   4. Run this BEFORE packaging any change that touches: applySectionMode(),
      setOrthogonalView(), the box-draw workflow, capQuadBounds(),
      getCutAxisClipPlanes(), getSectionRanges(), or updateStreetLabelVisibility().
      Those are the functions every one of the four bugs above lived in.

   This checks STATE (visibility flags, clipping-plane counts, real bounding
   boxes against real building data), not pixels -- it can't see a screenshot
   and doesn't replace one. Cross-reference against an actual screenshot for
   anything it flags, and still do a final manual look before calling
   something fixed, same as every fix this project has shipped.
   ============================================================================ */

// Chrome pauses timers/animation frames in a hidden tab, which made an earlier
// version of this test crawl (minutes per district) and would stall the app's
// own per-frame self-heal. A MessageChannel loop isn't throttled the same way.
function smokeWait(ms){
  return new Promise(res => {
    const end = performance.now() + ms, mc = new MessageChannel();
    mc.port1.onmessage = () => { if (performance.now() >= end) res(); else mc.port2.postMessage(0); };
    mc.port2.postMessage(0);
  });
}

// Switch district through the real dropdown (no reload), so window state and
// this function survive. Pass the start of the district name.
async function smokeSwitchDistrict(prefix){
  const NS = window.__NS;
  document.getElementById('neighborhoodBtn').click();
  await smokeWait(300);
  const el = Array.from(document.querySelectorAll('body *')).find(e => e.children.length === 0 && e.textContent.trim().startsWith(prefix) && e.id !== 'neighborhoodBtn');
  if (!el) return 'option not found: ' + prefix;
  el.click();
  for (let i = 0; i < 120; i++){
    await smokeWait(500);
    if (document.getElementById('neighborhoodBtn').textContent.trim().startsWith(prefix) && NS.solidGroup && !NS.negativeMesh){ await smokeWait(1500); return 'switched'; }
  }
  return 'timeout switching to ' + prefix;
}

// Build a box whose midpoint on BOTH cut axes sits in a street gap (nothing
// crosses that line within +-2m inside the box's footprint) -- the exact
// geometry behind Joe's UES screenshot. A "typical" box usually has valid
// midpoints and sails through, so a sweep over a typical box proves nothing
// about this bug (v3.4.112: the first version of Phase 6 used a typical box
// and passed on the broken build). Returns null if the district has no such
// spot near its center.
function smokeFindGapBox(bboxes, near, H){
  const SLAB = 2;
  const crossesX = (x, y0, y1) => bboxes.some(b => b.xMax >= x - SLAB && b.xMin <= x + SLAB && b.yMax >= y0 && b.yMin <= y1);
  const crossesY = (y, x0, x1) => bboxes.some(b => b.yMax >= y - SLAB && b.yMin <= y + SLAB && b.xMax >= x0 && b.xMin <= x1);
  const hasBuildingsInside = (x, y) => bboxes.some(b => b.xMax >= x - H && b.xMin <= x + H && b.yMax >= y - H && b.yMin <= y + H);
  for (let r = 0; r <= 300; r += 8){
    for (let dx = -r; dx <= r; dx += 8){
      for (const dy of (Math.abs(dx) === r ? Array.from({length: 2 * r / 8 + 1}, (_, i) => -r + i * 8) : [-r, r])){
        const x = near.cx + dx, y = near.cy + dy;
        if (!hasBuildingsInside(x, y)) continue;
        if (crossesX(x, y - H, y + H) || crossesY(y, x - H, x + H)) continue;
        return { cx: x, cy: y };
      }
    }
  }
  return null;
}

async function runSmokeTest(label, opts = {}){
  const ctxOn = opts.context === 'on'; // v3.4.115: which side of the Manhattan-context toggle this pass tests
  const results = []; let pass = 0, fail = 0;
  const check = (name, ok, detail) => { results.push({ name, pass: !!ok, detail: detail || '' }); if (ok) pass++; else fail++; console.log((ok ? '  [pass] ' : '  [FAIL] ') + name + (detail ? ' -- ' + detail : '')); };
  const wait = smokeWait;
  const NS = window.__NS;
  if (!NS) return { label, pass: 0, fail: 1, results: [{ name: 'window.__NS exists', pass: false }] };
  const click = id => { const el = document.getElementById(id); if (!el) throw new Error('#' + id + ' not found'); el.click(); };
  const THREE = NS.THREE;

  // v3.4.115: Joe -- "we need to examine both sides, Manhattan and Non Manhattan."
  // The Manhattan context layer changes framing, backdrop and which camera/state
  // the views run through, so every view must be checked with it ON and OFF.
  // (v3.4.114's fix was found and first verified on the ON side only.)
  const ctxIsOn = () => document.getElementById('viewBoroughs').classList.contains('active');
  async function setContext(on){
    if (ctxIsOn() !== on){ click('viewBoroughs'); await wait(900); }
  }
  // With context ON, Plan frames the whole ~20km island, so a 180m box would be
  // ~7px wide. A real user zooms in first; do the same: fit Plan to the site.
  async function goPlan(){
    click('navPlan'); await wait(300);
    if (ctxIsOn()){
      const oc = NS.orthoCamera;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const b of bboxes){ x0 = Math.min(x0, b.xMin); x1 = Math.max(x1, b.xMax); y0 = Math.min(y0, b.yMin); y1 = Math.max(y1, b.yMax); }
      oc.zoom = (oc.top - oc.bottom) / (Math.max(x1 - x0, y1 - y0) * 1.4);
      oc.updateProjectionMatrix(); await wait(150);
    }
  }

  // Buildings / Negative space are independent toggles, not a radio pair.
  async function setMode(mode){
    const other = mode === 'viewSolid' ? 'viewNegative' : 'viewSolid';
    if (!document.getElementById(mode).classList.contains('active')) click(mode);
    if (document.getElementById(other).classList.contains('active')) click(other);
    await wait(100);
  }
  // Real pointer drag on the canvas (box-draw is driven by pointer events).
  function drag(x0, y0, x1, y1, button = 0){
    const canvas = NS.renderer.domElement;
    const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: button === 0 ? 1 : 2, pointerType: 'mouse', button, buttons: type === 'pointerup' ? 0 : (button === 0 ? 1 : 2) }));
    fire('pointerdown', x0, y0); fire('pointermove', (x0 + x1) / 2, (y0 + y1) / 2); fire('pointermove', x1, y1); fire('pointerup', x1, y1);
  }
  // The red skyline line is built from the same section profile that drives
  // the poche cutout. Its tallest point is 0 exactly when the section is
  // EMPTY (nothing crosses the cut) -- the flat, holeless block of
  // v3.4.109 / v3.4.112. This is a much stronger signal than "a quad is
  // visible", which is true even for an empty section.
  function skylineMaxZ(){
    let f = null; NS.scene.traverse(o => { if (o.isLineSegments && o.material?.color?.getHexString() === 'ff0000') f = o; });
    if (!f) return -1;
    const p = f.geometry.attributes.position; let m = 0;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > m) m = p.getZ(i);
    return m;
  }
  const bboxes = NS.solidGroup.children.map(m => { const b = new THREE.Box3().setFromObject(m); return { xMin: b.min.x, xMax: b.max.x, yMin: b.min.y, yMax: b.max.y }; });
  function crossing(axis, box){
    const lo = axis === 'x' ? (box ? box.yMin : -Infinity) : (box ? box.xMin : -Infinity);
    const hi = axis === 'x' ? (box ? box.yMax : Infinity) : (box ? box.xMax : Infinity);
    return bboxes.some(b => { const a = axis === 'x' ? b.yMin : b.xMin, z = axis === 'x' ? b.yMax : b.xMax; return z >= lo && a <= hi; });
  }
  // Box centered on the building nearest the mean of all building centers, so
  // it lands on real buildings in any district (not on water).
  let mx = 0, my = 0; bboxes.forEach(b => { mx += (b.xMin + b.xMax) / 2; my += (b.yMin + b.yMax) / 2; }); mx /= bboxes.length; my /= bboxes.length;
  let best = null, bd = Infinity;
  bboxes.forEach(b => { const cx = (b.xMin + b.xMax) / 2, cy = (b.yMin + b.yMax) / 2, d = Math.hypot(cx - mx, cy - my); if (d < bd){ bd = d; best = { cx, cy }; } });

  console.log('\nSetup');
  check('solidGroup exists', bboxes.length > 0, bboxes.length + ' meshes');
  check('streetsGroup exposed on __NS (v3.4.111+)', NS.streetsGroup !== undefined);
  const pre = !!NS.negativeMesh;
  if (!pre){
    console.log('\nPhase 1 -- pre-compute Buildings nav (v3.4.105/106)');
    for (const d of ['navN','navS','navE','navW','navPlan']){ click(d); await wait(150); check('pre-compute ' + d + ': solidGroup visible', NS.solidGroup.visible === true); }
    console.log('\nPhase 2 -- compute');
    click('computeBtn');
    let w = 0; while (!NS.negativeMesh && w < 180000){ await wait(1000); w += 1000; }
  }
  check('negativeMesh exists after compute', !!NS.negativeMesh);
  if (!NS.negativeMesh) return { label, pass, fail, results };
  await setContext(ctxOn);
  check('Manhattan context is ' + (ctxOn ? 'ON' : 'OFF') + ' for this pass', ctxIsOn() === ctxOn);

  console.log('\nPhase 3 -- full-site nav, both modes, no box');
  click('navPlan'); await wait(200);
  check('streets visible in Plan', NS.streetsGroup?.visible === true);
  for (const sm of ['viewSolid', 'viewNegative']){
    click('navPlan'); await wait(100); await setMode(sm);
    for (const d of ['navN','navS','navE','navW','navPlan']){
      click(d); await wait(150);
      const axis = NS.sectionModeAxis, bActive = document.getElementById('viewSolid').classList.contains('active');
      const L = (sm === 'viewSolid' ? 'Bldg' : 'Neg') + '->' + d;
      // post-compute, entering a locked elevation deliberately switches to
      // Negative space (v3.4.31/48) -- read the mode actually active.
      if (bActive) check(L + ': solidGroup visible', NS.solidGroup.visible === true);
      else if (axis !== null){
        const g = NS.capFillGroups[axis];
        check(L + ': ' + axis + ' fill shows', !!(g.userData.quad?.visible || g.userData.outline?.visible));
        check(L + ': section is not empty (skyline maxZ > 0)', skylineMaxZ() > 0, 'maxZ=' + Math.round(skylineMaxZ() * 10) / 10);
      }
      check(L + ': streets ' + (axis === null ? 'shown' : 'hidden'), axis === null ? NS.streetsGroup?.visible === true : NS.streetsGroup?.visible === false);
      if (ctxOn){
        const ac = NS.activeCamera;
        check(L + ': Manhattan context ' + (axis === null ? 'shown in Plan' : 'hidden in a locked elevation'), NS.boroughsGroup?.visible === (axis === null));
        if (axis !== null) check(L + ': elevation frames the site, not the ~20km island', ac.isOrthographicCamera && (ac.top - ac.bottom) / ac.zoom < 8000, 'frustumH=' + Math.round((ac.top - ac.bottom) / ac.zoom));
      } else {
        check(L + ': Manhattan context stays hidden when its toggle is off', NS.boroughsGroup?.visible === false);
      }
    }
  }

  console.log('\nPhase 4 -- right-drag in box-draw mode must pan, not draw (v3.4.108)');
  await goPlan(); click('drawBoxBtn'); await wait(100);
  if (NS.boxDrawMode){ const r = NS.renderer.domElement.getBoundingClientRect(); drag(r.left + r.width/2 - 40, r.top + r.height/2 - 40, r.left + r.width/2 + 40, r.top + r.height/2 + 40, 2); await wait(150); check('right-drag creates no box', NS.pendingPlanBox === null); }
  else check('box-draw mode entered', false);

  console.log('\nPhase 5 -- drawn box: picker in all directions, both modes (v3.4.107/109)');
  const cam = NS.activeCamera; cam.updateMatrixWorld(); const rect = NS.renderer.domElement.getBoundingClientRect();
  const toPx = (x, y) => { const v = new THREE.Vector3(x, y, 0).project(cam); return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height]; };
  const H = 90; const [px0, py0] = toPx(best.cx - H, best.cy + H), [px1, py1] = toPx(best.cx + H, best.cy - H);
  const redraw = async () => { await goPlan(); if (!NS.boxDrawMode) click('drawBoxBtn'); await wait(100); drag(px0, py0, px1, py1, 0); await wait(150); };
  if (!NS.boxDrawMode) click('drawBoxBtn'); await wait(100); drag(px0, py0, px1, py1, 0); await wait(150);
  check('box drawn on real buildings', !!NS.pendingPlanBox);
  if (NS.pendingPlanBox){
    for (const mode of ['viewSolid', 'viewNegative']){
      await setMode(mode); if (!NS.pendingPlanBox) await redraw();
      for (const [btn, dir] of [['boxViewN','N'],['boxViewS','S'],['boxViewE','E'],['boxViewW','W']]){
        if (!document.getElementById(btn)){ check('picker ' + btn + ' present', false); continue; }
        click(btn); await wait(150);
        const axis = NS.sectionModeAxis, box = NS.activeSectionBox, bActive = document.getElementById('viewSolid').classList.contains('active');
        const L = 'box ' + (mode === 'viewSolid' ? 'Bldg' : 'Neg') + '->' + dir;
        if (bActive) check(L + ': solidGroup visible', NS.solidGroup.visible === true);
        else {
          const g = NS.capFillGroups[axis];
          check(L + ': ' + axis + ' fill shows', !!(g.userData.quad?.visible || g.userData.outline?.visible));
          check(L + ': section is not empty (skyline maxZ > 0)', skylineMaxZ() > 0, 'maxZ=' + Math.round(skylineMaxZ() * 10) / 10);
        }
        check(L + ': building overlaps box range', crossing(axis, box));
        // v3.4.116: every building whose FOOTPRINT is in the box must now cross
        // the section slab too (slab = the box's own full cut-axis depth) --
        // this is what Joe's "more forms in plan than elevation" bug looked
        // like: some were previously left out by the old 2m sliver.
        if (!bActive){
          const inFootprint = bboxes.filter(b => b.xMax >= box.xMin && b.xMin <= box.xMax && b.yMax >= box.yMin && b.yMin <= box.yMax);
          const slabLo = axis === 'x' ? box.xMin : box.yMin, slabHi = axis === 'x' ? box.xMax : box.yMax;
          const allCross = inFootprint.every(b => { const a = axis === 'x' ? b.xMin : b.yMin, z = axis === 'x' ? b.xMax : b.yMax; return z >= slabLo && a <= slabHi; });
          check(L + ': every building in the box footprint crosses the section slab (v3.4.116)', allCross, inFootprint.length + ' in footprint');
        }
        check(L + ': streets hidden', NS.streetsGroup?.visible === false);
        if (ctxOn) check(L + ': Manhattan context hidden', NS.boroughsGroup?.visible === false);
        await redraw();
      }
    }
  }

  // v3.4.113: Joe -- "cannot drag shape handle North & South edges." On a
  // tall narrow box the grab zone (1.5% of the district span, ~60m) covered the
  // whole width, and W/E were tested first, so N/S were unreachable: dragging
  // the north edge moved the WEST edge. Every edge of both a narrow and a wide
  // box must move on its own, and nothing else may move.
  console.log('\nPhase 7 -- box edge handles: each edge drags on its own, narrow and wide boxes (v3.4.113)');
  for (const [shape, hw, hh] of [['tall narrow', 50, 150], ['wide short', 150, 50]]){
    for (const side of ['yMax', 'yMin', 'xMin', 'xMax']){
      // clear any pending box first -- a leftover one near the new box's
      // corners would swallow the pointerdown as an edge grab
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel')?.click(); await wait(100);
      await goPlan();
      if (!NS.boxDrawMode) click('drawBoxBtn'); await wait(100);
      const c7 = NS.activeCamera; c7.updateMatrixWorld(); const r7 = NS.renderer.domElement.getBoundingClientRect();
      const px7 = (x, y) => { const v = new THREE.Vector3(x, y, 0).project(c7); return [r7.left + (v.x + 1) / 2 * r7.width, r7.top + (1 - v.y) / 2 * r7.height]; };
      const [ea, eb] = px7(best.cx - hw, best.cy + hh), [ec, ed] = px7(best.cx + hw, best.cy - hh);
      drag(ea, eb, ec, ed); await wait(200);
      const pb = NS.pendingPlanBox;
      if (!pb){ check(shape + ': drag ' + side, false, 'no box drawn'); continue; }
      const b0 = { ...pb }, mx7 = (b0.xMin + b0.xMax) / 2, my7 = (b0.yMin + b0.yMax) / 2;
      const from = { yMax: [mx7, b0.yMax], yMin: [mx7, b0.yMin], xMin: [b0.xMin, my7], xMax: [b0.xMax, my7] }[side];
      const to = { yMax: [mx7, b0.yMax + 30], yMin: [mx7, b0.yMin - 30], xMin: [b0.xMin - 30, my7], xMax: [b0.xMax + 30, my7] }[side];
      const [fx, fy] = px7(...from), [tx, ty] = px7(...to);
      drag(fx, fy, tx, ty); await wait(200);
      const b1 = NS.pendingPlanBox;
      const mv = k => Math.round(Math.abs(b1[k] - b0[k]) * 10) / 10;
      const others = ['xMin', 'xMax', 'yMin', 'yMax'].filter(k => k !== side);
      check(shape + ': drag ' + side + ' moves only that edge', mv(side) > 20 && others.every(k => mv(k) < 3), side + ' moved ' + mv(side) + '; others ' + others.map(k => k + ' ' + mv(k)).join(', '));
    }
  }
  Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel')?.click(); await wait(100);

  // v3.4.112: the path that was NOT covered before -- pick one direction with
  // the box picker, then switch axes with the COMPASS buttons (Joe: box, W,
  // then S). The compass runs through setOrthogonalView(), a different entry
  // point from the picker; v3.4.109's fix only reached the picker. Uses an
  // adversarial box (both midpoints in street gaps) so the sweep actually
  // exercises the failure instead of passing on a lucky box.
  console.log('\nPhase 6 -- compass buttons after a gap-midpoint box (v3.4.112)');
  const gap = smokeFindGapBox(bboxes, best, 90);
  if (!gap){
    console.log('  (no gap-midpoint box found near the center of this district -- Phase 6 skipped, not failed)');
  } else {
    await goPlan();
    const cam2 = NS.activeCamera; cam2.updateMatrixWorld();
    const toPx2 = (x, y) => { const v = new THREE.Vector3(x, y, 0).project(cam2); return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height]; };
    const [gx0, gy0] = toPx2(gap.cx - 90, gap.cy + 90), [gx1, gy1] = toPx2(gap.cx + 90, gap.cy - 90);
    await setMode('viewNegative');
    if (!NS.boxDrawMode) click('drawBoxBtn'); await wait(100);
    drag(gx0, gy0, gx1, gy1, 0); await wait(200);
    check('gap-midpoint box drawn', !!NS.pendingPlanBox);
    if (NS.pendingPlanBox){
      click('boxViewW'); await wait(400);
      // A fresh session starts every threshold at 0, which is OUTSIDE almost
      // any box -- that stale value is what the compass path has to recover
      // from. Leftover thresholds from earlier phases can sit inside the box
      // and hide the bug (the first version of this sweep passed on the broken
      // build for exactly that reason), so force it before every step.
      const poke = id => { const sl = document.getElementById(id); const was = sl.disabled; sl.disabled = false; sl.value = sl.min; sl.dispatchEvent(new Event('input', { bubbles: true })); sl.disabled = was; };
      for (const [ax, d] of [['y','navS'],['y','navN'],['x','navE'],['x','navW'],['y','navS']]){
        poke(ax === 'x' ? 'xClipSlider' : 'yClipSlider');
        click(d); await wait(500);
        const axis = NS.sectionModeAxis;
        const g = NS.capFillGroups[axis];
        const L = 'gap box, stale threshold, compass ' + d;
        check(L + ': fill shows', !!(g.userData.quad?.visible || g.userData.outline?.visible));
        check(L + ': section is not empty (skyline maxZ > 0)', skylineMaxZ() > 0, 'maxZ=' + Math.round(skylineMaxZ() * 10) / 10);
        const sl = document.getElementById(axis === 'x' ? 'xClipSlider' : 'yClipSlider');
        check(L + ': active-axis slider is enabled (never strand the user)', sl && !sl.disabled);
      }
    }
  }

  // v3.4.114: Joe -- N/S/E/W "not correct" with Manhattan context on. The
  // island plate (an extruded ~0.92-opacity slab) was never gated by view mode,
  // so it rendered behind every elevation and the building holes showed gray
  // slab instead of open background. Must be hidden in a locked elevation,
  // visible in Plan, and elevations must frame the site, not the ~20km island.
  // Runs on BOTH sides: it toggles the layer itself, then restores this pass's
  // side (v3.4.115).
  console.log('\nPhase 8 -- Manhattan context toggled through every view (v3.4.114/115)');
  await setContext(true);
  click('navPlan'); await wait(400);
  check('context layer visible in Plan when the toggle is on', NS.boroughsGroup?.visible === true);
  for (const d of ['navN','navS','navE','navW']){
    click(d); await wait(500);
    const ac = NS.activeCamera;
    check('context layer hidden in locked elevation ' + d, NS.boroughsGroup?.visible === false);
    check(d + ': elevation frames the site, not the whole island (ortho frustum < 8000m)', ac.isOrthographicCamera && (ac.top - ac.bottom) / ac.zoom < 8000, 'frustumH=' + Math.round((ac.top - ac.bottom) / ac.zoom));
  }
  click('navPlan'); await wait(400);
  check('context layer comes back when returning to Plan', NS.boroughsGroup?.visible === true);
  await setContext(false);
  check('context layer stays off when toggled off', NS.boroughsGroup?.visible === false);
  click('navPlan'); await wait(300);
  await setContext(ctxOn);

  // v3.4.117: Joe -- "elevation is showing artifacts" -- Buildings AND
  // Negative space BOTH switched on at once, a box active, N view. Every
  // prior phase's setMode() deliberately keeps exactly one of these two
  // toggles on; this is the one combination nothing had ever exercised,
  // and it's where the bug lived (buildingXCapMaterial/buildingYCapMaterial
  // never box-scoped). Draws its own box so it isn't dependent on
  // whatever redraw() last left behind.
  console.log('\nPhase 9 -- Buildings and Negative space both on at once, a box active (v3.4.117)');
  await redraw();
  if (!document.getElementById('viewSolid').classList.contains('active')) click('viewSolid');
  if (!document.getElementById('viewNegative').classList.contains('active')) click('viewNegative');
  await wait(200);
  if (NS.pendingPlanBox){
    for (const [btn, dir] of [['boxViewN','N'],['boxViewS','S'],['boxViewE','E'],['boxViewW','W']]){
      if (!document.getElementById(btn)) continue;
      click(btn); await wait(200);
      const axis = NS.sectionModeAxis;
      const g = NS.capFillGroups[axis];
      const L = 'both-on box->' + dir;
      check(L + ': solidGroup visible', NS.solidGroup.visible === true);
      check(L + ': ' + axis + ' fill shows', !!(g.userData.quad?.visible || g.userData.outline?.visible));
      check(L + ': section is not empty (skyline maxZ > 0)', skylineMaxZ() > 0, 'maxZ=' + Math.round(skylineMaxZ() * 10) / 10);
      // the actual v3.4.117 check: nothing visible in the scene should have
      // real-world geometry outside the box's plotted range on this axis at
      // the height band the box covers -- approximated by checking both
      // building cap materials' clipping planes actually bound to the box
      // whenever a box is active, the same way solidGroup's own do.
      const capsBoxScoped = (mat) => {
        if (!mat || !mat.clippingPlanes) return true;
        const b = NS.activeSectionBox;
        const plotLo = axis === 'x' ? b.yMin : b.xMin, plotHi = axis === 'x' ? b.yMax : b.xMax;
        return mat.clippingPlanes.some(p => Math.abs(p.constant + plotLo) < 1 || Math.abs(p.constant - plotHi) < 1);
      };
      let xCapMat = null, yCapMat = null;
      NS.scene.traverse(o => {
        if (o.type !== 'Mesh' || !o.material?.clippingPlanes) return;
        if (o.material.clippingPlanes.includes(NS.yClipPlaneNeg)) xCapMat = o.material;
        if (o.material.clippingPlanes.includes(NS.xClipPlaneNeg)) yCapMat = o.material;
      });
      check(L + ': building cut-face caps are box-scoped', capsBoxScoped(xCapMat) && capsBoxScoped(yCapMat));
      await redraw();
      if (!document.getElementById('viewSolid').classList.contains('active')) click('viewSolid');
      if (!document.getElementById('viewNegative').classList.contains('active')) click('viewNegative');
      await wait(200);
    }
  } else check('both-on box available for Phase 9', false);
  if (document.getElementById('viewSolid').classList.contains('active') !== true) click('viewSolid');
  if (document.getElementById('viewNegative').classList.contains('active')) click('viewNegative');

  click('navE'); await wait(150); click('viewStreets'); await wait(100); click('viewStreets'); await wait(100);
  check('streets toggle inside a locked elevation stays hidden', NS.streetsGroup?.visible === false);
  Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Full width')?.click();
  Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel')?.click();
  click('navPlan');

  console.log('\n' + '='.repeat(60));
  console.log(label ? label + ': ' : '', pass + '/' + (pass + fail) + ' checks passed');
  return { label, pass, fail, results };
}

// Run one district, BOTH context sides (the standing rule):  await runSmokeBothSides('name');
// One side only:               await runSmokeTest('name', { context: 'off' })   // or 'on'
// Run several (no reload):     for (const d of ['Midtown','Inwood']){ await smokeSwitchDistrict(d); await runSmokeTest(d); }

// v3.4.115: Joe's rule -- examine both sides, Manhattan context ON and OFF. The
// first pass computes; the second reuses the computed district.
async function runSmokeBothSides(label){
  const off = await runSmokeTest(label + ' [context OFF]', { context: 'off' });
  const on = await runSmokeTest(label + ' [context ON]', { context: 'on' });
  console.log('BOTH SIDES:', label, '| OFF', off.pass + '/' + (off.pass + off.fail), '| ON', on.pass + '/' + (on.pass + on.fail));
  return { label, off, on, pass: off.pass + on.pass, fail: off.fail + on.fail };
}
