# Split handoff - chat R (interaction.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-R.md.
Sole writer for server/src/socket/interaction.ts and interaction-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/interaction/. Parent CRLF; leaves LF.
registerInteractionHandlers must stay a real function (tests spy it).
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/interaction.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/socket/interaction.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/socket/interaction.ts
    gyAbil=1212-2119 activate=3246-11501

Already extracted helpers live in interaction-handlers/ - do not re-move.
Do NOT move whole: activateBattlefieldAbility socket.on (~3246-11501, 362.9 KB).
Split that body by ability family (equip/fortify/reconfigure, crew/station, mana,
cost-prompt TAP/DISCARD/SACRIFICE/BLIGHT, then generic activate persist).

Order:
1. Small sockets first (--allow-nested, wrap handleXRequest, 2-space dedent):
   beginExplore + beginBatchExplore, requestLibrarySearch, requestGraveyardView,
   bulkTapPermanentsForMana, untapPermanent.
2. activateGraveyardAbility (~1212-2119, 37.3 KB) as its OWN leaf - near ceiling, do not pack more.
3. Then peel activateBattlefieldAbility by comment banners / ability kind. Parent keeps
   the socket.on and calls tryHandleActivateX(...); if handled, return.

Leaf must not import interaction.ts or the index. Byte-copy --dry first.
Typecheck server. Activation / graveyard-cast / explore vitest. No ts-morph.
```
