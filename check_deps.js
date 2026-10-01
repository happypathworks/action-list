#!/usr/bin/env node
'use strict';
/*
 * check_deps.js — preflight for the action-list skill.
 *
 * Run this before the first build in a new place. It answers one question
 * with an exit code: is everything this skill depends on present and working
 * here?
 *
 * Nothing is installed. docx ships inside the skill at vendor/docx.cjs. What
 * can still go wrong is a partial or damaged copy of the skill folder, and
 * that does not fail usefully: it fails halfway through a build, or worse, a
 * damaged checker passes a list it should refuse. So beyond the files, this
 * runs the checker against the two shipped examples and requires the verdict
 * each one is documented to get: the clean list passes, the naive extraction
 * with an unowned action is refused.
 *
 * Usage:
 *   node check_deps.js            # from anywhere; it reads its own folder
 *   node check_deps.js --json
 *
 * Exit codes:
 *   0  everything present, and the checker agrees with its examples
 *   1  something is missing or wrong; the report names it and the fix
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const asJson = process.argv.includes('--json');
const ROOT = __dirname;

// SETUP.md's "What's in the folder" listing is the contract; this is that
// listing, mechanically.
const BUNDLED_FILES = [
  'SKILL.md', 'SETUP.md', 'LICENSE.txt', 'package.json', 'check_deps.js',
  'action_check.js', 'build_action_list.js',
  'brand_kit.js', 'brand_check.js',
  'vendor/docx.cjs', 'vendor/THIRD_PARTY_LICENSES.txt',
];

const EX_CLEAN = 'examples/roastery-weekly';
const EX_REFUSED = 'examples/unowned-action';
const BUNDLED_FIXTURES = [
  EX_CLEAN + '/notes.txt', EX_CLEAN + '/actions.json', EX_CLEAN + '/brand.json', EX_CLEAN + '/README.md',
  EX_CLEAN + '/ROAST_OPS_Roastery_Operations_Weekly_ACTIONS_2026-04-23.docx',
  EX_REFUSED + '/notes.txt', EX_REFUSED + '/actions.json', EX_REFUSED + '/actions-resolved.json',
  EX_REFUSED + '/brand.json', EX_REFUSED + '/README.md',
];

const DOCX_VERSION = '9.7.1';
const DOCX_SHA256 = '137463682ecd9de79e660f25b17465b001fe189c0d7512a390f4c8c926b1cfb2';

const checks = [];
const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix: ok ? null : fix });
const REINSTALL = 'Re-install the skill from its archive rather than copying files out of it one by one.';

// --- 1. Node ------------------------------------------------------------------
const major = parseInt(process.versions.node.split('.')[0], 10);
add('node >= 18', major >= 18, 'found node ' + process.versions.node,
  'Install Node 18 or newer. docx 9 uses APIs older runtimes do not have.');

// --- 2. Files -----------------------------------------------------------------
const missing = BUNDLED_FILES.concat(BUNDLED_FIXTURES).filter((f) => !fs.existsSync(path.join(ROOT, f)));
add('bundled files present', missing.length === 0,
  missing.length ? 'missing: ' + missing.join(', ') : (BUNDLED_FILES.length + BUNDLED_FIXTURES.length) + ' files', REINSTALL);

// --- 3. The vendored docx library -------------------------------------------
let docx = null, docxDetail = '';
try {
  const buf = fs.readFileSync(path.join(ROOT, 'vendor', 'docx.cjs'));
  const ok = crypto.createHash('sha256').update(buf).digest('hex') === DOCX_SHA256;
  docx = require(path.join(ROOT, 'vendor', 'docx.cjs'));
  docxDetail = ok ? 'docx ' + DOCX_VERSION + '  [vendor/docx.cjs, sha256 pinned]' : 'vendor/docx.cjs loads but is not the pinned build';
  if (!ok) docx = null;
} catch (e) { docxDetail = 'not loadable (' + (e.code || e.message) + ')'; }
add('vendored docx loads', !!docx, docxDetail, 'vendor/docx.cjs is missing, damaged or replaced. ' + REINSTALL);

if (docx) {
  const need = ['Document', 'Packer', 'Paragraph', 'TextRun', 'Table', 'TableRow', 'ImageRun',
    'WidthType', 'AlignmentType', 'TableLayoutType', 'LineRuleType'];
  const gone = need.filter((k) => !(k in docx));
  add('docx exports what the builder uses', gone.length === 0, gone.length ? 'missing: ' + gone.join(', ') : need.length + ' present', REINSTALL);
}

// --- 4. The brand kit loader works ---------------------------------------------
// Pinned to the clean example's kit, so a kit in the folder this is run from
// cannot make the preflight pass or fail. The preflight checks the skill; the
// kit has its own check, brand_check.js.
if (docx) {
  process.env.HPW_BRAND_KIT = path.join(ROOT, EX_CLEAN);
  let kit = null, err = '';
  try { kit = require(path.join(ROOT, 'brand_kit.js')).load(); } catch (e) { err = e.message; }
  const need = ['palette', 'type', 'org', 'naming', 'logo', 'header'];
  const gone = kit ? need.filter((k) => kit[k] === undefined) : need;
  add('brand_kit.js resolves a kit', !!kit && gone.length === 0,
    !kit ? 'failed to load: ' + err
         : gone.length ? 'kit has no ' + gone.join(', ')
                       : 'resolved ' + kit._source + ', palette ACCENT ' + kit.palette.ACCENT, REINSTALL);
}

// --- 5. The scripts answer, and the checker agrees with its examples ----------
function run(script, args, cwd) {
  const env = Object.assign({}, process.env);
  delete env.HPW_BRAND_KIT;
  return spawnSync(process.execPath, [path.join(ROOT, script)].concat(args), { cwd: cwd || ROOT, encoding: 'utf8', env });
}

for (const script of ['action_check.js', 'build_action_list.js']) {
  const r = run(script, []);
  add(script + ' runs', r.status === 2, r.status === 2 ? 'usage check returns exit 2 as designed' : 'unexpected exit ' + r.status,
    'A script the skill depends on does not run. ' + REINSTALL);
}

const expectations = [
  { dir: EX_CLEAN, file: 'actions.json', exit: 0, ids: [] },
  { dir: EX_CLEAN, file: 'ROAST_OPS_Roastery_Operations_Weekly_ACTIONS_2026-04-23.docx', exit: 0, ids: [] },
  { dir: EX_REFUSED, file: 'actions.json', exit: 1, ids: ['owner.unsourced', 'owner.missing'] },
  { dir: EX_REFUSED, file: 'actions-resolved.json', exit: 0, ids: [] },
];
for (const x of expectations) {
  const r = run('action_check.js', [x.file, '--kit', '.', '--json'], path.join(ROOT, x.dir));
  let got = null;
  try { got = JSON.parse(r.stdout); } catch (_) { /* reported below */ }
  const ids = got ? got.violations.map((v) => v.id).sort() : [];
  const ok = r.status === x.exit && JSON.stringify(ids) === JSON.stringify(x.ids.slice().sort());
  add('checker verdict: ' + x.dir.split('/')[1] + '/' + x.file.replace(/^ROAST_.*docx$/, 'built .docx'), ok,
    'exit ' + r.status + (ids.length ? ' [' + ids.join(', ') + ']' : '') + ', expected ' + x.exit + (x.ids.length ? ' [' + x.ids.slice().sort().join(', ') + ']' : ''),
    'The checker does not return the verdict its example is documented to get, so its verdicts cannot be trusted here. ' + REINSTALL);
}

// --- report -------------------------------------------------------------------
const failed = checks.filter((c) => !c.ok);
if (asJson) {
  console.log(JSON.stringify({ root: ROOT, node: process.versions.node, checks, ok: failed.length === 0 }, null, 2));
} else {
  console.log('check_deps — action-list');
  console.log('  skill folder: ' + ROOT);
  console.log('');
  for (const c of checks) console.log('  ' + (c.ok ? 'OK  ' : 'FAIL') + '  ' + c.name.padEnd(56) + c.detail);
  console.log('');
  if (failed.length) {
    console.log('  Fix:');
    for (const c of failed) console.log('    - ' + c.name + ': ' + c.fix);
    console.log('');
    console.log('FAIL — ' + failed.length + (failed.length === 1 ? ' check failed' : ' checks failed'));
  } else {
    console.log('PASS — everything present, and the checker agrees with both examples. Safe to build.');
  }
}
process.exit(failed.length ? 1 : 0);
