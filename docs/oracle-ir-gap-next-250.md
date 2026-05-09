# Oracle IR Gap Next 250

Generated: 2026-05-08

Source command:

```powershell
npx tsx tools/oracle-ir-gap-audit.ts --top 250 --max-examples 5 --out $env:TEMP\mtgedh-oracle-ir-gap-next250.json
```

Current audit snapshot:

- Unique cards parsed: 29,800
- Cards with gaps: 4,671
- Gap records: 5,728
- Full report artifact: `$env:TEMP\mtgedh-oracle-ir-gap-next250.json`
- Ranking basis: current unresolved `unknown-step` / `unknown-fragment` records after the latest parser changes

The full report contains the top 250 records. The first 20 unresolved gaps are listed below as the immediate follow-up queue.

## Top 20

1. `[unknown-step; count 3]` Target player can't play lands this turn
2. `[unknown-step; count 3]` The second spell you cast each turn costs {1} less to cast
3. `[unknown-step; count 3]` This creature gets +1/-1 or -1/+1 until end of turn
4. `[unknown-step; count 3]` this permanent is the chosen color
5. `[unknown-step; count 3]` This spell can't be copied
6. `[unknown-step; count 3]` You can't cast more than one spell each turn
7. `[unknown-step; count 3]` You have no maximum hand size for the rest of the game
8. `[unknown-step; count 3]` Your opponents play with their hands revealed
9. `[unknown-step; count 2]` Blue creatures don't untap during their controllers' untap steps
10. `[unknown-step; count 2]` Choose a card name other than a basic land card name
11. `[unknown-step; count 2]` Creature cards you own that aren't on the battlefield have flash
12. `[unknown-step; count 2]` Creature spells with flying you cast cost {1} less to cast
13. `[unknown-step; count 2]` Creatures don't untap during their controllers' untap steps
14. `[unknown-step; count 2]` Creatures with power 3 or greater don't untap during their controllers' untap steps
15. `[unknown-step; count 2]` Creatures you control are the chosen type in addition to their other types
16. `[unknown-step; count 2]` Creatures you control have base power and toughness X/X until end of turn
17. `[unknown-step; count 2]` Damage that would be dealt by this creature can't be prevented
18. `[unknown-step; count 2]` double this permanent's power and toughness until end of turn
19. `[unknown-step; count 2]` Each opponent can't cast instant or sorcery spells during that player's next turn
20. `[unknown-step; count 2]` Each other player draws a card

## First Recommended Clusters

1. Static restriction metadata: play/cast limits, hand-size rules, revealed hands, flash permissions, untap locks, and cost reductions dominate the top gaps.
2. Characteristic and P/T variants: chosen color, alternate P/T choices, base P/T X/X, and power/toughness doubling form a compact parser family.
3. Chosen-name edge cases: `Choose a card name other than a basic land card name` remains after the broader chosen-name work and should be handled narrowly.
4. Reference draw/life amounts: repeated `for each ...` draw and life fragments are ready for `reference_amount` normalization and selective executor support.
5. Player-choice cleanup: each-player/each-opponent choice surfaces should be classified as explicit metadata or player-choice-required rather than generic unknowns.
