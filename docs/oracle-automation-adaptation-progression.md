# Oracle Automation — Adaptation Progression Plan

Living plan for finishing card-effect adaptation **without bucket interference**.  
Companion docs: `oracle-automation-remaining-work.md` (metrics), `oracle-ir-gap-backlog.md` (parser clusters), `semantic-keyword-audit.md` (keyword shape).

**Last updated: 2026-06-09**

---

## 1. Problem statement

Card automation in MTGEDH is organized into several **overlapping “buckets”** that were useful for batching work but now **fight each other**:

| Bucket type | Examples | What went wrong |
|---|---|---|
| Executor **reason-code** buckets | `unsupported_selector`, `unsupported_target`, `unknown_amount` | Fixing selectors often broke conditions; amount fixes clobbered where-clauses |
| **Work-queue families** | `destroy_target` (900), `library_search` (900), `life_swings` (1000) | Sized for EDHREC priority, not parser/executor seams — same card hits multiple families |
| **Parser postprocess passes** | keyword expansion, among-them lowering, equip bleed prune | **Order-dependent** — pass A creates steps pass B misreads |
| **Server-side parallel systems** | trigger detectors, mana affordability, activated UI, Station thresholds | Same oracle substring parsed in 3+ places (e.g. Station 12+ vs `{T}: Add {G} for each creature`) |
| **Externals / benign-skip lists** | reminder text, partner, convoke, shock lands | Too broad → hides real gaps; too narrow → false partials |

**“~900 cards”** usually means one of:

1. **Queue family `targetCount`** — `destroy_target` and `library_search` are each sized at **900** in `tools/oracle-automation-next-200.json` (planned automation volume, **not** open gap count).
2. **Historical full-card gap milestone** — intermediate “675 gaps on ~650 cards” during benign-skip pass (now **0** parse→execute gaps).
3. **Choice-required inventory** — ~722 trigger + ~1,226 full-card clauses need UI, not parser fixes.

Do **not** use a single bucket count as “remaining work.” Use the **corridor metrics** in §4.

---

## 2. Target architecture: corridors, not buckets

Replace “pick a bucket, fix 50 cards” with **corridors** — end-to-end pipelines with explicit text ownership.

```
Oracle text (one card)
│
├─ [A] Ability boundary     triggeredAbilitiesParsing, stationParser, equip/loyalty split
├─ [B] Clause → IR          oracleIRParser + clause modules
├─ [C] IR postprocess       oracleIRParserPostprocess (ordered, seam-scoped)
├─ [D] IR execute           oracleIRExecutor* (step handlers)
├─ [E] Server wiring        triggered-abilities.ts, resolution.ts, stack.ts
└─ [F] Client / affordability interaction.ts, mana-check.ts, activatedAbilityParser
```

### Corridor definitions

| Corridor | Question it answers | Primary audit | Done when |
|---|---|---|---|
| **T1 — Trigger effect execute** | Does assisted dry-run apply the **effect text** of triggered abilities? | `npm run executor:coverage` (default scope) | 0 parse→execute gaps; benign choice only |
| **T2 — Trigger detect + IF** | Does the server **fire** the trigger and evaluate intervening-if? | `npm run trigger:coverage` | 0 `not_detected`, 0 `effect_ir_gap` |
| **F1 — Full-card execute** | Does every **static/activated/saga** clause dry-run? | `EXECUTOR_COVERAGE_SCOPE=full_card` | 0 parse→execute gaps |
| **P1 — Parser IR** | Does text produce known `OracleEffectStep` kinds? | `npx tsx tools/oracle-ir-gap-audit.ts` | Top clusters → 0; see backlog doc |
| **K1 — Keyword semantics** | Are keywords the right IR **shape** (static vs triggered)? | `npm run executor:keyword-audit` | 0 missing metadata patterns |
| **R1 — Runtime play** | Does a real game session match Oracle? | Integration tests + `GameAutomationVerifier` | Card/regression tests green |
| **M1 — Mana / activation** | Can players pay costs and activate correctly? | `mana-check.*.test.ts`, payment integration tests | No cross-parser double-count |

**Rule:** A change belongs to **one primary corridor**. If it touches two, document the **blast radius** in the batch test file and run **both** audits.

---

## 3. Seam registry (anti-interference)

When implementing a pattern, register it as a **seam** — not a free-floating bucket item.

### Seam record template

```markdown
### Seam: <short name>
- **Corridor:** T1 | F1 | P1 | …
- **Text signature:** regex or quoted oracle fragment from oracle-cards.json
- **Owner module:** e.g. oracleIRParserMoveZone.ts
- **Postprocess order:** must run after X, before Y
- **Must not match:** list of overlapping patterns (other seams)
- **Tests:** vitest file + 1 integration if server-visible
- **Audits to re-run:** list from §6
```

### Known interference matrix (check before merging)

| Seam A | Seam B | Symptom | Guard |
|---|---|---|---|
| Station threshold (`N+ \|`) | Trigger parsing | Station headers become fake triggers | Filter in `triggeredAbilitiesParsing`; batch 24 tests |
| Station activated mana | `for each` mana scaling | 12+ mana counted below threshold | Station-only path in `mana-check.ts`; scoped oracle text |
| Devotion mana | Creature-count mana | Wrong color/amount in canAct | `getCreatureCountManaAmount` + scoped ability line |
| Landfall detector | Creature ETB | Aura Shards fires on creatures | `typed_land_enter` land subtype only |
| Attach land subtype | Attach any land | `target land you control` wrong target | Handler order: type before subtype (batch 36) |
| Among-them lowering | Residual unknown lowering | `player_choice` lost | `lowerAmongThem…` **after** `lowerCurrentResidual…` (batch 7) |
| Equip activation text | Trigger effect audit | Equip misparsed as trigger tail | `pruneEquipmentBleedSteps` / strip equip from trigger input (batch 59) |
| Annihilator static grant | Generic keyword reminder | No sacrifice on attack | `enrichAnnihilatorGrantMetadataAbilities` (semantic P1) |
| Benign optional skip | Real partial gap | Gap hidden as benign | `skippedStepsAreBenignForAudit` — only when optional chain already benign |
| Full-oracle regex mana | Station gating | Inactive abilities counted | `isStationManaPermanent` early return in `buildExactManaSources` |
| Copy spell replay | Storm `this_spell` | Invalid copy source | Sibling replay + `lastCastSpell` ctx (batch 31–32) |
| GY target resolution | BF target bleed | Exile from GY uses battlefield id | Zone-aware bound-target fallback (batch 54) |

**New rule for all batches:** add a row to this matrix when a regression was caused by overlap.

---

## 4. Current baseline (2026-06-09)

| Corridor | Metric | Status |
|---|---|---|
| T1 Trigger execute | 14,290 fully applied; **0** parse→execute gaps | Green |
| T2 Trigger detect | 15,742 / 15,742 fully covered | Green |
| F1 Full-card execute | 49,713 / 51,156 fully applied (97.2%); **0** parse→execute gaps | Green (choice UI remains) |
| P1 Parser IR | 188 cards / 207 gap records | **Active backlog** |
| K1 Keyword semantics | P1–P7 closed per semantic doc | Green |
| R1 Runtime | `verify-automation` ~97% infrastructure | Partial (ordering, replacements) |
| M1 Mana | Station/devotion batches in progress | Ongoing |

**Implication:** Further adaptation is **not** “close the 900-card destroy bucket.” It is:

1. Parser IR clusters (static / activated / riders)
2. **Choice-required → real UI** (~1,900 clauses)
3. **Live runtime** correctness (mana, targeting, ordering, replacements)
4. Queue families (destroy/search/…) as **playtesting priorities**, not parser buckets

---

## 5. Phased progression

Work phases **in order** unless a live bug forces a hotfix. Within a phase, work **top cluster by count**, not alphabetical card names.

### Phase 0 — Session baseline (every time)

```powershell
cd server
npm run trigger:coverage
npm run executor:coverage
$env:EXECUTOR_COVERAGE_SCOPE="full_card"; npm run executor:coverage
npm run executor:keyword-audit
cd ..
npx tsx tools/oracle-ir-gap-audit.ts
```

Record numbers in `oracle-automation-remaining-work.md` §Audit baseline.  
JSON under `server/scripts/out/` is gitignored — regenerate locally.

---

### Phase 1 — Parser IR clusters (P1 corridor)

**Goal:** Drive `tools/oracle-ir-gap-audit.json` toward 0 actionable gaps.

**Source of truth:** `docs/oracle-ir-gap-backlog.md` (top-20 clusters).

**Work unit:** One cluster pattern (e.g. “You may choose new targets for the copy” ×100).

**Implementation pattern:**

1. Decide **ability boundary** — static vs triggered vs reminder (don't execute reminders).
2. Add **clause parser** or **postprocess lowering** in the narrowest module.
3. Add `oracleIRGapBatch{N}.test.ts` with **quoted oracle** from `oracle-cards.json`.
4. Re-run `oracle-ir-gap-audit.ts`; confirm cluster count drops.
5. If the seam touches triggers, also run `executor:coverage` (scope both).

**High-risk overlaps in this phase:**

- Madness / flashback / escape **rider parentheses** ↔ cast permission steps
- `Visit —` attraction headers ↔ `choose_mode`
- Shock/check **“enters tapped unless …”** ↔ land ETB statics (externals list)
- Additional-cost tails (`As an additional cost…`) ↔ `pay_mana` steps

**Exit criteria:** ≤20 cards with gaps, all remaining documented as external/platform-only.

---

### Phase 2 — Activated & mana-adjacent parsing (F1 + M1)

**Goal:** One parser path for activated abilities, Station, loyalty, crew, mana abilities.

**Problem:** Text is parsed in:

- `rules-engine` IR (full-card audit)
- `client/.../activatedAbilityParser.ts` (UI)
- `server/.../mana-abilities.ts` + `mana-check.ts` (affordability)
- `server/.../stationParser.ts` (threshold gating)

**Work unit:** Mechanic family (Station, devotion, for-each, hybrid activation costs).

**Implementation pattern:**

1. Add **shared text helpers** or document **one canonical oracle substring** per ability line.
2. Server affordability and client UI must call the same **gating** (threshold, summoning sickness, self-payment exclusion).
3. Tests at both layers: rules-engine unit + `server/tests/*integration.test.ts`.

**Exit criteria:** No mechanic where `getAvailableMana` and `activateBattlefieldAbility` disagree.

---

### Phase 3 — Choice-required → resolution UI (R1)

**Goal:** Convert `player_choice_required` from audit skip to real player flow.

**Inventory:** ~722 trigger + ~1,226 full-card clauses (expected after Phases 1–2).

**Work unit:** One **choice kind** (`choose_mode`, look-choose, target_player, amount X, color choice).

| Choice kind | Primary module | Test corridor |
|---|---|---|
| Look / reveal / among-them | `resolution.ts`, `oracleLookChooseExecutor.test.ts` | F1 + integration |
| Modal / charm / bullet | `choose_mode` lowering + UI | F1 |
| Target selection | `interaction.ts`, targeting pipeline | R1 integration |
| Pay {X} / hybrid / Phyrexian | `resolution.ts` mana payment | M1 integration |

**Do not** fix choice-required by making audit auto-bind unless the game **always** deterministically binds (e.g. single legal target).

**Exit criteria:** Assisted execution rate stays high **with** `allowOptional=false` smoke tests for sampled cards.

---

### Phase 4 — Runtime game systems (R1 infrastructure)

**Goal:** Close `verify-automation` partials and known infrastructure gaps.

| Item | Module | Notes |
|---|---|---|
| Same-controller trigger ordering | `priority.ts`, UI `ORDER_TRIGGERS` | APNAP |
| Replacement effect choice | `CHOOSE_REPLACEMENT` | Layer interaction |
| SBAs / state cleanup | `applyEvent.ts`, `runSBA` | Copy zone, legend rule |
| Stack timing / priority passes | `stack.ts`, `resolution.ts` | |

**Work unit:** One **game rule**, not one card.

**Exit criteria:** `GameAutomationVerifier` infrastructure checklist green.

---

### Phase 5 — Queue families (playtest-driven hardening)

**Goal:** High-EDHREC **families** play correctly in live games, not merely dry-run.

**Source:** `tools/oracle-automation-next-20-categories.md`, `oracle-automation-next-200.json`.

**Order (after corridors green):**

1. `library_search` (900) — search + shuffle + reveal UI
2. `destroy_target` (900) — destruction + regeneration/replacement
3. `return_to_hand` (700) — bounce timing, hexproof, ward
4. `discard` (700) — random vs chosen, discard triggers
5. `life_swings` (1000) — life gain triggers, pay-life alt costs

**Work unit:** 10–20 **representative cards** per family with integration tests; fix **family seam** not individual oracle IDs.

**Exit criteria:** Family integration suite; no new parse→execute regressions.

---

### Phase 6 — Corpus lock & regression hygiene

**Goal:** Prevent bucket interference from returning.

1. **Seam registry** (§3) updated per batch.
2. **Postprocess order diagram** maintained in `oracleIRParser.ts` header comment.
3. **Cluster-first audits** only — never “fix card X” without cluster metric movement.
4. **Cross-corridor CI smoke:** `mana-check.conditional`, `oracleLookChooseExecutor`, `landfall-detection`, `spacecraft.station-threshold`.

---

## 6. Audit commands by phase

| Phase | Required re-runs |
|---|---|
| 0 | All baseline commands |
| 1 | `oracle-ir-gap-audit.ts`, `executor:coverage` (both scopes if static affects triggers) |
| 2 | `mana-check.conditional.test.ts`, `activatedAbilityParser.test.ts`, full_card executor |
| 3 | `oracleLookChooseExecutor.test.ts`, targeted integration tests |
| 4 | `verify-automation`, game integration suite |
| 5 | Family integration tests + executor coverage sample |

**Gap cluster scripts** (when parse→execute > 0):

```powershell
npx tsx scripts/executor-selector-gap-analysis.ts
npx tsx scripts/executor-target-gap-analysis.ts
npx tsx scripts/executor-condition-gap-analysis.ts
npx tsx scripts/executor-amount-gap-analysis.ts
npx tsx scripts/executor-general-gap-analysis.ts
npx tsx scripts/_tmp-full-card-gap-clusters.ts
```

---

## 7. Batch workflow (one seam per PR)

1. **Pick cluster** from backlog JSON (highest count **in current phase**).
2. **Write seam record** (§3 template) in batch test file header.
3. **Implement** in narrowest module; avoid new global regex on full oracle when scoped line exists.
4. **Tests:** unit in `rules-engine/test/` or `server/tests/`; quote oracle from `oracle-cards.json`.
5. **Re-run audits** from §6; paste metric deltas into `oracle-automation-remaining-work.md` changelog.
6. **Update interference matrix** (§3) if this batch touched a known overlap.

**Anti-patterns:**

- Broadening `isExternallyHandledOracleFragmentText` to clear a cluster (hides real work).
- Full-oracle `getCreatureCountManaAmount` on Station cards.
- Postprocess pass that scans all `unknown` steps without `must not match` guards.
- Fixing executor without checking parser IR (reintroduces `ir_gap`).

---

## 8. Priority queue (next 8 seams)

Ordered for **minimum interference** — parser boundaries before executor, shared mechanics before queue families.

| # | Seam | Corridor | Cards (approx) | Primary file(s) |
|---|---|---|---:|---|
| 1 | Copy retarget riders | P1 | ~100 | `oracleIRParserPostprocess.ts` |
| 2 | Madness / additional-cost parentheses | P1 | ~110 | parser + externals tighten |
| 3 | Vehicle “becomes artifact creature” reminder | P1 | ~94 | postprocess / externals |
| 4 | Shock/check enters tapped unless | P1 + F1 | ~100 | static land parser |
| 5 | `Visit —` attraction / choose_mode | P1 | ~48+ | `oracleIRParserChooseMode.ts` |
| 6 | Station + mana unified gating | M1 | all Station | `stationParser.ts`, `mana-check.ts`, `interaction.ts` |
| 7 | Look-choose UI for remaining choice_required | R1 | ~1,900 | `resolution.ts`, client modals |
| 8 | Library search family playtests | Phase 5 | 900 queue | search + shuffle resolution |

---

## 9. Success metrics (definition of “all effects covered”)

| Level | Definition |
|---|---|
| **L1 — Parse** | 0 `ir_gap` on parser audit; 0 unknown steps on trigger + full-card executor audits |
| **L2 — Dry-run execute** | 0 parse→execute gaps; choice_required only where players must choose |
| **L3 — Detect** | Trigger coverage fully_covered; intervening-if recognized |
| **L4 — Activate** | Mana payment, Station thresholds, summoning sickness, self-cost exclusion correct |
| **L5 — Play** | Integration tests for top EDHREC families; verifier green |
| **L6 — Polish** | Replacement/order UI; edge-case card spot-checks |

**Current project position:** **L2 achieved** on executor audits; **L1 partial** (parser backlog); **L4–L5 in progress**.

---

## 10. Related paths

| Purpose | Path |
|---|---|
| Live executor metrics | `docs/oracle-automation-remaining-work.md` |
| Parser gap clusters | `docs/oracle-ir-gap-backlog.md`, `tools/oracle-ir-gap-audit.json` |
| Keyword shape | `docs/semantic-keyword-audit.md` |
| EDHREC work categories | `docs/oracle-automation-next-20-categories.md` |
| Queue families | `tools/oracle-automation-next-200.json` |
| IR parser entry | `rules-engine/src/oracleIRParser.ts` |
| Postprocess | `rules-engine/src/oracleIRParserPostprocess.ts` |
| Executor | `rules-engine/src/oracleIRExecutorMainLoop.ts` |
| Trigger detection | `server/src/state/modules/triggered-abilities.ts` |
| Resolution / UI | `server/src/socket/resolution.ts` |
| Mana affordability | `server/src/state/modules/mana-check.ts` |
| Station | `server/src/utils/stationParser.ts` |
| Gap batch tests | `rules-engine/test/oracleIRGapBatch*.test.ts` |
| Look-choose tests | `rules-engine/test/oracleLookChooseExecutor.test.ts` |

---

## 11. Update protocol

When closing a seam:

1. Add/update seam record in batch test header.
2. Re-run phase-appropriate audits (§6).
3. Update metric tables in `oracle-automation-remaining-work.md`.
4. If parser-only, refresh `oracle-ir-gap-backlog.md` top-20.
5. Append one line to remaining-work **Change log** with evidence (counts, not vibes).
