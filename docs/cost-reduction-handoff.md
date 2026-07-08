# Cost Reduction & Alternate Costs — Session Handoff

Last updated: 2026-07-07

## Next session prompt (copy-paste)

```
Continue from cost-reduction handoff (docs/cost-reduction-handoff.md).

Done:
- Three reducer systems wired: spell reducers (medallions, Morophon), alternate cast costs (flashback/escape/mutate/Leyline WUBRG), activated ability reducers (Zirda, Convergence, Tortoise, Mutagen Man, Heartstone)
- Graveyard alternate casts use buildAlternateCastSpellManaCost; unearth uses adjustActivationManaCostForPayment
- CastSpellModal: wubrg_self parse, reduced alternate-cost labels, server extraAlternateCosts authoritative
- Unified payment step: normal + mutate + Leyline WUBRG in one CastSpellModal; mutate target deferred after payment
- Integration tests: cost-reduction-cast.integration.test.ts, mutate.cast-prompt.integration.test.ts (incl. unified mutate e2e)

Verify at session start:
cd rules-engine
npx vitest run test/activatedAbilityCostReduction.test.ts test/activatedAbilityCostReductionOracle.test.ts

cd ../server
npx vitest run tests/ability-cost-adjustments.unit.test.ts tests/graveyard-alternate-cast-cost-reduction.unit.test.ts tests/alternate-cost-spell-reduction.unit.test.ts tests/cost-reduction-cast.integration.test.ts tests/mutate.cast-prompt.integration.test.ts
npx tsx scripts/alternate-cost-implementation-audit.ts

cd ../client
npx vitest run tests/castSpellModal.test.ts

Next work (optional / longer term):
- Document or extend generic-only reducers vs single-pip colored costs (Ruby + flashback {R} stays {R} — correct rules behavior)
- Root-cause IR pipeline drops for activation-cost-reduction static abilities (recovered via recoverDroppedActivationCostReductionStaticAbilities)

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

1. ~~**UI polish** — optional single-step cost chooser for mutate + Leyline + normal (`CastSpellModal.tsx`)~~ — done
2. **Generic-only reducers** do not reduce single-pip colored costs (e.g. flashback `{R}` + Ruby Medallion stays `{R}`). This matches rules: Ruby only reduces generic in the cost; `{R}` has no generic component. Document in `CASTING_COST_FRAMEWORK.md` if players ask; extend only if a future reducer explicitly reduces colored pips.
3. **Root-cause** why some activation-cost-reduction static abilities are dropped mid-IR-pipeline (recovered at end via `recoverDroppedActivationCostReductionStaticAbilities`)

### Unified mutate payment flow (2026-07-07)

| Step | UI | Server |
|------|-----|--------|
| 1 | `CastSpellModal` — pick normal / mutate / WUBRG + pay | `mana_payment_choice` with `extraAlternateCosts` |
| 2a (normal/WUBRG) | Confirm | `resumePlayerSpellCastAfterPayment` → stack |
| 2b (mutate) | `MutateTargetModal` | Payment stored on `pendingSpellCasts.deferredSpellPaymentCompletion`; target step queued |
| 3 (mutate only) | Pick host creature | `resumePlayerSpellCastAfterPayment` with stored payment + `alternateCostId: mutate` |

Mutate appears in `extraAlternateCosts` only when `hasMutateAlternateCost` (legal non-Human host you own).

## Related docs

- `docs/CASTING_COST_FRAMEWORK.md` — casting cost types, three-bucket architecture, Phase 4 status
- `docs/oracle-ir-session-handoff.md` — Oracle IR migration (separate workstream)
