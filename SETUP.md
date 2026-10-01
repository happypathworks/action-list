# action-list — setup

A free skill that turns meeting notes into a one-page action list as a Word
document: owner, action, due date, and the line in the notes each action came
from. It builds in your organization's colors and logo when a brand kit is
present, and in neutral defaults when one is not.

## What's in the download

Two skills, each a `.skill` archive. A `.skill` file is a zip whose single
top-level folder is the skill.

    action-list.skill   installs as   action-list
    brand-kit.skill     installs as   brand-kit

`action-list` builds the document. `brand-kit` writes and validates the brand
kit, `brand.json` plus `logo.png`, that `action-list` reads. You need
`brand-kit` only to build in your own colors. Without a kit, action lists build
in neutral defaults, and that is a supported state rather than an error.

## What's in the action-list folder

    action-list/
      SKILL.md               the skill itself
      SETUP.md               this file
      LICENSE.txt            terms — this skill is free, under MIT; section 2
      package.json           metadata; declares no dependencies
      check_deps.js          preflight: files, the bundled library, and the
                             checker's verdict on both examples
      action_check.js        the checker: owners, sources, one page, brand kit
      build_action_list.js   the builder: writes nothing unless the checker passes
      brand_kit.js           the brand kit loader, shared with brand-kit
      brand_check.js         the brand kit validator, shared with brand-kit
      vendor/docx.cjs        the docx library, 9.7.1, MIT
      vendor/THIRD_PARTY_LICENSES.txt
      examples/roastery-weekly/   a clean list and its built .docx
      examples/unowned-action/    the deciding case: a list the checker refuses

Keep the folder whole. The scripts load each other from beside themselves.

## Requirements

Node 18 or later, and nothing else. There is no package to install: the one
library the builder uses, `docx`, ships inside the skill at `vendor/docx.cjs`,
and `check_deps.js` pins it by hash.

## Install

1. **Extract both archives** wherever your Claude surface keeps skills, each in
   its own folder. They do not need to share a parent.
   - Claude Code, for you on this machine: `~/.claude/skills/action-list/` and
     `~/.claude/skills/brand-kit/`
   - Claude Code, for one project: `PROJECT/.claude/skills/action-list/` and
     `PROJECT/.claude/skills/brand-kit/`
   - The claude.ai web app, Cowork and the desktop app: add each skill to your
     claude.ai account.

   Most systems have no handler for `.skill`. Rename it to `.zip` and use your
   usual archive tool, or point `unzip` or 7-Zip at it as it is. The `tar` in
   Git Bash is GNU tar and cannot read a zip; it fails with "This does not look
   like a tar archive".

2. **Run the preflight** where the skill will run:

       node action-list/check_deps.js

   Expected: `PASS` and exit 0. Besides the files and the bundled library, this
   runs the checker on both shipped examples and confirms it passes the clean
   list and refuses the one with unowned actions. A checker that disagrees
   with its own examples is not trusted to check yours.

3. **Set up a brand kit, or skip it.** Start a message with `brand:` to run the
   brand-kit intake. It asks for your logo, colors and naming, checks them
   with `brand_check.js`, and writes `brand.json` and `logo.png`. Keep the pair
   in the folder your work lives in, or in a folder above it. Where your
   environment keeps no folder between conversations, keep the two files and
   attach them together when you build.

4. **Build one.** Start a message with `actions:` and paste or attach the notes.

**What the install writes: the two skill folders, and nothing outside them.**
No global package, no shell profile, no change to your settings, nothing
fetched, no sign-in. Uninstalling is deleting the folders. A build writes
`notes.txt` (when the notes were pasted), `actions.json` and the `.docx`, all in
your working folder, never in a skill folder.

## Prove it end to end

From inside the `action-list` folder:

    cd examples/roastery-weekly
    node ../../build_action_list.js actions.json --kit .

Expected: two `PASS` reports, the first on the input and the second on the
built document, then `Replaced ...ROAST_OPS_Roastery_Operations_Weekly_ACTIONS_2026-04-23.docx`.
Open it: one page, six rows, each with its source line.

Then the refusal:

    cd ../unowned-action
    node ../../action_check.js actions.json --kit .

Expected: two `FAIL` lines and exit 1. The README in that folder explains both.

`--kit .` pins each example to the kit beside it, so your own kit does not
change what the example renders.

## Using it on your own notes

Start a message with `actions:` and paste or attach the notes. Plain text,
Markdown and Word (`.docx`) are read as they are. For a PDF or a scan, paste the
text instead; the quotes are checked against whatever file holds the notes, so
it has to be the notes.

Expect to be asked who owns anything the notes leave unowned. That question is
the skill working: it will not pick an owner for you, and it will not drop the
action. An owner you assign is marked on the page with an asterisk, so a
reader can tell it from one the meeting agreed.

`actions: check PATH` checks an existing `actions.json` or a built action list
and reports, without building anything.

## What the one-page check measures

A document's page count is decided by whatever renders it, so no file-level
check can know it for certain. This one bounds it instead. Every line is set at
an exact pitch, so line height does not depend on the typeface. Line widths are
measured against the widest advance of each character across thirteen common
document typefaces, regular and italic; a typeface outside that set is measured
against a wider table that adds four more. Word wrap is simulated from those
widths, with a word wider than its column broken by character. One line of the
page is held back.

Checked before release against LibreOffice: 195 renders across six typefaces
and four row shapes, and every list the checker accepted rendered as one page.
Where the simulated wrap matched, the measured height and the rendered height
agreed to within one pixel at 96 dpi. Microsoft Word has not been measured.

## Compatibility

**Every Claude surface.** Agent Skills run on Claude Code, in the claude.ai web
app, in Cowork and in the desktop app. This one is a `SKILL.md`, three
scripts, three shared files and a bundled library, with no build step and
nothing fetched. Where it runs, it needs Node 18 or later.

**Install location differs by surface, and the two do not sync.** A folder you
drop into `~/.claude/skills/` or `.claude/skills/` is local to Claude Code on
that machine. Skills added to your claude.ai account are the ones that reach the
web app, Cowork sessions, cloud sessions and routines. Installing one place does
not install the other, so put it wherever you actually work, or both. This is a
fact about where files live, not a limit on where the skill runs.

**Where it has been run.** Claude Code on Windows 11 with Node 24, and the
claude.ai web app. Cowork and the desktop app have not yet been exercised with
this skill.

## License

MIT. `LICENSE.txt` ships in every skill in this catalog and states two sets of
terms, because some of them are sold; its section 1 names this one as free, and
section 2 is the MIT text. That covers every file here, `brand_kit.js` and
`brand_check.js` included — they belong to `brand-kit`, which is free too.
`vendor/docx.cjs` is the docx library, third-party and MIT, with its notices in
`vendor/THIRD_PARTY_LICENSES.txt`.

Changes to this skill, and the next ones as they ship, go out on the list:
[happypathworks.beehiiv.com](https://happypathworks.beehiiv.com/subscribe?utm_source=action-list).
