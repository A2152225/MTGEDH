# Split wave 12 — leftover logic overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These two are disjoint. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| BU | `triggerReflexiveWhenYouDoQueueUtils.ts` **37.7 KB** (done) | `maybeQueueReflexiveAnyAmountManaPayment` (2.4 KB) — parent is only **124 B** over |
| BV | `AIEngine.ts` **38.1 KB** (done) | peel one class-method cluster with `--allow-nested`; class stays. Parent is only **77 B** over |

Wave 12 complete. Next unused overs: `docs/split-handoff-wave-13.md`.

**Reflexive (BU):** existing sibling `triggerReflexiveBoundSelfExilePreludeUtils.ts` stays put — do not append.

**AIEngine (BV):** existing `aiEngine*.ts` siblings stay put — do not append. Grep dual-copy first (`assessBattlefieldThreats` already lives in `aiEngineThreatSupport.ts`). Prefer `AIEngine-handlers/` like CardAnalyzer. Never create `AIEngine/` beside `AIEngine.ts`. Do not use chat letter AI.
