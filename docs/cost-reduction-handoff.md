# Cost Reduction & Alternate Costs — Session Handoff

Last updated: 2026-07-07

## Next session prompt (copy-paste)

```
Continue from cost-reduction handoff (docs/cost-reduction-handoff.md).

Done:
- Three reducer systems wired: spell reducers (medallions, Morophon), alternate cast costs (flashback/escape/mutate/Leyline WUBRG), activated ability reducers (Zirda, Convergence, Tortoise, Mutagen Man, Heartstone)
- Graveyard alternate casts use buildAlternateCastSpellManaCost; unearth uses adjustActivationManaCostForPayment
- CastSpellModal: wubrg_self parse, reduced alternate-cost labels, server extraAlternateCosts authoritative
- Integration tests: cost-reduction-cast.integration.test.ts (flashback+Ruby, Convergence+unearth, Hakbal+Leyline+Morophon)
- Alternate-cost audit updated (unearth = activated ability)

Verify at session start:
cd rules-engine
npx vitest run test/activatedAbilityCostReduction.test.ts

cd ../server
npx vitest run tests/ability-cost-adjustments.unit.test.ts tests/graveyard-alternate-cast-cost-reduction.unit.test.ts tests/alternate-cost-spell-reduction.unit.test.ts tests/cost-reduction-cast.integration.test.ts
npx tsx scripts/alternate-cost-implementation-audit.ts

cd ../client
npx vitest run tests/castSpellModal.test.ts

Next work (priority):
1. Oracle IR static grants for ability cost reduction (replace name tables in activatedAbilityCostReduction.ts)
2. Audit remaining activation payment paths (equip, cycling, planeswalker loyalty) for adjustActivationManaCostForPayment
3. Optional UI: unify mutate vs Leyline vs normal in one payment step (currently split across modals)
4. Flashback integration test with mana-payment queue step (tap land) when reduced cost still > {0}

Do not commit unless asked. Windows: chain shell commands with `;`.
```

## Architecture (critical)

| System | Examples | Applies to |
|--------|----------|------------|
| Spell cost reduction | Pearl Medallion, Morophon, Bannerets | Casting spells, including alternate **cast** costs |
| Alternate casting costs | Flashback, escape, dash, Leyline WUBRG, mutate | Different way/zone to **cast** a spell |
| Activated ability reduction | Zirda, Convergence, Tortoise, Mutagen Man | `{cost}:` activated abilities (unearth, equip) |

**Unearth ≠ alternate cast.** Flashback ≠ activated ability.

## Key files

| Purpose | Path |
|---------|------|
| Spell + alternate-cast reducers | `server/src/socket/game-actions.ts` |
| Graveyard alternate cast | `server/src/socket/interaction.ts` → `continueCastFromGraveyardAbility` |
| Activated ability engine | `rules-engine/src/activatedAbilityCostReduction.ts` |
| Activated ability bridge | `server/src/state/modules/ability-cost-adjustments.ts` |
| Payment modal | `client/src/components/CastSpellModal.tsx` |
| Leyline client detection | `client/src/App.tsx` → `battlefieldAlternateCosts` |
| Payment step resolution | `server/src/socket/resolution.ts` → `buildPendingCastPaymentManaCost` |
| Alternate cost audit | `server/scripts/alternate-cost-implementation-audit.ts` |

## Session 2026-07-07 — Cost reducers end-to-end

| Area | Outcome | Tests |
|------|---------|-------|
| Activated ability reducers | Zirda, Convergence, Tortoise, Mutagen Man, Training Grounds, Biomancer's Familiar, Heartstone | `activatedAbilityCostReduction.test.ts` 7/7, `ability-cost-adjustments.unit.test.ts` 2/2 |
| Graveyard alternate cast reducers | `buildAlternateCastSpellManaCost` on flashback/escape/disturb/jump-start/retrace | `graveyard-alternate-cast-cost-reduction.unit.test.ts` 4/4 |
| Hand-cast alternate reducers | mutate, wubrg_self/external, keyword alternates via `resolveEffectiveSpellBaseManaCost` | `alternate-cost-spell-reduction.unit.test.ts` 3/3 |
| Integration | Flashback+Ruby, Convergence+unearth, Hakbal+Leyline+Morophon | `cost-reduction-cast.integration.test.ts` 3/3 |
| Client UI | `wubrg_self` in `parseAlternateCosts`, strikethrough reduced labels | `castSpellModal.test.ts` 7/7 |
| Audit | Unearth flagged `activated_ability`; global reducer wiring checks | `alternate-cost-implementation-audit.json` |

### Hakbal + Leyline + Morophon (verified)

| Mode | Printed | After Morophon |
|------|---------|----------------|
| Normal / Mutate | `{1}{G}{U}` | `{1}` |
| Leyline WUBRG | `{W}{U}{B}{R}{G}` | `{0}` |

## Remaining / longer term

1. **Oracle IR static effects** for ability cost reduction (`grant_static_ability`) instead of `ACTIVATED_ABILITY_COST_REDUCERS` name table
2. **Equip / cycling / loyalty** activation paths — confirm all call `adjustActivationManaCostForPayment`
3. **UI polish** — optional single-step cost chooser for mutate + Leyline + normal
4. **Generic-only reducers** do not reduce single-pip colored costs (e.g. flashback `{R}` + Ruby stays `{R}`); document or extend colored reduction if desired

## Related docs

- `docs/CASTING_COST_FRAMEWORK.md` — casting cost types, three-bucket architecture, Phase 4 status
- `docs/oracle-ir-session-handoff.md` — Oracle IR migration (separate workstream)
