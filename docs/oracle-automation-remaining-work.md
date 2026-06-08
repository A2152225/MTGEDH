# Oracle Automation — Remaining Work

Living document. Update this file as gaps close and audits are re-run.

Last updated: 2026-06-07

## Audit baseline (executor coverage)

Source: `npm run executor:coverage --workspace=server`  
Report: `server/scripts/out/executor-coverage-audit.json`  
Scope: commander-legal **triggered-ability effects**, assisted fixture (pre-bound targets, `allowOptional=true`, auto first `choose_mode`)

| Metric | Baseline (2026-06-07) | Current (2026-06-07) |
|---:|---:|---:|
| Cards scanned | 29,614 | 29,614 |
| Trigger effects dry-run | 15,014 | 15,014 |
| IR gaps (`ir_gap`) | **0** | **0** |
| Fully applied | 10,502 (70.0%) | **11,050 (73.6%)** |
| Choice required (expected UI) | 956 (6.4%) | 1,122 (7.5%) |
| Assisted execution rate | **76.3%** | **81.1%** |
| Parse→execute gaps | 3,556 items / 3,328 cards | **2,842 items** |

### Status breakdown (baseline)

| Status | Count |
|---|---:|
| `fully_applied` | 10,502 |
| `choice_required` | 956 |
| `partial` | 2,105 |
| `unsupported` | 1,347 |
| `impossible` | 32 |
| `no_steps` | 72 |
| `ir_gap` | 0 |

### Top skip reason codes (baseline)

| Rank | Reason code | Count |
|---:|---|---:|
| 1 | `unsupported_selector` | 1,155 → **340** |
| 2 | `player_choice_required` | 1,082 |
| 3 | `unsupported_condition_clause` | 707 |
| 4 | `unsupported_target` | 425 |
| 5 | `no_deterministic_target` | 397 |
| 6 | `invalid_copy_spell_source` | 132 |
| 7 | `unknown_amount` | 99 |
| 8 | `failed_to_apply` | 84 |
| 9 | `impossible_action` | 72 |
| 10 | `unsupported_scaler` | 49 |

### Top skipped step kinds (baseline)

| Step kind | Skip count |
|---|---:|
| `move_zone` | 1,112 → **~850** |
| `conditional` | 705 |
| `sacrifice` | 300 |
| `grant_temporary_ability` | 268 |
| `scry` | 229 |
| `destroy` | 221 |
| `discard` | 161 |
| `copy_spell` | 132 |
| `exile` | 129 |

### Highest-volume gap patterns (baseline)

1. **ETB** — `exile target card from an opponent's graveyard` (~3,039 triggers; mixed statuses)
2. **Attacks** — `it gets +N/+M until end of turn` (~756)
3. **Upkeep** — Duplicity-style hand exile packages (~594)
4. **Dies** — optional draw (~489)
5. **Combat damage to player** — impulse exile cast (~290)

### Related audits (green)

| Audit | Status |
|---|---|
| Trigger coverage (`trigger:coverage`) | 15,742 / 15,742 fully covered; 0 IR gaps |
| Intervening-if corpus (`intervening-if:audit`) | 727 / 728 recognized |
| Game-system verifier (`verify-automation`) | 97% infrastructure |

---

## Priority queue

Work in this order unless a specific card/report redirects effort.

### 1. Selector binding — `unsupported_selector` [in progress]

- [x] Normalize `an opponent's {graveyard|hand|exile}` → `target opponent's …` in move-zone parsers (`normalizeBoundPlayerZoneSelectorText`)
- [x] Deterministic singleton graveyard target when exactly one legal card matches (no `chosenObjectIds`)
- [x] Extend assisted audit fixture: opponent graveyard cards in `chosenObjectIds`
- [x] Re-run executor audit; record delta in table above (+57 fully applied, −59 parse→execute gaps)
- [x] Self-reference move-zone batch: `this card` GY→BF/hand, `this creature` BF bounce, `the exiled card`, `a land you control`, GY self-exile
- [x] Audit fixture: per-card `gy-source-self` + linked exile card; gap-analysis script uses same fixture
- [x] Re-audit: 78.8% assisted rate, `unsupported_selector` 794 (−347 from prior current)
- [x] Antecedent returns: `resolveContextualBoundCardZone` for `that card`/`it`, shuffle-into-library placement, `one of them` hand/rest-library split
- [x] Type-aware audit fixture (`type_line` on `bf-source` / `gy-source-self`); antecedent + split-zone graveyard cards
- [x] Re-audit: 79.2% assisted rate, `unsupported_selector` 596 (−198)
- [x] Hand/graveyard selector batch: typed card from hand→BF, shuffle hand to library, exile from graveyard(s), `one of them` GY splits, `the rest`, `all cards exiled with it`, another/other target bounce, pronoun antecedents
- [x] Re-audit: 80.3% assisted rate, `unsupported_selector` 425 (−171)
- [x] Batch 4+5: colored-creature bounce, `one of those cards`/`one pile`/`one` splits, opponent-owned exile→GY, hand→library top N, up-to-N GY returns (power filter), `the chosen card`, `they control` land bounce, enchanted creature shuffle, `the rest`→library, or-typed GY returns, any-graveyard exile
- [x] Re-audit: 81.1% assisted rate, `unsupported_selector` 340 (−85). Selector gap analysis: 338 items / 317 clusters
- [ ] Next clusters: attach (`this aura to that creature`, equipment reattach), `return this card` on specific cards (Kathari Bomber family), face-down hand exile
- [ ] Broader relational selectors (`each of those`, antecedent player/object bindings)
- [ ] Hand/exile zone variants beyond ETB opponent-graveyard exile family

**Representative cards:** Disposal Mummy, Pharika's Mender, Keldon Raider, Errand-Rider of Gondor

### 2. Conditional wrappers — `unsupported_condition_clause`

- [ ] `If you do` / moved-card gates after prior steps
- [ ] Article-only `a card is put into exile this way` edge cases still returning `null`

### 3. Targeting pipeline — `unsupported_target` + `no_deterministic_target`

- [ ] Client target picker → `chosenObjectIds` / `targetPermanentId` continuity on stack resolution
- [ ] Post-Bloomburrow shortened restriction templates (`target creature that entered`)

### 4. Copy-spell corridor — `invalid_copy_spell_source`

- [ ] Cast-trigger copies with graveyard/reanimation retarget (Sevinne's Reclamation family)

### 5. Game infrastructure (verify-automation pending/partial)

- [ ] Win effect cards (Laboratory Maniac, Thassa's Oracle)
- [ ] Copy zone movement SBA (704.5e)
- [ ] Same-controller trigger ordering UI (`ORDER_TRIGGERS`)
- [ ] Replacement-effect choice (`CHOOSE_REPLACEMENT`)

### 6. Full-card executor audit (not yet baselined)

- [ ] Run `EXECUTOR_COVERAGE_SCOPE=full_card` and add second baseline section

### 7. Static / activated ability gaps (outside trigger audit)

- [ ] Shock/check land “enters tapped unless …” (~100 cards, `oracle-ir-gap-audit`)
- [ ] Activated abilities, loyalty, equip, attractions `Visit —`

---

## Update protocol

When closing a seam:

1. Add focused parser/executor regression test(s).
2. Re-run `npm run executor:coverage --workspace=server`.
3. Update **Current** column and checkboxes in this file.
4. Append one line to **Change log** with evidence.

## Change log

- 2026-06-07: Baseline executor coverage audit added (`executor-coverage-audit.ts`). Commander-legal trigger effects: 76.3% assisted rate, 0 IR gaps, 3,556 parse→execute gaps. Top blocker: `unsupported_selector` (1,155).
- 2026-06-07: Closed opponent-graveyard selector seam for `an opponent's graveyard` move-zone text. `normalizeBoundPlayerZoneSelectorText` in `oracleIRExecutorZoneOps.ts`, singleton graveyard target fallback in `resolveUniqueChosenGraveyardTargetId`, executor regression for Disposal Mummy. Re-audit: 76.7% assisted rate, `unsupported_selector` 1,141, parse→execute gaps 3,497.
- 2026-06-07: Closed self-reference move-zone batch (`resolveSourceCardZoneLocation` zone inference, battlefield self-bounce, `the exiled card`, `parseMoveZoneTheExiledCard`, battlefield parser `and` word-boundary + article strip, attach `it` → contextual target). Per-card audit graveyard fixture. Re-audit: 78.8% assisted rate (+289 fully applied), `unsupported_selector` 794, parse→execute gaps 3,186. Selector gap analysis: 769 items (top cluster now `return this enchantment`, 16).
- 2026-06-07: Closed antecedent selector batch (`resolveContextualBoundCardZone`, shuffle-into-library default placement, `one of them` hand/rest-library split, type-aware audit `bf-source`). Re-audit: 79.2% assisted rate (+51 fully applied), `unsupported_selector` 596, parse→execute gaps 3,124.
- 2026-06-07: Closed hand/graveyard selector batch (typed hand puts, graveyard exiles, split-zone `one of them`/`the rest`, linked-exile mass return, battlefield `another`/`other` target bounce). Re-audit: 80.3% assisted rate (+46 fully applied), `unsupported_selector` 425, parse→execute gaps 2,959. Selector gap analysis: 421 items.
- 2026-06-07: Closed batch 4+5 selector seams (colored BF bounce, contextual `one of those cards`/`the chosen card`, pile splits, opponent-owned exile→GY, hand→library top, up-to-N GY criteria + power≤, enchanted creature library shuffle, `they control` bounce, `the rest` shuffle, or-typed GY hand returns, any-graveyard exile). Re-audit: 81.1% assisted rate (+105 fully applied vs post-batch-3), `unsupported_selector` 340, parse→execute gaps 2,842. Selector gap analysis: 338 items.
