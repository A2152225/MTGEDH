# Split handoff - chat CE (shared/src/types.ts)

Parent now: **48530 B / 47.4 KB**. Still over 40960. Parent is LF.

**Folder trap:** `shared/src/types/` already exists (`GameState.ts`, `Player.ts`, `Card.ts`, `GameActions.ts`) with a **different** `GameState` shape. Do **not** put leaves there. Do **not** merge `types.ts` `GameState` / `Player` into that folder. Use `shared/src/types-handlers/` only. Never create `types/index.ts`.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CE.md.
Sole writer for shared/src/types.ts and new shared/src/types-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit any docs/mtg-logic-module-map*.md — report owed rows.
Create types-handlers/index.ts on extract #1.
NEVER write into shared/src/types/ (legacy unused GameState/Player/Card).
Do not merge those copies with types.ts. Parent LF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs shared/src/types.ts --min-bytes 1500

Order:
1. GameState (~633-843, 8.0 KB) plus exclusive types it closes over
   only if they are not used by remaining parent declarations.
2. BattlefieldPermanent (~210-311, 4.7 KB).
3. SHORTCUT_ELIGIBLE_TRIGGERS (~1250-1381, 4.1 KB) then remaining
   clusters until parent < 40960.

Public path stays types.ts (re-export so shared/src/index.ts
`export * from "./types.js"` keeps working). Leaf must not import
types.ts or the index.
Byte-copy --dry first. Typecheck shared (or the workspace that owns it).
No ts-morph.
```
