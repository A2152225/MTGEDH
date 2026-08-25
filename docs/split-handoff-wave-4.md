# Split wave 4 — unused megas + finish J

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

**J3 is still required** if `game-actions.ts` is 405 KB: `docs/split-handoff-chat-J3.md`.

These eight are disjoint from J3 and from each other. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| J3 | `game-actions.ts` 405 KB | phase-split nested `handleCastSpellFromHand` / `requestCastSpellForSocket` |
| Q | `ai.ts` 558 KB | create `ai-handlers/` on extract #1; pregame + `registerAIHandlers` |
| R | `interaction.ts` 507 KB | explore / library-search / bulk-tap / untap sockets; **not** `activateBattlefieldAbility` whole (363 KB) |
| S | planeswalker `resolve.ts` 512 KB | create `templates/resolve-handlers/`; hoist template `case` families |
| T | `oracleIRExecutorPlayerStepHandlers.ts` 311 KB | `applySearchLibraryStep` then discard / add-mana |
| U | `util.ts` 251 KB | split `calculateManaProduction` (55 KB) by ability family |
| V | `oracleIRParserSimpleActionClauses.ts` 216 KB | hoist clause-family runs out of `tryParseSimpleActionClause` (204 KB) |
| W | `oracleIRExecutorMainLoop.ts` 155 KB | hoist `switch` case families out of `applyOracleIRStepsToGameStateImpl` (128 KB) |
| X | `can-respond.ts` 159 KB | create `can-respond-handlers/`; `getCastableSpellCandidates` first |

Skipped this wave: `client/src/App.tsx` (UI), `socket/combat.ts` (already has `combat-handlers/`; `handleDeclareAttackers` next), `ConditionalStepSupport*` (touch after MainLoop), planeswalker `registry.ts`.
