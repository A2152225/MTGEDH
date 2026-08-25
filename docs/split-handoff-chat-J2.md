# Split handoff - chat J2 (game-actions.ts, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-J2.md.
CONTINUE server/src/socket/game-actions.ts (now 488892 B / 477.4 KB).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC only if you must abort. Do not edit the module map.
Never create socket/game-actions/. Parent CRLF; leaves LF. registerGameActions stays a real function.
Do not move requestCastSpellForSocket or handleCastSpellFromHand as whole functions.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/game-actions.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/game-actions.ts hand=9070-9466
  node tools/ts-cluster-deps.mjs server/src/socket/game-actions.ts 9070 9466

Already extracted: turn-flow, pregame, life/mill/house-rules, equipAbility, board-selection
(requestGraveyardTargets / opponent / sacrifice / control). Those socket.ons should already be one-liners.

Next clusters (--allow-nested, wrap as handleXRequest, 2-space dedent):
1. shuffleHand (~9070) + reorderHand (~9153) + updatePermanentPos (~9321) + setTurnDirection (~9386)
   as gameActionsTableHousekeepingSocketHandlers.ts if under 40KB; else split.
2. foretellCard (~9573) + castForetold (~9664)
3. phaseOutPermanents (~9749)
4. concede (~9884) + setTriggerShortcut (~10143)

Leaf must not import game-actions.ts or the index. Typecheck server. Targeted vitest.
Byte-copy --dry first. No ts-morph / _refactor_scratch.
```
