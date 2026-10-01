#!/usr/bin/env node
'use strict';
/*
 * build_action_list.js — renders an actions.json to a one-page branded .docx.
 *
 * Nothing reaches the disk unless two checks pass: action_check.js on the
 * input, before anything is rendered, and action_check.js again on the built
 * document, in memory, before it is written. A refused build writes no file,
 * so there is no half-good document left behind for anyone to send.
 *
 * The layout is not decided here. It comes from action_check.js, which
 * measured it, so the page that passed the bound is the page that is built.
 *
 * Usage (run from the folder the work lives in, so the brand kit resolves):
 *   node <skill-dir>/build_action_list.js actions.json [--out FILE.docx] [--kit PATH]
 *
 * Exit codes:
 *   0  written
 *   1  refused by a check; nothing written
 *   2  usage error, or an input that could not be read; nothing written
 */

const fs = require('fs');
const path = require('path');

function usage(msg) {
  if (msg) process.stderr.write('build_action_list: ' + msg + '\n');
  process.stderr.write('usage: node build_action_list.js <actions.json> [--out FILE.docx] [--kit PATH]\n');
  process.exit(2);
}

const argv = process.argv.slice(2);
let out = null, kit = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i] || usage('--out needs a file name');
  else if (argv[i] === '--kit') kit = argv[++i] || usage('--kit needs a path');
  else if (argv[i] === '-h' || argv[i] === '--help') usage();
  else pos.push(argv[i]);
}
if (pos.length !== 1 || path.extname(pos[0]).toLowerCase() !== '.json') usage();
// Before anything resolves the kit: the check and the loader below both read
// it, and they must read the same one.
if (kit) process.env.HPW_BRAND_KIT = path.resolve(kit);

const AC = require('./action_check.js');
const file = path.resolve(pos[0]);

const pre = AC.checkModel(file);
console.log(AC.report(pre));
if (pre.exitCode !== 0) {
  console.log('Nothing written.');
  process.exit(pre.exitCode);
}

const BRAND = require('./brand_kit.js').load();
if ((BRAND._configPath || null) !== (pre.brand.configPath || null)) {
  console.log('The brand kit the check read (' + pre.brand.configPath + ') is not the one the build loaded (' +
    BRAND._configPath + '). Nothing written.');
  process.exit(2);
}

const docx = require('./vendor/docx.cjs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  WidthType, AlignmentType, TableLayoutType, LineRuleType, BorderStyle,
  ShadingType, VerticalAlign,
} = docx;
const { LAYOUT } = AC;
const L = pre.layout;
const FONT = (BRAND.type && BRAND.type.FONT) || 'Arial';
const ORG = (BRAND.org && (BRAND.org.shortName || BRAND.org.name)) || '';

// --- the primitives this builder needs -------------------------------------
// Inlined rather than taken from the document pack's sop_helpers.js, so every
// file in this skill ships under this skill's own terms. There is nothing to
// keep in step: this page is one table of text, and the geometry it is laid
// out against lives in action_check.js, which measured it.
const WHITE = 'FFFFFF';
const DARK = '212121';   // body text
const MID = '555555';    // secondary text
const ACCENT = BRAND.palette.ACCENT;     // brand slot — the header band
const DACCENT = BRAND.palette.DACCENT;   // brand slot — the table header row
const LACCENT = BRAND.palette.LACCENT;   // brand slot — the row rules

/** No border, as a per-side value or a whole-table set. */
const B0 = { style: BorderStyle.NONE, size: 0, color: WHITE };
const nb = { top: B0, bottom: B0, left: B0, right: B0, insideHorizontal: B0, insideVertical: B0 };
/** The same 0.5pt rule on all four sides. `size` is eighths of a point. */
const allB = (color) => {
  const side = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: side, bottom: side, left: side, right: side };
};
/**
 * A table cell. `width` MUST match this column's entry in the parent table's
 * columnWidths, or the column silently reflows and the page bound is measuring
 * a layout the renderer is not using.
 */
const cell = (children, width, o = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  children,
  // ShadingType.CLEAR, always: SOLID renders black whatever the fill says.
  ...(o.bg ? { shading: { type: ShadingType.CLEAR, fill: o.bg, color: 'auto' } } : {}),
  ...(o.borders ? { borders: o.borders } : {}),
  ...(o.margins ? { margins: o.margins } : {}),
  ...(o.va === 'center' ? { verticalAlign: VerticalAlign.CENTER } : {}),
});

/** One laid-out paragraph, at the exact pitch the bound measured. */
function mkPara(p, color, align) {
  return new Paragraph({
    children: p.runs.map((r) => new TextRun({
      text: r.t, bold: !!r.b, italics: !!r.i, size: r.sz, font: FONT,
      color: r.role === 'muted' ? MID : color,
    })),
    spacing: { before: p.before || 0, after: p.after || 0, line: p.pitch, lineRule: LineRuleType.EXACT },
    ...(align ? { alignment: align } : {}),
  });
}

function logoPara(logo) {
  // Auto line height here, not exact: an exact pitch would clip the image.
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new ImageRun({
      type: 'png',
      data: fs.readFileSync(logo.file),
      transformation: { width: logo.pxW, height: logo.pxH },
      altText: { title: ORG, description: ORG + ' logo', name: 'OrgLogo' },
    })],
  });
}

// --- the band: brand fill, title, meeting, organization, date ---------------
const B = LAYOUT.BAND;
const lastBand = L.band.cells.length - 1;
const band = new Table({
  width: { size: LAYOUT.CONTENT_W, type: WidthType.DXA },
  columnWidths: L.band.cols,
  layout: TableLayoutType.FIXED,
  borders: nb,
  rows: [new TableRow({
    cantSplit: true,
    children: L.band.cells.map((paras, k) => cell(
      paras.map((p) => (p.imageH ? logoPara(L.logo) : mkPara(p, WHITE, k === lastBand ? AlignmentType.RIGHT : undefined))),
      L.band.cols[k],
      { bg: ACCENT, borders: allB(ACCENT), margins: { top: B.PAD_V, bottom: B.PAD_V, left: B.PAD_H, right: B.PAD_H }, va: 'center' },
    )),
  })],
});

// --- the actions table ----------------------------------------------------------
const C = LAYOUT.CELL;
const head = new TableRow({
  tableHeader: true,
  cantSplit: true,
  children: L.head.map((paras, k) => cell(
    paras.map((p) => mkPara(p, WHITE)),
    LAYOUT.COLS[k].w,
    // No borders: the fill is the edge. Word runs a cell's side borders on down
    // through the next row's top padding, so bordered header cells printed dark
    // stubs into the first action row (Decision 181).
    { bg: DACCENT, borders: { top: B0, bottom: B0, left: B0, right: B0 }, margins: { top: LAYOUT.HEAD.PAD_V, bottom: LAYOUT.HEAD.PAD_V, left: C.PAD_H, right: C.PAD_H }, va: 'center' },
  )),
});
const rows = L.rows.map((cells) => new TableRow({
  cantSplit: true,
  children: cells.map((paras, k) => cell(
    paras.map((p) => mkPara(p, DARK)),
    LAYOUT.COLS[k].w,
    { borders: allB(LACCENT), margins: { top: C.PAD_V, bottom: C.PAD_V, left: C.PAD_H, right: C.PAD_H } },
  )),
}));
const actions = new Table({
  width: { size: LAYOUT.CONTENT_W, type: WidthType.DXA },
  columnWidths: LAYOUT.COLS.map((c) => c.w),
  layout: TableLayoutType.FIXED,
  rows: [head].concat(rows),
});

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: LAYOUT.SIZE.BODY } } } },
  sections: [{
    properties: {
      page: {
        size: { width: LAYOUT.PAGE_W, height: LAYOUT.PAGE_H },
        margin: { top: LAYOUT.MARGIN, bottom: LAYOUT.MARGIN, left: LAYOUT.MARGIN, right: LAYOUT.MARGIN },
      },
    },
    // The footer paragraph closes the body. Word needs a paragraph after a
    // table at the end of a document; without one it adds an empty one, and
    // on a full page that empty paragraph is a second page.
    children: [band, mkPara(L.meta, MID), actions, mkPara(L.foot, MID)],
  }],
});

const target = out ? path.resolve(out) : path.join(path.dirname(file), AC.outputName(pre.model, BRAND));

Packer.toBuffer(doc).then((buf) => {
  const post = AC.checkDocxBuffer(buf, path.basename(target));
  console.log('');
  console.log(AC.report(post));
  if (post.exitCode !== 0) {
    console.log('Nothing written.');
    process.exit(post.exitCode);
  }
  const existed = fs.existsSync(target);
  fs.writeFileSync(target, buf);
  console.log('');
  console.log((existed ? 'Replaced ' : 'Wrote ') + target);
  console.log('  ' + pre.model.actions.length + ' actions; brand ' +
    (BRAND._source === 'config' ? BRAND._configPath : 'neutral defaults (no brand.json found)'));
}).catch((e) => {
  console.error('build_action_list: the document could not be rendered: ' + e.message);
  console.log('Nothing written.');
  process.exit(2);
});
