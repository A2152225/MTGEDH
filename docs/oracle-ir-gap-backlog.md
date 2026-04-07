# Oracle IR Gap Backlog

Refreshed from `tools/oracle-ir-gap-audit.ts` against `oracle-cards.json` and `AtomicCards.json`.

## Current Audit Snapshot

- Unique cards parsed: 29,539
- Cards with gaps: 12,742
- Gap records: 17,121
- Report artifact: `tools/oracle-ir-gap-audit.json`

## Completed In This Pass

The following high-frequency seams were implemented and dropped out of the refreshed top-gap list:

1. `then shuffle`
2. `Add one mana of any color`
3. `Tap target creature`
4. `Untap that creature`
5. `Search your library for a basic land card, put it onto the battlefield tapped, then shuffle`
6. `its power` damage fragments
7. `you get {E}{E} (two energy counters)`
8. static-number `look at the top N ... put a matching card into hand/exile ... put the rest on the bottom in a random order`
9. `Counter target spell`
10. `Target opponent reveals their hand`
11. `Counter target spell unless its controller pays {N}`
12. controller-scoped plural creature buffs like `Creatures you control get +1/+1 until end of turn`
13. suspend-style `remove a time counter`
14. reminder-only `Unearth only as a sorcery.)`
15. targeted discard-card wording like `That player discards that card`
16. reminder-only `Turn it face up any time for its mana cost if it's a creature card.)`
17. reminder-only `Cast it on a later turn for its foretell cost.)`
18. standalone activated-ability restriction tails like `Activate only once each turn`
19. standalone combat requirement text like `This creature attacks each combat if able` when combat control already enforces it elsewhere
20. scry reminder fragments like `Look at the top card of your library` / `You may put that card on the bottom.)`
21. `Target creature can't block this turn`

Validation completed:

1. `npm run typecheck --workspace=rules-engine`
2. `npx vitest run test/oracleIRParser.test.ts test/oracleIRExecutor.test.ts`

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