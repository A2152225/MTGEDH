# Split wave 14 — leftover overs + App continue

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns every `docs/mtg-logic-module-map*.md`. Client owed rows merge into `docs/mtg-logic-module-map-client.md`. Shared types rows merge there too (or a types subsection).

These four are disjoint. One writer per parent.

Giant **component / `App()` / `DeckManagerModal` functions must not move whole**.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| BW2 | `client/src/App.tsx` **36.0 KB** done | leftover `App()` **35.5 KB**; resolution-prompt four leaves + overlay/state/runtime/shell |
| CE | `shared/src/types.ts` **34.4 KB** done | identity/card-ref/mana/`PlayerRef`/`BattlefieldPermanent` → `types-handlers/`; `GameState` stayed |
| CF | `DeckManagerModal.tsx` **38.4 KB** done | random-import + save/cache handlers; leftover 36.3 KB; ~1.6 KB headroom |
| CG | `TargetSelectionModal.tsx` **38.7 KB** done | top-level types/badges → `targetSelectionModalSupport.tsx`; leftover 37.5 KB; ~1.3 KB headroom |

**Dual-copy / folder traps**

- `shared/src/types/` already exists with a *different* unused `GameState` / `Player` / `Card`. Do not merge. Do not put CE leaves there.
- Do not append to `App-handlers/appPlaySocketEffects.ts` (**33.9 KB**), `appLoopShortcutHandlers.ts` (**29.8 KB**), `appPlayOverlaysEarly.tsx` (**28.3 KB**).
- Never create `App/`, `DeckManagerModal/`, `TargetSelectionModal/`, or `types/` (new) beside the parent file.

**UI / types:** behavior-preserving extract only. Typecheck the owning workspace.

Wave 14 complete. `node tools/ts-logic-file-sizes.mjs`: **0 files over 40960 bytes**.

## Running

| Chat | Agent |
| --- | --- |
| BW2 | `10939a39-dc89-4f88-875f-8ad89cb0058f` **done** |
| CE | `17279601-a7e0-4d37-8fc8-9e1d5984545f` **done** |
| CF | `6f337f18-f2a0-468d-8733-b8110c5365b1` **done** |
| CG | `c94cf564-829f-48d1-bf99-a024779a5846` **done** |
