# Split handoff - chat J4 (game-actions.ts, continue)

Parent now: **154586 B / 151 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-J4.md.
CONTINUE server/src/socket/game-actions.ts (now 154586 B / 151 KB).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/game-actions/. Parent CRLF; leaves LF.
registerGameActions stays a real function.
Do NOT move whole: requestCastSpellForSocket (~418-1607, 49.1 KB) or nested
handleCastSpellFromHand (~1648 inside registerGameActions).

Already extracted phase leaves (do not re-move): AdditionalCosts, Targets, CostConvoke,
ManaPayment, ConsumeMana, PersistOnCast, ModalOverloadLife, ForceFlash,
RequestCastSpellNoTargetPayment, RequestCastSpellWithTargets (37.6 KB near ceiling),
StackStamp.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/game-actions.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/game-actions.ts
    timing=440-864 modes=866-1293 targets=1294-1521

Order:
1. Split remaining requestCastSpellForSocket by phase: timing/candidate/zone (~17.6 KB),
   then modes/X/Miracle/Madness/Mutate (~18.6 KB), then Aura/target compute + forced
   Mutate (~10.4 KB). Pass a continue-token for locals used by the two queue helpers.
2. Peel nested handleCastSpellFromHand front (payload / priority / zone / land gate, ~21 KB).
3. Peel applyEvent push+verify (~19 KB), then fallback (~8 KB). Stamp is already
   stampCastSpellStackItemFromHand.
4. Leftover registerGameActions = ensureInGameRoom + socket.on one-liners.
game-actions-handlers/index.ts is ~12.6 KB — drop export type re-exports if needed
to stay near 10 KB TOC.

Leaf must not import game-actions.ts or the index. Byte-copy --dry first.
Typecheck server. Cast / payment / targeting vitest.
(If vitest fails to load on aiTargetChoiceHandlers targeting.js, that is Chat Q, not this peel.)
No ts-morph / _refactor_scratch.
```
