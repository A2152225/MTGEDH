# Split handoff - chat BC (keyword-handlers.ts)

Parent now: **58015 B / 56.7 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BC.md.
Sole writer for server/src/state/modules/keyword-handlers.ts and new
keyword-trigger-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create keyword-trigger-handlers/index.ts on extract #1.
Never create keyword-handlers/ beside keyword-handlers.ts (ambiguous with the .ts).
Parent CRLF; leaves LF. Do not Read the whole parent.

processKeywordTrigger stays a real dispatcher (switch over handle*).
Do NOT move whole processKeywordTrigger if peeling handle* families is enough.

Grep dual-copy vs gameActionsPermanentKeywordGrants and keyword-detection.ts.
Do not create a third copy of the same export.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/keyword-handlers.ts --min-bytes 800

Order:
1. Attack-trigger handle* family (~414-827: dethrone through enlist) as one leaf
   under 40KB, else split combat vs keyword-pump.
2. Cast/death/ETB handle* families (storm, bloodthirst, modular, soulshift, haunt,
   bolster, amass, populate).
3. processKeywordTriggers wrapper + applyKeywordPTMod if still needed for ceiling.

Public exports stay on keyword-handlers.ts (re-export from leaf).
Leaf must not import keyword-handlers.ts or the index. Byte-copy --dry first.
Typecheck server. Keyword-trigger vitest. No ts-morph.
```
