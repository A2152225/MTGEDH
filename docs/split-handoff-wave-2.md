# Split wave 2 — status and chat prompts

Playbook: `.cursor/skills/split-ts-module/SKILL.md`
Ceiling: **40960 bytes on disk**. One writer per parent. Behavior-preserving extracts only.
Coordinator owns `docs/mtg-logic-module-map.md`. Extract chats **do not edit it**; report the owed row.

Campaign A–H plus wave-1/wave-2 extracts already landed. `applyEvent.ts` and `undo.ts` are under the ceiling. Parser/postprocess parents are thin barrels. **77 files still over 40 KB** (`node tools/ts-logic-file-sizes.mjs`, 1559 scanned).

## Done (do not re-do)

- Resolution cores stay in `resolution.ts`; most step types already go through `resolutionHandlerDeps.ts`.
- Death / ETB / death-emission / ETB-untap dual copies: **one** `export function` each. Leftover re-exports from `triggers/zone-changes.js`.
- `registerInteractionHandlers` and `registerGameActions` stay real functions (tests spy them).
- Do **not** move `requestCastSpellForSocket` or `handleCastSpellFromHand` as whole functions.
- Do **not** move `activateBattlefieldAbility` as one `socket.on`.
- Do **not** create `socket/resolution/`, `socket/game-actions/`, `socket/interaction/`, or `triggered-abilities/`.

## Still dual-copy (Chat K only)

Leftover `detectAttackTriggers` (`triggered-abilities.ts` ~3737–5666) vs `triggers/combat.ts` (~1576). Folder `combat.ts` is already **127.6 KB OVER**. Merge leftover unique into a **new** `triggers/attack-detection.ts` (or split combat first), leftover re-exports, `combat.ts` re-exports the live body. Do not stack two regex engines. Do not touch `intervening-if.ts` in the same chat.

Already-reconciled (leave alone): `detectDeathTriggers`, `detectETBTriggers`, `getDeathTriggers*`, `detectETBUntapEffects`, `checkETBAutoSacrifice`.

## Wave 2 chats (disjoint parents)

| Chat | Parent (bytes now) | First cluster | Do not touch |
| --- | --- | --- | --- |
| I | `socket/resolution.ts` (186192) | `handleXValueSelectionResponse` (~3148–3294) | other parents; near-40KB validation siblings |
| J | `socket/game-actions.ts` (505784) | GY / opponent / sacrifice / control sockets (~9810–10276) | `requestCastSpellForSocket`, `handleCastSpellFromHand` |
| K | leftover `triggered-abilities.ts` (469778) **and** `triggers/combat.ts` (130664) | `detectAttackTriggers` dual-copy | `intervening-if.ts`, other leftover detectors |
| L | `oracleIRExecutorBattlefieldStepHandlers.ts` (534484) | next self-contained `apply*` run (suspect/detain/cant-block if they do not close over `resolveDirectBattlefieldPermanents`) | tap/untap if they still close over that helper |
| M | `oracleIRExecutorZoneOps.ts` (409596) | next GY parse family (`parseMoveZoneAllFromYourGraveyard` ~886+) | shuffle-into-library (already extracted) |
| N | `oracleIrServerZoneSync.ts` (232546) | tap-untap / tap-matching `queue*` pair | sacrifice/discard/proliferate if they call `resumeOracleIRRemainingStepsFromResolution` |
| O | `state/modules/turn.ts` (239242) | draw-step peel `runTurnStepDraw` | `nextStep()` dispatcher; cleanup/upkeep already extracted |
| P | `triggers/intervening-if.ts` (588631) | this-turn / count helpers (~51–360) | leftover `triggered-abilities.ts`, `combat.ts` |

Paste prompts live in `docs/split-handoff-chat-I.md` … `P.md`.

## Deferred (next wave, not I–P)

Largest unused: `socket/ai.ts` (558 KB — create `ai-handlers/` on extract #1), planeswalker `templates/resolve.ts` (512.3 KB), `socket/interaction.ts` (506.9 KB — peel helpers, not the whole activate `socket.on`), `oracleIRExecutorPlayerStepHandlers.ts` (311.1 KB), `socket/util.ts` (`calculateManaProduction` ~4670), `socket/combat.ts` (`handleDeclareAttackers` after helpers already extracted), `oracleIRParserSimpleActionClauses.ts` (215.7 KB), client `App.tsx` / `activatedAbilityParser.ts` / `loopShortcuts.ts`.

## Shared extract rules

- Inventory: `node tools/ts-cluster-toc.mjs <parent> --min-bytes 2000`, then `node tools/ts-cluster-deps.mjs <parent> START END` and `node tools/ts-cluster-range-bytes.mjs <parent> cluster=START-END`. **Never Read the whole megafile.**
- Byte-copy: `node tools/extract-ts-cluster.mjs --dry` first, then write. Header + replacement files by hand. No ts-morph / jscodeshift / `_refactor_scratch`.
- Dual-copy grep before moving a symbol.
- Named re-export + one-line comment on the domain `*-handlers/index.ts` (or `triggers/index.ts`). Create the folder on extract #1. Never `X/` beside `X.ts`.
- Leaf must not import the public parent or the TOC index.
- Re-read every new/changed import line plus 2–3 neighbors for `` `r`n `` junk, merged lines, doubled backslashes.
- Typecheck the owning workspace. Targeted vitest for the cluster. Stop when the new file nears 40 KB.
- Report: files created, parent byte delta, tests, **module-map row owed**.
