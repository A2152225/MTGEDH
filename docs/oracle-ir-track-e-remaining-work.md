# Oracle IR Track E — Remaining Work & New-Card Automation

**Purpose:** Track post–Track D executor/Layer 3 work and document the path to **seamless automation for cards not yet in the corpus** (new sets, custom cards, novel phrasing).

**Last updated:** 2026-08-27 (Phase 5 depth: War Cadence this-turn / AI block tax / Island Sanctuary skip-draw; do not flip vitest.setup.ts unless asked)

**Read first:** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) · [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md) · `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc` · `.cursor/rules/oracle-ir-compiled-overlay.mdc`

**Next session:** Copy the prompt at the top of [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) (Phase 4 closed; census 0 failed / 243; setup stays PRIMARY=0; real EDH tables / telemetry; TRIGGER_PRIMARY later).

## Goal: Semantic atomic parsing + seamless effect automation (new cards)

**Target behavior:** When a player adds a card whose oracle text is **not yet handled by the regex parser**, the game should still resolve it automatically whenever the effect decomposes into **wired `OracleEffectStep` verbs**, pausing only for **real player choices** (targets, modes, optional may, library ordering, etc.).

**Assumption:** New-set **keyword actions** and reminder templates are reflected in the repo’s **Comprehensive Rules** snapshot and/or `oracle-cards.json` oracle text (including parenthetical reminders). The engine does not invent keyword definitions from training data.

**Atomic semantics:** Each effect clause becomes an ordered list of typed steps (`draw`, `move_zone`, `conditional`, `choose_mode`, …) — not card-name handlers. See [oracle-ir-architecture-guide.md](./oracle-ir-architecture-guide.md).

### Architecture direction (2026-07-02 review)

The step-based IR pipeline is confirmed as the end-state architecture. Five standing decisions from the review (details in [oracle-ir-architecture-guide.md §15](./oracle-ir-architecture-guide.md)):

1. **Overlay-first ingestion** — compiled overlays are the *default* path for new/changed cards; parser batches are reserved for phrasing that recurs across many cards (§C decision tree below is inverted accordingly). The regex parser is treated as a frozen bootstrapping asset, not the primary growth surface.
2. **Delta CI (D1 — done)** — `npm run oracle-ir:delta` diffs `oracle-cards.json` against a committed hash baseline, audits only new/changed cards, emits an overlay work queue, and fails CI on new gaps.
3. **Gap telemetry (D2 — done)** — `oracleIrGapTelemetry.ts` records all-or-nothing failures, owned-but-unhandled misses, and legacy-handled executions; snapshot at `GET /api/oracle-ir/telemetry`.
4. **Legacy retirement ratchet (D3)** — `tests/oracle-ir-legacy-handler-ratchet.unit.test.ts` fails if legacy handler exports rise; `legacy_handled` telemetry identifies which handlers still fire in production so deletion is evidence-driven, not speculative.
5. **Undo/replay guardrail** — `tests/helpers/replayDivergence.ts` replays the persisted event log into a fresh game and asserts projection equality with live state; adopt opportunistically in socket integration tests.

**Phase 5 ceiling:** continuous/replacement effects (layers) are the one class the step IR cannot express; design doc: [oracle-ir-phase5-continuous-effects-design.md](./oracle-ir-phase5-continuous-effects-design.md).

### End-to-end pipeline (what “done” looks like)

```
oracle text (+ optional compiled overlay)
  → collectOracleEffectSteps (parser, then overlay merge if gap)
  → applyOracleIRStepsOnServer / Effect Program
  → resolution queue (choices only)
  → submitResolutionResponse resume
  → zone sync + compound tail
```

For **new cards**, step collection may hit the overlay **before** a parser batch lands; live execution uses the **same** server path as the 47k-card corpus.

---

### What is already done (supports new-card automation today)

| Layer | Capability | Status |
|-------|------------|--------|
| **L1 Parse** | Regex + postprocess for ~30k commander-legal cards | ✅ Corpus green |
| **L1 Parse (gap path)** | Compiled overlay merge (`oracleIRCompilerEnvelope`, SQLite `oracle_ir_compiled_overlay`) | ✅ Runtime wired |
| **L2 Execute** | Dry-run applies all wired step kinds; trigger + full_card audits | ✅ 100% assisted, 0 `ir_gap` |
| **L2 Keywords** | Keyword semantic audit (static vs triggered shape) | ✅ 0 open clusters on corpus |
| **L3 Integrate** | IR primary for spells/triggers/activated (`ORACLE_IR_*_PRIMARY` on) | ✅ Beta-ready |
| **L3 Choices** | Queue + resume for scry/surveil/discard/unless-pay/library search/EP (fateseal, clash, choose_mode) + **VOTE** (council / secret council) | ✅ Migration suite + ~26 socket tests; vote Layer 3 in `oracle-ir-vote-end-combat.integration.test.ts` |
| **L3 Overlays** | Probe / validate / import / upsert scripts; `@OracleIRCompiler` agent | ✅ In migration suite (batch 458) |
| **Data refresh** | `npm run card-lookup:refresh` — oracle index + local SQLite rebuild | ✅ Script exists |
| **Trigger detect** | `trigger:coverage` — timing phrases fire on server | ✅ 15,741/15,741 |
| **Live seams** | `oracle-ir:live-seam` — lords / compound timings / watchers / exile-GY | ⬜ Catch false greens that assisted IR dry-run misses |

**Bottom line:** For a **new card whose effects map to existing step kinds**, you can often ship **same-day automation** via a compiled overlay + optional integration test, without bespoke server handlers.

---

### What is still needed (to meet the overall expectation)

Work falls into **operational workflow** (repeat each set), **keyword onboarding** (when rules add mechanics), and **platform gaps** (things overlays cannot fix alone).

#### A. Per–new-set operator workflow (required each release)

The delta audit (D1) now automates steps 2–3 for the changed cards only:

| Step | Command / action | Why |
|------|------------------|-----|
| 1 | Drop refreshed `oracle-cards*.json`, rules txt; `cd server && npm run card-lookup:refresh` | Local oracle + `card-lookup.sqlite` must match Scryfall |
| 2 | `npm run oracle-ir:delta` | **Delta CI (D1):** audits only new/changed cards vs baseline; emits `overlayWorkQueue` in `scripts/out/oracle-delta-coverage-audit.json`; non-zero exit on gaps |
| 3 | Per work-queue card: `npm run oracle-ir:overlay:probe -- --name "Card Name"` → **overlay** (default) | See decision tree below; each entry carries a `suggestedAction` |
| 4 | `npm run executor:keyword-audit` when the set adds keyword/reminder shapes | New keyword reminder shapes vs static/triggered IR |
| 5 | Targeted socket/integration test if new **choice** shape | Layer 3 resume proof |
| 6 | `npm run oracle-ir:delta -- --update-baseline` once green | Accept the set into the baseline (`scripts/oracle-delta-baseline.json`, committed) |
| 7 | Live EDH soak; watch `GET /api/oracle-ir/telemetry` (D2). Scripted: [oracle-ir-smoke-soak.md](./oracle-ir-smoke-soak.md) (`npm run oracle-ir:smoke` in-process, `--live` / `npm run oracle-ir:smoke:live` on the running server) | Catches compound/stack edge cases audits miss |

Full-corpus audits (`executor:coverage`, `trigger:coverage`) remain for parser/executor changes; the delta path is for set releases.

#### B. New keyword from Comprehensive Rules (implementation tasks)

When a set introduces a **keyword action** or changes reminder text, expect **rules-engine + optional server** work:

| Task | Owner module / area | Done when |
|------|---------------------|-----------|
| **B1** Keyword action IR | `rules-engine/src/keywordActions/<name>.ts` + exports | Oracle reminder expands to wired steps |
| **B2** Parser / reminder hook | `oracleReminderText.ts`, `oracleTextParserKeyword*.ts` | Full-card + trigger fragments parse without `unknown` |
| **B3** Effect Program registry (if modal/choice keyword) | `effectProgramKeywordRegistry.ts` | EP can orchestrate multi-step keyword flow |
| **B4** Executor step handler (if new **step kind**) | `oracleIRExecutor*.ts`, add to `ORACLE_IR_FALLBACK_STEP_KINDS` | Dry-run applies; audit green |
| **B5** Server queue bridge (if player choice) | `oracleIrServerZoneSync.ts`, `resolution.ts` | Prompt queues + `submitResolutionResponse` resumes |
| **B6** Trigger detection (if triggered keyword) | `triggered-abilities.ts`, `triggeredAbilitiesParsing.ts` | `trigger:coverage` green for timing phrase |
| **B7** Tests | `rules-engine/test/oracleIRGapBatch*.test.ts` + `server/tests/oracle-ir-*.integration.test.ts` | Regression + Layer 3 if visible |
| **B8** Re-run keyword audit | `npm run executor:keyword-audit` | 0 new semantic-metadata regressions |

**If B4 introduces a step kind not in the wired set**, overlays cannot help until B4–B5 complete — set `fallback_to_bespoke: true` until then.

#### C. Overlay vs parser decision tree (overlay-first — inverted 2026-07-02)

**Default for any new/changed card: compiled overlay.** Overlays are reviewable data (JSON steps), auditable by the same executor dry-run, and carry zero regex-regression risk. Parser batches are the *exception*, justified only by recurring phrasing.

| Situation | Path | Notes |
|-----------|------|-------|
| New / changed / custom / preview card (default) | **Compiled overlay** | `@OracleIRCompiler` → validate → import; same-day automation |
| Same phrasing recurs across many cards (overlay cluster evidence) | **Parser batch** | Extend `oracleIRParserPostprocess` / clause module; then delete the redundant overlays |
| Multi-step modal / unless / EP chain | Overlay or parser → **Effect Program** | `requiresEffectProgramOrchestration` |
| Trigger timing phrase not detected | **Detector extension (B6/D5)** | Overlay cannot make a trigger fire |
| Replacement layer / continuous effect / unimplemented kind | `fallback_to_bespoke: true` | Manual ack; Phase 5 design ([design doc](./oracle-ir-phase5-continuous-effects-design.md)) |

Overlays are **cached atomic IR**, not a second rules engine. Prefer native `OracleEffectStep` in overlay JSON (see `.cursor/rules/oracle-ir-compiled-overlay.mdc`). The delta audit's `overlayWorkQueue` applies this tree automatically per gap reason.

#### D. Platform gaps (block “seamless” even with overlays)

These are the **main engineering tasks** still open for the *overall* new-card expectation:

| ID | Gap | Impact on new cards | Suggested work |
|----|-----|---------------------|----------------|
| **D1** | ✅ **Done (batch 466)** — delta CI: `npm run oracle-ir:delta` | Regressions on new cards caught automatically | `scripts/oracle-delta-coverage-audit.ts` — hash baseline diff → executor dry-run + trigger detection on delta only → `overlayWorkQueue` → non-zero exit on gaps. Baseline: `scripts/oracle-delta-baseline.json` (committed); `--update-baseline` to accept |
| **D2** | ✅ **Done (batch 466)** — production gap telemetry | Live misses visible without player reports | `oracleIrGapTelemetry.ts`: `all_or_nothing_failure` (from `logOracleIrAllOrNothingFailure`), `owned_but_unhandled` (trigger tail + spell categorize gates), `legacy_handled` (retirement triage). Snapshot: `GET /api/oracle-ir/telemetry`; deduped console warns independent of `DEBUG_STATE` |
| **D3** | ✅ **Done** — `applyRetiredTriggerLegacy*` ratchet **0**; soak 0 exports | Dual-apply risk from retired export handlers closed | Phase 4 IR-primary dual-path collapse is **done**. `categorizeSpell` / `executeSpellEffect` remain for PRIMARY=0 opt-out until the harness flip |
| **D4** | **Unwired step kinds** | Overlay must set `fallback_to_bespoke` | Extend executor + server queue; document in OracleIRCompiler “allowed kinds” |
| **D5** | **Trigger timing not in detector tables** | Card parses but never fires, **or** ETB regex swallows `or …` as the effect (Tivit class) | ✅ ETB swallow + other-event fire closed; morph face-up live emission via `processFaceUpTriggers`. Haunt targeting stamps exile IDs. |
| **D6** | **Client UI for novel choice types** | Server queues step client cannot render | **Partial (batch 468 + Aug 2026):** VOTE queue/resume wired; Season `{P}` budget UX shipped (`ModalSpellSelectionModal` + `modeSelectionPBudget`). Prefer generic primitives over per-step modals |
| **D7** | **Phase 5 special systems** | PW loyalty, supplemental oracle, continuous/replacement layers | Design doc: [oracle-ir-phase5-continuous-effects-design.md](./oracle-ir-phase5-continuous-effects-design.md); migration plan Phase 5 |
| **D8** | **Overlay storage ops** | Overlays not in repo by default (`server/data/compiled-oracle-ir-overlays/`) | Process for committing set overlays vs per-environment SQLite; optional bulk import in deploy |
| **D9** | **Rules txt ↔ keywordActions sync** | New CR keyword without code path | Checklist tying `docs/rules/MagicCompRules_*.txt` §702 entries to B1–B8 |

#### E. Layer / track map (no E15 — use phases for end-state)

| Name | Scope | Status |
|------|-------|--------|
| **Layers 1–2** | Parse + execute corpus | ✅ Complete |
| **Layer 3 E6–E8** | Live IR + sockets + EP | ✅ Beta-ready |
| **E9+ / D3** | `applyRetiredTriggerLegacy*` export retirement | ✅ **Complete** (ceiling **0**; soak 0 exports); migration **889/889** |
| **Phase 4** | Infrastructure dual-path collapse (`categorizeSpell`, uncategorized fallbacks, riders) | ✅ **Closed under IR primary** — Sevinne GY-cast copy IR-owned (may-only then-branch complete); PRIMARY=1 special-case no Rite window fill / Summons replay amass-mill; PRIMARY=0 trampolines leftover families to IR. Bounded SPELL_PRIMARY=1 census **0 failed / 243**. Do not flip `vitest.setup.ts` unless asked. Kept for PRIMARY=0 opt-out: `categorizeSpell` / `executeSpellEffect`, thin uncategorized fallback. Stack-targeting opcodes stay until Phase 5. Remaining outside Phase 4: real EDH tables / telemetry |
| **Phase 5** | PW loyalty + continuous/replacement **depth** | **5.1–5.5 landed** plus 2026-08-25 depth (see prior bullets) and **2026-08-27:** one-shot `cant_attack`; unused `librarySearchEffects` `KNOWN_*` deleted; Pacifism + mass Moat/Bridge/Peacekeeper/type-you-control `StaticEffectSpec`; life-loss on player damage; `floorLifeAt` through `evaluateDamageReplacementEvent` (cap-only); empty `KNOWN_STATIC_EFFECT_CARDS` deleted. PW IR **925/926**. |

There is **no planned Track F or E15**. New-card work uses **§A workflow + B/C/D tasks** above.

---

### Quick reference: new card with automation gap

```powershell
cd server
npm run card-lookup:refresh
npm run oracle-ir:overlay:probe -- --name "New Card Name"
# If probe shows unknown / incomplete:
#   compile → server/data/compiled-oracle-ir-overlays/<card>.json
npm run oracle-ir:overlay:validate -- --file data/compiled-oracle-ir-overlays/<card>.json --compare-parser
npm run oracle-ir:overlay:import
npx vitest run tests/oracle-ir-compiled-overlay.integration.test.ts --pool=threads --maxWorkers=1
# If new choice shape: add server/tests/oracle-ir-<pattern>.socket.integration.test.ts
npm run test:oracle-ir-migration -- --pool=threads --maxWorkers=1
```

Agent: `.github/agents/OracleIRCompiler.agent.md`

---

<a id="ir-live-readiness-aug-2026"></a>
## IR live-readiness (Aug 2026) — Layer 1–3 gaps on the IR primary path

These are **in-scope migration work** that does not always move the usual metrics (migration test count, D3 ratchet). They close holes the Layer 3 “beta-ready” story assumed were already green.

| Batch | Layer | Deliverable | Key files / tests |
|-------|-------|-------------|-------------------|
| **Spell-static typing** | L1 | `isSpellInstructionLine` + mode/ability-word leads so instant/sorcery effects collect as SPELL (Brave-class drops ~354 → ~12; EDH hits **0**) | `oracleTextParser.ts`, `spell-static-drop-audit.ts`, `oracleTextParserAbilityType.test.ts` |
| **Instead-fold + cast costs** | L1–2 + cast | Threshold/Delirium “instead” conditional fold; delirium/void/vivid cost reduction on cast path | `oracleIRParserPostprocess.ts`, `delirium-void-vivid-cost-reduction.unit.test.ts`, `oracleIRInsteadConditionalFold.test.ts` |
| **Spree/Tiered resolve scope** | L3 | Shared `additionalCostModeOracleText` — cast + IR resolve use same selected-mode oracle (no over-execution) | `additionalCostModeOracleText.ts`, `stackResolveSpellOracleIrUtils.ts`, `game-actions.ts` |
| **Season `{P}` / Urza modes** | L1–2 | `choose_mode` with `pBudget` / `canRepeatModes` / per-mode `pCost`; Urza recovery no outer mode duplication | `oracleIRParserChooseMode.ts`, `oracleIRExecutorChooseModeStepHandlers.ts`, `oracleIRChooseModeUrzaSeason.test.ts` |
| **`end_combat_phase`** | L2–3 | Parse/execute “End the combat phase”; wired in fallback + Effect Program kinds; server apply | `oracleIRExecutorTurnStepHandlers.ts`, `trigger-runtime-wiring.ts`, `oracle-ir-vote-end-combat.integration.test.ts` |
| **Council / Secret council `vote`** | L2–3 | Extended `vote` (`secret`, `ballot`, `ballotFilter`); `votes_received` quantity; APNAP `VOTE` queue + IR resume; voter-relative “another player” ballots; `vote` in `HALT_ON_PLAYER_CHOICE_STEP_KINDS` so follow-ons resume | `oracleIrServerZoneSync.ts`, `resolution.ts` `handleVoteResponse`, `oracleIRExecutorMainLoop.ts`, same integration test |
| **Season `{P}` D6 UX** | L3 + client | MODE_SELECTION carries `pBudget`/`pCost`/`canRepeatModes`; modal spends budget with repeats; server validates; AI greedy fill | `shared/src/modeSelectionPBudget.ts`, `ModalSpellSelectionModal.tsx`, `game-actions.ts`, `resolution.ts`, `ai.ts` |
| **Live soak + board-context** | L3 + AI | Scripted commander table free-cast (`npm run oracle-ir:smoke:live`) **51/51**, live D2 **0**. Shared `spellCastBoardContext` so AI skips no-op casts and soak provisions the same gaps. Tivit compound ETB timing; Jays vote-scaled draw; Rime Chill up-to tap | `oracleIrLiveSoak.ts`, `spellCastBoardContext.ts`, `triggered-abilities.ts` |

**Operator note:** Re-run `npx tsx scripts/spell-static-drop-audit.ts` after parser lead changes. Remaining non-EDH/Un-set noise is expected; prefer overlay or targeted leads only for black-border EDH regressions.

**Still open after this arc:**
- ~~Season `{P}` client budget UX~~ ✅
- ~~Spell-static EDH hits~~ ✅ **edhHitCount 0** (audit remainder = Un-set only: Six-Sided Die, Strategy Schmategy, You're in Command)
- ~~Scripted live EDH soak~~ ✅ `npm run oracle-ir:smoke:live` **51/51**, live D2 **0** (2026-08-12). Real multiplayer tables still needed for timing/mana/UX gaps.
- Compound `enters or …` trigger-detector audit (Tivit class — D5)
  - ~~ETB effect swallow~~ ✅ commander-legal **208** compounds, **0** swallowed ETB effects (2026-08-12)
  - ~~Other-event fire paths~~ ✅ artifact LTB/GY, monstrous, tapped, haunt. Morph face-up live emission via `processFaceUpTriggers` (2026-08-13).
- ~~Phase 4 uncategorized fallback allowlist~~ ✅ collapsed onto `isTriggerStepRuntimeWired` (`unknown` stays out).
- ~~Phase 4 `categorizeSpell` cast-time targeting dual-path~~ ✅ IR-primary uses `parseTargetRequirements` plus leftover restriction types / compound `orStat` / Atraxa's Fall multi-type / `hasValidTargetsForSpell` filters. Choice families + Nibelheim Aflame IR-owned; uncategorized Nibelheim short-circuit dropped. PRIMARY=0 Nibelheim / Approach / Divine / Prisoner / Summons / Rite trampoline to IR. Divine/Prisoner prompt queue extracted from special-case (`oracleIrServerChooseDestroyRestSecretDamagePrompts.ts`). Look/search library prompts ✅ Memory Deluge `look_select_top` / Genesis Wave `look_choose` rest GY / Siphon Insight opponent exile face-down (live flashback). Deferred flashback exile while a prompt is open ✅ tests accept PRIMARY=0 immediate exile or PRIMARY=1 `oracleIrDeferredFinalize` (CR 608.2m). Sevinne GY-cast copy ✅ IR-owned (may-only then-branch). PRIMARY=1 special-case ✅ no Rite/Summons fills. Bounded SPELL_PRIMARY=1 census ✅ **0 failed / 243**; do not flip `vitest.setup.ts` default unless asked. Phase 4 closed under IR primary.
- ~~Phase 5 leftover static parse (Saryth tap/untap, lure, lose-keyword / Glaring Spotlight as-though)~~ ✅ `StaticEffectSpec`. Targeting lose vs as-though + player hexproof ✅. Lure all-able vs at-least-one + Impetus/Indrik/Gift/Noble Quarry/named-self ✅. Masamune first strike + idle leak closed + Frodo/threshold/equipped ✅. Typed `must_be_blocked_by_<keyword>` ✅. Raid `source_controller_attacked_this_turn` ✅. Shalai you/planeswalkers/other-creatures ✅. Nowhere to Run ward skip ✅. Until-EOT hexproof activations ✅ Detection Tower as-though / Arcane Lighthouse lose stamp `lastingEffects.protectionKeywordOverride` (idle land stays not a continuous static)
- ~~Phase 5 `WIN_CONDITIONS` name table~~ ✅ oracle scan. Maze's End unique-name win ✅ IR. Approach same-name-cast-this-game ✅ IR (persist ledger at live cast + GY/castSpell replay + `copyStackItem` + live/IR/delayed copies + optionChoice fallback `stack.push`). Then-if / Darksteel scan ✅. Rules-engine `checkWinConditions` + live `runSBA` + adapter `checkWinConditionsForState` apply `immediate`. Hedron Alignment may-reveal ✅ IR choice family (not auto-scan)
- ~~Phase 5 `LIFE_MODIFIERS` name table~~ ✅ oracle + `ReplacementEffectSpec`. Bloodletter `life-loss` double ✅. Enchanted-player / singular-opponent can't-gain ✅. `canPlayerPayLife` on cast/activate/ward ✅. Shock-land + remaining production `validateLifePayment` `ctx` ✅. This-turn spell/ability “can't gain life” stamps `lastingEffects.preventLifeGain` ✅ including leading until-EOT activations. Cleanup expires this-turn stamps (`duration: 'game'` rest-of-game stays).
- ~~Phase 5 leftover: 1 unwired loyalty line (Davriel, Soul Broker Alchemy offers/conditions)~~ left unwired by design; coverage 925/926
- Generic haunt targeting stamps `hauntingPermanentId` on the exiled card (2026-08-13)
- ~~Phase 5 life-gain amount-modify~~ ✅ double / plus-1 oracle-pattern specs; `applyLifeGain` no longer card-name routes
- ~~Delayed-return face-up emission~~ ✅ `turnReturnedPermanentFaceUp`
- ~~Phase 5 draw extra-card replacements~~ ✅ Thought Reflection / Archive except-first-draw-step oracle-pattern specs; `drawCards` uses `summarizeDrawAmountReplacements`
- ~~Phase 5 PW emblem IR~~ ✅ `create_emblem` in fallback; `state.emblems` sync; coverage jsonl **833/887 (93.9%)** IR-wired
- ~~processLifeChange card-name life-gain~~ ✅ oracle-pattern specs
- ~~Phase 5 remaining PW IR kinds~~ ✅ `gain_control` / `grant_exile_permission` / `skip_next_untap` in fallback; loyalty **864/887 (97.4%)**
- ~~Token doubling card-name detectors~~ ✅ oracle-pattern specs (controller double / global double / creature triple)
- ~~Phase 5 leftover PW executor kinds~~ ✅ `flip_coin` / `phase_out` / `venture_into_dungeon` / `exchange_control` / `add_types` / until-next-turn P/T; loyalty **878/887 (99.0%)**
- ~~Counter detect card-name rows~~ ✅ oracle-pattern specs (global +1/+1 double / any-counter plus-one)
- ~~Phase 5 leftover loyalty residual parse~~ ✅ compound until-next-turn P/T+keyword, whenever-until-next-turn, modal `+X/+X or -X/-X`, perpetual, animate, GY+ward; loyalty **886/887 (99.9%)**
- ~~Mill detect card-name rows~~ ✅ oracle-pattern specs (opponent mill double / plus-four)
- ~~Library-search card-name rows~~ ✅ oracle-pattern specs (prevent / pay-to-search / top-four / control / search trigger)
- ~~Unused `librarySearchEffects` `KNOWN_*` table~~ ✅ `detectSearchRestrictions` is oracle-only (pay-to-ignore, can't-cause-search, opponent-controls, top-N, whenever-search, this-turn duration). Live search remains `evaluateLibrarySearchReplacementEvent`.
- ~~One-shot `cant_attack` unwired canary~~ ✅ in `ORACLE_IR_FALLBACK_STEP_KINDS` next to `cant_block`; this-turn stamps honor combat via `temporaryEffects` / `hasBlanketCantAttack`.
- ~~Pacifism-style host combat locks~~ ✅ `StaticEffectSpec` `"can't attack"` / `"can't block"` on enchanted/equipped host; live `combatLegalityGates` + `combat-mechanics` consume grants. Pillowfort attack-you tax is oracle `attackYouTaxGeneric`. Elephant Grass color-gated tax/prohibition, Blazing Archon, Form of the Dragon / Sandwurm keyword gates, Reverence power-at-most, Combat Calligrapher type, Vow/Spectral Grasp/Assault Suit host, Teferi's Moat chosen-color, and Eriette aura-you-control evaluate per attacker. Crawlspace `attackYouMaxAttackers`. Silent Arbiter / Dueling Grounds / Caverns of Despair `maxAttackersEachCombat` and `maxBlockersEachCombat`. Archangel of Tithes `blockTaxGeneric` while attacking. War Tax / War Cadence this-turn stamps `attackTaxGeneric` / `blockTaxGeneric`. Island Sanctuary skip-draw replacement stamps except-flying/islandwalk.
- ~~Life-loss registry on player damage~~ ✅ `processLifeChange` / `resolvePlayerDamage` call `evaluateLifeLossReplacementEvent` (Bloodletter doubles damage-caused life loss).
- ~~Worship / Fortune Thief `floorLifeAt` dual-path~~ ✅ `evaluateDamageReplacementEvent` applies cap-only from `detectDamageReplacementEffects`. Furnace/Gisela amount-modify stays on `calculateModifiedDamage`.
- ~~Empty `KNOWN_STATIC_EFFECT_CARDS` shell~~ ✅ deleted; statics remain oracle `StaticEffectSpec`.
- ~~Mass Moat/Bridge combat locks~~ ✅ `StaticEffectSpec` (without/with keyword, power vs hand, all-creatures Peacekeeper, type-you-control). Live declare passes game state for hand size.
- ~~PRIMARY=0 Counterspell own-spell skip~~ ✅ `evaluateTargeting` `COUNTER_TARGET_SPELL` includes the caster's stack spell. Replay `applyEvent` `CounterSpell` kept.
- ~~`ADDITIONAL_LAND_PLAY_CARDS` name table~~ ✅ extra land drops are oracle-only; station extra land still via `getActiveStationAbilities`.
- ~~`ADDITIONAL_DRAW_CARDS` name table~~ ✅ mandatory draw-step extra cards are oracle-only. Optional you-may / compound then-discard stay on the stack.
- ~~`TOP_OF_LIBRARY_CARDS` name table~~ ✅ look / play lands / cast from top are oracle-only. Durable library permissions still apply.
- ~~`HAND_REVEAL_CARDS` name table~~ ✅ static Telepathy/Revelation grants are oracle-only. Look-at-hand activations are not ongoing grants.
- ~~`TEMPORARY_LAND_PLAY_SPELLS` name table~~ ✅ this-turn extra land drops are oracle-only. Growth Spiral put-onto-battlefield and Wayward continuous extras are not this-turn spell bonuses.
- ~~Combat prevent-and-mill first-match table~~ ✅ Mindskinner-family parse from oracle
- ~~Szadek-style source-self combat replace~~ ✅ instead +1/+1 on source + mill that player (not controller-wide)
- ~~Vigor creature-damage card-name~~ ✅ another-creature prevent + +1/+1 per 1 prevented (oracle pattern)
- Phase 5 leftover: Davriel, Soul Broker Alchemy offers/conditions — **left unwired by design** (coverage 925/926)

---

## Track E — batch 466 (D1 delta CI + D2 gap telemetry + ratchet + replay guardrail)

Implements the 2026-07-02 architecture-review decisions:

| Deliverable | Files | Verification |
|-------------|-------|--------------|
| **D2 telemetry module** | `server/src/state/modules/oracleIrGapTelemetry.ts` — counters, 200-event ring buffer, snapshot/reset API; deduped `console.warn` independent of `DEBUG_STATE` (`ORACLE_IR_GAP_TELEMETRY_LOG=0` to silence) | `tests/oracle-ir-gap-telemetry.unit.test.ts` (6 tests) |
| **D2 hooks** | `logOracleIrAllOrNothingFailure` (all scopes; now also tolerates string `reasons`), trigger tail `owned_but_unhandled` (`stackExecuteTriggerEffectTailUtils.ts`), spell categorize `owned_but_unhandled` + `legacy_handled` (`stackResolveSpellOracleIrUtils.ts`), trigger `legacy_handled` per family (`stackExecuteTriggerEffectUtils.ts`, gated on IR primary) | same |
| **D2 endpoint** | `GET /api/oracle-ir/telemetry` (`server/src/index.ts`) | manual / live soak |
| **D1 delta audit** | `scripts/oracle-delta-coverage-audit.ts` + `scripts/oracleDeltaAuditUtils.ts`; npm script `oracle-ir:delta`; baseline `scripts/oracle-delta-baseline.json` (31,318 cards, committed ~2.4 MB); report + `overlayWorkQueue` → `scripts/out/oracle-delta-coverage-audit.json` | `tests/oracle-delta-audit-utils.unit.test.ts`; bootstrap + simulated 3-card delta runs green |
| **D3 ratchet** | `tests/oracle-ir-legacy-handler-ratchet.unit.test.ts` — ceiling **76** trigger legacy exports (lowered from 86); fails on rise | ratchet test |
| **Replay guardrail** | `tests/helpers/replayDivergence.ts` (projection compare + `toReplayEvents`) + `tests/replay-divergence.guardrail.integration.test.ts` (IR-primary draw spell: live vs replayed event log) | guardrail test |

---

## Track E — batch 469 (telemetry soak IR gap fixes)

Fixes from pre-soak telemetry (`all_or_nothing_failure` / `owned_but_unhandled` on prepared, Opt/Consider, station, Broodship):

| Gap | Fix | Verification |
|-----|-----|--------------|
| **Conditional wrapper** | Push outer `conditional` to `appliedSteps` when condition true; treat false branch as applied (not skipped mandatory) | `prepared.trigger-primary.integration.test.ts` (4/4); Broodship (11/11) |
| **Scry/surveil + draw** | `drawEffectSynced()` exempts queue-bridged compound (draw deferred to resume JSON) | `oracle-ir-scry-surveil.integration.test.ts` (43/43) |
| **Station `this spacecraft`** | Self-target reference in `parseContextualBattlefieldReference` | `oracle-ir-station-charge-counters.integration.test.ts` (2/2) |
| **Station threshold** | Re-fetch permanent after IR apply before `stationed` / threshold check | same |

**Next:** re-run soak with `ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT` and compare event counts vs pre-469 baseline.

---

## Track E — batch 468 (D3 legacy deletion start + D6 choice primitives)

| Deliverable | Files | Verification |
|-------------|-------|--------------|
| **D3 deletions (10)** | Orphan mill/target handlers; unreachable stubs; wired no-ops (`CreateCreatureToken`, `DistributeCounters`, etc.) | Ratchet **86 → 76** |
| **D3 triage** | `scripts/oracle-ir-legacy-triage.ts`, `oracle-ir-legacy-triage-soak.ts`; transitive closure from execution roots | `npm run oracle-ir:legacy-triage` |
| **D2 JSONL soak** | `oracleIrGapTelemetry.ts` append log survives test reset | `oracle-ir-gap-telemetry.unit.test.ts` |
| **D6 client** | `client/src/utils/resolutionChoicePrimitives.ts`, `App.tsx`, 5 unit tests | `client/tests/resolutionChoicePrimitives.test.ts` |
| **Migration** | Full suite | **811/811** |

---

## Audit refresh (2026-06-29)

Regenerated all coverage reports after batches 431–435 (would-enter arc).

| Audit | Result |
|-------|--------|
| **Executor** (`EXECUTOR_COVERAGE_SCOPE=full_card`) | **47,514** items on **29,614** cards — **100%** assisted (45,608 fully applied + 1,906 choice-required); parse→execute **0**; `partial` **0**; `ir_gap` **0** |
| **Trigger** (`npm run trigger:coverage`) | **15,741/15,741** fully covered; `not_detected` **0** |
| **Selector gaps** | **0** clusters (`executor-fullcard-selector-gap-analysis.ts`) |
| **Condition gaps** | **0** clusters (`executor-fullcard-condition-gap-analysis.ts`) |
| **Amount gaps** | **0** clusters (`executor-amount-gap-analysis.ts`) |
| **Target gaps** | **0** clusters (`executor-target-gap-analysis.ts`, batch 437) |
| **Migration bar** | **811/811** (`npm run test:oracle-ir-migration`, batches 454–469 + E8/E9) |

Reports: `server/scripts/out/executor-coverage-audit.json`, `trigger-coverage-audit.json`, `executor-*-gap-analysis.json` (gitignored; regenerate locally).

**Waterbender Ascension (2026-06-30):** trigger effect boundary at `Waterbend {4}:`; `grant_temporary_ability` target binding; integration `oracle-ir-waterbender-activated.integration.test.ts` + socket `waterbender-activated.socket.integration.test.ts`.

---

## Compiled Oracle IR overlays (2026-06-29)

Runtime path for **new/custom cards** when `parseOracleTextToIR` leaves `unknown` steps but wired verbs exist.

| Item | Status |
|------|--------|
| `rules-engine/src/oracleIRCompilerEnvelope.ts` — merge overlay into step collection | ✅ |
| SQLite `oracle_ir_compiled_overlay` + import/validate/probe scripts | ✅ |
| Server hook: `collectOracleEffectSteps` + spell/trigger/activated entrypoints | ✅ |
| Agent: `.github/agents/OracleIRCompiler.agent.md` | ✅ |
| Rule: `.cursor/rules/oracle-ir-compiled-overlay.mdc` | ✅ |
| Tests: `oracle-ir-compiled-overlay*.test.ts`, `oracle-ir-overlay-*.test.ts` | ✅ |

**Operator workflow (`cd server`):**

```powershell
npm run oracle-ir:overlay:probe -- --name "Card Name"
npm run oracle-ir:overlay:validate -- --file data/compiled-oracle-ir-overlays/<card>.json --compare-parser
npm run oracle-ir:overlay:import
```

Does **not** change Layer 2 audit metrics (corpus already 100% assisted). Use before parser batches for new oracle phrasing.

---

## Track E — batch 430 (final trigger coverage `not_detected` gaps)

| Item | Status |
|------|--------|
| Tribal `whenever a Human deals damage to you` in `detectDealtDamageTriggers` | ✅ |
| `explore-clash` keyword action + continuation preserved in effect normalization | ✅ |
| `if you win` continuation sentence in trigger effect extraction | ✅ |
| `not_detected` trigger gaps | **2 → 0** (15,741/15,741 fully covered) |
| Migration bar | **752/752** (unchanged) |

**Key files:** `triggered-abilities.ts`, `oracleReminderText.ts`, `triggerEffectTextExtraction.ts`, `trigger-coverage-audit.probe.unit.test.ts`

---

## Track E — batch 429 (support keyword ETB effect preservation)

| Item | Status |
|------|--------|
| `stripKeywordAbilitySuffixes` preserves standalone `support N` / `fabricate N` etc. as gameplay effects | ✅ |
| `detectETBTriggers` + trigger parser retain support ETB effects (Expedition Raptor cluster) | ✅ |
| `not_detected` trigger gaps | **12 → 2** (Mikaeus, Merfolk Surveyor remain) |
| Migration bar | **752/752** (unchanged) |

**Key files:** `oracleReminderText.ts`, `oracleReminderText.test.ts`, `trigger-coverage-audit.probe.unit.test.ts`

---

## Track E — batch 428 (trigger coverage audit probe metadata)

| Item | Status |
|------|--------|
| `buildAuditProbePermanent` seeds `chosenCreatureType` / land / card-name when oracle chooses | ✅ |
| `serverDetectsTrigger` + detector helpers use probe permanent instead of bare `FAKE_PERMANENT` | ✅ |
| `not_detected` trigger gaps | **15 → 12** (Door of Destinies, Reflections of Littjara, Chronicle of Victory no longer false negatives) |
| Migration bar | **752/752** (unchanged) |

**Key files:** `trigger-coverage-audit.ts`, `trigger-coverage-audit.probe.unit.test.ts`

---

## Track E — batch 404 (Layer 3 Kavaron threshold IR)

| Item | Status |
|------|--------|
| Full `12+ \|` line step collection on server | ✅ |
| Kavaron token + pump via `tryApplyOracleIRToActivatedAbility` | ✅ |
| Migration bar | **729/729** |

**Key files:** `oracleIrAbilityExecution.ts`, `oracle-ir-kavaron-threshold.integration.test.ts`

---

## Track E — batch 403 (Station threshold activated cost split)

| Item | Status |
|------|--------|
| `12+ \| {cost}:` → `stationChargeThreshold` + clean `cost` | ✅ |
| Die-roll `1-9 \|` bands not misclassified | ✅ |
| Migration bar | **726/726** |

**Key files:** `oracleTextParserKeywordCosts.ts`, `oracleTextParser.ts`, `oracleIR.ts`, `oracleIRGapBatch403.test.ts`

---

## Track E — batch 402 (Squad token metadata + Flash ordering)

| Item | Status |
|------|--------|
| Sicarian Infiltrator squad `create_token` with Flash line | ✅ |
| offset-1050 primary gaps test | ✅ |
| Migration bar | **726/726** |

**Key files:** `oracleIRParserPostprocess.ts`, `oracleIRGapBatch402.test.ts`

---

## Track E — batch 401 (parser, Station / EOE Planets)

| Item | Status |
|------|--------|
| Station vs `12+ \|` line split (Adagia) | ✅ |
| Station inner-colon parse (no spurious `create_token`) | ✅ |
| Kavaron inline threshold reminder (`It's an artifact creature at 12+`) | ✅ |
| Migration bar | **726/726** |

**Key files:** `oracleTextParserPreprocess.ts`, `oracleTextParserKeywordCosts.ts`, `oracleReminderText.ts`, `oracleIRParserPostprocess.ts`, `oracleIRGapBatch401.test.ts`

---

## Track D — completed (batches 368–380)

| Metric | Post-367 baseline | Final (batch 380) |
|--------|-------------------|-------------------|
| `unsupported_condition_clause` | 501 | **0** |
| Condition gap clusters | 501 | **0** |
| Assisted execution (`full_card`) | ~98.0% | **98.4%** (47215/47969) |
| Bulk modules | — | `Batch368Bulk` … `Batch380Bulk` |

**Architecture (unchanged):**

```
oracle text → parseOracleTextToIR → applyOracleIRStepsToGameState
  → evaluateConditionalWrapperCondition / evaluateExtendedConditionalClause
  → BatchNNNBulk handlers (+ unless inners in ConditionalStepSupport.ts)
  → audit enrich in executor-coverage-audit.ts
```

**Lessons from Track D (keep applying):**

- `modify_pt` / `conditional` use **inner** `condition.raw` — full-sentence extended stubs do not close modify_pt audit gaps.
- **Unless** steps gap on `unlessCondition.raw`, not the outer step raw (Tainted Specter).
- Audit enrich must set **ctx flags the handler reads** (`castAnotherInstantOrSorceryThisTurn`, `unlessPutCardOnTopOfLibraryChoice`, `lastSacrificedPermanents`, etc.).
- `evaluateExtendedConditionalClause` must pass `lastExcessDamageDealtThisWay` into bulk modules when destructuring params.

---

## Track E — current baseline (`full_card` audit)

Source: `EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage` (regenerated **2026-06-29**)  
Report: `server/scripts/out/executor-coverage-audit.json` (gitignored)

| Metric | Count |
|--------|------:|
| Cards / items scanned | 29,614 / **47,514** |
| Fully applied | **45,608** |
| Choice required (expected UI) | 1,906 |
| Parse→execute gaps | **0** |
| Assisted execution | **100%** (47,514/47,514) |
| `ir_gap` (unparsed step kind) | **0** |
| `unsupported` | 0 |
| `partial` | **0** |
| `no_steps` | 0 |

### Top skip reason codes (excluding expected UI)

| Priority | Reason code | Count | Track |
|----------|-------------|------:|-------|
| — | `player_choice_required` | 2,239 | Expected UI — not a bug |
| ~~E2~~ | ~~`no_deterministic_target`~~ | **0** Waterbender cluster (cleared) | `triggerEffectTextExtraction.ts`, `triggeredAbilitiesParsing.ts`, `oracleIRExecutorBattlefieldStepHandlers.ts` |
| ~~E2~~ | ~~`unsupported_target`~~ | **0** | **Done (batch 389)** |
| ~~E1~~ | ~~`unsupported_selector`~~ | **0** | **Done (batch 381 + 399 flicker)** |
| ~~E1b~~ | ~~`unsupported_object_selector`~~ | **0** | **Done (batch 382 parser prune)** |
| — | `impossible_action` | 6 | Copy-token / combat edge cases |
| ~~E4~~ | ~~`unknown_amount`~~ | **0** | **Done (prior batches; amount gap script empty)** |
| ~~E5~~ | ~~`unsupported_player_selector`~~ | **0** | **Done (prior batches)** |
| ~~D~~ | ~~`unsupported_condition_clause`~~ | **0** | **Done** |

### Top skipped step kinds (choice/UI concentration)

| Step kind | Skip count | Notes |
|-----------|----------:|-------|
| `discard` | 644 | Often choice + unless |
| `search_library` | 446 | Choice + search criteria |
| `scry` | 411 | Mostly `player_choice_required` |
| `move_zone` | 213 | Selectors + destinations |
| `surveil` | 193 | Choice |
| `create_token` | 167 | Choice / token params |
| `ring_tempts_you` | 44 | Choice |

### Full-card selector clusters — **0 gaps** (regenerated 2026-06-29)

`npx tsx scripts/executor-fullcard-selector-gap-analysis.ts` reports **0** `unsupported_selector` clusters. The list below is **historical** (pre-batch 381/399); do not treat as open work:

1. ~~`put this land onto the battlefield`~~ — Lotus Vale, Scorched Ruins
2. ~~`exile it from your graveyard`~~ — Leonardo da Vinci
3. ~~`put each of those cards into your hand instead`~~ — See the Truth
4. ~~`then put this land onto the battlefield`~~ — Sheltered Valley
5. ~~`return this creature to its owner's hand and manifest dread`~~ — Glitch Interpreter
6. ~~`exile that many cards from your graveyard instead`~~ — Nefarious Lich
7. ~~`put that card onto the battlefield … instead of into its owner's graveyard`~~ — Desertion

---

## Recommended Track E sub-tracks

| Track | Focus | Primary files | Gap script |
|-------|--------|---------------|------------|
| **E1 — Object selectors** | ~~`unsupported_object_selector`~~, move_zone `what` | `oracleIRParserPostprocess.ts`, move_zone handlers | `executor-fullcard-object-selector-gap-analysis.ts` (**0** clusters) |
| **E2 — Targets** | ~~bulk `no_deterministic_target`~~ — **0** clusters (batch 437) | `oracleIRExecutorSpecialTargetHandlers.ts`, `oracleIRExecutorBattlefieldStepHandlers.ts` | `executor-target-gap-analysis.ts` (**0** clusters) |
| **E3 — IR gaps** | ~~`ir_gap`~~ | `oracleIRParserPostprocess.ts`, `oracleIR.ts` step kinds | Audit JSON `status: ir_gap` → **0** |
| **E4 — Amounts** | ~~`unknown_amount`~~, ~~`unsupported_scaler`~~ | `oracleIRExecutorForEachQuantity.ts` | `executor-amount-gap-analysis.ts` (**0** clusters) |
| **E5 — Unless / discard** | Remaining discard unless shapes (choice/UI only) | `oracleIRExecutorConditionalStepSupport.ts` | Card probes |
| **E6 — Layer 3 server** ⭐ **BETA-READY** | Live spell/trigger routing, queue resume, reconnect E2E | `resolution.ts`, `oracleIrServerZoneSync.ts` | `npm run test:oracle-ir-migration` (**777/781**) |

**Layer 2 parse→execute is done.** Primary work remains **Layer 3** live-path patterns beyond completed E6 P0–P2.

---

## Batch workflow (Track E)

1. **Pick sub-track** from table above; read existing `server/scripts/out/*.json` before re-scanning.
2. **Probe** 1–3 cards with `server/scripts/_tmp-probe-*.ts` (delete after use).
3. **Implement** generic parser/executor fix (no card-name routing).
4. **Audit enrich** in `executor-coverage-audit.ts` if dry-run needs fixture seeds.
5. **Test:** `npx vitest run test/oracleIRGapBatchNNN.test.ts` (rules-engine) + targeted server tests if Layer 3 touched.
6. **Re-audit:**
   ```powershell
   cd server
   $env:EXECUTOR_COVERAGE_SCOPE='full_card'
   npm run executor:coverage
   npx tsx scripts/executor-fullcard-selector-gap-analysis.ts
   npx tsx scripts/executor-fullcard-condition-gap-analysis.ts   # should stay 0
   ```
7. **Update** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) with metrics and next targets.

---

## Validation commands

```powershell
# Layer 2 regression (trigger effects — must stay 100% assisted)
cd server
npm run test:oracle-ir-migration

# Full-card executor audit
$env:EXECUTOR_COVERAGE_SCOPE='full_card'
npm run executor:coverage

# Gap cluster reports (regenerate after changes)
npx tsx scripts/executor-fullcard-condition-gap-analysis.ts
npx tsx scripts/executor-fullcard-selector-gap-analysis.ts
npx tsx scripts/executor-general-gap-analysis.ts          # trigger_effects non-choice skips
npx tsx scripts/executor-target-gap-analysis.ts         # trigger target clusters
npx tsx scripts/executor-amount-gap-analysis.ts

# Batch unit tests (rules-engine)
cd ../rules-engine
npx vitest run test/oracleIRGapBatch380.test.ts
```

---

## Marvel mechanics (June 2026) — ✅ core + Layer 3 sockets done

See [marvel-mechanics-handoff.md](./marvel-mechanics-handoff.md). Teamwork / power-up / preparation runtime + socket coverage complete (batches 438–441). Further Marvel work is optional polish only.

---

## Copy-paste starting prompt (next session — IR live-readiness follow-up)

Use this verbatim (also mirrored at top of session handoff):

```
Continue MTGEDH Oracle IR migration — post live-soak green.

Read first:
- docs/oracle-ir-session-handoff.md (top prompt)
- docs/oracle-ir-track-e-remaining-work.md (§ IR live-readiness Aug 2026, D4–D7)
- docs/oracle-ir-smoke-soak.md
- .cursor/rules/oracle-ir-no-bespoke-handlers.mdc

Done (2026-08-12):
- Live soak: npm run oracle-ir:smoke:live → 51/51, 407/407 in-process, live D2 0
- Shared spellCastBoardContext (AI skip + soak provision)
- Tivit compound ETB timing; Messenger Jays vote-scaled draw; Rime Chill up-to tap
- D5 ETB swallow closed (208 commander-legal compounds, 0 swallowed effects)
- D5 other-event fire: artifact LTB/GY, monstrous, tapped, haunt
- Season {P} D6 UX; spell-static edhHitCount 0; vote/end_combat Layer 3

Next (priority):
1. Last 1/887 loyalty line: Davriel, Soul Broker Alchemy offers/conditions (leave unwired unless a generic offer/condition step exists).
2. Real EDH tables → GET /api/oracle-ir/telemetry (scripted soak is not a substitute)
3. Optional: replay CounterSpell dual-path (keep until asked)

Verify:
cd server ; npx vitest run tests/enters-or-other-event-fire.unit.test.ts tests/trigger-effect-text-extraction.unit.test.ts tests/oracle-ir-post-apply-trigger-emission.unit.test.ts --pool=threads --maxWorkers=1

Do not commit unless asked. Windows: chain with ; not &&.
```

<details>
<summary>Archived prompt — Track E9 (2026-07-03)</summary>

```
Continue MTGEDH Oracle IR Track E9 — post batch 469 …
(see git history / prior handoff)
```

</details>

---

## Copy-paste starting prompt (archived — Track E6 Layer 3)

<details>
<summary>Superseded 2026-07-03 — E9 is primary track</summary>

```
Proceed with Oracle IR Track E6 — Layer 3 server integration (primary track).
Layer 2 complete; Layer 3 socket + resume was the bottleneck (batches 438–465).
See git history for full E6 prompt.
```

</details>

---

## Copy-paste starting prompt (archived — Marvel polish OR Track E6)

<details>
<summary>Superseded 2026-06-30 — Marvel core done</summary>

```
Proceed with Marvel mechanics polish OR Oracle IR Track E6 — Layer 3 server integration.
… (see git history)
```
</details>

---

## Layer 3 — primary track (Track E6)

Layer 2 dry-run is complete; **live gameplay is the bottleneck.** Continue per [oracle-ir-server-migration-plan.md](./oracle-ir-server-migration-plan.md):

| Priority | Pattern | Migration test cluster | Key files |
|----------|---------|------------------------|-----------|
| **P0** | Targeted zone change (destroy/exile/bounce/sacrifice/flicker) | ✅ **Done (E6 batch 1)** — card id in zone containers | `oracleIRExecutorBattlefieldOps.ts` |
| **P1** | Counter distribution modal | ✅ **Done (E6 batch 2)** — `COUNTER_DISTRIBUTION` when pre-targeted | `oracleIRExecutorBattlefieldStepHandlers.ts` |
| **P1** | Compound X library search | ✅ **Done (E6 batch 3)** — Celestial Reunion X `manaValueLte` | `oracleIRExecutorPlayerStepHandlers.ts` |
| **P2** | Attack → land-or-draw | ✅ **Done (E6 batch 3)** — no spurious `LIBRARY_SEARCH`; deferred draw sync | `oracleIrServerZoneSync.ts`, `oracleIrTriggerExecution.ts` |
| **P2** | Reveal → choose → move | ✅ **Done (E6 batch 4–10)** — spell + trigger direct IR; Kindred EP on spell + trigger paths | `oracleIrEffectProgramServer.ts`, `oracleIrTriggerExecution.ts`, `oracleIrServerZoneSync.ts` |

**Migration bar:** `npm run test:oracle-ir-migration` → **781 tests** (2026-07-01; +batches 450–453). Targeted Layer 3 sockets green with `--pool=threads --maxWorkers=1`; full parallel run may hit 5s timeouts on Windows — use single worker for CI gate.

**Station/EOE Broodship arc (batches 409–427):** ✅ structured `additionalCost`, parser dedupe, durable round-trip, live IR mirror, replay + usage consumption, 3+ additional land threshold, EP mirror, generic discard/retrace durable tests, Adagia parser guard (`oracleIRGapBatch422`), EOT `this_turn` permission cleanup (batch 423), discard `sourceGrantedAdditionalCost` live cast path (batch 424), full event-log replay through sacrifice + mana payment (batch 425), request-cast Broodship test via IR activation (batch 426), static permission skip for activatable Station graveyard-cast lines (batch 427).

**Batch 428:** trigger coverage audit probe permanent (`chosenCreatureType` etc.) — `not_detected` **15 → 12**.

**Batch 429:** preserve standalone `support N` keyword actions in `normalizeGameplayEffectText` — `not_detected` **12 → 2**.

**Batch 430:** Mikaeus tribal deals-damage + Merfolk Surveyor explore-clash — `not_detected` **2 → 0** (trigger audit fully green).

**Batch 431:** generic land would-enter sacrifice replacement on server play-land path (Lotus Vale / Scorched Ruins) — `land-would-enter-replacement.ts`, resolution/replay/AI wiring.

**Batch 432:** Sheltered Valley named-sacrifice would-enter (auto-sacrifice other copies, then ETB) — no resolution queue.

**Batch 433:** Lotus Vale socket integration (`playLand` → `submitResolutionResponse`, accept + decline, event log).

**Batch 434:** Mox Diamond unified into `land-would-enter-replacement.ts` (parse/queue/resolve); `mox-diamond-choice.ts` shim.

**Batch 435:** Mox Diamond socket integration (`tryQueueWouldEnterDiscardLandBeforeStackResolve` → `submitResolutionResponse`, event log).

**Would-enter arc (431–435) complete.**

**Batch 436:** Waterbender Ascension — trigger effect boundary at `Waterbend {4}:`; `grant_temporary_ability` target binding; Layer 3 activated IR test (`oracle-ir-waterbender-activated.integration.test.ts`); target-gap audit **6 → 5** clusters (Waterbender cleared).

**Batch 437:** E2 target-gap closure — `copy_permanent` (Secret Invasion / Taskmaster / Absorbing Man), `exile any number of other target permanents you control` (Silver Surfer), `destroy target tapped nonland permanent that player controls` (Spear of Bashenga); target-gap audit **5 → 0** clusters.

**Batch 438:** Teamwork choose-both under `ORACLE_IR_SPELL_PRIMARY=1` (Effect Program path) — `stackResolveInstantSorceryLegacyResolutionUtils.ts` re-pushes stack when IR queues pending resolution; `teamwork-choose-mode.socket.integration.test.ts` spell-primary describe (3/3 total); migration suite **755** tests.

**Batch 439:** Prepared triggers under `ORACLE_IR_TRIGGER_PRIMARY=1` — bridge in `stackExecuteTriggerEffectUtils.ts` calls `maybeApplyPreparedStateChange` when IR owns `becomes prepared` but returns `handled: false`; `prepared.trigger-primary.integration.test.ts` (4/4); migration suite **759** tests.

**Batch 440:** Power-up activated ability Layer 3 socket — `power-up-activated.socket.integration.test.ts` (2/2): ETB-discounted free activation → IR draw on stack + once-per rejection; migration suite **761** tests.

**Batch 441:** Thanos odd/even destroy power-up Layer 3 socket — `oracleIrServerZoneSync.ts` routes `player_choice` odd/even through `chosenOddEven` + resume context; `resolution.ts` `handleOptionChoiceResponse` bridges `oracleIrChoiceStepJson`; `thanos-odd-even-destroy.socket.integration.test.ts` (1/1); migration suite **762** tests.

**Batch 442:** Waterbender Ascension activated Layer 3 socket — `waterbender-activated.socket.integration.test.ts` (1/1): target selection → stack IR `grant_temporary_ability` unblockable grant.

**Batch 443:** Reveal → player_choice Layer 3 socket — `reveal-player-choice.socket.integration.test.ts` (1/1): `requestCastSpellForSocket` + `LIBRARY_SEARCH` `submitResolutionResponse` resume for Green Sun's Twilight X=1; migration suite **764** tests.

**Batch 444:** Green Sun X≥5 destination Layer 3 socket — `reveal-player-choice.socket.integration.test.ts` (+1): after `LIBRARY_SEARCH` resume, `OPTION_CHOICE` battlefield via `submitResolutionResponse`; server fixes: `oracleIrLibrarySearchResumeApplied` accepts `player_choice` among-them resumes; `collectMoveZoneChoiceSteps` skips `moveZoneDestinationChoice` gaps (no spurious second `LIBRARY_SEARCH`); `maybeApplyOracleIrChoiceStepFromResolution` passes multi-select `chosenObjectIds` + `oracleIrXValue`; migration suite **765** tests.

**Batch 445:** Trigger reveal→`player_choice` Layer 3 socket — `reveal-player-choice.trigger.socket.integration.test.ts` (1/1): Green Sun trigger on stack → `LIBRARY_SEARCH` → `submitResolutionResponse` hand resume under trigger IR primary.

**Batch 446:** Scry/surveil IR submit resume socket — `oracle-ir-scry-surveil.socket.integration.test.ts` (2/2): Opt scry + Consider surveil compound draw via `submitResolutionResponse`; server: deferred instant/sorcery finalize (`oracleIrDeferredFinalize` + `maybeResumeDeferredOracleIrStackSpell`).

**Batch 447:** Unless-pay optional payment socket — `oracle-ir-unless-pay.socket.integration.test.ts` (1/1): Force Spike stack resolve → unless-pay `OPTION_CHOICE` decline → counter target; server: `resolveOracleIrOptionalPaymentPromptFromResolution` decline path + `oracleIrTargetSpellId` on unless-pay steps; `inferTargetBinding` accepts object stack targets.

**Batch 448:** Prepared trigger full ETB socket — `prepared.trigger.socket.integration.test.ts` (1/1): Scheming Silvertongue second-main prepared trigger via `resolveTopOfStack` under trigger IR primary.

**Batch 449:** Compound IR resume socket — `oracle-ir-compound-resume.socket.integration.test.ts` (1/1): discard `submitResolutionResponse` resumes draw via `oracleIrResumeStepsJson`; server: `handleDiscardResponse` calls `maybeResumeOracleIRStepsAfterResolution`.

**Batch 449 (legacy audit):** Grep inventory for `applyRetiredTriggerLegacy*` / `applyRetiredSpellLegacy*` — **50+ handler modules** remain; retirement stays incremental per guardrail unit tests (no bulk delete).

**Batch 450 (legacy retirement):** Spell categorize gate under IR primary — `shouldSkipLegacySpellCategorizeExecution` in `stackResolveSpellLegacySpecUtils.ts`; unit tests for wheel draw regex + Force Spike `COUNTER_TARGET_SPELL` no-op (`oracle-ir-spell-legacy-handler-retirement.unit.test.ts` +2).

**Batch 451 (wheel reconnect E2E):** `oracle-ir-wheel-reconnect.integration.test.ts` (5/5): `joinGame` zone snapshots after Reforge / Windfall / Echo / Big Score / Inspiring Call fully resolve under spell IR primary.

**Batch 452 (unless-pay zone sync):** `syncOracleIRPlayerZonesToContext` syncs hand/graveyard/exile without requiring `ctx.libraries`; `syncAllOracleIRPlayerZonesAfterResolution` helper; optional-payment path sync after deferred spell finalize (`resolution.ts`).

**Batch 453 (prepared cast socket):** `prepared.cast.socket.integration.test.ts` (1/1): `requestCastSpellForSocket` on prepared exile copy → mana payment → unprepare + stack.

**Batch 454 (scry/surveil legacy categorize retirement):** Spell `executeInstantSorceryLegacyCategorizedSpell` no-ops for `SCRY` / `SURVEIL` ops under IR primary (guardrail unit tests); deleted dead `applyRetiredTriggerLegacyScry` stub (IR owns trigger scry). Socket coverage unchanged (`oracle-ir-scry-surveil.socket.integration.test.ts`).

**Batch 455 (trigger draw/discard/gain stub deletion):** Removed dead `return false` stubs from `oracleIrTriggerLegacyRegexHandlers.ts` (single draw/gain, each-opponent discard/life, counter stubs, etc.); guardrail + regex-handler tests trimmed to active handlers only.

**Batch 456 (wheel draw regex guardrails):** Windfall-style wheel regex no-op under IR primary (`oracle-ir-spell-legacy-handler-retirement.unit.test.ts` +1).

**Batch 457 (counter-then-draw stub deletion):** Removed unused `applyRetiredTriggerLegacyCounterThenDraw` from `oracleIrTriggerLegacyCombinedHandlers.ts`.

**Batch 458 (overlay migration gate):** Added `oracle-ir-compiled-overlay*.integration.test.ts` to `test:oracle-ir-migration` (beta-play gap workflow).

**Batch 459 (optional discard trigger socket):** `optional-discard-then-draw.trigger.socket.integration.test.ts` — legacy-forced `executeTriggerEffect` → `optionalDiscardThenDrawChoice` → `submitResolutionResponse` decline (IR-primary path owns clause separately).

**Batch 462 (clash EP socket):** `oracle-ir-fateseal-clash.socket.integration.test.ts` — clash `PLAYER_CHOICE` + dual `CLASH` resume via `submitResolutionResponse`.

**Batch 463 (optional discard IR-primary socket):** `optional-discard-then-draw.trigger.socket.integration.test.ts` — IR `OPTION_CHOICE` (`oracleIrChoiceStepJson`) decline under `ORACLE_IR_TRIGGER_PRIMARY=1`.

**Batch 464 (draw-then-discard spell guardrail):** Chart a Course legacy `applyLegacySpellRegexDrawHandlers` no-op under IR primary (`oracle-ir-spell-legacy-handler-retirement.unit.test.ts`).

**Batch 465 (optional discard IR parity):** `oracle-ir-trigger-legacy-parity.integration.test.ts` — documents IR `OPTION_CHOICE` path vs legacy `optionalDiscardThenDrawChoice`; routing assertions in `oracle-ir-trigger-legacy-routing.test.ts`.

**Track E7 complete.** Incremental legacy retirement continues opportunistically; `applyRetiredTriggerLegacyOptionalDiscardThenDraw` remains for legacy-forced regression until fully retired.

### Track E8 — Effect Program socket expansion + beta overlay gate ✅

| Batch | Pattern | Deliverable |
|-------|---------|-------------|
| **460** | Fateseal EP socket | `oracle-ir-fateseal-clash.socket.integration.test.ts` — `startOracleEffectProgramOnServer` → `PLAYER_CHOICE` + `FATESEAL` via `submitResolutionResponse` |
| **461** | Choose-mode EP socket | `oracle-ir-choose-mode-effect-program.socket.integration.test.ts` — `MODE_SELECTION` resume via socket |

**Layer 3 socket inventory (26 files):** prior 25 + clash step in `oracle-ir-fateseal-clash.socket` (fateseal + clash); optional-discard IR-primary block in `optional-discard-then-draw.trigger.socket`.

**Beta-ready status (2026-07-02):** E7 legacy stub cleanup + E8 Effect Program sockets complete. Production defaults: `ORACLE_IR_SPELL_PRIMARY` + `ORACLE_IR_TRIGGER_PRIMARY` ON. Remaining work is opportunistic legacy deletion and live-play soak (E9+).

**Next (post-beta, optional):**

| Priority | Pattern | Status |
|----------|---------|--------|
| ~~P1–P3~~ | Socket batches 445–453 | ✅ |
| **P4** | Legacy regex retirement | Incremental per handler family (grep + guardrail tests) |
| **P4** | Live beta soak | Manual EDH games; file IR gaps as overlay or parser batches |
| **P5** | Effect Program expansion | Multi-choice chains beyond current socket coverage |

### Track E7 — copy-paste prompt (archived — complete)

<details>
<summary>Superseded 2026-07-02 — E7 done; see E9+ for incremental legacy</summary>

```
Continue Oracle IR Layer 3 post-beta from docs/oracle-ir-track-e-remaining-work.md (E9 batches 462–465 done; migration 797 tests).
…
```
</details>

### Track E9+ — incremental legacy + live soak

**Current (2026-08-14):** D3 complete. Scripted live soak **51/51**. Phase 5 PW IR **886/887 (99.9%)** + life-gain/draw/token/counter/mill/library-search oracle-pattern specs + Szadek source-self + Alchemist type-restricted combat mill closed. Next work is Davriel Alchemy offers (leave unwired) and real-table telemetry. Full batch log: [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md).

```
Migration end-state — continue from P0/P1 in the Migration End-State Roadmap.
Copy full prompt from docs/oracle-ir-session-handoff.md (top of file).
```

<details>
<summary>Archived generic prompt (pre-batch 531)</summary>

```
Pick ONE remaining legacy handler family when a live-play gap is reported.
Use oracle-ir:overlay:probe for novel/custom cards before parser batches.
cd server && npm run test:oracle-ir-migration -- --pool=threads --maxWorkers=1
```

</details>

**Prior next table (superseded):**

| Priority | Pattern | Integration test exists? | Socket test? | Notes |
|----------|---------|------------------------|--------------|-------|
| ~~P1~~ | ~~Green Sun X≥5 destination (`OPTION_CHOICE` battlefield/hand)~~ | ✅ | ✅ **Done (batch 444)** | After `LIBRARY_SEARCH` resume |
| ~~P1~~ | ~~Trigger reveal→`player_choice` compound~~ | ✅ | ✅ **Done (batch 445)** | |
| ~~P2~~ | ~~Scry / surveil IR queue submit~~ | ✅ | ✅ **Done (batch 446)** | |
| ~~P2~~ | ~~Unless-pay optional payment~~ | ✅ | ✅ **Done (batch 447)** | |
| ~~P2~~ | ~~Prepared trigger live ETB~~ | ✅ | ✅ **Done (batch 448)** | |
| ~~P3~~ | ~~Compound IR resume mid-stack~~ | ✅ | ✅ **Done (batch 449)** | |
| **P3** | Legacy regex retirement | N/A | various sockets green | Incremental per handler family |

**Layer 3 socket inventory (legacy list):** `teamwork-choose-mode`, `power-up-activated`, `thanos-odd-even-destroy`, `waterbender-activated`, `reveal-player-choice`, `prepared.trigger-primary` (integration), `oracle-ir-kavaron-threshold`, `oracle-ir-broodship-graveyard-cast`, `oracle-ir-court-garenbrig-counter-distribution`, `oracle-ir-agrus-targeted-trigger` (+ replay), `thassa-oracle-etb`, `roaming-throne-kumena-tribal`, `land-would-enter-sacrifice`, `mox-diamond-would-enter`, `combat.infect-wither`.

**Server files most touched in Layer 3 batches:** `resolution.ts` (`handleOptionChoiceResponse`, `handleLibrarySearchResponse`, `submitResolutionResponse`), `oracleIrServerZoneSync.ts` (queue + resume), `stackResolveAbilityLateHandlersUtils.ts` (activated IR), `oracleIrSpellExecution.ts` / `oracleIrTriggerExecution.ts` (spell/trigger primary routing).
