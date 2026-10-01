# roastery-weekly — a clean list

A weekly operations meeting at an invented coffee roaster. The notes hold six
commitments among discussion that is not one: a filter "changed on schedule. No
action", and a supplier "Decision deferred to next meeting". Neither becomes a
row.

| File | What it is |
|---|---|
| `notes.txt` | The meeting notes, as written |
| `actions.json` | The extraction: six actions, each quoting the notes |
| `brand.json` | The fixture kit, pinned with `--kit .` |
| `ROAST_OPS_Roastery_Operations_Weekly_ACTIONS_2026-04-23.docx` | The built list |

Build it:

    node ../../build_action_list.js actions.json --kit .

Two `PASS` reports, one on the input and one on the built document, then the
file is replaced. Check the built file on its own:

    node ../../action_check.js ROAST_OPS_Roastery_Operations_Weekly_ACTIONS_2026-04-23.docx --kit .

Things worth noticing:

- **Two owners on one action.** "Priya and Theo will put together the
  onboarding kit" is one row with owner `Priya, Theo`. The check requires
  each name to be in the quote.
- **No due date stated.** "Theo to send the updated price list" gives none, so
  `due` is empty and the page prints *Not stated*. The extraction does not
  supply one.
- **Due dates as the notes say them.** "before the next meeting" stays as
  written. Converting it to a date would be an inference the notes do not
  make.

## Break it on purpose

Each of these makes the check exit 1 and the build write nothing:

- Change action 1's `owner` to `""`: `owner.missing`, reported with notes line 6.
- Change action 1's `owner` to `Luis`: `owner.unsourced`, because the quote
  names Dana.
- Change a `source` to a paraphrase, such as `"Dana is reordering the Huila"`:
  `source.notfound`.
- Copy the action rows until there are thirty: `page.overflow`, with the
  estimated height and the budget.
