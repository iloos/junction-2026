# Mandate design system (Kitchen, dock, Ops)

The binding rules for every judge-facing surface. Tokens live in `src/routes/layout.css`; this page says how to use them. If a screen breaks a rule here, the screen is wrong.

## Type and spacing
- Six sizes only: `text-display` 28, `title` 20, `heading` 15, `body` 14, `meta` 12.5, `micro` 11 (enforced by `src/lib/ui/type-scale.test.ts`). Body is the default; meta for the second line; micro only for chips.
- 8-pt spacing: `gap-2`/`p-2` (8), `gap-3` (12) inside a row, `gap-4`/`p-4` (16) between blocks, `gap-6` (24) between zones. Phone side gutter 16 px.
- Numbers (money, amounts, times) are `mono tabular-nums`, right-aligned in their own column. Never a number inside a sentence when it is the row's value.

## The row (`src/lib/ui/Row.svelte`)
Every list is rows: basket lines, bill lines, ledger entries, group subtotals, and the same rows in a dock card.
- Fixed tracks (`ROW_TRACKS`): **lead** 5rem (an amount "13 packs" or a time "21:40") · **text** (wraps, never truncates) · **value** 6rem (right-aligned, tabular) · **end** (a state chip or the row's actions). On a phone the end track drops under the text.
- `sub` is the quieter second line: what it is for, what it replaces. Product names wrap (`ProductToken wrap`).
- A group heading is a `Row head`: its label says the state once ("Waits on you · 15 lines") and its value is the subtotal in the same column as the rows' values. Rows under a heading carry no repeated chip.
- `flash` when the row just changed (the tint lands and fades); `muted` for what is not in force.

## Chips and states
- A chip is sized to its content, never truncated. One chip per row at most; if every row in a group would show the same chip, the group heading says it instead.
- State words are VOCABULARY's: Waits on you, Can order now, Approved not ordered, Ordered. Colours: signoff (waits on you), accent (can order), ok (ordered), out (cannot).

## Zones and actions
- One primary action per zone (filled accent); everything else is outlined or a text link.
- Long lists of names fold: a count with its reason on the row, the names on expand.
- No raw ids, op names or ISO dates outside the System layer.

## The home
The Kitchen opens on the kitchen's own week: what the agent did (ledger), the few decisions it needs (one row, one action each), what is coming. Seeded events are offered as examples, never as the page itself.
