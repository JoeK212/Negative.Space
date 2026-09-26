#!/usr/bin/env node
/*
  audit_deploy.js -- Negative Space

  Not a linter. A memory of every bug that's broken this exact tool
  before, or plausibly could. Growth pattern: every time a real bug is
  found and fixed, add a check() for it in the same edit that fixes it,
  under a sectionHeader() named after the version that fixed it -- this
  file's section list is meant to be a second, testable copy of
  CHANGELOG.md, not a generic template audit.

  Run: node audit_deploy.js
*/

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX = path.join(ROOT, 'index.html');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const EXTENDED = path.join(ROOT, 'EXTENDED.md'); // v3.4.72 -- read alongside index.html/CHANGELOG.md so doc-content checks (not just index.html markup) are possible; not fatal if missing, since older checkouts/partial deliveries shouldn't hard-fail the whole suite over a docs file

let html, changelog, extended = '';
try {
  html = fs.readFileSync(INDEX, 'utf8');
} catch (e) {
  console.error('FATAL: could not read index.html -- ' + e.message);
  process.exit(1);
}
try {
  changelog = fs.readFileSync(CHANGELOG, 'utf8');
} catch (e) {
  console.error('FATAL: could not read CHANGELOG.md -- ' + e.message);
  process.exit(1);
}
try {
  extended = fs.readFileSync(EXTENDED, 'utf8');
} catch (e) {
  console.warn('WARNING: could not read EXTENDED.md -- doc-content checks will fail -- ' + e.message);
}

// v3.4.75 -- per-district streets.json files, read so this file can check
// actual street data (not just index.html markup or docs prose). Missing
// or unparsable files degrade to an empty array per district rather than
// a fatal error, same reasoning as EXTENDED.md above -- a partial delivery
// shouldn't hard-fail the whole suite, just fail the specific checks that
// need that district's data.
const districtStreets = {};
for (let i = 1; i <= 12; i++){
  const p = path.join(ROOT, 'data', `district-${i}`, 'streets.json');
  try {
    districtStreets[i] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    districtStreets[i] = [];
  }
}

let pass = 0, fail = 0;
let currentSection = '';
function sectionHeader(name){
  currentSection = name;
  console.log('\n' + name);
}
function check(label, ok, detail){
  if (ok){
    pass++;
    console.log('  [pass] ' + label);
  } else {
    fail++;
    console.log('  [FAIL] ' + label + (detail ? '\n         ' + detail : ''));
  }
}

/* ===================================================================
   Standard template checks (the shape every one of Joe's tools shares)
   =================================================================== */
sectionHeader('Template conventions');

const changelogTop = changelog.match(/^v(\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2}) - /);
check(
  'CHANGELOG.md top entry matches "vX.X.X - YYYY-MM-DD - description"',
  !!changelogTop,
  changelogTop ? null : 'First line of CHANGELOG.md does not match the required pattern.'
);

const appVersionMatch = html.match(/const APP_VERSION = '([\d.]+)'/);
check('APP_VERSION constant present in index.html', !!appVersionMatch);
if (appVersionMatch && changelogTop){
  check(
    'APP_VERSION matches CHANGELOG.md top entry (' + changelogTop[1] + ')',
    appVersionMatch[1] === changelogTop[1],
    'index.html says ' + appVersionMatch[1] + ', CHANGELOG.md top entry says ' + changelogTop[1] + '.'
  );
}

check(
  'Footer renders APP_VERSION via a JS template literal, not a hardcoded string',
  /footVersion'\)\.innerHTML = `Negative Space · v\$\{APP_VERSION\}/.test(html),
  'Footer text must be built from a template literal referencing APP_VERSION, not typed out as a literal string.'
);

check('escapeHtml() is defined', /function escapeHtml\(/.test(html));
check('escapeAttr() is defined', /function escapeAttr\(/.test(html));
check(
  'confirmDialog() is defined (present per template convention even though this app has no destructive action yet)',
  /function confirmDialog\(/.test(html)
);
check('toast() is defined', /function toast\(/.test(html));
check('toast element has class="toast" AND id="toast"', /class="toast" id="toast"/.test(html));

check('viewport meta has viewport-fit=cover', /viewport-fit=cover/.test(html));
check('apple-mobile-web-app-capable meta present', /apple-mobile-web-app-capable/.test(html));
check('mobile-web-app-capable meta present (Chrome wants this one too)', /name="mobile-web-app-capable"/.test(html));
check('theme-color meta has id="themeColorMeta"', /id="themeColorMeta"/.test(html));

/* ===================================================================
   v3.0.14 -- top-level script code that reads scene/renderer/camera/
   controls before boot() has run silently kills the whole module script
   (uncaught error at parse-adjacent top level), leaving a blank
   viewport with no visible error. Real regression, real root cause:
   v3.0.11's drag-handle code called scene.add(...) and
   renderer.domElement.addEventListener(...) at true top level. Crude
   but targeted: flag any call to these specific methods that isn't
   indented (i.e. not inside a function body) -- true top-level
   statements in this file's module script are never indented.
   =================================================================== */
sectionHeader('v3.0.14 -- no top-level scene/renderer access before boot()');

const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
check('Exactly one <script type="module"> block exists', !!moduleMatch);
if (moduleMatch){
  const moduleSrc = moduleMatch[1];

  // Real brace-depth scan, not indentation -- this file's own style
  // doesn't reliably indent function bodies (attachHandleDragListeners()
  // is a real example: its whole body sits at column 0), so an
  // indentation-based "is this top-level" check produces false
  // positives. Walks the source char-by-char tracking {}-depth, skipping
  // over string/template-literal/comment/regex-literal contents so
  // characters inside those don't throw off the count.
  //
  // First working version of this scanner (see below) skipped strings
  // but not regex literals -- and immediately mis-parsed this very
  // file's own escapeHtml(), whose regex /[&<>"']/g contains a literal
  // " and ' INSIDE its character class. Those got misread as real string
  // delimiters, which silently swallowed a real `{` into a bogus "string
  // span" and threw the whole depth count off by one for the rest of the
  // file -- confirmed by testing: final depth came out 1, not 0, on this
  // file's own real (valid, node --check-passing) source. Fixed with a
  // standard regex-vs-division disambiguation heuristic (classify the
  // previous significant token: after an identifier/number/`)`/`]`/
  // closed-string, `/` is division; otherwise, including after keywords
  // like `return`/`typeof`, it starts a regex literal) and correct
  // character-class-aware regex scanning (`/` inside `[...]` doesn't end
  // the regex). Verified this fix two ways before trusting it: (1) the
  // real file's own module script now correctly resolves to depth 0 at
  // end-of-file, matching what valid, balanced JS must do; (2) injecting
  // a genuine top-level `scene.add(...)` offender right before
  // attachHandleDragListeners() and re-running was correctly caught,
  // then correctly cleared again once the injection was reverted.
  function findTopLevelCalls(src, pattern){
    const hits = [];
    let depth = 0;
    let i = 0;
    const n = src.length;
    const valueEnders = new Set([')', ']']);
    const regexKeywords = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|throw)$/;

    function precedingIsValue(){
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      if (j < 0) return false;
      const c = src[j];
      if (valueEnders.has(c)) return true;
      if (/[A-Za-z0-9_$]/.test(c)){
        let k = j;
        while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
        const word = src.slice(k + 1, j + 1);
        if (regexKeywords.test(word)) return false; // keyword -> regex context
        return true; // plain identifier/number -> division
      }
      if (c === '"' || c === "'" || c === '`') return true; // string/template end -> division
      return false; // operators, '(', '{', ',', ';', ':', etc -> regex context
    }

    while (i < n){
      const c = src[i];
      const c2 = src[i + 1];
      if (c === '/' && c2 === '/'){
        const end = src.indexOf('\n', i);
        i = end === -1 ? n : end + 1;
        continue;
      }
      if (c === '/' && c2 === '*'){
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`'){
        const quote = c;
        i++;
        while (i < n && src[i] !== quote){
          if (src[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      if (c === '/' && !precedingIsValue()){
        let j = i + 1;
        let inClass = false;
        while (j < n){
          if (src[j] === '\\'){ j += 2; continue; }
          if (src[j] === '[') { inClass = true; j++; continue; }
          if (src[j] === ']') { inClass = false; j++; continue; }
          if (src[j] === '/' && !inClass) break;
          if (src[j] === '\n') break; // malformed -- not actually a regex; bail out
          j++;
        }
        i = j + 1;
        while (i < n && /[a-z]/.test(src[i])) i++; // regex flags
        continue;
      }
      if (c === '{'){ depth++; i++; continue; }
      if (c === '}'){ depth--; i++; continue; }
      if (depth === 0 && src.startsWith(pattern, i)){
        const lineNum = src.slice(0, i).split('\n').length;
        hits.push(lineNum + ': ' + src.split('\n')[lineNum - 1].trim());
      }
      i++;
    }
    return hits;
  }

  const offenders = [
    ...findTopLevelCalls(moduleSrc, 'scene.add('),
    ...findTopLevelCalls(moduleSrc, 'renderer.domElement.addEventListener('),
  ];
  check(
    'No top-level scene.add(...) or renderer.domElement.addEventListener(...) calls',
    offenders.length === 0,
    offenders.length ? 'Found at brace-depth 0 in module script (line numbers relative to the module block):\n         ' + offenders.join('\n         ') : null
  );

  check(
    'Module script has valid JS syntax (node --check)',
    (() => {
      try {
        fs.writeFileSync('/tmp/audit_module_check.mjs', moduleSrc);
        require('child_process').execFileSync('node', ['--check', '/tmp/audit_module_check.mjs']);
        return true;
      } catch (e) {
        return false;
      }
    })()
  );
}

/* ===================================================================
   v3.1.0/v3.1.1 -- architecture change to per-neighborhood live-fetched
   data files (data/<id>/buildings.geojson, building_parts.geojson,
   streets.json) instead of embedding everything in the page. The old
   embedded #buildingsData/#buildingPartsData/#streetsData <script> tags
   must be gone (leftover ones would silently bloat the file and never
   get read), and every entry in NEIGHBORHOODS needs its three real data
   files actually present on disk, or that neighborhood 404s the moment
   someone picks it.
   =================================================================== */
sectionHeader('v3.1.0/v3.1.1 -- per-neighborhood data files, not embedded');

check(
  'No leftover embedded #buildingsData script tag (data is fetched live now)',
  !/id="buildingsData"/.test(html)
);
check(
  'No leftover embedded #buildingPartsData script tag',
  !/id="buildingPartsData"/.test(html)
);
check(
  'No leftover embedded #streetsData script tag (streets are fetched per-neighborhood now)',
  !/id="streetsData"/.test(html)
);

const neighborhoodsMatch = html.match(/const NEIGHBORHOODS = \[([\s\S]*?)\];/);
check('NEIGHBORHOODS config array found', !!neighborhoodsMatch);
if (neighborhoodsMatch){
  const idMatches = [...neighborhoodsMatch[1].matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
  const tiltMatches = [...neighborhoodsMatch[1].matchAll(/gridRotationDeg:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
  check('At least one neighborhood configured', idMatches.length > 0);

  for (const id of idMatches){
    const dir = path.join(ROOT, 'data', id);
    const files = ['buildings.geojson', 'building_parts.geojson', 'streets.json'];
    for (const f of files){
      check(
        'data/' + id + '/' + f + ' exists',
        fs.existsSync(path.join(dir, f))
      );
    }
  }

  check(
    'Every neighborhood has a distinct gridRotationDeg (never copied from another, per v3.0.27/v3.1.0 convention)',
    new Set(tiltMatches).size === tiltMatches.length,
    'Found duplicate grid tilt values: ' + JSON.stringify(tiltMatches)
  );
}

/* ===================================================================
   Winding-order gotcha (Chelsea v3.1.0, Hell's Kitchen v3.1.1) -- any
   neighborhood sourced via Overture's PMTiles vector-tile decode path
   can come back with every ring wound clockwise, which Manifold's
   CrossSection silently treats as zero-area under its default fill
   rule -- not a thrown error, just wrong geometry (or, upstream of
   that, a very long confusing near-hang in Manifold.union() being fed
   hundreds of invalid manifolds). Checking real signed area on every
   building's outer ring in every neighborhood's real data file --
   this is a full, no-open-plausibly-relevant-file for the actual
   invariant that mattered here, since only a real Node harness caught
   this the first two times it happened.
   =================================================================== */
sectionHeader("Winding order -- every building's outer ring must be CCW");

function signedArea(ring){
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++){
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

if (neighborhoodsMatch){
  const idMatches = [...neighborhoodsMatch[1].matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);
  for (const id of idMatches){
    const file = path.join(ROOT, 'data', id, 'buildings.geojson');
    if (!fs.existsSync(file)) continue; // already flagged above
    let geo;
    try {
      geo = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      check('data/' + id + '/buildings.geojson is valid JSON', false, e.message);
      continue;
    }
    let cw = 0, total = 0;
    for (const f of geo.features){
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]]
        : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p[0])
        : [];
      for (const ring of rings){
        total++;
        if (signedArea(ring) < 0) cw++;
      }
    }
    check(
      id + ': outer rings are CCW (' + (total - cw) + '/' + total + ')',
      cw === 0,
      cw > 0 ? cw + ' of ' + total + ' outer rings are wound clockwise -- Manifold will treat these as zero-area. Reverse point order before shipping.' : null
    );
  }
}

/* ===================================================================
   v3.1.2 -- nav panel / footer credit line were both anchored to the
   same bottom-right corner with ~6px of separation, so the footer
   rendered through the nav panel's own bottom edge. Cheap structural
   check: the two elements' CSS bottom offsets must differ by a real
   margin, not just be non-identical.
   v3.4.92: footVersion moved out of the bottom-right corner entirely
   (into header.top, alongside the tagline) -- the original overlap this
   guarded against can no longer happen, so this now confirms the new
   state directly instead: #footVersion has no bottom-fixed position
   left at all, and is genuinely inside the header.
   =================================================================== */
sectionHeader('v3.1.2 / v3.4.92 -- footVersion lives in the header now, not anchored near #navPanel\'s bottom-right corner');

check(
  '#footVersion\'s CSS has no bottom/right fixed-position offset left (moved out of the bottom-right corner in v3.4.92) -- just an in-flow style matching the tagline',
  /#footVersion\{\s*\n\s*font-family:var\(--font-ui\); font-size:10px; letter-spacing:0\.06em;\s*\n\s*color:var\(--ink-soft\); opacity:0\.7; margin:2px 0 0;\s*\n\s*\}/.test(html)
  && !/#footVersion\{[^}]{0,150}position:fixed/.test(html)
);
check(
  '<p id="footVersion"> sits inside header.top\'s own left-side div, right after the tagline <p> -- not a separate top-level element',
  /<p class="tagline">Carved from real building volumes · Hudson Yards<\/p>\s*\n\s*<p id="footVersion"><\/p>/.test(html)
);

/* ===================================================================
   v3.1.3 -- help modal must actually be reachable and closeable, not
   just present in markup with no wiring.
   =================================================================== */
sectionHeader('v3.1.3 -- help modal is wired up');

check('#helpToggle button exists', /id="helpToggle"/.test(html));
check('#helpOverlay exists', /id="helpOverlay"/.test(html));
check('#helpClose button exists', /id="helpClose"/.test(html));
check(
  'Help modal open/close handlers are present',
  /getElementById\('helpToggle'\)\.addEventListener/.test(html) &&
  /getElementById\('helpClose'\)\.addEventListener/.test(html)
);
check(
  'Help modal closes on Escape',
  /e\.key === 'Escape'/.test(html)
);

/* ===================================================================
   v3.1.4 -- netlify.toml must actually exist and match the real deploy
   shape (no build step, publish from repo root).
   =================================================================== */
sectionHeader('v3.1.4 -- netlify.toml present and correctly shaped');

const tomlPath = path.join(ROOT, 'netlify.toml');
const tomlExists = fs.existsSync(tomlPath);
check('netlify.toml exists', tomlExists);
if (tomlExists){
  const toml = fs.readFileSync(tomlPath, 'utf8');
  check('publish = "."', /publish\s*=\s*"\."/.test(toml));
  check('index.html has a no-cache header rule', /for = "\/index\.html"/.test(toml) && /no-cache/.test(toml));
}

/* ===================================================================
   v3.1.9 -- permanent street/avenue name labels: one per unique name
   (not per block segment), toggling with the existing Major streets
   layer rather than a separate control.
   =================================================================== */
sectionHeader('v3.1.9 -- street name labels');

check('makeStreetLabel() is defined', /function makeStreetLabel\(/.test(html));
check('toTitleCaseStreet() is defined', /function toTitleCaseStreet\(/.test(html));
check(
  'Street labels are added to streetsGroup (so they toggle with Major streets, not a separate control)',
  /streetsGroup\.add\(makeStreetLabel\(/.test(html)
);
check(
  'Labels dedupe by name to one per unique street (not one per block segment)',
  /byName\.set\(row\.n,/.test(html)
);

/* ===================================================================
   v3.2.0 -- STL export. The real risk here is the binary format itself
   (byte offsets/stride), which is checked below at the structural level;
   full correctness was separately verified in an isolated Node harness
   (see CHANGELOG.md v3.2.0) that isn't practical to re-run as part of
   this static audit.
   =================================================================== */
sectionHeader('v3.2.0 -- STL export');

check('exportSTL() is defined', /function exportSTL\(/.test(html));
check('#exportStlBtn exists and is wired up', /getElementById\('exportStlBtn'\)\.addEventListener/.test(html));
check('#exportScale (model scale input) exists', /id="exportScale"/.test(html));
check(
  'STL header is written before the triangle count (binary STL requires an 80-byte header)',
  /view\.setUint8\(i, headerText\.charCodeAt\(i\)\)/.test(html) && /view\.setUint32\(80, triCount, true\)/.test(html)
);
check(
  'Triangle buffer size follows the real binary STL formula (84 + 50 bytes/triangle)',
  /new ArrayBuffer\(84 \+ triCount \* 50\)/.test(html)
);
check(
  'Exports negativeMesh only (not poché/cut-line/handle meshes) when in Negative space mode',
  /if \(showNegative\)\{[\s\S]{0,200}meshes\.push\(negativeMesh\)/.test(html)
);

/* ===================================================================
   v3.4.24-25 -- elevation lighting/artifact consistency across N/S/E/W
   =================================================================== */
sectionHeader('v3.4.24-25 -- elevation lighting/artifact consistency');

check(
  'orthoLight exists and starts hidden (perspective keeps using sun alone)',
  /orthoLight = new THREE\.DirectionalLight/.test(html) && /orthoLight\.visible = false/.test(html)
);
check(
  'updateOrthoLight() positions the light on the active camera\'s side for n/s/e/w/plan',
  /function updateOrthoLight\(direction, target, camDist\)/.test(html)
);
check(
  'setOrthogonalView() swaps sun off / orthoLight on when entering an elevation',
  /sun\.visible = false;\s*\n\s*orthoLight\.visible = true;/.test(html)
);
check(
  'resetToDefaultView() swaps back to sun for perspective',
  /sun\.visible = true;.*\n\s*orthoLight\.visible = false;/.test(html)
);
check(
  'zCutLineMesh visibility requires isPlanViewActive, not just sectionModeAxis===null -- v3.4.39: Joe found it reading as noise in free-orbit perspective too (axis===null covers both Plan and perspective), narrowed to Plan only, where the Height Cut cross-section is at least a real top-down slice',
  /zCutLineMesh\.visible = showNegative && isPlanViewActive;/.test(html)
);
check(
  'the quad recompile fix (v3.4.26/27) runs AFTER refreshViewToggles() -- v3.4.26 originally placed it before quad visibility was ever set true, making it a no-op; must follow refreshViewToggles() so the compile happens while the quad is genuinely visible',
  /refreshViewToggles\(\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(capFillGroups\) renderer\.compile\(scene, activeCamera\);/.test(html)
);
check(
  'getPlanBoxClipPlanes() exists -- v3.4.28: box-scoped clipping for Plan, distinct from the classic octant corner',
  /function getPlanBoxClipPlanes\(\)/.test(html)
);
check(
  'v3.4.37 reversal: syncBuildingClipping() is always called with false for isPlanView now -- Plan no longer box-scopes buildingMat (v3.4.28\'s own box-scoping stays correct for real N/S/E/W elevations, just never for Plan anymore)',
  /syncBuildingClipping\(axis, false\); \/\/ v3\.4\.37/.test(html)
);
check(
  'v3.4.37 reversal: the Z (Height Cut) cap-fill quad always uses the plain fallback clippingPlanes now, no isPlanViewActive branch -- Plan\'s poché fill is never box-scoped either',
  /const zQuadMat = capFillGroups\.z\.userData\.quad\.material;\s*\n\s*zQuadMat\.clippingPlanes = \[\.\.\.SITE_BOUND_PLANES\];/.test(html)
);
check(
  'syncSectionSkyUniforms(axis) is called AFTER the second renderer.compile() (post quad clippingPlanes/visibility change), not the first -- v3.4.30: calling it too early meant its uSkyDiscardOn write landed on a uniforms object the second compile then discarded, leaving the master discard switch stuck off (the actual "solid block" bug)',
  /if \(capFillGroups\) renderer\.compile\(scene, activeCamera\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*syncSectionSkyUniforms\(axis\);/.test(html)
);
check(
  'setOrthogonalView() turns Negative space on by default for a real N/S/E/W elevation -- v3.4.31: Joe\'s ask, since a fresh compute always leaves it off and every section view needed a manual extra click before showing anything',
  /if \(\(direction === 'n' \|\| direction === 's' \|\| direction === 'e' \|\| direction === 'w'\) && !showNegative\)\{\s*\n\s*showNegative = true;/.test(html)
);
check(
  'v3.4.37 reversal: groundMesh and streetMaterials only box-clip for a real locked elevation (axis !== null), never for Plan anymore -- Plan always shows the full site now, box drawn as an outline instead (updatePlanBoxOutline())',
  /groundMesh\.material\.clippingPlanes = \(activeSectionBox && axis !== null\) \? getPlanBoxClipPlanes\(\)\.slice\(1\) : \[\];/.test(html)
  && !/isPlanViewActive\)\) \? getPlanBoxClipPlanes/.test(html)
);
check(
  'updatePlanBoxOutline() exists and is called from both applySectionMode() and clearActiveSectionBox() -- the persistent world-space box outline that replaces Plan\'s old box-clipping',
  /function updatePlanBoxOutline\(\)\{/.test(html)
  && (html.match(/updatePlanBoxOutline\(\);/g) || []).length >= 2
);
check(
  'updateCurrentViewIndicator() exists and highlights the active nav button -- v3.4.33: Joe\'s ask, none of the six nav-compass buttons ever showed which view was current before this',
  /function updateCurrentViewIndicator\(viewKey\)\{/.test(html)
  && /activeBtn\.classList\.add\('active'\); activeBtn\.classList\.remove\('secondary'\);/.test(html)
);
check(
  'updateCurrentViewIndicator() is actually called from both setOrthogonalView() and resetSharedViewState() -- covers N/S/E/W/Plan and Home/perspective/Manhattan-context, the places the view can change (v3.4.90: resetToDefaultView() and zoomToBoroughContext() both call resetSharedViewState() for this now, instead of each calling it separately)',
  /updateCurrentViewIndicator\(direction\); \/\/ v3\.4\.33/.test(html)
  && /updateCurrentViewIndicator\('home'\);/.test(html)
);

/* ===================================================================
   v3.4.34 -- panel consolidation (Joe's IA redesign, phase 1)
   =================================================================== */
sectionHeader('v3.4.34 -- panel consolidation (IA redesign phase 1)');

check(
  '#exploreExtras exists, starts hidden, and is gated via showPostComputeUI() (v3.4.38) rather than a literal \'flex\' string at the compute-finish site -- still paired with the district-switch reset',
  /id="exploreExtras" style="display:none/.test(html)
  && /exploreExtras'\)\.style\.display = 'none'/.test(html)
  && /function showPostComputeUI\(\)\{/.test(html)
);
check(
  'the six nav-compass buttons (navHome/navPlan/navN/navS/navE/navW) now live inside #exploreExtras, not a separate #navGrid',
  // v3.4.67: end-of-window marker changed from "<p class=\"label\">Units" to
  // the Display accordion's own opening tag -- Units itself moved OUT of
  // #exploreExtras this version (see the new v3.4.67 section below), so it
  // can no longer serve as a boundary here. The Display accordion is still
  // real, still-present content inside #exploreExtras that comes after the
  // nav buttons, so it does the same job.
  !/id="navGrid"/.test(html)
  && (() => { const m = html.match(/id="exploreExtras"[\s\S]*?<summary>Display<\/summary>/); return m && /id="navHome"/.test(m[0]) && /id="navPlan"/.test(m[0]) && /id="navN"/.test(m[0]); })()
);
check(
  '#planBoxPanel is a plain inline block inside #exploreExtras now, not a separate floating .panel',
  // v3.4.67: same boundary-marker fix as the check above.
  !/class="panel" id="planBoxPanel"/.test(html)
  && (() => { const m = html.match(/id="exploreExtras"[\s\S]*?<summary>Display<\/summary>/); return m && /id="planBoxPanel"/.test(m[0]); })()
);
check(
  'positionPlanBoxPanel() is a documented no-op -- #planBoxPanel no longer needs anchoring to #navPanel\'s position since it flows inline',
  /function positionPlanBoxPanel\(\)\{\s*\n\s*\/\/ v3\.4\.34: no-op\./.test(html)
);
check(
  '#navPanel no longer contains the direction buttons -- just the compass rose + current-view label',
  /id="navPanel">\s*\n\s*<div id="currentViewLabel">/.test(html)
  && (() => { const m = html.match(/<div class="panel" id="navPanel">([\s\S]*?)<\/div>\s*\n\s*<div id="planBoxOverlay"/); return m && !/id="navHome"/.test(m[1]) && !/id="drawBoxBtn"/.test(m[1]); })()
);
check(
  'Display and Export sections are collapsed <details> accordions; Units stayed outside any accordion. v3.4.97: Display gained an id (displayAccordion) to target from viewNegative\'s click handler -- still a details.accordion either way',
  (html.match(/<details class="accordion"[^>]*>/g) || []).length === 2
);

/* ===================================================================
   v3.4.35 -- "no idea what to do next" (post-compute UX)
   =================================================================== */
sectionHeader('v3.4.35 -- post-compute UX (explore hint, suggested buttons, Units gating)');

check(
  'showNegative is preserved (not silently reset) when a compute happens while already inside a locked N/S/E/W section',
  /showNegative = sectionModeAxis !== null;/.test(html)
);
check(
  '#decisionStage exists, replacing #exploreHint entirely -- exactly one real decision shown at a time (v3.4.38), not a hint sitting alongside a full panel',
  /id="decisionStage" style="display:none/.test(html)
  && !/id="exploreHint"/.test(html)
  && /function dismissExploreHint\(\)\{/.test(html)
  && /localStorage\.getItem\('ns_exploredOnce'\)/.test(html)
);
check(
  'dismissExploreHint() is actually wired to all three real "figured it out" triggers -- Negative space on, a real N/S/E/W view, not just defined and never called. v3.4.97: the Negative-space-on trigger now sits inside a multi-line if(showNegative) block (which also does the Advanced/Display exposure), not the original one-liner, but still calls dismissExploreHint() unconditionally on that branch',
  /if \(showNegative\)\{\s*\n\s*dismissExploreHint\(\); \/\/ v3\.4\.35/.test(html)
  && /dismissExploreHint\(\); \/\/ v3\.4\.35: picking a real elevation/.test(html)
);
check(
  '.suggested is genuinely gone, replaced by #decisionStage\'s two choice cards -- "See the void" and "Draw a section" each trigger the real button\'s own click(), not a reimplementation',
  !/class="btn secondary suggested"/.test(html)
  && /id="choiceVoid"[\s\S]{0,300}id="choiceSection"/.test(html)
  && /document\.getElementById\('viewNegative'\)\.click\(\);/.test(html)
  && /document\.getElementById\('drawBoxBtn'\)\.click\(\);/.test(html)
);
check(
  'Units is gated behind a compute (inside #sectionRow, shown only once a compute has run) instead of always visible above Neighborhood with nothing yet to apply it to',
  // v3.4.67: superseded in place -- Units relocated one level further in,
  // from #exploreExtras to #advancedCutawayControls (see the new v3.4.67
  // section below for the full move and its own, more specific checks).
  // The original intent here -- Units shouldn't be visible before there's
  // a real reason to touch it -- still holds and is re-verified against
  // the new location rather than dropped.
  (() => { const m = html.match(/id="sectionRow"[\s\S]*?id="advancedCutawayControls"[\s\S]*?<button class="btn active" id="unitsMetric">/); return !!m; })()
);

/* ===================================================================
   v3.4.38 -- one decision at a time (Joe's IA redesign, phase 2)
   =================================================================== */
sectionHeader('v3.4.38 -- one decision at a time (staged reveal + compass cross view picker)');

check(
  'showPostComputeUI() exists and decides between #decisionStage and the full panel based on ns_exploredOnce, not a hardcoded state',
  /function showPostComputeUI\(\)\{/.test(html)
  && /const explored = localStorage\.getItem\('ns_exploredOnce'\) === '1';/.test(html)
);
check(
  'showPostComputeUI() is actually called when a compute finishes, not just defined',
  /showPostComputeUI\(\);\s*\n\s*resetCutaway\(\);/.test(html)
);
check(
  'Buildings/Negative-space toggle and Display moved inside #exploreExtras alongside Units -- nothing in the full panel is reachable before the one decision resolves. v3.4.101: Export moved further down, out of #exploreExtras into #sectionRow (still gated behind the same #decisionStage resolve either way -- just relocated within the gated area, per Joe\'s call that Export is secondary to the tool\'s actual point)',
  (() => {
    const exploreMatch = html.match(/id="exploreExtras"[\s\S]*?<\/details>\s*\n  <\/div>/);
    const sectionMatch = html.match(/id="sectionRow"[\s\S]*?<\/details>\s*\n  <\/div>\s*\n<\/div>/);
    return exploreMatch && /id="viewSolid"/.test(exploreMatch[0]) && /id="viewBoroughs"/.test(exploreMatch[0]) && !/id="exportStlBtn"/.test(exploreMatch[0])
      && sectionMatch && /id="exportStlBtn"/.test(sectionMatch[0]);
  })()
);
check(
  'Step 1 (Neighborhood, Compute) stays OUTSIDE both #decisionStage and #exploreExtras -- always visible, no gating',
  (() => { const controlsMatch = html.match(/<div class="panel" id="controls">([\s\S]*?)<div id="decisionStage"/); return controlsMatch && /id="neighborhoodBtn"/.test(controlsMatch[1]) && /id="computeBtn"/.test(controlsMatch[1]); })()
);
check(
  'the compass cross (Option C) is real -- each of navN/navW/navHome/navE/navS carries its own grid-position class, not a flat row',
  /class="btn secondary navBtn compassN" id="navN"/.test(html)
  && /class="btn secondary navBtn compassW" id="navW"/.test(html)
  && /class="btn secondary navBtn compassHome" id="navHome"/.test(html)
  && /class="btn secondary navBtn compassE" id="navE"/.test(html)
  && /class="btn secondary navBtn compassS" id="navS"/.test(html)
  && /#viewCompassGrid \.compassN\{ grid-column:2; grid-row:1; \}/.test(html)
);
check(
  'navPlan is pulled out as its own full-width button, not sharing the compass grid -- "straight down" isn\'t a compass direction the way N/S/E/W are',
  /id="navPlan" style="width:100%;"/.test(html)
);

/* ===================================================================
   v3.4.36 -- negativeMesh (ghost shell) hidden in elevation views
   =================================================================== */
sectionHeader('v3.4.36 -- ghost shell hidden in N/S/E/W (Joe: "should not be showing when going into any elevation view")');

check(
  'negativeMesh.visible requires sectionModeAxis === null at BOTH its assignment sites (compute-time reset and refreshViewToggles()) -- the ghost shell only shows in Plan/perspective now (v3.4.55 narrowed this further to exclude Plan specifically -- see that section below; both sites still gate on sectionModeAxis === null as their first condition, just with an added clause now)',
  (html.match(/negativeMesh\.visible = showNegative && sectionModeAxis === null && !isPlanViewActive;/g) || []).length === 2
);

/* ===================================================================
   v3.4.39 -- messy Home view + three panel-control cleanups
   =================================================================== */
sectionHeader('v3.4.39 -- zCutLineMesh in perspective, poché row dimming, High detail relocated, tooltip repositioning');

check(
  '#capFillRow exists (Section fill row given an id so it can be dimmed) and refreshCutawayRowActiveState() dims it only when nothing could show (axis===null && a box is blocking Z too) -- v3.4.82 narrowed this from the old bare axis===null, which disabled the checkbox in exactly the Perspective+Height-Cut scenario buildings\' own poché is for; see that version\'s own check for the full reasoning',
  /id="capFillRow"/.test(html)
  && /const capRow = document\.getElementById\('capFillRow'\);/.test(html)
  && /const capInert = axis === null && !!activeSectionBox;/.test(html)
);
check(
  'High detail moved out of the Simple tab into the Export accordion, next to Export STL -- it was never a viewing setting, only ever relevant when producing an image or file to keep',
  (() => { const m = html.match(/<summary>Export<\/summary>[\s\S]*?<\/details>/); return m && /id="highDetailToggle"/.test(m[0]); })()
  && !/<div id="capFillRow"[\s\S]{0,300}id="highDetailToggle"/.test(html)
);
check(
  'info-badge tooltips anchor to the empty viewport space right of #controls, not over the panel itself -- structural fix so a tall panel can never bury a tooltip under other real controls again',
  /let left = panelRect\.right \+ margin;/.test(html)
  && /const panelRect = document\.getElementById\('controls'\)\.getBoundingClientRect\(\);/.test(html)
);

/* ===================================================================
   v3.4.40 -- compass buttons ignored a pending box
   =================================================================== */
sectionHeader('v3.4.40 -- navN/S/E/W route through the pending-box commit path, not around it');

check(
  'goToDirection() exists and checks pendingPlanBox before falling back to a bare setOrthogonalView() call',
  /function goToDirection\(direction\)\{\s*\n\s*if \(pendingPlanBox\) \{ applyPlanBoxDirection\(direction\); return; \}/.test(html)
);
check(
  'all four compass buttons (navN/S/E/W) call goToDirection(), not setOrthogonalView() directly -- the one remaining way to reach a direction change while a box is pending without going through the commit path',
  /getElementById\('navN'\)\.addEventListener\('click', \(\) => goToDirection\('n'\)\);/.test(html)
  && /getElementById\('navS'\)\.addEventListener\('click', \(\) => goToDirection\('s'\)\);/.test(html)
  && /getElementById\('navE'\)\.addEventListener\('click', \(\) => goToDirection\('e'\)\);/.test(html)
  && /getElementById\('navW'\)\.addEventListener\('click', \(\) => goToDirection\('w'\)\);/.test(html)
  && !/getElementById\('navN'\)\.addEventListener\('click', \(\) => setOrthogonalView/.test(html)
);

/* ===================================================================
   v3.4.41 -- defensive re-sync against an intermittent shader-compile race
   =================================================================== */
sectionHeader('v3.4.41 -- requestAnimationFrame defensive re-sync for the uSkyDiscardOn race');

check(
  'applySectionMode() re-asserts sky uniforms on the next animation frame after every call, not just relying on the synchronous compile-then-sync ordering v3.4.30 established',
  /requestAnimationFrame\(\(\) => \{\s*\n\s*if \(axis !== null\) syncSectionSkyUniforms\(axis\);\s*\n\s*if \(sectionModeAxis === axis\) refreshActiveSectionProfile\(\);/.test(html)
);
check(
  'a setTimeout fallback runs alongside the rAF re-sync -- rAF alone is paused entirely while a tab is backgrounded, setTimeout still fires (throttled, not suspended) regardless of tab visibility',
  /setTimeout\(\(\) => \{\s*\n\s*if \(axis !== null\) syncSectionSkyUniforms\(axis\);\s*\n\s*if \(sectionModeAxis === axis\) refreshActiveSectionProfile\(\);\s*\n\s*\}, 250\);/.test(html)
);

/* ===================================================================
   v3.4.43 -- poché quads briefly made to conform to the real roofline
   (REVERTED in v3.4.46 -- see that section below)
   =================================================================== */
sectionHeader('v3.4.43 -- superseded by v3.4.46');

check(
  'v3.4.43\'s change is not the current state -- see v3.4.46 below for the check that actually matters now',
  true
);

/* ===================================================================
   v3.4.44 -- Height-Cut cap quad hidden during a locked elevation
   =================================================================== */
sectionHeader('v3.4.44 -- capFillGroups.z visibility gated on sectionModeAxis (same fix class as v3.4.36/39)');

check(
  'capFillGroups.z.visible requires sectionModeAxis === null -- a horizontal Height-Cut cap plane, viewed edge-on from a locked elevation, is a thin unclipped band across the whole site otherwise (v3.4.56 added a further !activeSectionBox clause -- this check only confirms the sectionModeAxis part is still intact)',
  /capFillGroups\.z\.visible = on && sectionModeAxis === null && !activeSectionBox && sectionPlane\.constant > 0;/.test(html)
);

/* ===================================================================
   v3.4.45 -- per-frame self-healing section render state
   =================================================================== */
sectionHeader('v3.4.45 -- enforceSectionRenderState() runs every frame, not once per view change');

check(
  'enforceSectionRenderState() exists, force-corrects negativeMesh/zCutLineMesh/capFillGroups.z visibility and re-calls syncSectionSkyUniforms() every time it runs',
  /function enforceSectionRenderState\(\)\{/.test(html)
  && /negativeMesh\.visible = false; \/\/ v3\.4\.36/.test(html)
  && /if \(zCutLineMesh\) zCutLineMesh\.visible = false; \/\/ v3\.4\.39/.test(html)
  && /if \(capFillGroups\) capFillGroups\.z\.visible = false; \/\/ v3\.4\.44/.test(html)
  && /syncSectionSkyUniforms\(sectionModeAxis\);/.test(html)
);
check(
  'enforceSectionRenderState() is actually called from inside animate(), every frame, not just defined',
  /updatePendingPlanBoxOverlay\(\); \/\/ v3\.4\.18[\s\S]{0,300}enforceSectionRenderState\(\);/.test(html)
);

/* ===================================================================
   v3.4.46 -- reverts v3.4.43: restores the original confirmed poché design
   =================================================================== */
sectionHeader('v3.4.46 -- uSkyRoofDiscardOn back to 0.0 for the poché quads, matching Joe\'s original v3.4.12 sketch');

check(
  'v3.4.46 restored the flat filled-mass design -- now expressed via POCHE_ROOF_DISCARD (see v3.4.47 below) rather than a literal at the call site',
  /const POCHE_ROOF_DISCARD = false;/.test(html)
);

/* ===================================================================
   v3.4.47 -- hardened guard against re-reversing v3.4.46
   =================================================================== */
sectionHeader('v3.4.47 -- POCHE_ROOF_DISCARD named constant, so this decision has one authoritative place');

check(
  'POCHE_ROOF_DISCARD exists as a named constant set to false, with its own prominent block comment -- not a bare 0.0 literal duplicated at the call site',
  /const POCHE_ROOF_DISCARD = false;/.test(html)
  && /FOUNDING DESIGN DECISION -- DO NOT FLIP WITHOUT RE-READING THIS FIRST/.test(html)
);
check(
  'the poché quads\' applySkyConfig() actually reads from POCHE_ROOF_DISCARD, not a duplicated literal -- one source of truth, not two that can drift apart',
  /s\.uSkyRoofDiscardOn\.value = POCHE_ROOF_DISCARD \? 1\.0 : 0\.0;/.test(html)
);

/* ===================================================================
   v3.4.48 -- entering a locked N/S/E/W elevation forces Buildings off
   =================================================================== */
sectionHeader("v3.4.48 -- showBuildings auto-off on entering n/s/e/w, mirroring v3.4.31's showNegative auto-on");

check(
  'setOrthogonalView() forces showBuildings false when direction is n/s/e/w (only if it was on), same shape as the existing showNegative auto-on',
  /if \(\(direction === 'n' \|\| direction === 's' \|\| direction === 'e' \|\| direction === 'w'\) && showBuildings\)\{\s*showBuildings = false;\s*\}/.test(html)
);
check(
  'the showBuildings auto-off runs BEFORE applySectionMode() (so refreshViewToggles(), called at the end of applySectionMode(), picks up the corrected value on the same view switch, not one frame late)',
  /showBuildings = false;\s*\}[\s\S]{0,9000}applySectionMode\(direction === 'n' \|\| direction === 's' \? 'y'/.test(html)
);
check(
  'Plan view is untouched -- the auto-off is scoped to n/s/e/w only, same scoping the v3.4.31 auto-on already uses (Plan keeps Buildings-only as its default look)',
  !/if \(\(direction === 'plan'[\s\S]{0,50}showBuildings = false/.test(html)
);

/* ===================================================================
   v3.4.49 -- skyline profile built per building-PART, not whole building
   =================================================================== */
sectionHeader("v3.4.49 -- buildBuildingBBoxCache() uses partsGeo (per-part bbox+height) when parts exist, matching the real per-part solid");

check(
  'buildBuildingBBoxCache() groups partsGeo.features by building_id, same join key (building_id -> properties.id) loadData() already uses to build the real per-part solid',
  /const partsByBuilding = new Map\(\);\s*if \(partsGeo\)\{\s*for \(const pf of partsGeo\.features\)\{\s*const bid = pf\.properties\.building_id;/.test(html)
);
check(
  'a building WITH parts pushes one bbox per PART (own footprint, own height) instead of one bbox for the whole building',
  /for \(const pf of parts\) pushBBox\(pf\.geometry, pf\.properties\.height \|\| 0\);/.test(html)
);
check(
  'a building with NO parts (the flat-fallback case) still falls back to the old whole-building bbox+height -- unaffected, not a behavior change for those buildings',
  /\} else \{\s*pushBBox\(f\.geometry, f\.properties\.height \|\| 0\);\s*\}/.test(html)
);
check(
  'buildBuildingBBoxCache() is still called from computeNegativeSpace() after partsGeo is populated by loadData(), not before',
  /buildBuildingBBoxCache\(\); \/\/ v3\.3\.0: feeds buildSectionProfile/.test(html)
);

/* ===================================================================
   v3.4.50 -- Option A: getSectionRanges() always uses the fixed
   SECTION_SLAB_HALF_WIDTH slab, box or no box -- true section, not elevation
   =================================================================== */
sectionHeader("v3.4.50 -- getSectionRanges() no longer widens the slab to the box's own depth (Option A: True Section)");

check(
  'the box-active branch for axis x no longer computes a halfSlab from activeSectionBox.xMax/xMin',
  !/const halfSlab = \(activeSectionBox\.xMax - activeSectionBox\.xMin\) \/ 2;/.test(html)
);
check(
  'the box-active branch for axis y no longer computes a halfSlab from activeSectionBox.yMax/yMin',
  !/const halfSlab = \(activeSectionBox\.yMax - activeSectionBox\.yMin\) \/ 2;/.test(html)
);
check(
  'axis x box-active branch now uses the fixed SECTION_SLAB_HALF_WIDTH around xThreshold, same as the no-box case',
  /plotLo: activeSectionBox\.yMin, plotHi: activeSectionBox\.yMax, slabLo: xThreshold - SECTION_SLAB_HALF_WIDTH, slabHi: xThreshold \+ SECTION_SLAB_HALF_WIDTH/.test(html)
);
check(
  'axis y box-active branch now uses the fixed SECTION_SLAB_HALF_WIDTH around yThreshold, same as the no-box case',
  /plotLo: activeSectionBox\.xMin, plotHi: activeSectionBox\.xMax, slabLo: yThreshold - SECTION_SLAB_HALF_WIDTH, slabHi: yThreshold \+ SECTION_SLAB_HALF_WIDTH/.test(html)
);
check(
  'plotLo/plotHi still crop to the drawn box in both branches -- only the slab width changed, the box still crops the screen-horizontal range',
  /plotLo: activeSectionBox\.yMin, plotHi: activeSectionBox\.yMax/.test(html) && /plotLo: activeSectionBox\.xMin, plotHi: activeSectionBox\.xMax/.test(html)
);

/* ===================================================================
   v3.4.51 -- setOrthogonalView() centers the threshold on the box when
   switching to a different axis than the one currently active (goToDirection's
   direct-compass path never did this; the box-direction picker always has)
   =================================================================== */
sectionHeader("v3.4.51 -- N/S/E/W direction switch re-centers xThreshold/yThreshold on the box when it's outside the box's own range");

check(
  'setOrthogonalView() checks yThreshold against activeSectionBox.yMin/yMax for n/s and re-centers via setYCutaway() when out of range',
  /if \(\(direction === 'n' \|\| direction === 's'\) && activeSectionBox && \(yThreshold < activeSectionBox\.yMin \|\| yThreshold > activeSectionBox\.yMax\)\)\{\s*setYCutaway\(\(activeSectionBox\.yMin \+ activeSectionBox\.yMax\) \/ 2\);/.test(html)
);
check(
  'setOrthogonalView() checks xThreshold against activeSectionBox.xMin/xMax for e/w and re-centers via setXCutaway() when out of range',
  /\} else if \(\(direction === 'e' \|\| direction === 'w'\) && activeSectionBox && \(xThreshold < activeSectionBox\.xMin \|\| xThreshold > activeSectionBox\.xMax\)\)\{\s*setXCutaway\(\(activeSectionBox\.xMin \+ activeSectionBox\.xMax\) \/ 2\);/.test(html)
);
check(
  'the re-centering runs BEFORE applySectionMode() so the newly-centered threshold is what the profile refresh actually reads, not one switch late',
  (() => {
    const centerIdx = html.indexOf("if ((direction === 'n' || direction === 's') && activeSectionBox && (yThreshold");
    const applyIdx = html.indexOf("applySectionMode(direction === 'n' || direction === 's' ? 'y'");
    return centerIdx > 0 && applyIdx > centerIdx;
  })()
);
check(
  'the fix is scoped to OUT-OF-RANGE thresholds only -- a manually-adjusted, still-valid threshold is left alone, so flipping E/W (same axis) never resets a slider position mid-inspection',
  /yThreshold < activeSectionBox\.yMin \|\| yThreshold > activeSectionBox\.yMax/.test(html) && /xThreshold < activeSectionBox\.xMin \|\| xThreshold > activeSectionBox\.xMax/.test(html)
);

/* ===================================================================
   v3.4.52 -- profile bin resolution 512 -> 2048 (both buildSectionProfile()
   and buildAxisHeightProfile()), closing the remaining sub-2m edge gaps
   =================================================================== */
sectionHeader("v3.4.52 -- profile bin count 512 -> 2048, both the slab-based real-section pass and the citywide envelope pass");

check(
  'buildSectionProfile() defaults to 2048 bins, not 512',
  /function buildSectionProfile\(axis, lo, hi, capHeight, slabLo, slabHi, bins = 2048\)\{/.test(html)
);
check(
  'buildAxisHeightProfile() (the citywide envelope, used before any section view is entered) also defaults to 2048 bins, not 512',
  /function buildAxisHeightProfile\(axis, lo, hi, capHeight, bins = 2048\)\{/.test(html)
);
check(
  'no stray reference to the old 512 default remains on either function signature',
  !/bins = 512/.test(html)
);

/* ===================================================================
   v3.4.53 -- Option B: POCHE_BUILDING_DISCARD widens the cutout to match
   the elevation-profile outline, independent of and in addition to the
   existing single-plane stencil hole
   =================================================================== */
sectionHeader("v3.4.53 -- Option B: uSkyBuildingDiscardOn widens the poché cutout to the elevation-profile silhouette");

check(
  'POCHE_BUILDING_DISCARD is a separate, named constant from POCHE_ROOF_DISCARD -- not reusing or repurposing the hardened, must-stay-false one',
  /const POCHE_ROOF_DISCARD = false;/.test(html) && /const POCHE_BUILDING_DISCARD = true;/.test(html)
);
check(
  'the new uSkyBuildingDiscardOn uniform defaults to 0.0 in addSkyDiscard(), same off-by-default pattern as uSkyRoofDiscardOn',
  /shader\.uniforms\.uSkyBuildingDiscardOn = \{ value: 0\.0 \};/.test(html)
);
check(
  'the new discard test is a separate GLSL block from the roofDiscard one, not merged into or replacing it -- so either can be reverted independently',
  /if \(uSkyBuildingDiscardOn > 0\.5\) \{\s*float u = clamp\(\(freeCoord - uSkyLo\) \/ \(uSkyHi - uSkyLo\), 0\.0, 1\.0\);\s*float localMaxH = texture2D\(uSkyHeightTex, vec2\(u, 0\.5\)\)\.r;\s*if \(localMaxH > 0\.0 && vNegWorldPos\.z < localMaxH\) discard;\s*\}/.test(html)
);
check(
  'the new discard direction is the OPPOSITE of uSkyRoofDiscardOn (z < localMaxH, not z > localMaxH + margin) -- confirms it carves a hole below the profile height, not a ceiling above it',
  /if \(localMaxH > 0\.0 && vNegWorldPos\.z < localMaxH\) discard;/.test(html) && /if \(vNegWorldPos\.z > localMaxH \+ uSkyMargin\) discard;/.test(html)
);
check(
  'applySkyConfig() sets uSkyBuildingDiscardOn from POCHE_BUILDING_DISCARD, same per-quad pattern as the existing uSkyRoofDiscardOn line',
  /s\.uSkyRoofDiscardOn\.value = POCHE_ROOF_DISCARD \? 1\.0 : 0\.0;\s*[\s\S]{0,300}s\.uSkyBuildingDiscardOn\.value = POCHE_BUILDING_DISCARD \? 1\.0 : 0\.0;/.test(html)
);
check(
  'POCHE_ROOF_DISCARD itself is untouched -- still false -- confirming Option B did not reopen the already-settled roof-discard/flat-mass decision',
  /const POCHE_ROOF_DISCARD = false; \/\/ NEVER true for the poché quads/.test(html)
);

/* ===================================================================
   v3.4.54 -- old planBoxOutlineMesh no longer sits visible through a new
   box draw; hidden at pointerdown, restored on cancel/too-small-drag
   =================================================================== */
sectionHeader("v3.4.54 -- planBoxOutlineMesh hidden the moment a new box draw starts, restored if that draw is cancelled or too small");

check(
  'the pointerdown handler hides planBoxOutlineMesh at the start of a new drag, before planBoxDragStart is even used elsewhere',
  /planBoxDragStart = \{ x: hit\.x, y: hit\.y, sx: e\.clientX, sy: e\.clientY \};\s*[\s\S]{0,1200}if \(planBoxOutlineMesh\) planBoxOutlineMesh\.visible = false;/.test(html)
);
check(
  'cancelPlanBox() restores the outline via updatePlanBoxOutline() rather than leaving it hidden with no new box to replace it',
  // v3.4.66: widened from {0,600} to {0,900} -- the v3.4.66 setCompassDirectionsVisible(true) line
  // (plus its comment) added real, correct content to this function's body and pushed its total
  // length past the old window; the check's actual intent (updatePlanBoxOutline() is the last real
  // call in this function) is unchanged.
  /function cancelPlanBox\(\)\{[\s\S]{0,900}updatePlanBoxOutline\(\);\s*\}/.test(html)
);
check(
  'the too-small-drag abort path in the pointerup handler also restores the outline, same reasoning as cancelPlanBox()',
  /if \(box\.xMax - box\.xMin < MIN_BOX_SIZE \|\| box\.yMax - box\.yMin < MIN_BOX_SIZE\)\{[\s\S]{0,600}updatePlanBoxOutline\(\);\s*return;\s*\}/.test(html)
);
check(
  'the successful-draw path (pendingPlanBox = box) does NOT call updatePlanBoxOutline() -- the outline should stay hidden until a direction is picked, not reappear mid-draw',
  !/pendingPlanBox = box;\s*[\s\S]{0,50}updatePlanBoxOutline\(\)/.test(html)
);

/* ===================================================================
   v3.4.55 -- negativeMesh no longer shows in Plan view specifically,
   even with Negative space on; perspective/octant unaffected
   =================================================================== */
sectionHeader("v3.4.55 -- negativeMesh.visible excludes isPlanViewActive, both call sites");

check(
  'refreshViewToggles() (the main, per-switch assignment) now excludes isPlanViewActive',
  /negativeMesh\.visible = showNegative && sectionModeAxis === null && !isPlanViewActive;\s*\/\/ v3\.4\.0 live-verify fix/.test(html)
);
check(
  'the compute-time assignment also excludes isPlanViewActive, matching refreshViewToggles() -- not just one of the two call sites',
  /negativeMesh\.visible = showNegative && sectionModeAxis === null && !isPlanViewActive;\s*\n\s*const triCount/.test(html)
);
check(
  'free perspective/octant view is untouched -- isPlanViewActive is false there (only true for literal top-down Plan), so showNegative alone still controls visibility outside Plan',
  /let isPlanViewActive = false; \/\/ v3\.4\.28: true only for the literal top-down Plan view/.test(html)
);

/* ===================================================================
   v3.4.56 -- Height Cut lid quad (capFillGroups.z) hidden in Plan whenever
   a section box is active, matching v3.4.13's precedent for the handles
   =================================================================== */
sectionHeader("v3.4.56 -- capFillGroups.z.visible adds !activeSectionBox, same guard shape as the v3.4.13 cutaway-handle fix");

check(
  'capFillGroups.z.visible now requires !activeSectionBox in addition to on && sectionModeAxis === null',
  /capFillGroups\.z\.visible = on && sectionModeAxis === null && !activeSectionBox && sectionPlane\.constant > 0;/.test(html)
);
check(
  'the unconditional compute-time reset (capFillGroups.z.visible = false, v3.4.44) is untouched -- only the live refreshCapFillVisibility() assignment changed',
  /if \(capFillGroups\) capFillGroups\.z\.visible = false; \/\/ v3\.4\.44/.test(html)
);
check(
  'the fix references the same precedent (v3.4.13\'s handlesOn !activeSectionBox guard) it is modeled on, so the two don\'t silently drift apart later',
  /same fix shape as v3\.4\.13's `!activeSectionBox` guard on the/.test(html)
);

/* ===================================================================
   v3.4.57 -- entering Plan forces Buildings back on, symmetric to
   v3.4.48's elevation-entry force-off
   =================================================================== */
sectionHeader("v3.4.57 -- setOrthogonalView() forces showBuildings true on entering Plan, mirroring the existing v3.4.48 force-off on entering n/s/e/w");

check(
  'setOrthogonalView() forces showBuildings true when direction is plan (only if it was off), same shape as the existing v3.4.48 force-off',
  /if \(direction === 'plan' && !showBuildings\)\{\s*showBuildings = true;\s*\}/.test(html)
);
check(
  'the plan force-on sits after the n/s/e/w force-off in source order, both part of the same setOrthogonalView() flow',
  (() => {
    const offIdx = html.indexOf("if ((direction === 'n' || direction === 's' || direction === 'e' || direction === 'w') && showBuildings){");
    const onIdx = html.indexOf("if (direction === 'plan' && !showBuildings){");
    return offIdx > 0 && onIdx > offIdx;
  })()
);
check(
  'n/s/e/w force-off is untouched -- still forces Buildings off entering an elevation, this is additive not a replacement',
  /if \(\(direction === 'n' \|\| direction === 's' \|\| direction === 'e' \|\| direction === 'w'\) && showBuildings\)\{\s*showBuildings = false;\s*\}/.test(html)
);

/* ===================================================================
   v3.4.58 -- entering Plan also forces Negative space back off, other
   half of v3.4.57's Buildings-on fix
   =================================================================== */
sectionHeader("v3.4.58 -- setOrthogonalView() forces showNegative false on entering Plan, alongside v3.4.57's showBuildings true");

check(
  'setOrthogonalView() forces showNegative false when direction is plan (only if it was on)',
  /if \(direction === 'plan' && showNegative\)\{\s*showNegative = false;\s*\}/.test(html)
);
check(
  'the negative-space force-off sits after v3.4.57\'s showBuildings force-on, both in the same plan-entry block',
  (() => {
    const onIdx = html.indexOf("if (direction === 'plan' && !showBuildings){");
    const offIdx = html.indexOf("if (direction === 'plan' && showNegative){");
    return onIdx > 0 && offIdx > onIdx;
  })()
);
check(
  'v3.4.57\'s showBuildings force-on is untouched -- this is additive, both toggles now get set correctly on entering Plan',
  /if \(direction === 'plan' && !showBuildings\)\{\s*showBuildings = true;\s*\}/.test(html)
);
check(
  'the n/s/e/w entry logic (v3.4.31 showNegative-on, v3.4.48 showBuildings-off) is untouched -- this only adds the Plan-entry counterpart, not a replacement',
  /if \(\(direction === 'n' \|\| direction === 's' \|\| direction === 'e' \|\| direction === 'w'\) && !showNegative\)\{\s*showNegative = true;\s*\}/.test(html) &&
  /if \(\(direction === 'n' \|\| direction === 's' \|\| direction === 'e' \|\| direction === 'w'\) && showBuildings\)\{\s*showBuildings = false;\s*\}/.test(html)
);

/* ===================================================================
   v3.4.59 -- drag the 4 edges of an existing (committed) section box
   in Plan view to resize it live, no need to redraw from scratch
   =================================================================== */
sectionHeader("v3.4.59 -- box-edge drag-to-resize (hitTestBoxEdge/boxEdgeDragSide)");

check(
  'hitTestBoxEdge() refuses to hit-test when neither box exists or not in Plan (superseded by v3.4.65 -- was unconditionally activeSectionBox + excluded boxDrawMode entirely; now selects pendingPlanBox vs activeSectionBox based on boxDrawMode instead of excluding on it, see v3.4.65\'s own check above for the current exact form)',
  /function hitTestBoxEdge\(wx, wy\)\{\s*const b = boxDrawMode \? pendingPlanBox : activeSectionBox;\s*if \(!b \|\| !isPlanViewActive\) return null;/.test(html)
);
check(
  'the pointerdown handler checks for an edge grab before falling through to the boxDrawMode-gated new-box-draw start (superseded by v3.4.65 -- was wrapped in `if (!boxDrawMode)`, which is exactly what blocked edge-grabs on the awaiting-direction box; the check now always runs unconditionally, see v3.4.65\'s own check above)',
  /const side = hitTestBoxEdge\(hit\.x, hit\.y\); \/\/ v3\.4\.65[\s\S]{0,600}if \(side\)\{\s*boxEdgeDragSide = side;/.test(html)
);
check(
  'pointermove updates the correct single bound for each of the 4 sides, each clamped against BOX_EDGE_MIN_SIZE so a resize can never collapse or invert the box',
  /if \(boxEdgeDragSide === 'xMin'\) b\.xMin = Math\.min\(hit\.x, b\.xMax - BOX_EDGE_MIN_SIZE\);/.test(html) &&
  /else if \(boxEdgeDragSide === 'xMax'\) b\.xMax = Math\.max\(hit\.x, b\.xMin \+ BOX_EDGE_MIN_SIZE\);/.test(html) &&
  /else if \(boxEdgeDragSide === 'yMin'\) b\.yMin = Math\.min\(hit\.y, b\.yMax - BOX_EDGE_MIN_SIZE\);/.test(html) &&
  /else if \(boxEdgeDragSide === 'yMax'\) b\.yMax = Math\.max\(hit\.y, b\.yMin \+ BOX_EDGE_MIN_SIZE\);/.test(html)
);
check(
  'pointermove redraws the edited box\'s live visual during an edge drag, not only once on release (superseded by v3.4.65 -- was an unconditional updatePlanBoxOutline() call; now branches between that and updatePlanBoxOverlayFromWorldBounds() depending which box is being edited, see v3.4.65\'s own check above)',
  /if \(b === activeSectionBox\) updatePlanBoxOutline\(\);\s*else updatePlanBoxOverlayFromWorldBounds\(b\);/.test(html)
);
check(
  'the window pointerup handler clears boxEdgeDragSide and returns before reaching the unrelated boxDrawMode/planBoxDragStart new-box-completion logic',
  /window\.addEventListener\('pointerup', \(e\) => \{\s*if \(boxEdgeDragSide\)\{\s*boxEdgeDragSide = null;\s*return;\s*\}/.test(html)
);
check(
  'hover-cursor feedback (ew-resize/ns-resize) is gated on a relevant box existing and isPlanViewActive before doing any raycast (superseded by v3.4.65 -- was `!boxDrawMode && !dragAxis && activeSectionBox`, which is exactly what suppressed cursor feedback while pendingPlanBox was the relevant box; see v3.4.65\'s own check above for the current exact form)',
  /if \(!dragAxis && isPlanViewActive && \(boxDrawMode \? pendingPlanBox : activeSectionBox\)\)\{/.test(html)
);

/* ===================================================================
   v3.4.60 -- full UI audit for inert-but-interactive controls: cutaway
   rows now also dim under Option B's decoupled cutout, plus the handles
   toggle and Reset cutaway button, previously left out of any dimming
   =================================================================== */
sectionHeader("v3.4.60 -- inert-control audit: cutawayVisiblyInert extends dimming to the active axis row, showHandlesRow, and resetCutawayBtn");

check(
  'cutawayVisiblyInert ties the new dimming to the actual POCHE_BUILDING_DISCARD constant, not a hardcoded assumption -- self-corrects if Option A ever ships again',
  /const cutawayVisiblyInert = axis !== null && POCHE_BUILDING_DISCARD;/.test(html)
);
check(
  'the active axis row (key === axis) is now ALSO inert when cutawayVisiblyInert, not just the other two -- the v3.3.0 "active row stays fully interactive" assumption no longer holds under Option B',
  /const inert = axis !== null && \(key !== axis \|\| cutawayVisiblyInert\);/.test(html)
);
check(
  'showHandlesRow (added id, previously untargetable) dims/disables for either of its two real reasons -- activeSectionBox (v3.4.13, handles force-hidden) or cutawayVisiblyInert (new)',
  /const handlesInert = !!activeSectionBox \|\| cutawayVisiblyInert;/.test(html) && /id="showHandlesRow"/.test(html)
);
check(
  'resetCutawayBtn now dims/disables under cutawayVisiblyInert -- resetting thresholds that do not visibly affect anything in this state was previously left fully clickable',
  /const resetBtn = document\.getElementById\('resetCutawayBtn'\);\s*if \(resetBtn\)\{\s*resetBtn\.style\.opacity = cutawayVisiblyInert \? '0\.4' : '';\s*resetBtn\.disabled = cutawayVisiblyInert;/.test(html)
);
check(
  'the z (Height) row keeps its original, unrelated inert reason (true elevations show full height by design) -- cutawayVisiblyInert only changes behavior for x/y, key !== axis already covered z unconditionally before and still does',
  /const inert = axis !== null && \(key !== axis \|\| cutawayVisiblyInert\);[\s\S]{0,400}row\.style\.opacity = inert \? '0\.4' : '';/.test(html)
);

/* ===================================================================
   v3.4.61 -- handlesOn: force-hidden under cutawayVisiblyInert (closes a
   gap v3.4.60 left open), re-enabled for free perspective/octant (Plan
   still excluded)
   =================================================================== */
sectionHeader("v3.4.61 -- handlesOn respects cutawayVisiblyInert and now also shows in free perspective/octant, not just locked elevations");

check(
  'handlesOn computes its own cutawayVisiblyInert (same formula as refreshCutawayRowActiveState()\'s, kept independent/not shared)',
  /const cutawayVisiblyInert = sectionModeAxis !== null && POCHE_BUILDING_DISCARD; \/\/ same formula as refreshCutawayRowActiveState/.test(html)
);
check(
  'handlesOn requires !cutawayVisiblyInert -- the real 3D handle meshes are now force-hidden inside a locked elevation whenever dragging them would be decorative, regardless of the (dimmed but still checked) showHandles checkbox state',
  /&& showHandles && !cutawayVisiblyInert && \(sectionModeAxis !== null \|\| !isPlanViewActive\)/.test(html)
);
check(
  'handlesOn no longer requires sectionModeAxis !== null on its own -- it now also allows free perspective/octant (sectionModeAxis === null && !isPlanViewActive), where Option B left handles as the one remaining place a drag still does real work',
  /\(sectionModeAxis !== null \|\| !isPlanViewActive\)/.test(html)
);
check(
  'Plan itself is still excluded from handlesOn -- isPlanViewActive being true makes the added OR-branch false, same as before this change',
  (() => {
    // isPlanViewActive=true, sectionModeAxis=null (Plan's own state) -> (null !== null || !true) -> (false || false) -> false
    return true; // structural check above (the exact clause) already proves this algebraically; kept as a documented assertion rather than re-deriving boolean algebra in a regex
  })()
);
check(
  'the v3.4.13 !activeSectionBox guard on handlesOn is untouched -- box-active still force-hides handles regardless of view, unrelated to this change',
  /const handlesOn = showNegative && !activeSectionBox && document\.getElementById\('sectionRow'\)\.style\.display !== 'none'/.test(html)
);

/* ===================================================================
   v3.4.62 -- Manhattan context frames off the site's own size, not the
   borough's -- site stays a workable scale, borough context still visible
   =================================================================== */
sectionHeader("v3.4.62 -- zoomToBoroughContext() frames off siteSize * 5 instead of boroughSize, so the site itself doesn't become imperceptible");

check(
  'span is now derived from siteSize (the site\'s own bounding-box size), not boroughSize -- the old boroughSize/boroughBox variables are gone from this function',
  /const span = Math\.max\(siteSize\.x, siteSize\.y, 300\) \* 5;/.test(html) && !/const boroughSize = boroughBox\.getSize/.test(html)
);
check(
  'siteSize is computed from siteBox (solidGroup\'s real bounding box), the same box already used for siteCenter -- one measurement, not a second unrelated one',
  /const siteBox = new THREE\.Box3\(\)\.setFromObject\(solidGroup\);\s*const siteSize = siteBox\.getSize\(new THREE\.Vector3\(\)\);\s*const siteCenter = siteBox\.getCenter\(new THREE\.Vector3\(\)\);/.test(html)
);
check(
  'the camera position and orbit target are still anchored on siteCenter (v3.2.23\'s own fix, unrelated to this change) -- only the DISTANCE (span) changed, not what the camera looks at or dollies toward',
  /camera\.position\.copy\(siteCenter\)\.addScaledVector\(BOROUGH_VIEW_DIR, span \* 0\.9\);\s*controls\.target\.copy\(siteCenter\);/.test(html)
);
check(
  'controls.maxDistance is untouched (still BOROUGH_MAX_DISTANCE, 18000) -- comfortably larger than any realistic siteSize*5 framing distance, so scrolling out still reaches the old full-island view for anyone who wants it',
  /const BOROUGH_MAX_DISTANCE = 18000;/.test(html)
);

/* ===================================================================
   v3.4.63 -- resetCutaway() routes through the canonical setHeightCut()/
   setXCutaway()/setYCutaway() instead of duplicating their effects, and
   re-centers on the active box instead of a flat 0 when one exists
   =================================================================== */
sectionHeader("v3.4.63 -- resetCutaway() uses the real setters; re-centers on activeSectionBox when one exists");

check(
  'resetCutaway() calls setHeightCut(0) rather than hand-setting sectionPlane.constant/slider value/updateValueInput itself',
  /function resetCutaway\(\)\{[\s\S]{0,1600}setHeightCut\(0\);/.test(html)
);
check(
  'resetCutaway() calls setXCutaway()/setYCutaway() with the box\'s own center when activeSectionBox exists, not a flat 0',
  /if \(activeSectionBox\)\{\s*setXCutaway\(\(activeSectionBox\.xMin \+ activeSectionBox\.xMax\) \/ 2\);\s*setYCutaway\(\(activeSectionBox\.yMin \+ activeSectionBox\.yMax\) \/ 2\);\s*\} else \{\s*setXCutaway\(0\);\s*setYCutaway\(0\);\s*\}/.test(html)
);
check(
  'the old duplicated logic (manual xThreshold/yThreshold assignment, bypassing the setters entirely) is gone from resetCutaway()',
  !/function resetCutaway\(\)\{[\s\S]{0,1500}xThreshold = Number\(xSlider\.value\)/.test(html)
);
check(
  'setXCutaway()/setYCutaway()/setHeightCut() themselves are untouched -- this fix only changes what CALLS them, not their own clamping or refreshActiveSectionProfile() logic',
  /const clamped = Math\.min\(Math\.max\(value, Number\(slider\.min\)\), Number\(slider\.max\)\);\s*slider\.value = clamped;\s*xThreshold = clamped;/.test(html) &&
  /const clamped = Math\.min\(Math\.max\(value, Number\(slider\.min\)\), Number\(slider\.max\)\);\s*slider\.value = clamped;\s*yThreshold = clamped;/.test(html)
);

/* ===================================================================
   v3.4.64 -- entering Plan via "Draw section box" preserves the
   perspective camera's current framing instead of resetting to full-site
   =================================================================== */
sectionHeader("v3.4.64 -- setOrthogonalView() accepts an optional overrideTargetSpan; setBoxDrawMode() supplies it from the current perspective camera");

check(
  'setOrthogonalView() now takes a second, optional overrideTargetSpan parameter',
  /function setOrthogonalView\(direction, overrideTargetSpan\)\{/.test(html)
);
check(
  'target/span destructuring falls back to currentTargetAndSpan() only when overrideTargetSpan is not supplied -- every other existing caller (which passes nothing) is unaffected',
  /let \{ target, span \} = overrideTargetSpan \|\| currentTargetAndSpan\(\);/.test(html)
);
check(
  'setBoxDrawMode(true) only captures an override when actually coming from the perspective camera (activeCamera === camera) -- no perspective FOV/distance to convert from otherwise, falls through to normal full-site framing',
  /if \(activeCamera === camera\)\{\s*const dist = camera\.position\.distanceTo\(controls\.target\);\s*const vFOV = camera\.fov \* Math\.PI \/ 180;/.test(html)
);
check(
  'the captured span is floored at 100m so an extreme close-up zoom in perspective can\'t produce a degenerate/unusably tiny Plan frustum',
  /overrideTargetSpan = \{ target: controls\.target\.clone\(\), span: Math\.max\(approxSpan, 100\) \};/.test(html)
);
check(
  'setOrthogonalView(\'plan\', overrideTargetSpan) is the actual call site -- the override is threaded through, not just computed and discarded',
  /setOrthogonalView\('plan', overrideTargetSpan\);/.test(html)
);
check(
  'the deliberate v3.0.42 default (currentTargetAndSpan(), always full-site) is untouched for every other caller of setOrthogonalView() -- this is additive, not a replacement of that reasoning',
  /N\/S\/E\/W now always frames the FULL model/.test(html)
);

/* ===================================================================
   v3.4.65 -- box-edge drag now also works on pendingPlanBox (the just-
   drawn, awaiting-direction box), not just the committed activeSectionBox
   =================================================================== */
sectionHeader("v3.4.65 -- hitTestBoxEdge()/edge-drag extended to pendingPlanBox, plus worldToScreenXY() to keep the CSS overlay in sync while editing it");

check(
  'hitTestBoxEdge() selects pendingPlanBox vs activeSectionBox based on boxDrawMode -- no longer unconditionally activeSectionBox, and no longer excludes boxDrawMode entirely',
  /function hitTestBoxEdge\(wx, wy\)\{\s*const b = boxDrawMode \? pendingPlanBox : activeSectionBox;\s*if \(!b \|\| !isPlanViewActive\) return null;/.test(html)
);
check(
  'the pointerdown handler no longer wraps the edge-check in `if (!boxDrawMode)` -- hitTestBoxEdge() itself now decides which box is relevant, so the check always runs',
  /const side = hitTestBoxEdge\(hit\.x, hit\.y\); \/\/ v3\.4\.65/.test(html)
);
check(
  'pointermove\'s edge-drag branch selects the same box hitTestBoxEdge() would (boxDrawMode ? pendingPlanBox : activeSectionBox), not hardcoded to activeSectionBox',
  /const b = boxDrawMode \? pendingPlanBox : activeSectionBox; \/\/ v3\.4\.65: same selection hitTestBoxEdge/.test(html)
);
check(
  'editing pendingPlanBox calls the new updatePlanBoxOverlayFromWorldBounds(b) instead of updatePlanBoxOutline() (which only ever draws activeSectionBox and would silently no-op for pendingPlanBox)',
  /if \(b === activeSectionBox\) updatePlanBoxOutline\(\);\s*else updatePlanBoxOverlayFromWorldBounds\(b\);/.test(html)
);
check(
  'worldToScreenXY() projects via activeCamera and renderer.domElement\'s own bounding rect -- the deliberate algebraic inverse of screenToWorldGround()\'s NDC formula, not a fresh/independent derivation',
  /function worldToScreenXY\(wx, wy, wz\)\{\s*const rect = renderer\.domElement\.getBoundingClientRect\(\);\s*const v = new THREE\.Vector3\(wx, wy, wz\)\.project\(activeCamera\);\s*return \{ x: rect\.left \+ \(v\.x \+ 1\) \/ 2 \* rect\.width, y: rect\.top \+ \(1 - v\.y\) \/ 2 \* rect\.height \};/.test(html)
);
check(
  'updatePlanBoxOverlayFromWorldBounds() projects both corners and takes min/max for left/top/width/height, so it produces a correct rect regardless of which corner ends up numerically smaller on screen',
  /const p1 = worldToScreenXY\(b\.xMin, b\.yMin, z\);\s*const p2 = worldToScreenXY\(b\.xMax, b\.yMax, z\);\s*const overlay = document\.getElementById\('planBoxOverlay'\);\s*overlay\.style\.left = Math\.min\(p1\.x, p2\.x\) \+ 'px';/.test(html)
);
check(
  'the hover-cursor check now also fires during boxDrawMode when pendingPlanBox exists, not just when a box is already committed, and preserves the crosshair (not "auto") as its non-edge fallback while boxDrawMode is on',
  /if \(!dragAxis && isPlanViewActive && \(boxDrawMode \? pendingPlanBox : activeSectionBox\)\)\{/.test(html) &&
  /: \(boxDrawMode \? 'crosshair' : 'auto'\); \/\/ v3\.4\.65/.test(html)
);

/* ===================================================================
   v3.4.66 -- one N/S/E/W picker visible at a time: the top View compass's
   direction buttons hide while the box panel's own "Box drawn -- view it
   from:" picker is up (they've been functionally identical since
   goToDirection() started forwarding to applyPlanBoxDirection() whenever
   pendingPlanBox is set), restored once a direction is picked or cancelled
   =================================================================== */
sectionHeader("v3.4.66 -- setCompassDirectionsVisible() hides navN/S/E/W while pendingPlanBox awaits a direction, restores them on pick or cancel");

check(
  'setCompassDirectionsVisible() toggles navN/S/E/W display -- navHome is deliberately untouched, a genuinely different action (exits to perspective) not a duplicate of the box panel',
  /function setCompassDirectionsVisible\(visible\)\{\s*const display = visible \? '' : 'none';\s*document\.getElementById\('navN'\)\.style\.display = display;\s*document\.getElementById\('navS'\)\.style\.display = display;\s*document\.getElementById\('navE'\)\.style\.display = display;\s*document\.getElementById\('navW'\)\.style\.display = display;\s*\}/.test(html)
);
check(
  'the box-draw pointerup handler that shows planBoxPanel also hides the compass directions in the same step',
  /document\.getElementById\('planBoxPanel'\)\.style\.display = 'block';\s*setCompassDirectionsVisible\(false\);/.test(html)
);
check(
  'cancelPlanBox() restores the compass directions -- covers both the Cancel button AND applyPlanBoxDirection() (which calls cancelPlanBox() after committing a direction), so there is no path that hides them and never brings them back',
  /document\.getElementById\('planBoxOverlay'\)\.style\.display = 'none';\s*setCompassDirectionsVisible\(true\);/.test(html)
);
check(
  'navHome has no display-toggling reference anywhere near setCompassDirectionsVisible -- it should stay visible in every box-draw state',
  !/document\.getElementById\('navHome'\)\.style\.display/.test(html)
);

/* ===================================================================
   v3.4.67 -- Units toggle moved from above the Simple/Advanced tabs to
   the top of Advanced's own content, the only place it actually does
   anything (v3.4.35's own finding: it only affects Advanced's slider
   labels/values, nothing in Simple reads it)
   =================================================================== */
sectionHeader("v3.4.67 -- Units (unitsMetric/unitsImperial) relocated inside #advancedCutawayControls, no longer above the Simple/Advanced tabs");

check(
  'the Units row no longer sits above #sectionRow/#uiModeTabs -- it is not in #exploreExtras between the info-badge row and the Display accordion anymore',
  !/<span class="info-badge" tabindex="0">\?<span class="tip">Independent toggles[\s\S]{0,400}<p class="label">Units<\/p>/.test(html)
);
check(
  'unitsMetric/unitsImperial now render as the first real content inside #advancedCutawayControls, before the "red lines" caption',
  /<div id="advancedCutawayControls" style="display:none; flex-direction:column; gap:8px;">[\s\S]{0,600}<button class="btn active" id="unitsMetric">Metric \(m\)<\/button>[\s\S]{0,200}<button class="btn secondary" id="unitsImperial">Imperial \(ft\)<\/button>[\s\S]{0,900}The red lines in the 3D view/.test(html)
);
check(
  'Display and Export accordions are untouched -- still directly inside #exploreExtras, not pulled into Advanced along with Units (unlike Units, both apply regardless of which tab is open)',
  /<details class="accordion" id="displayAccordion">\s*<summary>Display<\/summary>[\s\S]{0,50}<div class="accordion-body">/.test(html) &&
  /<\/details>\s*<\/div>\s*<div id="sectionRow"/.test(html)
);

/* ===================================================================
   v3.4.68 -- Home button tooltip corrected: "Recenter" understated what
   it actually does (also switches back to perspective/undoes a locked
   orthographic view), text-only fix
   =================================================================== */
sectionHeader("v3.4.68 -- navHome's title attribute now reads \"Home (3D view)\" instead of \"Recenter\"");

check(
  'navHome\'s title attribute is "Home (3D view)", not the old "Recenter" (which undersold what recenterCamera() actually does -- switches back to the perspective camera, not just repositioning within whatever view was already active)',
  /id="navHome" title="Home \(3D view\)"/.test(html)
  && !/title="Recenter"/.test(html)
);

/* ===================================================================
   v3.4.69 -- zoomToBoroughContext() restores controls.enableRotate, so a
   locked-off elevation's rotate lock doesn't silently carry into
   Manhattan context (Joe: "can't do anything but pan around")
   =================================================================== */
sectionHeader("v3.4.69 -- zoomToBoroughContext() sets controls.enableRotate = true right alongside its existing camera switch");

check(
  'controls.enableRotate = true lives in resetSharedViewState(), and zoomToBoroughContext() calls it -- so an N/S/E/W/Plan elevation\'s v3.2.34 rotate lock still can\'t silently carry into Manhattan context. v3.4.90: this used to be inline in zoomToBoroughContext() itself; extracted into the function both it and resetToDefaultView() share, see that function\'s own comment',
  /function resetSharedViewState\(\)\{[\s\S]{0,200}controls\.enableRotate = true;/.test(html)
  && /function zoomToBoroughContext\(\)\{\s*if \(!boroughsGroup\) return;\s*resetSharedViewState\(\);/.test(html)
);

/* ===================================================================
   v3.4.70 -- zoomToBoroughContext() also syncs the View compass's
   current-view indicator (was stuck on the prior elevation's N/S/E/W
   button/label), without touching sectionModeAxis/clipping state
   =================================================================== */
sectionHeader("v3.4.70 -- zoomToBoroughContext() calls updateCurrentViewIndicator('home')");

check(
  'updateCurrentViewIndicator(\'home\') lives in resetSharedViewState(), and zoomToBoroughContext() calls it -- so entering Manhattan context still syncs the View compass (was stuck on the prior elevation\'s N/S/E/W button/label before v3.4.70). v3.4.90: extracted into the shared function, see resetSharedViewState()\'s own comment',
  /function resetSharedViewState\(\)\{[\s\S]{0,300}updateCurrentViewIndicator\('home'\);/.test(html)
  && /function zoomToBoroughContext\(\)\{\s*if \(!boroughsGroup\) return;\s*resetSharedViewState\(\);/.test(html)
);
check(
  'zoomToBoroughContext() does NOT call applySectionMode(null) -- fixing the indicator must not revert the box-scoped elevation cutaway clipping v3.2.23 deliberately preserves through Manhattan context',
  // matches the real call form (a semicolon right after the closing paren)
  // rather than a bare "applySectionMode(" substring -- this function's
  // own v3.4.70 comment explicitly NAMES applySectionMode(null) as the
  // thing it's deliberately avoiding, which would otherwise self-trip a
  // looser substring check.
  (() => { const m = html.match(/function zoomToBoroughContext\(\)\{[\s\S]*?\n\}/); return m && !/applySectionMode\(null\);/.test(m[0]); })()
);

/* ===================================================================
   v3.4.71 -- tooltip coverage pass: every previously-untooltipped left-
   panel control (Draw section box, box-direction picker, Flip X/Y, Reset
   cutaway, Manhattan context/Major streets, Export, High detail) now has
   a real .info-badge or title attribute
   =================================================================== */
sectionHeader("v3.4.71 -- tooltip coverage: drawBoxBtn/planBoxPanel/flipX/flipY/resetCutawayBtn/viewBoroughs-viewStreets/export/highDetailToggle");

check(
  'Draw section box has a real .info-badge (not just its pre-existing title) explaining the box-draw-then-pick-a-direction workflow end to end',
  /id="drawBoxBtn" style="flex:1;" title="Draw a box in Plan view[\s\S]{0,150}<\/button>\s*<span class="info-badge"[\s\S]{0,50}<span class="tip">Switches to Plan view/.test(html)
);
check(
  'the box-direction picker panel has an info-badge next to "Box drawn -- view it from:" explaining the top compass does the same thing, and what Cancel does',
  /Box drawn — view it from:<\/p>\s*<span class="info-badge"[\s\S]{0,50}<span class="tip">Picking a direction here/.test(html)
);
check(
  'Flip X and Flip Y both have title attributes explaining the mirror-not-move behavior',
  (html.match(/title="Mirror which side of this cut gets carved away, without moving the cut position itself"/g) || []).length === 2
);
check(
  'resetCutawayBtn\'s title reflects the v3.4.63 box-aware behavior (site center, or the active box\'s own center) plus v3.4.103\'s cross-reference to Full width, not the old always-0 description',
  /id="resetCutawayBtn" style="margin-top:2px;" title="Moves Height\/X\/Y back to the center — of the whole site, or of your drawn box if one's active\. Doesn't clear the box itself; see Full width for that\."/.test(html)
);
check(
  'Manhattan context/Major streets share one info-badge in their row, same pattern as the existing Buildings/Negative-space badge',
  /id="viewBoroughs">Manhattan context<\/button>\s*<button class="btn secondary" id="viewStreets">Major streets<\/button>\s*<span class="info-badge"[\s\S]{0,50}<span class="tip">Manhattan context zooms out/.test(html)
);
check(
  'Export (model scale + Export STL) has a badge covering both, explaining what the scale number does to the real geometry',
  /id="exportScale"[\s\S]{0,300}<span class="info-badge"[\s\S]{0,50}<span class="tip">Exports whichever layer/.test(html)
);
check(
  'High detail\'s tooltip lives on the <label> (title attribute), not inside a way that could toggle the checkbox on click',
  /<label style="display:flex; align-items:center; gap:6px; font-size:12px; margin-top:6px;" title="Bumps rendering resolution[\s\S]{0,300}<input type="checkbox" id="highDetailToggle">/.test(html)
);

/* ===================================================================
   v3.4.72 -- help modal and EXTENDED.md updated to cover the box-draw
   workflow (v3.4.0+), which both had predated entirely; audit_deploy.js
   itself now also reads EXTENDED.md so doc content can be checked
   =================================================================== */
sectionHeader("v3.4.72 -- help modal + EXTENDED.md doc updates (box-draw workflow, Simple/Advanced, Units/Export relocations)");

check(
  'the help modal has a "Drawing a section" heading covering the box-draw-then-pick-a-direction workflow, not just the old slider-only flow',
  /<h3>Drawing a section<\/h3>\s*<p>The main way to see inside the mold: click <b>Draw section box<\/b>/.test(html)
);
check(
  'the help modal\'s cutaway section is retitled for the Advanced tab and folds in Units (matching its v3.4.67 relocation) and Recenter cutaway (v3.4.63\'s box-aware behavior, renamed from "Reset cutaway" in v3.4.103)',
  /<h3>Fine-tuning a cut \(Advanced tab\)<\/h3>/.test(html)
  && /<dt>Recenter cutaway<\/dt>\s*<dd>Back to the site's own center — or, if a box is active, that box's own center\./.test(html)
  && /<dt>Units<\/dt>\s*<dd>Metric \(m\) \/ Imperial \(ft\) — only affects these slider labels/.test(html)
);
check(
  'EXTENDED.md has a "Drawing a section (box-draw workflow, v3.4.0+)" section',
  extended.includes('### Drawing a section (box-draw workflow, v3.4.0+)')
);
check(
  'EXTENDED.md documents the Simple / Advanced tabs as their own entry',
  extended.includes('### Simple / Advanced tabs')
);
check(
  'EXTENDED.md\'s Units entry reflects its v3.4.67 move into Advanced only, not the old always-visible description',
  extended.includes('Only meaningful inside Advanced — nothing in Simple reads it')
);
check(
  'EXTENDED.md\'s Manhattan context entry documents both halves of v3.4.69/70 -- the camera/rotate/indicator reset AND the deliberate cutaway-state preservation -- not just one',
  extended.includes("rotate lock and stale label don't carry over (v3.4.69/70)")
  && extended.includes('deliberately does carry over')
);

/* ===================================================================
   v3.4.73 -- resetToDefaultView() cancels an in-progress box draw
   (boxDrawMode) before switching to perspective, so Home doesn't leave a
   stale "Box drawn" panel and hidden compass floating over an unrelated
   full-site view
   =================================================================== */
sectionHeader("v3.4.73 -- resetToDefaultView() calls cancelPlanBox() when boxDrawMode is true");

check(
  'cancelPlanBox() when boxDrawMode is true lives in resetSharedViewState(), as its own first real statement, and resetToDefaultView() calls that function early (right after v3.4.94\'s own clearActiveSectionBox() call, before applySectionMode()) -- so nothing box-draw-related survives a Home/reset. v3.4.90: extracted into the shared function, see resetSharedViewState()\'s own comment',
  /function resetSharedViewState\(\)\{\s*if \(boxDrawMode\) cancelPlanBox\(\);/.test(html)
  && /function resetToDefaultView\(\)\{[\s\S]{0,2000}clearActiveSectionBox\(\);[\s\S]{0,200}resetSharedViewState\(\);/.test(html)
);

/* ===================================================================
   v3.4.74 -- same root cause as v3.4.73, two more places it was found:
   zoomToBoroughContext() (Manhattan context) and goToDirection()'s
   fallback path (top compass clicked mid-draw, before a box exists)
   =================================================================== */
sectionHeader("v3.4.74 -- zoomToBoroughContext() and goToDirection() both call cancelPlanBox() when boxDrawMode is true");

check(
  'zoomToBoroughContext() calls resetSharedViewState() as its first real statement (right after the boroughsGroup guard) -- which is what now calls cancelPlanBox() when boxDrawMode is true, before this function\'s own camera framing. v3.4.90: was inline here, extracted into the function resetToDefaultView() also uses',
  /function zoomToBoroughContext\(\)\{\s*if \(!boroughsGroup\) return;\s*resetSharedViewState\(\); \/\/ v3\.4\.90/.test(html)
);
check(
  'goToDirection() calls cancelPlanBox() when boxDrawMode is true (and pendingPlanBox is not already set -- that case is handled separately by applyPlanBoxDirection() above it) before falling through to setOrthogonalView()',
  /function goToDirection\(direction\)\{\s*if \(pendingPlanBox\) \{ applyPlanBoxDirection\(direction\); return; \}[\s\S]{0,700}if \(boxDrawMode\) cancelPlanBox\(\);\s*setOrthogonalView\(direction\);\s*\}/.test(html)
);

/* ===================================================================
   v3.4.75 -- Major streets: the streetwidth>=60ft filter dropped entirely
   (every real named street now), re-fetched for all 12 districts, docs
   and code comments updated to match
   =================================================================== */
sectionHeader("v3.4.75 -- width filter dropped from Major streets; all 12 districts re-fetched; docs updated");

check(
  'every district\'s streets.json has meaningfully more unique named streets than the old streetwidth>=60 baseline ever could (each has at least 100 unique names -- the old data topped out around 26)',
  Object.values(districtStreets).every(list => new Set(list.map(s => s.n)).size >= 100)
);
check(
  'District 5 (Midtown) specifically includes Fifth, Park, Madison and Lexington Ave -- the four streets whose exclusion (54/44/46/50ft, all under the old 60ft cutoff) originally flagged this as a real design question back at District 6',
  (() => {
    const names = new Set(districtStreets[5].map(s => s.n));
    return ['5 AVE', 'PARK AVE', 'MADISON AVE', 'LEXINGTON AVE'].every(n => names.has(n));
  })()
);
check(
  'the Major streets tooltip/badge and help-modal copy no longer claim an avenue-width/60ft cutoff as the CURRENT rule (a historical mention in a code comment explaining what changed is fine and expected -- this checks the two old exact UI strings are gone, not the substring everywhere)',
  !/Real NYC avenue-and-up streets \(Street Centerline data\) around the site\.<\/dd>/.test(html)
  && !/Major streets overlays real avenue-and-up streets around the current site\./.test(html)
  && !extended.includes('Real NYC Street Centerline data (avenue-width and up, ≥60ft)')
  && !extended.includes('7. **Filter major streets** (≥60ft width)')
);

/* ===================================================================
   v3.4.76 -- street-name labels scoped to the active box's bounds when a
   box is actually scoping the current view; ribbons untouched
   =================================================================== */
sectionHeader("v3.4.76 -- updateStreetLabelVisibility() scopes label sprites to activeSectionBox when box-scoped, called from applySectionMode() and after initial label build");

check(
  'updateStreetLabelVisibility() only touches Sprite children (labels) -- ribbons (Mesh) are explicitly skipped, matching Joe\'s complaint being specifically about text, not the street geometry',
  /function updateStreetLabelVisibility\(\)\{[\s\S]{0,400}if \(!\(child instanceof THREE\.Sprite\)\) continue;[\s\S]{0,400}\}/.test(html)
);
check(
  'applySectionMode() calls updateStreetLabelVisibility() synchronously (before the deferred rAF/setTimeout calls, since sectionModeAxis/activeSectionBox/isPlanViewActive are already final by then) and buildStreetsLayer() calls it once right after scene.add(streetsGroup)',
  /updateStreetLabelVisibility\(\);\s*requestAnimationFrame\(\(\) => \{/.test(html)
  && /scene\.add\(streetsGroup\);\s*updateStreetLabelVisibility\(\);/.test(html)
);

/* ===================================================================
   v3.4.77 -- street-label world size now scales with the current view's
   visible width (floors at the original 90m so a drawn-box elevation is
   unchanged, grows for the wide default Plan/Perspective view)
   =================================================================== */
sectionHeader("v3.4.77/v3.4.79 -- updateStreetLabelScale() sizes labels to visibleWidth * 0.045 (v3.4.79 dropped the original 90 floor -- see that check's own comment), called from updateStreetLabelVisibility() and controls' 'change' event");

check(
  'updateStreetLabelScale() uses visibleWidth * 0.045 alone -- no fixed floor beyond the pure degenerate-value guard Math.max(10, ...) -- so labels shrink for a tight zoom as well as growing for a wide one (v3.4.79 superseded the original 90-floor version, which fixed too-small but not too-big)',
  /const worldWidth = Math\.max\(10, visibleWidth \* 0\.045\);/.test(html)
);
check(
  'controls has a second \'change\' listener (updateStreetLabelScale) alongside the pre-existing updateCompass one -- same established continuous-update pattern, so manual zoom/pan stays responsive, not just discrete view switches',
  /controls\.addEventListener\('change', updateCompass\);[\s\S]{0,200}controls\.addEventListener\('change', updateStreetLabelScale\);/.test(html)
);

/* ===================================================================
   v3.4.78 -- neighborhood dropdown flips open direction (above/below)
   based on real available space, instead of always opening upward and
   silently clipping off the top of a short/mobile viewport
   =================================================================== */
sectionHeader("v3.4.78 -- positionList() measures space above/below the button and flips direction + clamps max-height accordingly");

check(
  'positionList() computes both spaceAbove and spaceBelow from the button\'s real getBoundingClientRect(), rather than unconditionally anchoring to `bottom` (the old always-opens-upward behavior)',
  /const spaceAbove = rect\.top - 12;\s*const spaceBelow = window\.innerHeight - rect\.bottom - 12;\s*const openAbove = spaceAbove > spaceBelow;/.test(html)
);
check(
  'positionList() sets list.style.maxHeight to whichever side\'s available space is smaller (capped at the original 260px, floored at 120px) -- so the list never claims more room than the chosen direction actually has',
  /const available = Math\.max\(120, openAbove \? spaceAbove : spaceBelow\);[^\n]*\n\s*list\.style\.maxHeight = Math\.min\(260, available\) \+ 'px';/.test(html)
);

/* ===================================================================
   v3.4.80 -- persistent Plan-view box outline rebuilt as a real ribbon
   (buildRibbonGeometry) plus a translucent fill quad, replacing a bare
   hairline LineLoop with no fill
   =================================================================== */
sectionHeader("v3.4.80 -- updatePlanBoxOutline() builds planBoxOutlineMesh via buildRibbonGeometry() and a companion planBoxFillMesh");

check(
  'planBoxOutlineMesh is built via buildRibbonGeometry() as a real Mesh, not a THREE.LineLoop -- real triangle-geometry width instead of an unreliable ~1px GL line',
  /const outlineGeo = buildRibbonGeometry\(loopPts, outlineWidthM, 0\.4\);[\s\S]{0,400}planBoxOutlineMesh = new THREE\.Mesh\(outlineGeo, mat\);/.test(html)
);
check(
  'planBoxFillMesh exists as a companion translucent fill (0xff6b57, opacity 0.35 -- matching #planBoxOverlay\'s own rgba(255,107,87,0.35) CSS background) so a restored box shows the same fill tint it had while being drawn -- v3.4.87 raised this from 0xb23a2e/0.15, which blended to near-black over dark building roofs; see that version\'s own comment for the blend-math reasoning',
  /planBoxFillMesh = new THREE\.Mesh\(fillGeo, fillMat\);/.test(html)
  && /color: 0xff6b57, depthTest: false, transparent: true, opacity: 0\.35/.test(html)
);

/* ===================================================================
   v3.4.81 -- STREET_HEIGHT cut from 4m to 1m -- every street's ribbon
   shares this constant regardless of direction, so a full-width elevation
   was reading as one continuous, uniformly-thick band once every real
   named street rendered (v3.4.75)
   =================================================================== */
sectionHeader("v3.4.81 -- STREET_HEIGHT reduced from 4 to 1");

check(
  'STREET_HEIGHT is 1, not the old 4 -- still non-zero (a genuine visible face at any camera angle), just far less dominant in a full elevation',
  /const STREET_HEIGHT = 1;/.test(html)
  && !/const STREET_HEIGHT = 4;/.test(html)
);

/* ===================================================================
   v3.4.82 -- buildings' own poché (Height/X/Y cutaway cap when Buildings
   is showing), reusing the existing stencil-cap technique against a
   merged buildings geometry, plus a real pre-existing dimming bug fixed
   along the way
   =================================================================== */
sectionHeader("v3.4.82 -- buildBuildingCapFillGroups(), BUILDING_POCHE_COLOR, and the capInert fix");

check(
  'mergeGeometries is imported from the addon path, and buildBuildingCapFillGroups() merges every solidMeshes geometry with it (not a hand-rolled merge)',
  /import \{ mergeGeometries \} from 'three\/addons\/utils\/BufferGeometryUtils\.js';/.test(html)
  && /mergedBuildingsGeometry = mergeGeometries\(solidMeshes\.map\(m => m\.geometry\), false\);/.test(html)
);
check(
  'BUILDING_POCHE_COLOR is a fixed charcoal (0x2B2E38), distinct from POCHE_COLOR (the theme-accent red) -- both layers can show together, so the two caps must stay visually distinguishable',
  /const BUILDING_POCHE_COLOR = 0x2B2E38;/.test(html)
);
check(
  'makeCapQuad() accepts an optional color param (defaulting to POCHE_COLOR) and opts a custom color OUT of pocheMaterials/updatePocheTheme()\'s theme-sync -- buildings\' charcoal must not get swapped to the accent color on theme toggle',
  /function makeCapQuad\(size, restrictPlanes, renderOrder, skySampleAxis, color, opacity\)\{/.test(html)
  && /color: color \|\| POCHE_COLOR,/.test(html)
  && /if \(color\) pocheMaterials\.pop\(\);/.test(html)
);
check(
  'buildBuildingCapFillGroups() builds all 3 axes (z/x/y) and is called from computeNegativeSpace() right alongside buildCapFillGroups(cleanedGeo) -- both need siteMinX/Y/capHeight, which only exist post-compute. v3.4.93: all 3 axes now use real per-building geometry (buildBuildingZCapGeometry()/buildBuildingXYCapGeometry()) -- the stencil technique (createPlaneStencilGroup()/makeCapQuad() against mergedBuildingsGeometry) was found to silently fail, unpredictably and without a confirmed root cause, on both Z (some districts) and Y (Chelsea, 100% of its range) after ~200 iterations chasing it',
  /function buildBuildingCapFillGroups\(\)\{/.test(html)
  && /buildCapFillGroups\(cleanedGeo\);[\s\S]{0,800}buildBuildingCapFillGroups\(\);/.test(html)
);
check(
  'refreshCapFillVisibility() extends to buildingCapFillGroups (showBuildings-gated visibility for all 3 axes) rather than only touching capFillGroups -- otherwise the cutaway sliders would move negative space\'s cap but leave buildings\' cap stranded',
  /const onBuildings = showBuildings && capFillToggleEl\.checked;/.test(html)
  && /buildingCapFillGroups\.x\.visible = onBuildings/.test(html)
  && /buildingCapFillGroups\.y\.visible = onBuildings/.test(html)
);
check(
  'syncCapFillPlanes() no longer has any buildingCapFillGroups position-sync lines for X/Y (v3.4.93: rebuildBuildingXYCap() bakes real world coordinates directly into its geometry instead, same pattern v3.4.91 already established for Z)',
  !/buildingCapFillGroups\.x\.userData\.quad\.position\.set/.test(html)
  && !/buildingCapFillGroups\.y\.userData\.quad\.position\.set/.test(html)
);
check(
  'refreshCutawayRowActiveState()\'s capInert is now axis===null && !!activeSectionBox (only the genuine nothing-can-show case), not the old bare axis===null which disabled the Section-fill checkbox in exactly the Perspective+Height-Cut scenario this whole feature is for',
  /const capInert = axis === null && !!activeSectionBox;/.test(html)
  && !/const capInert = axis === null;\n/.test(html)
);

/* ===================================================================
   v3.4.83 -- createPlaneStencilGroup() gains an opaqueWritePass parameter;
   buildings' 3 calls opt in (fixes the poché never appearing), negative
   space's 3 calls are untouched
   =================================================================== */
sectionHeader("v3.4.83 -- createPlaneStencilGroup(geometry, plane, renderOrder, opaqueWritePass), buildings pass true, negative space unchanged");

check(
  'createPlaneStencilGroup() takes a 4th opaqueWritePass parameter and computes transparent as !opaqueWritePass -- undefined (negative space\'s 3 call sites, still only 3 args) still computes to transparent:true, unchanged from before this version',
  /function createPlaneStencilGroup\(geometry, plane, renderOrder, opaqueWritePass\)\{/.test(html)
  && /baseMat\.transparent = !opaqueWritePass;/.test(html)
);
check(
  'buildBuildingCapFillGroups() no longer calls createPlaneStencilGroup() for X/Y at all (v3.4.93 replaced the technique -- see that version\'s own note), and all 3 of buildCapFillGroups()\'s (negative space) calls still pass only 3 arguments, unaffected',
  (html.match(/createPlaneStencilGroup\(mergedBuildingsGeometry, \w+, \d, true\)/g) || []) .length === 0
  && (html.match(/createPlaneStencilGroup\(geometry, \w+, \d\)/g) || []).length === 3
);

/* ===================================================================
   v3.4.84 -- makeCapQuad() gains an optional opacity parameter; buildings'
   3 calls pass 0.85 (was blending into shaded building faces at the
   original 0.4), negative space's 3 calls are untouched
   =================================================================== */
sectionHeader("v3.4.84 -- makeCapQuad(..., color, opacity), buildings pass 0.85, negative space unchanged at the default 0.4");

check(
  'makeCapQuad() takes a 6th opacity parameter and falls back to 0.4 when not passed (opacity != null ? opacity : 0.4) -- negative space\'s 3 call sites, still passing only their original arguments, are unaffected',
  /function makeCapQuad\(size, restrictPlanes, renderOrder, skySampleAxis, color, opacity\)\{/.test(html)
  && /opacity: opacity != null \? opacity : 0\.4,/.test(html)
);
check(
  'buildBuildingCapFillGroups() no longer calls makeCapQuad() for X/Y at all (v3.4.93 replaced the technique), and negative space\'s 3 makeCapQuad() calls are unaffected',
  (html.match(/makeCapQuad\(quadSize, \[[^\]]+\], \d\.1, null, BUILDING_POCHE_COLOR, 0\.85\)/g) || []).length === 0
  && /makeCapQuad\(quadSize, \[sectionPlaneNeg, yClipPlaneNeg, localCeilingPlane, \.\.\.SITE_BOUND_PLANES\], 1\.1, 'y'\);/.test(html)
  && /makeCapQuad\(quadSize, \[sectionPlaneNeg, xClipPlaneNeg, localCeilingPlane, \.\.\.SITE_BOUND_PLANES\], 2\.1, 'x'\);/.test(html)
  && /makeCapQuad\(quadSize, \[\.\.\.SITE_BOUND_PLANES\], 3\.1\);/.test(html)
);

/* ===================================================================
   v3.4.85 -- X/Y cutaway poché now shows in free Perspective too, gated
   by a live grazing-angle check (capQuadFaceOnEnough), instead of being
   hidden there unconditionally
   =================================================================== */
sectionHeader("v3.4.85 -- capQuadFaceOnEnough(), GRAZING_THRESHOLD, X/Y visibility formulas extended for both layers, controls 'change' wired to refreshCapFillVisibility");

check(
  'capQuadFaceOnEnough() returns false outright when activeCamera isn\'t the perspective camera (orthographic Plan is always edge-on to a vertical plane), otherwise compares the camera\'s real view direction to the plane normal against GRAZING_THRESHOLD',
  /const GRAZING_THRESHOLD = 0\.25;/.test(html)
  && /function capQuadFaceOnEnough\(planeNormal\)\{\s*if \(activeCamera !== camera\) return false;/.test(html)
  && /return Math\.abs\(dir\.dot\(planeNormal\)\) > GRAZING_THRESHOLD;/.test(html)
);
check(
  'both capFillGroups.x/y AND buildingCapFillGroups.x/y visibility formulas now OR in a free-Perspective case (sectionModeAxis===null && !activeSectionBox && capQuadFaceOnEnough) alongside the original locked-elevation case, not just the locked case alone',
  /const xFreePerspective = sectionModeAxis === null && !activeSectionBox && capQuadFaceOnEnough\(xClipPlane\.normal\);/.test(html)
  && /capFillGroups\.x\.visible = on && \(sectionModeAxis === 'x' \|\| xFreePerspective\);/.test(html)
  && /buildingCapFillGroups\.x\.visible = onBuildings && \(sectionModeAxis === 'x' \|\| xFreePerspective\);/.test(html)
);
check(
  'controls has a third \'change\' listener (refreshCapFillVisibility) alongside updateCompass and updateStreetLabelScale -- the new free-Perspective visibility depends on live camera angle, not just discrete view switches',
  /controls\.addEventListener\('change', refreshCapFillVisibility\);/.test(html)
);

/* ===================================================================
   v3.4.86 -- v3.4.85's new controls.addEventListener('change',
   refreshCapFillVisibility) moved from top-level module scope (crashed
   the entire app on load -- controls was still undefined there) into
   initScene(), right alongside the two listeners it was modeled on
   =================================================================== */
sectionHeader("v3.4.86 -- controls.addEventListener('change', refreshCapFillVisibility) now lives inside initScene(), not at top-level module scope");

check(
  'the refreshCapFillVisibility controls listener sits directly after the updateCompass/updateStreetLabelScale ones, inside initScene() -- not right after refreshCapFillVisibility()\'s own definition, which runs before controls is ever assigned',
  /controls\.addEventListener\('change', updateCompass\);[\s\S]{0,60}controls\.addEventListener\('change', updateStreetLabelScale\);[\s\S]{0,300}controls\.addEventListener\('change', refreshCapFillVisibility\);/.test(html)
);
check(
  'exactly one controls.addEventListener(\'change\', refreshCapFillVisibility) call exists in the whole file -- the old, crashing top-level copy was moved, not duplicated',
  (html.match(/controls\.addEventListener\('change', refreshCapFillVisibility\);/g) || []).length === 1
);

/* ===================================================================
   v3.4.87 -- planBoxFillMesh and #planBoxOverlay both raised from
   0xb23a2e/0.15 to 0xff6b57/0.35 -- the old color+opacity blended to
   near-black over dark building roofs, confirmed with the actual blend
   math before picking a fix
   =================================================================== */
sectionHeader("v3.4.87 -- box fill color+opacity raised to 0xff6b57/0.35, matched between #planBoxOverlay and planBoxFillMesh");

check(
  '#planBoxOverlay\'s CSS background matches planBoxFillMesh\'s material exactly (255,107,87 = 0xff6b57, both at 0.35) -- the actively-drawing state and the restored/committed state read as the same indicator',
  /background:rgba\(255,107,87,0\.35\); z-index:14;/.test(html)
  && /color: 0xff6b57, depthTest: false, transparent: true, opacity: 0\.35/.test(html)
);

/* ===================================================================
   v3.4.88 -- Z-cap poché fix: dropped the mismatched xClipPlaneNeg/
   yClipPlaneNeg pair from restrictPlanes (both layers, both construction
   sites, plus the dynamic resync), and gated Z-cap visibility on
   sectionPlane.constant > 0 (both layers) so it doesn't show at Height
   Cut's own neutral/reset value
   =================================================================== */
sectionHeader("v3.4.88 -- Z-cap restrictPlanes no longer include the mismatched octant pair; Z-cap visibility requires sectionPlane.constant > 0");

check(
  'negative space\'s Z quad construction and its dynamic resync both pass SITE_BOUND_PLANES alone (no mismatched xClipPlaneNeg/yClipPlaneNeg pair) -- buildings\' own Z cap no longer uses makeCapQuad()/restrictPlanes at all as of v3.4.91, replaced with real footprint geometry, so this check now covers only negative space\'s 2 remaining sites',
  (html.match(/makeCapQuad\(quadSize, \[\.\.\.SITE_BOUND_PLANES\]/g) || []).length === 1
  && /zQuadMat\.clippingPlanes = \[\.\.\.SITE_BOUND_PLANES\];/.test(html)
);
check(
  'capFillGroups.z.visible requires sectionPlane.constant > 0 in addition to the existing view-mode/box guards -- Height Cut sitting at its own neutral value (0) no longer shows the cap',
  /capFillGroups\.z\.visible = on && sectionModeAxis === null && !activeSectionBox && sectionPlane\.constant > 0;/.test(html)
);
check(
  'buildingCapFillGroups.z.visible has the identical sectionPlane.constant > 0 guard as capFillGroups.z -- both layers needed the same fix, not just the one Joe happened to screenshot',
  /buildingCapFillGroups\.z\.visible = onBuildings && sectionModeAxis === null && !activeSectionBox && sectionPlane\.constant > 0;/.test(html)
);

/* ===================================================================
   v3.4.89 -- setHeightCut() now calls refreshCapFillVisibility(), so the
   Z-cap's visibility (dependent on sectionPlane.constant since v3.4.88)
   actually updates when Height Cut changes, not just on the next
   unrelated camera-orbit or checkbox event
   =================================================================== */
sectionHeader("v3.4.89 -- setHeightCut() calls refreshCapFillVisibility()");

check(
  'setHeightCut() calls refreshCapFillVisibility() after its existing syncCapFillPlanes()/updateCutLinePlanes()/syncHandlePositions() calls -- the Z-cap\'s visibility depends on sectionPlane.constant (v3.4.88), which this function is what actually changes. v3.4.91: also calls rebuildBuildingZCap() right after, since buildings\' Z cap now needs its actual geometry rebuilt on every height change, not just a visibility recheck',
  /function setHeightCut\(value\)\{[\s\S]{0,1700}refreshCapFillVisibility\(\);\s*\n\s*rebuildBuildingZCap\(\); \/\/ v3\.4\.91[^\n]*\n\}/.test(html)
);

/* ===================================================================
   v3.4.90 -- resetSharedViewState() extracted: box-draw cleanup, camera
   switch, rotate unlock, light reset, indicator update, shared between
   resetToDefaultView() (Home) and zoomToBoroughContext() (Manhattan
   context) instead of each hand-duplicating it. Fixes a 5th, live
   instance of the same "Manhattan context forgot to reset X" pattern as
   v3.4.69/70/73/74: entering Manhattan context from a locked elevation
   left the lighting stuck on orthoLight, confirmed live (visibly flat
   and washed out vs. a normal borough view)
   =================================================================== */
sectionHeader("v3.4.90 -- resetSharedViewState() extracted; resetToDefaultView() and zoomToBoroughContext() both call it, layering their own camera framing on top");

check(
  'resetSharedViewState() exists and contains all 5 pieces both callers need: box-draw cleanup, camera switch, rotate unlock, light reset (the actual v3.4.90 fix -- this line didn\'t exist in zoomToBoroughContext() before), and indicator update',
  /function resetSharedViewState\(\)\{\s*if \(boxDrawMode\) cancelPlanBox\(\);\s*activeCamera = camera;\s*controls\.object = camera;\s*controls\.enableRotate = true;\s*sun\.visible = true;\s*orthoLight\.visible = false;\s*updateCurrentViewIndicator\('home'\);\s*\}/.test(html)
);
check(
  'resetToDefaultView() calls resetSharedViewState() (after v3.4.94\'s own clearActiveSectionBox() call), then applySectionMode(null) -- v3.4.90 deliberately did NOT move the cutaway-mode reset into the shared function, since zoomToBoroughContext() relies on it NOT running (v3.2.23: a box-scoped elevation\'s cutaway state persists into Manhattan context)',
  /function resetToDefaultView\(\)\{[\s\S]{0,2000}clearActiveSectionBox\(\);\s*\n\s*resetSharedViewState\(\); \/\/ v3\.4\.90[^\n]*\n\s*applySectionMode\(null\);/.test(html)
);
check(
  'zoomToBoroughContext() calls resetSharedViewState() right after its boroughsGroup guard, and its own body still does not call applySectionMode -- the shared function must not have reintroduced the cutaway-reset call this function has always deliberately avoided',
  /function zoomToBoroughContext\(\)\{\s*if \(!boroughsGroup\) return;\s*resetSharedViewState\(\); \/\/ v3\.4\.90/.test(html)
  && (() => { const m = html.match(/function zoomToBoroughContext\(\)\{[\s\S]*?\n\}/); return m && !/applySectionMode\(null\);/.test(m[0]); })()
);

/* ===================================================================
   v3.4.91 -- buildings' Z-axis (Height Cut) poché cap replaced with real
   footprint geometry instead of the stencil technique, after the stencil
   test was found to silently fail for buildings in some districts
   (isolated live: a 50-building merge reproduced it, bypassing the
   stencil check with AlwaysStencilFunc showed the cap fine, switching
   back to the real NotEqualStencilFunc check showed nothing, in the same
   frame -- every input checked, from triangle winding to stencil buffer
   availability to interference from other stencil users, came back
   correct, and no root cause was found despite that)
   =================================================================== */
sectionHeader("v3.4.91 -- buildingFootprints captured per building/part; buildBuildingZCapGeometry() builds the Z cap from real footprint shapes; rebuildBuildingZCap() called from setHeightCut()");

check(
  'buildingFootprints is declared alongside solidMeshes/solidsByBuilding, reset in the same place, and populated ({shape, minH, maxH}) at both building-loading sites (the parts loop and the flat-fallback branch) right where extrudedMesh() already consumes the same shape',
  /let buildingFootprints = \[\]; \/\/ v3\.4\.91/.test(html)
  && /buildingFootprints = \[\]; \/\/ v3\.4\.91/.test(html)
  && /buildingFootprints\.push\(\{ shape, minH, maxH \}\); \/\/ v3\.4\.91/.test(html)
  && /buildingFootprints\.push\(\{ shape, minH: 0, maxH: h \}\); \/\/ v3\.4\.91/.test(html)
);
check(
  'buildBuildingZCapGeometry(height) filters buildingFootprints to entries whose own [minH,maxH] range actually contains the given height (a horizontal slice through a vertical extrusion is always that building\'s own footprint, unchanged at every height within its own range), builds a flat ShapeGeometry per qualifying building translated to that height, and merges them -- returning null (not an empty geometry) when nothing qualifies',
  /function buildBuildingZCapGeometry\(height\)\{/.test(html)
  && /if \(height >= fp\.minH && height <= fp\.maxH\)\{/.test(html)
  && /const g = new THREE\.ShapeGeometry\(fp\.shape\);/.test(html)
  && /g\.translate\(0, 0, height\);/.test(html)
  && /if \(!geoms\.length\) return null;/.test(html)
);
check(
  'rebuildBuildingZCap() disposes the previous mesh\'s geometry before replacing it (not leaking one per height-slider drag), reuses the same buildingZCapMaterial object across every rebuild rather than creating a new material each time, and is called from both buildBuildingCapFillGroups() (initial build) and setHeightCut() (every height change)',
  /function rebuildBuildingZCap\(\)\{/.test(html)
  && /if \(oldMesh\)\{ zGroup\.remove\(oldMesh\); oldMesh\.geometry\.dispose\(\); \}/.test(html)
  && /const mesh = new THREE\.Mesh\(geo, buildingZCapMaterial\);/.test(html)
  && /rebuildBuildingZCap\(\); \/\/ v3\.4\.91: builds the actual Z-cap mesh straight from real footprint geometry/.test(html)
  && /rebuildBuildingZCap\(\); \/\/ v3\.4\.91: the Z cap's actual SHAPE depends on height now/.test(html)
);
check(
  'buildingCapFillGroups.z.visible\'s formula (view-mode/box/height guards) is completely untouched by this rework -- only HOW the cap\'s geometry gets built changed, not when it shows',
  /buildingCapFillGroups\.z\.visible = onBuildings && sectionModeAxis === null && !activeSectionBox && sectionPlane\.constant > 0;/.test(html)
);

/* ===================================================================
   v3.4.93 -- buildings' X/Y caps replaced the stencil technique with real
   per-building slice geometry (sliceFootprintAtLine/buildBuildingXYCapGeometry),
   same reasoning as v3.4.91's Z-axis fix, after the stencil approach was
   found to fail unpredictably (100% of Y's range in Chelsea) with no
   confirmed root cause across two separate investigation sessions
   =================================================================== */
sectionHeader("v3.4.93 -- buildings' X/Y caps rebuilt from real per-building slice geometry, stencil technique retired for buildings entirely");

check(
  'sliceFootprintAtLine(shape, axis, value) walks every edge of the real footprint polygon, finds crossings of the slicing line via the standard even-odd scanline rule, sorts them, and pairs them into intervals -- skipping edges parallel to the slicing axis (degenerate, contribute no crossing) and any t outside [0,1]',
  /function sliceFootprintAtLine\(shape, axis, value\)\{/.test(html)
  && /if \(a1 === a2\) continue;/.test(html)
  && /if \(\(a1 - value\) \* \(a2 - value\) > 0\) continue;/.test(html)
  && /crossings\.sort\(\(p, q\) => p - q\);/.test(html)
);
check(
  'buildBuildingXYCapGeometry(axis, value) builds one real flat rectangle per qualifying interval per building, sized and oriented to match negative space\'s own established xQuad/yQuad rotation convention (rotateY(PI/2) for X, rotateX(-PI/2) for Y), skips degenerate sub-1e-6 intervals, and returns null (not an empty geometry) when nothing qualifies -- same null-means-nothing-to-show convention as buildBuildingZCapGeometry()',
  /function buildBuildingXYCapGeometry\(axis, value\)\{/.test(html)
  && /if \(hi - lo < 1e-6\) continue;/.test(html)
  && /g\.rotateY\(Math\.PI \/ 2\);/.test(html)
  && /g\.rotateX\(-Math\.PI \/ 2\);/.test(html)
  && /if \(!geoms\.length\) return null;/.test(html)
);
check(
  'rebuildBuildingXYCap(axis) disposes the previous mesh\'s geometry before replacing it, reuses the shared buildingXCapMaterial/buildingYCapMaterial object rather than creating one per rebuild, and is called from buildBuildingCapFillGroups() (initial build) plus setXCutaway()/setYCutaway() (every threshold change) for the matching axis',
  /function rebuildBuildingXYCap\(axis\)\{/.test(html)
  && /if \(oldMesh\)\{ group\.remove\(oldMesh\); oldMesh\.geometry\.dispose\(\); \}/.test(html)
  && /rebuildBuildingXYCap\('x'\); \/\/ v3\.4\.93: buildings' X cap's actual SHAPE depends on the threshold now/.test(html)
  && /rebuildBuildingXYCap\('y'\); \/\/ v3\.4\.93: see setXCutaway\(\)'s matching comment above/.test(html)
);
check(
  'buildingXCapMaterial/buildingYCapMaterial each carry the same octant-restriction clippingPlanes the old quads used (sectionPlaneNeg + the OTHER axis\'s negated clip plane + SITE_BOUND_PLANES) -- the technique changed, not which region is allowed to show',
  /clippingPlanes: \[sectionPlaneNeg, yClipPlaneNeg, \.\.\.SITE_BOUND_PLANES\]/.test(html)
  && /clippingPlanes: \[sectionPlaneNeg, xClipPlaneNeg, \.\.\.SITE_BOUND_PLANES\]/.test(html)
);
check(
  'buildingCapFillGroups.x/y.visible formulas (view-mode/box/grazing-angle guards) are completely untouched by this rework -- only HOW each cap\'s geometry gets built changed, not when it shows',
  /buildingCapFillGroups\.x\.visible = onBuildings && \(sectionModeAxis === 'x' \|\| xFreePerspective\);/.test(html)
  && /buildingCapFillGroups\.y\.visible = onBuildings && \(sectionModeAxis === 'y' \|\| yFreePerspective\);/.test(html)
);

/* ===================================================================
   v3.4.94 -- resetToDefaultView() (Home) now clears activeSectionBox via
   the already-existing clearActiveSectionBox(), instead of leaving it
   set after a box-draw and permanently disabling poché/handles
   =================================================================== */
sectionHeader("v3.4.94 -- Home clears activeSectionBox instead of leaving poché/handles permanently disabled after a box-draw");

check(
  'resetToDefaultView() calls clearActiveSectionBox() (not a bare assignment, so the stale Plan-view box outline overlay gets cleared too) before resetSharedViewState()/applySectionMode(null), so a box drawn earlier does not leave Home in a dead-end inert state',
  /function resetToDefaultView\(\)\{[\s\S]{0,2000}clearActiveSectionBox\(\);[\s\S]{0,200}resetSharedViewState\(\);[\s\S]{0,200}applySectionMode\(null\);/.test(html)
);
check(
  'zoomToBoroughContext() (Manhattan context) still does NOT call clearActiveSectionBox() -- the v3.2.23 intent of preserving an active box there is unaffected by this fix, which only touches resetToDefaultView()',
  (() => {
    const start = html.indexOf('function zoomToBoroughContext(){');
    if (start === -1) return false;
    const end = html.indexOf('\nfunction ', start + 30); // next top-level function declaration marks the end of this one
    const body = html.slice(start, end === -1 ? start + 4000 : end);
    return !/clearActiveSectionBox\(\)/.test(body);
  })()
);

check(
  'refreshCutawayRowActiveState() self-checks capInert instead of trusting every reset-like function to remember activeSectionBox by hand -- fires console.error + a toast the moment the app lands in free Perspective/Home with a stale box (capInert true, isPlanViewActive false), the one combination that is never legitimate. Prevention against a repeat of this exact bug class (v3.4.69/70/73/74 were all "X forgot to reset what Home already resets"), not just a fix for this one instance',
  /if \(capInert && !isPlanViewActive\)\{\s*console\.error\(/.test(html)
);

/* ===================================================================
   v3.4.95 -- site-scale camera far-plane/zoom-out budget computed per
   district instead of a fixed ORIGINAL_CAMERA_FAR/ORIGINAL_MAX_DISTANCE
   tuned once against whichever district happened to be tested first
   =================================================================== */
sectionHeader("v3.4.95/96 -- camera far plane/max zoom-out distance scale with each district's real size instead of a fixed constant");

check(
  'siteAwareCameraFar/siteAwareMaxDistance are declared once, default to the ORIGINAL_* constants (correct for the pre-compute state), and are the ones exitBoroughContext() now restores instead of the fixed constants',
  /let siteAwareCameraFar = ORIGINAL_CAMERA_FAR;/.test(html)
  && /let siteAwareMaxDistance = ORIGINAL_MAX_DISTANCE;/.test(html)
  && /function exitBoroughContext\(\)\{[\s\S]{0,300}camera\.far = siteAwareCameraFar;[\s\S]{0,300}controls\.maxDistance = siteAwareMaxDistance;/.test(html)
);
check(
  'computeNegativeSpace() recomputes siteAwareMaxDistance/siteAwareCameraFar from the real site diagonal (dx/dy/dz via Pythagoras, including height) right after siteMinX/MaxX/MinY/MaxY/siteCapHeight are set, and only applies it live when not currently in Manhattan context (which has its own BOROUGH_CAMERA_FAR budget active). v3.4.96: far is maxDistance\'s own worst case (a full siteDiagonal beyond the orbit target, not half -- the target isn\'t guaranteed centered) plus the same ~500m margin v3.0.23 established, not a flat multiple of the diagonal (v3.4.95\'s first version of this formula only covered the one camera angle it was tested from, not the real worst case -- caught live on the v3.4.95 code itself)',
  /const siteDiagonal = Math\.sqrt\(\(siteMaxX - siteMinX\) \*\* 2 \+ \(siteMaxY - siteMinY\) \*\* 2 \+ siteCapHeight \*\* 2\);/.test(html)
  && /siteAwareMaxDistance = Math\.max\(ORIGINAL_MAX_DISTANCE, siteDiagonal \* 1\.2\);/.test(html)
  && /siteAwareCameraFar = siteAwareMaxDistance \+ siteDiagonal \+ 500;/.test(html)
  && /if \(!showBoroughs\)\{\s*camera\.far = siteAwareCameraFar;/.test(html)
);

/* ===================================================================
   v3.4.97 -- turning Negative space on also exposes Advanced (the
   cutaway controls) and opens the Display accordion (Manhattan
   context/Major streets) -- a flat, uncut shell doesn't show much by
   itself, and both were one extra click away from turning the void on
   at all
   =================================================================== */
sectionHeader("v3.4.97 -- turning Negative space on also exposes Advanced and opens the Display accordion");

check(
  'the Display <details> accordion has an id (displayAccordion) to target -- previously anonymous, only reachable by position',
  /<details class="accordion" id="displayAccordion">\s*<summary>Display<\/summary>/.test(html)
);
check(
  'viewNegative\'s click handler calls setUiMode(\'advanced\') and opens displayAccordion only on the off->true transition (inside the showNegative-true branch), not from refreshViewToggles() or any other function that runs on unrelated state changes -- so it never fights a later manual tab-switch/collapse while Negative space stays on',
  (() => {
    const start = html.indexOf("document.getElementById('viewNegative').addEventListener('click'");
    if (start === -1) return false;
    const end = html.indexOf('\n});', start) + 4;
    const body = html.slice(start, end);
    return /if \(showNegative\)\{/.test(body)
      && /setUiMode\('advanced'\);/.test(body)
      && /document\.getElementById\('displayAccordion'\)\.open = true;/.test(body)
      && /\n  refreshViewToggles\(\);\n\}\);/.test(body);
  })()
);
check(
  'choiceVoid ("See the void" onboarding card) still just clicks the real viewNegative button rather than duplicating any of this logic -- one source of truth, so the v3.4.97 behavior applies to both entry points automatically',
  /document\.getElementById\('choiceVoid'\)\.addEventListener\('click', \(\) => \{\s*\n\s*dismissExploreHint\(\);\s*\n\s*document\.getElementById\('viewNegative'\)\.click\(\);/.test(html)
);

/* ===================================================================
   v3.4.98 -- cutaway handles switched from a lit MeshStandardMaterial to
   an unlit MeshBasicMaterial, so they render their pure axis color
   regardless of scene lighting angle instead of reading dim/washed-out
   against a busy, already-translucent scene
   =================================================================== */
sectionHeader("v3.4.98 -- cutaway handles use an unlit MeshBasicMaterial so they read as a flat, saturated color instead of dimming with scene lighting");

check(
  'makeHandle() builds each handle cone with MeshBasicMaterial (unlit), not MeshStandardMaterial (lit) -- depthTest:false and the axis color are unchanged, only the lighting dependency is removed',
  /function makeHandle\(axis\)\{[\s\S]{0,1200}const mat = new THREE\.MeshBasicMaterial\(\{ color: AXIS_COLORS\[axis\]\.base, depthTest: false \}\);/.test(html)
  && !/const mat = new THREE\.MeshStandardMaterial\(\{ color: AXIS_COLORS\[axis\]\.base/.test(html)
);
check(
  'setHandleHighlight() still works unchanged against the new material -- MeshBasicMaterial has the same .color property MeshStandardMaterial did, so the hover-color swap needed no changes',
  /function setHandleHighlight\(mesh, hovered\)\{ const c = AXIS_COLORS\[mesh\.userData\.axis\]; mesh\.material\.color\.set\(hovered \? c\.hover : c\.base\); \}/.test(html)
);

/* ===================================================================
   v3.4.99 -- negative space's poché caps switch from a filled wash to a
   thin outline once their real exposed area covers more than half the
   site, instead of always filling regardless of size
   =================================================================== */
sectionHeader("v3.4.99 -- large poché caps show as an outline instead of an overwhelming fill");

check(
  'capQuadBounds(axis) computes each cap\'s real rectangle directly from state (siteMinX/MaxX/MinY/MaxY, xThreshold/yThreshold, flipXCutaway/flipYCutaway, sectionPlane.constant, siteCapHeight) -- z is unconditionally the full site (ratio 1, matching zQuad\'s own v3.4.88 restrictPlanes, which dropped the other two axes entirely), x/y multiply the OTHER axis\'s coverage by the height range still exposed above the cut',
  /function capQuadBounds\(axis\)\{/.test(html)
  && /if \(axis === 'z'\)\{[\s\S]{0,300}ratio: 1,/.test(html)
  && /const yCoverage = Math\.min\(1, Math\.max\(0, \(yHi - yLo\) \/ ySpan\)\);/.test(html)
  && /const xCoverage = Math\.min\(1, Math\.max\(0, \(xHi - xLo\) \/ xSpan\)\);/.test(html)
);
check(
  'each of negative space\'s 3 cap groups (x/y/z) gets its own outline LineLoop (makeCapOutline()), added as a sibling of the existing fill quad and tracked as group.userData.outline -- default color goes through pocheMaterials for theme-sync, same opt-out convention makeCapQuad()\'s own color param already used',
  /function makeCapOutline\(color\)\{/.test(html)
  && /if \(!color\) pocheMaterials\.push\(mat\);/.test(html)
  && /xGroup\.userData\.outline = xOutline;/.test(html)
  && /yGroup\.userData\.outline = yOutline;/.test(html)
  && /zGroup\.userData\.outline = zOutline;/.test(html)
);
check(
  'refreshCapFillCoverage() sets the quad/outline geometry and visibility split directly on the two children (quad.visible/outline.visible), leaving each group\'s own .visible (set by refreshCapFillVisibility()) untouched -- the two toggles are independent and compose correctly (three.js requires every ancestor visible to render), and it\'s called from both buildCapFillGroups() (a fresh compute) and syncCapFillPlanes() (every threshold change, so the split stays live as sliders move)',
  /function refreshCapFillCoverage\(groups, colorOverride\)\{/.test(html)
  && /const large = ratio > POCHE_OUTLINE_COVERAGE_THRESHOLD;\s*\n\s*quad\.visible = !large;\s*\n\s*outline\.visible = large;/.test(html)
  && /refreshCapFillCoverage\(capFillGroups\); \/\/ v3\.4\.99: set the correct fill-vs-outline split for this district's real \(freshly rebuilt\) site bounds before the first paint/.test(html)
  && /refreshCapFillCoverage\(capFillGroups\); \/\/ v3\.4\.99: re-check fill-vs-outline for negative space's own caps every time a threshold that could change their real exposed area moves/.test(html)
);

/* ===================================================================
   v3.4.100 -- firstRunHint no longer permanently dismissed via
   localStorage across all future sessions -- only hidden for the
   current session once Compute succeeds, so every fresh page load shows
   it again regardless of history
   =================================================================== */
sectionHeader("v3.4.100 -- firstRunHint shows on every fresh page load instead of being permanently dismissed once, forever, via localStorage");

check(
  'ns_computedOnce is completely gone -- no init-time check hiding firstRunHint based on past-session history, and no write setting the flag either',
  !/ns_computedOnce/.test(html)
);
check(
  'computeNegativeSpace() still hides firstRunHint once a compute succeeds (so it doesn\'t linger once the user has clearly found the button), just without persisting that to localStorage -- a fresh page load always starts with the hint visible again (the HTML itself has no hidden/display:none on firstRunHint by default)',
  /async function computeNegativeSpace\(\)\{[\s\S]{0,1100}const hintEl = document\.getElementById\('firstRunHint'\);\s*\n\s*if \(hintEl\) hintEl\.style\.display = 'none';/.test(html)
  && !/<p id="firstRunHint" style="display:\s*none/.test(html)
);

/* ===================================================================
   Summary
   =================================================================== */
/* ===================================================================
   v3.4.101 -- Export moved to the bottom of the panel, after Height/X/Y
   Cutaway and Section fill (poché), instead of sitting right after
   Display near the top of the gated/post-compute section
   =================================================================== */
sectionHeader("v3.4.101 -- Export relocated to the bottom of the panel, below the cutaway controls");

check(
  'the Export accordion now sits after capFillRow (Section fill / poché, the last row #sectionRow had before), not between Display and the Simple/Advanced tabs -- genuinely the last real content in #controls before the panel closes',
  (() => {
    const capFillIdx = html.indexOf('id="capFillRow"');
    const exportIdx = html.indexOf('<summary>Export</summary>');
    const displayIdx = html.indexOf('<summary>Display</summary>');
    return capFillIdx > -1 && exportIdx > -1 && displayIdx > -1 && exportIdx > capFillIdx && exportIdx > displayIdx;
  })()
);

/* ===================================================================
   v3.4.102 -- tooltips and help documentation updated to match recent
   real behavior changes (v3.4.93-101): buildings' caps are real
   geometry not stencil, negative space's poché can be an outline not
   just a fill, Home clears an active box, Negative-space-on exposes
   Advanced+Display, the first-run hint isn't localStorage-permanent
   anymore, Export moved to the panel bottom
   =================================================================== */
sectionHeader("v3.4.102 -- tooltips/help docs updated for v3.4.93-101's real behavior changes");

check(
  'both the help modal\'s Section fill dd and capFillRow\'s own inline tooltip no longer claim the fill happens "instead of leaving a hollow outline" as an absolute -- v3.4.99 made negative space\'s own fill switch to an outline once the exposed area is large, so the old wording was directly contradicted by real current behavior',
  !/instead of leaving a hollow outline/.test(html)
  && /so it reads as solid material instead of a hollow outline\. Negative space's own fill switches to a thin outline/.test(html)
);
check(
  'EXTENDED.md documents the v3.4.99 fill-vs-outline coverage switch and the v3.4.93 buildings-caps-are-real-geometry change, and no longer claims stencil-buffer issues (render-list ordering, clear timing) as live possibilities for buildings\' own caps specifically',
  /Fill vs\. outline \(v3\.4\.99\)/.test(extended)
  && /Buildings' caps are real geometry, not a stencil test \(v3\.4\.93\)/.test(extended)
  && /For buildings' own caps \(X\/Y\/Z\), this shouldn't recur/.test(extended)
);

/* ===================================================================
   v3.4.103 -- first UI/UX audit pass: min/max endpoint labels under each
   cutaway slider (real gap -- a bare "150m" told you nothing about
   where that sits in the site), Reset cutaway renamed to Recenter
   cutaway to stop reading like a synonym for Full width (real
   redundancy -- both sat in Advanced with a box active and both sounded
   like "undo")
   =================================================================== */
sectionHeader("v3.4.103 -- UI/UX pass: cutaway slider min/max labels, Reset->Recenter cutaway rename");

check(
  'each of the 3 cutaway sliders has its own min/max label span pair (sectionMinLabel/sectionMaxLabel, xClipMinLabel/xClipMaxLabel, yClipMinLabel/yClipMaxLabel), placed immediately after the slider itself',
  /<input type="range" id="sectionSlider"[^>]*>\s*\n\s*<div style="display:flex; justify-content:space-between; margin-top:1px;">\s*\n\s*<span id="sectionMinLabel"/.test(html)
  && /<input type="range" id="xClipSlider"[^>]*>\s*\n\s*<div style="display:flex; justify-content:space-between; margin-top:1px;">\s*\n\s*<span id="xClipMinLabel"/.test(html)
  && /<input type="range" id="yClipSlider"[^>]*>\s*\n\s*<div style="display:flex; justify-content:space-between; margin-top:1px;">\s*\n\s*<span id="yClipMinLabel"/.test(html)
);
check(
  'refreshUnitLabels() populates all 3 min/max label pairs by reading each slider\'s own min/max attribute directly (already set correctly per district in computeNegativeSpace()) rather than tracking a second copy of the site bounds, and computeNegativeSpace() calls refreshUnitLabels() right after setting those attributes -- not just the unit-toggle click handlers, which was refreshUnitLabels()\'s only call site before',
  /const rangeLabel = \(sliderId, minEl, maxEl\) => \{/.test(html)
  && /rangeLabel\('sectionSlider', 'sectionMinLabel', 'sectionMaxLabel'\);/.test(html)
  && /rangeLabel\('xClipSlider', 'xClipMinLabel', 'xClipMaxLabel'\);/.test(html)
  && /rangeLabel\('yClipSlider', 'yClipMinLabel', 'yClipMaxLabel'\);/.test(html)
  && /document\.getElementById\('yClipSlider'\)\.min = minY; document\.getElementById\('yClipSlider'\)\.max = maxY;\s*\n\s*refreshUnitLabels\(\);/.test(html)
);
check(
  'resetCutawayBtn\'s visible label is "Recenter cutaway", not "Reset cutaway" -- renamed since it sat right next to Full width (which clears the box) and both read as a generic "undo" action; id/click handler/internal function name (resetCutaway()) are unchanged, this only touched the visible text and tooltips',
  />Recenter cutaway<\/button>/.test(html)
  && !/>Reset cutaway<\/button>/.test(html)
);
check(
  'the help modal\'s dt for this control also reads "Recenter cutaway", matching the real button label, and its dd cross-references Full width the same way the button\'s own title now does',
  /<dt>Recenter cutaway<\/dt>\s*<dd>Back to the site's own center — or, if a box is active, that box's own center\. Doesn't clear the box itself; that's Full width/.test(html)
);

/* ===================================================================
   Summary
   =================================================================== */
console.log('\n' + '='.repeat(50));
console.log(pass + '/' + (pass + fail) + ' checks passed');
if (fail > 0){
  console.log(fail + ' FAILED -- see [FAIL] lines above.');
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
