# Split handoff - chat CC (loopShortcuts.ts)

Parent now: **50390 B / 49.2 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CC.md.
Sole writer for client/src/utils/loopShortcuts.ts and new
client/src/utils/loopShortcuts-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create loopShortcuts-handlers/index.ts on extract #1. Never create
loopShortcuts/ beside loopShortcuts.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/utils/loopShortcuts.ts --min-bytes 1500

Order:
1. buildResolutionResponsePayload (~1292-1412, 4.0 KB) plus exclusive helpers.
2. createRecordedResolutionResponseItem (~1063-1166, 2.9 KB) then
   buildIdSelectionsPayload / payment templates until parent < 40960.

Public exports stay on loopShortcuts.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. Loop-shortcut vitest if present. No ts-morph.
```
