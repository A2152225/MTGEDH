# Oracle IR Gap Backlog

Refreshed from `tools/oracle-ir-gap-audit.ts` against `oracle-cards.json` and `AtomicCards.json`.

## Current Audit Snapshot

- Unique cards parsed: 29,971
- Cards with gaps: 188
- Gap records: 207
- Report artifact: `tools/oracle-ir-gap-audit.json`

## Completed In This Pass (batch 42)

The following high-frequency seams were implemented and dropped out of the refreshed top-gap list:

1. Gift promise rider `draw a card before its other effects`
2. Quoted static grants like `Other blue creatures you control have "Whenever…"`
3. Orphan `Visit —` attraction headers before `choose_mode`
4. `You draw two cards, lose 2 life` comma compounds
5. `Target player discards X cards at random`
6. `Teamwork N (...)` additional-cost reminder text
7. `While each one is exiled, its owner may cast it for {2}...` impulse riders
8. `You gain N life for each creature tapped this way`
9. Reveal-or-pay additional cost tails misparsed as `pay_mana.who`

Validation completed:

1. `npx vitest run test/oracleIRGapBatch42.test.ts`

## Next Ranked Todo

1. `You may choose new targets for the copy`: 100
2. `Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)`: 99
3. `This ability triggers only once each turn`: 96
4. `It's an artifact with "{2}, Sacrifice this token: Draw a card.")`: 95
5. `This Vehicle becomes an artifact creature until end of turn.)`: 94
6. `It's still a land`: 86
7. `This spell can't be countered`: 86
8. `Put the rest on the bottom of your library in a random order`: 75
9. `then give each another counter of each kind already there.)`: 68
10. `When you do, cast it for its madness cost or put it into your graveyard.)`: 59
11. `As an additional cost to cast this spell, sacrifice a creature`: 53
12. `then put any number of them on the bottom and the rest on top in any order.)`: 49
13. `Choose one or both -`: 48
14. `Enchanted creature doesn't untap during its controller's untap step`: 46
15. `that much` fragment: 44
16. `then shuffle.)`: 44
17. `You may look at the top card of your library any time`: 44
18. `Look at the top three cards of your library`: 42
19. `This artifact enters tapped`: 42
20. `You may choose new targets for the copies`: 42

## Notes

The audit filter was tightened in this pass to exclude reminder-keyword noise, `This land enters tapped`, `Partner (...)`, `Changeling (...)`, and plain `This creature can't block`, which are already handled elsewhere or are not actionable Oracle IR execution gaps.