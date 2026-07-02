# Semantic Keyword IR Audit

Living reference for keyword ability parsing quality — distinct from **`ir_gap`** (unknown IR steps). Update after parser changes and re-run the audit.

**Last updated: 2026-07-02** (corpus green; new-set keyword onboarding — see [oracle-ir-track-e-remaining-work.md § B](./oracle-ir-track-e-remaining-work.md#b-new-keyword-from-comprehensive-rules-implementation-tasks))

---

## Quick start (new session)

1. Read this doc for current clusters and priority order.
2. Re-run audits if code changed:
   ```powershell
   cd server
   npm run executor:keyword-audit
   npm run executor:coverage
   ```
3. JSON report: `server/scripts/out/semantic-keyword-audit.json` (**gitignored** — regenerate locally).
4. Related: `docs/oracle-automation-remaining-work.md` (executor parse→execute + `ir_gap`).

---

## What this audit measures

| Concern | Question | Separate from `ir_gap`? |
|---|---|---|
| **Parse completeness** | Does text produce `kind: unknown`? | Yes — `ir_gap` tracks this for triggers |
| **Semantic richness** | Are keywords modeled with correct IR shape (static vs triggered)? | **This audit** |
| **Executor impact** | Can the assisted fixture apply the step? | `executor:coverage` |

**Batch 66** closed the last 6 trigger **`ir_gap`** items. Keywords there (Ulamog indestructible/annihilator, Flayer annihilator/trample) were unknown fragments; they now parse but exposed a deeper issue: **annihilator must carry attack-trigger + sacrifice metadata**, not generic “keyword reminder” blobs.

---

## Baseline metrics (2026-06-09, post-P1–P7)

Source: `npm run executor:keyword-audit`  
Scope: **29,614** commander-legal cards; **15,013** trigger effects

| Metric | Count | Notes |
|---:|---:|---|
| Trigger keyword-ish **`ir_gap`** | **0** | Executor trigger path is clean |
| Trigger generic metadata hits | **0** (0 patterns) | P7 long-tail pass residuals promoted |
| Annihilator **missing** attack-trigger metadata | **0** | P1 closed |
| Annihilator **with** attack-trigger metadata | **6** | Grant-clause + orphan-fragment paths |
| Full-card keyword-ish `unknown` steps | **0** | P6 closed (was 7) |
| Full-card static keyword line unparsed | **0** | P3 closed (was ~400 blocks) |
| Full-card compound keyword unknowns | **0** | P2 closed (was 19) |
| Ward in raw but not `abilities[]` | **0** | P4 closed (was 9) |

### Proper keyword grants (working well)

Top trigger-effect hits use real `abilities[]` entries:

| IR step | Keyword | Hits |
|---|---|---:|
| `grant_temporary_ability` | haste | 122 |
| `grant_temporary_ability` | flying | 122 |
| `grant_temporary_ability` | trample | 102 |
| `grant_temporary_ability` | indestructible | 83 |
| `grant_temporary_ability` | first strike | 69 |
| `grant_static_ability` | flying | 37 |

Static combat keywords (flying, trample, haste, indestructible, etc.) are **already identified correctly** in grant clauses at scale.

---

## Three parsing pipelines (know which applies)

```
Full card oracle text
├── Static keyword lines ("Flying", "Trample, ward {2}")
│   └── parseOracleTextToIR → often static ability + unknown step
├── Standalone keyword triggers ("Annihilator 2")
│   └── parseKeywordTriggeredAbility() in oracleTextParserKeywordTriggers.ts
└── Reminder-only lines ("Crew 3 (…)")
    └── pruneLateKeywordReminderOnlyAbilities() strips from full card

Trigger effect fragments (cast/attack/ETB effect text only)
├── Grant clauses ("gains trample until end of turn")
│   └── oracleIRParserTemporaryAbilityClauses / StaticAbilityClauses
├── Orphan tails ("indestructible annihilator 4 (Whenever…)")
│   └── parseStandaloneKeywordFragmentUnknownStep() in postprocess
└── Generic fallbacks (soulshift, dredge, blitz cost bleed)
    └── parseCurrentResidualUnknownStep → grant_static_ability metadata
```

**Rules-engine references** (granted ability semantics):

| Keyword | Type | Module |
|---|---|---|
| Indestructible | Static (702.12) | `rules-engine/src/keywordAbilities/indestructible.ts` |
| Trample | Static combat | `keywordAbilities/trample.ts` |
| Annihilator N | Triggered on attack (702.86) | `rules-engine/src/keywordAbilities/annihilator.ts` |
| Ward {N} | Static triggered cost | `keywordAbilities/ward.ts` |

---

## Target IR shapes

### Static combat keywords

```typescript
{
  kind: 'grant_static_ability', // or grant_temporary_ability
  target: { kind: 'raw', text: 'this permanent' }, // or 'it'
  abilities: ['indestructible'], // or ['trample', 'haste']
  duration: 'static' | 'end_of_turn',
}
```

### Annihilator N (triggered — not a static stub)

Rule 702.86a: *Whenever this creature attacks, defending player sacrifices N permanents.*

```typescript
{
  kind: 'grant_static_ability',
  target: { kind: 'raw', text: 'this permanent' },
  abilities: ['annihilator 4'],
  effectText: ['Whenever this creature attacks, defending player sacrifices 4 permanents of their choice.'],
  steps: [{
    kind: 'sacrifice',
    who: { kind: 'target_opponent' }, // defending player
    what: { kind: 'raw', text: '4 permanents of their choice' },
    raw: 'Defending player sacrifices 4 permanents of their choice.',
  }],
  duration: 'static',
}
```

Implemented in: `parseStandaloneKeywordFragmentUnknownStep()` / `createAnnihilatorGrantStep()` in `oracleIRParserPostprocess.ts`.

### Ward {N}

Prefer `abilities: ['ward 2']` or structured ward cost — not only `effectText`. Compound lines like `Trample, ward {2}` should split into multiple abilities.

---

## Priority clusters (work queue)

### P1 — Annihilator missing attack-trigger metadata ~~(3 hits)~~ **CLOSED**

Grant has `abilities: ['annihilator N']` but **no** `effectText` attack clause and **no** nested `sacrifice` step.

**Fix (2026-06-08):** `enrichAnnihilatorGrantMetadataAbilities()` in postprocess splits annihilator out of combined grant steps and attaches attack-trigger + sacrifice metadata (mirrors `createAnnihilatorGrantStep`). Wired after `lowerCurrentResidualUnknownAbilities` in `oracleIRParser.ts`.

Previously affected: Flayer of Loyalties, Azlask, Idol of False Gods.

---

### P2 — Full-card compound keyword unknowns ~~(19 hits)~~ **CLOSED**

Standalone static lines like `Trample, ward {2}` were `unknown` steps.

**Fix (2026-06-08):** Extended `parseStandaloneKeywordFragmentUnknownStep` to extract `ward {N}` → `abilities: ['ward N']`, handle duplicate prowess, and strip truncated reminder parens.

---

### P4 — Ward not in `abilities[]` ~~(9 hits)~~ **CLOSED**

Ward appeared in `effectText` / raw templating but not structured.

**Fix (2026-06-08):** `parseKeywordAbilityList` in static grant clauses now recognizes `ward {N}`. `enrichWardGrantMetadataAbilities()` postprocess extracts keywords from `with flying and ward {N}` become clauses (e.g. Dancing Sword).

---

### P3 — Full-card static keyword lines unparsed ~~(~400+ ability blocks)~~ **CLOSED (bulk)**

Keyword-only oracle lines (often with reminder parenthetical) become static abilities whose **only** step is `unknown`.

**Fix (2026-06-08):** `expandStandaloneStaticKeywordAbilities()` in postprocess converts keyword-only static lines to `grant_static_ability` with `abilities[]` via `parseStandaloneKeywordFragmentUnknownStep()`. Wired before `pruneExternallyHandledStaticUnknownAbilities`; added `hasStructuredKeywordGrant` guard so expanded grants are not stripped. Fixed banding compound lines (`Trample; banding`) surviving banding reminder prune, and hollow ability recreation from empty-list fallbacks in `expandCastWithoutPayingFallbackAbilities` / `expandStandaloneKeywordCostAbilities`.

**Audit after fix:** Bulk patterns cleared — `Flying` (78), `Trample` (21), `Flying, vigilance` (16), etc. no longer appear. **`full_card_static_keyword_line_unparsed` is 0** (2026-06-08 re-audit).

Remaining **7** full-card keyword-ish unknown steps are non-static edge cases (P6): delayed earthbend trigger, player hexproof, custom Ward-Waterbend, indestructible reminder tails, complex X/trample modal.

| Former pattern | Count | Status |
|---|---:|---|
| `Flying` | 78 | ✅ parsed |
| `Trample` | 21 | ✅ parsed |
| `Flying, vigilance` | 16 | ✅ parsed |
| `Lifelink (Damage dealt…)` | 14 | ✅ parsed |
| `Hexproof (This creature can't…` | 14 | ✅ parsed |
| `Convoke (Your creatures…` | 12 | ✅ parsed (reminder-pruned or grant) |
| `Trample; banding (…)` | — | ✅ parsed |
| `Trample, firebending 4, haste` | 1 | ✅ parsed |
| `Enchant creature without flying` | 2 | ✅ aura restriction metadata |
| Max speed / bloodthirst / station | ~14 | ✅ externally handled (keywords[] or pruned) |

**Edge fixes (2026-06-08):** `firebending N` in compound static lines; enchant-without-flying aura metadata; bloodthirst reminder regex + hollow fallback prune; Katara-style activation-restriction prune; audit false-positive filter (empty-step externals).

---

### P5 — Trigger generic metadata ~~(34 hits)~~ **CLOSED (pass-residual cluster promoted)**

Intentional fallbacks for non-keyword trigger bleed — **not** misclassified flying/trample.

**Fix (2026-06-08):** `parseStructuredKeywordActionGrant()` promotes orphan trigger keyword-action fragments to `grant_static_ability` with `abilities[]`:

| Former metadata | Now |
|---|---|
| `soulshift N`, `dredge N`, `miracle {cost}`, `blitz {cost}` | `abilities: ['soulshift 2']`, etc. |
| `flying crew N`, `crew N cycling {cost}` | Structured multi-keyword `abilities[]` |

**Fix (2026-06-09):** `parseStructuredTriggerResidualGrant()` promotes the documented pass-residual cluster to executable or semantic-target IR:

| Former `pass*` residual | Now |
|---|---|
| `flip this creature/permanent` | `turn_face_up` |
| `flip a coin…` / `flip that many coins` | `flip_coin` |
| `counters remain on this permanent/me…` | `grant_static_ability` on this permanent/card |
| `amass orcs x, where x is…` | `abilities: ['amass orcs x']` |
| `equip-pay …` | `grant_static_ability` on this equipment |
| `any player may exile/discard/pay…` | semantic target `any player` |
| `flying, lifelink … persist` (Eirdu) | split keyword grants |
| Depthshaker Titan animation | `animate_permanent` |

Re-audit: trigger generic metadata **34→25** (original P5 cluster cleared; 25 long-tail pass19/21/32 one-offs remain — copy/count/emblem bleed, not keyword misclassification).

| Bucket | Examples | Status |
|---|---|---|
| ~~`keyword action`~~ | soulshift 2, dredge 2, miracle, blitz, bushido | ✅ promoted |
| ~~`pass19/21/30/32` P5 cluster~~ | flip, any player may…, counters remain, equip-pay | ✅ promoted |
| Long-tail `pass19/21/32` | copy it…, emblem enters, transform bleed | ✅ promoted (P7) |

---

### P7 — Long-tail trigger pass residuals ~~(25 hits)~~ **CLOSED**

**Fix (2026-06-09):** Extended `parseStructuredTriggerResidualGrant()` + `parseStructuredKeywordActionGrant()` with semantic-target grants and keyword splits:

| Former `pass*` residual | Now |
|---|---|
| Copy/counter/emblem bleed | semantic target (`this spell`, `an opponent`, etc.) |
| Transform bleed (`flying as this creature transforms…`) | split `flying` grant + semantic transform clause |
| `entwine {cost}`, `support x`, `crew N`, `then amass orcs N` | structured `abilities[]` |
| `equip-sacrifice …`, `flip N coins` | equipment target / `flip_coin` |
| `flying annihilator N evoke {cost}` | split keyword grants with annihilator metadata |

Re-audit: trigger generic metadata **25→0**.

---

### P6 — Misc full-card keyword unknowns ~~(7 hits)~~ **CLOSED**

**Fix (2026-06-08):** Extended `parseCurrentResidualUnknownStep()` in postprocess:

| Raw | Card | IR shape |
|---|---|---|
| `When that creature dies this turn, you earthbend 4` | Fatal Fissure | `schedule_delayed_trigger` + nested `earthbend` |
| `You gain hexproof until your next turn` | Blossoming Calm | `grant_temporary_ability` on you |
| `Ward-Waterbend {4}` | The Unagi of Kyoshi Island | `grant_static_ability` with `effectText: ['ward—waterbend {4}']` |
| `A creature with indestructible can't be destroyed…` | Aegis Angel, Indestructibility, Anara | Pruned (reminder shard) |
| Spry and Mighty X/trample modal | Spry and Mighty | `draw` + `modify_pt` + `grant_temporary_ability` |

Re-audit: **full-card keyword-ish unknown steps 7→0**.

---

## What batch 66 changed (for context)

| Card | Before | After |
|---|---|---|
| Ulamog | `unknown: indestructible annihilator 4 (…)` | Split: `indestructible` static + `annihilator 4` with attack-trigger metadata |
| Flayer | `unknown: annihilator 2 trample` | Split: `trample` static + `annihilator 2` with metadata |
| Extus | spell cost rider unknown | `grant_static_ability` on this spell |
| Fatal Fissure | `you earthbend 4` unknown | `earthbend` step |
| Tainted Adversary | `twice` orphan | `twice that many` reference_amount |
| Shriveling Rot | entwine modal life misparsed | `grant_temporary_ability` + skip bad life metadata |

---

## Recommended fix order (next sessions)

1. ~~**P1** — Annihilator metadata on all grant paths~~ **done**
2. ~~**P2** — Compound `Keyword, ward {N}` splitter~~ **done**
3. ~~**P4** — “has/have ward {N}” templating~~ **done**
4. ~~**P3** — Keyword-only static line parser (~400 blocks; full-card IR)~~ **done**
5. ~~**P5** — Cherry-pick keyword actions + pass-residual cluster~~ **done**
6. ~~**P6** — Remaining full-card keyword-ish unknowns~~ **done**
7. ~~**P7** — Long-tail trigger pass-residual metadata~~ **done**

---

## Key files

| Area | Path |
|---|---|
| Audit script | `server/scripts/semantic-keyword-audit.ts` |
| Audit JSON | `server/scripts/out/semantic-keyword-audit.json` |
| Orphan keyword fragments | `rules-engine/src/oracleIRParserPostprocess.ts` → `parseStandaloneKeywordFragmentUnknownStep`, `createAnnihilatorGrantStep`, `enrichAnnihilatorGrantMetadataAbilities`, `enrichWardGrantMetadataAbilities`, `expandStandaloneStaticKeywordAbilities`, `hasNonBandingKeywordOnlyStaticText` |
| Static grant ward parsing | `rules-engine/src/oracleIRParserStaticAbilityClauses.ts` → `parseKeywordAbilityList`, `normalizeWardAbilityPart` |
| Static keyword list | `rules-engine/src/oracleIRParserStaticAbilityClauses.ts` → `STATIC_KEYWORD_ABILITIES` |
| Temporary keyword list | `rules-engine/src/oracleIRParserTemporaryAbilityClauses.ts` → `KEYWORD_ABILITIES` |
| Standalone keyword triggers | `rules-engine/src/oracleTextParserKeywordTriggers.ts` |
| Reminder pruning (full card) | `rules-engine/src/oracleIRParserPostprocess.ts` → `pruneLateKeywordReminderOnlyAbilities` |
| Annihilator rules | `rules-engine/src/keywordAbilities/annihilator.ts` |
| Indestructible rules | `rules-engine/src/keywordAbilities/indestructible.ts` |
| Tests | `rules-engine/test/oracleIRParser.test.ts` → `parses standalone keyword fragments…` |

---

## Changelog

- **2026-06-08:** P5 partial — `parseStructuredKeywordActionGrant()` for soulshift/dredge/miracle/blitz/compound crew in trigger effects. Re-audit: trigger generic metadata 34→**30**.
- **2026-06-09:** P7 closed — long-tail pass-residual promotions (copy/counter/emblem, transform bleed, entwine/support/crew/amass, equip-sacrifice, flip N coins, compound flying/annihilator/evoke). Re-audit: trigger generic metadata 25→**0**.
- **2026-06-09:** P5 closed — `parseStructuredTriggerResidualGrant()` for flip/flip_coin/counters remain/equip-pay/amass/any-player/animate/Eirdu persist split. Re-audit: trigger generic metadata 30→**25** (long-tail pass residuals only).
- **2026-06-08:** P6 closed — delayed earthbend, player hexproof, ward-waterbend, indestructible reminder prune, Spry and Mighty X/trample. Re-audit: full-card keyword-ish unknowns **7→0**.
- **2026-06-08:** P3 edge cases closed — firebending compound, enchant restriction, bloodthirst/katara hollow prune, audit false-positive filter. Re-audit: `full_card_static_keyword_line_unparsed` 12→**0**, full-card unknowns 10→**7**.
- **2026-06-08:** P3 closed (bulk) — `expandStandaloneStaticKeywordAbilities` + banding compound fixes. Audit: full-card keyword-ish unknowns 33→10; bulk Flying/Trample/vigilance/lifelink/hexproof clusters cleared.
- **2026-06-08:** P1 closed — `enrichAnnihilatorGrantMetadataAbilities` splits annihilator from grant clauses and attaches attack-trigger metadata. Audit: annihilator missing 3→0, with 2→5.
- **2026-06-09:** Initial semantic keyword audit. Baseline: 0 trigger keyword ir_gaps; 3 annihilator metadata gaps; 19 compound keyword unknowns; ~400 unparsed keyword-only static lines on full card. Added `semantic-keyword-audit.ts`.
