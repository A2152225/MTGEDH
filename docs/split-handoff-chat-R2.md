# Split handoff - chat R2 (interaction.ts, continue)

Parent now: **309082 B / 301.8 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-R2.md.
CONTINUE server/src/socket/interaction.ts (now 309082 B / 301.8 KB) and interaction-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/interaction/. Parent CRLF; leaves LF.
registerInteractionHandlers stays a real function.
Do NOT move the remaining activateBattlefieldAbility socket.on whole (~249 KB leftover body).

Already extracted tryHandleActivate* (do not re-move): EquipFortifyReconfigure, CrewStation,
Mana, CostPromptTapBlight, CostPromptDiscardExileHand (39.4 KB near ceiling - do not append).

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/interaction.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/interaction.ts
    specialLand=1093-1643 fetch=1644-1902 grant=2033-3208
    pw=3211-3915 sacCost=3917-5062 genericMana=5077-6668

Same pattern: tryHandleActivateX(activateCtx); if (handled) return.
activateCtx is already built in the prologue.

Order (confirm lines with toc; Chat R's leftover ranges):
1. specialLand (~22.8 KB) then fetch (~11 KB) then sacDraw (~4.8 KB) if still in parent.
2. grant…upgrade (~47.1 KB) — SPLIT, do not move whole.
3. pw + other (~32.4 KB)
4. sacCost (~52.6 KB) — SPLIT
5. genericMana (~73.3 KB) — SPLIT; after LF+dedent+imports each leaf must stay under 40KB.
6. set/getReplacement + activateCycling (~13.2 KB)
7. Parent helpers (parseTapUntapAbilityText, payBattlefieldAbilityManaCostOrQueue, …)
   if that finishes the parent under 40960.

Leaf must not import interaction.ts or the index. Byte-copy --dry first.
Typecheck server. Activation / graveyard-cast vitest. No ts-morph.
```
