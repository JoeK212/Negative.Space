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

let html, changelog;
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
   =================================================================== */
sectionHeader('v3.1.2 -- nav panel does not overlap the footer credit line');

const navBottomMatch = html.match(/#navPanel\{[\s\S]*?bottom:calc\((\d+)px/);
const footBottomMatch = html.match(/#footVersion\{[\s\S]*?bottom:calc\((\d+)px/);
check('#navPanel bottom offset found', !!navBottomMatch);
check('#footVersion bottom offset found', !!footBottomMatch);
if (navBottomMatch && footBottomMatch){
  const gap = parseInt(navBottomMatch[1], 10) - parseInt(footBottomMatch[1], 10);
  check(
    '#navPanel sits at least 24px above #footVersion\'s own offset',
    gap >= 24,
    'Gap is only ' + gap + 'px -- the nav panel card (with real height/padding) can visually overlap the footer text again below that.'
  );
}

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
