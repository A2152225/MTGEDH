# Sacrifice Executor Coverage Audit

Generated: 2026-03-23T02:32:49.666Z

## Summary

- Distinct sacrifice-related clauses scanned: 4979
- Supported effect cards matching the current sacrifice executor shape: 161
- Sample supported effect clauses captured: 25
- Sample effect clauses that still imply player choice or executor gaps: 50
- Sample sacrifice clauses classified as additional-cost or keyword surfaces: 25

## Migration Notes

- Treat `supportedEffectCards` in the JSON report as the first-pass compatibility set when refactoring sacrifice handling.
- Treat `choiceOrGapSamples` and `unsupportedEffectSamples` as the safest backlog for extending sacrifice coverage without broad regressions.
- Treat `additionalCostOrKeywordSamples` as adjacent sacrifice wording that likely belongs to cost or keyword handling, not the standalone `sacrifice` executor step.

## Sample Supported Cards

- Unscrupulous Contractor: When this creature enters, you may sacrifice a creature.
- Excavating Anurid: When this creature enters, you may sacrifice a land.
- Waterspout Djinn: At the beginning of your upkeep, sacrifice this creature unless you return an untapped Island you control to its owner's hand.
- Distract the Hydra: Each player may sacrifice a creature.
- Eradicator Valkyrie: Boast — {1}{B}, Sacrifice a creature: Each opponent sacrifices a creature or planeswalker.
- Baldur's Gate Wilderness: Defiled Temple — You may sacrifice a permanent.
- Commander Greven il-Vec: When Commander Greven il-Vec enters, sacrifice a creature.
- Liliana of the Veil: −2: Target player sacrifices a creature.
- Phyrexian War Beast: When this creature leaves the battlefield, sacrifice a land and this creature deals 1 damage to you.
- Faerie Impostor: When this creature enters, sacrifice it unless you return another creature you control to its owner's hand.
- Daretti, Rocketeer Engineer: You may sacrifice an artifact.
- Grist, the Hunger Tide: −2: You may sacrifice a creature.
- Goremand: When this creature enters, each opponent sacrifices a creature.
- Yukora, the Prisoner: When Yukora leaves the battlefield, sacrifice all non-Ogre creatures you control.
- Quickling: When this creature enters, sacrifice it unless you return another creature you control to its owner's hand.
- Lithobraking: Then you may sacrifice an artifact.
- The Fourth Sphere: At the beginning of your upkeep, sacrifice a nonblack creature.
- Abhorrent Overlord: At the beginning of your upkeep, sacrifice a creature.
- All Is Dust: Each player sacrifices all permanents they control that are one or more colors.
- Demonic Taskmaster: At the beginning of your upkeep, sacrifice a creature other than this creature.

## Top Unsupported Object Phrases

- `it`: 83
- `this creature`: 75
- `a creature of their choice`: 59
- `it at the beginning of the next end step`: 46
- `it.)`: 40
- `them at the beginning of the next end step`: 38
- `this enchantment`: 34
- `another creature`: 27
- `it at end of combat.)`: 22
- `a land of their choice`: 15
- `this artifact`: 15
- `this aura`: 14
- `another creature or artifact`: 8
- `it at end of combat`: 8
- `it at the beginning of the next end step.)`: 8
- `it at the beginning of your next end step`: 7
- `a creature or planeswalker of their choice`: 6
- `a food`: 6
- `a permanent of their choice`: 6
- `another creature or an artifact`: 6
