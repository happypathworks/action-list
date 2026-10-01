# unowned-action — the deciding case

A planning meeting at an invented coffee roaster. The notes hold five
commitments. Two of them have no owner:

    7   - We still need someone to check whether the co-packer can run the holiday tins in October.
    9   - Someone should also update the wholesale price sheet with the holiday blend.

`actions.json` is what a base model extracts from these notes. It gives line 7
to Morgan, who chaired the meeting, and line 9 to "TBD". Both rows look
finished, and the first would print exactly like the rows whose owners the
notes name.

## The run

    node ../../action_check.js actions.json --kit .

```
action_check — actions.json (before build)
  brand: .../examples/unowned-action/brand.json (brand_check exit 0)
  page: 5720 of 14160 twips (40%), 5 action rows, standard width table

  FAIL  owner.unsourced  action 3 (notes line 7): owner "Morgan" is not named in the quoted source. If the notes name the owner nearby, widen the quote to include the name. If they do not, ask who owns it; set "ownerAssigned": true only on that answer.
  FAIL  owner.missing    action 5 (notes line 9): no owner ("TBD" names nobody). Ask who owns it; do not pick one.

FAIL — 2 violations. No document is written.
```

Exit 1. The builder runs the same check first, so it writes nothing either.

`owner.missing` is the obvious catch. `owner.unsourced` is the one this example
exists for: "Morgan" is a real person at the meeting, the row reads as
settled, and no one reviewing the page could tell it apart from "Ana" in row 1,
whom the notes do name.

## Resolved

The skill asks the user who owns lines 7 and 9, quoting them. The user answers
Ana and Jules. `actions-resolved.json` records those answers:

```json
{ "owner": "Ana", "ownerAssigned": true, ... "source": "We still need someone to check whether the co-packer can run the holiday tins in October" }
```

    node ../../action_check.js actions-resolved.json --kit .

Exit 0. On the built page, both owners carry an asterisk, and the footer says
what it means: assigned after the meeting, not named in the notes.
