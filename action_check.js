#!/usr/bin/env node
'use strict';
/*
 * action_check.js — the gate for action-list.
 *
 * An action list fails in ways the page does not show. An owner the notes
 * never named reads exactly like one they did. A paraphrased action cannot be
 * traced back to what was said. A table one row too long prints a second page
 * holding nothing but the overflow. None of these raises an error when the
 * document is built.
 *
 * This file gives each of them an exit code:
 *
 *   1. owner     every action names an owner, and that owner appears in the
 *                quoted source span, or is marked as assigned after the
 *                meeting by the person who asked for the list
 *   2. source    every action quotes the notes, and the quote is found in the
 *                notes; the line number is computed here, never supplied
 *   3. one page  the layout's height is bounded from measured font metrics
 *                and must fit one US Letter page
 *   4. brand     the brand.json the build will read passes brand_check.js
 *
 * Two inputs:
 *   node action_check.js actions.json   before a build: all four checks
 *   node action_check.js list.docx      after a build: page geometry, line
 *                                       pitch, owner and source cells, and
 *                                       the page bound re-measured from the
 *                                       file itself
 *
 * Options:
 *   --kit PATH   the brand.json, or the folder holding one, that the build
 *                will read; the same as setting HPW_BRAND_KIT
 *   --json       machine-readable report
 *
 * Exit codes:
 *   0  clean (warnings may be present)
 *   1  one or more violations: no document is written or delivered
 *   2  usage error, or an input that could not be read
 *
 * Node built-ins only. build_action_list.js takes its layout from this file,
 * so the page that is measured is the page that is built.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const SCHEMA_ID = 'hpw-action-list/1';

// ---------------------------------------------------------------------------
// Layout — declared once. The builder renders exactly this; the bound below
// measures exactly this. All lengths are twips (1/1440 in), sizes half-points.
//
// Every paragraph is set at an EXACT line pitch, so line height does not
// depend on the typeface. Each pitch clears the tallest face measured: Segoe
// UI's ascent plus descent is 1.33 em, so 9pt text needs 11.97pt and gets 12.
// ---------------------------------------------------------------------------
const LAYOUT = Object.freeze({
  PAGE_W: 12240, PAGE_H: 15840, MARGIN: 720,
  CONTENT_W: 10800, CONTENT_H: 14400,
  SAFETY: 240,   // one body line held back from the page
  BUDGET: 14160, // CONTENT_H - SAFETY
  BAND: Object.freeze({ SIDE_W: 2800, LOGO_W: 1400, LOGO_BOX_H: 720, PAD_V: 120, PAD_H: 160, IMG_ALLOW: 80 }),
  COLS: Object.freeze([
    Object.freeze({ key: 'num', w: 440, label: '#' }),
    Object.freeze({ key: 'owner', w: 1500, label: 'Owner' }),
    Object.freeze({ key: 'action', w: 3860, label: 'Action' }),
    Object.freeze({ key: 'due', w: 1500, label: 'Due' }),
    Object.freeze({ key: 'source', w: 3500, label: 'Source in the notes' }),
  ]),
  CELL: Object.freeze({ PAD_V: 60, PAD_H: 100 }),
  HEAD: Object.freeze({ PAD_V: 80 }),
  BORDER: 10, // a 0.5pt rule, counted once per row
  COUNT_LINE: Object.freeze({ BEFORE: 160, AFTER: 120 }),
  FOOT: Object.freeze({ BEFORE: 120, AFTER: 0 }),
  SIZE: Object.freeze({ TITLE: 28, SUBTITLE: 20, BAND: 18, BODY: 18, LABEL: 17, SMALL: 16 }),
  PITCH: Object.freeze({ 28: 380, 20: 280, 18: 240, 17: 240, 16: 240 }),
});

// ---------------------------------------------------------------------------
// Glyph widths — advance widths for printable ASCII (space through tilde), in
// thousandths of an em, read from the font files' hmtx tables. Each table is
// the per-character MAXIMUM across a set of faces, so a line that fits under
// the table fits in every face it covers. Characters outside ASCII take the
// widest value in the table.
//
//   STANDARD  Arial, Liberation Sans, Calibri, Carlito, Georgia, Times New
//             Roman, Segoe UI, Tahoma, Trebuchet MS, Garamond, Candara,
//             Corbel, Constantia, regular and italic
//   WIDE      STANDARD plus Verdana, DejaVu Sans, Century and Bookman Old
//             Style: used for any typeface not in STANDARD
//   BOLD      Arial, Calibri, Georgia, Segoe UI and Verdana, bold
//
// Against Arial alone the STANDARD table runs about 10% wide on lowercase
// text. That margin is the cost of a bound that holds for the whole set.
// ---------------------------------------------------------------------------
const W_STANDARD = '312,367,452,728,610,977,906,254,383,383,546,728,367,400,367,524,614,556,559,556,565,556,566,556,596,566,384,384,728,728,728,556,1015,760,667,722,771,688,611,778,815,390,518,740,635,927,781,804,667,804,722,667,619,756,802,1020,740,722,656,389,500,389,728,643,546,573,588,500,589,556,401,589,582,307,367,536,320,881,591,586,588,589,461,500,420,575,538,822,505,560,500,480,524,480,728';
const W_WIDE = '352,401,460,838,636,1076,906,275,454,454,636,838,367,454,367,600,636,636,636,636,636,636,636,636,636,636,454,454,838,838,838,556,1015,760,740,740,800,722,667,800,833,421,600,778,667,944,815,804,667,804,722,684,667,815,802,1020,740,722,685,454,606,454,838,643,636,613,635,550,635,615,401,635,660,315,367,620,320,974,660,612,635,635,461,521,420,680,592,822,592,592,525,636,606,636,838';
const W_BOLD = '342,402,587,867,711,1272,862,332,543,543,711,867,361,480,361,689,711,711,711,711,711,711,711,711,711,711,402,402,867,867,867,617,975,776,762,724,834,721,671,811,913,546,595,817,686,1023,847,850,733,850,797,710,684,833,764,1128,809,737,692,543,689,543,867,711,711,668,699,588,699,664,422,699,712,354,403,671,344,1058,712,687,699,699,520,593,456,712,650,979,669,651,597,711,543,711,867';

function widthTable(csv, name) {
  const w = csv.split(',').map(Number);
  if (w.length !== 95 || w.some((n) => !(n > 0))) throw new Error('action_check: width table ' + name + ' is damaged');
  w.MAX = Math.max.apply(null, w);
  w.NAME = name;
  return w;
}
const TABLES = {
  STANDARD: widthTable(W_STANDARD, 'standard'),
  WIDE: widthTable(W_WIDE, 'wide'),
  BOLD: widthTable(W_BOLD, 'bold'),
};
const STANDARD_FACES = ['arial', 'liberation sans', 'calibri', 'carlito', 'georgia', 'times new roman',
  'segoe ui', 'tahoma', 'trebuchet ms', 'garamond', 'candara', 'corbel', 'constantia'];

function faceTable(font) {
  const f = String(font || '').trim().toLowerCase();
  return STANDARD_FACES.includes(f) ? TABLES.STANDARD : TABLES.WIDE;
}

// ---------------------------------------------------------------------------
// Reading files: zip entries (for .docx) and notes
// ---------------------------------------------------------------------------

function zipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nlen) === name) {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('unsupported zip compression method ' + method);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

function xmlText(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** Plain text of one w:p element, runs in order. */
function paraText(pXml) {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t\s*\/>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(pXml))) {
    if (m[1] !== undefined) out += xmlText(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:br')) out += ' ';
  }
  return out;
}

const PARA_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;

/**
 * Read the notes. Text files are read as they are; a .docx gives one line per
 * paragraph, so "line" means paragraph for a Word file.
 * @returns {{text:string, kind:'text'|'docx', unit:'line'|'paragraph', name:string}}
 */
function readNotes(file) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file);
  if (ext === '.docx') {
    const xml = zipEntry(fs.readFileSync(file), 'word/document.xml');
    if (!xml) throw new Error(name + ' has no word/document.xml');
    const paras = xml.toString('utf8').match(PARA_RE) || [];
    return { text: paras.map(paraText).join('\n'), kind: 'docx', unit: 'paragraph', name };
  }
  if (ext === '.txt' || ext === '.md' || ext === '.text' || ext === '') {
    return { text: fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), kind: 'text', unit: 'line', name };
  }
  const err = new Error('notes must be a .txt, .md or .docx file, not ' + ext +
    '. Save pasted or extracted text as notes.txt, byte for byte, and point "notes" at it.');
  err.code = 'NOTES_TYPE';
  throw err;
}

// ---------------------------------------------------------------------------
// Quote matching. Both sides are folded the same way: case, runs of
// whitespace (line breaks included), typographic quotes and dashes, and
// non-breaking spaces. Nothing else is forgiven. A paraphrase does not match.
// ---------------------------------------------------------------------------
const FOLD = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...',
};

function fold(s) {
  const out = [];
  const map = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (!space) { out.push(' '); map.push(i); space = true; }
      continue;
    }
    const r = FOLD[c] !== undefined ? FOLD[c] : c.toLowerCase();
    for (const ch of r) { out.push(ch); map.push(i); }
    space = false;
  }
  if (out.length && out[out.length - 1] === ' ') { out.pop(); map.pop(); }
  return { text: out.join(''), map };
}

function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Find a quote in the notes.
 * @returns {null | {start:number, end:number, lineFrom:number, lineTo:number, span:string, count:number}}
 *   span is the notes' own text for the match, whitespace collapsed: the
 *   document prints what the notes say, not what the extraction retyped.
 */
function findQuote(notesText, foldedNotes, quote) {
  const q = fold(quote).text;
  if (!q) return null;
  const at = foldedNotes.text.indexOf(q);
  if (at < 0) return null;
  let count = 0;
  for (let k = at; k >= 0; k = foldedNotes.text.indexOf(q, k + 1)) count++;
  const start = foldedNotes.map[at];
  const end = foldedNotes.map[at + q.length - 1] + 1;
  return {
    start, end,
    lineFrom: lineAt(notesText, start),
    lineTo: lineAt(notesText, end - 1),
    span: notesText.slice(start, end).replace(/\s+/g, ' ').trim(),
    count,
  };
}

function containsWord(haystackFolded, needle) {
  const n = fold(needle).text;
  if (!n) return false;
  const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  for (let k = haystackFolded.indexOf(n); k >= 0; k = haystackFolded.indexOf(n, k + 1)) {
    if (!isWordChar(haystackFolded[k - 1]) && !isWordChar(haystackFolded[k + n.length])) return true;
  }
  return false;
}

// An owner field holding one of these names nobody. "we" is the notes' own
// voice ("We agreed to ..."): quoted with its line, it passes owner.unsourced.
const NON_OWNER = /^(tbd|tba|tbc|n\/?a|none|nobody|no one|unassigned|unknown|someone|somebody|anyone|owner|we|\?+|-+|_+)$/i;

function ownerParts(owner) {
  return String(owner).split(/\s*(?:,|&|\/|;|\band\b|\+)\s*/i).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The page bound
// ---------------------------------------------------------------------------

/** Twips for one character at a size in half-points. */
function charTw(ch, table, sz) {
  const c = ch.charCodeAt(0);
  const em = (c >= 32 && c <= 126) ? table[c - 32] : table.MAX;
  return (em * sz) / 100; // em/1000 * sz/2 pt * 20 twips/pt
}

/**
 * Lines a paragraph occupies in a given width. Greedy word wrap at spaces;
 * a word wider than the line breaks by character. Word also breaks after a
 * hyphen, which this does not, so the count can only run high.
 * @param {{t:string, b?:boolean, sz:number}[]} runs
 */
function paraLines(runs, avail, face) {
  let lines = 1, cur = 0, word = 0, gap = 0;
  const place = () => {
    if (word === 0) return;
    const fitsHere = cur === 0 ? word <= avail : cur + gap + word <= avail;
    if (fitsHere) cur = cur === 0 ? word : cur + gap + word;
    else {
      if (cur > 0) lines++;
      if (word > avail) { lines += Math.ceil(word / avail) - 1; cur = word - avail * (Math.ceil(word / avail) - 1); }
      else cur = word;
    }
    word = 0; gap = 0;
  };
  for (const r of runs) {
    const table = r.b ? TABLES.BOLD : face;
    for (const ch of String(r.t).replace(/\s/g, ' ')) {
      if (ch === ' ') { place(); if (cur > 0) gap += charTw(' ', table, r.sz); }
      else word += charTw(ch, table, r.sz);
    }
  }
  place();
  return lines;
}

/** Height of a stack of paragraphs in a cell of text width `avail`. */
function stackHeight(paras, avail, face) {
  let h = 0;
  for (const p of paras) {
    if (p.imageH) { h += p.imageH + LAYOUT.BAND.IMG_ALLOW; continue; }
    h += paraLines(p.runs, avail, face) * p.pitch + (p.before || 0) + (p.after || 0);
  }
  return h;
}

const para = (runs, extra = {}) => {
  const sz = Math.max.apply(null, runs.map((r) => r.sz));
  return Object.assign({ runs, pitch: LAYOUT.PITCH[sz] }, extra);
};

// ---------------------------------------------------------------------------
// The layout: one description, rendered by the builder, measured here
// ---------------------------------------------------------------------------

function pngPixels(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('logo is not a PNG: ' + file);
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Fit the logo inside its box, never enlarging it past 96 dpi. Twips. */
function logoBox(brand) {
  const L = brand.logo || {};
  if (L.absent || !L.resolvedPath || (brand.header && brand.header.style === 'title-only')) return null;
  const px = pngPixels(L.resolvedPath);
  const cellW = L.headerCellDxa || LAYOUT.BAND.LOGO_W;
  const maxW = cellW - 2 * LAYOUT.BAND.PAD_H;
  const maxH = LAYOUT.BAND.LOGO_BOX_H;
  const natW = px.w * 15, natH = px.h * 15; // 96 dpi: 15 twips a pixel
  const s = Math.min(1, maxW / natW, maxH / natH);
  // Whole pixels, because that is what the image is written at.
  const pxW = Math.max(1, Math.floor((natW * s) / 15)), pxH = Math.max(1, Math.floor((natH * s) / 15));
  return { cellW, pxW, pxH, w: pxW * 15, h: pxH * 15, file: L.resolvedPath };
}

function sourceLabel(q) {
  return 'L' + q.lineFrom + (q.lineTo !== q.lineFrom ? '-' + q.lineTo : '');
}

/**
 * @param {object} model    parsed actions.json
 * @param {object} brand    the resolved kit (brand_kit.js load())
 * @param {object[]} quotes findQuote() result per action
 * @param {object} notes    readNotes() result
 */
function buildLayout(model, brand, quotes, notes) {
  const S = LAYOUT.SIZE;
  const face = faceTable(brand.type && brand.type.FONT);
  const logo = logoBox(brand);
  const side = LAYOUT.BAND.SIDE_W;
  const bandCols = logo ? [logo.cellW, LAYOUT.CONTENT_W - logo.cellW - side, side] : [LAYOUT.CONTENT_W - side, side];
  const org = (brand.org && (brand.org.shortName || brand.org.name)) || '';
  const date = String(model.date || '').trim();

  const titleCell = [para([{ t: 'Action list', b: true, sz: S.TITLE }]), para([{ t: String(model.meeting).trim(), sz: S.SUBTITLE }])];
  const sideCell = [para([{ t: org, b: true, sz: S.BAND }])];
  if (date) sideCell.push(para([{ t: date, sz: S.BAND }]));
  const bandCells = logo ? [[{ imageH: logo.h, imageW: logo.w }], titleCell, sideCell] : [titleCell, sideCell];

  const n = model.actions.length;
  const meta = para([{ t: n + ' action' + (n === 1 ? '' : 's') + ' from ' + notes.name + (date ? ', meeting of ' + date : ''), sz: S.SMALL }],
    { before: LAYOUT.COUNT_LINE.BEFORE, after: LAYOUT.COUNT_LINE.AFTER });

  const head = LAYOUT.COLS.map((c) => [para([{ t: c.label, b: true, sz: S.LABEL }])]);
  const rows = model.actions.map((a, i) => {
    const q = quotes[i];
    const due = String(a.due || '').trim();
    return [
      [para([{ t: String(i + 1), sz: S.BODY }])],
      [para([{ t: String(a.owner || '').trim() + (a.ownerAssigned ? ' *' : ''), sz: S.BODY }])],
      [para([{ t: String(a.action || '').trim(), sz: S.BODY }])],
      [para([due ? { t: due, sz: S.BODY } : { t: 'Not stated', i: true, sz: S.BODY, role: 'muted' }])],
      [para([{ t: q ? sourceLabel(q) + '  ' : '', sz: S.BODY, role: 'muted' }, { t: '"' + (q ? q.span : '') + '"', i: true, sz: S.BODY, role: 'muted' }])],
    ];
  });

  const anyAssigned = model.actions.some((a) => a.ownerAssigned);
  const foot = para([{
    t: 'Each source is quoted from ' + notes.name + '; L gives the ' + notes.unit + ' it starts on.' +
      (anyAssigned ? ' * Owner assigned after the meeting: the notes name no owner for that action.' : ''),
    sz: S.SMALL, role: 'muted',
  }], { before: LAYOUT.FOOT.BEFORE, after: LAYOUT.FOOT.AFTER });

  return { face: face.NAME, font: (brand.type && brand.type.FONT) || '', logo, band: { cols: bandCols, cells: bandCells }, meta, head, rows, foot };
}

/** Height of the laid-out page, in twips. Pure: same input, same number. */
function estimate(layout) {
  const face = TABLES[layout.face.toUpperCase()];
  const B = LAYOUT.BAND, C = LAYOUT.CELL;
  const bandH = Math.max.apply(null, layout.band.cells.map((paras, k) =>
    stackHeight(paras, layout.band.cols[k] - 2 * B.PAD_H, face))) + 2 * B.PAD_V;
  const metaH = stackHeight([layout.meta], LAYOUT.CONTENT_W, face);
  const rowH = (cells, padV) => Math.max.apply(null, cells.map((paras, k) =>
    stackHeight(paras, LAYOUT.COLS[k].w - 2 * C.PAD_H, face))) + 2 * padV + LAYOUT.BORDER;
  const headH = rowH(layout.head, LAYOUT.HEAD.PAD_V);
  const rowHs = layout.rows.map((cells) => rowH(cells, C.PAD_V));
  const footH = stackHeight([layout.foot], LAYOUT.CONTENT_W, face);
  const total = bandH + metaH + headH + rowHs.reduce((a, b) => a + b, 0) + footH;
  return { total, budget: LAYOUT.BUDGET, bandH, metaH, headH, rowHs, footH, face: layout.face };
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

function loadBrand() {
  // Required late: HPW_BRAND_KIT may have been set from --kit.
  return require(path.join(__dirname, 'brand_kit.js')).load();
}

function runBrandCheck(configPath) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'brand_check.js'), configPath], { encoding: 'utf8' });
  const fails = String(r.stdout || '').split(/\r?\n/).filter((l) => /^\s*FAIL\b/.test(l)).map((l) => l.trim());
  return { status: r.status, fails, stderr: String(r.stderr || '').trim() };
}

// ---------------------------------------------------------------------------
// Check 1: the model, before a build
// ---------------------------------------------------------------------------

function newResult(file, mode) {
  return { file: path.basename(file), mode, violations: [], warnings: [], notes: [], estimate: null, brand: null, exitCode: 0 };
}
const V = (res, id, msg, extra) => res.violations.push(Object.assign({ id, msg }, extra || {}));
const WARN = (res, id, msg, extra) => res.warnings.push(Object.assign({ id, msg }, extra || {}));

function usage(res, msg) {
  res.exitCode = 2;
  res.fatal = msg;
  return res;
}

function checkModel(file) {
  const res = newResult(file, 'actions');
  let model;
  try { model = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return usage(res, 'could not read or parse ' + file + ': ' + e.message); }
  res.model = model;

  if (!model || model.schema !== SCHEMA_ID) {
    V(res, 'schema.id', 'schema is ' + JSON.stringify(model && model.schema) + ', expected "' + SCHEMA_ID + '"');
  }
  if (!model || typeof model.meeting !== 'string' || !model.meeting.trim()) {
    V(res, 'meeting.missing', 'no meeting name: set "meeting" to the name the notes use for the meeting');
  }
  if (!model || typeof model.notes !== 'string' || !model.notes.trim()) {
    return usage(res, '"notes" is not set: it must name the notes file, relative to ' + path.basename(file));
  }
  const notesPath = path.resolve(path.dirname(file), model.notes);
  let notes;
  try { notes = readNotes(notesPath); }
  catch (e) { return usage(res, 'could not read the notes (' + model.notes + '): ' + e.message); }
  res.notesFile = notes.name;
  const folded = fold(notes.text);

  const actions = Array.isArray(model.actions) ? model.actions : null;
  if (!actions || actions.length === 0) {
    V(res, 'actions.none', 'no actions: if the notes record no commitments, say so and build nothing');
    model.actions = [];
  }
  if (model.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(model.date).trim())) {
    WARN(res, 'date.format', 'date "' + model.date + '" is printed as given but left out of the file name, which takes YYYY-MM-DD only');
  }

  const quotes = [];
  const seen = new Map();
  (actions || []).forEach((a, i) => {
    const n = i + 1;
    a = a || {};
    const src = String(a.source || '').trim();
    const q = src ? findQuote(notes.text, folded, src) : null;
    quotes.push(q);
    const where = q ? ' (notes ' + notes.unit + ' ' + q.lineFrom + ')' : '';
    const tag = { action: n, line: q ? q.lineFrom : null };

    // --- hard-fail 2: every action quotes the notes -------------------------
    if (!src) V(res, 'source.missing', 'action ' + n + ': no source quote. Quote the span of the notes this action was taken from.', tag);
    else if (fold(src).text.split(' ').length < 3) V(res, 'source.short', 'action ' + n + ': source "' + src + '" is under three words, too short to locate an action by', tag);
    else if (!q) V(res, 'source.notfound', 'action ' + n + ': source is not in ' + notes.name + '. Quote the notes exactly; a paraphrase does not match. Quoted: "' + src.slice(0, 120) + '"', tag);
    else if (q.count > 1) WARN(res, 'source.ambiguous', 'action ' + n + ': the quote occurs ' + q.count + ' times in the notes; the first, ' + notes.unit + ' ' + q.lineFrom + ', is cited', tag);

    // --- hard-fail 1: every action names an owner the notes name -----------
    const owner = String(a.owner || '').trim();
    if (!owner || NON_OWNER.test(owner)) {
      V(res, 'owner.missing', 'action ' + n + where + ': no owner' + (owner ? ' ("' + owner + '" names nobody)' : '') +
        '. Ask who owns it; do not pick one.', tag);
    } else if (!a.ownerAssigned && q) {
      const missing = ownerParts(owner).filter((part) => !containsWord(fold(q.span).text, part));
      if (missing.length) {
        V(res, 'owner.unsourced', 'action ' + n + where + ': owner "' + missing.join('", "') + '" is not named in the quoted source. ' +
          'If the notes name the owner nearby, widen the quote to include the name. If they do not, ask who owns it; set "ownerAssigned": true only on that answer.', tag);
      }
    }

    if (!String(a.action || '').trim()) V(res, 'action.missing', 'action ' + n + where + ': the action text is empty', tag);

    const due = String(a.due || '').trim();
    if (due && q && !fold(q.span).text.includes(fold(due).text)) {
      WARN(res, 'due.unquoted', 'action ' + n + where + ': due "' + due + '" is not in the quoted source; confirm the notes state it', tag);
    }
    if (q) {
      const key = q.start + ':' + q.end;
      if (seen.has(key)) WARN(res, 'source.shared', 'action ' + n + ' quotes the same span as action ' + seen.get(key) + '; fine if one line holds two commitments', tag);
      else seen.set(key, n);
    }
  });

  // --- hard-fail 4: the kit the build will read passes brand_check.js --------
  let brand;
  try { brand = loadBrand(); }
  catch (e) {
    V(res, 'brand.load', 'the brand kit could not be loaded: ' + e.message.split('\n')[0]);
  }
  if (brand) {
    res.brand = { source: brand._source, configPath: brand._configPath, font: brand.type && brand.type.FONT };
    if (brand._source === 'config') {
      const bc = runBrandCheck(brand._configPath);
      res.brand.checkExit = bc.status;
      if (bc.status !== 0) {
        V(res, 'brand.check', 'brand_check.js exited ' + bc.status + ' on ' + brand._configPath +
          (bc.fails.length ? ':\n        ' + bc.fails.join('\n        ') : (bc.stderr ? ': ' + bc.stderr.split('\n')[0] : '')) +
          '\n        No document is written against a kit that fails. Fix the kit with the brand-kit skill, or move it aside to build on neutral defaults.');
      }
    } else {
      res.notes.push('no brand.json found: the list builds with the neutral defaults. That is a supported state; say so when delivering.');
    }
  }

  // --- hard-fail 3: one page ----------------------------------------------
  if (brand && model.actions.length) {
    try {
      const layout = buildLayout(model, brand, quotes, notes);
      const est = estimate(layout);
      res.estimate = est;
      res.layout = layout;
      if (est.face === 'wide') {
        res.notes.push('typeface "' + layout.font + '" is not in the measured standard set; the page bound uses the wide table');
      }
      if (est.total > est.budget) {
        const over = est.total - est.budget;
        V(res, 'page.overflow', 'estimated height ' + est.total + ' twips against a one-page budget of ' + est.budget +
          ' (' + Math.round((100 * est.total) / est.budget) + '%), ' + over + ' over. Shorten each source to the shortest span that names ' +
          'the owner and the commitment, and each action to one line. If it still does not fit, the meeting produced more than one page ' +
          'of actions: offer one list per owner. Never let it run to a second page.');
      }
    } catch (e) {
      V(res, 'page.unmeasured', 'the page could not be measured: ' + e.message);
    }
  }

  res.quotes = quotes;
  res.notesData = notes;
  res.brandKit = brand;
  if (res.violations.length) res.exitCode = 1;
  return res;
}

// ---------------------------------------------------------------------------
// Check 2: the built document
// ---------------------------------------------------------------------------

function attr(xml, tag, name) {
  const m = new RegExp('<' + tag + '\\b[^>]*\\s' + name + '="([^"]*)"').exec(xml);
  return m ? m[1] : null;
}

function runsOf(pXml) {
  const runs = [];
  const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m;
  while ((m = re.exec(pXml))) {
    const body = m[1];
    const rPr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body) || [])[1] || '';
    const bm = /<w:b(?:\s+w:val="([^"]*)")?\s*\/>/.exec(rPr);
    const b = !!bm && !/^(false|0|off)$/i.test(bm[1] || 'true');
    const sz = parseInt((/<w:sz\s+w:val="(\d+)"/.exec(rPr) || [])[1] || '0', 10);
    const t = paraText('<w:p>' + body + '</w:p>');
    if (t) runs.push({ t, b, sz, unsized: !sz });
  }
  return runs;
}

function parasOf(cellXml) {
  return (cellXml.match(PARA_RE) || []).map((p) => {
    const ext = /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/.exec(p);
    if (ext) return { imageH: Math.round(parseInt(ext[2], 10) / 635), imageW: Math.round(parseInt(ext[1], 10) / 635), xml: p };
    const sp = /<w:spacing\b[^>]*\/>/.exec(p);
    const s = sp ? sp[0] : '';
    const num = (k) => { const m = new RegExp('w:' + k + '="(\\d+)"').exec(s); return m ? parseInt(m[1], 10) : 0; };
    return {
      runs: runsOf(p), pitch: num('line'), before: num('before'), after: num('after'),
      exact: /w:lineRule="exact"/.test(s), text: paraText(p), xml: p,
    };
  });
}

function tablesOf(xml) {
  return xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
}

function rowsOf(tblXml) {
  return (tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(parasOf));
}

function gridOf(tblXml) {
  return (tblXml.match(/<w:gridCol\s+w:w="(\d+)"/g) || []).map((g) => parseInt(/(\d+)/.exec(g)[1], 10));
}

function checkDocxBuffer(buf, name) {
  const res = newResult(name, 'docx');
  let xml;
  try {
    const x = zipEntry(buf, 'word/document.xml');
    if (!x) return usage(res, name + ' has no word/document.xml');
    xml = x.toString('utf8');
  } catch (e) { return usage(res, 'could not read ' + name + ': ' + e.message); }

  // --- geometry ------------------------------------------------------------
  const w = parseInt(attr(xml, 'w:pgSz', 'w:w') || '0', 10), h = parseInt(attr(xml, 'w:pgSz', 'w:h') || '0', 10);
  if (w !== LAYOUT.PAGE_W || h !== LAYOUT.PAGE_H) V(res, 'geom.page', 'page is ' + w + 'x' + h + ' twips, expected US Letter portrait ' + LAYOUT.PAGE_W + 'x' + LAYOUT.PAGE_H);
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const v = parseInt(attr(xml, 'w:pgMar', 'w:' + side) || '-1', 10);
    if (v !== LAYOUT.MARGIN) V(res, 'geom.margin', side + ' margin is ' + v + ', expected ' + LAYOUT.MARGIN);
  }
  if ((xml.match(/<w:sectPr\b/g) || []).length !== 1) V(res, 'geom.sections', 'expected exactly one section');
  if (/<w:br\b[^>]*w:type="page"/.test(xml) || /<w:pageBreakBefore\b(?![^>]*w:val="(false|0)")/.test(xml)) {
    V(res, 'page.break', 'the document contains a page break: an action list is one page');
  }

  const tbls = tablesOf(xml);
  if (tbls.length !== 2) {
    V(res, 'layout.tables', 'expected 2 tables (the band and the actions), found ' + tbls.length);
    res.exitCode = 1;
    return res;
  }
  const [bandX, actX] = tbls;

  // --- the actions table ------------------------------------------------------
  const grid = gridOf(actX);
  const want = LAYOUT.COLS.map((c) => c.w);
  if (grid.join(',') !== want.join(',')) V(res, 'layout.grid', 'actions table grid is [' + grid.join(', ') + '], expected [' + want.join(', ') + ']');
  if (!/<w:tblLayout\s+w:type="fixed"/.test(actX)) V(res, 'layout.fixed', 'actions table is not fixed-layout, so Word may resize its columns');
  const rows = rowsOf(actX);
  if (rows.length < 2) V(res, 'actions.none', 'the actions table has no action rows');
  // Every text paragraph, in both tables and outside them. The bound measures
  // lines at their pitch; a paragraph Word is free to size is not measured.
  const loose = parasOf(xml).filter((p) => !p.imageH && !(p.exact && p.pitch > 0)).length;
  if (loose) V(res, 'layout.pitch', loose + ' text paragraph(s) are not at an exact line pitch; the page bound assumes every one is');
  const unsized = (xml.match(PARA_RE) || []).reduce((n, p) => n + runsOf(p).filter((r) => r.unsized).length, 0);
  if (unsized) V(res, 'layout.size', unsized + ' text run(s) carry no explicit size, so their width cannot be bounded');

  rows.slice(1).forEach((cells, i) => {
    const n = i + 1;
    if (cells.length !== LAYOUT.COLS.length) { V(res, 'layout.cells', 'row ' + n + ' has ' + cells.length + ' cells, expected ' + LAYOUT.COLS.length); return; }
    const text = (k) => cells[k].map((p) => p.text || '').join(' ').trim();
    if (!text(1)) V(res, 'owner.missing', 'row ' + n + ': the owner cell is empty', { action: n });
    if (!/^L\d+(?:-\d+)?\s+"[^"]*\S[^"]*"$/.test(text(4))) V(res, 'source.missing', 'row ' + n + ': the source cell does not carry a line number and a quote', { action: n });
  });

  // --- the page bound, re-measured from the file -------------------------------
  const fontM = /<w:rFonts\s+w:ascii="([^"]+)"/.exec(xml);
  const face = faceTable(fontM ? fontM[1] : '');
  const bandRow = rowsOf(bandX)[0] || [];
  const bandCols = gridOf(bandX);
  const layout = {
    face: face.NAME, font: fontM ? fontM[1] : '',
    band: { cols: bandCols, cells: bandRow },
    head: rows[0] || [],
    rows: rows.slice(1),
  };
  const outside = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '<w:tbl/>');
  const bodyStart = outside.indexOf('<w:body>');
  const topParas = parasOf(outside.slice(bodyStart));
  // The band, then the meta line, then the actions table, then the footer.
  layout.meta = topParas[0] || { runs: [], pitch: 0 };
  layout.foot = topParas[topParas.length - 1] || { runs: [], pitch: 0 };
  if (topParas.length !== 2) V(res, 'layout.paragraphs', 'expected 2 paragraphs outside the tables (the count line and the footer), found ' + topParas.length);
  try {
    const est = estimate(layout);
    res.estimate = est;
    if (est.total > est.budget) {
      V(res, 'page.overflow', 'estimated height ' + est.total + ' twips against a one-page budget of ' + est.budget +
        ' (' + Math.round((100 * est.total) / est.budget) + '%): this document does not fit one page');
    }
  } catch (e) { V(res, 'page.unmeasured', 'the page could not be measured: ' + e.message); }

  if (res.violations.length) res.exitCode = 1;
  return res;
}

function checkDocx(file) {
  let buf;
  try { buf = fs.readFileSync(file); }
  catch (e) { return usage(newResult(file, 'docx'), 'could not read ' + file + ': ' + e.message); }
  return checkDocxBuffer(buf, path.basename(file));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function report(res) {
  const out = [];
  out.push('action_check — ' + res.file + (res.mode === 'docx' ? ' (built document)' : ' (before build)'));
  if (res.fatal) {
    out.push('  ' + res.fatal);
    out.push('');
    out.push('ERROR — the check could not run (exit 2)');
    return out.join('\n');
  }
  if (res.brand) {
    out.push('  brand: ' + (res.brand.source === 'config' ? res.brand.configPath + ' (brand_check exit ' + res.brand.checkExit + ')' : 'neutral defaults'));
  }
  if (res.estimate) {
    const e = res.estimate;
    out.push('  page: ' + e.total + ' of ' + e.budget + ' twips (' + Math.round((100 * e.total) / e.budget) + '%), ' +
      (e.rowHs.length) + ' action row' + (e.rowHs.length === 1 ? '' : 's') + ', ' + e.face + ' width table');
  }
  out.push('');
  for (const v of res.violations) out.push('  FAIL  ' + v.id.padEnd(17) + v.msg);
  for (const w of res.warnings) out.push('  WARN  ' + w.id.padEnd(17) + w.msg);
  for (const n of res.notes) out.push('  NOTE  ' + n);
  if (res.violations.length || res.warnings.length || res.notes.length) out.push('');
  out.push(res.violations.length
    ? 'FAIL — ' + res.violations.length + ' violation' + (res.violations.length === 1 ? '' : 's') + '. No document is written.'
    : 'PASS — ' + (res.mode === 'docx' ? 'the document is one page by the bound, and every row has an owner and a source.' : 'safe to build.'));
  return out.join('\n');
}

function asJson(res) {
  return JSON.stringify({
    file: res.file, mode: res.mode, ok: res.exitCode === 0, exitCode: res.exitCode, fatal: res.fatal || null,
    violations: res.violations, warnings: res.warnings, notes: res.notes,
    brand: res.brand, estimate: res.estimate,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// File name: {PREFIX}_{SEGMENT}_{Topic}_ACTIONS[_{YYYY-MM-DD}].docx
// ---------------------------------------------------------------------------

function outputName(model, brand) {
  const N = brand.naming || {};
  const seg = (model.segment && (N.SEGMENTS || []).includes(model.segment)) ? model.segment : N.defaultSegment;
  let topic = String(model.meeting || 'Meeting').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('_');
  if (topic.length > 48) topic = topic.slice(0, 48).replace(/_[^_]*$/, '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(model.date || '').trim()) ? '_' + String(model.date).trim() : '';
  return [N.PREFIX, seg, topic].filter(Boolean).join('_') + '_ACTIONS' + date + '.docx';
}

module.exports = {
  SCHEMA_ID, LAYOUT, TABLES, faceTable,
  readNotes, fold, findQuote, buildLayout, estimate, paraLines,
  checkModel, checkDocx, checkDocxBuffer, report, asJson, outputName,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  let kit = null;
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kit') kit = argv[++i];
    else if (argv[i] === '--json') continue;
    else if (argv[i] === '-h' || argv[i] === '--help') pos.length = 99;
    else pos.push(argv[i]);
  }
  if (pos.length !== 1 || (kit !== null && !kit)) {
    process.stderr.write('usage: node action_check.js <actions.json | list.docx> [--kit PATH] [--json]\n');
    process.exit(2);
  }
  if (kit) process.env.HPW_BRAND_KIT = path.resolve(kit);
  const file = path.resolve(pos[0]);
  const ext = path.extname(file).toLowerCase();
  let res;
  if (ext === '.json') res = checkModel(file);
  else if (ext === '.docx') res = checkDocx(file);
  else {
    process.stderr.write('action_check: expected an actions .json or a built .docx, got ' + (ext || 'no extension') + '\n');
    process.exit(2);
  }
  console.log(json ? asJson(res) : report(res));
  process.exit(res.exitCode);
}

if (require.main === module) main();
