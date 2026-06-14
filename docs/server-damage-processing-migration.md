# Server Damage Processing Migration

**Purpose:** Track unification of live server damage paths with `rules-engine/src/damageProcessing.ts` keyword behavior (infect, wither, poisonous, toxic, lifelink).

**Last updated:** 2026-06-13 (batch 280 follow-up — socket E2E + call-site audit)

**Related:**
- [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) — session resume prompt
- [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md) — Layer 3 migration umbrella
- `rules-engine/src/damageProcessing.ts` — canonical damage semantics
- `server/src/state/modules/combat-damage-processing.ts` — **server shared bridge** (new)

---

## Problem (pre-batch 280)

The rules-engine had correct infect/wither/poisonous logic in:
- `rules-engine/src/damageProcessing.ts`
- `rules-engine/src/actions/combat.ts` (`executeCombatDamage`)
- `rules-engine/src/oracleIRExecutorDamageStepHandlers.ts` (`deal_damage` steps)

The **live server** used a parallel bespoke path in `server/src/state/modules/turn.ts` (`dealCombatDamage`) that:
- Always subtracted **life** from players (ignored infect → poison)
- Always applied **marked damage** to creatures (ignored infect/wither → -1/-1)

Many other server call sites duplicated the same pattern.

**Symptom:** Rot Wolf (Infect + Poisonous 1) dealt combat damage but gave **0 poison** and **0 -1/-1** on blockers.

---

## Architecture target

```
oracle text / permanent keywords
  → parseDamageAbilities / createDamageSourceFromPermanent (rules-engine)
  → processDamageToPlayer / processDamageToCreature (rules-engine)
  → server bridge (combat-damage-processing.ts)
  → ctx.poison + state.poisonCounters / updateCounters('-1/-1') / markedDamage
  → runSBA → movePermanentToGraveyard → dies triggers
```

**Do not** add card-name routing. Keyword detection is oracle-text / `keywords` array / granted abilities only.

---

## Batch 280 follow-up — completed (uncommitted)

| Item | Change | Key files |
|------|--------|-----------|
| **Socket E2E** | Rot Wolf `declareAttackers` → combat damage → `viewFor.poisonCounters === 2` | `combat.infect-wither.socket.integration.test.ts` |
| **X-cost AoE** | `{X}: … each creature and each player` routes through bridge | `x-activated-abilities.ts` |
| **Nibelheim Aflame** | Sweep damage uses `applyCreatureDamageFromSource` with targeted creature as source | `stackResolveSpellSpecialCaseUtils.ts` |

---

## Batch 280 — completed (uncommitted)

### New shared module

`server/src/state/modules/combat-damage-processing.ts`

| Export | Role |
|--------|------|
| `applyPoisonCountersToPlayer` | Sync `ctx.poison`, `state.poisonCounters`, `player.poisonCounters` |
| `getCombatDamageSourceCharacteristics` | Source infect/wither/poisonous/toxic from permanent + counter-grants |
| `resolvePlayerDamage` | Player damage (combat or non-combat); infect → poison; poisonous/toxic on combat |
| `resolvePlayerCombatDamage` | Wrapper with `isCombatDamage: true` |
| `applyCreatureDamageFromSource` | Infect/wither → `-1/-1`; else marked damage |
| `applyFightDamageBetweenCreatures` | Mutual fight damage with keyword awareness |
| `inferInfectWitherFlags` | Auto-detect from `sourcePermanentId` for `dealDamage` events |
| `creatureDiesFromCombatDamage` | Death check for marked damage vs -1/-1 toughness |

### Wired paths

| Path | File(s) | Status |
|------|---------|--------|
| **Combat damage** | `turn.ts` `dealCombatDamage` | ✅ Fixed |
| **Fight** | `applyEvent.ts`, `stackResolveAbilityMidHandlersUtils.ts`, `planeswalker/templates/resolve.ts` | ✅ Fixed |
| **Legacy spell damage** | `executeSpellEffect.ts`, `applyEvent.ts` `resolveSpell` | ✅ Fixed |
| **`dealDamage` events** | `applyEvent.ts`, `replay.ts` | ✅ Auto-detect infect/wither; player targets |
| **Damage-received triggers** | `triggers/damage-received.ts` | ✅ Reflect damage respects source keywords |
| **Planeswalker template damage** | `planeswalker/templates/resolve.ts` | ✅ Source-aware when `sourcePermanentId` passed |
| **Proliferate resolve** | `applyEvent.ts` `proliferateResolve` | ✅ `updateCounters` + `runSBA` after counters (dies triggers) |
| **Poison lose condition** | `turn.ts` `syncLifeAndCheckDefeat` | ✅ 10+ poison counters |

### Already correct (unchanged)

| Path | Notes |
|------|-------|
| Oracle IR `deal_damage` | `oracleIRExecutorDamageStepHandlers.ts` |
| `dealDamage` + explicit `infect`/`wither` flags | `engine.damage.test.ts` |
| `rules-engine` `executeCombatDamage` | Not used by live server combat step |

---

## Delayed triggers (Rot Wolf → proliferate → dies)

**Scenario:** First-strike infect puts -1/-1 on a 3/3 blocker; creature survives combat; later proliferate adds another -1/-1; SBA kills it; Blood Artist (etc.) triggers.

**Flow after batch 280:**
1. Combat: `applyCreatureDamageFromSource` → `-1/-1` counters on blocker
2. `dealCombatDamage` queues combat-damage triggers, then `runSBA` (lethal marked damage only; -1/-1 survival is correct)
3. Later: `proliferateResolve` → `updateCounters` → **`runSBA`**
4. SBA: toughness ≤ 0 from -1/-1 → `movePermanentToGraveyard` → dies triggers on stack

**Guardrail:** `server/tests/combat.infect-wither.test.ts` — proliferate lethal -1/-1 → Blood Artist on stack.

---

## Tests (batch 280)

```powershell
cd D:\Git\MTGEDH\server
npx vitest run tests/combat.infect-wither.test.ts tests/combat.infect-wither.socket.integration.test.ts tests/engine.damage.test.ts
```

| Test | Covers |
|------|--------|
| Rot Wolf poison pattern | Infect + poisonous → 2 poison, 0 life loss |
| Infect vs blocker | -1/-1 on blocker, no marked damage |
| Wither vs blocker | -1/-1 on blocker |
| Infect fight | -1/-1 on survivor; infect creature dies to SBA |
| `dealDamage` auto-detect | Infect source → -1/-1 without explicit flag |
| Rot Wolf socket E2E | `declareAttackers` socket path → poison in `viewFor` |

---

## Remaining gaps (next session)

| Priority | Item | Notes |
|----------|------|-------|
| P1 | **Intentional fallbacks without source** | `applyEvent.ts` `DamagePermanent`, `damage-received.ts`, `planeswalker/templates/resolve.ts` — use raw `applyDamageToPermanentWithCounterEffects` only when `sourcePermanent` is absent |
| P2 | **Prod client poison UI** | Display contract tested (`client/tests/poisonCounterDisplay.test.ts`); optional manual UI spot-check |
| P3 | **First/double strike infect** | Unit tests in `combat.infect-wither.test.ts` |
| P3 | **Planeswalker infect** | Planeswalker damage still loyalty loss (correct per rules); no change needed |
| P4 | **Route `dealCombatDamage` through rules-engine** | Long-term: delete bespoke `turn.ts` combat damage or delegate to `executeCombatDamage` |
| P4 | **Toxic-only creatures** | Non-combat toxic N not applicable; combat toxic handled in `resolvePlayerDamage` |
| P4 | **First strike + double strike infect** | No dedicated socket sequencing test |

---

## Copy-paste prompt (damage follow-up)

```
Continue server damage processing migration (post batch 280).

Read docs/server-damage-processing-migration.md and docs/oracle-ir-session-handoff.md.

Batch 280 unified infect/wither/poisonous across combat, fight, spell damage, dealDamage events,
damage-received triggers, proliferate+SBA. Tests: server/tests/combat.infect-wither.test.ts.

Suggested next work:
A) Socket E2E: Rot Wolf combat → poison counters visible in client view
B) Audit remaining applyDamageToPermanentWithCounterEffects call sites without source
C) Resume Oracle IR migration (see oracle-ir-server-migration-plan.md)

Do not add card-name handlers. Extend combat-damage-processing.ts or damageProcessing.ts.
npm run test:oracle-ir-migration after server changes. Do not commit unless asked.
```
