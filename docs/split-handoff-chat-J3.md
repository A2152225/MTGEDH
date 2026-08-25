# Split handoff - chat J3 (game-actions.ts, cast pipeline)

Sockets are already one-liners. Chat J stopped because the remaining bulk is two functions over 40 KB. Split those **by phase**; do not move either whole.

Parent now: **414709 B / 405 KB**.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-J3.md.
CONTINUE server/src/socket/game-actions.ts (now 414709 B / 405 KB).
Keep peeling until the parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/game-actions/. Parent CRLF; leaves LF.
registerGameActions stays a real function (tests spy it).
Do NOT move whole: requestCastSpellForSocket (~407-2884, 112.8 KB) or the nested
handleCastSpellFromHand const (~2925-8184, ~257 KB inside registerGameActions).

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/game-actions.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/socket/game-actions.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/socket/game-actions.ts
    castReq=407-2884 nested=2925-8184

This is CR 601.2 (timing, modes, additional costs, targets, payment, put-on-stack).
Spell *effects* already live in resolution / oracleIrServerZoneSync. Do not wait for IR
to shrink this file.

Order:
1. Lift nested `const handleCastSpellFromHand = async (...) => {` out of
   registerGameActions to a module-level function in
   game-actions-handlers/gameActionsCastSpellFromHand.ts
   (io, socket, ensureInGameRoom, ...payload). --allow-nested. Parent keeps a thin
   wrapper that closes over io/socket/ensureInGameRoom and passes them in.
   completeCastSpell already calls handleCompleteCastSpellRequest(..., handleCastSpellFromHand).
   After the lift, pass the module-level fn. Do not move the 257 KB body as one leaf
   if the new file would exceed 40KB - if --dry shows the whole nested fn is ~257 KB,
   skip the whole-function lift and go straight to step 2 (phase peels from inside it).
2. Split handleCastSpellFromHand by phase into siblings under 40KB. Grep comment banners
   / 601.2 / "additional cost" / "payment" / "targets" / "appendEvent" / "processSpellCast".
   Suggested families (confirm ranges with toc + range-bytes):
   - additional costs / modes / X / kicker / Bargain / Squad / Blight
   - mana payment / convoke / treasures / snow provenance
   - cast-time targeting (pre-pay prompts)
   - stack persist + appendEvent(castSpell) + haste/uncounterable
   - on-cast trigger glue (processSpellCastTriggersForCast)
3. Same phase split for requestCastSpellForSocket (112.8 KB). Timing/priority first,
   then modes/X, then "need targets? queue TARGET_SELECTION : request payment".
4. Keep peeling until parent < 40960. Leftover registerGameActions should be the
   ensureInGameRoom helper plus socket.on one-liners.

Leaf must not import game-actions.ts or game-actions-handlers/index.ts.
Byte-copy --dry first. Typecheck server. Cast / payment / targeting vitest.
No ts-morph / _refactor_scratch.
```
