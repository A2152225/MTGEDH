# Split handoff - chat BO (dungeon-effects.ts)

Parent now: **45260 B / 44.2 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BO.md.
Sole writer for server/src/state/modules/dungeon-effects.ts and new
dungeon-effects-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create dungeon-effects-handlers/index.ts on extract #1. Never create
dungeon-effects/ beside dungeon-effects.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/dungeon-effects.ts --min-bytes 2000

Order:
1. applyAutomaticDungeonRoomTokenEffects (~352-520, 5.9 KB) plus exclusive helpers.
2. buildDungeonRoomPromptSteps (~795-1022, 8.5 KB) then buildDungeonRoomPromptStep.
3. Remaining dungeon apply/prompt helpers until parent < 40960.

Public exports stay on dungeon-effects.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Dungeon vitest. No ts-morph.
```
