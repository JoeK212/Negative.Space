/* ============================================================================
   Negative Space -- live SOAK test (for the intermittent N/S/E/W bug)
   ============================================================================
   v3.4.112. The classic intermittent bug (solid unclipped block / flat-empty
   skyline / stray band) was last confirmed recurring at v3.4.47 and has never
   been shown fixed -- only "several clicks didn't reproduce it." A handful of
   clicks proves nothing about a timing race. This runs HUNDREDS of randomized
   transitions with randomized inter-click delays (including 0ms, i.e. faster
   than one rendered frame) and, after every transition settles, checks the
   invariants a healthy locked section must satisfy -- the same invariants
   the known past failures violated:

     - the active axis's cap-fill group shows a quad or an outline
     - the OTHER axes' groups and the Height-Cut (z) group are hidden
     - negativeMesh (ghost shell) is hidden in a locked elevation
     - the active quad's skyUniforms.uSkyDiscardOn === 1 (v3.4.16/26/27: a
       recompile silently reset it to 0 -> solid unclipped block)
     - Major Streets hidden in a locked elevation (v3.4.110)
   and, for axis === null (Plan/Home): no cap group left stuck visible that
   belongs to a locked view.

   Any violation is recorded WITH the exact preceding action sequence, so a
   hit is directly replayable rather than a "saw it once" report.

   USAGE: load a district, Compute, then paste this file and run
        await runSoakTest({ cycles: 300 })
   Returns { cycles, violations: [...], sample }. Keep the tab in the
   FOREGROUND: Chrome throttles background tabs (rAF pauses), which stalls
   the per-frame self-heal and would produce false positives.
   ============================================================================ */
async function runSoakTest(opts = {}){
  const cycles = opts.cycles || 300;
  const settleMs = opts.settleMs || 700;
  const NS = window.__NS;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = id => { const el = document.getElementById(id); if (el && !el.disabled) el.click(); };
  if (!NS.negativeMesh) return { error: 'Compute first' };

  // v3.4.133 (test only): navHome added. Every earlier soak entered an elevation via Plan (already the ortho camera), so it could not see the v3.4.131 bug (elevation entered from the PERSPECTIVE/Home camera left the Manhattan layer + streets visible). Start with Manhattan context ON for the strongest run.
  const moves = ['navN','navS','navE','navW','navPlan','navN','navS','navE','navW','navHome','navHome','navHome'];
  const violations = [];
  const history = [];
  let seed = opts.seed || 1234567;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

  function invariants(){
    const bad = [];
    const axis = NS.sectionModeAxis;
    const neg = document.getElementById('viewNegative').classList.contains('active');
    if (axis === null) return bad;
    if (NS.negativeMesh.visible) bad.push('negativeMesh visible in a locked elevation');
    if (NS.streetsGroup && NS.streetsGroup.visible) bad.push('streets visible in a locked elevation');
    if (NS.boroughsGroup && NS.boroughsGroup.visible) bad.push('Manhattan context layer visible in a locked elevation');
    if (!neg) return bad; // buildings-only view has no poche to check
    const g = NS.capFillGroups[axis];
    const showing = !!(g.userData.quad?.visible || g.userData.outline?.visible);
    if (!g.visible) bad.push('active axis group hidden');
    if (!showing) bad.push('active axis shows neither quad nor outline (flat-empty)');
    for (const k of ['x','y','z']) if (k !== axis && NS.capFillGroups[k].visible) bad.push('stray visible group: ' + k);
    const su = g.userData.quad?.material?.userData?.skyUniforms;
    if (g.userData.quad?.visible && su && su.uSkyDiscardOn.value !== 1) bad.push('uSkyDiscardOn=' + su.uSkyDiscardOn.value + ' (solid unclipped block)');
    return bad;
  }

  for (let i = 0; i < cycles; i++){
    // a burst of 1-4 rapid actions with random (often sub-frame) delays
    const burst = 1 + Math.floor(rnd() * 4);
    for (let j = 0; j < burst; j++){
      const m = moves[Math.floor(rnd() * moves.length)];
      click(m); history.push(m);
      if (rnd() < 0.15){ const t = rnd() < 0.5 ? 'viewNegative' : 'viewSolid'; click(t); history.push(t); }
      await wait(Math.floor(rnd() * 3) === 0 ? 0 : Math.floor(rnd() * 250));
    }
    await wait(settleMs);
    const bad = invariants();
    if (bad.length) violations.push({ cycle: i, axis: NS.sectionModeAxis, problems: bad, lastActions: history.slice(-8) });
    if (history.length > 200) history.splice(0, history.length - 50);
  }
  return { cycles, violationCount: violations.length, violations: violations.slice(0, 20) };
}
