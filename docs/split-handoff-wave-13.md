# Split wave 13 — client UI + shared types leftover

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns every `docs/mtg-logic-module-map*.md` (index plus siblings).

These eight are disjoint. One writer per parent.

Giant **component / `App()` functions must not move whole**. Split nested callbacks, hooks, and helpers by contiguous cluster (`--allow-nested`). Keep splitting until the leftover function body is also under 40 KB.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| BW | `client/src/App.tsx` **36.0 KB** done (via BW2) | leftover `App()` 35.5 KB |
| BX | `TableLayout.tsx` **39.0 KB** done | mana/geometry/viewport/seat → `TableLayout-handlers/`; leftover 37.4 KB; ~1 KB headroom |
| BY | `CombatSelectionModal.tsx` **28.7 KB** done | creature-info / group / panels → `CombatSelectionModal-handlers/`; leftover 27.0 KB |
| BZ | `FreeField.tsx` **34.9 KB** done | display utils + overlays + battlefield-layout hook; leftover `FreeField` 33.6 KB |
| CA | `activatedAbilityParser.ts` **10.5 KB** done | helpers + `parseActivatedAbilities` → handlers; leaf **39.0 KB** do not append |
| CB | `CreateGameModal.tsx` **34.3 KB** done | nested AI opponents → `createGameModalAiOpponentsSection.tsx`; leftover `CreateGameModal` 30.8 KB |
| CC | `loopShortcuts.ts` **26.6 KB** done | resolution-response payload + target-match helpers → `loopShortcuts-handlers/` |
| CD | `CastSpellModal.tsx` **32.1 KB** done | `parseAlternateCosts` → `castSpellModalParseAlternateCosts.ts`; nested `CastSpellModal` stayed |

Skipped this wave (now wave 14): `shared/src/types.ts`, `DeckManagerModal.tsx`, `TargetSelectionModal.tsx`. Continue: `docs/split-handoff-wave-14.md`.

**Dual-copy:** client `parseActivatedAbilities` ≠ rules-engine `parseActivatedAbilitiesFromText`. Do not merge.

**Folders:** `X-handlers/` next to `X.tsx`. Never create `App/`, `TableLayout/`, `CombatSelectionModal/`, `FreeField/`, `CreateGameModal/`, `CastSpellModal/`, `activatedAbilityParser/`, or `loopShortcuts/` beside the parent file.

**UI:** behavior-preserving extract only. Do not restyle or change handlers. Typecheck the client workspace. Targeted vitest if present.

**Map:** extract chats still do **not** edit any `docs/mtg-logic-module-map*.md` file. Paste owed rows. Coordinator merges into `docs/mtg-logic-module-map-client.md`.

## Running

| Chat | Agent |
| --- | --- |
| BW | `150d8f53-d056-483a-aa88-56db24e331b4` **done** (BW2 finished parent) |
| BX | `bf32518f-ce3d-44ab-b654-c55b0f1ea123` **done** |
| BY | `86825b3f-ed9b-4116-b3e9-a2006a59c646` **done** |
| BZ | `c037ffa3-e7ca-4921-b61a-4f38fd885e28` **done** |
| CA | `497a7bec-a481-4aaf-9d93-55dfaf6c3585` **done** |
| CB | `86a98ba5-dbea-4fd8-acf7-2720d727448c` **done** |
| CC | `6036f22d-c36a-4076-8c5f-89449cea9b17` **done** |
| CD | `5aa51f78-2692-4bbf-b16a-2d1f0fde5061` **done** |
