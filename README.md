# action-list

A Claude skill that turns meeting notes into a one-page action list as a Word
document: owner, action, due date, and the line in the notes each action came
from. It builds in your organization's colors and logo when a brand kit is
present, and in neutral defaults when one is not.

Product page, with a sample list: https://happypath.works/free/action-list/ — from [Happy Path Works](https://happypath.works/).

Free, MIT. Node 18 or later, and nothing to install: the one library it uses
ships inside the skill.

## The gap it closes

Ask a model for the action items in a set of notes and it returns a tidy list
that reads as settled. Three things in it are not.

1. **Owners the notes never named.** "We still need someone to check the
   co-packer" comes back as an action for the meeting's chair, because a row
   with a blank owner looks unfinished and a named one looks done.
2. **Actions that cannot be traced back.** Each commitment is rewritten in the
   model's own words. When someone disputes a row a week later, there is no way
   to find what was actually said.
3. **A second page.** Past a dozen rows with long wording, the table spills,
   and the overflow page carries the rows nobody reads.

None of the three raises an error. `action_check.js` gives each one an exit
code, and the builder writes nothing until it returns 0.

## What it refuses

- **An action with no owner.** A blank owner, "TBD", "someone" or "we" is no
  owner, and neither is a name the quoted line does not contain. The skill asks
  who owns it, quoting the line. An owner you assign is marked on the page with
  an asterisk, so a reader can tell it from one the meeting agreed.
- **An action with no source in the notes.** Every row carries a verbatim span
  of the notes, at least three words. A paraphrase fails.
- **A second page.** The check lays out the page before building and measures
  the built document again before writing it.
- **A brand kit that fails its own check.** No kit at all is fine: the list
  builds in neutral defaults.

There is no override flag. Asked to skip the check to save time, it runs the
check anyway and says so.

## Deciding example

`examples/unowned-action/` is a planning meeting with five commitments, two of
which have no owner in the notes. Its `actions.json` is what a model produces
unaided: the first given to the meeting's chair, the second to "TBD".

```
FAIL  owner.unsourced  action 3 (notes line 7): owner "Morgan" is not named in the quoted source. ...
FAIL  owner.missing    action 5 (notes line 9): no owner ("TBD" names nobody). Ask who owns it; do not pick one.

FAIL — 2 violations. No document is written.
```

Exit 1, and no document. `examples/roastery-weekly/` is a clean six-action
list and the one-page .docx it builds.

## Install

The packaged download, this skill and `brand-kit` as two `.skill` files in
one zip, is free on Gumroad:
[happypathworks.gumroad.com/l/action-list](https://happypathworks.gumroad.com/l/action-list).
Or use this repository as it is:

Put the whole folder where your Claude surface keeps skills, as
`action-list/`:

- Claude Code, for you on this machine: `~/.claude/skills/action-list/`
- Claude Code, for one project: `PROJECT/.claude/skills/action-list/`
- The claude.ai web app, Cowork and the desktop app: zip the folder and add it
  to your claude.ai account as a skill.

Then run the preflight where the skill will run:

    node action-list/check_deps.js

Expected: `PASS` and exit 0. It checks the files, pins the bundled library by
hash, and runs the checker on both examples. A checker that disagrees with its
own examples is not trusted to check yours.

To build in your own colors, add its companion skill `brand-kit`, which writes
and validates the brand kit this one reads. Without it, lists build in neutral
defaults, and that is a supported state rather than an error.

`SETUP.md` has the rest: what each file is, how to prove the build end to end,
and what the one-page check measures.

## Use

Start a message with `actions:` and paste or attach the notes. Plain text,
Markdown and Word are read as they are.

`actions: check PATH` checks an existing `actions.json` or a built action list
and reports, without building anything.

## What it does not do

It lists commitments and stops. It does not write minutes, a summary, or the
next meeting's agenda, and it does not convert its output to PDF. Asked for
any of those, it says so instead of producing something nobody checked.

## License

MIT. `LICENSE.txt` states two sets of terms because it ships unchanged in every
skill in the catalog, some of which are sold; its section 1 names this one as
free, and section 2 is the MIT text. `vendor/docx.cjs` is the third-party docx
library, also MIT, with its notices in `vendor/THIRD_PARTY_LICENSES.txt`.

## Who makes this

Happy Path Works builds Claude skills as systems: explicit triggers, enforced
hard-fails, stated scope boundaries, a worked example per skill.

Changes to this skill, and the next ones as they ship, go out on the list:
[happypathworks.beehiiv.com](https://happypathworks.beehiiv.com/subscribe?utm_source=action-list).

Questions and bug reports: hello@happypath.works

## Independence and AI assistance

Happy Path Works is an independent project. It is **not affiliated with,
endorsed by, or sponsored by Anthropic**. Claude, Claude Code and Anthropic are
trademarks of Anthropic PBC, used here only to describe what this skill works
with. You need your own Claude access; nothing here resells it.

This skill and its documentation are developed with AI assistance, and a human
reviews everything before it ships.
