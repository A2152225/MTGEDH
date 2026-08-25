# Split handoff - chat AS (graveyard-permissions.ts)

Parent now: **75465 B / 73.7 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AS.md.
Sole writer for server/src/state/modules/graveyard-permissions.ts and new
graveyard-permissions-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create graveyard-permissions-handlers/index.ts on extract #1. Never create
graveyard-permissions/ beside graveyard-permissions.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Grep dual-copy vs oracleIRParserPostprocessGraveyardCastPermission and
graveyardPermissionAdditionalCost. Merge into the existing copy if it is the
same export; do not create a third implementation.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/graveyard-permissions.ts --min-bytes 2000

Order:
1. applyPlayableFromGraveyardPermissionFromText (~1529-1750, 9.4 KB) plus exclusive
   helpers it closes over (qualifierMatchesCard / addTemporary* if exclusive).
2. applyTemporaryGraveyardKeywordGrantFromText (~1458-1528, 3.0 KB) with keyword
   helpers if they fit.
3. getStaticSourceGraveyardCastingPermissions + addGraveyardCastingPermission.
4. Remaining strip/grant/printed-self-cast until parent < 40960.

Public exports stay on graveyard-permissions.ts (re-export from leaf).
Leaf must not import graveyard-permissions.ts or the index. Byte-copy --dry first.
Typecheck server. Graveyard-cast permission vitest. No ts-morph.
```
