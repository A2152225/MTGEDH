# Split handoff - chat X (can-respond.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-X.md.
Sole writer for server/src/state/modules/can-respond.ts and new can-respond-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create can-respond-handlers/index.ts on extract #1. Never create can-respond/ beside
can-respond.ts. Parent is LF (no CRLF); keep new leaves LF. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/can-respond.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/state/modules/can-respond.ts START END

Order:
1. getCastableSpellCandidates (~1588-1923, 15.2 KB) plus exclusive GY-permission helpers
   (getSpecificSpellFromGraveyardPermission / getSpecificLandFromGraveyardPermission)
   if they are only used there.
2. hasActivatableAbility (~2364-2624, 11.7 KB) + hasGraveyardActivatedAbility +
   canActivateAnyAbility if they form one cluster under 40KB.
3. getCommandZoneCommanderCandidates (~390-526)
4. canAct / getPlayableLandCandidates / hasPlayFromZoneEffect until parent < 40960.

Public exports stay on can-respond.ts (re-export from leaf).
Leaf must not import can-respond.ts or the index. Byte-copy --dry first.
Typecheck server. can-respond / flash / GY-cast timing vitest. No ts-morph.
```
