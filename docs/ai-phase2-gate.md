# AI Phase 2 gate (P2-8)

Challenger: **v2** (v1 scoring + attack/block/turn planners). Baseline seats: **v1**. Default live brain remains **v0** until promote.

## Decision

**FAIL — do not promote v2.** Keep the live default at **v0**.

| Bar | Post-fix gate (`gate-p2-v2-*`, pre-rerun) | Strength re-gate after stall fixes (`gate-p2-regate-v2-*`) |
| --- | --- | --- |
| Puzzles ≥90% (≥33/36) | **PASS** — **36/36** | **PASS** — **36/36** |
| Stall share ≤~2% | **PASS** — **0/320** | **PASS** — **0/320 (0%)** |
| Challenger edge vs v1 | **FAIL** — **37–100** (~27%) | **FAIL** — **32–83** (~28%) |

Strength patches did not create an edge. Stall hygiene on the re-gate is **0%** after CLEANUP / blockers / swarm / Borg Incursion `color_choice` finish-path fixes (shard **298** → win). Still **FAIL** promote — no challenger edge. Do not change live `AI_BRAIN`.

## Puzzle suite (36 total, held-out included)

| Brain | Passed | File |
| --- | --- | --- |
| v0 | **26/36** | `server/out/puzzles-v0-heldout.json` |
| v1 | **27/36** | `server/out/puzzles-v1-heldout.json` |
| v2 | **36/36** | `server/out/puzzles-v2-heldout.json` |

All held-out puzzles clear (hold-counter via `hold_counter_for_bigger` role gate).

## Self-play — full P2-8 gate

**Run:** seed **7000**, **320** games, maxTurns **90**, v2 seat 0 vs three v1 seats. Rows: `server/out/gate-p2-v2-*.jsonl` (post-fix / promoted reruns included).

| endReason | count | share |
| --- | --- | --- |
| v2 win | 37 | 11.6% |
| v1 win | 100 | 31.3% |
| turn-limit | 183 | 57.2% |
| stall | 0 | **0%** |
| error | 0 | 0% |

Decisive games only: **37 / 137 ≈ 27.0%** for v2.

**Stalls cleared:**

| shards | fix |
| --- | --- |
| 262, 281, 316 → wins | Eliminated-AP MAIN1: `shouldProtectActiveMainPhaseFromAutoAdvance` must not treat a seat that `playerCannotReceivePriority` as still having main-phase actions |
| 298 → turn-limit | Borg swarm tick-timeout: SBA identical-token P/T memo + shared battlefield permanent replay patch clones |

10. **Eliminated active player MAIN1:** `shouldProtectActiveMainPhaseFromAutoAdvance` must not treat a seat that `playerCannotReceivePriority` as still having main-phase actions (lands/`canAct`). That restored priority to a dead AP forever.
11. **Identical-token SBA / patch cost:** `applyStateBasedActions` memos `getEffectiveStatsForSBA` via `canBatchIdenticalTokenPt` / `identicalTokenPtFingerprint` (skips per-permanent temp P/T); `snapshotBattlefieldPermanentReplayPatches` / diff share clones across identical swarm fields.

### Earlier smoke trail (kept for history)

Paused pre-fix gate at 119/320 with stall ~23%. Smoke b3–b6 on shards 0–23 drove stall from ~12.5% → **0%** (b6) via attack-declare fallbacks, large-board combat fast-path/sticky, empty-stack combat quiet pass, canAct short-circuit, and planner time budgets. Harness: `maxWallClockMs = MAX_TURNS*40s`, turn-stall pauses while stack/resolution busy, `stallReason` on rows.

### Stall investigation landed during the full gate

1. Main-phase control-flow casts note actions + reschedule (hit `MAX_MAIN_ACTIONS`).
2. Attack declare fallbacks: never silent-return on goad / must-attack; force-mark `attackersDeclaredBy` as last resort.
3. Stale `permanent.attacking` shortcut removed.
4. v2 `planAttacks` skipped on large boards / slow clocks → was greedy fast (strength regression); now falls through to budgeted v0 declare path.
5. Large-board combat fast-path + sticky (`attackPlannerFast.ts`, `combatDecisionSticky.ts`).
6. Empty-stack non-declare combat skips response enum + fast-pass.
7. Large-block cheap eval (no per-blocker `evaluateCombatValue` before the large-combat gate).
8. MAIN1 large-board `canAct` untapped-mana short-circuit.
9. AI spell-payment simulation clones re-prime `_derivedContinuousEffects` (JSON clone drop); oracle normalisers memoized — cleared shard-28-class tick-timeouts.

## Next (post-FAIL)

1. **Landed (strength):** large-board v2 attacks no longer use greedy `planAttacksFast` — skip full `planAttacks`, fall through to budgeted v0 `evaluateCombatValue` (`aiEngineCombatSupport.ts`). Fast path kept only for planAttacks time-budget/error.
2. **Smoke (seed 7000, shards 0–23):** `gate-p2-strength-smoke-*.jsonl` — **2–8** decisive (20%), TL 14, **0 stalls**. Same window on promoted gate was **4–9** (30.8%) — no clear edge; n=24 is noise-dominated. Stall hygiene held.
3. **Landed (puzzles):** hold Counterspell when a much bigger enemy spell sits under a cheap top (`rolePolicies` `hold_counter_for_bigger` + stack-target CMC bias) → v2 **36/36**.
4. **Landed (strength):** planAttacks time-budget/error → budgeted v0 declare (not greedy fast); turn-plan keeps `bf>20` skip but plans top-10 when actionable is long (`TURN_PLAN_MAX_ACTIONABLE`). Raising skip to 32 looked worse on smoke2 (1–8 / 24, 0 stalls) — reverted.
5. **Tried (reverted):** discarding finished `wp-greedy` planAttacks into a second v0 eval — smoke3 was **3–4** decisive (42.9%) but **2 stagnant stalls** (shards 19/21). Reverted; keep timeout→v0 only.
6. **Re-gate (seed 7000, 320 games, `gate-p2-regate-v2-*`):** first pass v2 **30** / v1 **77** / TL **197** / stall **15** / error **1** (stall **4.7%**). After stall fixes + shard reruns: v2 **32** / v1 **83** / TL **204** / stall **0** / error **1** — decisive **~28%**, stall **0%**. Still FAIL on strength.
7. **Landed (stall):** eliminated turn player in CLEANUP — skip discard for out seats; `checkAndTriggerAI` wakes a living AI when CLEANUP has `priority=null`; living AI may `executeAdvanceStep`. Declare-blockers array repair + pass-without-declare. Swarm boards (`bf≥80`): skip response enum / combat planners (`aiSwarmBoardShortCircuit`). AI `color_choice` now applies side effects; EP resume failure falls back to legacy stamp+resolve; soft-cap no longer cancels color_choice.
8. **Landed (stall, shard 298):** Borg Incursion uses embedded “color of your choice” (not leading “Choose a color”). After EP answer, stamp+resolve now finishes via legacy protection for artifact creatures / color-of-your-choice, cancels EP twin `color_choice` prompts by spellId/EP metadata, and can bypass the blocking-prompt refuse on `persistAndResolveTopOfStack`. Rerun: **win** turns=65. Test: `borg-incursion-color-choice.integration.test.ts`.
9. **Landed (strength, smoke4):** v2-only (a) cheap `planLethalAttacksOnly` when full `planAttacks` is skipped/times out — closes large-board lethals without greedy fast; (b) opponent-MAIN empty-stack flash/instant scan when `bf≤24` (`aiOffTurnQuietPass`). Puzzles still **36/36**. Smoke `gate-p2-strength-smoke4-*` (seed 7000, shards 0–23): **2–7** decisive (**22%**), TL 15, **0 stalls** — stall hygiene held; no clear edge vs prior smoke (2–8 / 20%) or promoted window (4–9 / 30.8%). n=24 remains noise-dominated; **no full re-gate / no promote**.
10. **Landed (strength, smoke5):** MAIN1 dump / MAIN2 hold-up for `planTurn` (`shouldHoldUpInteractionForStep`) + higher `LIFE_PRESSURE_BONUS` (0.025→0.06). Puzzles **36/36**. Smoke `gate-p2-strength-smoke5-*`: **2–7** (**22%**), TL 15, **0 stalls** — same decisive split as smoke4; still no edge signal. **No re-gate / no promote**.
11. **Tried (reverted, smoke6):** light `planTurn` for bf 21–48 using priority scores (no `rankCandidates`) + oracle role heuristics for unprofiled counters/protection. Smoke `gate-p2-strength-smoke6-*`: **1–8** (**11%**), TL 15, **0 stalls** — **regressed**. Light mid-board plan reverted; keep `TURN_PLAN_SKIP_BF=20`. Oracle role heuristics for `toPlanner` kept (full-rank path only).
12. **Landed (strength, smoke7):** (a) disable off-turn empty-stack flash (footgun); (b) `planLethalSaveBlocks` on large-combat v2 before v0 blocks. Puzzles **36/36**. Smoke `gate-p2-strength-smoke7-*` (0–23, shard 9 rerun after hang): **4–5** decisive (**44%**), TL 15, **0 stalls**. Confirm `gate-p2-strength-smoke7b-*` (24–47): **4–6** (**40%**), TL 14, **0 stalls**. Combined 0–47: v2 **8** / v1 **11** / TL **29** / stall **0** — decisive **42.1%**, stalls **0%**. Cleared ≥35% smoke bar.
13. **Re-gate (`gate-p2-regate-s7-*`, seed 7000, 320):** v2 **27** / v1 **90** / TL **198** / stall **5** / error **0** — decisive **23.1%**, stall **1.6%**. Stall bar still OK (≤2%); strength **worse** than prior re-gate (~28%). Smoke7’s 42% was noise. **FAIL promote** — no `AI_BRAIN` change. Stall shards: 27, 143, 192, 261, 262 (stagnant×3, tick-timeout×2).
14. **Landed (smoke8):** unwired `planLethalSaveBlocks` from large-combat v2 (module+unit tests kept). Keep off-turn flash disabled. Smoke `gate-p2-strength-smoke8-*` (0–23): **3–11** decisive (**21.4%**), TL 10, **0 stalls** — still no edge; **no re-gate / no promote**.
15. **Landed (strength, smoke9):** raise `shouldUseAttackPlannerFast` boardSize skip 24→48 (keep attackPool>8). Puzzles **36/36**. Smoke `gate-p2-strength-smoke9-*`: **3–8** decisive (**27.3%**), TL 13, **0 stalls** — lift vs smoke8 (21.4%) but still under ≥35% re-gate bar; shards 9/10 early v1 wins persist (11→TL). **No re-gate / no promote**.
16. **Tried (reverted, smoke10):** mirror smoke9 on blocks — `largeCombat` bf 24→48. Smoke `gate-p2-strength-smoke10-*`: **3–9** (**25%**), TL 12, **0 stalls** — no lift vs smoke9 (27.3%); early shards 9–11 still v1. Reverted block skip to 24; keep attack boardSize 48.
17. **Tried (reverted, smoke11):** soften `planAttacks` C1 (life ≤18, margin −5). Smoke `gate-p2-strength-smoke11-*`: **3–9** (**25%**), TL 12, **0 stalls** — no lift; early 9–11 still v1. Reverted C1. Keep smoke9 attack boardSize 48 only.
18. **Tried (reverted, smoke12):** attackPool skip 8→12 (+ stop double-counting goaded). Smoke `gate-p2-strength-smoke12-*`: **2–9** (**18.2%**), TL 13, **0 stalls** — **regressed**. Reverted to smoke9 thresholds (boardSize 48, pool 8).
19. **Landed (strength, smoke13):** `planLethalAttacksOnly` accepts crack-safe `unless_trick` + commander-damage table (parity with full `planAttacks`). Puzzles **36/36**. Smoke `gate-p2-strength-smoke13-*`: **2–6** (**25%**), TL 16, **0 stalls** — flat vs smoke9 within noise; keep (correctness). Early 9–10 still v1. **No re-gate / no promote**.
20. **Landed (strength, smoke14):** v2 empty-stack END responses when bf≤24; MAIN flash + beginning stay quiet. Puzzles **36/36**. Smoke `gate-p2-strength-smoke14-*`: **3–7** (**30%**), TL 14, **0 stalls**. Confirm `smoke14b` (24–47): **4–6** (**40%**), TL 14, **0 stalls**. Combined 0–47: v2 **7** / v1 **13** / TL **28** / stall **0** — decisive **35.0%**. Cleared ≥35% smoke bar.
21. **Re-gate (`gate-p2-regate-s14-*`, seed 7000, 320):** after stall reruns (9/27/262/278) + hard-kill rerun (87): v2 **49** / v1 **90** / TL **181** / stall **0** / error **0** — decisive **35.3%**, stall **0%**. Best full gate yet (prior ~28% / s7 23%). Stall bar PASS; strength improved but still **FAIL promote** (need clear edge over v1, not ~1/3 of decisive). No `AI_BRAIN` change.
22. **Tried (reverted, smoke15):** `CMD_DAMAGE_PRESSURE` 0.06 in focus-fire. Smoke `gate-p2-strength-smoke15-*` (shard 9 hung→rerun): **1–9** (**10%**), TL 14, **0 stalls** — **regressed**. Reverted. Kept s14 IR hygiene fixes (Aethergeode energy/source, Triskelion/Swarmyard target queue, Chaos Wand opponent impulse).
23. **Tried (reverted, smoke16):** raise `V2_OFFTURN_FLASH_MAX_BF` 24→32. Smoke `gate-p2-strength-smoke16-*`: **2–6** (**25%**), TL 16, **0 stalls** — **regressed** vs smoke14 30%. Reverted to 24. AON clean.
24. **Tried (reverted, smoke17):** `CRACK_BACK_DISCOUNT` 0.5→0.35. Smoke `gate-p2-strength-smoke17-*`: **2–5** (**28.6%**), TL 17, **0 stalls** — flat/worse vs smoke14; more TL. Reverted to 0.5. AON clean.
25. **Tried (reverted, smoke18):** role-gated EOT bf≤48 via `handHasV2EotValueSpell`. Smoke `gate-p2-strength-smoke18-*`: **4–7** (**36.4%**), TL 13, **0 stalls**. Confirm `smoke18b` 24–47: **4–10** (**28.6%**), TL 10, **0 stalls**. Combined 0–47: v2 **8** / v1 **17** — decisive **32%** (under ≥35% confirm). Reverted to EOT bf≤24 only.
26. **Landed (IR hygiene):** Eternal Wanderer +1 — parse “that player's next end step” return as `schedule_delayed_trigger` (was mandatory immediate `move_zone` → AON). Test: `eternal-wanderer-flicker-ir.unit.test.ts`.
27. **Tried (reverted, smoke19):** `ATTACK_VOLUNTARY_GAIN_FLOOR` −0.02→−0.05. Smoke `gate-p2-strength-smoke19-*`: **2–8** (**20%**), TL 13, stall **1** (shard 14 tick-timeout) — **regressed**. Reverted to −0.02.
28. **Tried (reverted, smoke20):** MAIN2 hold-up exclude-interaction-from-plays + soft-dump when empty. Smoke `gate-p2-strength-smoke20-*`: **2–8** (**20%**), TL 14, **0 stalls** — **regressed**. Reverted. AON clean.
29. **Tried (reverted, smoke21):** `planLethalAttacksOnly` maxMs 8→40. Smoke `gate-p2-strength-smoke21-*`: **3–6** (**33.3%**), TL 14, stall **1** (shard 9 tick-timeout) — stall bar fail. Reverted to 8ms.
30. **Tried (reverted, smoke22):** v2 fallback declare focus-fire onto `selectAttackTarget`. Smoke `gate-p2-strength-smoke22-*`: **1–10** (**9.1%**), TL 13, **0 stalls** — **regressed hard** (pile into blocks). Reverted.
31. **Hygiene note (smoke22):** Chaos Wand `impulse_exile_top` AON still logged once when target opponent unbound; `chaos-wand-activated.integration.test.ts` passes with targets. Needs a resume prompt bridge for unbound `target_opponent` gaps (not a strength lever).
32. **Landed (IR hygiene):** unbound `impulse_exile_top` `target_opponent`/`target_player` → `TARGET_SELECTION` + `oracleIrChoiceStepJson` resume (`oracleIrServerImpulseTargetPlayerPrompts.ts`). Chaos Wand multi-opponent unbound no longer AON. Test: `chaos-wand-activated.integration.test.ts`.
33. **Tried (reverted, smoke23):** `planAttacks` split-vs-focus (keep per-attacker targets when focus WP does not beat split). Smoke `gate-p2-strength-smoke23-*`: **2–9** (**18.2%**), TL 13, **0 stalls** — **regressed**. Reverted to always focus-fire. Chaos Wand unbound-target prompt bridge kept.
34. **Tried (reverted, smoke24):** `LIFE_PRESSURE_BONUS` 0.06→0.12. Smoke `gate-p2-strength-smoke24-*`: **0–11** (**0%**), TL 13, **0 stalls** — **regressed hard**. Reverted to 0.06.
35. **Tried (reverted, smoke25):** MAIN1 `planTurn` maxPlays 3→4. Smoke `gate-p2-strength-smoke25-*`: **1–8** (**11.1%**), TL 15, **0 stalls** — **regressed**. Reverted to default 3.
36. **Tried (reverted, smoke26):** `ATTACK_VOLUNTARY_GAIN_FLOOR` −0.02→0. Smoke `gate-p2-strength-smoke26-*` (0–23): **3–5** (**37.5%**), TL 16, **0 stalls**. Confirm `smoke26b` 24–47: **2–9** (**18.2%**), TL 13, **0 stalls**. Combined 0–47: v2 **5** / v1 **14** — decisive **~26%** (under ≥35% confirm). Reverted to −0.02.
37. **Tried (reverted, smoke27):** life-gated EOT (`ourLife≤15`, bf≤40). Smoke `gate-p2-strength-smoke27-*` (0–23): **4–6** (**40%**), TL 14, **0 stalls**. Confirm `smoke27b` 24–47: **3–9** (**25%**), TL 12, **0 stalls**. Combined 0–47: v2 **7** / v1 **15** — decisive **~32%** (under ≥35% confirm). Reverted to EOT bf≤24 only.
38. **Tried (reverted, smoke28):** `COMMANDER_CAST_PLAN_BIAS` +30 for `cast_commander` in planTurn. Smoke `gate-p2-strength-smoke28-*`: **2–8** (**20%**), TL 14, **0 stalls** — **regressed**. Reverted.
39. **Tried (reverted, smoke29):** `planLethalSaveBlocks` on large-combat v2 only when life ≤15. Smoke `gate-p2-strength-smoke29-*`: **2–7** (**22.2%**), TL 15, **0 stalls** — **regressed**. Reverted (module stays unwired).
40. **Tried (reverted, smoke30):** block `largeCombat` ignore bf (pool-only). Smoke `gate-p2-strength-smoke30-*`: shard **9 hung** (0-byte jsonl) while others finished — stall bar fail. Reverted to bf>24.
41. **Tried (reverted, smoke31):** smoke30 signal + stall guards (cheap evals bf>24; `planBlocks` on small pools mid-bf with `maxMs` 80). Smoke `gate-p2-strength-smoke31-*`: **4–10** (**28.6%**), TL 10, **0 stalls** — under ≥35% bar (stall OK). Reverted block path to s14 (`largeCombat` includes bf>24; no `planBlocks` maxMs).
42. **Tried (reverted, smoke32):** mild block `largeCombat` bf 24→32. Shard **9 hung** (0-byte jsonl); partial 0–8+10–23 was **1–8** (**11.1%**) TL 14 — stall bar fail + regress. Reverted to bf>24.
43. **Tried (reverted, smoke33):** `CRACK_BACK_DISCOUNT` 0.5→0.65. Smoke 0–23 **5–6** (**45.5%**); confirm 24–47 **6–5** (**54.5%**); combined 0–47 decisive **50%**, stall **0**. Full re-gate `gate-p2-regate-s33-*`: v2 **31** / v1 **90** / TL **196** / stall **3** — decisive **25.6%**, stall **0.9%**. Stall bar OK; strength **worse** than s14 (35.3%). Smoke/confirm was noise (same pattern as smoke7). Reverted to 0.5. No `AI_BRAIN` change.
44. **Tried (reverted, smoke34):** late-game `voluntaryGainFloor` → 0 when turn≥55. Smoke `gate-p2-strength-smoke34-*`: **3–10** (**23.1%**), TL 11, **0 stalls** — **regressed**. Reverted.
45. **Tried (reverted, smoke35):** `LIFE_PRESSURE_BONUS` 0.06→0.04. Smoke `gate-p2-strength-smoke35-*`: **2–10** (**16.7%**), TL 12, **0 stalls** — **regressed**. Reverted to 0.06.
46. **Tried (reverted, smoke36):** attack boardSize skip 48→56. Smoke `gate-p2-strength-smoke36-*`: **2–7** (**22.2%**), TL 15, **0 stalls** — under ≥35%. Reverted to 48.
47. **Tried (reverted, smoke37):** `planAttacks` `PLAN_BUDGET_MS` 800→1200. Smoke `gate-p2-strength-smoke37-*`: **3–9** (**25.0%**), TL 12, **0 stalls** — under ≥35%. Reverted to 800.
48. **Tried (reverted, smoke38):** `TURN_PLAN_SKIP_BF` 20→24. Smoke `gate-p2-strength-smoke38-*`: **2–9** (**18.2%**), TL 13, **0 stalls** — **regressed**. Reverted to 20.
49. **Tried (reverted, smoke39):** diagnostic `TURN_PLAN_SKIP_BF` 0 (disable planTurn). Smoke `gate-p2-strength-smoke39-*`: **3–7** (**30.0%**), TL 14, **0 stalls** — flat vs smoke14 window; planner not clearly net-negative. Reverted to 20.
50. **Tried (reverted, smoke40):** override fitted `attackPower` −0.23→+0.25. Smoke `gate-p2-strength-smoke40-*`: **2–11** (**15.4%**), TL 11, **0 stalls** — **regressed**. Reverted to fitted weights.
51. **Plateau note (smoke31–40):** block mid-bf / crack 0.65 (smoke confirm 50% → full gate **25.6%** noise) / late gain floor / life-pressure ± / attack bf 56 / planAttacks budget / turn-plan skip ± / disable planTurn / attackPower override — all failed smoke bar or full-gate. Stall hygiene held. Baseline unchanged (s14). Need a larger policy/feature change than planner knobs; do **not** promote.
52. **Landed (IR hygiene from s33 AON telemetry):** (a) `pay_energy` / `roll_die` / `die_roll_results` → fallback wiring + preserve die-band newlines in `normalizeTriggerEffectForIrAudit` (Journey / Vault 112); (b) `target opponent|player or planeswalker` targeting + damage resolve (Theater of Horrors); (c) strip Populate keyword reminders so only `populate` remains (Trostani); (d) reject trigger-prefixed activation costs + line-scope full-card oracle for activated IR (Aethergeode). Test: `oracle-ir-s33-aon-hygiene.unit.test.ts`.
53. **Landed (stall hygiene from s33#27/143/216):** (a) `checkAndTriggerAI` always wakes AI-owned pending resolution steps *before* `_paymentResumeCastLock` / `_completingSpellCastByPlayer` early-return (stuck completing marker no longer leaves `mana_payment_choice` orphaned); (b) CLEANUP with `priority=null` wakes living AI turn player (and stack+null-priority cases), not only eliminated TP; (c) `tryHandleAiCleanupStep` clears `_aiProcessingCleanup` in `finally`. Tests: `ai.resume-kick.unit.test.ts`, `ai-cleanup-processing-flag.unit.test.ts`.
54. **Tried (reverted, smoke41):** MAIN2 dump when opponents look tapped out (no untapped opp lands/`{T}:Add` rocks). Smoke `gate-p2-strength-smoke41-*` (shard 8 hung→rerun): **3–7** (**30.0%**), TL 14, **0 stalls** — under ≥35% bar. Reverted. Stall hygiene from item 53 kept.
55. **Tried (reverted, smoke42):** MAIN2 hold-up counterspell-only (drop protection from `planTurn` `isHoldUp`). Smoke `gate-p2-strength-smoke42-*`: **3–8** (**27.3%**), TL 13, **0 stalls** — under ≥35% bar. Reverted.
56. **Tried (reverted, smoke43):** v2 tiny-combat `planBlocks` when attackers≤3 and blockers≤3 even if bf>24. Smoke `gate-p2-strength-smoke43-*`: **1–10** (**9.1%**), TL 13, **0 stalls** — **regressed hard**. Reverted (helper deleted).
57. **Tried (reverted, smoke44):** v2-only main-phase tempo bias after shared scorer (creatures when ahead / interaction when behind). Smoke `gate-p2-strength-smoke44-*`: **2–8** (**20.0%**), TL 14, **0 stalls** — **regressed**. Reverted (module deleted).
58. **Tried (reverted, smoke45):** close-out attacks — gain floor 0 when any opponent life ≤12. Smoke `gate-p2-strength-smoke45-*`: **2–10** (**16.7%**), TL 12, **0 stalls** — **regressed**. Reverted.
59. **Tried (reverted, smoke46):** swarm boards (bf>48) with ≤4 attackers still run full `planAttacks`. Smoke `gate-p2-strength-smoke46-*`: **1–8** (**11.1%**), TL 15, **0 stalls** — **regressed hard**. Reverted.
60. Do **not** change live `AI_BRAIN` until a full gate shows a clear edge over v1 **and** stall stays ≤~2%. Best full gate remains s14 **35.3%**.
61. **Landed (stall hygiene, s47#143):** swarm short-circuit required `hasPriority` before CLEANUP advance, and `handleAIPriority` ignored its `false` return — always early-returned on bf≥80. CLEANUP (Rule 514.1, priority=null) never reached `tryHandleAiCleanupStep` → stagnant. Fix: advance CLEANUP for AI turn player inside the short-circuit even without priority; only return early when short-circuit returns true. Stallcheck `gate-p2-stallcheck-s48-{27,143,216}`: all **turn-limit**, **0 stalls** (143 was stagnant CLEANUP bf≈87). Tests: `ai-swarm-board-short-circuit.unit.test.ts`, `cleanup-swarm-advance.unit.test.ts`.
62. **Tried (diagnostic, smoke47):** always skip full `planAttacks` (`AI_ALWAYS_SKIP_PLAN_ATTACKS=1` → lethal-only then v0). Smoke `gate-p2-strength-smoke47-*`: **2–6** (**25.0%**), TL 15, err 1 (shard **10 hung** 0-byte → killed), **0 stalls** among finished — under ≥35%; planner is not net-negative when it runs. Default thresholds unchanged (env flag left for future diagnostics only). No promote.
63. **Tried (reverted, smoke48):** v2 fallback declare destination by win-prob table leader (`selectAttackTargetWinProb`; finish-line life≤10 override) when full `planAttacks` is skipped/times out — align skip path with planner politics. Smoke `gate-p2-strength-smoke48-*`: **4–9** (**30.8%**), TL 11, **0 stalls** — under ≥35% bar. Reverted (module+wiring deleted). Stall hygiene from item 61 kept. No promote.
64. **Tried (reverted, smoke49):** removal prefers WP-leader board (`removal_leader_board` / `bestTargetValueOnSeat`). Smoke 0–23 **5–8** (**38.5%**); confirm 24–47 **4–7** (**36.4%**); combined 0–47 decisive **37.5%**, stall **0**. Full re-gate `gate-p2-regate-s49-*` (shard 301 hung→rerun): v2 **42** / v1 **93** / TL **183** / stall **2** (0.6%) / err **0** — decisive **31.1%**, stall bar OK; strength **worse** than s14 (35.3%). Smoke/confirm was noise (same pattern as smoke33/smoke7). Reverted. No `AI_BRAIN` change.
65. **Landed (stall hygiene, s49#262):** swarm CLEANUP short-circuit always `executeAdvanceStep` even with a non-empty stack — skipped Rule 514.3 pass and soft-locked (Undead Alchemist, bf=94, priority=null). Now: stack non-empty → grant priority if null + pass; empty stack → advance (keeps s47#143). Test: `ai-swarm-board-short-circuit.unit.test.ts`. Stallcheck `gate-p2-stallcheck-s50-{143,192,262}`: all **turn-limit**, **0 stalls** (192 also cleared under WALL 60s; 262 was the CLEANUP+stack bug).
66. **Tried (reverted, smoke50):** rewire `planLethalSaveBlocks` on large-combat v2 only when attackers≤6 (bf/blocker-triggered largeCombat). Smoke `gate-p2-strength-smoke50-*`: **1–8** (**11.1%**), TL 15, **0 stalls** — **regressed hard**. Reverted (module stays unwired). Stall hygiene from item 65 kept. No promote.
67. **Tried (reverted, smoke51):** invalidate sticky turn-plan order when available mana rises mid-MAIN (rock/ritual unlock → replan). Smoke `gate-p2-strength-smoke51-*`: **2–10** (**16.7%**), TL 12, **0 stalls** — **regressed**. Reverted. No promote.
68. **Tried (reverted, smoke52):** boost draw when hand is critical (`draw_hand_small` 30→40 + `draw_hand_critical` when handSize≤1). Smoke `gate-p2-strength-smoke52-*`: **2–10** (**16.7%**), TL 12, **0 stalls** — **regressed**. Reverted. Stall hygiene from item 65 kept. No promote.
69. **Tried (reverted, smoke53):** wire CardRole `protection` into utility scorer (`SCOPED_ROLES` + prefs for low life / enemy stack / behind). Smoke `gate-p2-strength-smoke53-*` (shard 9 hung→rerun WALL 60s): **4–8** (**33.3%**), TL 12, **0 stalls** — under ≥35% bar. Reverted. Stall hygiene from item 65 kept. No promote.
70. **Tried (reverted, smoke54):** soften sweeper gate (boardGap 0.25→0.15) + creature-count deficit≥2 OR + `sweeper_many_threats` 40→55. Smoke `gate-p2-strength-smoke54-*`: **3–11** (**21.4%**), TL 10, **0 stalls** — **regressed**. Reverted. Stall hygiene from item 65 kept. No promote.
71. **Tried (reverted, smoke55):** wire CardRole `token_maker` into utility scorer (creature-behind / early / WP-behind prefs). Smoke `gate-p2-strength-smoke55-*`: **2–7** (**22.2%**), TL 14, stall **1** (shard 10 tick-timeout, 4.2%) — under ≥35% and stall bar. Reverted. Stall hygiene from item 65 kept. No promote.
72. **Tried (reverted, smoke56):** score `activate_ability` candidates with ramp prefs when the permanent's profile includes ramp (mana-rock taps compete with casts). Smoke `gate-p2-strength-smoke56-*`: **1–9** (**10.0%**), TL 14, **0 stalls** — **regressed hard**. Reverted. Stall hygiene from item 65 kept. No promote.
73. **Tried (reverted, smoke57):** `boardGap` uses max living opp boardValue (not multiplayer average) so sweepers see one runaway seat. Smoke `gate-p2-strength-smoke57-*`: **3–8** (**27.3%**), TL 13, **0 stalls** — under ≥35% bar. Reverted. Stall hygiene from item 65 kept. No promote.
74. **Tried (reverted, smoke58):** soften removal floor `atLeast(8)→4` + `removal_big_threat` curve from 4. Smoke `gate-p2-strength-smoke58-*`: partial 0–8+10–23 **2–11** (**15.4%**), TL 10; shard **9 hung twice** (0-byte, WALL 60s rerun also hung) — stall bar fail + regress. Reverted. Stall hygiene from item 65 kept. No promote.
75. **Landed (IR hygiene from smoke AON):** add `force_block` to `ORACLE_IR_FALLBACK_STEP_KINDS` — Domineering Will (“They block this turn if able”) was repeatedly `unwired_mandatory_step: force_block` on smoke27/41/49 despite executor support. Other frequent smoke labels (time_travel / regenerate / Chaos Wand impulse / s33 pay_energy·roll_die·Theater·Populate·Aethergeode) already wired or fixed earlier. Test: `oracle-ir-s33-aon-hygiene.unit.test.ts`.
76. **Tried (reverted, smoke59):** wire CardRole `lifegain` into utility scorer (low-life / WP-behind prefs). Smoke `gate-p2-strength-smoke59-*`: **1–7** (**12.5%**), TL 16, **0 stalls**, **0 AON telemetry** — **regressed**. Lifegain prefs reverted; force_block hygiene from item 75 kept. No promote.
77. **Tried (reverted, smoke60):** `MANA_EFFICIENCY` 40→60 in `planTurn` (prefer mana-dump sequences). Smoke `gate-p2-strength-smoke60-*` (shard 11 hung→rerun WALL 60s): **3–8** (**27.3%**), TL 13, **0 stalls**, **0 AON** — under ≥35% bar. Reverted. force_block hygiene from item 75 kept. No promote.
78. **Tried (reverted, smoke61):** `counter_leader_spell` weight 20→50. Smoke `gate-p2-strength-smoke61-*`: **2–7** (**22.2%**), TL 15, **0 stalls**, **0 AON** — **regressed**. Reverted. force_block hygiene from item 75 kept. No promote.
79. **Tried (diagnostic, reverted, smoke62):** disable MAIN2 hold-up entirely (`shouldHoldUpInteractionForStep` always false — dump both mains). Smoke `gate-p2-strength-smoke62-*`: **2–10** (**16.7%**), TL 12, **0 stalls**, **0 AON** — **regressed**. Hold-up is net-positive; restored MAIN2-only. force_block hygiene from item 75 kept. No promote.

## Planners shipped behind v2

| Task | Module |
| --- | --- |
| P2-5 | `rules-engine/src/ai/attackPlanner.ts` / `attackPlannerFast.ts` + `combatDecisionSticky.ts` |
| P2-6 | `rules-engine/src/ai/blockPlanner.ts` |
| P2-7 | `rules-engine/src/ai/turnPlanner.ts` + `server/.../aiTurnPlanHook.ts` |
