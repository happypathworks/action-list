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
 *   5. text      every field the extraction wrote is one XML 1.0 allows, so
 *                Word can open the file; kit and notes text prints only its
 *                visible characters
 *
 * Two inputs:
 *   node action_check.js actions.json   before a build: all five checks
 *   node action_check.js list.docx      after a build: page geometry, line
 *                                       pitch, the builder's formatting and
 *                                       nothing else, owner and source cells,
 *                                       the page bound re-measured from the
 *                                       file itself, and every XML part free
 *                                       of characters Word cannot read
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
  // TITLE_MIN: the title cell keeps 2 in whatever logo cell the kit asks for.
  BAND: Object.freeze({ SIDE_W: 2800, LOGO_W: 1400, LOGO_BOX_H: 720, PAD_V: 120, PAD_H: 160, IMG_ALLOW: 80, TITLE_MIN: 2880 }),
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
// the table fits in every face it covers.
//
// Outside ASCII, two blocks every face in the set carries are bounded by their
// widest glyph in that set, read the same way: Latin-1 and Latin Extended-A
// letters (U+00A1-U+017F but the soft hyphen), and the typographic quotes,
// dashes, daggers, bullet and ellipsis (CURLY below). Anything else -- an
// emoji, a symbol, another script, a glyph one of the faces lacks -- is drawn
// from whatever font Word falls back to, so it takes 2 em: the widest advance
// in the Windows fallback fonts measured (Segoe UI Emoji draws every emoji at
// 1.373 em, Segoe UI Symbol tops out at 1.6) is under it, except Javanese
// punctuation (2.3 em) and cuneiform (3.64 em), which take 4 em.
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

function widthTable(csv, name, latin, curly) {
  const w = csv.split(',').map(Number);
  w.NAME = name;
  w.LATIN = latin; // widest of U+00A1-U+017F but U+00AD, in the same faces
  w.CURLY = curly; // widest of the CURLY characters, in the same faces
  return w;
}
const TABLES = {
  STANDARD: widthTable(W_STANDARD, 'standard', 1056, 1027),
  WIDE: widthTable(W_WIDE, 'wide', 1260, 1027),
  BOLD: widthTable(W_BOLD, 'bold', 1182, 1049),
};
// U+2013-2015, 2018-201A, 201C-201E, 2020-2022, 2026: the ones every face carries.
const CURLY = new Set([0x2013, 0x2014, 0x2015, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026]);
const FALLBACK_EM = 2000;
const FALLBACK_WIDE_EM = 4000; // Javanese U+A980-U+A9DF, cuneiform U+12000-U+1254F

/** Thousandths of an em for one code point, never less than any face draws it. */
function advance(c, table) {
  if (c >= 32 && c <= 126) return table[c - 32];
  if (c >= 0xA1 && c <= 0x17F && c !== 0xAD) return table.LATIN;
  if (CURLY.has(c)) return table.CURLY;
  if ((c >= 0xA980 && c <= 0xA9DF) || (c >= 0x12000 && c <= 0x1254F)) return FALLBACK_WIDE_EM;
  return FALLBACK_EM;
}
const STANDARD_FACES = ['arial', 'liberation sans', 'calibri', 'carlito', 'georgia', 'times new roman',
  'segoe ui', 'tahoma', 'trebuchet ms', 'garamond', 'candara', 'corbel', 'constantia'];

function faceTable(font) {
  const f = String(font).trim().toLowerCase();
  return STANDARD_FACES.includes(f) ? TABLES.STANDARD : TABLES.WIDE;
}

// ---------------------------------------------------------------------------
// Reading files: zip entries (for .docx) and notes
// ---------------------------------------------------------------------------

/** The central directory of a zip: [{name, method, csize, lho}]. */
function zipDir(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const out = [];
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip central directory');
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nlen), method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20), lho: buf.readUInt32LE(p + 42) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function zipEntry(buf, name) {
  const e = zipDir(buf).find((x) => x.name === name);
  if (!e) return null;
  const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error('unsupported zip compression method ' + e.method);
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

// ---------------------------------------------------------------------------
// Characters XML 1.0 forbids. The docx library escapes & < > " and writes
// these as they are, and one of them in any part makes the .docx unreadable:
// Word refuses the file. Text the list was not written from -- the kit's
// organization name and typeface, the notes' own words -- prints only its
// visible characters, as the document pack's builders do. Text the extraction
// wrote is refused by field before the build. Every XML part of the built
// file is checked after it, so nothing slips through either way.
// ---------------------------------------------------------------------------
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

/** A string with its forbidden characters gone: a line or page feed reads as a space. */
function visible(s) {
  return String(s).replace(/[\u000B\u000C]/g, ' ').replace(/[\u0000-\u0008\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function forbiddenChar(s) {
  const m = XML_FORBIDDEN.exec(String(s));
  return m ? 'U+' + m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') : null;
}

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
    const buf = fs.readFileSync(file);
    // UTF-16 (Notepad's "Unicode") carries a byte-order mark or a zero byte in
    // every ASCII character; read as UTF-8 it would fail every quote.
    const bom = buf[0] * 256 + buf[1];
    if (bom === 0xFFFE || bom === 0xFEFF || buf.includes(0)) {
      const err = new Error(name + ' is not UTF-8 text (it looks like UTF-16). Save the notes as UTF-8 and re-run.');
      err.code = 'NOTES_TYPE';
      throw err;
    }
    return { text: buf.toString('utf8').replace(/^﻿/, ''), kind: 'text', unit: 'line', name };
  }
  const err = new Error('notes must be a .txt, .md or .docx file, not ' + ext +
    '. Save pasted or extracted text as notes.txt, byte for byte, and point "notes" at it.');
  err.code = 'NOTES_TYPE';
  throw err;
}

// ---------------------------------------------------------------------------
// Quote matching. Both sides are folded the same way: case, runs of
// whitespace (line breaks included), typographic quotes, primes and dashes,
// and non-breaking spaces. Nothing else is forgiven. A paraphrase does not
// match, and neither does a quote that starts or ends inside a word.
// ---------------------------------------------------------------------------
const FOLD = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
};

/** keepCase folds everything above but case: an owner's capital is evidence. */
function fold(s, keepCase) {
  const out = [];
  const map = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (!space) { out.push(' '); map.push(i); space = true; }
      continue;
    }
    const r = FOLD[c] !== undefined ? FOLD[c] : keepCase ? c : c.toLowerCase();
    for (const ch of r) { out.push(ch); map.push(i); }
    space = false;
  }
  if (out.length && out[out.length - 1] === ' ') { out.pop(); map.pop(); }
  return { text: out.join(''), map };
}

function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) {
    const c = text.charCodeAt(i);
    // LF, CR LF and a lone CR (older Mac notes) each end a line.
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) n++;
  }
  return n;
}

/**
 * Find a quote in the notes.
 * @returns {null | {start:number, end:number, lineFrom:number, lineTo:number, span:string, count:number}}
 *   span is the notes' own text for the match, whitespace collapsed: the
 *   document prints what the notes say, not what the extraction retyped.
 */
const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);

// A hyphen or an apostrophe between two letters joins one word: "Ann" cut from
// "Mary-Ann", or "Brien" from "O'Brien", is not a whole word. A dash between
// words does not join them ("Ana—labels"), and a possessive "'s" after a
// word leaves the word whole ("Dana" in "Dana's bank").
const JOINER = /^['\u2019\u2018\u02BC\-\u2010\u2011]$/;
const APOSTROPHE = /^['\u2019\u2018\u02BC]$/;
/** Is the word that starts at text[i] joined to letters before it? */
const joinedBefore = (text, i) => i >= 2 && JOINER.test(text[i - 1]) && isWordChar(text[i - 2]);
/** Is the word that ends just before text[i] joined to letters after it? */
const joinedAfter = (text, i) => !!text[i] && JOINER.test(text[i]) && isWordChar(text[i + 1]) &&
  !(APOSTROPHE.test(text[i]) && /^s$/i.test(text[i + 1]) && !isWordChar(text[i + 2]));

function findQuote(notesText, foldedNotes, quote) {
  const q = fold(quote).text;
  const t = foldedNotes.text;
  // "ana will check" is not a quote of "Dana will check": a match that cuts a
  // word at either end is not the notes' words. An apostrophe inside a word
  // joins it: "'s team will call" cuts "Dana's".
  const edge = (a, b) => isWordChar(a) || (a === "'" && isWordChar(b));
  const whole = (k) => {
    if (edge(q[0], q[1]) && isWordChar(t[k - 1])) return false;
    if (edge(q[q.length - 1], q[q.length - 2]) && isWordChar(t[k + q.length])) return false;
    const from = foldedNotes.map[k], to = foldedNotes.map[k + q.length - 1] + 1;
    return !(isWordChar(q[0]) && joinedBefore(notesText, from)) &&
      !(isWordChar(q[q.length - 1]) && joinedAfter(notesText, to));
  };
  let at = -1, count = 0;
  for (let k = t.indexOf(q); k >= 0; k = t.indexOf(q, k + 1)) {
    if (!whole(k)) continue;
    if (at < 0) at = k;
    count++;
  }
  if (at < 0) return null;
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

/**
 * Is the owner named in the quote, as a whole word? Case is ignored only where
 * the quote capitalizes the word: "Ana will order" names Ana, and does not
 * name an attendee called Will. Notes written all in lower case name an owner
 * written the same way.
 */
function namesOwner(span, owner) {
  return ownerAsWritten(span, owner) !== null;
}

/**
 * The owner as the quote writes it ("Dana", or "dana" in lower-case notes), or
 * null. Not where it is part of a longer word ("Ann" in "Mary-Ann"), and not
 * where the quote uses it as an ordinary word (ordinaryUse).
 */
function ownerAsWritten(span, owner) {
  const folded = fold(span, true);
  const hay = folded.text;
  const n = fold(owner, true).text;
  for (let k = hay.toLowerCase().indexOf(n.toLowerCase()); k >= 0; k = hay.toLowerCase().indexOf(n.toLowerCase(), k + 1)) {
    if (isWordChar(hay[k - 1]) || isWordChar(hay[k + n.length])) continue;
    const from = folded.map[k], to = folded.map[k + n.length - 1] + 1;
    if (joinedBefore(span, from) || joinedAfter(span, to)) continue;
    if (ordinaryUse(hay, k, k + n.length, n)) continue;
    const got = hay.slice(k, k + n.length);
    if (got === n || got[0] !== got[0].toLowerCase()) return got;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What counts as an owner: a person, by name. A name is made of words that
// each hold a letter, and none of them is a word that points at somebody
// without naming them. Those are closed word classes, listed whole below, not
// phrases collected as they turn up: pronouns, determiners and quantifiers,
// prepositions, and the placeholders that stand where a name is missing. So
// "Someone from ops", "All of us" and "No owner" name nobody by rule, as do
// "TBD.", "we" and "-". An auxiliary ("will", "may") written in lower case is
// a verb, not a name: "will" in "ana will order" does not name Will.
//
// One of these words is a name when the notes use it as one: capitalized where
// no sentence starts ("Present: Luis, An"; "assistant So will"). At the start
// of a line, a sentence or a field ("Owner: Someone") a capital proves
// nothing, so there it stays a function word.
//
// Where the notes use capitals, a name is written with them: every word of the
// owner, as the quote writes it, begins with a capital (a script without case,
// and the particles in "Ana de la Cruz", excepted). In a quote written all in
// lower case, case cannot tell a name.
// ---------------------------------------------------------------------------
const wordSet = (s) => new Set(s.split(' '));
const NOBODY_WORDS = wordSet(
  // pronouns, personal, possessive, reflexive, relative and indefinite
  'i me my mine myself we us our ours ourselves you your yours yourself yourselves he him his himself she her hers herself ' +
  'it its itself they them their theirs themselves one oneself who whom whose whoever whomever whichever whatever ' +
  'someone somebody something anyone anybody anything everyone everybody everything nobody noone no-one nothing none ' +
  // determiners and quantifiers
  'a an the this that these those all any each every either neither both few many much more most several some such ' +
  'other others another enough no half else ' +
  // prepositions
  'of from for to in on at by with without within about above below under over into onto out off up down after before ' +
  'between among across along around through toward towards per via than like except');
// Placeholders for a name: no use in the notes makes one of these a name.
const PLACEHOLDERS = wordSet('tbd tba tbc n/a na unassigned unknown owner owners pending');
const AUXILIARIES = wordSet('will would shall should may might can could must do does did is are was were be been being am has have had');
const PARTICLES = wordSet('van von der den de del della di da du la le dos das ter ten bin ibn al el y');
// Words English capitalizes wherever they stand, so a capital never shows them used as a name.
const ALWAYS_CAPITAL = wordSet('i');
// An article or a possessive straight after a word makes the word a verb with
// an object ("Mark the unpaid invoices", "send Dana a copy"): not the one who
// does the action. Straight before it, the word is a modifier ("the June
// container"). A month after a preposition is a date ("by June").
const ARTICLES = wordSet('the a an our your their its my his her every each');
const MODIFIERS = wordSet('the a an this that these those next last every each our your their its my his her');
const DATE_PREPOSITIONS = wordSet('by in until till since before after during through from of for');

/**
 * Does the quote use the word at hay[from, to) as an ordinary word rather than
 * as the name of the person who does the action?
 */
function ordinaryUse(hay, from, to, word) {
  const after = (/^\s+([\p{L}']+)/u.exec(hay.slice(to)) || [])[1];
  const before = (/([\p{L}']+)\s+$/u.exec(hay.slice(0, from)) || [])[1];
  if (after && ARTICLES.has(after.toLowerCase())) return true;
  if (before && MODIFIERS.has(before.toLowerCase())) return true;
  return !!before && MONTHS.includes(word.toLowerCase()) && DATE_PREPOSITIONS.has(before.toLowerCase());
}

/**
 * A heading in Title Case ("What We Agreed", "Updates From Everyone"): two or
 * more words, no comma, every word with a letter capitalized but the short ones
 * titles leave in lower case. A capital there proves nothing about a name. An
 * attendee list ("Present: Luis, An") has commas, so it is no heading.
 */
const TITLE_SMALL = wordSet('a an the and or nor but of to for in on at by with from as');
function titleLine(line) {
  if (/,/.test(line)) return false;
  const words = line.replace(/^\s*(?:[-*\u2022\u2013\u2014+>#]+|\(?\d+[.)])?\s*/, '').split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.length >= 2 && words.every((w, i) => isCapital(w) || (i > 0 && TITLE_SMALL.has(w.toLowerCase())));
}

const EDGE = /^[\s"'“”‘’()[\].,;:!?*]+|[\s"'“”‘’()[\].,;:!?*]+$/g;
const wordsOf = (s) => String(s).replace(EDGE, '').split(/\s+/).map((w) => w.replace(EDGE, '')).filter((w) => w !== '');
const hasCase = (ch) => ch.toLowerCase() !== ch.toUpperCase();
const isCapital = (w) => { const ch = Array.from(w).find((c) => /\p{L}/u.test(c)); return !!ch && (!hasCase(ch) || ch === ch.toUpperCase()); };

/** Do the notes write this word capitalized where no sentence or list item starts? */
function usedAsName(word, notesText) {
  if (!notesText || !isCapital(word) || ALWAYS_CAPITAL.has(word.toLowerCase())) return false;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'gmu');
  let m;
  while ((m = re.exec(notesText))) {
    const at = m.index + m[1].length;
    const lineStart = notesText.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = notesText.indexOf('\n', at);
    if (titleLine(notesText.slice(lineStart, lineEnd < 0 ? notesText.length : lineEnd))) continue;
    const before = notesText.slice(lineStart, at)
      .replace(/^\s*(?:[-*•–—+>]|\(?\d+[.)]|\(?[a-z][.)])?\s*/i, '').trimEnd();
    if (before && !/[.!?:;=\-–—]["'”’)]*$/.test(before)) return true;
  }
  return false;
}

/**
 * Why a written owner does not name a person, or null when it does.
 * @param {string} written     the owner, as the extraction or the notes wrote it
 * @param {string|null} notes  the notes text, for a name that is also a function word
 * @param {boolean} capitals   whether capitals can tell a name here
 */
function notAName(written, notes, capitals) {
  const words = wordsOf(written);
  if (!words.length) return 'it is blank';
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = w.toLowerCase();
    if (!/\p{L}/u.test(w)) return '"' + w + '" holds no letter';
    if (PLACEHOLDERS.has(lw)) return '"' + w + '" stands where a name is missing';
    if (NOBODY_WORDS.has(lw) && !usedAsName(w, notes)) return '"' + w + '" points at somebody without naming them';
    if (AUXILIARIES.has(lw) && !isCapital(w)) return '"' + w + '" is a verb, not a name';
    const particle = i > 0 && i < words.length - 1 && PARTICLES.has(w);
    if (capitals && !particle && !isCapital(w)) return '"' + w + '" is not capitalized, and the notes capitalize names';
  }
  return null;
}

/** An owner (or one co-owner) that names nobody, before it is looked for in the quote. */
function namesNobody(owner, notes) {
  return notAName(owner, notes, false) !== null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

/** Do the notes write a date with this year and month ("2026-04-23", "April 23, 2026", "4/23/2026", "April 2026")? */
function yearStated(text, ymd) {
  const [y, m] = ymd.split('-');
  const name = String(MONTHS[Number(m) - 1]);
  const mon = '(?:' + name + '|' + name.slice(0, 3) + '\\.?)';
  const day = '\\d{1,2}(?:st|nd|rd|th)?';
  const num = '0?' + Number(m);
  return new RegExp([
    '\\b' + y + '-' + m + '\\b',
    '\\b' + mon + '\\s+(?:' + day + ',?\\s+)?' + y + '\\b',
    '\\b' + day + '\\s+' + mon + ',?\\s+' + y + '\\b',
    '\\b(?:' + num + '[-/.]\\d{1,2}|\\d{1,2}[-/.]' + num + ')[-/.]' + y + '\\b',
  ].join('|'), 'i').test(text);
}

function ownerParts(owner) {
  return String(owner).split(/\s*(?:,|&|\/|;|\band\b|\+)\s*/i).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The page bound
// ---------------------------------------------------------------------------

const NO_BREAK = new Set(['\u00A0', '\u2007', '\u202F']);

/** Twips for one character at a size in half-points. */
function charTw(ch, table, sz) {
  // codePointAt: an emoji is one character, not two halves of a pair.
  return (advance(ch.codePointAt(0), table) * sz) / 100; // em/1000 * sz/2 pt * 20 twips/pt
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
    // NFC first: an accent typed as a separate mark joins its letter, as drawn.
    // A no-break space joins the words either side, as Word sets it: it is
    // measured as a space, and the line cannot break there.
    for (const ch of String(r.t).normalize('NFC').replace(/[^\S\u00A0\u2007\u202F]/g, ' ')) {
      if (ch === ' ') { place(); if (cur > 0) gap += charTw(' ', table, r.sz); }
      else if (NO_BREAK.has(ch)) word += charTw(' ', table, r.sz);
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
  // brand_check, run by load(), has refused a logo that is missing or not a PNG.
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Fit the logo inside its box, never enlarging it past 96 dpi. Twips. */
function logoBox(brand) {
  const L = brand.logo;
  if (L.absent || !L.resolvedPath) return null;
  const px = pngPixels(L.resolvedPath);
  const cellW = L.headerCellDxa;
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
  const font = visible(brand.type.FONT);
  const face = faceTable(font);
  const logo = logoBox(brand);
  const side = LAYOUT.BAND.SIDE_W;
  const bandCols = logo ? [logo.cellW, LAYOUT.CONTENT_W - logo.cellW - side, side] : [LAYOUT.CONTENT_W - side, side];
  const org = visible(brand.org.shortName);
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
      [para([{ t: q ? sourceLabel(q) + '  ' : '', sz: S.BODY, role: 'muted' }, { t: '"' + (q ? visible(q.span) : '') + '"', i: true, sz: S.BODY, role: 'muted' }])],
    ];
  });

  const anyAssigned = model.actions.some((a) => a.ownerAssigned);
  const foot = para([{
    t: 'Each source is quoted from ' + notes.name + '; L gives the ' + notes.unit + ' it starts on.' +
      (anyAssigned ? ' * Owner assigned after the meeting: the notes name no owner for that action.' : ''),
    sz: S.SMALL, role: 'muted',
  }], { before: LAYOUT.FOOT.BEFORE, after: LAYOUT.FOOT.AFTER });

  return { face: face.NAME, font, logo, band: { cols: bandCols, cells: bandCells }, meta, head, rows, foot };
}

/** The band or the action cell that is tallest, named for the field it holds. */
function tallestPart(layout, est) {
  const top = Math.max.apply(null, est.rowHs);
  if (est.bandH >= top) return 'the band, which holds the meeting name and date (' + est.bandH + ' twips)';
  const i = est.rowHs.indexOf(top);
  const face = TABLES[layout.face.toUpperCase()];
  const hs = layout.rows[i].map((paras, k) => stackHeight(paras, LAYOUT.COLS[k].w - 2 * LAYOUT.CELL.PAD_H, face));
  return 'action ' + (i + 1) + "'s " + LAYOUT.COLS[hs.indexOf(Math.max.apply(null, hs))].key + ' (a row of ' + top + ' twips)';
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

/**
 * Hard-fail 4, in either mode: load the kit the build reads (or read), and
 * refuse one that fails. brand_kit.js load() runs brand_check's checkKit()
 * and throws HPW_BRAND_CHECK_FAILED on any violation -- the findings on which
 * brand_check.js exits 1 -- so a kit it returns is one brand_check.js passes
 * with exit 0, and that is what the report says.
 */
function kitVerdict(res) {
  let brand = null;
  try { brand = loadBrand(); }
  catch (e) {
    if (e.code === 'HPW_BRAND_CHECK_FAILED') {
      V(res, 'brand.check', e.message.split('\n')[0] +
        '\n        No document is written against a kit that fails. Fix the kit with the brand-kit skill, or move it aside to build on neutral defaults.');
    } else {
      V(res, 'brand.load', 'the brand kit could not be loaded: ' + e.message.split('\n')[0]);
    }
    return null;
  }
  res.brand = { source: brand._source, configPath: brand._configPath, font: brand.type && brand.type.FONT,
    checkExit: brand._source === 'config' ? 0 : null };
  if (brand._source !== 'config') {
    res.notes.push('no brand.json found: the list builds with the neutral defaults. That is a supported state; say so when delivering.');
  }
  return brand;
}

// ---------------------------------------------------------------------------
// The input's shape: actions.schema.json, beside this file, closed. A key it
// does not list is refused by name (a misspelled key would otherwise read as
// missing and build), and so is a value of another type. A missing key is
// left to the named checks in checkModel.
// ---------------------------------------------------------------------------
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'actions.schema.json'), 'utf8'));

function typeName(v) {
  return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** [{id, msg}] for every unknown key and wrong type under `where`. */
function shapeErrors(v, s, where, out) {
  const t = typeName(v);
  if (t !== s.type) {
    out.push({ id: 'schema.type', msg: (where || 'the file') + ' must be ' + (s.type === 'array' ? 'an array' : s.type === 'object' ? 'an object' : 'a ' + s.type) +
      '; it is ' + (t === 'string' ? 'the string ' + JSON.stringify(v).slice(0, 60) : t === 'number' || t === 'boolean' ? 'the ' + t + ' ' + v : t === 'null' ? 'null' : t === 'array' ? 'an array' : 'an object') });
    return out;
  }
  if (t === 'object') {
    for (const k of Object.keys(v)) {
      if (Object.prototype.hasOwnProperty.call(s.properties, k)) { shapeErrors(v[k], s.properties[k], where ? where + '.' + k : k, out); continue; }
      const near = Object.keys(s.properties).filter((p) => distance(p.toLowerCase(), k.toLowerCase()) <= 2);
      out.push({ id: 'schema.key', msg: 'unknown key ' + JSON.stringify(k) + ' in ' + (where || 'the top level') + ': nothing reads it.' +
        (near.length ? ' Did you mean ' + near.map((p) => JSON.stringify(p)).join(' or ') + '? A misspelled key is read as missing.' : ' Remove it.') });
    }
  }
  if (t === 'array') v.forEach((x, i) => shapeErrors(x, s.items, where + '[' + i + ']', out));
  return out;
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
  for (const e of shapeErrors(model, SCHEMA, '', [])) V(res, e.id, e.msg);

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
  // A YYYY-MM-DD date carries a year: the notes must state it, or the year was
  // supplied. Stated means written as a date with this month, so a "2026
  // catalog" elsewhere does not vouch for a meeting the notes date 2025.
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(model.date || '').trim()) ? String(model.date).trim() : '';
  if (ymd && !yearStated(notes.text, ymd)) {
    WARN(res, 'date.unsourced', 'date ' + ymd + ': the notes never write a ' + ymd.slice(0, 7) + ' date, so the year ' + ymd.slice(0, 4) +
      ' was supplied. Write the date as the notes give it; do not supply a year.');
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
    else if (fold(src).text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length < 3) V(res, 'source.short', 'action ' + n + ': source "' + src + '" is under three words, too short to locate an action by', tag);
    else if (!q) V(res, 'source.notfound', 'action ' + n + ': source is not in ' + notes.name + '. Quote the notes exactly; a paraphrase does not match. Quoted: "' + src.slice(0, 120) + '"', tag);
    else if (q.count > 1) WARN(res, 'source.ambiguous', 'action ' + n + ': the quote occurs ' + q.count + ' times in the notes; the first, ' + notes.unit + ' ' + q.lineFrom + ', is cited', tag);

    // --- hard-fail 1: every action names an owner the notes name -----------
    const owner = String(a.owner || '').trim();
    const parts = ownerParts(owner);
    // "n/a" is one word that ownerParts would split at the slash.
    const nobody = wordsOf(owner).length === 1 && namesNobody(owner, notes.text) ? [owner] : parts.filter((p) => namesNobody(p, notes.text));
    // Capitals tell a name only where the quote uses them; with no quote, the owner is the user's answer.
    const capitals = q ? /\p{Lu}/u.test(q.span) : true;
    if (!owner || nobody.length) {
      V(res, 'owner.missing', 'action ' + n + where + ': no owner' + (owner ? ' ("' + nobody.join('", "') + '" names nobody)' : '') +
        '. Ask who owns it; do not pick one.', tag);
    } else if (!a.ownerAssigned && q) {
      const missing = parts.filter((part) => !namesOwner(q.span, part));
      if (missing.length) {
        V(res, 'owner.unsourced', 'action ' + n + where + ': owner "' + missing.join('", "') + '" is not named in the quoted source. ' +
          'If the notes name the owner nearby, widen the quote to include the name. If they do not, ask who owns it; set "ownerAssigned": true only on that answer.', tag);
      } else {
        const why = parts.map((p) => notAName(ownerAsWritten(q.span, p), notes.text, capitals)).find(Boolean);
        if (why) {
          V(res, 'owner.missing', 'action ' + n + where + ': owner "' + owner + '" is not a person\'s name (' + why + '). ' +
            'The owner is the name of the person who took the action on, as the notes write it. Ask who owns it; do not pick one.', tag);
        }
      }
    } else if (a.ownerAssigned) {
      const why = parts.map((p) => notAName(p, notes.text, capitals)).find(Boolean);
      if (why) V(res, 'owner.missing', 'action ' + n + where + ': assigned owner "' + owner + '" is not a person\'s name (' + why + '). Record the name the user gave.', tag);
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
  let badBand = false;
  const brand = kitVerdict(res);
  if (brand) {
    // brand_check.js passes any whole number here; a cell wider than the band
    // leaves the title a negative width, which the renderer cannot lay out.
    const L = brand.logo;
    const B = LAYOUT.BAND, maxW = LAYOUT.CONTENT_W - B.SIDE_W - B.TITLE_MIN;
    const cellW = L.headerCellDxa;
    if (model.segment !== undefined) {
      const N = brand.naming;
      if (!N.SEGMENTS.includes(model.segment)) {
        V(res, 'segment.unknown', 'segment ' + JSON.stringify(model.segment) + ' is not one of the brand kit naming.SEGMENTS (' +
          N.SEGMENTS.join(', ') + '). Use one of them, or leave segment out for ' + N.defaultSegment + '.');
      }
    }
    if (!L.absent && L.resolvedPath && !(Number.isInteger(cellW) && cellW > 2 * B.PAD_H && cellW <= maxW)) {
      V(res, 'brand.logo', 'brand kit logo.headerCellDxa is ' + JSON.stringify(L.headerCellDxa) + ': the logo cell must be a whole number of twips from ' +
        (2 * B.PAD_H + 1) + ' to ' + maxW + ', so the title keeps its width. Fix the kit with the brand-kit skill.');
      badBand = true; // the page bound cannot lay out this band
    }
  }

  // --- every field the extraction wrote, and the page prints, is one Word can read --
  const texts = [['meeting', model.meeting], ['date', model.date], ['the notes file name', notes.name]];
  (actions || []).forEach((a, i) => {
    for (const k of ['owner', 'action', 'due']) texts.push(['action ' + (i + 1) + ' ' + k, (a || {})[k]]);
  });
  for (const [where, s] of texts) {
    const ch = s == null ? null : forbiddenChar(s);
    if (ch) V(res, 'text.control', where + ' holds a control character (' + ch + ') that Word cannot read: the document would not open. Remove it.');
  }

  // --- hard-fail 3: one page ----------------------------------------------
  if (brand && !badBand && model.actions.length) {
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
        ' (' + Math.round((100 * est.total) / est.budget) + '%), ' + over + ' over; the tallest part is ' + tallestPart(layout, est) + '. Shorten each source to the shortest span that names ' +
        'the owner and the commitment, and each action to one line. If it still does not fit, the meeting produced more than one page ' +
        'of actions: offer one list per owner. Never let it run to a second page.');
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

// ---------------------------------------------------------------------------
// The builder's formatting, and nothing else. The bound below re-measures the
// text, sizes and pitch it finds, but takes cell margins, paragraph spacing,
// borders and the typeface as the builder writes them. A list edited after the
// build can carry other values, or formatting the builder never writes (a row
// height, a character scale, a header, an indent), and the bound would measure
// a page that is not the one Word lays out. So every property element in the
// document, and in the styles that apply without being named, is one the
// builder writes, with only the attributes it writes; cell margins and
// paragraph spacing carry the builder's values (checked where they are laid
// out, below); borders are single and no heavier than the 0.5pt rule counted;
// and one typeface sets every run. Anything else is refused: rebuild the list
// from its actions.json rather than editing the .docx.
// ---------------------------------------------------------------------------
const SIDE = ['w:val', 'w:color', 'w:sz'];
const PAD = ['w:type', 'w:w'];
const FORMAT = {
  'w:pPr': { 'w:spacing': ['w:before', 'w:after', 'w:line', 'w:lineRule'], 'w:jc': ['w:val'], 'w:rPr': [] },
  'w:rPr': { 'w:rFonts': ['w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'], 'w:b': ['w:val'], 'w:bCs': ['w:val'], 'w:i': ['w:val'],
    'w:iCs': ['w:val'], 'w:color': ['w:val'], 'w:sz': ['w:val'], 'w:szCs': ['w:val'] },
  'w:tcPr': { 'w:tcW': PAD, 'w:tcBorders': [], 'w:shd': ['w:fill', 'w:color', 'w:val'], 'w:tcMar': [], 'w:vAlign': ['w:val'] },
  'w:trPr': { 'w:cantSplit': ['w:val'], 'w:tblHeader': ['w:val'] },
  'w:tblPr': { 'w:tblW': PAD, 'w:tblBorders': [], 'w:tblLayout': ['w:type'] },
  'w:sectPr': { 'w:pgSz': ['w:w', 'w:h', 'w:orient'], 'w:pgMar': ['w:top', 'w:right', 'w:bottom', 'w:left', 'w:header', 'w:footer', 'w:gutter'],
    'w:pgNumType': [], 'w:docGrid': ['w:linePitch'] },
  'w:tcBorders': { 'w:top': SIDE, 'w:left': SIDE, 'w:bottom': SIDE, 'w:right': SIDE },
  'w:tblBorders': { 'w:top': SIDE, 'w:left': SIDE, 'w:bottom': SIDE, 'w:right': SIDE, 'w:insideH': SIDE, 'w:insideV': SIDE },
  'w:tcMar': { 'w:top': PAD, 'w:left': PAD, 'w:bottom': PAD, 'w:right': PAD },
  'w:docDefaults': { 'w:rPrDefault': [], 'w:pPrDefault': [] },
  'w:rPrDefault': { 'w:rPr': [] },
  'w:pPrDefault': { 'w:pPr': [] },
  // A default style (w:default="1") applies unnamed; its properties go through the sets above.
  'w:style': { 'w:name': ['w:val'], 'w:basedOn': ['w:val'], 'w:next': ['w:val'], 'w:link': ['w:val'], 'w:uiPriority': ['w:val'],
    'w:qFormat': [], 'w:semiHidden': [], 'w:unhideWhenUsed': [], 'w:pPr': [], 'w:rPr': [], 'w:tblPr': [] },
};
const BORDER_SZ = 4; // eighths of a point: the 0.5pt rule LAYOUT.BORDER counts

/** Formatting the builder does not write, as messages; and every typeface named. */
function formatErrors(xml, part, fonts) {
  const out = [];
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w.-]*(?::[\w.-]+)?)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, close, name, attrs, self] = m;
    if (close) { stack.pop(); continue; }
    const parent = stack[stack.length - 1];
    const allowed = FORMAT[parent];
    if (allowed) {
      const names = attrs.match(/[^\s=]+(?=\s*=)/g) || [];
      const val = (a) => { const v = new RegExp('\\s' + a + '\\s*=\\s*"([^"]*)"').exec(attrs); return v && v[1]; };
      if (!Object.prototype.hasOwnProperty.call(allowed, name)) out.push(part + ': <' + name + '> in <' + parent + '>');
      else {
        for (const a of names) if (!allowed[name].includes(a)) out.push(part + ': ' + a + ' on <' + name + '>');
        if (parent === 'w:tcBorders' || parent === 'w:tblBorders') {
          if (!/^(single|none|nil)$/.test(String(val('w:val')))) out.push(part + ': a ' + val('w:val') + ' border (the bound counts one single rule)');
          if (Number(val('w:sz')) > BORDER_SZ) out.push(part + ': a border of ' + val('w:sz') + ' eighths of a point (the bound counts ' + BORDER_SZ + ')');
        }
        if (name === 'w:pgMar' && Number(val('w:gutter')) !== 0) out.push(part + ': a gutter of ' + val('w:gutter') + ' twips');
        if (name === 'w:rFonts') for (const a of names) fonts.add(val(a));
      }
    }
    if (!self) stack.push(name);
  }
  return out;
}

/** The styles that apply to a paragraph, run or table that names none. */
function unnamedStyles(stylesXml) {
  const re = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>|<w:style\b[^>]*\bw:default="(?:1|true|on)"[^>]*>[\s\S]*?<\/w:style>/g;
  return Array.from(String(stylesXml).matchAll(re), (m) => m[0]);
}

/**
 * @param {{notes?:string}} [opts] the notes text, when the caller has it (the
 *   builder does): a name that is also a function word ("An") is then judged
 *   as the actions.json check judged it. Without it, such a word names nobody.
 */
function checkDocxBuffer(buf, name, opts) {
  const notesText = (opts && opts.notes) || null;
  const res = newResult(name, 'docx');
  let xml, stylesXml;
  try {
    const x = zipEntry(buf, 'word/document.xml');
    if (!x) return usage(res, name + ' has no word/document.xml');
    xml = x.toString('utf8');
    // A Buffer, or null where there is no styles.xml: String(null) holds no style.
    stylesXml = String(zipEntry(buf, 'word/styles.xml'));
    // Every XML part: the typeface is written into styles.xml as well.
    for (const e of zipDir(buf)) {
      if (!/\.(xml|rels)$/.test(e.name)) continue;
      const ch = forbiddenChar(zipEntry(buf, e.name).toString('utf8'));
      if (ch) V(res, 'xml.control', e.name + ' holds a control character (' + ch + '): Word refuses the file');
    }
  } catch (e) { return usage(res, 'could not read ' + name + ': ' + e.message); }

  // --- hard-fail 4 here too: a list read beside a kit that fails is refused,
  // as the builder refuses to build with one.
  kitVerdict(res);

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
  // Two tables are here, so there are paragraphs to match.
  const unsized = xml.match(PARA_RE).reduce((n, p) => n + runsOf(p).filter((r) => r.unsized).length, 0);
  if (unsized) V(res, 'layout.size', unsized + ' text run(s) carry no explicit size, so their width cannot be bounded');

  rows.slice(1).forEach((cells, i) => {
    const n = i + 1;
    if (cells.length !== LAYOUT.COLS.length) { V(res, 'layout.cells', 'row ' + n + ' has ' + cells.length + ' cells, expected ' + LAYOUT.COLS.length); return; }
    const text = (k) => cells[k].map((p) => p.text || '').join(' ').trim();
    const who = text(1);
    if (!who) V(res, 'owner.missing', 'row ' + n + ': the owner cell is empty', { action: n });
    else {
      // The rule checkModel applied, with the source cell's quote standing in for the span.
      const quote = text(4).replace(/^L\d+(?:-\d+)?\s+/, '');
      const capitals = /\p{Lu}/u.test(quote);
      const why = (wordsOf(who).length === 1 ? [who] : ownerParts(who))
        .map((p) => notAName(ownerAsWritten(quote, p) || p, notesText, capitals)).find(Boolean);
      if (why) V(res, 'owner.missing', 'row ' + n + ': the owner cell ("' + who + '") names nobody (' + why + ')', { action: n });
    }
    // The quote is the notes' own words, so it may hold quotation marks of its own.
    if (!/^L\d+(?:-\d+)?\s+".*\S.*"$/s.test(text(4))) V(res, 'source.missing', 'row ' + n + ': the source cell does not carry a line number and a quote', { action: n });
  });

  // --- the page bound, re-measured from the file -------------------------------
  const fontM = /<w:rFonts\s+w:ascii="([^"]+)"/.exec(xml);
  const face = faceTable(fontM ? fontM[1] : '');
  const bandRow = rowsOf(bandX)[0];
  // A band with no row would measure as no height at all, and pass.
  if (!bandRow) V(res, 'layout.band', 'the band table has no row: the title, organization and date are missing');
  const bandCols = gridOf(bandX);
  const layout = {
    face: face.NAME, font: fontM ? fontM[1] : '',
    band: { cols: bandCols, cells: bandRow || [] },
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

  // --- the builder's formatting (FORMAT, above), and its values -----------------
  const fonts = new Set();
  const fmt = formatErrors(xml, 'document.xml', fonts);
  for (const s of unnamedStyles(stylesXml)) fmt.push(...formatErrors(s, 'styles.xml', fonts));
  if (fonts.size > 1) fmt.push('runs set in ' + fonts.size + ' typefaces (' + [...fonts].join(', ') + '), where the builder sets one');
  const B = LAYOUT.BAND, C = LAYOUT.CELL;
  const pads = (v, hz) => ({ top: v, bottom: v, left: hz, right: hz });
  const cellsOf = (tblXml) => (tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) => tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []);
  const marginsIn = (where, tc, want) => {
    const mar = String(/<w:tcMar>[\s\S]*?<\/w:tcMar>/.exec(tc)); // "null" where the cell has none
    for (const side of Object.keys(want)) {
      const el = new RegExp('<w:' + side + '\\b([^>]*)/>').exec(mar);
      const tw = el && /w:type="dxa"/.test(el[1]) && /w:w="(\d+)"/.exec(el[1]);
      const got = tw ? parseInt(tw[1], 10) : NaN;
      if (got !== want[side]) fmt.push(where + ': ' + side + ' cell margin ' + (Number.isNaN(got) ? 'not set in twips' : got) + ', the builder\'s is ' + want[side]);
    }
  };
  cellsOf(bandX).forEach((tcs) => tcs.forEach((tc) => marginsIn('the band', tc, pads(B.PAD_V, B.PAD_H))));
  cellsOf(actX).forEach((tcs, r) => tcs.forEach((tc) => marginsIn(r ? 'action row ' + r : 'the header row', tc,
    pads(r ? C.PAD_V : LAYOUT.HEAD.PAD_V, C.PAD_H))));
  const spacingIs = (where, p, before, after) => {
    const s = String(/<w:spacing\b[^>]*\/>/.exec(p.xml)); // "null" where the paragraph has none
    const b = /w:before="(\d+)"/.exec(s), a = /w:after="(\d+)"/.exec(s);
    if (!b || !a || +b[1] !== before || +a[1] !== after) {
      fmt.push(where + ': paragraph spacing ' + (b ? b[1] : 'unset') + ' before, ' + (a ? a[1] : 'unset') + ' after; the builder\'s is ' + before + ', ' + after);
    }
  };
  for (const tbl of [bandX, actX]) for (const p of parasOf(tbl)) spacingIs(tbl === bandX ? 'the band' : 'the actions table', p, 0, 0);
  if (topParas.length === 2) {
    spacingIs('the count line', topParas[0], LAYOUT.COUNT_LINE.BEFORE, LAYOUT.COUNT_LINE.AFTER);
    spacingIs('the footer', topParas[1], LAYOUT.FOOT.BEFORE, LAYOUT.FOOT.AFTER);
  }
  if (fmt.length) {
    fmt.splice(0, fmt.length, ...new Set(fmt)); // one line per difference, not per cell
    V(res, 'layout.format', fmt.length + ' formatting difference' + (fmt.length === 1 ? '' : 's') + ' from the builder\'s: ' +
      fmt.slice(0, 6).join('; ') + (fmt.length > 6 ? '; and ' + (fmt.length - 6) + ' more' : '') +
      '. The page bound measures the layout the builder writes; rebuild the list from its actions.json rather than editing the .docx.');
  }

  const est = estimate(layout);
  res.estimate = est;
  if (est.total > est.budget) {
    V(res, 'page.overflow', 'estimated height ' + est.total + ' twips against a one-page budget of ' + est.budget +
      ' (' + Math.round((100 * est.total) / est.budget) + '%): this document does not fit one page');
  }

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
    ? 'FAIL — ' + res.violations.length + ' violation' + (res.violations.length === 1 ? '' : 's') +
      (res.mode === 'docx' ? ' in the built document.' : '. No document is written.')
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
  const N = brand.naming;
  const seg = model.segment !== undefined ? model.segment : N.defaultSegment;
  let topic = String(model.meeting).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('_');
  if (topic.length > 48) topic = topic.slice(0, 48).replace(/_[^_]*$/, '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(model.date || '').trim()) ? '_' + String(model.date).trim() : '';
  return [N.PREFIX, seg, topic].filter(Boolean).join('_') + '_ACTIONS' + date + '.docx';
}

module.exports = {
  SCHEMA_ID, LAYOUT, TABLES, faceTable, visible,
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
