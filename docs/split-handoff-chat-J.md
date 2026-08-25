# Split handoff - chat J (game-actions.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-J.md.
Behavior-preserving extract only. Sole writer for server/src/socket/game-actions.ts and
game-actions-handlers/**. Do not edit docs/mtg-logic-module-map.md - report the owed row.
Never create server/src/socket/game-actions/. Parent is CRLF; new leaves are LF.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/game-actions.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/game-actions.ts gy=9810-10276
  node tools/ts-cluster-deps.mjs server/src/socket/game-actions.ts 9810 10276

First cluster (confirm end lines with toc): requestGraveyardTargets, requestOpponentSelection,
requestSacrificeSelection, changePermanentControl. One leaf if under 40KB
(gameActionsBoardSelectionSocketHandlers.ts). If over, extract requestSacrificeSelection alone.

These are indented socket.on bodies inside registerGameActions. Byte-copy with --allow-nested --dry
first, then wrap as export async function handleXRequest(io, socket, ensureInGameRoom, payload)
with a 2-space dedent of the arrow body. Parent registration becomes:
  handleFooRequest(io, socket, ensureInGameRoom, payload)
Pass EnsureInGameRoom. Leaf must not import game-actions.ts or the handlers index.
Named re-export + one-line comment on game-actions-handlers/index.ts.

Do not move requestCastSpellForSocket or handleCastSpellFromHand as whole functions.
Do not touch playLand / requestCastSpell / completeCastSpell / castSpellFromHand / passPriority.
Already extracted - do not re-move: turn-flow, pregame, life/mill/house-rules, equipAbility.

Verify: import neighbors. npm run typecheck --workspace=server. Targeted vitest for graveyard-target,
opponent-selection, sacrifice-selection, control-change, game-actions.inroom.authorization.
No ts-morph / _refactor_scratch.
```

## Parent

`game-actions.ts` is **505784 B (~493.9 KB)**. `registerGameActions` stays a real function.
