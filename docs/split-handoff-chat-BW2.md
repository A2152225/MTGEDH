# Split handoff - chat BW2 (client/src/App.tsx continue)

Parent now: **308171 B / 300.9 KB**. Still over 40960. Parent is CRLF.

`App` itself is **290.8 KB**. Do not move it whole.

BW already created `App-handlers/`. Continue peeling until parent **and** leftover `App()` are under 40960.

Do not append to:
- `appPlaySocketEffects.ts` **34748 B / 33.9 KB**
- `appLoopShortcutHandlers.ts` **30519 B / 29.8 KB**
- `appPlayOverlaysEarly.tsx` **28945 B / 28.3 KB**

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BW2.md.
Sole writer for client/src/App.tsx and client/src/App-handlers/**.
Keep peeling until parent AND leftover App() are under 40960 bytes.
Do not stop at a leaf count.
Do not edit any docs/mtg-logic-module-map*.md — report owed rows.
Never create App/ beside App.tsx. Parent CRLF; leaves LF.
Do not Read the whole parent.

Do NOT move export function App (~175-7524, 290.8 KB) whole.
Split nested callbacks/effects/JSX with --allow-nested.

Do not append to appPlaySocketEffects.ts, appLoopShortcutHandlers.ts,
or appPlayOverlaysEarly.tsx.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/App.tsx --min-bytes 2000
  rg -n "dismissResolutionStepUi|useEffect|useCallback" client/src/App.tsx

Order:
1. Split the resolution-prompt cluster (~1343-2800, 64.8 KB OVER) into
   TWO leaves. dismissResolutionStepUi (~1343-1412, 2.6 KB) plus the
   giant useEffect (~1427-2800). Do not move the 64.8 KB range as one file.
2. Extract modal/combat handlers (~3408-4464, 35.3 KB) — split if the
   header would push over 40 KB.
3. Remaining overlay JSX (~4465-7524, 125.3 KB) in ~20-28 KB sibling
   chunks (same renderApp* + used-bindings pattern as
   appPlayOverlaysEarly.tsx).
4. Extract leftover state into useAppState only if imports + state would
   keep the parent over 40 KB.

Public App stays on App.tsx. Leaf must not import App.tsx or the index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
