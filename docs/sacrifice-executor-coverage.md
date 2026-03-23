# Sacrifice Executor Coverage Audit

Generated: 2026-03-23T09:31:19.252Z

## Summary

- Distinct sacrifice-related clauses scanned: 4979
- Deterministic or context-bound supported effect cards: 716
- Semantically understood but choice-required effect cards: 366
- Sample delayed cleanup follow-up clauses still needing timing-aware handling: 0
- Sample unsupported sacrifice clauses: 8
- Sample sacrifice clauses classified as additional-cost or keyword surfaces: 25

## Classification Notes

- `deterministicSupported`: the current parser/executor understands the selector shape and can execute it when context is bound.
- `choiceRequired`: the clause is semantically understood, but safe execution still requires a player or payment choice.
- `delayedCleanupFollowup`: the clause looks like a timing-qualified cleanup reference and should be handled by timing-aware delayed-trigger plumbing rather than immediate sacrifice execution.
- `unsupported`: the clause still falls outside the currently understood sacrifice selector space.

## Top Choice-Required Object Phrases

- `a creature of their choice`: 55
- `a land of their choice`: 15
- `two creatures of their choice`: 6
- `a creature or planeswalker of their choice`: 5
- `a permanent of their choice`: 5
- `it unless you pay {1}`: 5
- `it unless you return a non-lair land you control to its owner's hand`: 5
- `a nontoken creature of their choice`: 4
- `this creature`: 4
- `this creature unless you discard a card`: 4
- `this creature unless you pay {g}{g}`: 4
- `a permanent of their choice unless they pay {1}`: 3
- `an attacking creature of their choice`: 3
- `it unless it escaped`: 3
- `it unless you discard a card at random`: 3
- `it unless you discard a land card`: 3
- `this creature unless you pay {u}`: 3
- `this enchantment unless you pay {w}{w}`: 3
- `a creature of their choice with flying`: 2
- `a permanent of their choice for that player to ignore this effect until end of turn`: 2

## Top Delayed Cleanup Object Phrases


## Top Unsupported Object Phrases

- `it (the card, not your head`: 1
- `this artifact and put all cards exiled with it into their owners' hands`: 1
- `this creature after it enters`: 1
- `this creature and counter that spell or ability`: 1
- `this creature and create a 4/4 red giant bird creature token`: 1
- `this creature and it deals 3 damage to each creature and each player`: 1
- `this creature when your head stops touching the table`: 1
- `this enchantment and said player discards their complement of cards in hand (hereafter known as "hand"`: 1
