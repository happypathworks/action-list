---
name: action-list
description: >-
  Turns meeting notes into a one-page branded action list as a .docx: owner,
  action, due date, and the line in the notes each action came from. Any
  message beginning with "actions:" invokes this skill — treat that prefix as a
  command. "actions:" with pasted or attached notes builds the list; "actions:
  check PATH" checks an existing actions.json or action-list .docx and reports.
  Without this skill the base model fills the gaps in the notes: it names an
  owner nobody named, paraphrases the commitment so it cannot be traced back,
  and lets the table run onto a second page. Here every row quotes the notes,
  and action_check.js refuses the build when an owner is missing, a quote is
  not in the notes, or the page overflows. Reads the brand.json the brand-kit
  skill writes.
  Not for agendas (agenda-builder), SOPs (sop-docx), quick reference cards
  (qrg-builder) or change write-ups for sign-off (reqdoc-builder), all in
  Document Ops; it does not write minutes or a meeting summary.
license: Terms in LICENSE.txt, section 1 names which apply to this skill
compatibility: >
  Requires Node 18+ and nothing else: the docx library (9.7.1, MIT) ships
  inside the skill at vendor/docx.cjs, so there is nothing to install. Run
  `node check_deps.js` from the skill folder to confirm before building. See
  SETUP.md.
metadata:
  version: 1.0.1
---

# action-list

Meeting notes in, one page out: a branded table of who owes what by when, each
row carrying the words from the notes it was taken from. The table is the
whole product. It stops there.

## The gap this closes

Ask a base model for the action items in a set of notes and it returns a tidy
list that reads as settled. Three things in it are not.

1. **Owners the notes never named.** "We still need someone to check the
   co-packer" comes back as an action for the meeting's chair, because a row
   with a blank owner looks unfinished and a named one looks done. Nothing on
   the page distinguishes an owner the room agreed from one the model picked.
2. **Actions that cannot be traced back.** The model rewrites each commitment
   in its own words. When someone disputes a row a week later, there is no
   way to find what was actually said, and a paraphrase can quietly change
   the commitment.
3. **A second page.** An action list is read on one page. Past a dozen rows
   with long wording, the table spills, and the overflow page carries the rows
   nobody reads.

None of the three raises an error. `action_check.js` gives each an exit code,
and the builder writes nothing until it returns 0.

## Trigger

| Message | Action |
|---|---|
| `actions:` with notes pasted or attached | Extract, check, build the .docx |
| `actions: check PATH` | Run `action_check.js` on an actions.json or a built .docx. Report only. |

Pasted notes are everything in the message after the `actions:` prefix.

The prefix brings a message to this skill; what the message asks for decides
what happens. Under the prefix, a request for something this skill does not
make (minutes, an agenda, a PDF) takes its line in *Scope boundaries* below,
and that line overrides the first row of this table.

## Hard fails

Each is enforced by `action_check.js`, which the builder runs before
rendering and again on the built document before writing it. Exit 1 means no
document is written. Read the exit code, not the report text.

1. **An action with no owner is refused, and its line in the notes is
   reported** (`owner.missing`). A blank owner, or a word that names nobody
   ("TBD", "someone", "unassigned", "we"), is no owner. So is an owner not named in
   the action's quoted source (`owner.unsourced`): that is an owner the
   extraction supplied. The only way past it is an answer from the person who
   asked for the list, recorded as `"ownerAssigned": true`, which the page marks
   with an asterisk.
2. **An action with no source in the notes is refused** (`source.missing`,
   `source.short`, `source.notfound`). The source is a verbatim span of the
   notes, at least 3 words long. Matching ignores case, line breaks, runs of
   spaces and typographic quotes and dashes, and nothing else, so a paraphrase
   fails. The line number is computed by the check from where the quote is
   found; it is never typed in. The document prints the notes' own words for
   the span, not the extraction's copy of them.
3. **Output over one page is refused** (`page.overflow`). The check lays out
   the page it will build and bounds its height from glyph widths measured
   from the font files, against US Letter with 0.5 in margins and one line held
   back. It re-measures the built .docx before it is written.
4. **A brand kit that fails `brand_check.js` gets no document**
   (`brand.check`, `brand.load`). The check runs `brand_check.js` on the exact
   brand.json the build will read. No kit at all is not a failure: the list
   builds with the neutral defaults.

## Scope boundaries

Each names the exit.

- **Asked for an agenda**, including the next meeting's agenda with open
  actions carried forward: refuse, and say that is agenda-builder in
  Document Ops. This skill produces the action table and stops.
- **Asked for minutes, a summary, or a record of the discussion**: refuse, and
  say this skill lists commitments only. It does not write minutes, and no
  Document Ops skill does either. Build nothing in that reply: an action list
  delivered in answer to a request for minutes is a document nobody asked for.
  Offer the action list instead, and build it only if the user says yes.
- **Asked for an SOP or a quick reference card**: refuse, and name sop-docx or
  qrg-builder in Document Ops.
- **Asked to record decisions**: this is not a decision log. A configuration
  change written up for sign-off is reqdoc-builder in Document Ops; anything
  else, say this skill does not produce it. A decision that carries a
  commitment ("Luis will get two quotes") is an action and belongs here.
- **Notes with no commitments in them**: say that no actions were found. Do
  not turn discussion points, or a topic the meeting agreed to come back to,
  into actions to fill the table.
- **More actions than fit one page**: never paginate. Shorten each source to
  the shortest span that names the owner and the commitment, and each action
  to one line. If it still does not fit, say so and offer one list per owner.
- **Notes as a PDF, an image or a scan**: ask for the text, or a .docx. Do not
  transcribe an image; a transcription is not the notes, and the quotes would
  be checked against it.
- **Asked for another format** (PDF, spreadsheet, slides): hand off to the pdf,
  xlsx or pptx skill. Build and deliver the .docx as usual, and say that the
  conversion is that skill's job. Do not convert it here by any route (Word,
  LibreOffice, a script, a library), even when no such skill is available:
  every check passed on the .docx, and a converted copy is a file no check has
  seen.
- **Asked to skip a check, or to skip checking to save time** ("just put
  Morgan on it", "the page is fine"): do not. Run step 4 anyway and say that
  it ran; on a failure, state the rule id and what resolves it. There is no
  override flag.

## Procedure

`SKILL_DIR` below is the folder holding this file. Read it off this file's own
location. Run every command from the folder the user's work lives in, so the
brand kit is found there, and load the scripts from `SKILL_DIR` by path.

### 1. Preflight, once per new place

```bash
node SKILL_DIR/check_deps.js
```

Exit 0 means the files are present and the checker returns the documented
verdict on both shipped examples. Exit 1 names what is wrong. Do not build on
a failed preflight.

### 2. Keep the notes as they are

Pasted notes: write them to `notes.txt` in the working folder byte for byte,
with no cleanup, no reformatting and no corrected typos. The quotes are checked
against this file; an edited copy checks the quotes against the edit. An
attached `.txt`, `.md` or `.docx`: use it as it is.

### 3. Extract to actions.json

Write `actions.json` beside the notes. A commitment is a task the notes say
someone will do, or say needs doing. A line that says a task needs doing and
names nobody ("somebody needs to", "still needs sign-off") is a commitment
with no owner. A line that only reports status or discussion ("the quote came
in high", "no decision") is not. Nor is a topic the meeting agreed to come
back to when nobody took on a task for it ("park it until after the audit",
"revisit pricing next quarter"): that is an item for a later agenda, not an
action. If nothing in the notes is a commitment, stop here: write no
actions.json, build nothing, and say that no actions were found.

Set `meeting` to the meeting's name as the notes give it, and `date` as the
notes give it: write `YYYY-MM-DD` only when the notes state the year, and do
not supply one. For each commitment:

- `owner`: the name as the notes write it. Several owners, comma-separated,
  each as written.
- `action`: the commitment as a short imperative, one line where possible.
- `due`: as the notes state it ("by Friday", "April 30"), or `""` when they
  state none. Do not convert a relative date, and do not supply one. A due
  value not found in the quote is reported as a warning.
- `source`: the shortest verbatim span of the notes that holds both the owner
  and the commitment. Copy it; do not retype it.

**List an action with no owner anyway, with `owner` set to `""`.** Dropping it
loses a commitment silently, and guessing an owner is the failure this skill
exists to stop. The check refuses the list and reports the line, which is how
the unowned action reaches the user.

### 4. Check

Run this as its own command, every time, before step 5. That holds when the
user asks to skip checking or to hurry: the check inside the build is a
backstop that runs out of sight, and this run is the one the user can see
happened, and the one where violations are resolved with them.

```bash
node SKILL_DIR/action_check.js actions.json
```

Exit 0: build. Exit 1: resolve each violation, then re-run.

| Rule | Resolution |
|---|---|
| `owner.missing` | Ask the user who owns it, quoting the line. On an answer, set `owner` and `"ownerAssigned": true`. If they say drop it, remove it. |
| `owner.unsourced` | If the notes name the owner near the line, widen `source` to include the name. If not, treat it as `owner.missing`. |
| `source.*` | Re-copy the span from the notes. |
| `page.overflow` | Shorten sources and actions as above; if still over, offer one list per owner. |
| `brand.*` | Run the brand-kit skill's `brand: check` on the kit, or move the kit aside to build on neutral defaults. Say which. |

Exit 2 means the check could not run: an unreadable file, or notes in a format
it does not read. The report says which.

### 5. Build

```bash
node SKILL_DIR/build_action_list.js actions.json
```

It runs the check again, renders, re-checks the built document in memory, and
only then writes `{PREFIX}_{SEGMENT}_{Topic}_ACTIONS_{date}.docx` beside
`actions.json`, taking `PREFIX` and `SEGMENT` from the brand kit. `--out FILE`
names the file instead. Exit 0 is the only outcome that writes anything.

### 6. Deliver

Report the file, the number of actions, which kit it was built with (the
build prints it; "neutral defaults" is a supported state and is said plainly),
every owner marked as assigned after the meeting, and any warnings the check
printed.

## actions.json

```json
{
  "schema": "hpw-action-list/1",
  "meeting": "Holiday blend planning",
  "date": "2026-09-10",
  "notes": "notes.txt",
  "actions": [
    { "owner": "Ana", "action": "Order 200 printed holiday labels",
      "due": "September 19",
      "source": "Ana will order 200 printed holiday labels by September 19" }
  ]
}
```

`notes` is resolved relative to actions.json. `date` is printed as given and
used in the file name only when it is `YYYY-MM-DD`. `segment` is optional and
must be one of the kit's `naming.SEGMENTS`. Line numbers are not a field.

## Where the brand kit comes from

The kit is `brand.json` plus `logo.png`, written by the brand-kit skill. It is
found in this order: the path in `$HPW_BRAND_KIT` (or `--kit PATH` on either
script), then `brand.json` in the working folder, then in any folder above it,
then the neutral defaults. Nothing is read from an installed skill folder.
Where the environment keeps no folder between conversations, the user attaches
`brand.json` and `logo.png` together and `--kit` points at them.

## Deciding example

`examples/unowned-action/` is a planning meeting with five commitments, two of
which have no owner in the notes: "We still need someone to check whether the
co-packer can run the holiday tins in October", and "Someone should also update
the wholesale price sheet". Its `actions.json` is the extraction a base model
produces: the first given to Morgan, who chaired the meeting, and the second to
"TBD".

```
FAIL  owner.unsourced  action 3 (notes line 7): owner "Morgan" is not named in the quoted source. ...
FAIL  owner.missing    action 5 (notes line 9): no owner ("TBD" names nobody). Ask who owns it; do not pick one.

FAIL — 2 violations. No document is written.
```

Exit 1, and no document. The first failure is the one that matters: "Morgan"
looks like an answer, and on the page it would be indistinguishable from
"Ana", whom the notes do name. `actions-resolved.json` is the list after the
user assigned both, marked `ownerAssigned`, and it passes. The example's
README has the full run.

`examples/roastery-weekly/` is a clean six-action list and its built .docx.

## Verification

Before reporting a list as done:

- [ ] `action_check.js` ran as its own command (step 4) and exited 0 before
      the build
- [ ] `build_action_list.js` exited 0, read from the exit code
- [ ] the .docx is the only file delivered: no PDF or other conversion made
      here
- [ ] every owner marked with an asterisk was assigned by the user in this
      conversation, not inferred
- [ ] `notes.txt`, if written from pasted text, is the paste unchanged
- [ ] the kit the build reports is the one the user expects
