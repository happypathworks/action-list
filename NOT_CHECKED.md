# What no tool checks

`action_check.js` checks the actions.json and the built .docx: owners, quotes,
the page, the brand kit. It never sees the request, so the rules below, quoted
from SKILL.md, are ones no tool can check: which requests the skill refuses or
hands on, what in the notes counts as an action, and whether the steps ran in
order. They are listed here so a passing check is never read as covering them:
for these, read the reply itself against SKILL.md. One section is not a
SKILL.md rule: "A built list edited by hand" names what `action_check.js`
itself does not measure.

## Requests the skill refuses or hands on

- **Asked for an agenda**, including the next meeting's agenda with open actions carried forward: refuse, and say that is agenda-builder in Document Ops.
- **Asked for minutes, a summary, or a record of the discussion**: refuse, and say this skill lists commitments only.
- **Asked for an SOP or a quick reference card**: refuse, and name sop-docx or qrg-builder in Document Ops.
- **Asked for another format**: the .docx is still what is built. "Do not convert it here by any route (Word, LibreOffice, a script, a library), even when no such skill is available: every check passed on the .docx, and a converted copy is a file no check has seen."
- **Notes as a PDF, an image or a scan**: "Do not transcribe an image; a transcription is not the notes, and the quotes would be checked against it."

## What counts as an action

- **Notes with no commitments in them**: "Do not turn discussion points, or a topic the meeting agreed to come back to, into actions to fill the table."

## A built list edited by hand

- **Line breaks or tabs added inside a cell after the build**: `actions: check` on a .docx re-measures the page from its text and the builder's formatting, and it reads a hand-typed line break (Shift+Enter) or tab as a space. A list edited that way can check as one page and print on two. Open an edited file in Word to see its page count, or rebuild it from the actions.json.

## Whether the steps ran in order

- **Asked to skip a check, or to skip checking to save time** ("just put Morgan on it", "the page is fine"): do not. The build checks again whatever happens; what no tool sees is whether step 4 ran as its own command, where the user can see it.
- **The preflight**: "Do not build on a failed preflight." The builder runs `action_check.js`, not `check_deps.js`, so nothing stops a build after a failed preflight.
